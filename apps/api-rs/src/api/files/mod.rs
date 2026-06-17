pub(crate) mod archive;
mod models;
mod paths;
pub(crate) mod store;

use std::{fs, path::PathBuf};

use axum::{
    extract::{DefaultBodyLimit, Multipart, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/file-mounts", get(file_mounts))
        .route("/file-mounts", post(create_file_mount))
        .route(
            "/file-mounts/:id",
            patch(update_file_mount).delete(delete_file_mount),
        )
        .route(
            "/files",
            get(list_files)
                .post(create_file)
                .patch(rename_file)
                .delete(delete_file),
        )
        .route(
            "/files/upload",
            post(upload_files).layer(DefaultBodyLimit::max(100 * 1024 * 1024)),
        )
        .route("/files/archive", post(archive_download))
        .route("/files/archive/preview", post(archive_preview))
        .route("/files/archive/templates", get(archive_templates))
        .route("/files/content", get(file_content).put(save_file_content))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileQuery {
    path: Option<String>,
    mount_id: Option<String>,
    root_path: Option<String>,
}

async fn file_mounts(State(state): State<AppState>) -> Json<Vec<models::FileMount>> {
    Json(store::list_mounts(&state.db).unwrap_or_default())
}

async fn create_file_mount(
    State(state): State<AppState>,
    Json(body): Json<models::CreateFileMountRequest>,
) -> Result<(StatusCode, Json<models::FileMount>), (StatusCode, Json<serde_json::Value>)> {
    let mount = store::create_mount(&state.db, &body.name, &body.root_path).map_err(bad_request)?;
    Ok((StatusCode::CREATED, Json(mount)))
}

async fn update_file_mount(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<models::UpdateFileMountRequest>,
) -> Result<Json<models::FileMount>, (StatusCode, Json<serde_json::Value>)> {
    store::update_mount(
        &state.db,
        &id,
        body.name.as_deref(),
        body.root_path.as_deref(),
    )
    .map_err(bad_request)?
    .map(Json)
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "mount_not_found"))
}

async fn delete_file_mount(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Mirror TS: deleting a mount always succeeds (a missing id simply deletes 0 rows).
    store::delete_mount(&state.db, &id).map_err(bad_request)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_files(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<Json<models::FileListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = PathBuf::from(&mount.root_path);
    let absolute = paths::resolve_inside_root(&root, query.path.as_deref()).map_err(bad_request)?;
    let metadata = store::stat(&absolute).map_err(bad_request)?;
    if !metadata.is_dir() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_directory"));
    }
    let root = paths::normalize_path(&root).map_err(bad_request)?;
    let mut entries = fs::read_dir(&absolute)
        .map_err(|err| bad_request(err.into()))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy() != ".DS_Store")
        .filter_map(|entry| file_entry(entry.path(), &root).ok())
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        left.kind
            .cmp(right.kind)
            .reverse()
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    let parent_path = if absolute == root {
        None
    } else {
        absolute
            .parent()
            .map(|parent| paths::relative_path(parent, &root))
    };
    Ok(Json(models::FileListResponse {
        mount_id: mount.id,
        root: root.display().to_string(),
        path: paths::relative_path(&absolute, &root),
        parent_path,
        entries,
    }))
}

async fn file_content(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<Json<models::FileContentResponse>, (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let absolute = paths::resolve_inside_root(&root, query.path.as_deref()).map_err(bad_request)?;
    let metadata = store::stat(&absolute).map_err(bad_request)?;
    if !metadata.is_file() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_file"));
    }
    if metadata.len() > 1024 * 1024 {
        return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "file_too_large"));
    }
    let content = fs::read_to_string(&absolute).map_err(|err| bad_request(err.into()))?;
    Ok(Json(models::FileContentResponse {
        path: paths::relative_path(&absolute, &root),
        content,
        updated_at: store::file_time(
            metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        ),
    }))
}

