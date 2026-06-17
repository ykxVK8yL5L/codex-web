use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSummary {
    pub id: String,
    pub scope_type: String,
    pub scope_id: String,
    pub label: String,
    pub target_host: String,
    pub port: i64,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub status: String,
    pub access: String,
    pub proxy_paths: Vec<String>,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct PreviewRecord {
    pub id: String,
    pub scope_type: String,
    pub scope_id: String,
    pub label: String,
    pub target_host: String,
    pub port: i64,
    pub token: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub status: String,
    pub access: String,
    pub proxy_paths: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePreviewRequest {
    pub scope_type: String,
    pub scope_id: String,
    pub label: Option<String>,
    pub target_host: Option<String>,
    pub port: i64,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub access: Option<String>,
    pub proxy_paths: Option<Vec<String>>,
    pub auto_start: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreviewAccessRequest {
    pub access: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreviewRequest {
    pub label: Option<String>,
    pub proxy_paths: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAccessResponse {
    pub url: String,
    pub preview: PreviewSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLogsResponse {
    pub preview_id: String,
    pub logs: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDeleteResponse {
    pub ok: bool,
}

impl PreviewRecord {
    pub fn public(&self) -> PreviewSummary {
        PreviewSummary {
            id: self.id.clone(),
            scope_type: self.scope_type.clone(),
            scope_id: self.scope_id.clone(),
            label: self.label.clone(),
            target_host: self.target_host.clone(),
            port: self.port,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            status: self.status.clone(),
            access: self.access.clone(),
            proxy_paths: self.proxy_paths.clone(),
            url: preview_url(&self.id, &self.token),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

pub fn preview_url(id: &str, token: &str) -> String {
    format!("/preview/{}/{}/", url_escape(id), url_escape(token))
}

fn url_escape(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}
