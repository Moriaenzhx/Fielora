//! Explicit E2E model substitute. Never changes production endpoint policy.
//! Only selected request evidence is sent to a bounded IPv4-loopback fixture.
use fielora_model::{
    AgentModelMessage, AgentModelRequest, AgentModelToolCall, AgentModelTurn, ModelError,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const MODEL: &str = "__fielora_agent_fixture_computer_visual__";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

fn fixture_url(value: &str) -> Result<reqwest::Url, ModelError> {
    let url = reqwest::Url::parse(value).map_err(|_| ModelError::CustomEndpointRejected)?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1")
        || url.port().is_none() || !url.username().is_empty() || url.password().is_some()
        || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
        // URL parsers normalize alternative IPv4 syntax. Require the literal
        // loopback authority in the configured value as well.
        || !value.starts_with("http://127.0.0.1:")
    {
        return Err(ModelError::CustomEndpointRejected);
    }
    Ok(url)
}

fn projection(request: &AgentModelRequest) -> Value {
    let images = request.messages.iter().flat_map(|message| match message {
        AgentModelMessage::UserMultimodal { images, .. } => images.iter().map(|image| json!({"id":image.id,"filename":image.filename,"mime_type":image.mime_type,"data_url":image.data_url})).collect::<Vec<_>>(),
        _ => vec![],
    }).collect::<Vec<_>>();
    let tool_results = request
        .messages
        .iter()
        .filter_map(|message| match message {
            AgentModelMessage::ToolResult {
                call_id,
                name,
                content,
                is_error,
            } => Some(json!({"call_id":call_id,"name":name,"content":content,"is_error":is_error})),
            _ => None,
        })
        .collect::<Vec<_>>();
    json!({"images":images,"tool_results":tool_results,"tools":request.tools})
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    #[serde(default)]
    text: String,
    #[serde(default)]
    tool_calls: Vec<Call>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Call {
    id: String,
    name: String,
    arguments: Value,
}

fn decode(bytes: &[u8]) -> Result<AgentModelTurn, ModelError> {
    let reply: Reply =
        serde_json::from_slice(bytes).map_err(|_| ModelError::ProviderProtocolError)?;
    if reply.text.len() > 64 * 1024
        || reply.tool_calls.len() > 16
        || reply.tool_calls.iter().any(|call| {
            call.id.is_empty()
                || call.id.len() > 256
                || call.name.is_empty()
                || call.name.len() > 256
                || !call.arguments.is_object()
                || call.arguments.to_string().len() > 64 * 1024
        })
    {
        return Err(ModelError::ProviderProtocolError);
    }
    Ok(AgentModelTurn {
        text: reply.text,
        tool_calls: reply
            .tool_calls
            .into_iter()
            .map(|call| AgentModelToolCall {
                id: call.id,
                name: call.name,
                arguments: call.arguments,
            })
            .collect(),
        usage: None,
        continuation: None,
    })
}

pub async fn model(
    request: &AgentModelRequest,
    cancellation: &CancellationToken,
) -> Result<AgentModelTurn, ModelError> {
    if std::env::var("FIELORA_E2E").as_deref() != Ok("1") || request.model_id != MODEL {
        return Err(ModelError::CustomEndpointRejected);
    }
    let url = fixture_url(
        &std::env::var("FIELORA_AGENT_COMPUTER_VISUAL_FIXTURE_URL")
            .map_err(|_| ModelError::CustomEndpointRejected)?,
    )?;
    let body =
        serde_json::to_vec(&projection(request)).map_err(|_| ModelError::ProviderProtocolError)?;
    if body.len() > 24 * 1024 * 1024 {
        return Err(ModelError::ContextTooLarge);
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| ModelError::ProviderUnavailable)?;
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(ModelError::InvocationCancelled),
        result = async {
            let mut response = client.post(url).header("content-type", "application/json").body(body).send().await.map_err(|_| ModelError::ProviderUnavailable)?;
            if response.status() != reqwest::StatusCode::OK { return Err(ModelError::ProviderUnavailable); }
            if response.content_length().is_some_and(|n| n > MAX_RESPONSE_BYTES as u64) { return Err(ModelError::ProviderResponseTooLarge); }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| ModelError::ProviderUnavailable)? {
                if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES { return Err(ModelError::ProviderResponseTooLarge); }
                bytes.extend_from_slice(&chunk);
            }
            decode(&bytes)
        } => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_endpoint_is_exact_loopback_and_reply_is_bounded() {
        assert!(fixture_url("http://127.0.0.1:39491/").is_ok());
        for url in [
            "https://127.0.0.1:39491/",
            "http://localhost:39491/",
            "http://127.1:39491/",
            "http://2130706433:39491/",
            "http://127.0.0.1/",
            "http://127.0.0.1:39491/path",
            "http://127.0.0.1:39491/?secret=1",
            "http://user@127.0.0.1:39491/",
        ] {
            assert!(fixture_url(url).is_err(), "{url}");
        }
        assert_eq!(decode(br#"{"text":"fixture","tool_calls":[{"id":"one","name":"computer","arguments":{"action":"screenshot"}}]}"#).unwrap().tool_calls[0].name, "computer");
        assert!(decode(br#"{"text":"fixture","tool_calls":[],"session":{}}"#).is_err());
        assert!(
            decode(br#"{"tool_calls":[{"id":"one","name":"computer","arguments":"opaque"}]}"#)
                .is_err()
        );
    }

    #[test]
    fn fixture_projection_excludes_system_user_task_and_assistant_state() {
        let request = AgentModelRequest {
            model_id: MODEL.into(),
            system: "private system".into(),
            messages: vec![
                AgentModelMessage::User("private user task".into()),
                AgentModelMessage::Assistant {
                    text: "private assistant state".into(),
                    tool_calls: vec![],
                    continuation: None,
                },
                AgentModelMessage::ToolResult {
                    call_id: "tool".into(),
                    name: "computer".into(),
                    content: "authorized receipt".into(),
                    is_error: false,
                },
            ],
            tools: vec![],
            max_output_tokens: 32,
        };
        assert_eq!(
            projection(&request),
            json!({"images":[],"tool_results":[{"call_id":"tool","name":"computer","content":"authorized receipt","is_error":false}],"tools":[]})
        );
        assert!(!projection(&request).to_string().contains("private"));
    }
}