async fn save_file_content(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    Json(body): Json<models::SaveFileRequest>,
) -> Result<Json<models::FileContentResponse>, (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let absolute = paths::resolve_inside_root(&root, query.path.as_deref()).map_err(bad_request)?;
    let metadata = store::stat(&absolute).map_err(bad_request)?;
    if !metadata.is_file() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_file"));
    }
    fs::write(&absolute, &body.content).map_err(|err| bad_request(err.into()))?;
    let metadata = store::stat(&absolute).map_err(bad_request)?;
    Ok(Json(models::FileContentResponse {
        path: paths::relative_path(&absolute, &root),
        content: body.content,
        updated_at: store::file_time(
            metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        ),
    }))
}

async fn create_file(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    Json(body): Json<models::CreateFileRequest>,
) -> Result<(StatusCode, Json<models::FileEntry>), (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let clean_name = clean_child_name(&body.name).map_err(bad_request)?;
    if body.parent_path.trim().is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_create_request"));
    }
    let parent = paths::resolve_inside_root(&root, Some(&body.parent_path)).map_err(bad_request)?;
    if !parent.is_dir() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_directory"));
    }
    let target = parent.join(clean_name);
    let target = paths::resolve_child_path(&root, &target).map_err(bad_request)?;
    if target.exists() {
        return Err(error(StatusCode::CONFLICT, "already_exists"));
    }
    match body.kind.as_str() {
        "directory" => fs::create_dir(&target).map_err(|err| bad_request(err.into()))?,
        "file" => {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|err| bad_request(err.into()))?;
        }
        _ => return Err(error(StatusCode::BAD_REQUEST, "invalid_create_request")),
    }
    Ok((
        StatusCode::CREATED,
        Json(file_entry(target, &root).map_err(bad_request)?),
    ))
}

async fn rename_file(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    Json(body): Json<models::RenameFileRequest>,
) -> Result<Json<models::FileEntry>, (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let source = paths::resolve_inside_root(&root, Some(&body.path)).map_err(bad_request)?;
    if source == root {
        return Err(error(StatusCode::BAD_REQUEST, "cannot_rename_root"));
    }
    let clean_name = clean_child_name(&body.new_name).map_err(bad_request)?;
    let parent = source
        .parent()
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "invalid_rename_request"))?;
    let target = paths::resolve_child_path(&root, &parent.join(clean_name)).map_err(bad_request)?;
    if target.exists() {
        return Err(error(StatusCode::CONFLICT, "already_exists"));
    }
    fs::rename(&source, &target).map_err(|err| bad_request(err.into()))?;
    Ok(Json(file_entry(target, &root).map_err(bad_request)?))
}

async fn delete_file(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let target = paths::resolve_inside_root(&root, query.path.as_deref()).map_err(bad_request)?;
    if target == root {
        return Err(error(StatusCode::BAD_REQUEST, "cannot_delete_root"));
    }
    let name = target
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_default();
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|err| bad_request(err.into()))?;
    } else {
        fs::remove_file(&target).map_err(|err| bad_request(err.into()))?;
    }
    Ok(Json(serde_json::json!({ "ok": true, "path": name })))
}

async fn upload_files(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Vec<models::FileEntry>>), (StatusCode, Json<serde_json::Value>)> {
    let mount = store::resolve_mount(
        &state.db,
        query.mount_id.as_deref(),
        query.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let parent = paths::resolve_inside_root(&root, query.path.as_deref()).map_err(bad_request)?;
    if !parent.is_dir() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_directory"));
    }

    let mut pending = Vec::new();
    let mut names = std::collections::HashSet::new();
    while let Some(field) = multipart.next_field().await.map_err(|err| bad_request(err.into()))? {
        if field.name() != Some("files") {
            continue;
        }
        let Some(file_name) = field.file_name().map(|name| name.to_string()) else {
            continue;
        };
        let clean_name = clean_child_name(&file_name).map_err(bad_request)?.to_string();
        if !names.insert(clean_name.clone()) {
            return Err(error(StatusCode::CONFLICT, "already_exists"));
        }
        let bytes = field.bytes().await.map_err(|err| bad_request(err.into()))?;
        pending.push((clean_name, bytes));
    }

    if pending.is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "no_files"));
    }

    let mut targets = Vec::new();
    for (name, bytes) in pending {
        let target = paths::resolve_child_path(&root, &parent.join(&name)).map_err(bad_request)?;
        if target.exists() {
            return Err(error(StatusCode::CONFLICT, "already_exists"));
        }
        targets.push((target, bytes));
    }

    let mut uploaded = Vec::new();
    for (target, bytes) in targets {
        fs::write(&target, bytes).map_err(|err| bad_request(err.into()))?;
        uploaded.push(file_entry(target, &root).map_err(bad_request)?);
    }
    Ok((StatusCode::CREATED, Json(uploaded)))
}

