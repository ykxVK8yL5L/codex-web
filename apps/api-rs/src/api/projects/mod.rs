pub(crate) mod changes;
pub(crate) mod history;
pub(crate) mod models;
pub(crate) mod store;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::common::parse_limit;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id/check", post(run_check))
        .route("/:id/check-runs", get(check_runs))
        .route("/:id/changes", get(project_changes))
        .route("/:id/changes/revert-file", post(revert_project_file))
        .route("/:id/changes/stage-file", post(stage_project_file))
        .route("/:id/changes/unstage-file", post(unstage_project_file))
        .route("/:id/git", post(run_git))
        .route("/:id/git-operations", get(git_operations))
        .route("/:id/sessions", get(project_sessions))
        .route("/:id/stats", get(project_stats))
        .route("/:id", get(detail).patch(update).delete(remove))
}

#[derive(Deserialize)]
struct PageQuery {
    limit: Option<String>,
}

#[derive(Deserialize)]
struct ProjectListQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ProjectListQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut projects = store::list_projects(&state.db).map_err(api_error)?;
    // Mirror TS: with no limit/cursor/q, return a bare array; otherwise a page object.
    if query.limit.is_none()
        && query.cursor.is_none()
        && query.q.as_deref().map(str::trim).unwrap_or("").is_empty()
    {
        return Ok(Json(
            serde_json::to_value(&projects).unwrap_or_else(|_| serde_json::json!([])),
        ));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    let cursor = decode_cursor(query.cursor.as_deref());
    let needle = query
        .q
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    projects.retain(|project| {
        needle.as_deref().map_or(true, |needle| {
            project.name.to_lowercase().contains(needle)
                || project.workspace_path.to_lowercase().contains(needle)
                || project.id.to_lowercase().contains(needle)
        })
    });
    projects.retain(|project| {
        cursor.as_ref().map_or(true, |(sort_value, cursor_id)| {
            project.name > *sort_value || (project.name == *sort_value && project.id > *cursor_id)
        })
    });
    projects.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    let has_more = projects.len() > limit;
    let items: Vec<_> = projects.into_iter().take(limit).collect();
    let next_cursor = if has_more {
        items.last().map(|item| encode_cursor(&item.name, &item.id))
    } else {
        None
    };
    Ok(Json(serde_json::json!({
        "items": items,
        "nextCursor": next_cursor,
        "hasMore": has_more,
    })))
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ProjectSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::get_project(&state.db, &id)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "project_not_found"))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::CreateProjectRequest>,
) -> Result<(StatusCode, Json<models::ProjectSummary>), (StatusCode, Json<serde_json::Value>)> {
    let project = store::create_project(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(project)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpdateProjectRequest>,
) -> Result<Json<models::ProjectSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::update_project(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "project_not_found"))
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if store::delete_project(&state.db, &id).map_err(api_error)? {
        Ok(Json(
            serde_json::json!({ "ok": true, "id": id, "deletedFiles": false }),
        ))
    } else {
        Err(json_error(StatusCode::NOT_FOUND, "project_not_found"))
    }
}

async fn run_check(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::RunProjectCheckRequest>,
) -> Result<Json<models::ProjectCheckRunSummary>, (StatusCode, Json<serde_json::Value>)> {
    let Some(project) = store::get_project(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    };
    let command = body
        .command
        .and_then(clean_optional)
        .or_else(|| project.check_commands.first().cloned())
        .ok_or_else(|| json_error(StatusCode::BAD_REQUEST, "check_command_missing"))?;
    history::run_check(&state.db, &project, command)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn check_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PageQuery>,
) -> Result<
    Json<crate::api::common::PageResponse<models::ProjectCheckRunSummary>>,
    (StatusCode, Json<serde_json::Value>),
