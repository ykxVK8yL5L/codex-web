use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChannelDefinition {
    pub id: String,
    pub kind: String,
    pub adapter: String,
    pub auth_type: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    pub method: String,
    pub url_template: String,
    pub headers_template: String,
    pub body_template: String,
    pub account_fields: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationAccountSummary {
    pub id: String,
    pub name: String,
    pub channel_id: Option<String>,
    pub channel_kind: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub permissions: serde_json::Value,
    pub last_test_status: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecipientSummary {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    pub sender_account_id: Option<String>,
    pub channel_id: Option<String>,
    pub config: serde_json::Value,
    pub permissions: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRuleSummary {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub event_types: Vec<String>,
    pub min_severity: String,
    pub targets: serde_json::Value,
    pub dedupe_minutes: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDeliverySummary {
    pub id: String,
    pub rule_id: Option<String>,
    pub account_id: Option<String>,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub status: String,
    pub attempts: i64,
    pub response_status: Option<i64>,
    pub last_error: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub sent_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEphemeralRuleSummary {
    pub id: String,
    pub scope_type: String,
    pub scope_id: String,
    pub event_types: Vec<String>,
    pub targets: serde_json::Value,
    pub enabled: bool,
    pub expire_mode: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub triggered_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettingsResponse {
    pub channels: Vec<NotificationChannelDefinition>,
    pub accounts: Vec<NotificationAccountSummary>,
    pub recipients: Vec<NotificationRecipientSummary>,
    pub rules: Vec<NotificationRuleSummary>,
    pub ephemeral_rules: Vec<NotificationEphemeralRuleSummary>,
    pub recent_deliveries: Vec<NotificationDeliverySummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestNotificationAccountResponse {
    pub ok: bool,
    pub account: NotificationAccountSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestNotificationRecipientResponse {
    pub ok: bool,
    pub recipient: NotificationRecipientSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNotificationChannelRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub adapter: Option<String>,
    pub auth_type: Option<String>,
    pub method: Option<String>,
    pub url_template: Option<String>,
    pub headers_template: Option<String>,
    pub body_template: Option<String>,
    pub account_fields: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNotificationAccountRequest {
    pub name: Option<String>,
    pub channel_id: Option<String>,
    pub channel_kind: Option<String>,
    pub enabled: Option<bool>,
    pub config: Option<serde_json::Value>,
    pub permissions: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNotificationRecipientRequest {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub enabled: Option<bool>,
    pub sender_account_id: Option<String>,
    pub channel_id: Option<String>,
    pub config: Option<serde_json::Value>,
    pub permissions: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNotificationRuleRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub event_types: Option<Vec<String>>,
    pub min_severity: Option<String>,
    pub targets: Option<serde_json::Value>,
    pub dedupe_minutes: Option<i64>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestNotificationRequest {
    pub title: Option<String>,
    pub message: Option<String>,
    pub chat_id: Option<String>,
    pub target_type: Option<String>,
    pub email_to: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNotificationEphemeralRuleRequest {
    pub scope_type: Option<String>,
    pub scope_id: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub targets: Option<serde_json::Value>,
    pub expire_mode: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookRouteSummary {
    pub id: String,
    pub route_key: String,
    pub name: String,
    pub enabled: bool,
    pub secret: String,
    pub curl_example: String,
    pub session_id: Option<String>,
    pub session_title: Option<String>,
    pub command_template: String,
    pub prompt_template: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformRouteSummary {
    pub id: String,
    pub kind: String,
    pub account_id: String,
    pub chat_id: String,
    pub session_id: String,
    pub session_title: String,
    pub session_conversation_type: Option<String>,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSummary {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    pub enabled: bool,
    pub builtin: bool,
    pub channel_id: Option<String>,
    pub account_count: i64,
    pub connected_route_count: i64,
    pub baseline_capabilities: Vec<String>,
    pub supported_capabilities: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSettingsResponse {
    pub baseline_capabilities: Vec<String>,
    pub capability_labels: serde_json::Value,
    pub platforms: Vec<PlatformSummary>,
    pub routes: Vec<PlatformRouteSummary>,
    pub webhook_routes: Vec<WebhookRouteSummary>,
}
