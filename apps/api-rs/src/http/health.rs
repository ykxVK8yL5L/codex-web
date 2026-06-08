use axum::{extract::State, Json};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    status: &'static str,
    bind_addr: String,
    data_dir: String,
    sqlite_path: String,
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        bind_addr: state.config.bind_addr().to_string(),
        data_dir: state.db.data_dir.display().to_string(),
        sqlite_path: state.db.sqlite_path.display().to_string(),
    })
}
