//! Deterministic desktop fixture, enabled only by the two explicit E2E flags.
use fielora_agent::web::{
    EXA_SEARCH_PROVIDER_ID, FetchedWebPage, SearchBackend, SearchBackendResponse,
    SearchBackendResult, WebFailure, WebFetcher, WebSearchRequest, WebToolProvider,
};
use fielora_agent::{CommandCancellation, StaticCredentialRequirement};
use fielora_contracts::{AgentRunView, AgentToolCallView, AgentToolStatus};
use fielora_model::{
    AgentModelMessage, AgentModelRequest, AgentModelToolCall, AgentModelTurn, ModelError,
};
use fielora_platform::SecretBytes;
use serde_json::json;
use std::sync::Arc;

pub fn enabled() -> bool {
    std::env::var("FIELORA_E2E").as_deref() == Ok("1")
        && std::env::var("FIELORA_WEB_SEARCH_FIXTURE").as_deref() == Ok("1")
}
pub fn provider(keyed: bool) -> WebToolProvider {
    WebToolProvider::new(
        Arc::new(Search {
            keyed,
            brave: false,
        }),
        Arc::new(Fetch),
    )
}
pub fn brave_provider() -> WebToolProvider {
    WebToolProvider::new(
        Arc::new(Search {
            keyed: true,
            brave: true,
        }),
        Arc::new(Fetch),
    )
}
struct Search {
    keyed: bool,
    brave: bool,
}
impl SearchBackend for Search {
    fn provider_id(&self) -> &'static str {
        if self.brave {
            "fixture.brave.search.v1"
        } else {
            "fixture.exa.search.v1"
        }
    }
    fn required_static_credential(&self) -> Option<StaticCredentialRequirement> {
        self.keyed.then(|| {
            if self.brave {
                StaticCredentialRequirement::new(
                    fielora_agent::web::BRAVE_SEARCH_PROVIDER_ID,
                    "subscription_token",
                )
                .unwrap()
            } else {
                StaticCredentialRequirement::new(EXA_SEARCH_PROVIDER_ID, "api_key").unwrap()
            }
        })
    }
    fn search(
        &self,
        request: &WebSearchRequest,
        cancellation: &CommandCancellation,
    ) -> Result<SearchBackendResponse, WebFailure> {
        self.search_with_static_credential(request, None, cancellation)
    }
    fn search_with_static_credential(
        &self,
        request: &WebSearchRequest,
        credential: Option<SecretBytes>,
        cancellation: &CommandCancellation,
    ) -> Result<SearchBackendResponse, WebFailure> {
        if cancellation.is_cancelled() {
            return Err(WebFailure::Cancelled);
        }
        if request.query == "Rust programming language official documentation" {
            // Exercise responsive FIPC and overlapping settings tests without
            // any external service or credentials.
            for _ in 0..25 {
                if cancellation.is_cancelled() {
                    return Err(WebFailure::Cancelled);
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
        if self.keyed
            && credential.as_ref().is_none_or(|s| {
                s.expose()
                    != if self.brave {
                        b"synthetic-brave-valid".as_slice()
                    } else {
                        b"synthetic-exa-valid".as_slice()
                    }
            })
        {
            return Err(WebFailure::CredentialRejected);
        }
        if request.query.contains("rate-limit") {
            return Err(WebFailure::RateLimited);
        }
        let detail = request.query.contains("export formats");
        Ok(SearchBackendResponse {
            results: vec![SearchBackendResult {
                title: if detail {
                    "Export formats fixture"
                } else {
                    "Workshop tool fixture"
                }
                .into(),
                url: format!(
                    "https://example.com/{}",
                    if detail {
                        "export-formats"
                    } else {
                        "workshop-tools"
                    }
                ),
                snippet: if detail {
                    "SOURCE_DETAIL: export formats are documented."
                } else {
                    "SOURCE_DISCOVERY: inspect the workshop tool source."
                }
                .into(),
                published_at: Some("2026-10-11".into()),
            }],
        })
    }
}
struct Fetch;
impl WebFetcher for Fetch {
    fn fetch(
        &self,
        url: &str,
        cancellation: &CommandCancellation,
    ) -> Result<FetchedWebPage, WebFailure> {
        if cancellation.is_cancelled() {
            return Err(WebFailure::Cancelled);
        }
        let text = match url {
            "https://example.com/workshop-tools" => {
                "SOURCE_BODY: Find the missing comparison detail by searching workshop export formats."
            }
            "https://example.com/export-formats" => {
                "SOURCE_EXPORT_BODY: CSV and JSON export supported in this synthetic fixture."
            }
            _ => return Err(WebFailure::DestinationRejected),
        };
        Ok(FetchedWebPage {
            requested_url: url.into(),
            final_url: url.into(),
            title: Some("Synthetic research source".into()),
            content_type: "text/plain".into(),
            text: text.into(),
            status: 200,
            retrieved_at: crate::now_ms(),
            truncated: false,
            dynamic_content_unavailable: false,
        })
    }
}

pub fn model(
    request: &AgentModelRequest,
    run: &AgentRunView,
    facts: &[AgentToolCallView],
) -> Result<AgentModelTurn, ModelError> {
    if !enabled()
        || !["web.search", "web.fetch"]
            .iter()
            .all(|name| request.tools.iter().any(|d| d.name == *name))
    {
        return Err(ModelError::ProviderProtocolError);
    }
    let visible = request
        .messages
        .iter()
        .map(|m| match m {
            AgentModelMessage::User(t) | AgentModelMessage::ToolResult { content: t, .. } => {
                t.as_str()
            }
            _ => "",
        })
        .collect::<Vec<_>>()
        .join("\n");
    let (name, args) = match facts.len() {
        0 => (
            "web.search",
            json!({"query":"workshop scheduling tools","count":2}),
        ),
        1 => {
            if !visible.contains("SOURCE_DISCOVERY")
                || !visible.contains("https://example.com/workshop-tools")
            {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "web.fetch",
                json!({"url":"https://example.com/workshop-tools"}),
            )
        }
        2 => {
            if !visible.contains("SOURCE_BODY") || !visible.contains("export formats") {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "web.search",
                json!({"query":"workshop export formats","count":2,"published_after":"2026-10-01","domains":["example.com"]}),
            )
        }
        3 => {
            if !visible.contains("https://example.com/export-formats") {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "web.fetch",
                json!({"url":"https://example.com/export-formats"}),
            )
        }
        _ => {
            if !visible.contains("SOURCE_EXPORT_BODY") {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "finish_task",
                json!({"outcome":"completed","remaining_work":[],"required_evidence":[],"intent":"answer_only","request_quote":run.task,"summary":"根据实际读取的测试来源，工具支持 CSV 和 JSON 导出。[工具来源](https://example.com/workshop-tools) · [导出资料](https://example.com/export-formats)。此为确定性测试资料。","evidence_tool_call_ids":facts.iter().filter(|t|t.status==AgentToolStatus::Completed).map(|t|t.id.0.clone()).collect::<Vec<_>>()}),
            )
        }
    };
    Ok(AgentModelTurn {
        text: String::new(),
        continuation: None,
        usage: None,
        tool_calls: vec![AgentModelToolCall {
            id: format!("web-fixture-{}", facts.len()),
            name: name.into(),
            arguments: args,
        }],
    })
}
