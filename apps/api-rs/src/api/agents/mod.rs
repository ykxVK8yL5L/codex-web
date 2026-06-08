pub(crate) mod models;
pub(crate) mod role_templates;
pub mod store;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::common::{parse_limit, PageResponse};
use crate::api::sessions::models::SessionSummary;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agent-roles", get(agent_roles).post(create_agent_role))
        .route("/agent-role-templates", get(agent_role_templates))
        .route(
            "/agent-roles/from-template",
            post(create_agent_role_from_template),
        )
        .route("/agent-roles/import-file", post(import_agent_role_file))
        .route(
            "/agent-roles/:id",
            patch(update_agent_role).delete(delete_agent_role),
        )
        .route("/agents", get(agents).post(create_agent))
        .route("/agents/batch", post(batch_agents))
        .route("/agents/:id", patch(update_agent).delete(delete_agent))
        .route(
            "/agents/:id/sessions",
            get(agent_sessions).post(create_agent_session),
        )
        .route("/agents/:id/stats", get(agent_stats))
        .route("/agent-groups", get(agent_groups).post(create_agent_group))
        .route(
            "/agent-groups/:id",
            patch(update_agent_group).delete(delete_agent_group),
        )
        .route("/agent-groups/:id/rooms", get(agent_group_rooms))
        .route(
            "/agent-circles",
            get(agent_circles).post(create_agent_circle),
        )
        .route(
            "/agent-circles/:id",
            patch(update_agent_circle).delete(delete_agent_circle),
        )
        .route("/agent-circles/:id/groups", post(create_agent_circle_group))
        .route("/agent-circles/:id/rooms", get(agent_circle_rooms))
        .route("/permission-profiles", get(permission_profiles))
}

type ApiError = (StatusCode, Json<serde_json::Value>);

#[derive(Deserialize)]
struct PageQuery {
    limit: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomsQuery {
    limit: Option<String>,
    q: Option<String>,
    status: Option<String>,
    project_id: Option<String>,
}

fn template_dir(state: &AppState) -> std::path::PathBuf {
    role_templates::role_template_dir(&state.db.data_dir)
}

// ---------------------------------------------------------------------------
// Agent roles
// ---------------------------------------------------------------------------

async fn agent_roles(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<PageResponse<models::AgentRoleSummary>>, ApiError> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    store::list_roles(&state.db, limit)
        .map(Json)
        .map_err(api_error)
}

async fn agent_role_templates(
    State(state): State<AppState>,
) -> Json<Vec<role_templates::AgentRoleTemplateSummary>> {
    Json(store::list_role_templates(&template_dir(&state)))
}

async fn create_agent_role(
    State(state): State<AppState>,
    body: Option<Json<models::CreateAgentRoleRequest>>,
) -> Result<(StatusCode, Json<models::AgentRoleSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    store::create_role(&state.db, body)
        .map(|role| (StatusCode::CREATED, Json(role)))
        .map_err(role_create_error)
}

async fn create_agent_role_from_template(
    State(state): State<AppState>,
    body: Option<Json<models::CreateAgentRoleFromTemplateRequest>>,
) -> Result<(StatusCode, Json<models::AgentRoleSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    store::create_role_from_template(&state.db, &template_dir(&state), body)
        .map(|role| (StatusCode::CREATED, Json(role)))
        .map_err(|error| {
            let code = error.to_string();
            let status = match code.as_str() {
                "agent_role_template_not_found" => StatusCode::NOT_FOUND,
                _ => StatusCode::BAD_REQUEST,
            };
            json_error(status, code)
        })
}

async fn import_agent_role_file(
    State(state): State<AppState>,
    body: Option<Json<models::ImportRoleFileRequest>>,
) -> Result<(StatusCode, Json<models::AgentRoleSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    store::import_role_file(&state.db, body)
        .map(|role| (StatusCode::CREATED, Json(role)))
        .map_err(api_error)
}

async fn update_agent_role(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<models::UpdateAgentRoleRequest>>,
) -> Result<Json<models::AgentRoleSummary>, ApiError> {
    let Some(Json(body)) = body else {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "invalid_agent_role_update",
        ));
    };
    store::update_role(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "agent_role_not_found"))
}

