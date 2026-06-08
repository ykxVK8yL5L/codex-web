use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalSummary {
    pub id: String,
    pub action_type: String,
    pub risk: String,
    pub status: String,
    pub title: String,
    pub description: String,
    pub details: String,
    pub related: Option<serde_json::Value>,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub archived_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalGrantSummary {
    pub id: String,
    pub action_type: String,
    pub title: String,
    pub details: String,
    pub created_at: String,
    pub expires_at: Option<String>,
}
