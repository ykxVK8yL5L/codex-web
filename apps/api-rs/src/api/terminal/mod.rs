pub mod models;
mod runtime;
mod ws;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/defaults", get(defaults))
        .route("/sessions", get(list_sessions).post(create_session))
        .route(
            "/sessions/:id",
            patch(rename_session).delete(delete_session),
        )
        .route("/exec", axum::routing::post(exec_command))
        .route("/ws", get(ws::ws))
}

async fn defaults() -> Json<models::TerminalDefaultsResponse> {
    Json(models::TerminalDefaultsResponse {
        default_cwd: runtime::default_cwd(),
    })
}

async fn list_sessions(State(state): State<AppState>) -> Json<Vec<models::TerminalSessionSummary>> {
    Json(state.terminals.list())
}

async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<models::CreateTerminalSessionRequest>,
) -> Result<(StatusCode, Json<models::TerminalSessionSummary>), (StatusCode, Json<serde_json::Value>)>
{
    let summary = runtime::create_session(&state.terminals, body, false)
        .await
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?;
    Ok((StatusCode::CREATED, Json(summary)))
}

async fn rename_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpdateTerminalSessionRequest>,
) -> Result<Json<models::TerminalSessionSummary>, (StatusCode, Json<serde_json::Value>)> {
    let Some(mut handle) = state.terminals.remove(&id) else {
        return Err(error(StatusCode::NOT_FOUND, "terminal_session_not_found"));
    };
    if let Some(name) = body.name.filter(|name| !name.trim().is_empty()) {
        handle.summary.name = name;
    }
    let summary = handle.summary.clone();
    state.terminals.insert(handle);
    Ok(Json(summary))
}

async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    if let Some(handle) = state.terminals.remove(&id) {
        let _ = handle.kill.send(());
    }
    Json(serde_json::json!({ "ok": true }))
}

fn error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message.into() })))
}

async fn exec_command(
    State(_state): State<AppState>,
    Json(body): Json<models::TerminalCommandRequest>,
) -> Result<Json<models::TerminalCommandResponse>, (StatusCode, Json<serde_json::Value>)> {
    let command = body
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(command) = command else {
        return Err(error(StatusCode::BAD_REQUEST, "command_required"));
    };
    let cwd = runtime::resolve_cwd(body.cwd.as_deref())
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?;
    let cwd_display = cwd.display().to_string();
    let result = runtime::run_command(command, &cwd_display).await;
    Ok(Json(models::TerminalCommandResponse {
        command: command.to_string(),
        cwd: cwd_display,
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        duration_ms: result.duration_ms,
        timed_out: result.timed_out,
    }))
}
