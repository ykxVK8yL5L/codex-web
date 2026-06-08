use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub responses_api: bool,
    pub chat_completions: bool,
    pub tools: bool,
    pub json_mode: bool,
    pub vision: bool,
    pub streaming: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub default_model: String,
    pub base_url: Option<String>,
    pub api_key_configured: bool,
    pub capabilities: ProviderCapabilities,
    pub models: Option<Vec<String>>,
    pub models_cached_at: Option<String>,
    pub rpm_limit: Option<i64>,
    pub rpm_limit_enabled: bool,
    pub use_proxy: bool,
}

#[derive(Clone)]
pub struct ProviderRecord {
    pub summary: ProviderSummary,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub default_model: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub capabilities: Option<ProviderCapabilitiesInput>,
    pub rpm_limit: Option<i64>,
    pub rpm_limit_enabled: Option<bool>,
    pub use_proxy: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilitiesInput {
    pub responses_api: Option<bool>,
    pub chat_completions: Option<bool>,
    pub tools: Option<bool>,
    pub json_mode: Option<bool>,
    pub vision: Option<bool>,
    pub streaming: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealthCheck {
    pub id: String,
    pub provider_id: String,
    pub kind: String,
    pub ok: bool,
    pub status: Option<i64>,
    pub duration_ms: i64,
    pub error: Option<String>,
    pub checked_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResponse {
    pub ok: bool,
    pub provider_id: String,
    pub status: Option<i64>,
    pub duration_ms: i64,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsResponse {
    pub ok: bool,
    pub provider_id: String,
    pub models: Vec<String>,
    pub status: Option<i64>,
    pub duration_ms: i64,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDetectionResponse {
    pub ok: bool,
    pub provider_id: String,
    pub kind: String,
    pub capabilities: ProviderCapabilities,
    pub duration_ms: i64,
    pub checks: ProviderDetectionChecks,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDetectionChecks {
    pub responses: ProviderDetectionCheck,
    pub chat_completions: ProviderDetectionCheck,
}

#[derive(Serialize)]
pub struct ProviderDetectionCheck {
    pub ok: bool,
    pub status: Option<i64>,
    pub error: Option<String>,
}
