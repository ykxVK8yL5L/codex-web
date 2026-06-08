pub(crate) mod cards;
pub(crate) mod compaction;
pub(crate) mod messages;
pub mod models;
pub mod queue;
pub mod store;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::state::AppState;

use super::common::{parse_limit, PageResponse};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(detail).patch(update).delete(remove))
        .route("/:id/messages", get(list_messages).post(append_message))
        .route(
            "/:id/compaction",
            get(get_compaction).patch(update_compaction),
        )
        .route("/:id/compactions", get(list_compactions))
        .route(
            "/:id/compactions/:compaction_id/restore",
            axum::routing::post(restore_compaction),
        )
        .route("/:id/compact", axum::routing::post(compact_session))
        .route("/:id/cards", get(list_cards))
        .route("/:id/cards/:card_id", axum::routing::delete(delete_card))
        .route(
            "/:id/queue",
            get(list_queue).post(enqueue_message).patch(reorder_queue),
        )
        .route(
            "/:id/queue/:queue_id",
            axum::routing::patch(update_queue).delete(delete_queue),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionListQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    status: Option<String>,
    include_automations: Option<String>,
    include_agent_children: Option<String>,
}

#[derive(Deserialize)]
struct MessagesQuery {
    limit: Option<String>,
    before: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<SessionListQuery>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let include_automations = matches!(query.include_automations.as_deref(), Some("true" | "1"));
    let include_agent_children =
        matches!(query.include_agent_children.as_deref(), Some("true" | "1"));
    let no_paging_filters = query.limit.is_none()
        && query.cursor.is_none()
        && query.q.is_none()
        && query.project_id.is_none()
        && query.status.is_none();
    let mut sessions = store::list_sessions(&state.db, include_automations, include_agent_children)
        .unwrap_or_default();
    if no_paging_filters {
        return Json(sessions).into_response();
    }
    let limit = parse_limit(query.limit.as_deref(), 30, 100);
    if let Some(q) = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
    {
        sessions.retain(|session| {
            session.title.to_lowercase().contains(&q)
                || session.workspace_path.to_lowercase().contains(&q)
                || session.id.to_lowercase().contains(&q)
        });
    }
    if let Some(project_id) = query
        .project_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        sessions.retain(|session| {
            if project_id == "scratch" {
                session.project_id.is_none()
            } else {
                session.project_id.as_deref() == Some(project_id)
            }
        });
    }
    if let Some(status) = query.status.as_deref().filter(|value| !value.is_empty()) {
        sessions.retain(|session| session.status == status);
    }
    if let Some(cursor) = crate::api::common::decode_page_cursor(query.cursor.as_deref()) {
        sessions.retain(|session| {
            session.updated_at < cursor.sort_value
                || (session.updated_at == cursor.sort_value && session.id < cursor.id)
        });
    }
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
            .and_then(|item| crate::api::common::encode_page_cursor(&item.updated_at, &item.id))
    } else {
        None
    };
    Json(PageResponse {
        items,
        next_cursor,
        has_more,
    })
    .into_response()
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::SessionSummary>, StatusCode> {
    store::get_session(&state.db, &id)
        .ok()
        .flatten()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::CreateSessionRequest>,
) -> Result<(StatusCode, Json<models::SessionSummary>), (StatusCode, Json<serde_json::Value>)> {
    let session = store::create_session(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpdateSessionRequest>,
) -> Result<Json<models::SessionSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::update_session(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "session_not_found"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteSessionQuery {
    delete_workspace: Option<String>,
    delete_logs: Option<String>,
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DeleteSessionQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(session) = store::get_session(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "session_not_found"));
    };
    let delete_workspace = query.delete_workspace.as_deref() == Some("true");
    let delete_logs = query.delete_logs.as_deref() == Some("true");
    if !delete_workspace {
        let _ = write_session_metadata(&state, &session);
    }
    if let Some(room_id) = session.room_id.clone() {
        let children = room_child_sessions(&state, &room_id).map_err(api_error)?;
        for child in children {
            if !delete_workspace {
                let _ = write_session_metadata(&state, &child);
            }
            let _ = store::delete_session(&state.db, &child.id);
            let _ = delete_session_data(&state, &child, delete_workspace, delete_logs);
        }
        let _ = delete_room_database_rows(&state, &room_id);
    }
    if store::delete_session(&state.db, &id).map_err(api_error)? {
        delete_session_data(&state, &session, delete_workspace, delete_logs).map_err(api_error)?;
        Ok(Json(serde_json::json!({ "ok": true, "id": id })))
    } else {
        Err(json_error(StatusCode::NOT_FOUND, "session_not_found"))
    }
}