async fn delete_agent_role(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    match store::delete_role(&state.db, &id).map_err(api_error)? {
        Ok(()) => Ok(Json(serde_json::json!({ "ok": true, "id": id }))),
        Err(code) => Err(json_error(StatusCode::CONFLICT, code)),
    }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

async fn agents(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<PageResponse<models::AgentSummary>>, ApiError> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    store::list_agents(&state.db, limit)
        .map(Json)
        .map_err(api_error)
}

async fn create_agent(
    State(state): State<AppState>,
    body: Option<Json<models::CreateAgentRequest>>,
) -> Result<(StatusCode, Json<models::AgentSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    store::create_agent(&state.db, body)
        .map(|agent| (StatusCode::CREATED, Json(agent)))
        .map_err(api_error)
}

async fn batch_agents(
    State(state): State<AppState>,
    body: Option<Json<models::AgentBatchRequest>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    match store::batch_update_agents(&state.db, body).map_err(api_error)? {
        Ok((ids, enabled)) => Ok(Json(
            serde_json::json!({ "ok": true, "ids": ids, "enabled": enabled }),
        )),
        Err(code) => Err(json_error(StatusCode::BAD_REQUEST, code)),
    }
}

async fn update_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<models::UpdateAgentRequest>>,
) -> Result<Json<models::AgentSummary>, ApiError> {
    if !store::agent_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_not_found"));
    }
    let Some(Json(body)) = body else {
        return Err(json_error(StatusCode::BAD_REQUEST, "invalid_agent_update"));
    };
    match store::update_agent(&state.db, &id, body).map_err(api_error)? {
        Ok(Some(agent)) => Ok(Json(agent)),
        Ok(None) => Err(json_error(StatusCode::NOT_FOUND, "agent_not_found")),
        Err(code) => Err(json_error(StatusCode::NOT_FOUND, code)),
    }
}

async fn delete_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    store::delete_agent(&state.db, &id).map_err(api_error)?;
    Ok(Json(serde_json::json!({ "ok": true, "id": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionsQuery {
    limit: Option<String>,
    q: Option<String>,
    status: Option<String>,
    project_id: Option<String>,
}

async fn agent_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<AgentSessionsQuery>,
) -> Result<Json<PageResponse<SessionSummary>>, ApiError> {
    if !store::agent_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    store::agent_sessions(
        &state.db,
        &id,
        limit,
        query.q.as_deref(),
        query.status.as_deref(),
        query.project_id.as_deref(),
    )
    .map(Json)
    .map_err(api_error)
}

async fn agent_stats(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::AgentStats>, ApiError> {
    if !store::agent_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_not_found"));
    }
    store::agent_stats(&state.db, &id)
        .map(Json)
        .map_err(api_error)
}

async fn create_agent_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<models::CreateAgentSessionRequest>>,
) -> Result<(StatusCode, Json<SessionSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    match store::create_agent_session(&state.db, &id, body).map_err(api_error)? {
        Ok(session) => Ok((StatusCode::CREATED, Json(session))),
        Err(code) => {
            let status = match code {
                "agent_not_found" => StatusCode::NOT_FOUND,
                "agent_project_access_denied" => StatusCode::FORBIDDEN,
                _ => StatusCode::BAD_REQUEST,
            };
            Err(json_error(status, code))
        }
    }
}

// ---------------------------------------------------------------------------
// Agent groups
// ---------------------------------------------------------------------------

async fn agent_groups(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<PageResponse<models::AgentGroupSummary>>, ApiError> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    store::list_groups(&state.db, limit)
        .map(Json)
        .map_err(api_error)
}

async fn create_agent_group(
    State(state): State<AppState>,
    body: Option<Json<models::CreateAgentGroupRequest>>,
) -> Result<(StatusCode, Json<models::AgentGroupSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    store::create_group(&state.db, body)
        .map(|group| (StatusCode::CREATED, Json(group)))
        .map_err(api_error)
}

async fn update_agent_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<models::UpdateAgentGroupRequest>>,
) -> Result<Json<models::AgentGroupSummary>, ApiError> {
    if !store::group_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_group_not_found"));
    }
    let Some(Json(body)) = body else {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "invalid_agent_group_update",
        ));
    };
    store::update_group(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "agent_group_not_found"))
}

