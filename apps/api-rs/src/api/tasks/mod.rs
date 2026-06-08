pub mod activity;
pub mod details;
pub mod diff;
pub mod events;
pub mod runner;
pub mod runs;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::api::projects::changes;
use crate::api::projects::models::{
    RevertWorkspaceFileRequest, WorkspaceChanges, WorkspaceGitFileRequest,
};
use crate::state::AppState;

use super::sessions::{models, queue, store};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", axum::routing::post(create_task))
        .route("/:id", get(task_detail))
        .route("/:id/messages", axum::routing::post(continue_task))
        .route("/:id/recover", axum::routing::post(recover_task))
        .route("/:id/log", get(task_log))
        .route("/:id/activity", get(task_activity))
        .route("/:id/events", get(task_events))
        .route("/:id/diff", get(task_diff))
        .route("/:id/changes", get(task_changes))
        .route(
            "/:id/changes/revert-file",
            axum::routing::post(task_revert_file),
        )
        .route(
            "/:id/changes/stage-file",
            axum::routing::post(task_stage_file),
        )
        .route(
            "/:id/changes/unstage-file",
            axum::routing::post(task_unstage_file),
        )
        .route("/:id/context", get(task_context))
        .route("/:id/context/:file", get(task_context_file))
        .route("/runs", get(list_runs))
        .route("/runs/:run_id/finish", axum::routing::post(finish_run))
        .route("/:id/runs", get(list_session_runs))
        .route("/:id/stop", axum::routing::post(stop_session_runs))
        .route(
            "/:id/queue",
            get(list_queue).post(enqueue_message).patch(reorder_queue),
        )
        .route(
            "/:id/queue/:queue_id",
            axum::routing::patch(update_queue).delete(delete_queue),
        )
}

pub fn task_runs_router() -> Router<AppState> {
    Router::new().route("/", get(list_runs))
}

#[derive(Deserialize)]
struct RunsQuery {
    status: Option<String>,
    limit: Option<String>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
struct LogQuery {
    #[serde(rename = "maxBytes")]
    max_bytes: Option<String>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<runner::CreateCodexTaskRequest>,
) -> Result<(StatusCode, Json<models::SessionSummary>), (StatusCode, Json<serde_json::Value>)> {
    let session = runner::create_task(state, body).await.map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn continue_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<runner::ContinueCodexTaskRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    match runner::continue_task(state, id, body)
        .await
        .map_err(api_error)?
    {
        runner::ContinueTaskOutcome::Session(session) => Ok((
            StatusCode::OK,
            Json(serde_json::to_value(session).unwrap_or_else(|_| serde_json::json!({}))),
        )),
        runner::ContinueTaskOutcome::Queued(item) => Ok((
            StatusCode::ACCEPTED,
            Json(serde_json::to_value(item).unwrap_or_else(|_| serde_json::json!({}))),
        )),
    }
}

async fn recover_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<runner::RecoverCodexTaskRequest>,
) -> Result<(StatusCode, Json<details::CodexTaskDetail>), (StatusCode, Json<serde_json::Value>)> {
    let session = runner::recover_task(state.clone(), id, body)
        .await
        .map_err(api_error)?;
    let detail = details::detail(&state.db, &session.id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_not_found"))?;
    Ok((StatusCode::ACCEPTED, Json(detail)))
}

async fn task_detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<details::CodexTaskDetail>, (StatusCode, Json<serde_json::Value>)> {
    details::detail(&state.db, &id)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_not_found"))
}

async fn task_log(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LogQuery>,
) -> Result<Json<details::TaskLogResponse>, (StatusCode, Json<serde_json::Value>)> {
    let max_bytes = crate::api::common::parse_limit(query.max_bytes.as_deref(), 80_000, 300_000);
    details::log(&state.db, &id, max_bytes)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_not_found"))
}

#[derive(Deserialize)]
struct ActivityQuery {
    limit: Option<String>,
    cursor: Option<String>,
}

async fn task_activity(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<activity::TaskActivityResponse>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 30, 100);
    let cursor = query
        .cursor
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    activity::list_response(&state.db, &id, limit, cursor)
        .map(Json)
        .map_err(api_error)
}

async fn task_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    use axum::response::IntoResponse;
    ensure_session(&state, &id)?;
    Ok(events::stream(state.clone(), id).into_response())
}

async fn task_diff(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<diff::CodexTaskDiff>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    Ok(Json(diff::diff(&session.workspace_path).await))
}

async fn task_changes(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    changes::collect(&session.workspace_path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn task_revert_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RevertWorkspaceFileRequest>,
) -> Result<Json<WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    if body.path.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "path_required"));
    }
    let cwd = resolve_workspace_action_cwd(&session, body.cwd.as_deref());
    changes::revert_file(&cwd, &body.path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn task_stage_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<WorkspaceGitFileRequest>,
) -> Result<Json<WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    if body.path.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "path_required"));
    }
    let cwd = resolve_workspace_action_cwd(&session, body.cwd.as_deref());
    changes::stage_file(&cwd, &body.path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn task_unstage_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<WorkspaceGitFileRequest>,
) -> Result<Json<WorkspaceChanges>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    if body.path.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "path_required"));
    }
    let cwd = resolve_workspace_action_cwd(&session, body.cwd.as_deref());
    changes::unstage_file(&cwd, &body.path)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn task_context(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<details::TaskContextResponse>, (StatusCode, Json<serde_json::Value>)> {
    details::context_files(&state.db, &id)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_not_found"))
}

async fn task_context_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Json<details::TaskContextFileResponse>, (StatusCode, Json<serde_json::Value>)> {
    details::context_file(&state.db, &id, &file)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_not_found"))
}

async fn list_runs(
    State(state): State<AppState>,
    Query(query): Query<RunsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 50, 100);
    let cursor = crate::api::common::decode_page_cursor(query.cursor.as_deref());
    let items = runs::list(
        &state.db,
        query.status.as_deref(),
        limit + 1,
        cursor.as_ref(),
    )
    .map_err(api_error)?;
    Ok(Json(page(items, limit)))
}

