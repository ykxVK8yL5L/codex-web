mod models;
mod store;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
    Json, Router,
};
use std::collections::HashMap;

use crate::state::AppState;

/// Management router (mounted under `/api`).
/// Routes: GET/POST /api/webhook-routes, PATCH/DELETE /api/webhook-routes/:id
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/webhook-routes", get(list).post(create))
        .route("/webhook-routes/:id", patch(update).delete(remove))
}

/// Public inbound dispatch router. Mounted on the top-level (outside the auth guard)
/// for both `/api/webhook/:routeKey` and `/webhooks/:routeKey`. Auth is enforced
/// per-route via the route secret (validate_webhook_token), mirroring the TS posture.
pub fn inbound_router() -> Router<AppState> {
    Router::new()
        .route("/api/webhook/:route_key", any_method(handle_inbound))
        .route("/webhooks/:route_key", any_method(handle_inbound))
}

fn any_method<H, T>(handler: H) -> axum::routing::MethodRouter<AppState>
where
    H: axum::handler::Handler<T, AppState> + Clone,
    T: 'static,
{
    get(handler.clone())
        .post(handler.clone())
        .put(handler.clone())
        .patch(handler.clone())
        .delete(handler)
}

// === Management handlers ===

async fn list(State(state): State<AppState>) -> Json<Vec<models::WebhookRouteSummary>> {
    Json(store::list(&state.db, &state.config.host).unwrap_or_default())
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::WebhookRouteInput>,
) -> Result<(StatusCode, Json<models::WebhookRouteSummary>), (StatusCode, Json<serde_json::Value>)>
{
    match store::create(&state.db, body, &state.config.host).map_err(api_error)? {
        Ok(route) => Ok((StatusCode::CREATED, Json(route))),
        Err(code) => Err(json_error(StatusCode::BAD_REQUEST, code)),
    }
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::WebhookRouteInput>,
) -> Result<Json<models::WebhookRouteSummary>, (StatusCode, Json<serde_json::Value>)> {
    match store::update(&state.db, &id, body, &state.config.host).map_err(api_error)? {
        Ok(Some(route)) => Ok(Json(route)),
        Ok(None) => Err(json_error(StatusCode::NOT_FOUND, "webhook_route_not_found")),
        Err(code) => Err(json_error(StatusCode::BAD_REQUEST, code)),
    }
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if store::delete(&state.db, &id).map_err(api_error)? {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(json_error(StatusCode::NOT_FOUND, "webhook_route_not_found"))
    }
}

// === Inbound dispatch ===

const MAX_PAYLOAD_BYTES: usize = 1_048_576;

fn parse_page_limit(value: Option<&str>) -> usize {
    crate::api::common::parse_limit(value, 20, 100)
}

