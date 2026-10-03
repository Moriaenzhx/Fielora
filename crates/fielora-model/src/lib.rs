//! Provider-neutral Model layer for the Fielora Agent.
//!
//! This crate owns provider adapters, wire normalization, model capability
//! metadata, and bounded model behavior hints. It does not own AgentRun state,
//! tool authority, approvals, execution, or verification; those are Harness
//! responsibilities.

mod compatibility;
mod profile;
use fielora_contracts::ModelRuntimeSettings;
pub use profile::{
    effective_parameters, endpoint_identity, provider_catalog, resolve_profile,
    validate_provider_model,
};

use fielora_contracts::{
    ContextSensitivity, ModelCapabilityProfile, ModelInvocationEvent, ModelInvocationEventKind,
    ModelInvocationRequest, ModelToolDefinition, ModelUsage, ProviderKind, ToolProposal,
};
use fielora_platform::is_public_internet_ip;
use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use thiserror::Error;
use tokio::net::lookup_host;
use tokio_util::sync::CancellationToken;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONTEXT_CHIPS: usize = 8;
const MAX_CONTEXT_CHIP_SCALARS: usize = 4_000;
const MAX_CONTEXT_CHIP_BYTES: usize = 16 * 1024;
const MAX_CONTEXT_SCALARS: usize = 12_000;
const MAX_CONTEXT_BYTES: usize = 48 * 1024;
const MAX_USER_INPUT_SCALARS: usize = 8_000;
const MAX_USER_INPUT_BYTES: usize = 32 * 1024;
const MAX_TOOL_ARGUMENT_BYTES: usize = 64 * 1024;
const DIRECT_INVOCATION_MAX_OUTPUT_TOKENS: u32 = 1_024;
const FIELORA_PROVIDER_USER_AGENT: &str = concat!(
    "Fielora/",
    env!("CARGO_PKG_VERSION"),
    " interactive-coding-agent"
);

