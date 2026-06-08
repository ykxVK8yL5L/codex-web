use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoleSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub source_url: Option<String>,
    pub markdown_content: String,
    pub system_prompt: String,
    pub capabilities: Vec<String>,
    pub default_listen_mode: String,
    pub default_listen_events: Vec<String>,
    pub default_workspace_mode: String,
    pub default_sandbox_mode: Option<String>,
    pub default_approval_policy: Option<String>,
    pub output_contract: Option<String>,
    pub safety_notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl AgentRoleSummary {
    /// TS treats an empty description as null when echoing back for updates.
    pub fn description_option(&self) -> Option<String> {
        if self.description.trim().is_empty() {
            None
        } else {
            Some(self.description.clone())
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGroupSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub agent_ids: Vec<String>,
    pub member_listen_modes: serde_json::Value,
    pub collaboration_rules: String,
    pub event_routing_rules: String,
    pub max_concurrent_agents: i64,
    pub approval_policy: String,
    pub merge_strategy: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCircleSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub role_ids: Vec<String>,
    pub collaboration_rules: String,
    pub event_routing_rules: String,
    pub max_concurrent_agents: i64,
    pub approval_policy: String,
    pub merge_strategy: String,
    pub group_template_id: Option<String>,
    pub builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionProfileSummary {
    pub id: String,
    pub permissions: serde_json::Value,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRoleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub source_type: Option<String>,
    pub source_path: Option<String>,
    pub source_url: Option<String>,
    pub markdown_content: Option<String>,
    pub system_prompt: Option<String>,
    pub include_description_in_prompt: Option<bool>,
    pub capabilities: Option<Vec<String>>,
    pub default_listen_mode: Option<String>,
    pub default_listen_events: Option<Vec<String>>,
    pub default_workspace_mode: Option<String>,
    pub default_sandbox_mode: Option<String>,
    pub default_approval_policy: Option<String>,
    pub output_contract: Option<String>,
    pub safety_notes: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentRoleRequest {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub source_type: Option<String>,
    pub source_path: Option<Option<String>>,
    pub source_url: Option<Option<String>>,
    pub markdown_content: Option<String>,
    pub system_prompt: Option<String>,
    pub include_description_in_prompt: Option<bool>,
    pub capabilities: Option<Vec<String>>,
    pub default_listen_mode: Option<String>,
    pub default_listen_events: Option<Vec<String>>,
    pub default_workspace_mode: Option<String>,
    pub default_sandbox_mode: Option<Option<String>>,
    pub default_approval_policy: Option<Option<String>>,
    pub output_contract: Option<Option<String>>,
    pub safety_notes: Option<Option<String>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRoleFromTemplateRequest {
    pub template_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub include_description_in_prompt: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportRoleFileRequest {
    pub path: Option<String>,
    pub name: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    pub name: Option<String>,
    pub role_id: Option<String>,
    pub description: Option<String>,
    pub extra_prompt: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub workspace_mode: Option<String>,
    pub default_project_id: Option<String>,
    pub favorite_project_ids: Option<Vec<String>>,
    pub project_access_mode: Option<String>,
    pub allowed_project_ids: Option<Vec<String>>,
    pub permission_profile_id: Option<String>,
    pub permissions: Option<serde_json::Value>,
    pub max_concurrent_runs: Option<serde_json::Value>,
    pub enabled: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentRequest {
    pub name: Option<String>,
    pub role_id: Option<String>,
    pub description: Option<Option<String>>,
    pub extra_prompt: Option<Option<String>>,
    pub provider_id: Option<Option<String>>,
    pub model: Option<Option<String>>,
    pub workspace_mode: Option<String>,
    pub default_project_id: Option<Option<String>>,
    pub favorite_project_ids: Option<Vec<String>>,
    pub project_access_mode: Option<String>,
    pub allowed_project_ids: Option<Vec<String>>,
    pub permission_profile_id: Option<Option<String>>,
    pub permissions: Option<serde_json::Value>,
    pub max_concurrent_runs: Option<serde_json::Value>,
    pub enabled: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentBatchRequest {
    pub ids: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentSessionRequest {
    pub project_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentGroupRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub agent_ids: Option<Vec<String>>,
    pub member_listen_modes: Option<serde_json::Value>,
    pub collaboration_rules: Option<String>,
    pub event_routing_rules: Option<String>,
    pub max_concurrent_agents: Option<serde_json::Value>,
    pub approval_policy: Option<String>,
    pub merge_strategy: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentGroupRequest {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub agent_ids: Option<Vec<String>>,
    pub member_listen_modes: Option<serde_json::Value>,
    pub collaboration_rules: Option<String>,
    pub event_routing_rules: Option<String>,
    pub max_concurrent_agents: Option<serde_json::Value>,
    pub approval_policy: Option<String>,
    pub merge_strategy: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentCircleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub role_ids: Option<Vec<String>>,
    pub collaboration_rules: Option<String>,
    pub event_routing_rules: Option<String>,
    pub max_concurrent_agents: Option<serde_json::Value>,
    pub approval_policy: Option<String>,
    pub merge_strategy: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentCircleRequest {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub role_ids: Option<Vec<String>>,
    pub collaboration_rules: Option<String>,
    pub event_routing_rules: Option<String>,
    pub max_concurrent_agents: Option<serde_json::Value>,
    pub approval_policy: Option<String>,
    pub merge_strategy: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStats {
    pub agent_id: String,
    pub total_runs: i64,
    pub running_runs: i64,
    pub successful_runs: i64,
    pub failed_runs: i64,
    pub direct_sessions: i64,
    pub average_duration_ms: i64,
    pub latest_run_at: Option<String>,
}
