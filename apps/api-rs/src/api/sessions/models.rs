use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub kind: String,
    pub conversation_type: String,
    pub room_id: Option<String>,
    pub direct_agent_id: Option<String>,
    pub title: String,
    pub project_id: Option<String>,
    pub workspace_path: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub codex_session_id: Option<String>,
    pub notifications_enabled: bool,
    pub show_message_usage: Option<bool>,
    pub status: String,
    pub created_at: Option<String>,
    pub updated_at: String,
    pub goal: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessagesPage {
    pub items: Vec<SessionMessage>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub reply_to_message_id: Option<String>,
    pub reply_to: Option<SessionMessageReply>,
    pub usage: Option<SessionMessageUsage>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct SessionMessageReply {
    pub id: String,
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessageUsage {
    pub id: String,
    pub session_id: String,
    pub session_title: Option<String>,
    pub message_id: Option<String>,
    pub task_run_id: Option<String>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
    pub source: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub billable_input_tokens: i64,
    pub created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalRequest {
    pub text: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub title: String,
    pub project_id: Option<String>,
    pub conversation_type: Option<String>,
    pub room_id: Option<String>,
    pub goal: Option<CreateGoalRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    pub title: Option<String>,
    pub notifications_enabled: Option<bool>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub show_message_usage: Option<Option<bool>>,
}

#[derive(Default)]
pub struct SessionRuntimeUpdate {
    pub workspace_path: Option<String>,
    pub provider_id: Option<Option<String>>,
    pub model: Option<Option<String>>,
    pub codex_session_id: Option<Option<String>>,
    pub status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendSessionMessageRequest {
    pub role: Option<String>,
    pub content: Option<String>,
    pub reply_to_message_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    pub id: String,
    pub session_id: String,
    pub prompt: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reply_to_message_id: Option<String>,
    pub order_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueMessageRequest {
    pub prompt: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reply_to_message_id: Option<String>,
}

pub type UpdateQueuedMessageRequest = QueueMessageRequest;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderQueuedMessagesRequest {
    pub ordered_ids: Vec<String>,
}