#[derive(Debug, Clone)]
pub struct ProviderEndpoint {
    pub model_optimization: bool,
    pub kind: ProviderKind,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodingModelFamily {
    Generic,
    Qwen,
    DeepSeek,
    Kimi,
    Glm,
    MiniMax,
    Doubao,
    Hunyuan,
    Ernie,
    Spark,
    Step,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CodingBehaviorProfile {
    pub id: &'static str,
    pub family: CodingModelFamily,
    pub chinese_primary: bool,
    pub prefer_serial_tool_calls: bool,
    pub nudge_action_tasks: bool,
}

impl CodingBehaviorProfile {
    pub fn system_guidance(self) -> &'static str {
        match self.family {
            CodingModelFamily::Generic => "",
            _ => {
                "\
国产模型执行约束（不改变权限）：\n\
1. 用户使用中文时，用简洁中文沟通；代码、标识符、命令和错误码保持原文。\n\
2. 编程任务按“读取证据 -> 小范围修改 -> 运行最窄测试 -> 检查 git diff -> 总结”执行。需要行动时直接调用工具，不要只描述计划。\n\
3. 工具参数必须是严格符合 schema 的 JSON。存在依赖的工具逐个调用；只有互不依赖的读取可以并行。\n\
4. 不猜测文件内容、测试结果或 Git 状态。失败 receipt 是失败，不得改写为成功。\n\
5. commit/push 只能使用 typed Git tools，并等待用户批准；不得通过 run_command 绕过。"
            }
        }
    }
}

pub fn coding_behavior_profile(
    endpoint: &ProviderEndpoint,
    model_id: &str,
) -> CodingBehaviorProfile {
    let family = match profile::optimized_family(endpoint, model_id) {
        Some("QWEN") => CodingModelFamily::Qwen,
        Some("DEEPSEEK") => CodingModelFamily::DeepSeek,
        Some("KIMI") => CodingModelFamily::Kimi,
        Some("GLM") => CodingModelFamily::Glm,
        Some("MINIMAX") => CodingModelFamily::MiniMax,
        Some("DOUBAO") => CodingModelFamily::Doubao,
        Some("HUNYUAN") => CodingModelFamily::Hunyuan,
        Some("ERNIE") => CodingModelFamily::Ernie,
        Some("SPARK") => CodingModelFamily::Spark,
        Some("STEP") => CodingModelFamily::Step,
        _ => CodingModelFamily::Generic,
    };
    if family == CodingModelFamily::Generic {
        CodingBehaviorProfile {
            id: "generic-coding-v1",
            family,
            chinese_primary: false,
            prefer_serial_tool_calls: false,
            nudge_action_tasks: false,
        }
    } else {
        CodingBehaviorProfile {
            id: "china-coding-v1",
            family,
            chinese_primary: true,
            prefer_serial_tool_calls: true,
            nudge_action_tasks: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentModelToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentModelImage {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    pub data_url: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AgentModelMessage {
    User(String),
    UserMultimodal {
        text: String,
        images: Vec<AgentModelImage>,
    },
    Assistant {
        text: String,
        tool_calls: Vec<AgentModelToolCall>,
        continuation: Option<ProviderContinuation>,
    },
    ToolResult {
        call_id: String,
        name: String,
        content: String,
        is_error: bool,
    },
}

#[derive(Debug, Clone)]
pub struct AgentModelRequest {
    pub model_id: String,
    pub system: String,
    pub messages: Vec<AgentModelMessage>,
    pub tools: Vec<ModelToolDefinition>,
    pub max_output_tokens: u32,
}

/// Opaque, bounded provider protocol state. No Serialize implementation: never persist or emit.
#[derive(Clone, PartialEq)]
pub struct ProviderContinuation {
    fields: serde_json::Map<String, Value>,
    endpoint_key: String,
}
impl std::fmt::Debug for ProviderContinuation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProviderContinuation([REDACTED])")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentModelTurn {
    pub continuation: Option<ProviderContinuation>,
    pub text: String,
    pub tool_calls: Vec<AgentModelToolCall>,
    pub usage: Option<ModelUsage>,
}

/// Removes provider-specific hidden-reasoning wrappers before text crosses the
/// Agent/Conversation boundary. This intentionally works on the completed
/// response so tags split across SSE frames cannot leak partial reasoning.
pub fn sanitize_agent_text(text: &str) -> String {
    fn tag_end(lower: &str, start: usize) -> Option<usize> {
        lower[start..].find('>').map(|offset| start + offset + 1)
    }
    let lower = text.to_ascii_lowercase();
    let mut visible = String::with_capacity(text.len());
    let mut cursor = 0;
    while cursor < text.len() {
        let open = lower[cursor..].find("<think").map(|offset| cursor + offset);
        let close = lower[cursor..]
            .find("</think")
            .map(|offset| cursor + offset);
        match (open, close) {
            (None, None) => {
                visible.push_str(&text[cursor..]);
                break;
            }
            (Some(open), Some(close)) if close < open => {
                if !visible.trim().is_empty() {
                    visible.push_str(&text[cursor..close]);
                }
                cursor = tag_end(&lower, close).unwrap_or(text.len());
            }
            (None, Some(close)) => {
                if !visible.trim().is_empty() {
                    visible.push_str(&text[cursor..close]);
                }
                cursor = tag_end(&lower, close).unwrap_or(text.len());
            }
            (Some(open), _) => {
                visible.push_str(&text[cursor..open]);
                let Some(open_end) = tag_end(&lower, open) else {
                    break;
                };
                let Some(close) = lower[open_end..]
                    .find("</think")
                    .map(|offset| open_end + offset)
                else {
                    break;
                };
                cursor = tag_end(&lower, close).unwrap_or(text.len());
            }
        }
    }
    visible.trim().to_owned()
}

pub fn provider_capabilities(kind: ProviderKind) -> ModelCapabilityProfile {
    match kind {
        ProviderKind::Openai => ModelCapabilityProfile {
            streaming: true,
            native_tools: true,
            parallel_tools: true,
            strict_schema: true,
            usage: true,
            cancellation: true,
        },
        ProviderKind::Anthropic => ModelCapabilityProfile {
            streaming: true,
            native_tools: true,
            parallel_tools: true,
            strict_schema: false,
            usage: true,
            cancellation: true,
        },
        ProviderKind::OpenaiCompatible => ModelCapabilityProfile {
            streaming: true,
            native_tools: true,
            parallel_tools: false,
            strict_schema: false,
            usage: true,
            cancellation: true,
        },
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ModelError {
    #[error("CREDENTIAL_REJECTED")]
    CredentialRejected,
    #[error("MODEL_NOT_AVAILABLE")]
    ModelNotAvailable,
    #[error("PROVIDER_RATE_LIMITED")]
    ProviderRateLimited,
    #[error("PROVIDER_UNAVAILABLE")]
    ProviderUnavailable,
    #[error("PROVIDER_PROTOCOL_ERROR")]
    ProviderProtocolError,
    #[error("PROVIDER_REQUEST_REJECTED")]
    ProviderRequestRejected(u16),
    #[error("{category}")]
    ProviderRequestInvalid { status: u16, category: &'static str },
    #[error("PROVIDER_RESPONSE_TOO_LARGE")]
    ProviderResponseTooLarge,
    #[error("CONTEXT_TOO_LARGE")]
    ContextTooLarge,
    #[error("CONTEXT_BLOCKED")]
    ContextBlocked,
    #[error("CUSTOM_ENDPOINT_REJECTED")]
    CustomEndpointRejected,
    #[error("MODEL_CONFIGURATION_UNSUPPORTED")]
    ConfigurationUnsupported,
    #[error("PROVIDER_MODEL_MISMATCH")]
    ProviderModelMismatch,
    #[error("INVOCATION_CANCELLED")]
    InvocationCancelled,
}

impl ModelError {
    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::ProviderRequestRejected(status) | Self::ProviderRequestInvalid { status, .. } => {
                Some(*status)
            }
            _ => None,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::CredentialRejected => "CREDENTIAL_REJECTED",
            Self::ModelNotAvailable => "MODEL_NOT_AVAILABLE",
            Self::ProviderRateLimited => "PROVIDER_RATE_LIMITED",
            Self::ProviderUnavailable => "PROVIDER_UNAVAILABLE",
            Self::ProviderProtocolError => "PROVIDER_PROTOCOL_ERROR",
            Self::ProviderRequestRejected(_) => "PROVIDER_REQUEST_REJECTED",
            Self::ProviderRequestInvalid { category, .. } => category,
            Self::ProviderResponseTooLarge => "PROVIDER_RESPONSE_TOO_LARGE",
            Self::ContextTooLarge => "CONTEXT_TOO_LARGE",
            Self::ContextBlocked => "CONTEXT_BLOCKED",
            Self::CustomEndpointRejected => "CUSTOM_ENDPOINT_REJECTED",
            Self::ConfigurationUnsupported => "MODEL_CONFIGURATION_UNSUPPORTED",
            Self::ProviderModelMismatch => "PROVIDER_MODEL_MISMATCH",
            Self::InvocationCancelled => "INVOCATION_CANCELLED",
        }
    }
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    total: usize,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, ModelError> {
        self.total = self.total.saturating_add(bytes.len());
        if self.total > MAX_RESPONSE_BYTES {
            return Err(ModelError::ProviderResponseTooLarge);
        }
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some((index, delimiter)) = next_sse_delimiter(&self.buffer) {
            let raw = self.buffer.drain(..index + delimiter).collect::<Vec<_>>();
            let text = std::str::from_utf8(&raw).map_err(|_| ModelError::ProviderProtocolError)?;
            let data = text
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() {
                events.push(data);
            }
        }
        if self.buffer.len() > MAX_EVENT_BYTES {
            return Err(ModelError::ProviderResponseTooLarge);
        }
        Ok(events)
    }
}

#[derive(Clone)]
pub struct ModelClient {
    client: Client,
    settings: Option<ModelRuntimeSettings>,
    #[cfg(test)]
    test_url: Option<Url>,
}

impl ModelClient {
    pub fn new() -> Result<Self, ModelError> {
        let client = Client::builder()
            .user_agent(FIELORA_PROVIDER_USER_AGENT)
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| ModelError::ProviderUnavailable)?;
        Ok(Self {
            client,
            settings: None,
            #[cfg(test)]
            test_url: None,
        })
    }

    async fn target(
        &self,
        endpoint: &ProviderEndpoint,
        cancellation: &CancellationToken,
    ) -> Result<(Url, Option<(String, Vec<SocketAddr>)>), ModelError> {
        #[cfg(test)]
        if let Some(url) = &self.test_url {
            return Ok((url.clone(), None));
        }
        // DNS and endpoint checks are part of the cancellable invocation too.
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(ModelError::InvocationCancelled),
            value = endpoint_url(endpoint) => value,
        }
    }

    pub fn with_settings(mut self, settings: ModelRuntimeSettings) -> Self {
        self.settings = Some(settings);
        self
    }

    pub async fn invoke<F>(
        &self,
        endpoint: ProviderEndpoint,
        request: ModelInvocationRequest,
        secret: &[u8],
        cancellation: CancellationToken,
        mut emit: F,
    ) -> Result<(), ModelError>
    where
        F: FnMut(ModelInvocationEvent) + Send,
    {
        validate_request(&request)?;
        validate_provider_model(endpoint.kind, &request.model_id)?;
        emit(event(&request, ModelInvocationEventKind::Started));
        let (url, pinned) = self.target(&endpoint, &cancellation).await?;
        let client = if let Some((host, addresses)) = pinned {
            Client::builder()
                .user_agent(FIELORA_PROVIDER_USER_AGENT)
                .redirect(Policy::none())
                .no_proxy()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(90))
                .resolve_to_addrs(&host, &addresses)
                .build()
                .map_err(|_| ModelError::ProviderUnavailable)?
        } else {
            self.client.clone()
        };
        let response = match endpoint.kind {
            ProviderKind::Openai | ProviderKind::OpenaiCompatible => {
                let mut body = provider_body(&endpoint, &request);
                profile::apply_settings(
                    &mut body,
                    &endpoint,
                    &request.model_id,
                    &self.settings.clone().unwrap_or_default(),
                )?;
                client
                    .post(url)
                    .bearer_auth(String::from_utf8_lossy(secret))
                    .json(&body)
                    .send()
            }
            ProviderKind::Anthropic => {
                let mut body = provider_body(&endpoint, &request);
                profile::apply_settings(
                    &mut body,
                    &endpoint,
                    &request.model_id,
                    &self.settings.clone().unwrap_or_default(),
                )?;
                client
                    .post(url)
                    .header("x-api-key", String::from_utf8_lossy(secret).as_ref())
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send()
            }
        };
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(ModelError::InvocationCancelled),
            value = response => value.map_err(|_| ModelError::ProviderUnavailable)?,
        };
        trace_provider_status("invoke", response.status());
        let response = checked_response(response, &cancellation).await?;
        let mut stream = response.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut saw_provider_terminal = false;
        while let Some(chunk) = tokio::select! {
            _ = cancellation.cancelled() => return Err(ModelError::InvocationCancelled),
            value = stream.next() => value,
        } {
            let chunk = chunk.map_err(|_| ModelError::ProviderUnavailable)?;
            for data in decoder.push(&chunk)? {
                if data == "[DONE]" {
                    if endpoint.kind == ProviderKind::OpenaiCompatible {
                        saw_provider_terminal = true;
                    }
                    continue;
                }
                let value: Value = serde_json::from_str(&data).map_err(|error| {
                    trace_provider_parse_error("invoke", data.len(), &error);
                    ModelError::ProviderProtocolError
                })?;
                trace_provider_value("invoke", &value);
                if provider_failure(endpoint.kind, &value) {
                    return Err(ModelError::ProviderProtocolError);
                }
                saw_provider_terminal |= provider_terminal(endpoint.kind, &value);
                for normalized in normalize_provider_event(endpoint.kind, &value) {
                    emit(with_id(&request, normalized));
                }
            }
        }
        if saw_provider_terminal {
            Ok(())
        } else {
            Err(ModelError::ProviderProtocolError)
        }
    }

    pub async fn invoke_agent_turn<F>(
        &self,
        endpoint: ProviderEndpoint,
        request: AgentModelRequest,
        secret: &[u8],
        cancellation: CancellationToken,
        mut emit_text: F,
    ) -> Result<AgentModelTurn, ModelError>
    where
        F: FnMut(&str) + Send,
    {
        validate_agent_request(&request)?;
        validate_provider_model(endpoint.kind, &request.model_id)?;
        let (url, pinned) = self.target(&endpoint, &cancellation).await?;
        let client = if let Some((host, addresses)) = pinned {
            Client::builder()
                .user_agent(FIELORA_PROVIDER_USER_AGENT)
                .redirect(Policy::none())
                .no_proxy()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .resolve_to_addrs(&host, &addresses)
                .build()
                .map_err(|_| ModelError::ProviderUnavailable)?
        } else {
            self.client.clone()
        };
        let mut request = request;
        if profile::preserves_reasoning(&endpoint, &request.model_id)
            && self
                .settings
                .as_ref()
                .is_none_or(|s| s.reasoning != fielora_contracts::ReasoningMode::Off)
        {
            recover_missing_continuation(
                &mut request.messages,
                profile::optimized_family(&endpoint, &request.model_id) == Some("KIMI"),
            );
        }
        let mut body = agent_provider_body(&endpoint, &request);
        let settings = self.settings.clone().unwrap_or(ModelRuntimeSettings {
            max_output_tokens: request.max_output_tokens,
            ..Default::default()
        });
        profile::apply_settings(&mut body, &endpoint, &request.model_id, &settings)?;
        let response = match endpoint.kind {
            ProviderKind::Openai | ProviderKind::OpenaiCompatible => client
                .post(url)
                .bearer_auth(String::from_utf8_lossy(secret))
                .json(&body)
                .send(),
            ProviderKind::Anthropic => client
                .post(url)
                .header("x-api-key", String::from_utf8_lossy(secret).as_ref())
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send(),
        };
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(ModelError::InvocationCancelled),
            value = response => value.map_err(|_| ModelError::ProviderUnavailable)?,
        };
        trace_provider_status("agent", response.status());
        let response = checked_response(response, &cancellation).await?;
        let mut stream = response.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut accumulator = AgentStreamAccumulator::new(endpoint.kind);
        while let Some(chunk) = tokio::select! {
            _ = cancellation.cancelled() => return Err(ModelError::InvocationCancelled),
            value = stream.next() => value,
        } {
            let chunk = chunk.map_err(|_| ModelError::ProviderUnavailable)?;
            for data in decoder.push(&chunk)? {
                if data == "[DONE]" {
                    if endpoint.kind == ProviderKind::OpenaiCompatible {
                        accumulator.terminal = true;
                    }
                    continue;
                }
                let value: Value = serde_json::from_str(&data).map_err(|error| {
                    trace_provider_parse_error("agent", data.len(), &error);
                    ModelError::ProviderProtocolError
                })?;
                trace_provider_value("agent", &value);
                if provider_failure(endpoint.kind, &value) {
                    return Err(ModelError::ProviderProtocolError);
                }
                for delta in accumulator.push(&value)? {
                    emit_text(&delta);
                }
            }
        }
        let tail = accumulator.flush_visible_text();
        if !tail.is_empty() {
            emit_text(&tail);
        }
        let mut turn = accumulator.finish()?;
        if let Some(state) = turn.continuation.as_mut() {
            state.fields.retain(|key, _| {
                profile::continuation_fields(&endpoint, &request.model_id).contains(&key.as_str())
            });
            state.endpoint_key = profile::endpoint_identity(&endpoint);
            if state.fields.is_empty() {
                turn.continuation = None;
            }
        }
        Ok(turn)
    }
}

fn validate_agent_request(request: &AgentModelRequest) -> Result<(), ModelError> {
    if request.model_id.is_empty()
        || request.model_id.len() > 256
        || request.system.len() > 64 * 1024
        || request.messages.is_empty()
        || request.messages.len() > 128
        || request.tools.len() > 64
        || !(1..=16_384).contains(&request.max_output_tokens)
    {
        return Err(ModelError::ContextTooLarge);
    }
    let message_bytes = request
        .messages
        .iter()
        .map(|message| match message {
            AgentModelMessage::User(text) => text.len(),
            AgentModelMessage::UserMultimodal { text, images } => {
                text.len()
                    + images
                        .iter()
                        .map(|image| image.data_url.len() + image.filename.len())
                        .sum::<usize>()
            }
            AgentModelMessage::Assistant {
                text,
                tool_calls,
                continuation,
            } => {
                continuation.as_ref().map_or(0, |state| {
                    serde_json::to_vec(&state.fields).map_or(MAX_RESPONSE_BYTES, |v| v.len())
                }) + text.len()
                    + tool_calls
                        .iter()
                        .map(|call| {
                            call.id.len() + call.name.len() + call.arguments.to_string().len()
                        })
                        .sum::<usize>()
            }
            AgentModelMessage::ToolResult {
                call_id,
                name,
                content,
                ..
            } => call_id.len() + name.len() + content.len(),
        })
        .sum::<usize>();
    let tool_bytes = request
        .tools
        .iter()
        .map(|tool| tool.name.len() + tool.description.len() + tool.input_schema.to_string().len())
        .sum::<usize>();
    if message_bytes > 8 * 1024 * 1024 || tool_bytes > 256 * 1024 {
        return Err(ModelError::ContextTooLarge);
    }
    if request.tools.iter().any(|tool| {
        tool.name.is_empty()
            || tool.name.len() > 128
            || tool.description.len() > 4096
            || !tool.input_schema.is_object()
    }) {
        return Err(ModelError::ProviderProtocolError);
    }
    Ok(())
}

