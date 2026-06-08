use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSummary {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub mode: &'static str,
    pub status: &'static str,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CreateTerminalSessionRequest {
    pub name: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateTerminalSessionRequest {
    pub name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDefaultsResponse {
    pub default_cwd: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandRequest {
    pub command: Option<String>,
    pub cwd: Option<String>,
    #[allow(dead_code)]
    pub session_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandResponse {
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i64>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
}
