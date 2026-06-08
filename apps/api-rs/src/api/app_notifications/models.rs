use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppNotificationSummary {
    pub id: String,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub metadata: serde_json::Value,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppNotificationsResponse {
    pub items: Vec<AppNotificationSummary>,
    pub unread_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppNotificationRequest {
    pub event_type: String,
    pub severity: Option<String>,
    pub title: String,
    pub message: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
}