async fn delete_agent_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    store::delete_group(&state.db, &id).map_err(api_error)?;
    Ok(Json(serde_json::json!({ "ok": true, "id": id })))
}

async fn agent_group_rooms(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<RoomsQuery>,
) -> Result<Json<PageResponse<SessionSummary>>, ApiError> {
    if !store::group_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_group_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    store::group_rooms(
        &state.db,
        &id,
        limit,
        query.q.as_deref(),
        query.status.as_deref(),
        query.project_id.as_deref(),
    )
    .map(Json)
    .map_err(api_error)
}

// ---------------------------------------------------------------------------
// Agent circles
// ---------------------------------------------------------------------------

async fn agent_circles(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<PageResponse<models::AgentCircleSummary>>, ApiError> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    store::list_circles(&state.db, limit)
        .map(Json)
        .map_err(api_error)
}

async fn create_agent_circle(
    State(state): State<AppState>,
    body: Option<Json<models::CreateAgentCircleRequest>>,
) -> Result<(StatusCode, Json<models::AgentCircleSummary>), ApiError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    store::create_circle(&state.db, body)
        .map(|circle| (StatusCode::CREATED, Json(circle)))
        .map_err(api_error)
}

async fn update_agent_circle(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<models::UpdateAgentCircleRequest>>,
) -> Result<Json<models::AgentCircleSummary>, ApiError> {
    if !store::circle_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_circle_not_found"));
    }
    let Some(Json(body)) = body else {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "invalid_agent_circle_update",
        ));
    };
    match store::update_circle(&state.db, &id, body).map_err(api_error)? {
        Ok(Some(circle)) => Ok(Json(circle)),
        Ok(None) => Err(json_error(StatusCode::NOT_FOUND, "agent_circle_not_found")),
        Err(code) => Err(json_error(StatusCode::CONFLICT, code)),
    }
}

async fn delete_agent_circle(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    match store::delete_circle(&state.db, &id).map_err(api_error)? {
        Ok(Some(())) => Ok(Json(serde_json::json!({ "ok": true, "id": id }))),
        Ok(None) => Err(json_error(StatusCode::NOT_FOUND, "agent_circle_not_found")),
        Err(code) => Err(json_error(StatusCode::CONFLICT, code)),
    }
}

async fn create_agent_circle_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<models::AgentGroupSummary>), ApiError> {
    match store::create_group_from_circle(&state.db, &id).map_err(api_error)? {
        Ok(group) => Ok((StatusCode::CREATED, Json(group))),
        Err(code) => {
            let status = match code {
                "agent_circle_not_found" => StatusCode::NOT_FOUND,
                _ => StatusCode::BAD_REQUEST,
            };
            Err(json_error(status, code))
        }
    }
}

async fn agent_circle_rooms(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<RoomsQuery>,
) -> Result<Json<PageResponse<SessionSummary>>, ApiError> {
    if !store::circle_exists(&state.db, &id).map_err(api_error)? {
        return Err(json_error(StatusCode::NOT_FOUND, "agent_circle_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    store::circle_rooms(
        &state.db,
        &id,
        limit,
        query.q.as_deref(),
        query.status.as_deref(),
        query.project_id.as_deref(),
    )
    .map(Json)
    .map_err(api_error)
}

async fn permission_profiles() -> Json<Vec<models::PermissionProfileSummary>> {
    Json(store::permission_profiles())
}

fn role_create_error(error: anyhow::Error) -> ApiError {
    // create_role / import_role_file surface specific codes; map to BAD_REQUEST like TS.
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn api_error(error: anyhow::Error) -> ApiError {
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn json_error(status: StatusCode, error: impl Into<String>) -> ApiError {
    (status, Json(serde_json::json!({ "error": error.into() })))
}
