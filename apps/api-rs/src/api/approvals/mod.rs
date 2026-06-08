pub(crate) mod models;
pub(crate) mod store;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

use super::common::{parse_limit, PageResponse};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/:id/approve", axum::routing::post(approve))
        .route("/:id/deny", axum::routing::post(deny))
        .route("/:id/archive", axum::routing::post(archive))
        .route("/:id/restore", axum::routing::post(restore))
}

/// Top-level /api/approval-grants resource (see auth/approvals.ts listApprovalGrants / delete).
pub fn grants_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_grants))
        .route("/:id", axum::routing::delete(delete_grant))
}

#[derive(Deserialize)]
struct ApproveQuery {
    always: Option<String>,
    #[serde(rename = "expiresIn")]
    expires_in: Option<i64>,
}

async fn approve(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ApproveQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(pending) = store::pending(&state.db, &id).map_err(approval_error)? else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "approval_not_found" })),
        ));
    };

    let mut codex_runtime = None;
    let mut preview = None;
    let mut merge = None;
    let mut git_operation = None;

    if pending.action_type == "codex-runtime-update" {
        if let Some(payload) = pending.related.clone() {
            if let Ok(input) =
                serde_json::from_value::<crate::api::settings::UpdateCodexRuntimeSettings>(payload)
            {
                let _ = crate::api::settings::apply_codex_runtime(&state.db, input);
            }
        }
        codex_runtime = store::approved_codex_runtime(&state.db).ok();
    }
    if pending.action_type == "preview-command-run" {
        let preview_id = payload_string(&pending, "previewId");
        let record = crate::api::previews::store::get(&state.db, &preview_id)
            .map_err(approval_error)?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "preview_not_found" })),
                )
            })?;
        let started = crate::api::previews::runtime::start(state.clone(), record)
            .await
            .map_err(approval_error)?;
        preview = Some(started.public());
    }
    if pending.action_type == "preview-access" {
        let request_id = payload_string(&pending, "requestId");
        let preview_id = payload_string(&pending, "previewId");
        let expires_in = query.expires_in.unwrap_or(15 * 60);
        let ttl = if query.always.as_deref() == Some("true") {
            30 * 24 * 60 * 60
        } else {
            expires_in.clamp(1, 30 * 24 * 60 * 60)
        };
        let ok = crate::api::previews::store::approve_access_request(
            &state.db,
            &request_id,
            Some(&preview_id),
            ttl,
        )
        .map_err(approval_error)?;
        if !ok {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "preview_access_request_not_found" })),
            ));
        }
    }
    if pending.action_type == "project-delete-files" {
        let project_id = payload_string(&pending, "projectId");
        if !crate::api::projects::store::delete_project(&state.db, &project_id)
            .map_err(approval_error)?
        {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "project_not_found" })),
            ));
        }
    }
    if pending.action_type == "room-run-merge" {
        let room_id = payload_string(&pending, "roomId");
        let run_id = payload_string(&pending, "runId");
        let result = crate::api::rooms::store::apply_run_merge(&state.db, &room_id, &run_id)
            .map_err(|err| {
                let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::BAD_REQUEST);
                (status, Json(serde_json::json!({ "error": err.code })))
            })?;
        if !result.ok {
            return Err((
                StatusCode::CONFLICT,
                Json(
                    serde_json::json!({ "error": result.message.clone().unwrap_or_else(|| "merge_failed".to_string()), "merge": result }),
                ),
            ));
        }
        merge = Some(result);
    }
    if pending.action_type == "project-git-operation" {
        let project_id = payload_string(&pending, "projectId");
        let project = crate::api::projects::store::get_project(&state.db, &project_id)
            .map_err(approval_error)?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "project_not_found" })),
                )
            })?;
        let operation = payload_string(&pending, "operation");
        let request = crate::api::projects::models::ProjectGitOperationRequest {
            operation,
            branch: pending
                .related
                .as_ref()
                .and_then(|v| v.get("branch"))
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
            message: pending
                .related
                .as_ref()
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
        };
        git_operation = Some(
            crate::api::projects::history::run_git(&state.db, &project, request)
                .await
                .map_err(approval_error)?,
        );
    }

    let approval = store::resolve_approved(&state.db, &id)
        .map_err(approval_error)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "approval_not_found" })),
            )
        })?;
    if query.always.as_deref() == Some("true") || query.expires_in.is_some() {
        let expires_at = query.expires_in.filter(|value| *value > 0).map(|value| {
            let ttl = value.min(30 * 24 * 60 * 60);
            (time::OffsetDateTime::now_utc() + time::Duration::seconds(ttl))
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        });
        let _ = store::save_grant(&state.db, &approval, expires_at);
    }
    Ok(Json(
        serde_json::json!({ "approval": approval, "codexRuntime": codex_runtime, "preview": preview, "merge": merge, "gitOperation": git_operation }),
    ))
}

