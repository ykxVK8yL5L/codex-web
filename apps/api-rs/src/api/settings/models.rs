use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAccessSettings {
    pub request_ttl_minutes: i64,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompactionSettings {
    pub enabled: bool,
    pub auto_compact_messages: i64,
    pub auto_compact_chars: i64,
    pub min_new_messages: i64,
    pub min_new_chars: i64,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionCompactionSettings {
    pub enabled: Option<bool>,
    pub auto_compact_messages: Option<i64>,
    pub auto_compact_chars: Option<i64>,
    pub min_new_messages: Option<i64>,
    pub min_new_chars: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitSettings {
    pub enabled: bool,
    pub global_per_minute: i64,
    pub auth_per_minute: i64,
    pub preview_access_per_minute: i64,
    pub expensive_per_five_minutes: i64,
    pub provider_proxy_per_minute: i64,
    pub provider_proxy_per_hour: i64,
    pub provider_proxy_max_concurrent: i64,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageRetentionSettings {
    pub retention_days: i64,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageDisplaySettings {
    pub show_message_usage: bool,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadRewriteSettings {
    pub rules: Vec<PayloadRewriteRule>,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadRewriteRule {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub provider_kind: Option<String>,
    pub model_pattern: String,
    #[serde(default)]
    pub remove_params: Vec<String>,
    #[serde(default)]
    pub set_params_json: String,
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTokenUsageRetentionSettings {
    pub retention_days: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTokenUsageDisplaySettings {
    pub show_message_usage: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePayloadRewriteSettings {
    pub rules: Option<Vec<PayloadRewriteRule>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTestSettings {
    pub title_zh: String,
    pub title_en: String,
    pub message_zh: String,
    pub message_en: String,
    pub include_help: bool,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNotificationTestSettings {
    pub title_zh: Option<String>,
    pub title_en: Option<String>,
    pub message_zh: Option<String>,
    pub message_en: Option<String>,
    pub include_help: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeSettings {
    pub sandbox_mode: String,
    pub approval_policy: String,
    pub bypass_sandbox: bool,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCodexRuntimeSettings {
    pub sandbox_mode: Option<String>,
    pub approval_policy: Option<String>,
    pub bypass_sandbox: Option<bool>,
}
