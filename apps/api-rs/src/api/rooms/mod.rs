pub mod events;
pub mod models;
pub mod store;

use std::path::Path;

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::common::{parse_limit, PageResponse};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(detail).patch(update))
        .route("/:id/agents", get(agents).post(add_agent))
        .route("/:id/agents/:agentId", patch(update_agent))
        .route("/:id/events", get(events))
        .route("/:id/events/stream", get(events_stream))
        .route("/:id/artifacts", get(list_artifacts).post(create_artifact))
        .route("/:id/decisions", get(list_decisions).post(create_decision))
        .route("/:id/decisions/:decisionId", patch(update_decision))
        .route("/:id/handoffs", get(list_handoffs).post(create_handoff))
        .route("/:id/handoffs/:handoffId", patch(update_handoff))
        .route("/:id/messages", post(create_message))
        .route("/:id/tasks", get(tasks).post(create_task))
        .route("/:id/tasks/retry-failed", post(retry_failed_tasks))
        .route("/:id/tasks/:taskId", patch(update_task).delete(delete_task))
        .route("/:id/tasks/:taskId/cancel", post(cancel_task))
        .route("/:id/tasks/:taskId/retry", post(retry_task))
        .route("/:id/tasks/:taskId/start", post(start_task))
        .route("/:id/runs", get(runs))
        .route("/:id/runs/:runId/diff", get(run_diff))
        .route("/:id/runs/:runId/merge", post(run_merge))
        .route("/:id/runs/:runId/reject", post(run_reject))
        .route("/:id/schedules", get(list_schedules).post(create_schedule))
        .route("/:id/schedules/:scheduleId", delete(delete_schedule))
}

type ApiResult<T> = Result<T, (StatusCode, Json<serde_json::Value>)>;

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
    limit: Option<String>,
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<String>,
}

/// Wrap a full result set as a single page (no cursor). Used by room list endpoints the
/// frontend consumes as PageResponse { items, nextCursor, hasMore }.
fn page_all<T>(items: Vec<T>) -> PageResponse<T> {
    PageResponse {
        items,
        next_cursor: None,
        has_more: false,
    }
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<PageResponse<models::RoomSummary>>> {
    let limit = parse_limit(query.limit.as_deref(), 50, 100);
    store::list_rooms(&state.db, query.status.as_deref(), limit)
        .map(Json)
        .map_err(api_error)
}

async fn detail(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<models::RoomSummary>> {
    store::get_room(&state.db, &id)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "room_not_found"))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::CreateRoomRequest>,
) -> ApiResult<(StatusCode, Json<models::RoomSummary>)> {
    let room = store::create_room(&state.db, body).map_err(room_error)?;
    events::publish_activity(&state, &room.id);
    Ok((StatusCode::CREATED, Json(room)))
}

async fn update(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::UpdateRoomRequest>,
) -> ApiResult<Json<models::RoomSummary>> {
    let room = store::update_room(&state.db, &id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(room))
}

