pub(crate) mod models;
pub(crate) mod store;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::api::common::parse_limit;
use crate::state::AppState;

use store::GoalActor;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(detail).patch(update).delete(remove))
        .route("/:id/events", get(events))
        .route("/:id/focuses", get(focuses).post(create_focus))
        .route("/:id/focuses/:focus_id", axum::routing::patch(update_focus))
        .route("/:id/items", get(items).post(create_item))
        .route(
            "/:id/items/:item_id",
            axum::routing::patch(update_item).delete(remove_item),
        )
        .route("/:id/proposals", get(proposals).post(create_proposal))
        .route(
            "/:id/proposals/:proposal_id/approve",
            axum::routing::post(approve_proposal),
        )
        .route(
            "/:id/proposals/:proposal_id/reject",
            axum::routing::post(reject_proposal),
        )
        .route("/:id/plan", axum::routing::post(plan))
        .route("/:id/orchestrate", axum::routing::post(orchestrate))
}

type ApiResult<T> = Result<T, (StatusCode, Json<serde_json::Value>)>;

/// Read x-codex-agent-id / x-agent-id headers (trimmed).
fn header_agent_id(headers: &HeaderMap) -> Option<String> {
    for name in ["x-codex-agent-id", "x-agent-id"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Parse a JSON body into a typed value, returning a custom invalid-code error
/// (mirrors the TS `c.req.json().catch(() => null)` pattern) on parse failure.
fn parse_body<T: serde::de::DeserializeOwned>(bytes: &Bytes, invalid_code: &str) -> ApiResult<T> {
    serde_json::from_slice::<T>(bytes)
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, invalid_code))
}

/// Build the goal actor from headers + raw body fields, mapping
/// agent_actor_not_found to 403 like the TS routes.
fn actor_from(
    state: &AppState,
    headers: &HeaderMap,
    body: &serde_json::Value,
) -> ApiResult<GoalActor> {
    let body_actor = body.get("actorAgentId").and_then(|value| value.as_str());
    let body_proposed = body
        .get("proposedByAgentId")
        .and_then(|value| value.as_str());
    store::goal_actor(
        &state.db,
        header_agent_id(headers).as_deref(),
        body_actor,
        body_proposed,
    )
    .map_err(|error| forbidden_or(error, StatusCode::FORBIDDEN))
}

fn forbidden_or(error: anyhow::Error, status: StatusCode) -> (StatusCode, Json<serde_json::Value>) {
    json_error(status, error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    owner_type: Option<String>,
    owner_id: Option<String>,
    status: Option<String>,
    limit: Option<String>,
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<models::GoalSummary>>, (StatusCode, Json<serde_json::Value>)> {
    let limit = parse_limit(query.limit.as_deref(), 30, 100);
    store::list_goals(
        &state.db,
        query.owner_type.as_deref(),
        query.owner_id.as_deref(),
        query.status.as_deref(),
        limit,
    )
    .map(Json)
    .map_err(api_error)
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::GoalDetailResponse>, (StatusCode, Json<serde_json::Value>)> {
    store::detail(&state.db, &id)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))
}

async fn events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Vec<models::GoalEventSummary>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_goal(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 80, 200);
    store::events(&state.db, &id, limit)
        .map(Json)
        .map_err(api_error)
}

async fn focuses(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Vec<models::GoalFocusSummary>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_goal(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 80, 200);
    store::focuses(&state.db, &id, limit)
        .map(Json)
        .map_err(api_error)
}

async fn items(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<models::GoalItemSummary>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_goal(&state, &id)?;
    store::items(&state.db, &id).map(Json).map_err(api_error)
}

