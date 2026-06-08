use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Request inputs (mirror @codex-web/protocol)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalRequest {
    pub owner_type: Option<String>,
    pub owner_id: Option<String>,
    pub text: Option<String>,
    pub mode: Option<String>,
    pub manager_agent_id: Option<String>,
    pub coordinator_agent_id: Option<String>,
    pub focus_text: Option<String>,
    pub focus_owner_agent_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalRequest {
    pub text: Option<String>,
    pub mode: Option<String>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub manager_agent_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub coordinator_agent_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub progress_summary: Option<Option<String>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalFocusRequest {
    pub text: Option<String>,
    pub owner_agent_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalFocusRequest {
    pub text: Option<String>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub owner_agent_id: Option<Option<String>>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalItemRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub assigned_agent_id: Option<String>,
    pub priority: Option<i64>,
    pub depends_on_item_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalItemRequest {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub description: Option<Option<String>>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub assigned_agent_id: Option<Option<String>>,
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub depends_on_item_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::api::goals::models::double_option")]
    pub room_task_id: Option<Option<String>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalProposalRequest {
    pub kind: Option<String>,
    pub title: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub proposed_by_agent_id: Option<String>,
}

/// Distinguishes "field absent" from "field present and null" so PATCH semantics
/// match the TS `input.x !== undefined` checks.
pub fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalSummary {
    pub id: String,
    pub owner_type: String,
    pub owner_id: String,
    pub text: String,
    pub mode: String,
    pub status: String,
    pub manager_agent_id: Option<String>,
    pub coordinator_agent_id: Option<String>,
    pub current_focus: Option<GoalFocusSummary>,
    pub progress: GoalProgress,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    pub total_items: i64,
    pub active_items: i64,
    pub completed_items: i64,
    pub failed_items: i64,
    pub blocked_items: i64,
    pub latest_summary: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDetailResponse {
    pub goal: GoalSummary,
    pub focuses: Vec<GoalFocusSummary>,
    pub items: Vec<GoalItemSummary>,
    pub proposals: Vec<GoalProposalSummary>,
    pub events: Vec<GoalEventSummary>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalFocusSummary {
    pub id: String,
    pub goal_id: String,
    pub text: String,
    pub status: String,
    pub owner_agent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalItemSummary {
    pub id: String,
    pub goal_id: String,
    pub room_task_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub assigned_agent_id: Option<String>,
    pub priority: i64,
    pub depends_on_item_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEventSummary {
    pub id: String,
    pub goal_id: String,
    pub r#type: String,
    pub actor_type: Option<String>,
    pub actor_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProposalSummary {
    pub id: String,
    pub goal_id: String,
    pub kind: String,
    pub status: String,
    pub title: String,
    pub payload: serde_json::Value,
    pub proposed_by_agent_id: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalPlanResponse {
    pub goal: GoalSummary,
    pub items: Vec<GoalItemSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalOrchestrateResponse {
    pub goal: GoalSummary,
    pub tasks: Vec<crate::api::rooms::models::RoomTaskSummary>,
}