fn approval_error(err: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    let message = err.to_string();
    let status = if message == "approval_already_resolved" {
        StatusCode::CONFLICT
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, Json(serde_json::json!({ "error": message })))
}

fn payload_string(approval: &models::ApprovalSummary, key: &str) -> String {
    approval
        .related
        .as_ref()
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

#[derive(Deserialize)]
struct ApprovalQuery {
    status: Option<String>,
    archived: Option<String>,
    limit: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ApprovalQuery>,
) -> Json<PageResponse<models::ApprovalSummary>> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    let archived = matches!(query.archived.as_deref(), Some("true" | "1"));
    let status = if archived {
        None
    } else {
        query.status.as_deref()
    };
    let mut items = store::list(&state.db, status, archived, limit + 1).unwrap_or_default();
    let has_more = items.len() > limit;
    items.truncate(limit);
    Json(PageResponse {
        items,
        next_cursor: None,
        has_more,
    })
}

async fn deny(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ApprovalSummary>, (StatusCode, Json<serde_json::Value>)> {
    let pending = store::pending(&state.db, &id)
        .map_err(approval_error)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "approval_not_found" })),
            )
        })?;
    let denied = store::deny(&state.db, &id)
        .map_err(approval_error)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "approval_not_found" })),
            )
        })?;
    if pending.action_type == "room-run-merge" {
        let room_id = payload_string(&pending, "roomId");
        let run_id = payload_string(&pending, "runId");
        if !room_id.is_empty() {
            let _ = crate::api::rooms::store::create_decision(
                &state.db,
                &room_id,
                crate::api::rooms::models::CreateRoomDecisionRequest {
                    title: Some("Merge approval denied".to_string()),
                    status: Some("rejected".to_string()),
                    payload: Some(serde_json::json!({
                        "approvalId": pending.id.clone(),
                        "runId": if run_id.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(run_id) }
                    })),
                },
            );
            crate::api::rooms::events::publish_activity(&state, &room_id);
        }
    }
    Ok(Json(denied))
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ApprovalSummary>, (StatusCode, Json<serde_json::Value>)> {
    decision(store::archive(&state.db, &id))
}

async fn restore(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ApprovalSummary>, (StatusCode, Json<serde_json::Value>)> {
    decision(store::restore(&state.db, &id))
}

#[derive(Deserialize)]
struct GrantsQuery {
    limit: Option<String>,
}

async fn list_grants(
    State(state): State<AppState>,
    Query(query): Query<GrantsQuery>,
) -> Json<PageResponse<models::ApprovalGrantSummary>> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    let mut items = store::list_grants(&state.db, limit + 1).unwrap_or_default();
    let has_more = items.len() > limit;
    items.truncate(limit);
    Json(PageResponse {
        items,
        next_cursor: None,
        has_more,
    })
}

async fn delete_grant(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let deleted = store::delete_grant(&state.db, &id).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
    })?;
    if !deleted {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "approval_grant_not_found" })),
        ));
    }
    Ok(Json(serde_json::json!({ "ok": true, "id": id })))
}

fn decision(
    result: anyhow::Result<Option<models::ApprovalSummary>>,
) -> Result<Json<models::ApprovalSummary>, (StatusCode, Json<serde_json::Value>)> {
    result
        .map_err(|err| {
            let message = err.to_string();
            let status = if message == "approval_already_resolved"
                || message == "approval_pending_cannot_archive"
            {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(serde_json::json!({ "error": message })))
        })?
        .map(Json)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "approval_not_found" })),
            )
        })
}