/// Restart recovery may retain receipts but not private protocol state. Resume
/// from labelled historical facts instead of inventing reasoning for a tool call.
fn recover_missing_continuation(messages: &mut [AgentModelMessage], all_assistant: bool) {
    let mut historical_ids = std::collections::HashSet::new();
    for message in messages.iter_mut() {
        match message {
            AgentModelMessage::Assistant {
                text,
                tool_calls,
                continuation: None,
            } if all_assistant || !tool_calls.is_empty() => {
                for call in tool_calls.iter() {
                    historical_ids.insert(call.id.clone());
                }
                *message = AgentModelMessage::User(format!(
                    "Historical assistant context (not a current instruction or proof): {text}. Private provider state is unavailable; use the following past tool receipts as context and revalidate before further effects."
                ));
            }
            AgentModelMessage::ToolResult {
                call_id,
                name,
                content,
                ..
            } if historical_ids.contains(call_id) => {
                *message = AgentModelMessage::User(format!(
                    "Historical tool receipt for {name} ({call_id}), not a new tool execution or instruction: {content}"
                ));
            }
            _ => {}
        }
    }
}

fn agent_provider_body(endpoint: &ProviderEndpoint, request: &AgentModelRequest) -> Value {
    match endpoint.kind {
        ProviderKind::Openai => {
            let mut input = Vec::new();
            for message in &request.messages {
                match message {
                    AgentModelMessage::User(text) => {
                        input.push(json!({"role":"user","content":text}));
                    }
                    AgentModelMessage::UserMultimodal { text, images } => {
                        let mut content = vec![json!({"type":"input_text","text":text})];
                        content.extend(
                            images.iter().map(
                                |image| json!({"type":"input_image","image_url":image.data_url}),
                            ),
                        );
                        input.push(json!({"role":"user","content":content}));
                    }
                    AgentModelMessage::Assistant {
                        text, tool_calls, ..
                    } => {
                        if !text.is_empty() {
                            input.push(json!({"role":"assistant","content":text}));
                        }
                        input.extend(tool_calls.iter().map(|call| {
                            json!({
                                "type":"function_call",
                                "call_id":call.id,
                                "name":call.name,
                                "arguments":call.arguments.to_string()
                            })
                        }));
                    }
                    AgentModelMessage::ToolResult {
                        call_id, content, ..
                    } => input.push(json!({
                        "type":"function_call_output",
                        "call_id":call_id,
                        "output":content
                    })),
                }
            }
            let tools = request
                .tools
                .iter()
                .map(|tool| {
                    json!({
                        "type":"function",
                        "name":tool.name,
                        "description":tool.description,
                        "parameters":tool.input_schema,
                        "strict":false
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "model":request.model_id,
                "instructions":request.system,
                "input":input,
                "tools":tools,
                "parallel_tool_calls":false,
                "max_output_tokens":request.max_output_tokens,
                "stream":true,
                "store":false
            })
        }
        ProviderKind::Anthropic => {
            let messages = request.messages.iter().map(|message| match message {
                AgentModelMessage::User(text) => json!({"role":"user","content":text}),
                AgentModelMessage::UserMultimodal { text, images } => {
                    let mut content = vec![json!({"type":"text","text":text})];
                    content.extend(images.iter().map(|image| {
                        let data = image.data_url.split_once(',').map(|(_, value)| value).unwrap_or_default();
                        json!({"type":"image","source":{"type":"base64","media_type":image.mime_type,"data":data}})
                    }));
                    json!({"role":"user","content":content})
                }
                AgentModelMessage::Assistant { text, tool_calls, .. } => {
                    let mut content = Vec::new();
                    if !text.is_empty() {
                        content.push(json!({"type":"text","text":text}));
                    }
                    content.extend(tool_calls.iter().map(|call| json!({
                        "type":"tool_use","id":call.id,"name":call.name,"input":call.arguments
                    })));
                    json!({"role":"assistant","content":content})
                }
                AgentModelMessage::ToolResult { call_id, content, is_error, .. } => json!({
                    "role":"user","content":[{"type":"tool_result","tool_use_id":call_id,"content":content,"is_error":is_error}]
                }),
            }).collect::<Vec<_>>();
            let tools = request.tools.iter().map(|tool| json!({
                "name":tool.name,"description":tool.description,"input_schema":tool.input_schema
            })).collect::<Vec<_>>();
            json!({
                "model":request.model_id,
                "system":request.system,
                "messages":messages,
                "tools":tools,
                "max_tokens":request.max_output_tokens,
                "stream":true
            })
        }
        ProviderKind::OpenaiCompatible => {
            let mut messages = vec![json!({"role":"system","content":request.system})];
            messages.extend(request.messages.iter().map(|message| match message {
                AgentModelMessage::User(text) => json!({"role":"user","content":text}),
                AgentModelMessage::UserMultimodal { text, images } => {
                    let mut content = vec![json!({"type":"text","text":text})];
                    content.extend(images.iter().map(|image| json!({"type":"image_url","image_url":{"url":image.data_url}})));
                    json!({"role":"user","content":content})
                }
                AgentModelMessage::Assistant { text, tool_calls, continuation } => {
                    let mut message = json!({"role":"assistant","content":text});
                    if let Some(state) = continuation && state.endpoint_key == profile::endpoint_identity(endpoint) {
                        for field in profile::continuation_fields(endpoint, &request.model_id) {
                            if let Some(value)=state.fields.get(*field) { message[*field]=value.clone(); }
                        }
                    }
                    // Ordinary assistant history is text, not an empty tool-call
                    // exchange. Some compatible providers reject tool_calls: [].
                    if !tool_calls.is_empty() {
                        if text.is_empty() { message["content"] = Value::Null; }
                        message["tool_calls"] = json!(tool_calls.iter().map(|call|json!({"id":call.id,"type":"function","function":{"name":call.name,"arguments":call.arguments.to_string()}})).collect::<Vec<_>>());
                    }
                    message
                },
                AgentModelMessage::ToolResult { call_id, name, content, .. } => json!({
                    "role":"tool","tool_call_id":call_id,"name":name,"content":content
                }),
            }));
            let tools = request.tools.iter().map(|tool|json!({
                "type":"function","function":{"name":tool.name,"description":tool.description,"parameters":tool.input_schema}
            })).collect::<Vec<_>>();
            let mut body = json!({
                "model":request.model_id,
                "messages":messages,
                "tools":tools,
                "tool_choice":"auto",
                "stream":true
            });
            let profile = coding_behavior_profile(endpoint, &request.model_id);
            if let Some(object) = body.as_object_mut() {
                if request.tools.is_empty() {
                    object.remove("tools");
                    object.remove("tool_choice");
                }
                if profile.family == CodingModelFamily::MiniMax {
                    object.insert(
                        "max_completion_tokens".into(),
                        json!(request.max_output_tokens),
                    );
                } else {
                    object.insert("max_tokens".into(), json!(request.max_output_tokens));
                    object.insert("stream_options".into(), json!({"include_usage":true}));
                }
                if profile.prefer_serial_tool_calls {
                    object.insert("parallel_tool_calls".into(), Value::Bool(false));
                }
            }
            body
        }
    }
}

#[derive(Default)]
struct PendingAgentToolCall {
    id: String,
    name: String,
    arguments: String,
    complete_arguments: Option<Value>,
}

struct AgentStreamAccumulator {
    kind: ProviderKind,
    text: String,
    visible_text: VisibleTextDeltaFilter,
    private_fields: serde_json::Map<String, Value>,
    private_bytes: usize,
    calls: BTreeMap<u64, PendingAgentToolCall>,
    usage: Option<ModelUsage>,
    terminal: bool,
}

impl AgentStreamAccumulator {
    fn new(kind: ProviderKind) -> Self {
        Self {
            kind,
            text: String::new(),
            visible_text: VisibleTextDeltaFilter::default(),
            private_fields: serde_json::Map::new(),
            private_bytes: 0,
            calls: BTreeMap::new(),
            usage: None,
            terminal: false,
        }
    }

    fn push(&mut self, value: &Value) -> Result<Vec<String>, ModelError> {
        let mut deltas = Vec::new();
        match self.kind {
            ProviderKind::Openai => match value.get("type").and_then(Value::as_str).unwrap_or("") {
                "response.output_text.delta" => {
                    if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                        self.push_text(delta, &mut deltas)?;
                    }
                }
                "response.output_item.added" => {
                    if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call")
                    {
                        let index = value
                            .get("output_index")
                            .and_then(Value::as_u64)
                            .ok_or(ModelError::ProviderProtocolError)?;
                        let call = self.calls.entry(index).or_default();
                        merge_string(&mut call.id, value.pointer("/item/call_id"))?;
                        merge_string(&mut call.name, value.pointer("/item/name"))?;
                        if let Some(arguments) =
                            value.pointer("/item/arguments").and_then(Value::as_str)
                        {
                            call.arguments.push_str(arguments);
                        }
                    }
                }
                "response.function_call_arguments.delta" => {
                    let index = value
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .ok_or(ModelError::ProviderProtocolError)?;
                    let call = self.calls.entry(index).or_default();
                    merge_string(&mut call.id, value.get("call_id"))?;
                    if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                        append_tool_arguments(&mut call.arguments, delta)?;
                    }
                }
                "response.output_item.done" => {
                    if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call")
                    {
                        let index = value
                            .get("output_index")
                            .and_then(Value::as_u64)
                            .ok_or(ModelError::ProviderProtocolError)?;
                        let call = self.calls.entry(index).or_default();
                        merge_string(&mut call.id, value.pointer("/item/call_id"))?;
                        merge_string(&mut call.name, value.pointer("/item/name"))?;
                        if let Some(arguments) =
                            value.pointer("/item/arguments").and_then(Value::as_str)
                        {
                            call.arguments.clear();
                            append_tool_arguments(&mut call.arguments, arguments)?;
                        }
                    }
                }
                "response.completed" => {
                    self.terminal = true;
                    if let Some(usage) = value.pointer("/response/usage") {
                        self.usage = Some(model_usage(usage, "input_tokens", "output_tokens"));
                    }
                }
                _ => {}
            },
            ProviderKind::Anthropic => {
                match value.get("type").and_then(Value::as_str).unwrap_or("") {
                    "content_block_start" => {
                        if value.pointer("/content_block/type").and_then(Value::as_str)
                            == Some("tool_use")
                        {
                            let index = value
                                .get("index")
                                .and_then(Value::as_u64)
                                .ok_or(ModelError::ProviderProtocolError)?;
                            let call = self.calls.entry(index).or_default();
                            merge_string(&mut call.id, value.pointer("/content_block/id"))?;
                            merge_string(&mut call.name, value.pointer("/content_block/name"))?;
                            if let Some(input) = value.pointer("/content_block/input")
                                && input != &json!({})
                            {
                                call.complete_arguments = Some(input.clone());
                            }
                        }
                    }
                    "content_block_delta" => {
                        let delta_type = value.pointer("/delta/type").and_then(Value::as_str);
                        if delta_type == Some("text_delta") {
                            if let Some(delta) =
                                value.pointer("/delta/text").and_then(Value::as_str)
                            {
                                self.push_text(delta, &mut deltas)?;
                            }
                        } else if delta_type == Some("input_json_delta") {
                            let index = value
                                .get("index")
                                .and_then(Value::as_u64)
                                .ok_or(ModelError::ProviderProtocolError)?;
                            let delta = value
                                .pointer("/delta/partial_json")
                                .and_then(Value::as_str)
                                .ok_or(ModelError::ProviderProtocolError)?;
                            append_tool_arguments(
                                &mut self.calls.entry(index).or_default().arguments,
                                delta,
                            )?;
                        }
                    }
                    "message_start" => {
                        if let Some(usage) = value.pointer("/message/usage") {
                            self.usage = Some(model_usage(usage, "input_tokens", "output_tokens"));
                        }
                    }
                    "message_delta" => {
                        if let Some(usage) = value.get("usage") {
                            let delta = model_usage(usage, "input_tokens", "output_tokens");
                            let current = self.usage.get_or_insert(ModelUsage {
                                input_tokens: None,
                                output_tokens: None,
                            });
                            current.input_tokens = delta.input_tokens.or(current.input_tokens);
                            current.output_tokens = delta.output_tokens.or(current.output_tokens);
                        }
                    }
                    "message_stop" => self.terminal = true,
                    _ => {}
                }
            }
            ProviderKind::OpenaiCompatible => {
                if let Some(delta) = value.pointer("/choices/0/delta") {
                    for field in [
                        "reasoning_content",
                        "encrypted_content",
                        "reasoning_details",
                    ] {
                        if let Some(fragment) = delta.get(field) {
                            self.private_bytes = self.private_bytes.saturating_add(
                                serde_json::to_vec(fragment)
                                    .map_err(|_| ModelError::ProviderProtocolError)?
                                    .len(),
                            );
                            if self.private_bytes > MAX_RESPONSE_BYTES {
                                return Err(ModelError::ProviderResponseTooLarge);
                            }
                        }
                    }
                    for field in ["reasoning_content", "encrypted_content"] {
                        if let Some(fragment) = delta.get(field).and_then(Value::as_str) {
                            let value = self
                                .private_fields
                                .entry(field)
                                .or_insert_with(|| json!(""));
                            if let Value::String(combined) = value {
                                combined.push_str(fragment);
                            }
                        }
                    }
                    if let Some(details) = delta.get("reasoning_details").and_then(Value::as_array)
                    {
                        let target = self
                            .private_fields
                            .entry("reasoning_details")
                            .or_insert_with(|| json!([]))
                            .as_array_mut()
                            .unwrap();
                        for item in details {
                            let key = item.get("index").or_else(|| item.get("id"));
                            if let Some(existing) = target.iter_mut().find(|existing| {
                                key.is_some()
                                    && existing.get("index").or_else(|| existing.get("id")) == key
                            }) {
                                if let Some(text) = item.get("text").and_then(Value::as_str) {
                                    let mut joined = existing
                                        .get("text")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default()
                                        .to_owned();
                                    joined.push_str(text);
                                    existing["text"] = json!(joined);
                                }
                            } else {
                                target.push(item.clone());
                            }
                        }
                    }
                }
                if let Some(delta) = value
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    self.push_text(delta, &mut deltas)?;
                }
                if let Some(calls) = value
                    .pointer("/choices/0/delta/tool_calls")
                    .and_then(Value::as_array)
                {
                    for item in calls {
                        let index = item
                            .get("index")
                            .and_then(Value::as_u64)
                            .ok_or(ModelError::ProviderProtocolError)?;
                        let call = self.calls.entry(index).or_default();
                        merge_string(&mut call.id, item.get("id"))?;
                        merge_string(&mut call.name, item.pointer("/function/name"))?;
                        if let Some(delta) =
                            item.pointer("/function/arguments").and_then(Value::as_str)
                        {
                            append_tool_arguments(&mut call.arguments, delta)?;
                        }
                    }
                }
                if let Some(usage) = value.get("usage")
                    && !usage.is_null()
                {
                    self.usage = Some(model_usage(usage, "prompt_tokens", "completion_tokens"));
                }
                if value
                    .pointer("/choices/0/finish_reason")
                    .and_then(Value::as_str)
                    .is_some()
                {
                    self.terminal = true;
                }
            }
        }
        Ok(deltas)
    }

    fn push_text(&mut self, delta: &str, emitted: &mut Vec<String>) -> Result<(), ModelError> {
        if self.text.len().saturating_add(delta.len()) > MAX_RESPONSE_BYTES {
            return Err(ModelError::ProviderResponseTooLarge);
        }
        self.text.push_str(delta);
        let visible = self.visible_text.push(delta);
        if !visible.is_empty() {
            emitted.push(visible);
        }
        Ok(())
    }

    fn flush_visible_text(&mut self) -> String {
        self.visible_text.finish()
    }

    fn finish(self) -> Result<AgentModelTurn, ModelError> {
        if !self.terminal {
            return Err(ModelError::ProviderProtocolError);
        }
        let tool_calls = self
            .calls
            .into_values()
            .map(|call| {
                if call.id.is_empty() || call.name.is_empty() {
                    return Err(ModelError::ProviderProtocolError);
                }
                let arguments = if let Some(value) = call.complete_arguments {
                    value
                } else if call.arguments.trim().is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&call.arguments)
                        .map_err(|_| ModelError::ProviderProtocolError)?
                };
                if !arguments.is_object() {
                    return Err(ModelError::ProviderProtocolError);
                }
                Ok(AgentModelToolCall {
                    id: call.id,
                    name: call.name,
                    arguments: bounded_arguments(&arguments),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(AgentModelTurn {
            continuation: (!self.private_fields.is_empty()).then_some(ProviderContinuation {
                fields: self.private_fields,
                endpoint_key: String::new(),
            }),
            text: sanitize_agent_text(&self.text),
            tool_calls,
            usage: self.usage,
        })
    }
}

/// Incrementally excludes provider-emitted `<think>` blocks from transient
/// presentation. Provider-private reasoning fields never enter this filter;
/// adapters only feed their public text channels into `push_text`.
#[derive(Default)]
struct VisibleTextDeltaFilter {
    hidden: bool,
    pending_tag: String,
}

impl VisibleTextDeltaFilter {
    fn push(&mut self, delta: &str) -> String {
        let mut visible = String::new();
        for character in delta.chars() {
            if !self.pending_tag.is_empty() {
                self.pending_tag.push(character);
                if character == '>' {
                    self.finish_tag(&mut visible);
                } else if self.pending_tag.len() > 256 {
                    let lower = self.pending_tag.to_ascii_lowercase();
                    if lower.starts_with("<think") {
                        self.hidden = true;
                    } else if !self.hidden {
                        visible.push_str(&self.pending_tag);
                    }
                    self.pending_tag.clear();
                }
                continue;
            }
            if character == '<' {
                self.pending_tag.push(character);
            } else if !self.hidden {
                visible.push(character);
            }
        }
        visible
    }

    fn finish(&mut self) -> String {
        if self.pending_tag.is_empty() {
            return String::new();
        }
        let lower = self.pending_tag.to_ascii_lowercase();
        let visible =
            if !self.hidden && !lower.starts_with("<think") && !lower.starts_with("</think") {
                self.pending_tag.clone()
            } else {
                String::new()
            };
        self.pending_tag.clear();
        visible
    }

    fn finish_tag(&mut self, visible: &mut String) {
        let lower = self.pending_tag.to_ascii_lowercase();
        if lower.starts_with("<think") {
            self.hidden = true;
        } else if lower.starts_with("</think") {
            self.hidden = false;
        } else if !self.hidden {
            visible.push_str(&self.pending_tag);
        }
        self.pending_tag.clear();
    }
}

fn merge_string(target: &mut String, value: Option<&Value>) -> Result<(), ModelError> {
    if let Some(value) = value {
        let value = value.as_str().ok_or(ModelError::ProviderProtocolError)?;
        if !value.is_empty() {
            if target.is_empty() {
                target.push_str(value);
            } else if target == value || target.starts_with(value) {
                // Some compatible gateways repeat the complete identifier on later chunks.
            } else if value.starts_with(target.as_str()) {
                // Some gateways send expanding snapshots instead of strict deltas.
                target.clear();
                target.push_str(value);
            } else {
                // Qwen-compatible streams may split both call IDs and function names.
                target.push_str(value);
            }
            if target.len() > 256 {
                return Err(ModelError::ProviderResponseTooLarge);
            }
        }
    }
    Ok(())
}

fn append_tool_arguments(target: &mut String, delta: &str) -> Result<(), ModelError> {
    if target.len().saturating_add(delta.len()) > MAX_TOOL_ARGUMENT_BYTES {
        return Err(ModelError::ProviderResponseTooLarge);
    }
    target.push_str(delta);
    Ok(())
}

fn model_usage(value: &Value, input: &str, output: &str) -> ModelUsage {
    ModelUsage {
        input_tokens: value.get(input).and_then(Value::as_u64),
        output_tokens: value.get(output).and_then(Value::as_u64),
    }
}

fn event(request: &ModelInvocationRequest, kind: ModelInvocationEventKind) -> ModelInvocationEvent {
    ModelInvocationEvent {
        event: "event.model.invocation".into(),
        invocation_id: request.invocation_id.clone(),
        kind,
        text_delta: None,
        tool_proposal: None,
        usage: None,
        error_code: None,
    }
}

fn with_id(
    request: &ModelInvocationRequest,
    mut event: ModelInvocationEvent,
) -> ModelInvocationEvent {
    event.invocation_id = request.invocation_id.clone();
    event
}

fn validate_request(request: &ModelInvocationRequest) -> Result<(), ModelError> {
    if request
        .context_package
        .iter()
        .any(|chip| chip.sensitivity == ContextSensitivity::Blocked)
    {
        return Err(ModelError::ContextBlocked);
    }
    if request.context_package.len() > MAX_CONTEXT_CHIPS
        || request.user_input.chars().count() > MAX_USER_INPUT_SCALARS
        || request.user_input.len() > MAX_USER_INPUT_BYTES
        || request.context_package.iter().any(|chip| {
            chip.content.chars().count() > MAX_CONTEXT_CHIP_SCALARS
                || chip.content.len() > MAX_CONTEXT_CHIP_BYTES
        })
    {
        return Err(ModelError::ContextTooLarge);
    }
    let context_bytes = request
        .context_package
        .iter()
        .map(|chip| chip.content.len())
        .sum::<usize>();
    let context_scalars = request
        .context_package
        .iter()
        .map(|chip| chip.content.chars().count())
        .sum::<usize>();
    if context_bytes > MAX_CONTEXT_BYTES || context_scalars > MAX_CONTEXT_SCALARS {
        return Err(ModelError::ContextTooLarge);
    }
    Ok(())
}

fn render_input(request: &ModelInvocationRequest) -> String {
    let mut input = String::new();
    for chip in &request.context_package {
        input.push_str("[Context: ");
        input.push_str(&chip.display_label);
        input.push_str("]\n");
        input.push_str(&chip.content);
        input.push_str("\n\n");
    }
    input.push_str(&request.user_input);
    input
}

fn provider_body(endpoint: &ProviderEndpoint, request: &ModelInvocationRequest) -> Value {
    match endpoint.kind {
        ProviderKind::Openai => {
            json!({"model":request.model_id,"input":render_input(request),"stream":true,"store":false})
        }
        ProviderKind::Anthropic => {
            json!({"model":request.model_id,"max_tokens":1024,"stream":true,"messages":[{"role":"user","content":render_input(request)}]})
        }
        ProviderKind::OpenaiCompatible => {
            let mut body = json!({"model":request.model_id,"messages":[{"role":"user","content":render_input(request)}],"stream":true});
            let profile = coding_behavior_profile(endpoint, &request.model_id);
            if let Some(object) = body.as_object_mut() {
                if profile.family == CodingModelFamily::MiniMax {
                    object.insert(
                        "max_completion_tokens".into(),
                        json!(DIRECT_INVOCATION_MAX_OUTPUT_TOKENS),
                    );
                } else {
                    object.insert(
                        "max_tokens".into(),
                        json!(DIRECT_INVOCATION_MAX_OUTPUT_TOKENS),
                    );
                    object.insert("stream_options".into(), json!({"include_usage":true}));
                }
            }
            body
        }
    }
}

async fn endpoint_url(
    endpoint: &ProviderEndpoint,
) -> Result<(Url, Option<(String, Vec<SocketAddr>)>), ModelError> {
    match endpoint.kind {
        ProviderKind::Openai => Url::parse("https://api.openai.com/v1/responses")
            .map(|url| (url, None))
            .map_err(|_| ModelError::ProviderProtocolError),
        ProviderKind::Anthropic => Url::parse("https://api.anthropic.com/v1/messages")
            .map(|url| (url, None))
            .map_err(|_| ModelError::ProviderProtocolError),
        ProviderKind::OpenaiCompatible => {
            let mut url = Url::parse(
                endpoint
                    .base_url
                    .as_deref()
                    .ok_or(ModelError::CustomEndpointRejected)?,
            )
            .map_err(|_| ModelError::CustomEndpointRejected)?;
            if url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.fragment().is_some()
            {
                return Err(ModelError::CustomEndpointRejected);
            }
            let host = url
                .host_str()
                .ok_or(ModelError::CustomEndpointRejected)?
                .to_owned();
            let port = url
                .port_or_known_default()
                .ok_or(ModelError::CustomEndpointRejected)?;
            if host.parse::<IpAddr>().is_ok()
                || !host.contains('.')
                || host.to_ascii_lowercase().ends_with(".local")
            {
                return Err(ModelError::CustomEndpointRejected);
            }
            let addresses = lookup_host((host.as_str(), port))
                .await
                .map_err(|_| ModelError::CustomEndpointRejected)?
                .collect::<Vec<_>>();
            if addresses.is_empty()
                || addresses
                    .iter()
                    .any(|addr| !is_public_internet_ip(addr.ip()))
            {
                return Err(ModelError::CustomEndpointRejected);
            }
            let path = url.path().trim_end_matches('/');
            url.set_path(&format!("{path}/chat/completions"));
            Ok((url, Some((host, addresses))))
        }
    }
}

fn next_sse_delimiter(buffer: &[u8]) -> Option<(usize, usize)> {
    let lf = buffer
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2));
    let crlf = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn provider_failure(kind: ProviderKind, value: &Value) -> bool {
    match kind {
        ProviderKind::Openai => matches!(
            value.get("type").and_then(Value::as_str),
            Some("response.failed" | "error")
        ),
        ProviderKind::Anthropic => value.get("type").and_then(Value::as_str) == Some("error"),
        ProviderKind::OpenaiCompatible => value.get("error").is_some_and(|error| !error.is_null()),
    }
}