fn payload_str(payload: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(serde_json::Value::String(s)) = payload.get(*key) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

fn session_summary_json(
    session: &crate::api::sessions::models::SessionSummary,
) -> serde_json::Value {
    serde_json::json!({
        "id": session.id,
        "title": session.title,
        "status": session.status,
        "conversationType": session.conversation_type,
        "roomId": session.room_id,
        "projectId": session.project_id,
        "updatedAt": session.updated_at,
    })
}

fn list_session_summaries(state: &AppState, limit: usize) -> Vec<serde_json::Value> {
    crate::api::sessions::store::list_sessions(&state.db, true, true)
        .unwrap_or_default()
        .into_iter()
        .take(limit)
        .map(|session| session_summary_json(&session))
        .collect()
}

fn list_agent_summaries(state: &AppState, limit: usize) -> Vec<serde_json::Value> {
    crate::api::agents::store::list_agents(&state.db, limit)
        .map(|page| {
            page.items
                .into_iter()
                .map(|agent| {
                    serde_json::json!({
                        "id": agent.id,
                        "name": agent.name,
                        "enabled": agent.enabled,
                        "roleId": agent.role_id,
                        "model": agent.model,
                        "workspaceMode": agent.workspace_mode,
                        "projectAccessMode": agent.project_access_mode,
                        "updatedAt": agent.updated_at,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn list_room_summaries(state: &AppState, limit: usize) -> Vec<serde_json::Value> {
    crate::api::rooms::store::list_rooms(&state.db, None, limit)
        .map(|page| {
            page.items
                .into_iter()
                .map(|room| {
                    serde_json::json!({
                        "id": room.id,
                        "name": room.name,
                        "status": room.status,
                        "sessionId": room.session_id,
                        "groupId": room.group_id,
                        "circleId": room.circle_id,
                        "updatedAt": room.updated_at,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn handle_inbound(
    State(state): State<AppState>,
    Path(route_key): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    request: axum::http::Request<Body>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let host = state.config.host.clone();

    let Some(route) = store::get_by_route_key(&state.db, &route_key).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "webhook_route_not_found"));
    };
    if !route.enabled {
        return Err(json_error(StatusCode::FORBIDDEN, "webhook_route_disabled"));
    }

    // Read body with a 1MiB cap.
    let raw_body = match axum::body::to_bytes(request.into_body(), MAX_PAYLOAD_BYTES + 1).await {
        Ok(bytes) => bytes,
        Err(_) => return Err(json_error(StatusCode::BAD_REQUEST, "webhook_bad_request")),
    };
    if raw_body.len() > MAX_PAYLOAD_BYTES {
        return Err(json_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "webhook_payload_too_large",
        ));
    }

    // Auth: per-route token validation.
    if !store::validate_webhook_token(
        &route.secret,
        &headers,
        query.get("token").map(|s| s.as_str()),
        &host,
    ) {
        return Err(json_error(StatusCode::UNAUTHORIZED, "invalid_signature"));
    }

    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    let payload = store::parse_webhook_payload(content_type, &raw_body);

    let command = {
        let from_query = query
            .get("command")
            .map(|s| s.to_string())
            .unwrap_or_default();
        let candidate = if from_query.trim().is_empty() {
            payload_str(&payload, &["command", "action"])
        } else {
            from_query
        };
        candidate.trim().to_lowercase()
    };

    let payload_session_id = payload_str(&payload, &["sessionId", "session_id", "targetSessionId"]);
    let payload_session_target = payload_str(&payload, &["target", "session", "bind"]);
    let payload_message = payload_str(&payload, &["message", "content", "text"]);

    let session_id = {
        let q = query
            .get("sessionId")
            .map(|s| s.to_string())
            .unwrap_or_default();
        let candidate = if !q.trim().is_empty() {
            q
        } else if !payload_session_id.is_empty() {
            payload_session_id
        } else {
            payload_session_target
        };
        candidate.trim().to_string()
    };
    let message = {
        let q = query
            .get("message")
            .map(|s| s.to_string())
            .unwrap_or_default();
        if !q.trim().is_empty() {
            q.trim().to_string()
        } else {
            payload_message
        }
    };

    let route_summary = store::route_summary(&state.db, &route, &host);
    let route_session_id = route.session_id.clone().unwrap_or_default();
    let route_session_id = route_session_id.trim().to_string();

    let limit = parse_page_limit(query.get("limit").map(|s| s.as_str()));
    let bound_session = if route_session_id.is_empty() {
        serde_json::Value::Null
    } else {
        crate::api::sessions::store::list_sessions(&state.db, true, true)
            .unwrap_or_default()
            .into_iter()
            .find(|item| item.id == route_session_id)
            .map(|item| session_summary_json(&item))
            .unwrap_or(serde_json::Value::Null)
    };

    if command.is_empty() || command == "help" {
        let usage_base = format!("/api/webhook/{}", route_summary.route_key);
        return Ok(ok_json(serde_json::json!({
            "ok": true,
            "command": "help",
            "route": route_summary,
            "commands": [
                { "command": "help", "usage": format!("GET {usage_base}?command=help"), "description": "Show command list and usage." },
                { "command": "sessions", "usage": format!("GET {usage_base}?command=sessions"), "description": "List recent sessions." },
                { "command": "agents", "usage": format!("GET {usage_base}?command=agents"), "description": "List recent agents." },
                { "command": "rooms", "usage": format!("GET {usage_base}?command=rooms"), "description": "List recent rooms." },
                { "command": "bind", "usage": format!("POST {usage_base}?command=bind&sessionId=<sessionId>"), "description": "Bind this route to an existing session." },
                { "command": "unbind", "usage": format!("POST {usage_base}?command=unbind"), "description": "Clear the bound session." },
                { "command": "send", "usage": format!("POST {usage_base}?command=send&sessionId=<sessionId>&message=<message>"), "description": "Send a message to an existing session." },
            ],
        })));
    }

    if command == "sessions" {
        return Ok(ok_json(serde_json::json!({
            "ok": true, "command": "sessions", "route": route_summary,
            "sessions": list_session_summaries(&state, limit),
        })));
    }
    if command == "agents" {
        return Ok(ok_json(serde_json::json!({
            "ok": true, "command": "agents", "route": route_summary,
            "agents": list_agent_summaries(&state, limit),
        })));
    }
    if command == "rooms" {
        return Ok(ok_json(serde_json::json!({
            "ok": true, "command": "rooms", "route": route_summary,
            "rooms": list_room_summaries(&state, limit),
        })));
    }

    if command == "bind" {
        if session_id.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "command": "bind",
                    "error": "webhook_session_id_required",
                    "route": route_summary,
                    "boundSession": bound_session,
                    "sessions": list_session_summaries(&state, limit),
                })),
            ));
        }
        let target = crate::api::sessions::store::list_sessions(&state.db, true, true)
            .unwrap_or_default()
            .into_iter()
            .find(|item| item.id == session_id);
        let Some(target) = target else {
            return Err(json_error(StatusCode::NOT_FOUND, "session_not_found"));
        };
        store::bind_session(&state.db, &route.id, Some(&target.id)).map_err(api_error)?;
        let updated = store::get_by_id(&state.db, &route.id)
            .map_err(api_error)?
            .unwrap_or(route.clone());
        return Ok(ok_json(serde_json::json!({
            "ok": true,
            "command": "bind",
            "route": store::route_summary(&state.db, &updated, &host),
            "boundSession": {
                "id": target.id,
                "title": target.title,
                "status": target.status,
                "conversationType": target.conversation_type,
                "roomId": target.room_id,
                "projectId": target.project_id,
                "updatedAt": target.updated_at,
            },
        })));
    }

    if command == "unbind" {
        store::bind_session(&state.db, &route.id, None).map_err(api_error)?;
        let updated = store::get_by_id(&state.db, &route.id)
            .map_err(api_error)?
            .unwrap_or(route.clone());
        return Ok(ok_json(serde_json::json!({
            "ok": true,
            "command": "unbind",
            "route": store::route_summary(&state.db, &updated, &host),
        })));
    }

    if command == "send" {
        let target_session_id = if !session_id.is_empty() {
            session_id.clone()
        } else {
            route_session_id.clone()
        };
        if target_session_id.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "webhook_session_id_required",
                    "route": route_summary,
                    "boundSession": bound_session,
                    "sessions": list_session_summaries(&state, limit),
                })),
            ));
        }
        if message.is_empty() {
            return Err(json_error(
                StatusCode::BAD_REQUEST,
                "webhook_message_required",
            ));
        }
        let target = crate::api::sessions::store::list_sessions(&state.db, true, true)
            .unwrap_or_default()
            .into_iter()
            .find(|item| item.id == target_session_id);
        let Some(target) = target else {
            return Err(json_error(StatusCode::NOT_FOUND, "session_not_found"));
        };
        let dispatch = dispatch_message_to_session(&state, target.clone(), message.clone())
            .await
            .map_err(api_error)?;
        return Ok((
            StatusCode::ACCEPTED,
            Json(serde_json::json!({
                "ok": true,
                "command": "send",
                "route": route_summary,
                "sessionId": target.id,
                "dispatch": dispatch,
            })),
        )
            .into_response());
    }

    Err((
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "unsupported_webhook_command",
            "allowedCommands": ["help", "sessions", "agents", "rooms", "bind", "unbind", "send"],
        })),
    ))
}

