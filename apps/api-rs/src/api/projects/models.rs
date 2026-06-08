use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub workspace_path: String,
    pub runner: String,
    pub changed_files: i64,
    pub staged_files: i64,
    pub modified_files: i64,
    pub untracked_files: i64,
    pub git_status: String,
    pub check_command: Option<String>,
    pub check_commands: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub workspace_path: Option<String>,
    pub check_command: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub workspace_path: Option<String>,
    pub check_command: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProjectCheckRequest {
    pub command: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCheckRunSummary {
    pub id: String,
    pub project_id: String,
    pub command: String,
    pub cwd: String,
    pub status: String,
    pub exit_code: Option<i64>,
    pub duration_ms: i64,
    pub stdout: String,
    pub stderr: String,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitOperationRequest {
    pub operation: String,
    pub branch: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitOperationSummary {
    pub id: String,
    pub project_id: String,
    pub operation: String,
    pub args: Vec<String>,
    pub status: String,
    pub exit_code: Option<i64>,
    pub stdout: String,
    pub stderr: String,
    pub created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitFileRequest {
    pub path: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertWorkspaceFileRequest {
    pub path: String,
    pub cwd: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanges {
    pub ok: bool,
    pub cwd: String,
    pub is_git_repo: bool,
    pub summary: WorkspaceChangeSummary,
    pub files: Vec<WorkspaceChangeFile>,
    pub raw: WorkspaceChangeRaw,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangeSummary {
    pub files_changed: i64,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangeFile {
    pub path: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub patch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary: Option<bool>,
}

#[derive(Serialize)]
pub struct WorkspaceChangeRaw {
    pub status: String,
    pub stat: String,
    pub diff: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatsSummary {
    pub project_id: String,
    pub total_sessions: usize,
    pub running_sessions: usize,
    pub latest_session_updated_at: Option<String>,
    pub latest_check_status: Option<String>,
    pub preview_status_counts: std::collections::HashMap<String, u64>,
}
