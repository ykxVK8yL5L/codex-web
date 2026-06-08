mod models;
pub(crate) mod runtime;
mod store;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", axum::routing::patch(update).delete(remove))
        .route("/:id/runs", get(runs).delete(clear_runs))
        .route(
            "/:id/runs/cancel-queued",
            axum::routing::post(cancel_queued_runs),
        )
        .route(
            "/:id/runs/stop-running",
            axum::routing::post(stop_running_runs),
        )
        .route("/:id/run", axum::routing::post(run_now))
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<AutomationListQuery>,
) -> Json<serde_json::Value> {
    let mut items = store::list(&state.db).unwrap_or_default();
    // Mirror TS: bare array when no list params, otherwise a page object.
    let has_params = query.limit.is_some()
        || query.cursor.is_some()
        || query
            .q
            .as_deref()
            .map(str::trim)
            .is_some_and(|v| !v.is_empty())
        || query
            .status
            .as_deref()
            .map(str::trim)
            .is_some_and(|v| !v.is_empty())
        || query
            .project_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|v| !v.is_empty())
        || query
            .action_type
            .as_deref()
            .map(str::trim)
            .is_some_and(|v| !v.is_empty());
    if !has_params {
        return Json(serde_json::to_value(&items).unwrap_or_else(|_| serde_json::json!([])));
    }
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
    let cursor = decode_cursor(query.cursor.as_deref());
    let needle = query
        .q
        .as_deref()
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty());
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty() && *v != "all");
    let action_type = query
        .action_type
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty() && *v != "all");
    let project_id = query
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty() && *v != "all");

    items.retain(|a| {
        needle.as_deref().map_or(true, |n| {
            a.name.to_lowercase().contains(n)
                || a.prompt.to_lowercase().contains(n)
                || a.command
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(n)
                || a.id.to_lowercase().contains(n)
        })
    });
    items.retain(|a| status.map_or(true, |s| a.status == s));
    items.retain(|a| action_type.map_or(true, |t| a.action_type == t));
    items.retain(|a| {
        project_id.map_or(true, |p| {
            if p == "global" {
                a.project_id.is_none()
            } else {
                a.project_id.as_deref() == Some(p)
            }
        })
    });
    items.retain(|a| {
        cursor.as_ref().map_or(true, |(sort_value, cursor_id)| {
            a.updated_at < *sort_value || (a.updated_at == *sort_value && a.id < *cursor_id)
        })
    });
    items.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    let has_more = items.len() > limit;
    let page: Vec<_> = items.into_iter().take(limit).collect();
    let next_cursor = if has_more {
        page.last().map(|a| encode_cursor(&a.updated_at, &a.id))
    } else {
        None
    };
    Json(serde_json::json!({ "items": page, "nextCursor": next_cursor, "hasMore": has_more }))
}

#[derive(Deserialize)]
struct AutomationListQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
    status: Option<String>,
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    #[serde(rename = "actionType")]
    action_type: Option<String>,
}

fn encode_cursor(sort_value: &str, id: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(format!("{sort_value}\n{id}"))
}

fn decode_cursor(value: Option<&str>) -> Option<(String, String)> {
    use base64::Engine;
    let raw = value.map(str::trim).filter(|v| !v.is_empty())?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (sort_value, id) = text.split_once('\n')?;
    Some((sort_value.to_string(), id.to_string()))
}

#[derive(Deserialize)]
struct RunsQuery {
    limit: Option<String>,
    cursor: Option<String>,
    status: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::AutomationInput>,
) -> Result<(StatusCode, Json<models::AutomationSummary>), (StatusCode, Json<serde_json::Value>)> {
    let automation = store::create(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(automation)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::AutomationInput>,
) -> Result<Json<models::AutomationSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::update(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "automation_not_found"))
}

