use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Request bodies (mirror @codex-web/protocol Create*/Update* request types).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomRequest {
    pub name: Option<String>,
    pub group_id: Option<String>,
    pub circle_id: Option<String>,
    pub project_id: Option<String>,
    pub shared_context: Option<String>,
    #[serde(default)]
    pub orchestration: Option<serde_json::Value>,
    #[serde(default)]
    pub goal: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomRequest {
    pub name: Option<String>,
    pub status: Option<String>,
    // Distinguish "field absent" from "explicit null" by deserializing into Option<Option<..>>.
    #[serde(default, deserialize_with = "double_option")]
    pub shared_context: Option<Option<String>>,
    #[serde(default)]
    pub orchestration: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRoomAgentRequest {
    pub agent_id: Option<String>,
    pub listen_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomAgentRequest {
    pub listen_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomArtifactRequest {
    pub agent_id: Option<String>,
    pub kind: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomDecisionRequest {
    pub title: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomDecisionRequest {
    pub title: Option<String>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub payload: Option<Option<serde_json::Value>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomHandoffRequest {
    pub from_agent_id: Option<String>,
    pub to_agent_id: Option<String>,
    pub summary: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomHandoffRequest {
    #[serde(default, deserialize_with = "double_option")]
    pub from_agent_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub to_agent_id: Option<Option<String>>,
    pub summary: Option<String>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub payload: Option<Option<serde_json::Value>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAttachmentInput {
    pub name: Option<String>,
    #[serde(alias = "mimeType")]
    pub r#type: Option<String>,
    pub data_base64: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomMessageRequest {
    pub content: Option<String>,
    pub session_id: Option<String>,
    pub reply_to_message_id: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<UploadAttachmentInput>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomTaskRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
    pub assigned_agent_id: Option<String>,
    pub priority: Option<i64>,
    pub depends_on_task_id: Option<String>,
    pub scheduled_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomTaskRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub assigned_agent_id: Option<Option<String>>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    pub depends_on_task_id: Option<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomScheduleRequest {
    pub agent_id: Option<String>,
    pub task_prompt: Option<String>,
    pub schedule_type: Option<String>,
    pub run_at: Option<String>,
}

fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

// ---------------------------------------------------------------------------
// Response summaries.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomArtifactSummary {
    pub id: String,
    pub room_id: String,
    pub agent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDecisionSummary {
    pub id: String,
    pub room_id: String,
    pub title: String,
    pub status: String,
    pub payload: serde_json::Value,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomHandoffSummary {
    pub id: String,
    pub room_id: String,
    pub from_agent_id: Option<String>,
    pub to_agent_id: Option<String>,
    pub summary: String,
    pub status: String,
    pub payload: serde_json::Value,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomScheduleSummary {
    pub id: String,
    pub room_id: String,
    pub agent_id: String,
    pub task_prompt: String,
    pub schedule_type: String,
    pub run_at: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomRunDiffResponse {
    pub run_id: String,
    pub ok: bool,
    pub workspace_path: String,
    pub status: String,
    pub stat: String,
    pub diff: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomRunMergeResponse {
    pub run: AgentRunSummary,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSummary {
    pub id: String,
    pub session_id: Option<String>,
    pub name: String,
    pub group_id: Option<String>,
    pub circle_id: Option<String>,
    pub project_id: Option<String>,
    pub status: String,
    pub shared_context: Option<String>,
    pub goal: Option<serde_json::Value>,
    pub orchestration: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomAgentSummary {
    pub id: String,
    pub name: String,
    pub role_id: String,
    pub description: Option<String>,
    pub extra_prompt: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub workspace_mode: String,
    pub default_project_id: Option<String>,
    pub favorite_project_ids: Vec<String>,
    pub project_access_mode: String,
    pub allowed_project_ids: Vec<String>,
    pub permission_profile_id: Option<String>,
    pub permissions: serde_json::Value,
    pub max_concurrent_runs: i64,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub listen_mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomEventSummary {
    pub id: String,
    pub room_id: String,
    pub r#type: String,
    pub source_agent_id: Option<String>,
    pub target_agent_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomTaskSummary {
    pub id: String,
    pub room_id: String,
    pub goal_item_id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub assigned_agent_id: Option<String>,
    pub status: String,
    pub priority: i64,
    pub depends_on_task_id: Option<String>,
    pub scheduled_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunSummary {
    pub id: String,
    pub room_id: String,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub goal_id: Option<String>,
    pub session_id: Option<String>,
    pub status: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub workspace_path: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub exit_code: Option<i64>,
}
