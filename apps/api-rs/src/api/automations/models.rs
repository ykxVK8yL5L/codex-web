use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSummary {
    pub id: String,
    pub name: String,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub action_type: String,
    pub prompt: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub command_timeout_seconds: Option<i64>,
    pub retry_max: i64,
    pub retry_delay_minutes: i64,
    pub overlap_policy: String,
    pub session_id: Option<String>,
    pub running_runs: i64,
    pub queued_runs: i64,
    pub last_run_status: Option<String>,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub schedule: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationInput {
    pub name: Option<String>,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub action_type: Option<String>,
    pub prompt: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub command_timeout_seconds: Option<i64>,
    pub retry_max: Option<i64>,
    pub retry_delay_minutes: Option<i64>,
    pub overlap_policy: Option<String>,
    pub schedule: Option<String>,
    pub status: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunSummary {
    pub id: String,
    pub automation_id: String,
    pub session_id: String,
    pub status: String,
    pub exit_code: Option<i64>,
    pub started_at: String,
    pub finished_at: Option<String>,
}