> {
    if store::get_project(&state.db, &id)
        .map_err(api_error)?
        .is_none()
    {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    history::list_check_runs(&state.db, &id, limit)
        .map(Json)
        .map_err(api_error)
}

async fn run_git(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::ProjectGitOperationRequest>,
) -> Result<Json<models::ProjectGitOperationSummary>, (StatusCode, Json<serde_json::Value>)> {
    let Some(project) = store::get_project(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    };
    history::run_git(&state.db, &project, body)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn git_operations(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PageQuery>,
) -> Result<
    Json<crate::api::common::PageResponse<models::ProjectGitOperationSummary>>,
    (StatusCode, Json<serde_json::Value>),
> {
    if store::get_project(&state.db, &id)
        .map_err(api_error)?
        .is_none()
    {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    history::list_git_operations(&state.db, &id, limit)
        .map(Json)
        .map_err(api_error)
}

async fn project_changes(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let Some(project) = store::get_project(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    };
    changes::collect(&project.workspace_path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn stage_project_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::WorkspaceGitFileRequest>,
) -> Result<Json<models::WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let Some(project) = store::get_project(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    };
    if body.path.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "path_required"));
    }
    changes::stage_file(&project.workspace_path, &body.path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn unstage_project_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::WorkspaceGitFileRequest>,
) -> Result<Json<models::WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let Some(project) = store::get_project(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    };
    if body.path.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "path_required"));
    }
    changes::unstage_file(&project.workspace_path, &body.path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn revert_project_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::RevertWorkspaceFileRequest>,
) -> Result<Json<models::WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let Some(project) = store::get_project(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    };
    if body.path.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "path_required"));
    }
    changes::revert_file(&project.workspace_path, &body.path)
        .await
        .map(Json)
        .map_err(api_error)
}

#[derive(Deserialize)]
struct SessionsQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
    status: Option<String>,
}

async fn project_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<SessionsQuery>,
) -> Result<
    Json<crate::api::common::PageResponse<crate::api::sessions::models::SessionSummary>>,
    (StatusCode, Json<serde_json::Value>),
> {
    if store::get_project(&state.db, &id)
        .map_err(api_error)?
        .is_none()
    {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    let cursor = decode_cursor(query.cursor.as_deref());
    let needle = query
        .q
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)
        .map_err(api_error)?
        .into_iter()
        .filter(|session| session.project_id.as_deref() == Some(id.as_str()))
        .filter(|session| {
            needle.as_deref().map_or(true, |needle| {
                session.title.to_lowercase().contains(needle)
                    || session.id.to_lowercase().contains(needle)
                    || session.workspace_path.to_lowercase().contains(needle)
            })
        })
        .filter(|session| status.map_or(true, |status| session.status == status))
        .filter(|session| {
            cursor.as_ref().map_or(true, |(sort_value, cursor_id)| {
                session.updated_at < *sort_value
                    || (session.updated_at == *sort_value && session.id < *cursor_id)
            })
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| b.id.cmp(&a.id))
    });

    let has_more = sessions.len() > limit;
    let items = sessions.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = if has_more {
        items
            .last()
            .map(|item| encode_cursor(&item.updated_at, &item.id))
    } else {
        None
    };
    Ok(Json(crate::api::common::PageResponse {
        items,
        next_cursor,
        has_more,
    }))
}

async fn project_stats(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ProjectStatsSummary>, (StatusCode, Json<serde_json::Value>)> {
    if store::get_project(&state.db, &id)
        .map_err(api_error)?
        .is_none()
    {
        return Err(json_error(StatusCode::NOT_FOUND, "project_not_found"));
    }
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)
        .map_err(api_error)?
        .into_iter()
        .filter(|session| session.project_id.as_deref() == Some(id.as_str()))
        .collect::<Vec<_>>();
    let total_sessions = sessions.len();
    let running_sessions = sessions
        .iter()
        .filter(|session| session.status == "running")
        .count();
    let latest_session_updated_at = sessions
        .iter()
        .map(|session| session.updated_at.clone())
        .max();
    let latest_check_status = history::list_check_runs(&state.db, &id, 1)
        .map_err(api_error)?
        .items
        .into_iter()
        .next()
        .map(|run| run.status);
    let mut preview_status_counts: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();
    for preview in crate::api::previews::store::list(
        &state.db,
        Some("project"),
        Some(&id),
        None,
        None,
        None,
        usize::MAX,
    )
    .map_err(api_error)?
    {
        *preview_status_counts.entry(preview.status).or_insert(0) += 1;
    }
    Ok(Json(models::ProjectStatsSummary {
        project_id: id,
        total_sessions,
        running_sessions,
        latest_session_updated_at,
        latest_check_status,
        preview_status_counts,
    }))
}

fn encode_cursor(sort_value: &str, id: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(format!("{sort_value}\n{id}"))
}

fn decode_cursor(value: Option<&str>) -> Option<(String, String)> {
    use base64::Engine;
    let raw = value.map(str::trim).filter(|value| !value.is_empty())?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (sort_value, id) = text.split_once('\n')?;
    Some((sort_value.to_string(), id.to_string()))
}

fn api_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn json_error(
    status: StatusCode,
    error: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": error.into() })))
}

fn clean_optional(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