fn trace_provider_status(context: &str, status: StatusCode) {
    if std::env::var_os("FIELORA_PROVIDER_PROTOCOL_TRACE").is_some() {
        eprintln!(
            "provider_protocol_trace context={context} http_status={}",
            status.as_u16()
        );
    }
}

fn trace_provider_parse_error(context: &str, bytes: usize, error: &serde_json::Error) {
    if std::env::var_os("FIELORA_PROVIDER_PROTOCOL_TRACE").is_some() {
        eprintln!(
            "provider_protocol_trace context={context} parse_error={:?} bytes={bytes} line={} column={}",
            error.classify(),
            error.line(),
            error.column()
        );
    }
}

fn trace_provider_value(context: &str, value: &Value) {
    if std::env::var_os("FIELORA_PROVIDER_PROTOCOL_TRACE").is_none() {
        return;
    }
    let keys = |candidate: Option<&Value>| {
        candidate
            .and_then(Value::as_object)
            .map(|object| object.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    };
    let top = keys(Some(value));
    let choice = keys(value.pointer("/choices/0"));
    let delta = keys(value.pointer("/choices/0/delta"));
    let message = keys(value.pointer("/choices/0/message"));
    let usage = keys(value.get("usage"));
    let error = keys(value.get("error"));
    let finish_reason = value
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str);
    let error_code = value
        .pointer("/error/code")
        .and_then(Value::as_str)
        .map(|code| code.chars().take(96).collect::<String>());
    eprintln!(
        "provider_protocol_trace context={context} top={top:?} choice={choice:?} delta={delta:?} message={message:?} usage={usage:?} error={error:?} finish_reason={finish_reason:?} error_code={error_code:?}"
    );
}

