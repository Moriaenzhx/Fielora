use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelSupport {
    Unknown,
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasoningMode {
    #[default]
    ProviderDefault,
    Off,
    On,
    Low,
    Medium,
    High,
    Max,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ModelRuntimeSettings {
    pub reasoning: ReasoningMode,
    pub max_output_tokens: u32,
}
impl Default for ModelRuntimeSettings {
    fn default() -> Self {
        Self {
            reasoning: ReasoningMode::ProviderDefault,
            max_output_tokens: 4096,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolvedModelProfile {
    pub model_id: String,
    pub profile_id: String,
    pub source: String,
    pub source_url: Option<String>,
    pub reviewed_on: Option<String>,
    pub tools: ModelSupport,
    pub images: ModelSupport,
    pub structured_output: ModelSupport,
    pub reasoning_modes: Vec<ReasoningMode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelCheckStatus {
    Passed,
    Failed,
    Cancelled,
    NotTested,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelCompatibilityCheck {
    pub name: String,
    pub status: ModelCheckStatus,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelCompatibilityReport {
    pub profile_id: String,
    pub checks: Vec<ModelCompatibilityCheck>,
    pub settings: ModelRuntimeSettings,
    #[ts(type = "number")]
    pub provider_revision: u64,
    #[ts(type = "number")]
    pub checked_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelRuntimeView {
    pub profile: ResolvedModelProfile,
    pub settings: ModelRuntimeSettings,
    #[ts(type = "number")]
    pub revision: u64,
    // Non-sensitive, adapter-resolved request parameters; never a request body.
    #[ts(type = "Record<string, unknown>")]
    pub effective_parameters: Value,
    pub validation: Option<ModelCompatibilityReport>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateModelRuntimeRequest {
    #[ts(type = "number")]
    pub expected_provider_revision: u64,
    pub provider_config_id: ProviderConfigId,
    #[ts(type = "number")]
    pub expected_revision: u64,
    pub settings: ModelRuntimeSettings,
}

/// Core-owned, reviewed setup templates. Model IDs are suggestions, not account entitlements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelProviderPreset {
    pub id: String,
    pub label: String,
    pub description: String,
    pub base_url: String,
    pub model_ids: Vec<String>,
    pub versions: Vec<ModelProviderVersion>,
    pub base_urls: Vec<String>,
    pub source_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelProviderVersion {
    pub id: String,
    pub label: String,
    pub model_id: String,
    pub base_url: String,
    pub reasoning_modes: Vec<ReasoningMode>,
}
