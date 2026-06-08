use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
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

/// Stored row representation of a webhook route (mirrors the `webhook_routes` table).
#[derive(Clone)]
pub struct WebhookRouteRow {
    pub id: String,
    pub route_key: String,
    pub name: String,
    pub enabled: bool,
    pub secret: String,
    pub session_id: Option<String>,
    pub prompt_template: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookRouteInput {
    pub name: Option<serde_json::Value>,
    pub enabled: Option<serde_json::Value>,
    pub secret: Option<serde_json::Value>,
    pub route_key: Option<serde_json::Value>,
    pub command_template: Option<serde_json::Value>,
    pub prompt_template: Option<serde_json::Value>,
}
