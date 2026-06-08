pub(crate) mod events;
pub(crate) mod models;
pub(crate) mod runtime;
pub(crate) mod store;

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::common::{decode_page_cursor, encode_page_cursor, parse_limit, PageResponse};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id/access", post(grant_access).put(update_access))
        .route("/:id/logs", get(logs))
        .route("/:id/logs/events", get(logs_events))
        .route("/:id/start", post(start))
        .route("/:id/stop", post(stop))
        .route("/:id", patch(update).delete(remove))
}

/// `GET /api/previews/:id/logs/events` — SSE stream of preview log lines.
async fn logs_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let Some(preview) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    Ok(events::stream(state, preview).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    scope_type: Option<String>,
    scope_id: Option<String>,
    status: Option<String>,
    q: Option<String>,
    limit: Option<String>,
    cursor: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    let cursor = decode_page_cursor(query.cursor.as_deref());
    let mut items = store::list(
        &state.db,
        query.scope_type.as_deref(),
        query.scope_id.as_deref(),
        query.status.as_deref(),
        query.q.as_deref(),
        cursor.as_ref(),
        limit + 1,
    )
    .map_err(api_error)?;
    if query.limit.is_none()
        && query.cursor.is_none()
        && query.q.as_deref().unwrap_or("").is_empty()
        && query.status.is_none()
    {
        return Ok(Json(
            serde_json::to_value(items).unwrap_or_else(|_| serde_json::json!([])),
        ));
    }
    let has_more = items.len() > limit;
    items.truncate(limit);
    let next_cursor = if has_more {
        items
            .last()
            .and_then(|item| encode_page_cursor(&item.updated_at, &item.id))
    } else {
        None
    };
    Ok(Json(
        serde_json::to_value(PageResponse {
            items,
            next_cursor,
            has_more,
        })
        .unwrap_or_else(|_| serde_json::json!({})),
    ))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::CreatePreviewRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let auto_start = body.auto_start.unwrap_or(false);
    let (preview, created) = store::create_with_status(&state.db, body).map_err(preview_error)?;
    if auto_start
        && preview.command.is_some()
        && preview.status != "running"
        && preview.status != "starting"
    {
        if let Some(response) = preview_command_approval_response(&state, &preview)? {
            return Ok(response.into_response());
        }
        match runtime::start(state.clone(), preview.clone()).await {
            Ok(started) => {
                let status = if created {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                };
                return Ok((status, Json(started.public())).into_response());
            }
            Err(err) => {
                let _ = store::update_status(&state.db, &preview.id, "error");
                return Err(preview_error(err));
            }
        }
    }
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(preview.public())).into_response())
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpdatePreviewRequest>,
) -> Result<Json<models::PreviewSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::update(&state.db, &id, body)
        .map_err(api_error)?
        .map(|preview| Json(preview.public()))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "preview_not_found"))
}

async fn grant_access(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let Some(preview) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    let body = models::PreviewAccessResponse {
        url: models::preview_url(&preview.id, &preview.token),
        preview: preview.public(),
    };
    let mut response = Json(body).into_response();
    if preview.access == "private" {
        let cookie =
            crate::http::preview_access_cookie_header(&state, &preview.id, &preview.token, 15 * 60)
                .ok_or_else(|| error(StatusCode::BAD_REQUEST, "preview_access_cookie_failed"))?;
        let value = header::HeaderValue::from_str(&cookie)
            .map_err(|_| error(StatusCode::BAD_REQUEST, "preview_access_cookie_failed"))?;
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    Ok(response)
}

async fn update_access(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpdatePreviewAccessRequest>,
) -> Result<Json<models::PreviewSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::update_access(&state.db, &id, body.access.as_deref())
        .map_err(api_error)?
        .map(|preview| Json(preview.public()))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "preview_not_found"))
}

