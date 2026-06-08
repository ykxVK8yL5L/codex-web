use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMount {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileListResponse {
    pub mount_id: String,
    pub root: String,
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentResponse {
    pub path: String,
    pub content: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileMountRequest {
    pub name: String,
    pub root_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFileMountRequest {
    pub name: Option<String>,
    pub root_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileRequest {
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileRequest {
    pub parent_path: String,
    pub name: String,
    pub kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFileRequest {
    pub path: String,
    pub new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileArchiveRequest {
    pub path: String,
    pub mount_id: Option<String>,
    pub root_path: Option<String>,
    pub excludes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileArchivePreviewResponse {
    pub files: i64,
    pub bytes: u64,
    pub excluded: i64,
    pub excluded_examples: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveIgnoreTemplate {
    pub id: String,
    pub name: String,
    pub group: String,
    pub rules: String,
}