async fn agents(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<Vec<models::RoomAgentSummary>>> {
    ensure_room(&state, &id)?;
    store::room_agents(&state.db, &id)
        .map(Json)
        .map_err(api_error)
}

async fn add_agent(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::AddRoomAgentRequest>,
) -> ApiResult<(StatusCode, Json<Vec<models::RoomAgentSummary>>)> {
    let agents = store::add_room_agent(&state.db, &id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok((StatusCode::CREATED, Json(agents)))
}

async fn update_agent(
    State(state): State<AppState>,
    AxumPath((id, agent_id)): AxumPath<(String, String)>,
    Json(body): Json<models::UpdateRoomAgentRequest>,
) -> ApiResult<Json<Vec<models::RoomAgentSummary>>> {
    let agents = store::update_room_agent(&state.db, &id, &agent_id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(agents))
}

async fn events(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<LimitQuery>,
) -> ApiResult<Json<PageResponse<models::RoomEventSummary>>> {
    ensure_room(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 80, 200);
    store::room_events(&state.db, &id, limit)
        .map(|items| Json(page_all(items)))
        .map_err(api_error)
}

/// `GET /api/rooms/:id/events/stream` — SSE stream of room activity (mirrors server/routes.ts).
async fn events_stream(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    ensure_room(&state, &id)?;
    Ok(events::stream(state, id).into_response())
}

async fn list_artifacts(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<PageResponse<models::RoomArtifactSummary>>> {
    store::list_artifacts(&state.db, &id)
        .map(|items| Json(page_all(items)))
        .map_err(room_error)
}

async fn create_artifact(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::CreateRoomArtifactRequest>,
) -> ApiResult<(StatusCode, Json<models::RoomArtifactSummary>)> {
    let artifact = store::create_artifact(&state.db, &id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok((StatusCode::CREATED, Json(artifact)))
}

async fn list_decisions(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<PageResponse<models::RoomDecisionSummary>>> {
    store::list_decisions(&state.db, &id)
        .map(|items| Json(page_all(items)))
        .map_err(room_error)
}

async fn create_decision(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::CreateRoomDecisionRequest>,
) -> ApiResult<(StatusCode, Json<models::RoomDecisionSummary>)> {
    let decision = store::create_decision(&state.db, &id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok((StatusCode::CREATED, Json(decision)))
}

async fn update_decision(
    State(state): State<AppState>,
    AxumPath((id, decision_id)): AxumPath<(String, String)>,
    Json(body): Json<models::UpdateRoomDecisionRequest>,
) -> ApiResult<Json<models::RoomDecisionSummary>> {
    let decision =
        store::update_decision(&state.db, &id, &decision_id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(decision))
}

async fn list_handoffs(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<PageResponse<models::RoomHandoffSummary>>> {
    store::list_handoffs(&state.db, &id)
        .map(|items| Json(page_all(items)))
        .map_err(room_error)
}

async fn create_handoff(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::CreateRoomHandoffRequest>,
) -> ApiResult<(StatusCode, Json<models::RoomHandoffSummary>)> {
    let handoff = store::create_handoff(&state.db, &id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok((StatusCode::CREATED, Json(handoff)))
}

async fn update_handoff(
    State(state): State<AppState>,
    AxumPath((id, handoff_id)): AxumPath<(String, String)>,
    Json(body): Json<models::UpdateRoomHandoffRequest>,
) -> ApiResult<Json<models::RoomHandoffSummary>> {
    let handoff = store::update_handoff(&state.db, &id, &handoff_id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(handoff))
}

async fn tasks(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<LimitQuery>,
) -> ApiResult<Json<PageResponse<models::RoomTaskSummary>>> {
    ensure_room(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 50, 200);
    store::room_tasks(&state.db, &id, limit)
        .map(|items| Json(page_all(items)))
        .map_err(api_error)
}

async fn create_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::CreateRoomTaskRequest>,
) -> ApiResult<(StatusCode, Json<models::RoomTaskSummary>)> {
    let task = store::create_task(&state.db, &id, body).map_err(room_error)?;
    // Mirror orchestrateRoom(roomId, "task.created").
    let _ = orchestrate_and_launch(&state, &id, "task.created").await;
    events::publish_activity(&state, &id);
    Ok((StatusCode::CREATED, Json(task)))
}

async fn retry_failed_tasks(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let retried = store::retry_failed_tasks(&state.db, &id).map_err(room_error)?;
    if retried > 0 {
        // Mirror orchestrateRoom(roomId, "task.retry") when any retried.
        let _ = orchestrate_and_launch(&state, &id, "task.retry").await;
        events::publish_activity(&state, &id);
    }
    Ok(Json(serde_json::json!({ "ok": true, "retried": retried })))
}

async fn update_task(
    State(state): State<AppState>,
    AxumPath((id, task_id)): AxumPath<(String, String)>,
    Json(body): Json<models::UpdateRoomTaskRequest>,
) -> ApiResult<Json<models::RoomTaskSummary>> {
    let task = store::update_task(&state.db, &id, &task_id, body).map_err(room_error)?;
    // Mirror orchestrateRoom(roomId, "task.updated").
    let _ = orchestrate_and_launch(&state, &id, "task.updated").await;
    events::publish_activity(&state, &id);
    Ok(Json(task))
}

async fn cancel_task(
    State(state): State<AppState>,
    AxumPath((id, task_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<models::RoomTaskSummary>> {
    // Mirror TS best-effort process cancellation: signal the live codex runner for the
    // running agent_run session before marking the room task cancelled in the DB. If the
    // process is not in this Rust process' runtime state (e.g. after restart), stop_task still
    // marks task_runs.stop_requested; broader orphan-process recovery remains maintenance-level.
    if let Ok(Some(session_id)) = store::running_task_session_id(&state.db, &id, &task_id) {
        let _ = crate::api::tasks::runner::stop_task(&state, &session_id);
    }
    let task = store::cancel_task(&state.db, &id, &task_id).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(task))
}

async fn retry_task(
    State(state): State<AppState>,
    AxumPath((id, task_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<models::RoomTaskSummary>> {
    let task = store::retry_task(&state.db, &id, &task_id).map_err(room_error)?;
    // Mirror orchestrateRoom(roomId, "task.retry").
    let _ = orchestrate_and_launch(&state, &id, "task.retry").await;
    events::publish_activity(&state, &id);
    Ok(Json(task))
}

async fn delete_task(
    State(state): State<AppState>,
    AxumPath((id, task_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    store::delete_task(&state.db, &id, &task_id).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(serde_json::json!({ "ok": true, "id": task_id })))
}

// `POST /tasks/:taskId/start` and `/messages` require the live agent-run/codex orchestration
// engine (spawning processes, building workspaces/prompts). That engine is not ported to Rust.
// We return a 501-style error so callers get an explicit signal rather than silent success.
async fn start_task(
    State(state): State<AppState>,
    AxumPath((id, task_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    // Port of startRoomTaskRun: validate task/agent/role/membership + concurrency, build the
    // workspace + prompt, insert the agent_runs row, then launch codex through the task runner.
    let launch = store::start_room_task(&state.db, &id, &task_id).map_err(room_error)?;
    let run = serde_json::to_value(&launch.run).unwrap_or(serde_json::json!(null));
    let session_value = serde_json::to_value(&launch.session).unwrap_or(serde_json::json!(null));
    // Seed the conversation with the user task prompt (mirror appendSessionMessage), then launch.
    let _ = crate::api::sessions::messages::append(
        &state.db,
        &launch.session.id,
        crate::api::sessions::models::AppendSessionMessageRequest {
            role: Some("user".to_string()),
            content: Some(launch.task_prompt.clone()),
            reply_to_message_id: None,
        },
    );
    crate::api::tasks::runner::start_room_run(
        state.clone(),
        launch.session.clone(),
        launch.prompt,
        std::path::PathBuf::from(&launch.cwd),
        launch.provider_id,
        launch.model,
        launch.reset_output,
    )
    .await
    .map_err(api_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(
        serde_json::json!({ "run": run, "session": session_value }),
    ))
}

async fn create_message(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::CreateRoomMessageRequest>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    // Port of POST /api/rooms/:id/messages: persist the user message to the room parent
    // session, resolve @mentions + auto-listen agents, queue their tasks, then run the
    // room orchestrator to launch eligible tasks (codex runs are fire-and-forget).
    let mentions_user = store::message_mentions_user(body.content.as_deref());
    let outcome = store::create_room_message(&state.db, &id, body).map_err(room_error)?;
    let reason = if mentions_user {
        "user.mentioned"
    } else {
        "user.message"
    };
    let (orchestrated_tasks, runs) = orchestrate_and_launch(&state, &id, reason)
        .await
        .map_err(api_error)?;
    events::publish_activity(&state, &id);

    let mut tasks: Vec<serde_json::Value> = outcome
        .tasks
        .iter()
        .map(|task| serde_json::to_value(task).unwrap_or(serde_json::json!(null)))
        .collect();
    tasks.extend(
        orchestrated_tasks
            .into_iter()
            .map(|task| serde_json::to_value(&task).unwrap_or(serde_json::json!(null))),
    );
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "event": outcome.event,
            "message": outcome.message,
            "session": outcome.session,
            "tasks": tasks,
            "runs": runs,
        })),
    ))
}

/// Public entry point for other modules (e.g. goals orchestrate) to run the room
/// orchestrator and start eligible tasks. Errors are swallowed by the caller; this
/// returns the orchestrator-created tasks + started run summaries.
pub async fn orchestrate_room_runtime(
    state: AppState,
    room_id: String,
    reason: &str,
) -> anyhow::Result<(Vec<models::RoomTaskSummary>, Vec<serde_json::Value>)> {
    orchestrate_and_launch(&state, &room_id, reason).await
}

/// Run the room orchestrator (store::orchestrate_room) and start the codex runner for each
/// resulting launch (mirrors orchestrateRoom + startRoomTaskRun). Returns the orchestrator
/// created tasks + the started run summaries. Codex runs are fire-and-forget.
async fn orchestrate_and_launch(
    state: &AppState,
    room_id: &str,
    reason: &str,
) -> anyhow::Result<(Vec<models::RoomTaskSummary>, Vec<serde_json::Value>)> {
    let result = store::orchestrate_room(&state.db, room_id, reason)
        .map_err(|error| anyhow::anyhow!(error.code))?;
    let mut runs = Vec::new();
    for launch in result.launches {
        let run_value = serde_json::to_value(&launch.run).unwrap_or(serde_json::json!(null));
        // Seed the conversation with the user task prompt (mirror appendSessionMessage), then launch.
        let _ = crate::api::sessions::messages::append(
            &state.db,
            &launch.session.id,
            crate::api::sessions::models::AppendSessionMessageRequest {
                role: Some("user".to_string()),
                content: Some(launch.task_prompt.clone()),
                reply_to_message_id: None,
            },
        );
        crate::api::tasks::runner::start_room_run(
            state.clone(),
            launch.session.clone(),
            launch.prompt,
            std::path::PathBuf::from(&launch.cwd),
            launch.provider_id,
            launch.model,
            launch.reset_output,
        )
        .await?;
        runs.push(run_value);
    }
    events::publish_activity(state, room_id);
    Ok((result.tasks, runs))
}

async fn runs(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<LimitQuery>,
) -> ApiResult<Json<PageResponse<models::AgentRunSummary>>> {
    ensure_room(&state, &id)?;
    let limit = parse_limit(query.limit.as_deref(), 50, 200);
    store::room_runs(&state.db, &id, limit)
        .map(|items| Json(page_all(items)))
        .map_err(api_error)
}

async fn run_diff(
    State(state): State<AppState>,
    AxumPath((id, run_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<models::RoomRunDiffResponse>> {
    let (_run, workspace) =
        store::run_workspace_path(&state.db, &id, &run_id).map_err(room_error)?;
    let workspace = workspace.unwrap_or_default();
    if workspace.is_empty() || !Path::new(&workspace).exists() {
        return Err(json_error(StatusCode::NOT_FOUND, "workspace_not_found"));
    }
    let status = run_git(&workspace, &["status", "--short"]).await;
    let stat = run_git(&workspace, &["diff", "--stat"]).await;
    let diff = run_git(&workspace, &["diff", "--"]).await;
    let error = [&status.1, &stat.1, &diff.1]
        .iter()
        .find(|s| !s.is_empty())
        .map(|s| s.to_string());
    Ok(Json(models::RoomRunDiffResponse {
        run_id,
        ok: status.2 == Some(0) && stat.2 == Some(0) && diff.2 == Some(0),
        workspace_path: workspace,
        status: status.0,
        stat: stat.0,
        diff: diff.0,
        error,
    }))
}

async fn run_merge(
    State(state): State<AppState>,
    AxumPath((id, run_id)): AxumPath<(String, String)>,
) -> ApiResult<impl IntoResponse> {
    // Port of applyRoomRunMerge: locate the agent worktree diff, run the optional project
    // check-command gate, then git-apply the patch back to the bound project workspace.
    if let Some(pending) =
        store::maybe_create_run_merge_approval(&state, &id, &run_id).map_err(room_error)?
    {
        events::publish_activity(&state, &id);
        return Ok((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "approval_required",
                "approval": pending.approval
            })),
        )
            .into_response());
    }
    let response = store::apply_run_merge(&state.db, &id, &run_id).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(response).into_response())
}

async fn run_reject(
    State(state): State<AppState>,
    AxumPath((id, run_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<models::RoomRunMergeResponse>> {
    let run = store::reject_run_merge(&state.db, &id, &run_id).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(models::RoomRunMergeResponse {
        run,
        ok: true,
        message: None,
    }))
}

async fn list_schedules(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<PageResponse<models::RoomScheduleSummary>>> {
    store::list_schedules(&state.db, &id)
        .map(|items| Json(page_all(items)))
        .map_err(room_error)
}

async fn create_schedule(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<models::CreateRoomScheduleRequest>,
) -> ApiResult<(StatusCode, Json<models::RoomScheduleSummary>)> {
    let schedule = store::create_schedule(&state.db, &id, body).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok((StatusCode::CREATED, Json(schedule)))
}

async fn delete_schedule(
    State(state): State<AppState>,
    AxumPath((id, schedule_id)): AxumPath<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    store::delete_schedule(&state.db, &id, &schedule_id).map_err(room_error)?;
    events::publish_activity(&state, &id);
    Ok(Json(serde_json::json!({ "ok": true, "id": schedule_id })))
}

/// Check active one-shot room schedules and launch due scheduled tasks. Used by the
/// process-level lightweight scheduler and safe to call opportunistically from routes.
pub async fn trigger_due_room_schedules_runtime(
    state: AppState,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let launches = store::trigger_due_room_schedules(&state.db, 20)
        .map_err(|error| anyhow::anyhow!(error.code))?;
    let mut runs = Vec::new();
    for launch in launches {
        let run_value = serde_json::to_value(&launch.run).unwrap_or(serde_json::json!(null));
        let _ = crate::api::sessions::messages::append(
            &state.db,
            &launch.session.id,
            crate::api::sessions::models::AppendSessionMessageRequest {
                role: Some("user".to_string()),
                content: Some(launch.task_prompt.clone()),
                reply_to_message_id: None,
            },
        );
        crate::api::tasks::runner::start_room_run(
            state.clone(),
            launch.session.clone(),
            launch.prompt,
            std::path::PathBuf::from(&launch.cwd),
            launch.provider_id,
            launch.model,
            launch.reset_output,
        )
        .await?;
        runs.push(run_value);
    }
    for run in &runs {
        if let Some(room_id) = run
            .get("roomId")
            .or_else(|| run.get("room_id"))
            .and_then(|value| value.as_str())
        {
            events::publish_activity(&state, room_id);
        }
    }
    Ok(runs)
}

/// Run a git command in `cwd`, returning (stdout, stderr, exit_code) mirroring runGitSync().
async fn run_git(cwd: &str, args: &[&str]) -> (String, String, Option<i32>) {
    match tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
    {
        Ok(output) => (
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
            output.status.code(),
        ),
        Err(error) => (String::new(), error.to_string(), None),
    }
}

fn ensure_room(state: &AppState, id: &str) -> ApiResult<()> {
    if store::get_room(&state.db, id).map_err(api_error)?.is_some() {
        Ok(())
    } else {
        Err(json_error(StatusCode::NOT_FOUND, "room_not_found"))
    }
}

fn api_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn room_error(error: store::RoomError) -> (StatusCode, Json<serde_json::Value>) {
    let status = StatusCode::from_u16(error.status).unwrap_or(StatusCode::BAD_REQUEST);
    json_error(status, error.code)
}

fn json_error(
    status: StatusCode,
    error: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": error.into() })))
}