fn provider_terminal(kind: ProviderKind, value: &Value) -> bool {
    match kind {
        ProviderKind::Openai => {
            value.get("type").and_then(Value::as_str) == Some("response.completed")
        }
        ProviderKind::Anthropic => {
            value.get("type").and_then(Value::as_str) == Some("message_stop")
        }
        ProviderKind::OpenaiCompatible => false,
    }
}

// Error bodies are used only for a bounded, fixed classification. No provider
// text, reflected prompt, image bytes or credential is retained or displayed.
fn classify_rejection(status: u16, bytes: &[u8]) -> ModelError {
    let text = serde_json::from_slice::<Value>(bytes)
        .ok()
        .map(|value| {
            [
                "/error/code",
                "/error/type",
                "/error/param",
                "/error/message",
                "/code",
                "/message",
            ]
            .iter()
            .filter_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase()
        })
        .unwrap_or_default();
    let category = if status == 413
        || text.contains("context_length")
        || text.contains("maximum context")
        || text.contains("context length")
    {
        "PROVIDER_CONTEXT_LIMIT"
    } else if text.contains("image")
        && ["unsupported", "invalid", "not support", "decode", "format"]
            .iter()
            .any(|word| text.contains(word))
    {
        "PROVIDER_IMAGE_REJECTED"
    } else if ["tool_calls", "tool_call_id", "messages", "message role"]
        .iter()
        .any(|word| text.contains(word))
    {
        "PROVIDER_INVALID_MESSAGES"
    } else {
        return ModelError::ProviderRequestRejected(status);
    };
    ModelError::ProviderRequestInvalid { status, category }
}

async fn checked_response(
    response: reqwest::Response,
    cancellation: &CancellationToken,
) -> Result<reqwest::Response, ModelError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if !matches!(status.as_u16(), 400 | 413 | 422) {
        map_status(status)?;
    }
    let fallback = ModelError::ProviderRequestRejected(status.as_u16());
    let read = async {
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| fallback.clone())?;
            if body.len() + chunk.len() > 32 * 1024 {
                return Err(fallback.clone());
            }
            body.extend_from_slice(&chunk);
        }
        Err(classify_rejection(status.as_u16(), &body))
    };
    tokio::select! {
        _ = cancellation.cancelled() => Err(ModelError::InvocationCancelled),
        result = tokio::time::timeout(std::time::Duration::from_secs(2), read) => result.unwrap_or(Err(fallback)),
    }
}

fn map_status(status: StatusCode) -> Result<(), ModelError> {
    match status.as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(ModelError::CredentialRejected),
        404 => Err(ModelError::ModelNotAvailable),
        408 | 429 => Err(ModelError::ProviderRateLimited),
        500..=599 => Err(ModelError::ProviderUnavailable),
        _ => Err(ModelError::ProviderRequestRejected(status.as_u16())),
    }
}