async fn list_session_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<RunsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
    let cursor = crate::api::common::decode_page_cursor(query.cursor.as_deref());
    let items =
        runs::list_for_session(&state.db, &id, limit + 1, cursor.as_ref()).map_err(api_error)?;
    Ok(Json(page(items, limit)))
}

async fn finish_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(body): Json<runs::FinishTaskRunRequest>,
) -> Result<Json<runs::TaskRunSummary>, (StatusCode, Json<serde_json::Value>)> {
    runs::finish(&state.db, &run_id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_run_not_found"))
}

async fn stop_session_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    // Signal the runner to kill the child + mark the run stop-requested.
    let _ = runner::stop_task(&state, &id).map_err(api_error)?;
    // Mirror TS: immediately move the session out of "running" so the UI stops showing "outputting"
    // (even across a refresh) instead of waiting for the async runner-completion to flip the status.
    let session = store::update_runtime(
        &state.db,
        &id,
        models::SessionRuntimeUpdate {
            status: Some("paused".to_string()),
            ..Default::default()
        },
    )
    .map_err(api_error)?;
    if let Ok(message) = super::sessions::messages::append(
        &state.db,
        &id,
        models::AppendSessionMessageRequest {
            role: Some("assistant".to_string()),
            content: Some(format!(
                "用户主动停止任务。停止时间：{}。待发送队列：{} 条。",
                crate::api::common::timestamp(),
                queue::list(&state.db, &id)
                    .map(|items| items.len())
                    .unwrap_or(0)
            )),
            reply_to_message_id: None,
        },
    ) {
        if let Some(session) = session.as_ref() {
            events::publish_message(&state, session, &message);
        }
    }
    if let Some(session) = session.as_ref() {
        events::publish_error(&state, session, "paused");
    }
    match session {
        Some(session) => Ok(Json(
            serde_json::to_value(session).unwrap_or_else(|_| serde_json::json!({ "ok": true })),
        )),
        None => Ok(Json(serde_json::json!({ "ok": true, "sessionId": id }))),
    }
}

async fn list_queue(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<models::QueuedMessage>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    Ok(Json(queue::list(&state.db, &id).map_err(api_error)?))
}

async fn enqueue_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::QueueMessageRequest>,
) -> Result<(StatusCode, Json<models::QueuedMessage>), (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    let item = queue::enqueue(&state.db, &session, body).map_err(api_error)?;
    events::publish_queue(&state, &session);
    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_queue(
    State(state): State<AppState>,
    Path((id, queue_id)): Path<(String, String)>,
    Json(body): Json<models::UpdateQueuedMessageRequest>,
) -> Result<Json<models::QueuedMessage>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    let item = queue::update(&state.db, &session, &queue_id, body)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "queued_message_not_found"))?;
    events::publish_queue(&state, &session);
    Ok(Json(item))
}

async fn reorder_queue(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::ReorderQueuedMessagesRequest>,
) -> Result<Json<Vec<models::QueuedMessage>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let queue_items = queue::reorder(&state.db, &id, body)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::CONFLICT, "queued_message_order_mismatch"))?;
    if let Ok(session) = ensure_session(&state, &id) {
        events::publish_queue(&state, &session);
    }
    Ok(Json(queue_items))
}

async fn delete_queue(
    State(state): State<AppState>,
    Path((id, queue_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let _ = queue::delete(&state.db, &id, &queue_id).map_err(api_error)?;
    if let Ok(session) = ensure_session(&state, &id) {
        events::publish_queue(&state, &session);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn resolve_workspace_action_cwd(session: &models::SessionSummary, cwd: Option<&str>) -> String {
    cwd.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| session.workspace_path.clone())
}

fn ensure_session(
    state: &AppState,
    id: &str,
) -> Result<models::SessionSummary, (StatusCode, Json<serde_json::Value>)> {
    store::get_session(&state.db, id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "task_not_found"))
}

fn api_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    let message = error.to_string();
    let status = match message.as_str() {
        "task_not_found" => StatusCode::NOT_FOUND,
        "task_running" | "attachments_cannot_queue" => StatusCode::CONFLICT,
        _ => StatusCode::BAD_REQUEST,
    };
    json_error(status, message)
}

fn json_error(
    status: StatusCode,
    error: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": error.into() })))
}

fn page<T: serde::Serialize + RunPageItem>(mut items: Vec<T>, limit: usize) -> serde_json::Value {
    let has_more = items.len() > limit;
    items.truncate(limit);
    let next_cursor = if has_more {
        items.last().and_then(|item| {
            crate::api::common::encode_page_cursor(item.sort_value(), item.item_id())
        })
    } else {
        None
    };
    serde_json::json!({ "items": items, "nextCursor": next_cursor, "hasMore": has_more })
}

trait RunPageItem {
    fn sort_value(&self) -> &str;
    fn item_id(&self) -> &str;
}

impl RunPageItem for runs::TaskRunSummary {
    fn sort_value(&self) -> &str {
        &self.started_at
    }
    fn item_id(&self) -> &str {
        &self.id
    }
}