async fn archive_preview(
    State(state): State<AppState>,
    Json(body): Json<models::FileArchiveRequest>,
) -> Result<Json<models::FileArchivePreviewResponse>, (StatusCode, Json<serde_json::Value>)> {
    if body.path.trim().is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_archive_request"));
    }
    let mount = store::resolve_mount(
        &state.db,
        body.mount_id.as_deref(),
        body.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let absolute = paths::resolve_inside_root(&root, Some(&body.path)).map_err(bad_request)?;
    let metadata = store::stat(&absolute).map_err(bad_request)?;
    if !metadata.is_dir() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_directory"));
    }
    Ok(Json(
        archive::preview(&absolute, &body.excludes).map_err(bad_request)?,
    ))
}

async fn archive_templates(
) -> Result<Json<Vec<models::ArchiveIgnoreTemplate>>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(archive::templates().map_err(bad_request)?))
}

async fn archive_download(
    State(state): State<AppState>,
    Json(body): Json<models::FileArchiveRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if body.path.trim().is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_archive_request"));
    }
    let mount = store::resolve_mount(
        &state.db,
        body.mount_id.as_deref(),
        body.root_path.as_deref(),
    )
    .map_err(bad_request)?;
    let root = paths::normalize_path(&PathBuf::from(&mount.root_path)).map_err(bad_request)?;
    let absolute = paths::resolve_inside_root(&root, Some(&body.path)).map_err(bad_request)?;
    let metadata = store::stat(&absolute).map_err(bad_request)?;
    if !metadata.is_dir() {
        return Err(error(StatusCode::BAD_REQUEST, "not_a_directory"));
    }
    let safe_name = safe_archive_name(&absolute);
    let archive =
        archive::create_zip(&absolute, &safe_name, &body.excludes).map_err(bad_request)?;
    let disposition = format!("attachment; filename=\"{safe_name}.zip\"");
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/zip"),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&disposition).unwrap_or_else(|_| {
                    HeaderValue::from_static("attachment; filename=\"archive.zip\"")
                }),
            ),
        ],
        archive,
    ))
}

fn file_entry(path: PathBuf, root: &std::path::Path) -> anyhow::Result<models::FileEntry> {
    let metadata = store::stat(&path)?;
    Ok(models::FileEntry {
        name: path
            .file_name()
            .map(|item| item.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: paths::relative_path(&path, root),
        kind: if metadata.is_dir() {
            "directory"
        } else {
            "file"
        },
        size: metadata.len(),
        updated_at: store::file_time(
            metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        ),
    })
}

fn clean_child_name(value: &str) -> anyhow::Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.contains('/') || value.contains('\\') {
        anyhow::bail!("invalid_name");
    }
    Ok(value)
}

fn safe_archive_name(path: &std::path::Path) -> String {
    let value = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "archive".to_string());
    let value = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let value = value.trim_matches('-').to_string();
    if value.is_empty() {
        "archive".to_string()
    } else {
        value
    }
}

fn bad_request(err: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    error(StatusCode::BAD_REQUEST, err.to_string())
}

fn error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message.into() })))
}
