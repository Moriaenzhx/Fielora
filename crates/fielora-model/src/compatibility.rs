use super::*;
use fielora_contracts::{ModelCheckStatus, ModelCompatibilityReport};

impl ModelClient {
    pub async fn check_compatibility(
        &self,
        endpoint: &ProviderEndpoint,
        model: &str,
        secret: &[u8],
        cancel: CancellationToken,
        report: &mut ModelCompatibilityReport,
        marker: &str,
    ) -> Result<(), ModelError> {
        let mut settings = self.settings.clone().unwrap_or_default();
        settings.max_output_tokens = settings.max_output_tokens.min(1024);
        let client = self.clone().with_settings(settings.clone());
        let mut request = AgentModelRequest { model_id:model.into(),system:"Follow the synthetic compatibility test instructions exactly. No real work is being performed.".into(),messages:vec![AgentModelMessage::User(format!("Reply with exactly {marker}."))],tools:vec![],max_output_tokens:settings.max_output_tokens };
        let mut streamed = false;
        let turn = client
            .invoke_agent_turn(
                endpoint.clone(),
                request.clone(),
                secret,
                cancel.clone(),
                |delta| {
                    streamed |= !delta.is_empty();
                },
            )
            .await?;
        if !streamed || !turn.text.contains(marker) || !turn.tool_calls.is_empty() {
            return Err(ModelError::ProviderProtocolError);
        }
        pass(report, 0);
        request.messages = vec![AgentModelMessage::User("Call fielora_compatibility_echo with value FIRST. If it returns an error, retry with value RETRY. When it succeeds, reply with the exact result token. Do not invent a result.".into())];
        request.tools = vec![ModelToolDefinition {
            name: "fielora_compatibility_echo".into(),
            description: "Synthetic no-effect echo; accepts only a value string.".into(),
            input_schema: json!({"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}),
        }];
        for (index, expected) in [(1, "FIRST"), (2, "RETRY")] {
            let turn = client
                .invoke_agent_turn(
                    endpoint.clone(),
                    request.clone(),
                    secret,
                    cancel.clone(),
                    |_| {},
                )
                .await?;
            if turn.tool_calls.len() != 1 {
                return Err(ModelError::ProviderProtocolError);
            }
            let call = &turn.tool_calls[0];
            if call.name != "fielora_compatibility_echo"
                || call.arguments != json!({"value":expected})
            {
                return Err(ModelError::ProviderProtocolError);
            }
            pass(report, index);
            request.messages.push(AgentModelMessage::Assistant {
                text: turn.text.clone(),
                tool_calls: turn.tool_calls.clone(),
                continuation: turn.continuation.clone(),
            });
            request.messages.push(AgentModelMessage::ToolResult {
                call_id: call.id.clone(),
                name: call.name.clone(),
                content: if index == 1 {
                    "Synthetic validation error: retry with value RETRY".into()
                } else {
                    marker.to_owned()
                },
                is_error: index == 1,
            });
        }
        let turn = client
            .invoke_agent_turn(endpoint.clone(), request, secret, cancel, |_| {})
            .await?;
        if !turn.tool_calls.is_empty() || !turn.text.contains(marker) {
            return Err(ModelError::ProviderProtocolError);
        }
        pass(report, 3);
        Ok(())
    }
}
fn pass(report: &mut ModelCompatibilityReport, index: usize) {
    report.checks[index].status = ModelCheckStatus::Passed;
    report.checks[index].detail =
        "SYNTHETIC_1024_TOKEN_LIMIT; NOT_A_GENERAL_RELIABILITY_GRADE".into();
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_contracts::{ModelCompatibilityCheck, ReasoningMode};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{Arc, Mutex},
        thread,
        time::Duration,
    };

    fn report() -> ModelCompatibilityReport {
        ModelCompatibilityReport {
            profile_id: "fixture".into(),
            checks: [
                "TEXT_STREAM",
                "TOOL_CALL",
                "ERROR_CORRECTION",
                "TOOL_CONTINUATION",
            ]
            .into_iter()
            .map(|name| ModelCompatibilityCheck {
                name: name.into(),
                status: ModelCheckStatus::NotTested,
                detail: "NOT_RUN".into(),
            })
            .collect(),
            settings: ModelRuntimeSettings {
                reasoning: ReasoningMode::High,
                max_output_tokens: 4096,
            },
            provider_revision: 1,
            checked_at: 1,
        }
    }
    fn server(
        count: usize,
        delay: bool,
        malformed: bool,
    ) -> (Url, Arc<Mutex<Vec<Value>>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let received = requests.clone();
        let worker = thread::spawn(move || {
            for index in 0..count {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                let body = loop {
                    let length = socket.read(&mut buffer).unwrap();
                    assert!(length > 0);
                    bytes.extend_from_slice(&buffer[..length]);
                    if let Some(header_end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..header_end]).to_lowercase();
                        let size: usize = headers
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if bytes.len() >= header_end + 4 + size {
                            break serde_json::from_slice::<Value>(
                                &bytes[header_end + 4..header_end + 4 + size],
                            )
                            .unwrap();
                        }
                    }
                };
                received.lock().unwrap().push(body);
                if delay {
                    thread::sleep(Duration::from_millis(400));
                    continue;
                }
                let frames = if index == 0 || index == 3 {
                    vec![
                        json!({"choices":[{"delta":{"content":"FIELORA_TEST_RESULT"},"finish_reason":"stop"}]}),
                    ]
                } else {
                    vec![
                        json!({"choices":[{"delta":{"reasoning_content":"PRIVATE_PROTOCOL_SENTINEL","encrypted_content":"opaque-","reasoning_details":[{"index":0,"id":"r1","type":"reasoning.text","format":"MiniMax-response-v1","text":"PRIVATE_"}]}}]}),
                        json!({"choices":[{"delta":{"encrypted_content":"block","reasoning_details":[{"index":0,"id":"r1","text":"DETAIL"}]}}]}),
                        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":format!("call_{index}"),"function":{"name":"fielora_compatibility_echo","arguments":"{\"value\":"}}]}}]}),
                        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":null,"type":null,"function":{"name":null,"arguments":if malformed {"!}"} else if index==1 {"\"FIRST\"}"} else {"\"RETRY\"}"}}}]},"finish_reason":"tool_calls"}]}),
                    ]
                };
                let data = frames
                    .iter()
                    .map(|v| format!("data: {v}\n\n"))
                    .collect::<String>()
                    + "data: [DONE]\n\n";
                write!(socket,"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",data.len()).unwrap();
                for chunk in data.as_bytes().chunks(17) {
                    socket.write_all(chunk).unwrap();
                }
            }
        });
        (url, requests, worker)
    }
    fn endpoint() -> ProviderEndpoint {
        ProviderEndpoint {
            model_optimization: true,
            kind: ProviderKind::OpenaiCompatible,
            base_url: Some("https://api.deepseek.com/v1".into()),
        }
    }
    #[tokio::test]
    async fn ten_domestic_adapters_stream_and_round_trip_tools_with_vendor_parameters() {
        use fielora_contracts::ReasoningMode::*;
        let cases = [
            ("QWEN", On, json!({"enable_thinking":true})),
            (
                "DEEPSEEK",
                High,
                json!({"thinking":{"type":"enabled"},"reasoning_effort":"high"}),
            ),
            ("KIMI", Low, json!({"reasoning_effort":"low"})),
            (
                "GLM",
                Max,
                json!({"thinking":{"type":"enabled"},"reasoning_effort":"max"}),
            ),
            (
                "MINIMAX",
                On,
                json!({"thinking":{"type":"adaptive"},"reasoning_split":true}),
            ),
            ("DOUBAO", Off, json!({"thinking":{"type":"disabled"}})),
            ("HUNYUAN", High, json!({"reasoning_effort":"high"})),
            ("ERNIE", ProviderDefault, json!({})),
            ("SPARK", On, json!({"thinking":{"type":"enabled"}})),
            ("STEP", Low, json!({"reasoning_effort":"low"})),
        ];
        for (id, reasoning, expected) in cases {
            let preset = provider_catalog().into_iter().find(|p| p.id == id).unwrap();
            let endpoint = ProviderEndpoint {
                model_optimization: true,
                kind: ProviderKind::OpenaiCompatible,
                base_url: Some(preset.base_url),
            };
            let (url, requests, worker) = server(4, false, false);
            let client = ModelClient {
                test_url: Some(url),
                ..ModelClient::new().unwrap()
            }
            .with_settings(ModelRuntimeSettings {
                reasoning,
                max_output_tokens: 4096,
            });
            let mut result = report();
            client
                .check_compatibility(
                    &endpoint,
                    &preset.model_ids[0],
                    b"synthetic-only",
                    CancellationToken::new(),
                    &mut result,
                    "FIELORA_TEST_RESULT",
                )
                .await
                .unwrap_or_else(|e| panic!("{id}: {e:?}"));
            worker.join().unwrap();
            assert!(
                result
                    .checks
                    .iter()
                    .all(|c| c.status == ModelCheckStatus::Passed),
                "{id}"
            );
            let requests = requests.lock().unwrap();
            for body in requests.iter() {
                let token_key = if id == "MINIMAX" {
                    "max_completion_tokens"
                } else {
                    "max_tokens"
                };
                assert_eq!(body[token_key], 1024, "{id}");
                for (key, value) in expected.as_object().unwrap() {
                    assert_eq!(&body[key], value, "{id}: {key}");
                }
                if id == "SPARK" {
                    assert!(body.get("stream_options").is_none());
                    let tools = body["tools"].as_array().unwrap();
                    let has_functions = tools.iter().any(|tool| tool["type"] == "function");
                    assert_eq!(
                        tools.iter().any(|tool| tool["type"] == "web_search"),
                        !has_functions
                    );
                }
            }
            let assistant = &requests[2]["messages"][2];
            if id == "MINIMAX" {
                assert_eq!(assistant["reasoning_details"][0]["text"], "PRIVATE_DETAIL");
            } else {
                assert!(assistant.get("reasoning_details").is_none(), "{id}");
            }
            if id == "DOUBAO" {
                assert_eq!(assistant["encrypted_content"], "opaque-block");
            } else {
                assert!(assistant.get("encrypted_content").is_none(), "{id}");
            }
            assert_eq!(
                assistant.get("reasoning_content").is_some(),
                !["QWEN", "SPARK", "STEP"].contains(&id),
                "{id}"
            );
            assert!(!serde_json::to_string(&result).unwrap().contains("PRIVATE"));
        }
    }

    #[tokio::test]
    async fn custom_known_model_uses_standard_wire_without_vendor_optimizations() {
        let endpoint = ProviderEndpoint {
            model_optimization: false,
            kind: ProviderKind::OpenaiCompatible,
            base_url: Some("https://api.minimaxi.com/v1".into()),
        };
        let managed = ProviderEndpoint {
            model_optimization: true,
            ..endpoint.clone()
        };
        assert_ne!(endpoint_identity(&endpoint), endpoint_identity(&managed));
        let profile = resolve_profile(&endpoint, "MiniMax-M3");
        assert_eq!(profile.source, "CUSTOM_OPENAI");
        assert_eq!(
            profile.reasoning_modes,
            vec![fielora_contracts::ReasoningMode::ProviderDefault]
        );
        assert!(
            coding_behavior_profile(&endpoint, "MiniMax-M3")
                .system_guidance()
                .is_empty()
        );
        let (url, requests, worker) = server(4, false, false);
        let client = ModelClient {
            test_url: Some(url),
            ..ModelClient::new().unwrap()
        };
        client
            .check_compatibility(
                &endpoint,
                "MiniMax-M3",
                b"fixture",
                CancellationToken::new(),
                &mut report(),
                "FIELORA_TEST_RESULT",
            )
            .await
            .unwrap();
        worker.join().unwrap();
        for body in requests.lock().unwrap().iter() {
            assert_eq!(body["max_tokens"], 1024);
            for key in [
                "reasoning_split",
                "thinking",
                "enable_thinking",
                "reasoning_effort",
                "max_completion_tokens",
            ] {
                assert!(body.get(key).is_none(), "unexpected {key}");
            }
            for message in body["messages"].as_array().unwrap() {
                for key in [
                    "reasoning_content",
                    "reasoning_details",
                    "encrypted_content",
                ] {
                    assert!(message.get(key).is_none(), "unexpected {key}");
                }
            }
        }
    }

    #[tokio::test]
    async fn http_stream_tool_error_correction_and_private_continuation_round_trip() {
        let (url, requests, worker) = server(4, false, false);
        let mut client = ModelClient::new().unwrap().with_settings(report().settings);
        client.test_url = Some(url);
        let mut result = report();
        client
            .check_compatibility(
                &endpoint(),
                "deepseek-flash",
                b"synthetic-only",
                CancellationToken::new(),
                &mut result,
                "FIELORA_TEST_RESULT",
            )
            .await
            .unwrap();
        worker.join().unwrap();
        assert!(
            result
                .checks
                .iter()
                .all(|c| c.status == ModelCheckStatus::Passed)
        );
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 4);
        for body in requests.iter() {
            assert_eq!(body["max_tokens"], 1024);
            assert_eq!(body["reasoning_effort"], "high");
        }
        assert_eq!(
            requests[2]["messages"][2]["reasoning_content"],
            "PRIVATE_PROTOCOL_SENTINEL"
        );
        assert_eq!(
            requests[3]["messages"][4]["reasoning_content"],
            "PRIVATE_PROTOCOL_SENTINEL"
        );
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("PRIVATE_PROTOCOL_SENTINEL")
        );
    }
    #[tokio::test]
    async fn malformed_arguments_fail_closed_without_fabricating_a_tool_call() {
        let (url, requests, worker) = server(2, false, true);
        let mut client = ModelClient::new().unwrap().with_settings(report().settings);
        client.test_url = Some(url);
        let mut result = report();
        assert_eq!(
            client
                .check_compatibility(
                    &endpoint(),
                    "deepseek-flash",
                    b"fixture",
                    CancellationToken::new(),
                    &mut result,
                    "FIELORA_TEST_RESULT"
                )
                .await
                .unwrap_err()
                .code(),
            "PROVIDER_INVALID_TOOL_CALL"
        );
        worker.join().unwrap();
        assert_eq!(requests.lock().unwrap().len(), 2);
        assert_eq!(result.checks[0].status, ModelCheckStatus::Passed);
        assert_eq!(result.checks[1].status, ModelCheckStatus::NotTested);
    }
    #[tokio::test]
    async fn pre_cancelled_invocation_does_not_wait_for_endpoint_resolution() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let client = ModelClient::new().unwrap();
        let endpoint = ProviderEndpoint {
            model_optimization: true,
            kind: ProviderKind::OpenaiCompatible,
            base_url: Some("https://unresolved-model-test.invalid/v1".into()),
        };
        let mut report = report();
        let result = tokio::time::timeout(
            Duration::from_millis(250),
            client.check_compatibility(
                &endpoint,
                "unknown",
                b"fixture",
                cancel,
                &mut report,
                "FIELORA_TEST_RESULT",
            ),
        )
        .await
        .unwrap();
        assert_eq!(result, Err(ModelError::InvocationCancelled));
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_pending_http_response() {
        let (url, requests, worker) = server(1, true, false);
        let mut client = ModelClient::new().unwrap().with_settings(report().settings);
        client.test_url = Some(url);
        let cancellation = CancellationToken::new();
        let trigger = cancellation.clone();
        let observed = requests.clone();
        tokio::spawn(async move {
            while observed.lock().unwrap().is_empty() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            trigger.cancel();
        });
        let mut result = report();
        let start = std::time::Instant::now();
        assert_eq!(
            client
                .check_compatibility(
                    &endpoint(),
                    "deepseek-flash",
                    b"fixture",
                    cancellation,
                    &mut result,
                    "FIELORA_TEST_RESULT"
                )
                .await,
            Err(ModelError::InvocationCancelled)
        );
        assert!(start.elapsed() < Duration::from_millis(350));
        worker.join().unwrap();
    }
    #[test]
    fn restart_recovery_and_debug_never_fabricate_or_publish_private_state() {
        let state = ProviderContinuation {
            fields: json!({"reasoning_content":"PRIVATE_SENTINEL"})
                .as_object()
                .unwrap()
                .clone(),
            endpoint_key: endpoint_identity(&endpoint()),
        };
        assert!(!format!("{state:?}").contains("PRIVATE_SENTINEL"));
        let mut messages = vec![
            AgentModelMessage::Assistant {
                text: "past action".into(),
                tool_calls: vec![AgentModelToolCall {
                    id: "old".into(),
                    name: "read_file".into(),
                    arguments: json!({}),
                }],
                continuation: None,
            },
            AgentModelMessage::ToolResult {
                call_id: "old".into(),
                name: "read_file".into(),
                content: "past receipt".into(),
                is_error: false,
            },
        ];
        recover_missing_continuation(&mut messages, false);
        assert!(
            messages
                .iter()
                .all(|m| matches!(m, AgentModelMessage::User(_)))
        );
    }
}