async fn proposals(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Vec<models::GoalProposalSummary>>, (StatusCode, Json<serde_json::Value>)> {
    ensure_goal(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 80, 200);
    store::proposals(&state.db, &id, limit)
        .map(Json)
        .map_err(api_error)
}

// ---------------------------------------------------------------------------
// Write handlers (mirror apps/api/src/goals/routes.ts)
// ---------------------------------------------------------------------------

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<models::GoalSummary>)> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal")?;
    let actor = actor_from(&state, &headers, &value)?;
    if actor.is_agent() {
        return Err(json_error(StatusCode::FORBIDDEN, "goal_agent_must_propose"));
    }
    let input: models::CreateGoalRequest = parse_body(&body, "invalid_goal")?;
    let goal = store::create_goal(&state.db, input, &actor).map_err(|error| {
        let message = error.to_string();
        let status = if message.ends_with("_not_found") {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };
        json_error(status, message)
    })?;
    Ok((StatusCode::CREATED, Json(goal)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<models::GoalSummary>> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal_update")?;
    let actor = actor_from(&state, &headers, &value)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    let input: models::UpdateGoalRequest = parse_body(&body, "invalid_goal_update")?;
    store::update_goal(&state.db, &id, input, &actor)
        .map(Json)
        .map_err(update_error)
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Json<models::GoalSummary>> {
    let actor = actor_from(&state, &headers, &serde_json::Value::Null)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    let input = models::UpdateGoalRequest {
        status: Some("cancelled".to_string()),
        ..Default::default()
    };
    store::update_goal(&state.db, &id, input, &actor)
        .map(Json)
        .map_err(update_error)
}

async fn create_focus(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<models::GoalFocusSummary>)> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal_focus")?;
    let actor = actor_from(&state, &headers, &value)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    let input: models::CreateGoalFocusRequest = parse_body(&body, "invalid_goal_focus")?;
    let focus = store::create_goal_focus(&state.db, &id, input, &actor).map_err(|error| {
        let message = error.to_string();
        let status = if matches!(
            message.as_str(),
            "goal_agent_must_propose" | "agent_actor_not_found"
        ) {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::BAD_REQUEST
        };
        json_error(status, message)
    })?;
    Ok((StatusCode::CREATED, Json(focus)))
}

async fn update_focus(
    State(state): State<AppState>,
    Path((id, focus_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<models::GoalFocusSummary>> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal_focus_update")?;
    let actor = actor_from(&state, &headers, &value)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    let input: models::UpdateGoalFocusRequest = parse_body(&body, "invalid_goal_focus_update")?;
    store::update_goal_focus(&state.db, &id, &focus_id, input, &actor)
        .map(Json)
        .map_err(update_error)
}

async fn create_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<models::GoalItemSummary>)> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal_item")?;
    let actor = actor_from(&state, &headers, &value)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    let input: models::CreateGoalItemRequest = parse_body(&body, "invalid_goal_item")?;
    let item = store::create_goal_item(&state.db, &id, input, &actor).map_err(|error| {
        let message = error.to_string();
        let status = if matches!(
            message.as_str(),
            "goal_agent_must_propose" | "agent_actor_not_found"
        ) {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::BAD_REQUEST
        };
        json_error(status, message)
    })?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_item(
    State(state): State<AppState>,
    Path((id, item_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<models::GoalItemSummary>> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal_item_update")?;
    let actor = actor_from(&state, &headers, &value)?;
    store::assert_can_update_goal_item(&state.db, &id, &item_id, &actor)
        .map_err(item_auth_error)?;
    let input: models::UpdateGoalItemRequest = parse_body(&body, "invalid_goal_item_update")?;
    store::update_goal_item(&state.db, &id, &item_id, input, &actor)
        .map(Json)
        .map_err(item_update_error)
}

async fn remove_item(
    State(state): State<AppState>,
    Path((id, item_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult<Json<models::GoalItemSummary>> {
    let actor = actor_from(&state, &headers, &serde_json::Value::Null)?;
    store::assert_can_update_goal_item(&state.db, &id, &item_id, &actor)
        .map_err(item_auth_error)?;
    let input = models::UpdateGoalItemRequest {
        status: Some("cancelled".to_string()),
        ..Default::default()
    };
    store::update_goal_item(&state.db, &id, &item_id, input, &actor)
        .map(Json)
        .map_err(item_update_error)
}

async fn create_proposal(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<models::GoalProposalSummary>)> {
    let value: serde_json::Value = parse_body(&body, "invalid_goal_proposal")?;
    let actor = actor_from(&state, &headers, &value)?;
    let input: models::CreateGoalProposalRequest = parse_body(&body, "invalid_goal_proposal")?;
    let proposal = store::create_goal_proposal(&state.db, &id, input, &actor).map_err(|error| {
        let message = error.to_string();
        let status = if message == "agent_actor_not_found" {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::BAD_REQUEST
        };
        json_error(status, message)
    })?;
    Ok((StatusCode::CREATED, Json(proposal)))
}

async fn approve_proposal(
    State(state): State<AppState>,
    Path((id, proposal_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult<Json<models::GoalProposalSummary>> {
    let actor = actor_from(&state, &headers, &serde_json::Value::Null)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    store::apply_goal_proposal(&state.db, &id, &proposal_id, &actor)
        .map(Json)
        .map_err(update_error)
}

async fn reject_proposal(
    State(state): State<AppState>,
    Path((id, proposal_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult<Json<models::GoalProposalSummary>> {
    let actor = actor_from(&state, &headers, &serde_json::Value::Null)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    store::reject_goal_proposal(&state.db, &id, &proposal_id, &actor)
        .map(Json)
        .map_err(update_error)
}

async fn plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<(StatusCode, Json<models::GoalPlanResponse>)> {
    let actor = actor_from(&state, &headers, &serde_json::Value::Null)?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    store::assert_can_manage_goal(&state.db, &goal, &actor).map_err(manage_error)?;
    // TS createDefaultGoalPlan is deterministic (template-based) and does NOT call an LLM provider.
    let items = store::create_default_goal_plan(&state.db, &id, &actor).map_err(|error| {
        let message = error.to_string();
        let status = if matches!(
            message.as_str(),
            "goal_agent_must_propose" | "agent_actor_not_found"
        ) {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::BAD_REQUEST
        };
        json_error(status, message)
    })?;
    let goal = store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "goal_not_found"))?;
    Ok((
        StatusCode::CREATED,
        Json(models::GoalPlanResponse { goal, items }),
    ))
}

async fn orchestrate(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<(StatusCode, Json<models::GoalOrchestrateResponse>)> {
    // Confirm goal exists first (TS returns goal_not_found before authorization).
    if store::get_goal(&state.db, &id)
        .map_err(api_error)?
        .is_none()
    {
        return Err(json_error(StatusCode::NOT_FOUND, "goal_not_found"));
    }
    let actor = actor_from(&state, &headers, &serde_json::Value::Null)?;
    let outcome = store::orchestrate_goal(&state.db, &id, &actor).map_err(|error| {
        let message = error.to_string();
        let status = match message.as_str() {
            "goal_agent_must_propose" | "agent_actor_not_found" => StatusCode::FORBIDDEN,
            "goal_owner_not_room" => StatusCode::BAD_REQUEST,
            "room_not_found" | "goal_not_found" => StatusCode::NOT_FOUND,
            _ => StatusCode::BAD_REQUEST,
        };
        json_error(status, message)
    })?;
    // Mirror orchestrateRoom(goal.ownerId, "goal.orchestrated") so the room scheduler
    // actually launches the freshly-created tasks (codex runs are fire-and-forget).
    if !outcome.tasks.is_empty() {
        let _ = crate::api::rooms::orchestrate_room_runtime(
            state.clone(),
            outcome.goal.owner_id.clone(),
            "goal.orchestrated",
        )
        .await;
    }
    Ok((
        StatusCode::CREATED,
        Json(models::GoalOrchestrateResponse {
            goal: outcome.goal,
            tasks: outcome.tasks,
        }),
    ))
}

// Error mappers mirroring the per-route status logic in routes.ts.
fn manage_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    let message = error.to_string();
    let status = if matches!(
        message.as_str(),
        "goal_agent_must_propose" | "agent_actor_not_found"
    ) {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::NOT_FOUND
    };
    json_error(status, message)
}

fn update_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    let message = error.to_string();
    let status = if matches!(
        message.as_str(),
        "goal_agent_must_propose" | "agent_actor_not_found"
    ) {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::NOT_FOUND
    };
    json_error(status, message)
}

fn item_auth_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    let message = error.to_string();
    let status = if matches!(
        message.as_str(),
        "goal_item_agent_not_assigned" | "agent_actor_not_found"
    ) {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::NOT_FOUND
    };
    json_error(status, message)
}

fn item_update_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    let message = error.to_string();
    let status = if matches!(
        message.as_str(),
        "goal_item_agent_not_assigned" | "agent_actor_not_found"
    ) {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::NOT_FOUND
    };
    json_error(status, message)
}

fn ensure_goal(state: &AppState, id: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if store::detail(&state.db, id).map_err(api_error)?.is_some() {
        Ok(())
    } else {
        Err(json_error(StatusCode::NOT_FOUND, "goal_not_found"))
    }
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
