//! Endpoint- and model-scoped declarations. The setup catalog and adapters share one source.
use crate::{ModelError, ProviderEndpoint};
use fielora_contracts::{
    ModelProviderPreset, ModelProviderVersion, ModelRuntimeSettings, ModelSupport, ProviderKind,
    ReasoningMode, ResolvedModelProfile,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::OnceLock;

#[derive(Deserialize)]
struct CatalogEntry {
    id: String,
    label: String,
    description: String,
    endpoints: Vec<String>,
    source_url: String,
    continuation: String,
    groups: Vec<ModelGroup>,
}
#[derive(Deserialize)]
struct ModelGroup {
    #[serde(default)]
    endpoints: Vec<String>,
    #[serde(default)]
    label: Option<String>,
    ids: Vec<String>,
    policy: String,
    tools: ModelSupport,
    images: ModelSupport,
    structured_output: ModelSupport,
}
fn catalog() -> &'static [CatalogEntry] {
    static CATALOG: OnceLock<Vec<CatalogEntry>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("provider_catalog.json"))
            .expect("checked-in provider catalog must be valid")
    })
}
pub fn provider_catalog() -> Vec<ModelProviderPreset> {
    catalog()
        .iter()
        .map(|entry| ModelProviderPreset {
            id: entry.id.clone(),
            label: entry.label.clone(),
            description: entry.description.clone(),
            base_url: entry.endpoints[0].clone(),
            model_ids: entry.groups.iter().flat_map(|g| g.ids.clone()).collect(),
            base_urls: entry.endpoints.clone(),
            versions: entry
                .groups
                .iter()
                .enumerate()
                .flat_map(|(index, group)| {
                    group.ids.iter().map(move |model| ModelProviderVersion {
                        id: format!("{index}:{model}"),
                        label: group.label.clone().unwrap_or_else(|| model.clone()),
                        model_id: model.clone(),
                        base_url: group
                            .endpoints
                            .first()
                            .unwrap_or(&entry.endpoints[0])
                            .clone(),
                        reasoning_modes: modes(&group.policy),
                    })
                })
                .collect(),
            source_url: entry.source_url.clone(),
        })
        .collect()
}
/// Reject known vendor IDs on official-only adapters before credentials can be sent.
/// Compatible endpoints remain open to custom IDs; legacy records must stay readable.
pub fn validate_provider_model(kind: ProviderKind, model: &str) -> Result<(), ModelError> {
    if kind != ProviderKind::OpenaiCompatible
        && catalog().iter().any(|entry| {
            entry.groups.iter().any(|group| {
                group
                    .ids
                    .iter()
                    .any(|id| id.eq_ignore_ascii_case(model.trim()))
            })
        })
    {
        return Err(ModelError::ProviderModelMismatch);
    }
    Ok(())
}
pub fn endpoint_identity(endpoint: &ProviderEndpoint) -> String {
    format!(
        "{:?}:{}{}",
        endpoint.kind,
        endpoint
            .base_url
            .as_deref()
            .unwrap_or("official")
            .trim_end_matches('/'),
        if endpoint.model_optimization {
            ""
        } else {
            ":custom"
        }
    )
}
fn entry(endpoint: &ProviderEndpoint) -> Option<&'static CatalogEntry> {
    if !endpoint.model_optimization || endpoint.kind != ProviderKind::OpenaiCompatible {
        return None;
    }
    let url = endpoint.base_url.as_deref()?.trim_end_matches('/');
    catalog()
        .iter()
        .find(|entry| entry.endpoints.iter().any(|allowed| allowed == url))
}
fn declaration(
    endpoint: &ProviderEndpoint,
    model: &str,
) -> Option<(&'static CatalogEntry, &'static ModelGroup)> {
    let entry = entry(endpoint)?;
    Some((
        entry,
        entry.groups.iter().find(|group| {
            group.ids.iter().any(|id| id == model)
                && (group.endpoints.is_empty()
                    || group.endpoints.iter().any(|url| {
                        Some(url.as_str())
                            == endpoint
                                .base_url
                                .as_deref()
                                .map(|s| s.trim_end_matches('/'))
                    }))
        })?,
    ))
}
pub(crate) fn optimized_family(endpoint: &ProviderEndpoint, model: &str) -> Option<&'static str> {
    declaration(endpoint, model).map(|(entry, _)| entry.id.as_str())
}
pub fn preserves_reasoning(endpoint: &ProviderEndpoint, model: &str) -> bool {
    declaration(endpoint, model).is_some_and(|(e, _)| e.continuation != "none")
}
pub(crate) fn continuation_fields(
    endpoint: &ProviderEndpoint,
    model: &str,
) -> &'static [&'static str] {
    match declaration(endpoint, model).map(|(e, _)| e.continuation.as_str()) {
        Some("minimax") => &["reasoning_content", "reasoning_details"],
        Some("doubao") => &["reasoning_content", "encrypted_content"],
        Some("reasoning_content") => &["reasoning_content"],
        _ => &[],
    }
}
fn modes(policy: &str) -> Vec<ReasoningMode> {
    use ReasoningMode::*;
    let mut values = vec![ProviderDefault];
    values.extend(match policy {
        "enable_thinking" | "thinking" | "spark_thinking" | "minimax_adaptive" => vec![Off, On],
        "deepseek" => vec![Off, Low, High, Max],
        "effort_max" | "glm_effort" => vec![Low, High, Max],
        "effort" => vec![Low, High],
        "effort_medium" => vec![Low, Medium, High],
        // Hy3 maps low to high during tool calls. Do not offer a misleading low setting.
        "hy_adaptive" => vec![High],
        _ => vec![],
    });
    values
}
pub fn resolve_profile(endpoint: &ProviderEndpoint, model: &str) -> ResolvedModelProfile {
    use ModelSupport::*;
    let mut profile = ResolvedModelProfile {
        model_id: model.into(),
        profile_id: "generic-v1".into(),
        source: if endpoint.model_optimization {
            "UNKNOWN"
        } else {
            "CUSTOM_OPENAI"
        }
        .into(),
        source_url: None,
        reviewed_on: None,
        tools: Unknown,
        images: Unknown,
        structured_output: Unknown,
        reasoning_modes: vec![ReasoningMode::ProviderDefault],
    };
    if let Some((entry, group)) = declaration(endpoint, model) {
        profile.profile_id = format!("{}-{}-20261002", entry.id.to_lowercase(), group.policy);
        profile.source = "OFFICIAL_DOCUMENTATION".into();
        profile.source_url = Some(entry.source_url.clone());
        profile.reviewed_on = Some("2026-10-02".into());
        profile.tools = group.tools;
        profile.images = group.images;
        profile.structured_output = group.structured_output;
        profile.reasoning_modes = modes(&group.policy);
    }
    if std::env::var("FIELORA_E2E").as_deref() == Ok("1")
        && model.starts_with("__fielora_agent_fixture")
    {
        profile.tools = Supported;
        profile.images = if model == "__fielora_agent_fixture_images__" {
            Supported
        } else {
            Unknown
        };
        profile.source = "SYNTHETIC_FIXTURE".into();
    }
    profile
}
pub fn effective_parameters(
    endpoint: &ProviderEndpoint,
    model: &str,
    settings: &ModelRuntimeSettings,
) -> Result<Value, ModelError> {
    use ReasoningMode::*;
    let profile = resolve_profile(endpoint, model);
    if !(256..=16_384).contains(&settings.max_output_tokens)
        || !profile.reasoning_modes.contains(&settings.reasoning)
    {
        return Err(ModelError::ConfigurationUnsupported);
    }
    let spec = declaration(endpoint, model);
    let minimax = spec.is_some_and(|(e, _)| e.id == "MINIMAX");
    let token_key = match endpoint.kind {
        ProviderKind::Openai => "max_output_tokens",
        ProviderKind::OpenaiCompatible if minimax => "max_completion_tokens",
        _ => "max_tokens",
    };
    let mut params = json!({token_key:settings.max_output_tokens});
    // Separate private thinking from user-visible content, including M2.x reasoning_details.
    if minimax {
        params["reasoning_split"] = json!(true);
    }
    if settings.reasoning == ProviderDefault {
        return Ok(params);
    }
    let policy = spec.map(|(_, g)| g.policy.as_str()).unwrap_or("default");
    let effort = match settings.reasoning {
        Low => "low",
        Medium => "medium",
        Max => "max",
        _ => "high",
    };
    match policy {
        "enable_thinking" => params["enable_thinking"] = json!(settings.reasoning == On),
        "thinking" | "spark_thinking" | "deepseek" | "glm_effort" => {
            params["thinking"] =
                json!({"type":if settings.reasoning==Off{"disabled"}else{"enabled"}});
            if matches!(policy, "deepseek" | "glm_effort") && settings.reasoning != Off {
                params["reasoning_effort"] = json!(effort);
            }
        }
        "minimax_adaptive" => {
            params["thinking"] =
                json!({"type":if settings.reasoning==Off{"disabled"}else{"adaptive"}})
        }
        "effort" | "effort_medium" | "effort_max" | "hy_adaptive" => {
            params["reasoning_effort"] = json!(effort)
        }
        _ => {}
    }
    Ok(params)
}
pub(crate) fn apply_settings(
    body: &mut Value,
    endpoint: &ProviderEndpoint,
    model: &str,
    settings: &ModelRuntimeSettings,
) -> Result<(), ModelError> {
    let parameters = effective_parameters(endpoint, model, settings)?;
    let object = body
        .as_object_mut()
        .ok_or(ModelError::ProviderProtocolError)?;
    // Only one length field is sent, even for manually named proxy models.
    for key in ["max_tokens", "max_completion_tokens", "max_output_tokens"] {
        object.remove(key);
    }
    object.extend(parameters.as_object().unwrap().clone());
    if declaration(endpoint, model).is_some_and(|(e, _)| e.id == "SPARK") {
        object.remove("stream_options");
        object.remove("parallel_tool_calls");
        object.remove("tool_choice");
        // Spark otherwise enables provider web search by default. Fielora owns tool authority.
        let tools = object.entry("tools").or_insert_with(|| json!([]));
        let tools = tools
            .as_array_mut()
            .ok_or(ModelError::ProviderProtocolError)?;
        // Spark forbids mixing web_search with function tools. Supplying functions
        // selects function mode; a plain text call explicitly disables its default search.
        if tools.is_empty() {
            tools.push(json!({"type":"web_search","web_search":{"enable":false}}));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn endpoint(url: &str) -> ProviderEndpoint {
        ProviderEndpoint {
            model_optimization: true,
            kind: ProviderKind::OpenaiCompatible,
            base_url: Some(url.into()),
        }
    }
    #[test]
    fn catalog_covers_ten_families_with_exact_endpoints_and_model_modes() {
        let presets = provider_catalog();
        assert_eq!(
            presets.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            vec![
                "QWEN", "DEEPSEEK", "KIMI", "GLM", "MINIMAX", "DOUBAO", "HUNYUAN", "ERNIE",
                "SPARK", "STEP"
            ]
        );
        for preset in presets {
            for version in &preset.versions {
                let model = &version.model_id;
                let e = endpoint(&version.base_url);
                let profile = resolve_profile(&e, model);
                assert_eq!(profile.source, "OFFICIAL_DOCUMENTATION");
                for reasoning in profile.reasoning_modes {
                    effective_parameters(
                        &e,
                        model,
                        &ModelRuntimeSettings {
                            reasoning,
                            ..Default::default()
                        },
                    )
                    .unwrap();
                }
                for bad in [
                    format!("{}/unreviewed", preset.base_url),
                    preset.base_url.replacen("https:", "http:", 1),
                    "https://gateway.example/v1".into(),
                ] {
                    assert_eq!(resolve_profile(&endpoint(&bad), model).source, "UNKNOWN");
                }
            }
        }
        let minimax = endpoint("https://api.minimaxi.com/v1");
        assert!(
            effective_parameters(
                &minimax,
                "MiniMax-M2.7",
                &ModelRuntimeSettings {
                    reasoning: ReasoningMode::Off,
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert!(
            effective_parameters(
                &endpoint("https://api.moonshot.cn/v1"),
                "kimi-k3",
                &ModelRuntimeSettings {
                    reasoning: ReasoningMode::Off,
                    ..Default::default()
                }
            )
            .is_err()
        );
    }
    #[test]
    fn reasoning_modes_and_version_endpoints_do_not_bleed_between_versions() {
        let step = endpoint("https://api.stepfun.com/v1");
        let settings = ModelRuntimeSettings {
            reasoning: ReasoningMode::Medium,
            ..Default::default()
        };
        assert_eq!(
            effective_parameters(&step, "step-3.7-flash", &settings).unwrap()["reasoning_effort"],
            "medium"
        );
        assert!(effective_parameters(&step, "step-3.5-flash-2603", &settings).is_err());
        let spark = endpoint("https://spark-api-open.xf-yun.com/x2");
        assert!(
            resolve_profile(&spark, "spark-x")
                .reasoning_modes
                .contains(&ReasoningMode::Off)
        );
        assert_eq!(resolve_profile(&spark, "4.0Ultra").source, "UNKNOWN");
        assert_eq!(
            resolve_profile(&endpoint("https://spark-api-open.xf-yun.com/v1"), "spark-x").source,
            "UNKNOWN"
        );
        let unknown = endpoint("https://api.minimaxi.com/v1");
        assert!(continuation_fields(&unknown, "my-custom-minimax").is_empty());
        assert!(
            crate::coding_behavior_profile(&unknown, "my-custom-minimax")
                .system_guidance()
                .is_empty()
        );
    }

    #[test]
    fn registry_is_endpoint_scoped_and_unknown_is_not_unsupported() {
        let qwen = resolve_profile(
            &endpoint("https://coding.dashscope.aliyuncs.com/v1"),
            "qwen3.7-plus",
        );
        assert_eq!(qwen.images, ModelSupport::Supported);
        for url in [
            "https://gateway.example/v1",
            "https://evildashscope.aliyuncs.com/v1",
            "https://dashscope.aliyuncs.com.evil.test/v1",
        ] {
            let profile = resolve_profile(&endpoint(url), "qwen3.7-plus");
            assert_eq!(profile.tools, ModelSupport::Unknown);
            assert_eq!(
                profile.reasoning_modes,
                vec![ReasoningMode::ProviderDefault]
            );
        }
        assert_eq!(
            resolve_profile(&endpoint("https://api.deepseek.com/v1"), "future-model").tools,
            ModelSupport::Unknown
        );
    }
    #[test]
    fn reasoning_maps_to_real_parameters_without_silent_downgrade() {
        let qwen = endpoint("https://coding.dashscope.aliyuncs.com/v1");
        let mut settings = ModelRuntimeSettings::default();
        assert!(
            effective_parameters(&qwen, "qwen3.7-plus", &settings)
                .unwrap()
                .get("enable_thinking")
                .is_none()
        );
        settings.reasoning = ReasoningMode::On;
        assert_eq!(
            effective_parameters(&qwen, "qwen3.7-plus", &settings).unwrap()["enable_thinking"],
            true
        );
        settings.reasoning = ReasoningMode::Max;
        assert_eq!(
            effective_parameters(&qwen, "qwen3.7-plus", &settings),
            Err(ModelError::ConfigurationUnsupported)
        );
        let deepseek = endpoint("https://api.deepseek.com/v1");
        assert_eq!(
            effective_parameters(&deepseek, "deepseek-flash", &settings).unwrap()["reasoning_effort"],
            "max"
        );
        assert!(
            effective_parameters(
                &endpoint("https://proxy.example/v1"),
                "deepseek-flash",
                &settings
            )
            .is_err()
        );
    }
}