async fn logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::PreviewLogsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let Some(logs) = store::logs(&state.db, &id).map_err(api_error)? else {
        return Err(error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    Ok(Json(models::PreviewLogsResponse {
        preview_id: id,
        logs,
    }))
}

async fn start(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(preview) = store::get(&state.db, &id).map_err(api_error)? else {
        return Err(error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    if preview.status == "running" || preview.status == "starting" {
        return Ok(Json(
            serde_json::to_value(preview.public()).unwrap_or_else(|_| serde_json::json!({})),
        ));
    }
    if let Some(response) = preview_command_approval_value(&state, &preview)? {
        return Err((StatusCode::CONFLICT, Json(response)));
    }
    let preview = runtime::start(state, preview)
        .await
        .map_err(preview_error)?;
    Ok(Json(
        serde_json::to_value(preview.public()).unwrap_or_else(|_| serde_json::json!({})),
    ))
}

async fn stop(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::PreviewSummary>, (StatusCode, Json<serde_json::Value>)> {
    runtime::stop(&state, &id)
        .map_err(api_error)?
        .map(|preview| Json(preview.public()))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "preview_not_found"))
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::PreviewDeleteResponse>, (StatusCode, Json<serde_json::Value>)> {
    if store::delete(&state.db, &id).map_err(api_error)? {
        Ok(Json(models::PreviewDeleteResponse { ok: true }))
    } else {
        Err(error(StatusCode::NOT_FOUND, "preview_not_found"))
    }
}

fn preview_command_risk(preview: &models::PreviewRecord) -> Option<&'static str> {
    let command = preview
        .command
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    if command.trim().is_empty() {
        return None;
    }
    if preview.port > 0 && preview.port < 1024 {
        return Some("high");
    }
    let has_word = |word: &str| {
        command
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
            .any(|part| part == word)
    };
    if ["sudo", "su", "launchctl", "osascript"]
        .iter()
        .any(|word| has_word(word))
    {
        return Some("critical");
    }
    if ["docker", "podman", "kubectl", "systemctl", "pm2"]
        .iter()
        .any(|word| has_word(word))
    {
        return Some("high");
    }
    if regex::Regex::new(r"\brm\s+-[^&|;]*r[^&|;]*f\b")
        .ok()
        .is_some_and(|re| re.is_match(&command))
    {
        return Some("high");
    }
    None
}

fn preview_command_payload(preview: &models::PreviewRecord) -> serde_json::Value {
    serde_json::json!({
        "previewId": preview.id,
        "command": preview.command.clone().unwrap_or_default(),
        "cwd": preview.cwd.clone().unwrap_or_default(),
        "targetHost": preview.target_host,
        "port": preview.port,
        "scopeType": preview.scope_type,
        "scopeId": preview.scope_id,
    })
}

fn create_preview_command_approval(
    state: &AppState,
    preview: &models::PreviewRecord,
    risk: &str,
) -> anyhow::Result<crate::api::approvals::models::ApprovalSummary> {
    let details = [
        format!("preview={}", preview.label),
        format!("target={}:{}", preview.target_host, preview.port),
        format!(
            "cwd={}",
            preview.cwd.as_deref().unwrap_or("(workspace root)")
        ),
        format!("command={}", preview.command.as_deref().unwrap_or("")),
    ]
    .join("\n");
    crate::api::approvals::store::create_approval_with_notification(
        state,
        "preview-command-run",
        risk,
        "Preview command requires approval",
        "Run a preview command that crosses a configured risk boundary.",
        &details,
        &preview_command_payload(preview),
    )
}

fn preview_command_approval_value(
    state: &AppState,
    preview: &models::PreviewRecord,
) -> Result<Option<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(risk) = preview_command_risk(preview) else {
        return Ok(None);
    };
    let payload = preview_command_payload(preview);
    if crate::api::approvals::store::approval_always_allowed(
        &state.db,
        "preview-command-run",
        &payload,
    )
    .map_err(api_error)?
    {
        return Ok(None);
    }
    let approval = create_preview_command_approval(state, preview, risk).map_err(api_error)?;
    Ok(Some(
        serde_json::json!({ "error": "approval_required", "approval": approval, "preview": preview.public() }),
    ))
}

fn preview_command_approval_response(
    state: &AppState,
    preview: &models::PreviewRecord,
) -> Result<Option<axum::response::Response>, (StatusCode, Json<serde_json::Value>)> {
    Ok(preview_command_approval_value(state, preview)?
        .map(|value| (StatusCode::CONFLICT, Json(value)).into_response()))
}

fn preview_error(err: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    match err.to_string().as_str() {
        "scope_not_found" | "preview_not_found" => error(StatusCode::NOT_FOUND, err.to_string()),
        "preview_port_in_use" => error(StatusCode::CONFLICT, err.to_string()),
        _ => error(StatusCode::BAD_REQUEST, err.to_string()),
    }
}

fn api_error(err: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    error(StatusCode::BAD_REQUEST, err.to_string())
}

fn error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message.into() })))
}
