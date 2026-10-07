//! Content-free response diagnostics. Never retain provider text, reasoning,
//! tool names/arguments, headers, request IDs or arbitrary error strings here.
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResponseFailure {
    InvalidEvent,
    InterruptedStream,
    MissingTerminal,
    ProviderError,
    InvalidToolCall,
    EmptyResponse,
    OutputLimit,
    ContentFiltered,
}

impl ResponseFailure {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidEvent => "PROVIDER_INVALID_RESPONSE",
            Self::InterruptedStream => "PROVIDER_STREAM_INTERRUPTED",
            Self::MissingTerminal => "PROVIDER_STREAM_INCOMPLETE",
            Self::ProviderError => "PROVIDER_STREAM_ERROR",
            Self::InvalidToolCall => "PROVIDER_INVALID_TOOL_CALL",
            Self::EmptyResponse => "PROVIDER_EMPTY_RESPONSE",
            Self::OutputLimit => "PROVIDER_OUTPUT_LIMIT",
            Self::ContentFiltered => "PROVIDER_CONTENT_FILTERED",
        }
    }

    pub fn retryable(self) -> bool {
        // Repeating a known length/content limit with identical parameters
        // cannot repair it. Never silently increase the user's token budget.
        !matches!(self, Self::OutputLimit | Self::ContentFiltered)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FinishReason {
    Stop,
    ToolCalls,
    OutputLimit,
    ContentFiltered,
    Other,
}

impl FinishReason {
    pub fn from_wire(value: &str) -> Self {
        match value {
            "stop" | "end_turn" | "stop_sequence" | "completed" => Self::Stop,
            "tool_calls" | "tool_use" => Self::ToolCalls,
            "length" | "max_tokens" | "max_output_tokens" => Self::OutputLimit,
            "content_filter" | "refusal" => Self::ContentFiltered,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ResponseDiagnostics {
    pub http_status: Option<u16>,
    pub event_count: usize,
    pub finish_reason: Option<FinishReason>,
    pub text_bytes: usize,
    pub private_bytes: usize,
    pub tool_call_count: usize,
    pub tool_argument_bytes: usize,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub failure_stage: Option<ResponseFailureStage>,
    pub argument_json_error: Option<ArgumentJsonError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResponseFailureStage {
    StreamEncoding,
    EventJson,
    EventShape,
    ToolCallIndex,
    ToolCallId,
    ToolCallName,
    ToolCallArguments,
    ToolCallMissing,
    ToolArgumentsJson,
    ToolArgumentsObject,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ArgumentJsonError {
    pub category: ArgumentJsonCategory,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArgumentJsonCategory {
    Eof,
    Syntax,
    Data,
    Io,
}

impl From<&serde_json::Error> for ArgumentJsonError {
    fn from(error: &serde_json::Error) -> Self {
        Self {
            category: match error.classify() {
                serde_json::error::Category::Eof => ArgumentJsonCategory::Eof,
                serde_json::error::Category::Syntax => ArgumentJsonCategory::Syntax,
                serde_json::error::Category::Data => ArgumentJsonCategory::Data,
                serde_json::error::Category::Io => ArgumentJsonCategory::Io,
            },
            line: error.line(),
            column: error.column(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AgentModelMessage, AgentModelRequest, AgentStreamAccumulator, ModelClient, ProviderEndpoint,
    };
    use fielora_contracts::ProviderKind;
    use serde_json::json;

    #[test]
    fn completed_invalid_calls_report_precise_content_free_diagnostics() {
        for (id, name, arguments, stage, category) in [
            (
                "",
                "create_file",
                "{}",
                ResponseFailureStage::ToolCallId,
                None,
            ),
            ("call", "", "{}", ResponseFailureStage::ToolCallName, None),
            (
                "call",
                "create_file",
                "[]",
                ResponseFailureStage::ToolArgumentsObject,
                None,
            ),
            (
                "call",
                "create_file",
                r#"{"content":"private-value"#,
                ResponseFailureStage::ToolArgumentsJson,
                Some(ArgumentJsonCategory::Eof),
            ),
            (
                "call",
                "create_file",
                "{\"content\":\"private-value\nnot-escaped\"}",
                ResponseFailureStage::ToolArgumentsJson,
                Some(ArgumentJsonCategory::Syntax),
            ),
        ] {
            let mut stream = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
            // A valid sibling must also be withheld when any call is invalid.
            stream.push(&json!({"choices":[{"delta":{"tool_calls":[
                {"index":0,"id":"valid","function":{"name":"create_file","arguments":"{\"path\":\"do-not-write\"}"}},
                {"index":1,"id":id,"function":{"name":name,"arguments":arguments}}
            ]},"finish_reason":"tool_calls"}]})).unwrap();
            let error = stream.finish().unwrap_err();
            assert_eq!(error.code(), "PROVIDER_INVALID_TOOL_CALL");
            let diagnostics = error.response_diagnostics().unwrap();
            assert_eq!(diagnostics.failure_stage, Some(stage));
            assert_eq!(
                diagnostics.argument_json_error.as_ref().map(|e| e.category),
                category
            );
            if let Some(detail) = &diagnostics.argument_json_error {
                assert!(detail.line > 0);
            }
            assert!(
                !serde_json::to_string(diagnostics)
                    .unwrap()
                    .contains("private-value")
            );
            assert!(!format!("{error:?}").contains("do-not-write"));
        }
    }

    #[test]
    fn invalid_tool_delta_reports_only_the_field_stage() {
        for (pointer, invalid, stage) in [
            ("/index", json!(null), ResponseFailureStage::ToolCallIndex),
            (
                "/id",
                json!(["private-id"]),
                ResponseFailureStage::ToolCallId,
            ),
            (
                "/function/name",
                json!({"private-name":true}),
                ResponseFailureStage::ToolCallName,
            ),
            (
                "/function/arguments",
                json!({"private-path":"private-content"}),
                ResponseFailureStage::ToolCallArguments,
            ),
        ] {
            let mut stream = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
            stream.push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"private-id","function":{"name":"private-name","arguments":"{"}}]}}]})).unwrap();
            let mut delta = json!({"index":0,"id":null,"function":{"name":null,"arguments":null}});
            *delta.pointer_mut(pointer).unwrap() = invalid;
            let error = stream
                .push(&json!({"choices":[{"delta":{"tool_calls":[delta]}}]}))
                .unwrap_err();
            assert_eq!(error.code(), "PROVIDER_INVALID_RESPONSE");
            let diagnostics = error.response_diagnostics().unwrap();
            assert_eq!(diagnostics.failure_stage, Some(stage));
            assert_eq!(diagnostics.tool_call_count, 1);
            let saved = serde_json::to_string(diagnostics).unwrap();
            assert!(!saved.contains("private-"));
            assert!(!format!("{error:?}").contains("private-"));
        }
    }

    #[test]
    fn truncated_turn_never_returns_even_a_complete_tool_from_the_same_batch() {
        for arguments in [
            r#"{"path":"private-project"}"#,
            r#"{"path":"private-project"#,
        ] {
            let mut stream = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
            stream.push(&json!({"choices":[{"delta":{"reasoning_content":"private-thought","tool_calls":[
                {"index":0,"id":"a","function":{"name":"write_file","arguments":r#"{"path":"a.txt","content":"private-content"}"#}},
                {"index":1,"id":"b","function":{"name":"read_file","arguments":arguments}}
            ]},"finish_reason":"length"}],"usage":{"prompt_tokens":120,"completion_tokens":4096}})).unwrap();
            let error = stream.finish().unwrap_err();
            assert_eq!(error.code(), "PROVIDER_OUTPUT_LIMIT");
            let diagnostics = error.response_diagnostics().unwrap();
            assert_eq!(diagnostics.tool_call_count, 2);
            assert_eq!(diagnostics.output_tokens, Some(4096));
            assert_eq!(diagnostics.finish_reason, Some(FinishReason::OutputLimit));
            let saved = serde_json::to_string(diagnostics).unwrap();
            for private in [
                "private-thought",
                "private-project",
                "private-content",
                "write_file",
                "a.txt",
            ] {
                assert!(!saved.contains(private));
                assert!(!format!("{error:?}").contains(private));
            }
        }
    }

    #[test]
    fn all_protocols_preserve_output_limit_and_do_not_retry_identical_budget() {
        for (kind, events) in [
            (
                ProviderKind::Openai,
                vec![
                    json!({"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":10,"output_tokens":4096}}}),
                ],
            ),
            (
                ProviderKind::Anthropic,
                vec![
                    json!({"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":4096}}),
                    json!({"type":"message_stop"}),
                ],
            ),
            (
                ProviderKind::OpenaiCompatible,
                vec![
                    json!({"choices":[{"delta":{"reasoning_content":"private"},"finish_reason":"length"}],"usage":{"completion_tokens":4096}}),
                ],
            ),
        ] {
            let mut stream = AgentStreamAccumulator::new(kind);
            for event in events {
                stream.push(&event).unwrap();
            }
            let error = stream.finish().unwrap_err();
            assert_eq!(error.code(), "PROVIDER_OUTPUT_LIMIT");
            assert_eq!(
                error.response_diagnostics().unwrap().output_tokens,
                Some(4096)
            );
        }
        assert!(!ResponseFailure::OutputLimit.retryable());
        assert!(!ResponseFailure::ContentFiltered.retryable());
        assert!(ResponseFailure::MissingTerminal.retryable());
        assert!(ResponseFailure::InvalidToolCall.retryable());
    }

    #[test]
    fn empty_filtered_and_unterminated_streams_are_distinct() {
        for (event, code) in [
            (
                json!({"choices":[{"delta":{"reasoning_content":"private"},"finish_reason":"stop"}]}),
                "PROVIDER_EMPTY_RESPONSE",
            ),
            (
                json!({"choices":[{"delta":{},"finish_reason":"content_filter"}]}),
                "PROVIDER_CONTENT_FILTERED",
            ),
            (
                json!({"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}),
                "PROVIDER_STREAM_INCOMPLETE",
            ),
            (
                json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
                "PROVIDER_INVALID_TOOL_CALL",
            ),
            (
                json!({"choices":[{"delta":{},"finish_reason":"private-reflected-error"}]}),
                "PROVIDER_INVALID_RESPONSE",
            ),
        ] {
            let mut stream = AgentStreamAccumulator::new(ProviderKind::OpenaiCompatible);
            stream.push(&event).unwrap();
            let error = stream.finish().unwrap_err();
            assert_eq!(error.code(), code);
            assert!(!format!("{error:?}").contains("private-reflected-error"));
        }
    }

    // Actual HTTP/SSE through the production adapter, with synthetic data only.
    async fn wire_result(body: &str) -> Result<crate::AgentModelTurn, crate::ModelError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let body = body.to_owned();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let read = socket.read(&mut buffer).await.unwrap();
                assert!(read > 0);
                request.extend_from_slice(&buffer[..read]);
                if let Some(end) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                    let size = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                    if request.len() >= end + 4 + size {
                        break;
                    }
                }
            }
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
            for chunk in body.as_bytes().chunks(13) {
                socket.write_all(chunk).await.unwrap();
            }
        });
        let mut client = ModelClient::new().unwrap();
        client.test_url = Some(reqwest::Url::parse(&url).unwrap());
        let result = client
            .invoke_agent_turn(
                ProviderEndpoint {
                    kind: ProviderKind::OpenaiCompatible,
                    base_url: Some("https://example.com/v1".into()),
                    model_optimization: false,
                },
                AgentModelRequest {
                    model_id: "fixture".into(),
                    system: "synthetic".into(),
                    messages: vec![AgentModelMessage::User("synthetic".into())],
                    tools: vec![],
                    max_output_tokens: 4096,
                },
                b"synthetic-secret",
                tokio_util::sync::CancellationToken::new(),
                |_| {},
            )
            .await;
        server.await.unwrap();
        result
    }

    async fn wire_error(body: &str) -> crate::ModelError {
        let error = wire_result(body).await.unwrap_err();
        assert_eq!(error.http_status(), Some(200));
        assert!(!format!("{error:?}").contains("synthetic-secret"));
        error
    }

    #[tokio::test]
    async fn large_code_arguments_survive_wire_fragmentation_and_bad_json_is_rejected() {
        let content =
            "def example():\n    return {\"路径\": r\"C:\\studio\", \"amount\": 123.45}\n"
                .repeat(320);
        let arguments = json!({"path":"app.py","content":content});
        let encoded = arguments.to_string();
        assert!(encoded.len() > 18_000);
        let mut body = String::new();
        for (index, chunk) in encoded.chars().collect::<Vec<_>>().chunks(37).enumerate() {
            body.push_str(&format!("data: {}\n\n", json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":if index==0 {json!("call")} else {json!(null)},"function":{"name":if index==0 {json!("create_file")} else {json!(null)},"arguments":chunk.iter().collect::<String>()}}]}}]})));
        }
        body.push_str("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n");
        let turn = wire_result(&body).await.unwrap();
        assert_eq!(turn.tool_calls[0].arguments, arguments);
        let bad = json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"create_file","arguments":"{\"content\":\"private-source\ninvalid\"}"}}]},"finish_reason":"tool_calls"}]});
        let error = wire_error(&format!("data: {bad}\n\ndata: [DONE]\n\n")).await;
        assert_eq!(
            error
                .response_diagnostics()
                .unwrap()
                .argument_json_error
                .as_ref()
                .unwrap()
                .category,
            ArgumentJsonCategory::Syntax
        );
        assert!(!format!("{error:?}").contains("private-source"));
    }

    #[tokio::test]
    async fn http_stream_errors_keep_safe_status_and_failure_stage() {
        for (body, code) in [
            (
                "data: not-json-private-payload\n\n",
                "PROVIDER_INVALID_RESPONSE",
            ),
            (
                "data: {\"error\":{\"message\":\"private-reflected-error\"}}\n\n",
                "PROVIDER_STREAM_ERROR",
            ),
            (
                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                "PROVIDER_STREAM_INCOMPLETE",
            ),
            (
                "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private\"},\"finish_reason\":\"length\"}],\"usage\":{\"completion_tokens\":4096}}\n\ndata: [DONE]\n\n",
                "PROVIDER_OUTPUT_LIMIT",
            ),
        ] {
            let error = wire_error(body).await;
            assert_eq!(error.code(), code);
            assert!(!format!("{error:?}").contains("private-reflected-error"));
            assert!(!format!("{error:?}").contains("not-json-private-payload"));
        }
    }
}