async fn list_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<models::SessionMessagesPage>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    Ok(Json(
        messages::list(&state.db, &id, limit, query.before.as_deref()).map_err(api_error)?,
    ))
}

async fn append_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::AppendSessionMessageRequest>,
) -> Result<(StatusCode, Json<models::SessionMessage>), (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let message = messages::append(&state.db, &id, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(message)))
}

async fn list_queue(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<models::QueuedMessage>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    Ok(Json(queue::list(&state.db, &id).map_err(api_error)?))
}

#[derive(Deserialize)]
struct CompactionListQuery {
    limit: Option<String>,
}

async fn get_compaction(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<compaction::SessionCompactionGetResponse>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    compaction::get_latest_response(&state.db, &id)
        .map(Json)
        .map_err(api_error)
}

async fn list_compactions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<CompactionListQuery>,
) -> Result<Json<compaction::SessionCompactionListResponse>, (StatusCode, Json<serde_json::Value>)>
{
    ensure_session(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    compaction::list_response(&state.db, &id, limit)
        .map(Json)
        .map_err(api_error)
}

async fn update_compaction(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<compaction::UpdateSessionCompactionRequest>,
) -> Result<Json<compaction::SessionCompactionResponse>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    compaction::update_latest(&state.db, &session, body.summary.as_deref().unwrap_or(""))
        .map(Json)
        .map_err(api_error)
}

async fn restore_compaction(
    State(state): State<AppState>,
    Path((id, compaction_id)): Path<(String, String)>,
) -> Result<Json<compaction::SessionCompactionResponse>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    compaction::restore(&state.db, &session, &compaction_id)
        .map(Json)
        .map_err(api_error)
}

async fn compact_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<compaction::CreateSessionCompactionRequest>>,
) -> Result<Json<compaction::SessionCompactionResponse>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    compaction::create(&state.db, &session, body.map(|Json(value)| value))
        .await
        .map(Json)
        .map_err(api_error)
}

async fn list_cards(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<cards::MessageCardSummary>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    cards::list(&state.db, &id).map(Json).map_err(api_error)
}

async fn delete_card(
    State(state): State<AppState>,
    Path((id, card_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    match cards::delete(&state.db, &id, &card_id).map_err(api_error)? {
        cards::DeleteCardOutcome::Deleted(card_id) => {
            Ok(Json(serde_json::json!({ "ok": true, "id": card_id })))
        }
        cards::DeleteCardOutcome::NotFound => {
            Err(json_error(StatusCode::NOT_FOUND, "card_not_found"))
        }
    }
}

async fn enqueue_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::QueueMessageRequest>,
) -> Result<(StatusCode, Json<models::QueuedMessage>), (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    let item = queue::enqueue(&state.db, &session, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_queue(
    State(state): State<AppState>,
    Path((id, queue_id)): Path<(String, String)>,
    Json(body): Json<models::UpdateQueuedMessageRequest>,
) -> Result<Json<models::QueuedMessage>, (StatusCode, Json<serde_json::Value>)> {
    let session = ensure_session(&state, &id)?;
    queue::update(&state.db, &session, &queue_id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "queued_message_not_found"))
}

async fn reorder_queue(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::ReorderQueuedMessagesRequest>,
) -> Result<Json<Vec<models::QueuedMessage>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    queue::reorder(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::CONFLICT, "queued_message_order_mismatch"))
}