async fn dispatch_message_to_session(
    state: &AppState,
    target: crate::api::sessions::models::SessionSummary,
    content: String,
) -> anyhow::Result<serde_json::Value> {
    if state.tasks.get(&target.id).is_some() || target.status == "running" {
        let queued = crate::api::sessions::queue::enqueue(
            &state.db,
            &target,
            crate::api::sessions::models::QueueMessageRequest {
                prompt: content,
                provider_id: target.provider_id.clone(),
                model: target.model.clone(),
                reply_to_message_id: None,
            },
        )?;
        return Ok(serde_json::json!({ "mode": "queued", "queuedId": queued.id }));
    }
    let outcome = crate::api::tasks::runner::continue_task(
        state.clone(),
        target.id.clone(),
        crate::api::tasks::runner::ContinueCodexTaskRequest {
            prompt: content,
            provider_id: target.provider_id.clone(),
            model: target.model.clone(),
            reply_to_message_id: None,
            attachments: None,
        },
    )
    .await?;
    match outcome {
        crate::api::tasks::runner::ContinueTaskOutcome::Queued(item) => {
            Ok(serde_json::json!({ "mode": "queued", "queuedId": item.id }))
        }
        crate::api::tasks::runner::ContinueTaskOutcome::Session(session) => {
            Ok(serde_json::json!({ "mode": "started", "sessionId": session.id }))
        }
    }
}

use axum::response::IntoResponse;

fn ok_json(value: serde_json::Value) -> axum::response::Response {
    (StatusCode::OK, Json(value)).into_response()
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