fn blank(kind: ModelInvocationEventKind) -> ModelInvocationEvent {
    ModelInvocationEvent {
        event: "event.model.invocation".into(),
        invocation_id: fielora_contracts::ModelInvocationId::new(""),
        kind,
        text_delta: None,
        tool_proposal: None,
        usage: None,
        error_code: None,
    }
}

pub fn normalize_provider_event(kind: ProviderKind, value: &Value) -> Vec<ModelInvocationEvent> {
    let mut events = Vec::new();
    match kind {
        ProviderKind::Openai => match value.get("type").and_then(Value::as_str).unwrap_or("") {
            "response.output_text.delta" => {
                let mut event = blank(ModelInvocationEventKind::OutputTextDelta);
                event.text_delta = value
                    .get("delta")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if event.text_delta.is_some() {
                    events.push(event);
                }
            }
            "response.completed" => {
                if let Some(usage) = value.pointer("/response/usage") {
                    events.push(usage_event(usage, "input_tokens", "output_tokens"));
                }
            }
            "response.output_item.done"
                if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call") =>
            {
                let mut event = blank(ModelInvocationEventKind::ToolProposal);
                let arguments = value
                    .pointer("/item/arguments")
                    .and_then(Value::as_str)
                    .and_then(|raw| serde_json::from_str(raw).ok())
                    .unwrap_or(Value::Null);
                event.tool_proposal = Some(ToolProposal {
                    name: value
                        .pointer("/item/name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .chars()
                        .take(128)
                        .collect(),
                    arguments: bounded_arguments(&arguments),
                    provider_opaque_id: value
                        .pointer("/item/call_id")
                        .and_then(Value::as_str)
                        .map(|v| v.chars().take(256).collect()),
                });
                events.push(event);
            }
            _ => {}
        },
        ProviderKind::Anthropic => match value.get("type").and_then(Value::as_str).unwrap_or("") {
            "content_block_delta" => {
                if value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    let mut event = blank(ModelInvocationEventKind::OutputTextDelta);
                    event.text_delta = value
                        .pointer("/delta/text")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    if event.text_delta.is_some() {
                        events.push(event);
                    }
                }
            }
            "message_start" => {
                if let Some(usage) = value.pointer("/message/usage") {
                    events.push(usage_event(usage, "input_tokens", "output_tokens"));
                }
            }
            "message_delta" => {
                if let Some(usage) = value.get("usage") {
                    events.push(usage_event(usage, "input_tokens", "output_tokens"));
                }
            }
            "content_block_start"
                if value.pointer("/content_block/type").and_then(Value::as_str)
                    == Some("tool_use") =>
            {
                let mut event = blank(ModelInvocationEventKind::ToolProposal);
                event.tool_proposal = Some(ToolProposal {
                    name: value
                        .pointer("/content_block/name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .chars()
                        .take(128)
                        .collect(),
                    arguments: bounded_arguments(
                        value
                            .pointer("/content_block/input")
                            .unwrap_or(&Value::Null),
                    ),
                    provider_opaque_id: value
                        .pointer("/content_block/id")
                        .and_then(Value::as_str)
                        .map(|v| v.chars().take(256).collect()),
                });
                events.push(event);
            }
            _ => {}
        },
        ProviderKind::OpenaiCompatible => {
            if let Some(delta) = value
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                let mut event = blank(ModelInvocationEventKind::OutputTextDelta);
                event.text_delta = Some(delta.to_owned());
                events.push(event);
            }
            if let Some(usage) = value.get("usage") {
                events.push(usage_event(usage, "prompt_tokens", "completion_tokens"));
            }
            if let Some(calls) = value
                .pointer("/choices/0/delta/tool_calls")
                .and_then(Value::as_array)
            {
                for call in calls {
                    let mut event = blank(ModelInvocationEventKind::ToolProposal);
                    let arguments = call
                        .pointer("/function/arguments")
                        .and_then(Value::as_str)
                        .and_then(|raw| serde_json::from_str(raw).ok())
                        .unwrap_or(Value::Null);
                    event.tool_proposal = Some(ToolProposal {
                        name: call
                            .pointer("/function/name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .chars()
                            .take(128)
                            .collect(),
                        arguments: bounded_arguments(&arguments),
                        provider_opaque_id: call
                            .get("id")
                            .and_then(Value::as_str)
                            .map(|v| v.chars().take(256).collect()),
                    });
                    events.push(event);
                }
            }
        }
    }
    events
}

fn bounded_arguments(value: &Value) -> Value {
    serde_json::to_vec(value)
        .ok()
        .filter(|bytes| bytes.len() <= MAX_TOOL_ARGUMENT_BYTES)
        .map(|_| value.clone())
        .unwrap_or_else(|| json!({}))
}

fn usage_event(value: &Value, input: &str, output: &str) -> ModelInvocationEvent {
    let mut event = blank(ModelInvocationEventKind::Usage);
    event.usage = Some(ModelUsage {
        input_tokens: value.get(input).and_then(Value::as_u64),
        output_tokens: value.get(output).and_then(Value::as_u64),
    });
    event
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_user_agent_identifies_fielora_as_an_interactive_coding_agent() {
        assert!(FIELORA_PROVIDER_USER_AGENT.starts_with("Fielora/"));
        assert!(FIELORA_PROVIDER_USER_AGENT.contains("interactive-coding-agent"));
    }

    fn test_endpoint(kind: ProviderKind) -> ProviderEndpoint {
        ProviderEndpoint {
            model_optimization: true,
            kind,
            base_url: (kind == ProviderKind::OpenaiCompatible)
                .then(|| "https://models.example.com/v1".into()),
        }
    }

    #[test]
    fn different_wire_protocols_normalize_to_same_delta_and_usage() {
        let openai = normalize_provider_event(
            ProviderKind::Openai,
            &json!({"type":"response.output_text.delta","delta":"ok"}),
        );
        let anthropic = normalize_provider_event(
            ProviderKind::Anthropic,
            &json!({"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}),
        );
        let compatible = normalize_provider_event(
            ProviderKind::OpenaiCompatible,
            &json!({"choices":[{"delta":{"content":"ok"}}]}),
        );
        assert_eq!(openai[0].kind, ModelInvocationEventKind::OutputTextDelta);
        assert_eq!(anthropic[0].text_delta.as_deref(), Some("ok"));
        assert_eq!(compatible[0].text_delta.as_deref(), Some("ok"));

        let openai_usage = normalize_provider_event(
            ProviderKind::Openai,
            &json!({"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3}}}),
        );
        let anthropic_usage = normalize_provider_event(
            ProviderKind::Anthropic,
            &json!({"type":"message_delta","usage":{"input_tokens":2,"output_tokens":3}}),
        );
        let compatible_usage = normalize_provider_event(
            ProviderKind::OpenaiCompatible,
            &json!({"usage":{"prompt_tokens":2,"completion_tokens":3}}),
        );
        for usage in [openai_usage, anthropic_usage, compatible_usage] {
            assert_eq!(usage[0].kind, ModelInvocationEventKind::Usage);
            assert_eq!(usage[0].usage.as_ref().unwrap().input_tokens, Some(2));
            assert_eq!(usage[0].usage.as_ref().unwrap().output_tokens, Some(3));
        }
    }

    #[test]
    fn bounded_sse_decoder_reassembles_split_events_and_rejects_oversize() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: {\"a\"").unwrap().is_empty());
        assert_eq!(decoder.push(b":1}\n\n").unwrap(), vec!["{\"a\":1}"]);
        let mut utf8 = SseDecoder::default();
        assert!(utf8.push(b"data: \xf0\x9f").unwrap().is_empty());
        assert_eq!(utf8.push(b"\x98\x80\n\n").unwrap(), vec!["😀"]);
        let mut malformed = SseDecoder::default();
        assert_eq!(
            malformed.push(b"data: \xff\n\n"),
            Err(ModelError::ProviderProtocolError)
        );
        assert_eq!(
            decoder.push(&vec![b'x'; MAX_EVENT_BYTES + 1]),
            Err(ModelError::ProviderResponseTooLarge)
        );
    }

    #[test]
    fn private_addresses_are_never_valid_custom_targets() {
        assert!(!is_public_internet_ip("127.0.0.1".parse().unwrap()));
        assert!(!is_public_internet_ip("10.0.0.1".parse().unwrap()));
        assert!(!is_public_internet_ip("100.64.0.1".parse().unwrap()));
        assert!(!is_public_internet_ip("192.0.2.1".parse().unwrap()));
        assert!(!is_public_internet_ip("198.51.100.1".parse().unwrap()));
        assert!(!is_public_internet_ip("203.0.113.1".parse().unwrap()));
        assert!(!is_public_internet_ip("::1".parse().unwrap()));
        assert!(!is_public_internet_ip("::1.1.1.1".parse().unwrap()));
        assert!(!is_public_internet_ip("fec0::1".parse().unwrap()));
        assert!(!is_public_internet_ip("2001:db8::1".parse().unwrap()));
        assert!(!is_public_internet_ip("3fff::1".parse().unwrap()));
        assert!(is_public_internet_ip("1.1.1.1".parse().unwrap()));
        assert!(is_public_internet_ip(
            "2606:4700:4700::1111".parse().unwrap()
        ));
    }

    #[tokio::test]
    async fn custom_endpoint_rejects_ip_literals_and_non_dns_hosts_before_network() {
        for base_url in [
            "https://1.1.1.1/v1",
            "https://[2606:4700:4700::1111]/v1",
            "https://localhost/v1",
            "https://host.local/v1",
        ] {
            assert_eq!(
                endpoint_url(&ProviderEndpoint {
                    model_optimization: true,
                    kind: ProviderKind::OpenaiCompatible,
                    base_url: Some(base_url.into()),
                })
                .await,
                Err(ModelError::CustomEndpointRejected)
            );
        }
    }

    #[test]
    fn provider_terminal_and_tool_proposals_are_normalized_without_execution() {
        assert!(provider_terminal(
            ProviderKind::Openai,
            &json!({"type":"response.completed"})
        ));
        assert!(provider_terminal(
            ProviderKind::Anthropic,
            &json!({"type":"message_stop"})
        ));
        assert!(!provider_terminal(
            ProviderKind::OpenaiCompatible,
            &json!({"choices":[]})
        ));
        let anthropic = normalize_provider_event(
            ProviderKind::Anthropic,
            &json!({"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-1","name":"lookup","input":{"q":"x"}}}),
        );
        let openai = normalize_provider_event(
            ProviderKind::Openai,
            &json!({"type":"response.output_item.done","item":{"type":"function_call","call_id":"tool-0","name":"lookup","arguments":"{\"q\":\"x\"}"}}),
        );
        let compatible = normalize_provider_event(
            ProviderKind::OpenaiCompatible,
            &json!({"choices":[{"delta":{"tool_calls":[{"id":"tool-2","function":{"name":"lookup","arguments":"{\"q\":\"x\"}"}}]}}]}),
        );
        for proposal in [openai, anthropic, compatible] {
            assert_eq!(proposal.len(), 1);
            assert_eq!(proposal[0].kind, ModelInvocationEventKind::ToolProposal);
            assert_eq!(proposal[0].tool_proposal.as_ref().unwrap().name, "lookup");
            assert_eq!(
                proposal[0].tool_proposal.as_ref().unwrap().arguments,
                json!({"q":"x"})
            );
        }
    }

    #[test]
    fn official_adapters_reject_catalog_ids_but_custom_compatible_ids_remain_open() {
        for preset in provider_catalog() {
            for model in preset.model_ids {
                for kind in [ProviderKind::Openai, ProviderKind::Anthropic] {
                    assert_eq!(
                        validate_provider_model(kind, &model.to_uppercase()),
                        Err(ModelError::ProviderModelMismatch)
                    );
                }
                assert!(validate_provider_model(ProviderKind::OpenaiCompatible, &model).is_ok());
            }
        }
        assert!(validate_provider_model(ProviderKind::Openai, "gpt-4.1-mini").is_ok());
        assert!(validate_provider_model(ProviderKind::Anthropic, "claude-custom-future").is_ok());
        assert!(
            validate_provider_model(ProviderKind::OpenaiCompatible, "my-private-model").is_ok()
        );
    }

    #[tokio::test]
    async fn wrong_official_protocol_never_sends_credentials_in_text_or_agent_calls() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut client = ModelClient::new().unwrap();
        client.test_url =
            Some(Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap());
        for kind in [ProviderKind::Openai, ProviderKind::Anthropic] {
            let endpoint = ProviderEndpoint {
                kind,
                base_url: None,
                model_optimization: false,
            };
            let request = ModelInvocationRequest {
                invocation_id: fielora_contracts::ModelInvocationId::new("inv"),
                context_package_id: fielora_contracts::ContextPackageId::new("ctx"),
                provider_config_id: fielora_contracts::ProviderConfigId::new("provider"),
                model_id: "Qwen3.7-Plus".into(),
                intent: fielora_contracts::ModelIntent::Ask,
                user_input: "hello".into(),
                context_package: vec![],
                response_mode: fielora_contracts::ResponseMode::Text,
            };
            let result = tokio::time::timeout(
                Duration::from_secs(1),
                client.invoke(
                    endpoint.clone(),
                    request,
                    b"synthetic-only",
                    CancellationToken::new(),
                    |_| panic!("must reject before starting"),
                ),
            )
            .await
            .unwrap();
            assert_eq!(result, Err(ModelError::ProviderModelMismatch));
            let request = AgentModelRequest {
                model_id: "Qwen3.7-Plus".into(),
                system: "test".into(),
                messages: vec![AgentModelMessage::User("hello".into())],
                tools: vec![],
                max_output_tokens: 1024,
            };
            let result = tokio::time::timeout(
                Duration::from_secs(1),
                client.invoke_agent_turn(
                    endpoint,
                    request,
                    b"synthetic-only",
                    CancellationToken::new(),
                    |_| panic!("must not stream"),
                ),
            )
            .await
            .unwrap();
            assert!(matches!(result, Err(ModelError::ProviderModelMismatch)));
        }
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn openai_responses_always_disables_store_and_anthropic_does_not_invent_it() {
        let request = ModelInvocationRequest {
            invocation_id: fielora_contracts::ModelInvocationId::new("inv"),
            context_package_id: fielora_contracts::ContextPackageId::new("ctx"),
            provider_config_id: fielora_contracts::ProviderConfigId::new("provider"),
            model_id: "model".into(),
            intent: fielora_contracts::ModelIntent::Ask,
            user_input: "hello".into(),
            context_package: vec![],
            response_mode: fielora_contracts::ResponseMode::Text,
        };
        assert_eq!(
            provider_body(&test_endpoint(ProviderKind::Openai), &request).get("store"),
            Some(&Value::Bool(false))
        );
        assert!(
            provider_body(&test_endpoint(ProviderKind::Anthropic), &request)
                .get("store")
                .is_none()
        );
        assert_eq!(
            provider_body(&test_endpoint(ProviderKind::OpenaiCompatible), &request)
                .pointer("/stream_options/include_usage"),
            Some(&Value::Bool(true))
        );
        assert_eq!(
            provider_body(&test_endpoint(ProviderKind::OpenaiCompatible), &request)
                .get("max_tokens"),
            Some(&json!(DIRECT_INVOCATION_MAX_OUTPUT_TOKENS))
        );

        let mut qwen_request = request.clone();
        qwen_request.model_id = "qwen3.7-plus".into();
        let qwen_plan = ProviderEndpoint {
            model_optimization: true,
            kind: ProviderKind::OpenaiCompatible,
            base_url: Some("https://coding.dashscope.aliyuncs.com/v1".into()),
        };
        assert_eq!(
            provider_body(&qwen_plan, &qwen_request).get("enable_thinking"),
            None
        );
        assert!(
            provider_body(
                &test_endpoint(ProviderKind::OpenaiCompatible),
                &qwen_request
            )
            .get("enable_thinking")
            .is_none()
        );
    }

    #[test]
    fn representative_http_and_stream_failures_have_stable_error_mapping() {
        assert_eq!(
            map_status(StatusCode::UNAUTHORIZED),
            Err(ModelError::CredentialRejected)
        );
        assert_eq!(
            map_status(StatusCode::NOT_FOUND),
            Err(ModelError::ModelNotAvailable)
        );
        assert_eq!(
            map_status(StatusCode::TOO_MANY_REQUESTS),
            Err(ModelError::ProviderRateLimited)
        );
        assert_eq!(
            map_status(StatusCode::BAD_GATEWAY),
            Err(ModelError::ProviderUnavailable)
        );
        assert_eq!(
            map_status(StatusCode::BAD_REQUEST),
            Err(ModelError::ProviderRequestRejected(400))
        );
        assert!(provider_failure(
            ProviderKind::Openai,
            &json!({"type":"response.failed"})
        ));
        assert!(provider_failure(
            ProviderKind::Anthropic,
            &json!({"type":"error"})
        ));
        assert!(provider_failure(
            ProviderKind::OpenaiCompatible,
            &json!({"error":{"message":"redacted"}})
        ));
    }

    #[test]
    fn fragmented_native_tool_calls_converge_to_the_same_agent_turn() {
        let mut openai = AgentStreamAccumulator::new(ProviderKind::Openai);
        openai.push(&json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"read_file","arguments":""}})).unwrap();
        openai.push(&json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\"path\":\"src/"})).unwrap();
        openai.push(&json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":"lib.rs\"}"})).unwrap();
        openai.push(&json!({"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":2}}})).unwrap();

        let mut anthropic = AgentStreamAccumulator::new(ProviderKind::Anthropic);
        anthropic.push(&json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"read_file","input":{}}})).unwrap();
        anthropic.push(&json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"src/"}})).unwrap();
        anthropic.push(&json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"lib.rs\"}"}})).unwrap();
        anthropic.push(&json!({"type":"message_stop"})).unwrap();

        let mut compatible = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
        compatible.push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\"path\":\"src/"}}]},"finish_reason":null}]})).unwrap();
        compatible.push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"lib.rs\"}"}}]},"finish_reason":"tool_calls"}]})).unwrap();

        for turn in [
            openai.finish().unwrap(),
            anthropic.finish().unwrap(),
            compatible.finish().unwrap(),
        ] {
            assert_eq!(turn.tool_calls.len(), 1);
            assert_eq!(turn.tool_calls[0].id, "call-1");
            assert_eq!(turn.tool_calls[0].name, "read_file");
            assert_eq!(turn.tool_calls[0].arguments, json!({"path":"src/lib.rs"}));
        }
    }

    #[test]
    fn public_text_with_tool_calls_is_visible_for_every_provider_while_private_reasoning_is_excluded()
     {
        let fixtures = [
            (
                ProviderKind::Openai,
                vec![
                    json!({"type":"response.reasoning_summary_text.delta","delta":"private reasoning_content"}),
                    json!({"type":"response.output_text.delta","delta":"<thi"}),
                    json!({"type":"response.output_text.delta","delta":"nk>private</think>我先确认相关实现。"}),
                    json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"read_file","arguments":"{\"path\":\"src/lib.rs\"}"}}),
                    json!({"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":2}}}),
                ],
            ),
            (
                ProviderKind::Anthropic,
                vec![
                    json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"private reasoning_content"}}),
                    json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"<think>private</think>我先确认相关实现。"}}),
                    json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"read_file","input":{"path":"src/lib.rs"}}}),
                    json!({"type":"message_stop"}),
                ],
            ),
            (
                ProviderKind::OpenaiCompatible,
                vec![
                    json!({"choices":[{"delta":{"reasoning_content":"private reasoning_content"},"finish_reason":null}]}),
                    json!({"choices":[{"delta":{"content":"<think>private</think>我先确认相关实现。"},"finish_reason":null}]}),
                    json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\"path\":\"src/lib.rs\"}"}}]},"finish_reason":"tool_calls"}]}),
                ],
            ),
        ];

        for (kind, values) in fixtures {
            let mut accumulator = AgentStreamAccumulator::new(kind);
            let mut live = String::new();
            for value in values {
                for delta in accumulator.push(&value).unwrap() {
                    live.push_str(&delta);
                }
            }
            live.push_str(&accumulator.flush_visible_text());
            let turn = accumulator.finish().unwrap();
            assert_eq!(live, "我先确认相关实现。");
            assert_eq!(turn.text, "我先确认相关实现。");
            assert_eq!(turn.tool_calls.len(), 1);
            assert_eq!(turn.tool_calls[0].name, "read_file");
            assert!(!format!("{live}{}", turn.text).contains("private"));
            assert!(!format!("{live}{}", turn.text).contains("<think>"));
        }
    }

    #[test]
    fn qwen_compatible_tool_identifiers_accept_deltas_snapshots_and_repeats() {
        let mut compatible = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
        compatible
            .push(&json!({"choices":[{"delta":{"reasoning_content":"I should inspect first."},"finish_reason":null}]}))
            .unwrap();
        compatible
            .push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_","function":{"name":"read","arguments":"{\"path\":\"src/"}}]},"finish_reason":null}]}))
            .unwrap();
        compatible
            .push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"_file","arguments":"lib.rs\"}"}}]},"finish_reason":null}]}))
            .unwrap();
        compatible
            .push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{}}]},"finish_reason":"tool_calls"}]}))
            .unwrap();

        let turn = compatible.finish().unwrap();
        assert_eq!(turn.text, "");
        assert_eq!(turn.tool_calls[0].id, "call_abc");
        assert_eq!(turn.tool_calls[0].name, "read_file");
        assert_eq!(turn.tool_calls[0].arguments, json!({"path":"src/lib.rs"}));
    }

    #[test]
    fn hidden_reasoning_is_removed_after_fragmented_stream_assembly() {
        let assembled = ["<thi", "nk>private plan", "</think>", "最终答案"].concat();
        assert_eq!(sanitize_agent_text(&assembled), "最终答案");
        assert_eq!(sanitize_agent_text("前言<think>private"), "前言");
        assert_eq!(
            sanitize_agent_text("private plan</think>最终答案"),
            "最终答案"
        );
        assert_eq!(
            sanitize_agent_text("答案一<think data-x='1'>private</think>\n答案二"),
            "答案一\n答案二"
        );
        assert_eq!(sanitize_agent_text("普通回答"), "普通回答");
    }

    #[test]
    fn compatible_success_chunk_with_null_error_is_not_a_failure() {
        assert!(!provider_failure(
            ProviderKind::OpenaiCompatible,
            &json!({"error":null,"choices":[{"delta":{"content":"ok"}}]})
        ));
    }

    #[test]
    fn agent_provider_bodies_preserve_tools_results_and_retention_boundary() {
        let request = AgentModelRequest {
            model_id: "model".into(),
            system: "Work carefully".into(),
            messages: vec![
                AgentModelMessage::User("Inspect".into()),
                AgentModelMessage::Assistant {
                    continuation: None,
                    text: String::new(),
                    tool_calls: vec![AgentModelToolCall {
                        id: "call-1".into(),
                        name: "read_file".into(),
                        arguments: json!({"path":"src/lib.rs"}),
                    }],
                },
                AgentModelMessage::ToolResult {
                    call_id: "call-1".into(),
                    name: "read_file".into(),
                    content: "contents".into(),
                    is_error: false,
                },
            ],
            tools: vec![ModelToolDefinition {
                name: "read_file".into(),
                description: "Read a project file".into(),
                input_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}),
            }],
            max_output_tokens: 1024,
        };
        let openai = agent_provider_body(&test_endpoint(ProviderKind::Openai), &request);
        assert_eq!(openai.get("store"), Some(&Value::Bool(false)));
        assert_eq!(
            openai.pointer("/input/2/type"),
            Some(&json!("function_call_output"))
        );
        assert_eq!(openai.pointer("/tools/0/name"), Some(&json!("read_file")));
        let anthropic = agent_provider_body(&test_endpoint(ProviderKind::Anthropic), &request);
        assert_eq!(
            anthropic.pointer("/messages/2/content/0/type"),
            Some(&json!("tool_result"))
        );
        assert!(anthropic.get("store").is_none());
        let compatible =
            agent_provider_body(&test_endpoint(ProviderKind::OpenaiCompatible), &request);
        assert_eq!(compatible.pointer("/messages/3/role"), Some(&json!("tool")));
        assert_eq!(
            compatible.pointer("/tools/0/type"),
            Some(&json!("function"))
        );
        assert!(compatible.get("parallel_tool_calls").is_none());

        let mut minimax_request = request.clone();
        minimax_request.model_id = "MiniMax-M2.7".into();
        let minimax = agent_provider_body(
            &ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some("https://api.minimaxi.com/v1".into()),
            },
            &minimax_request,
        );
        assert_eq!(minimax.get("max_completion_tokens"), Some(&json!(1024)));
        assert!(minimax.get("max_tokens").is_none());
        assert!(minimax.get("stream_options").is_none());

        let mut qwen_request = request.clone();
        qwen_request.model_id = "qwen3.7-plus".into();
        let qwen_plan = agent_provider_body(
            &ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some("https://coding.dashscope.aliyuncs.com/v1".into()),
            },
            &qwen_request,
        );
        assert!(qwen_plan.get("enable_thinking").is_none());
        assert_eq!(
            qwen_plan.get("parallel_tool_calls"),
            Some(&Value::Bool(false))
        );
        assert_eq!(qwen_plan.get("max_tokens"), Some(&json!(1024)));
    }

    #[test]
    fn qwen_coding_plan_serializes_images_as_native_multimodal_content_parts() {
        let request = AgentModelRequest {
            model_id: "qwen3.7-plus".into(),
            system: "Describe the supplied image".into(),
            messages: vec![AgentModelMessage::UserMultimodal {
                text: "说明这张图里显示了什么".into(),
                images: vec![AgentModelImage {
                    id: "image-1".into(),
                    filename: "screen.png".into(),
                    mime_type: "image/png".into(),
                    data_url: "data:image/png;base64,iVBORw0KGgo=".into(),
                }],
            }],
            tools: Vec::new(),
            max_output_tokens: 512,
        };
        let body = agent_provider_body(
            &ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some("https://coding.dashscope.aliyuncs.com/v1".into()),
            },
            &request,
        );
        assert_eq!(
            body.pointer("/messages/1/content/0"),
            Some(&json!({"type":"text","text":"说明这张图里显示了什么"}))
        );
        assert_eq!(
            body.pointer("/messages/1/content/1/type"),
            Some(&json!("image_url"))
        );
        assert_eq!(
            body.pointer("/messages/1/content/1/image_url/url"),
            Some(&json!("data:image/png;base64,iVBORw0KGgo="))
        );
        assert!(!body.to_string().contains("附件：screen.png"));
        let mut follow_up = request.clone();
        follow_up.messages.insert(
            0,
            AgentModelMessage::Assistant {
                continuation: None,
                text: "Previous result".into(),
                tool_calls: vec![],
            },
        );
        let follow_up = agent_provider_body(
            &ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some("https://coding.dashscope.aliyuncs.com/v1".into()),
            },
            &follow_up,
        );
        assert_eq!(
            follow_up.pointer("/messages/1/content"),
            Some(&json!("Previous result"))
        );
        assert!(follow_up.pointer("/messages/1/tool_calls").is_none());
        assert!(
            follow_up
                .pointer("/messages/2/content/1/image_url/url")
                .is_some()
        );
        assert!(follow_up.get("tools").is_none());
        assert!(follow_up.get("tool_choice").is_none());
    }

    #[test]
    fn rejected_request_classification_never_retains_provider_text() {
        let error = classify_rejection(400, br#"{"error":{"message":"messages tool_calls must not be empty; secret-prompt-and-token"}}"#);
        assert_eq!(error.code(), "PROVIDER_INVALID_MESSAGES");
        assert_eq!(error.http_status(), Some(400));
        assert!(!format!("{error:?}").contains("secret-prompt"));
        assert_eq!(
            classify_rejection(400, br#"{"error":{"message":"unsupported image format"}}"#).code(),
            "PROVIDER_IMAGE_REJECTED"
        );
        assert_eq!(
            classify_rejection(413, b"not json").code(),
            "PROVIDER_CONTEXT_LIMIT"
        );
        assert_eq!(
            classify_rejection(400, br#"{"message":"unknown rejection"}"#),
            ModelError::ProviderRequestRejected(400)
        );
    }

    #[test]
    fn incomplete_tool_json_never_becomes_a_tool_intent() {
        let mut accumulator = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
        accumulator.push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"read_file","arguments":"{\"path\":"}}]},"finish_reason":"tool_calls"}]})).unwrap();
        assert_eq!(accumulator.finish(), Err(ModelError::ProviderProtocolError));
    }

    #[test]
    fn china_coding_profiles_cover_the_six_initial_model_families() {
        let endpoint = |base_url: &str| ProviderEndpoint {
            model_optimization: true,
            kind: ProviderKind::OpenaiCompatible,
            base_url: Some(base_url.into()),
        };
        for (base_url, model, family) in [
            (
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "qwen3.7-plus",
                CodingModelFamily::Qwen,
            ),
            (
                "https://api.deepseek.com/v1",
                "deepseek-flash",
                CodingModelFamily::DeepSeek,
            ),
            (
                "https://api.moonshot.cn/v1",
                "kimi-k3",
                CodingModelFamily::Kimi,
            ),
            (
                "https://open.bigmodel.cn/api/paas/v4",
                "glm-4.7",
                CodingModelFamily::Glm,
            ),
            (
                "https://api.minimax.io/v1",
                "MiniMax-M2.5",
                CodingModelFamily::MiniMax,
            ),
            (
                "https://ark.cn-beijing.volces.com/api/v3",
                "doubao-seed-2-0-code-preview-260215",
                CodingModelFamily::Doubao,
            ),
        ] {
            let profile = coding_behavior_profile(&endpoint(base_url), model);
            assert_eq!(profile.id, "china-coding-v1");
            assert_eq!(profile.family, family);
            assert!(profile.chinese_primary);
            assert!(profile.prefer_serial_tool_calls);
            assert!(profile.nudge_action_tasks);
            assert!(profile.system_guidance().contains("严格符合 schema"));
        }
    }

    #[test]
    fn unknown_models_fail_safe_to_generic_behavior_without_new_authority() {
        let profile = coding_behavior_profile(
            &ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some("https://models.example.com/v1".into()),
            },
            "future-code-model",
        );
        assert_eq!(profile.family, CodingModelFamily::Generic);
        assert_eq!(profile.id, "generic-coding-v1");
        assert!(!profile.chinese_primary);
        assert!(!profile.nudge_action_tasks);
        assert!(profile.system_guidance().is_empty());

        // Ark can route several model families; endpoint alone must not label a model Doubao.
        let routed = coding_behavior_profile(
            &ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some("https://ark.cn-beijing.volces.com/api/v3".into()),
            },
            "ark-code-latest",
        );
        assert_eq!(routed.family, CodingModelFamily::Generic);
    }
}