async fn delete_queue(
    State(state): State<AppState>,
    Path((id, queue_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    ensure_session(&state, &id)?;
    let _ = queue::delete(&state.db, &id, &queue_id).map_err(api_error)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn ensure_session(
    state: &AppState,
    id: &str,
) -> Result<models::SessionSummary, (StatusCode, Json<serde_json::Value>)> {
    store::get_session(&state.db, id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "session_not_found"))
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

fn session_data_path(state: &AppState, session_id: &str) -> std::path::PathBuf {
    state.db.data_dir.join("sessions").join(session_id)
}

fn write_session_metadata(
    state: &AppState,
    session: &models::SessionSummary,
) -> anyhow::Result<()> {
    let root = session_data_path(state, &session.id);
    std::fs::create_dir_all(&root)?;
    let project_name: Option<String> = if let Some(project_id) = session.project_id.as_deref() {
        let connection = state.db.open_read_only()?;
        connection.and_then(|connection| {
            connection
                .query_row(
                    "select name from projects where id = ?",
                    [project_id],
                    |row| row.get(0),
                )
                .ok()
        })
    } else {
        None
    };
    let payload = serde_json::json!({
        "id": session.id,
        "title": session.title,
        "kind": session.kind,
        "sessionType": session.conversation_type,
        "projectId": session.project_id,
        "projectName": project_name,
        "updatedAt": crate::api::common::timestamp(),
    });
    std::fs::write(
        root.join(".codex-web.json"),
        serde_json::to_string_pretty(&payload)?,
    )?;
    Ok(())
}

fn delete_session_data(
    state: &AppState,
    session: &models::SessionSummary,
    delete_workspace: bool,
    delete_logs: bool,
) -> anyhow::Result<()> {
    let root = session_data_path(state, &session.id);
    let _ = std::fs::remove_dir_all(root.join("context"));
    if delete_logs {
        let _ = std::fs::remove_file(root.join("logs").join("codex.log"));
        let _ = std::fs::remove_file(root.join("logs").join("codex.json"));
        let _ = std::fs::remove_file(
            state
                .db
                .data_dir
                .join("task-logs")
                .join(format!("{}.log", session.id)),
        );
        let _ = std::fs::remove_file(
            state
                .db
                .data_dir
                .join("task-logs")
                .join(format!("{}.json", session.id)),
        );
    }
    if delete_workspace {
        let mut candidates = vec![root.clone()];
        if !session.workspace_path.trim().is_empty() {
            candidates.push(std::path::PathBuf::from(&session.workspace_path));
        }
        if let Some(room_id) = session.room_id.as_deref() {
            candidates.push(state.db.data_dir.join("rooms").join(room_id));
            candidates.push(root.join("room"));
        }
        let sessions_root = state.db.data_dir.join("sessions");
        let rooms_root = state.db.data_dir.join("rooms");
        for candidate in candidates {
            let allowed =
                candidate.starts_with(&sessions_root) || candidate.starts_with(&rooms_root);
            if allowed {
                let _ = std::fs::remove_dir_all(candidate);
            }
        }
    }
    Ok(())
}

fn room_child_sessions(
    state: &AppState,
    room_id: &str,
) -> anyhow::Result<Vec<models::SessionSummary>> {
    let Some(connection) = state.db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists_local(&connection, "sessions")? {
        return Ok(Vec::new());
    }
    let mut stmt = connection
        .prepare("select id from sessions where conversation_type = 'agent' and room_id = ?")?;
    let ids = stmt
        .query_map([room_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    drop(connection);
    let mut sessions = Vec::new();
    for id in ids {
        if let Some(session) = store::get_session(&state.db, &id)? {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

fn delete_room_database_rows(state: &AppState, room_id: &str) -> anyhow::Result<()> {
    let connection = state.db.open_read_write()?;
    let room_task_ids = if table_exists_local(&connection, "room_tasks")? {
        let mut statement = connection.prepare("select id from room_tasks where room_id = ?")?;
        let rows = statement
            .query_map([room_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        Vec::new()
    };
    if table_exists_local(&connection, "notification_ephemeral_rules")? {
        for task_id in &room_task_ids {
            let _ = connection.execute(
                "delete from notification_ephemeral_rules where scope_type = 'room_task' and scope_id = ?",
                [task_id],
            );
        }
    }
    for table in [
        "room_agents",
        "room_events",
        "room_tasks",
        "room_artifacts",
        "room_handoffs",
        "room_decisions",
        "room_schedules",
        "room_run_merges",
        "room_agent_threads",
        "agent_runs",
    ] {
        if table_exists_local(&connection, table)? {
            let _ =
                connection.execute(&format!("delete from {table} where room_id = ?"), [room_id]);
        }
    }
    if table_exists_local(&connection, "execution_contexts")? {
        let _ = connection.execute(
            "delete from execution_contexts where room_id = ?",
            [room_id],
        );
    }
    if table_exists_local(&connection, "rooms")? {
        let _ = connection.execute("delete from rooms where id = ?", [room_id]);
    }
    Ok(())
}

fn table_exists_local(connection: &rusqlite::Connection, table: &str) -> anyhow::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}