#[derive(Deserialize)]
struct DeleteAutomationQuery {
    #[serde(rename = "deleteSession")]
    delete_session: Option<String>,
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DeleteAutomationQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(automation) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"));
    };
    let session = if query.delete_session.as_deref() == Some("false") {
        None
    } else {
        automation.session_id.as_deref().and_then(|session_id| {
            crate::api::sessions::store::get_session(&state.db, session_id)
                .ok()
                .flatten()
        })
    };
    if let Some(session) = session.as_ref() {
        let _ = crate::api::tasks::runner::stop_task(&state, &session.id);
    }
    if store::delete(&state.db, &id).map_err(api_error)? {
        if let Some(session) = session {
            let _ = crate::api::sessions::store::delete_session(&state.db, &session.id);
            let _ = delete_session_data_for_automation(&state, &session, true, true);
        }
        Ok(Json(serde_json::json!({ "ok": true, "id": id })))
    } else {
        Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"))
    }
}

async fn runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<RunsQuery>,
) -> Result<
    Json<crate::api::common::PageResponse<models::AutomationRunSummary>>,
    (StatusCode, Json<serde_json::Value>),
> {
    if store::get(&state.db, &id).map_err(api_error)?.is_none() {
        return Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"));
    }
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
    let cursor = crate::api::common::decode_page_cursor(query.cursor.as_deref());
    store::runs(
        &state.db,
        &id,
        limit,
        query.status.as_deref(),
        cursor.as_ref(),
    )
    .map(Json)
    .map_err(api_error)
}

async fn clear_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if store::get(&state.db, &id).map_err(api_error)?.is_none() {
        return Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"));
    }
    let cleared = store::clear_finished_runs(&state.db, &id).map_err(api_error)?;
    Ok(Json(serde_json::json!({ "ok": true, "cleared": cleared })))
}

async fn cancel_queued_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(automation) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"));
    };
    let canceled = store::cancel_queued_runs(&state.db, &id).map_err(api_error)?;
    if canceled > 0 {
        if let Some(session_id) = automation
            .session_id
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            let _ = crate::api::sessions::messages::append(
                &state.db,
                session_id,
                crate::api::sessions::models::AppendSessionMessageRequest {
                    role: Some("system".to_string()),
                    content: Some(format!(
                        "Automation queued runs canceled: {} ({})",
                        automation.name,
                        crate::api::common::timestamp()
                    )),
                    reply_to_message_id: None,
                },
            );
        }
    }
    let automation = store::get(&state.db, &id)
        .map_err(api_error)?
        .unwrap_or(automation);
    Ok(Json(
        serde_json::json!({ "ok": true, "canceled": canceled, "automation": automation }),
    ))
}

async fn stop_running_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(automation) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"));
    };
    let result = runtime::stop_running(&state, &id).map_err(api_error)?;
    if !result.found {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            "automation_run_not_found",
        ));
    }
    let automation = store::get(&state.db, &id)
        .map_err(api_error)?
        .unwrap_or(automation);
    Ok(Json(
        serde_json::json!({ "ok": true, "stopped": result.stopped, "session": result.session, "automation": automation }),
    ))
}

async fn run_now(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let Some(automation) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "automation_not_found"));
    };
    let response = runtime::run_now(state, automation)
        .await
        .map_err(api_error)?;
    // TS returns the SessionSummary itself with an extra automationRunStatus field. The frontend
    // calls onOpenSession(session.id), so wrapping in { session, ... } breaks "run and open".
    let mut value =
        serde_json::to_value(&response.session).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "automationRunStatus".to_string(),
            serde_json::json!(response.automation_run_status),
        );
        object.insert(
            "run".to_string(),
            serde_json::to_value(response.run).unwrap_or(serde_json::Value::Null),
        );
    }
    Ok((StatusCode::CREATED, Json(value)))
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

fn delete_session_data_for_automation(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    delete_workspace: bool,
    delete_logs: bool,
) -> anyhow::Result<()> {
    let root = state.db.data_dir.join("sessions").join(&session.id);
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
