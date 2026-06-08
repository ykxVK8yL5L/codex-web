pub(crate) mod events;
pub(crate) mod models;
pub(crate) mod store;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

use super::common::parse_limit;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create).delete(clear))
        .route("/read", patch(mark_read))
        .route("/events", get(stream_events))
}

/// `GET /api/app-notifications/events` — SSE stream of app-notification snapshots.
async fn stream_events(State(state): State<AppState>) -> impl IntoResponse {
    events::stream(state)
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<String>,
}

#[derive(Deserialize)]
struct MarkReadRequest {
    ids: Option<Vec<String>>,
    all: Option<bool>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Json<models::AppNotificationsResponse> {
    Json(
        store::list(&state.db, parse_limit(query.limit.as_deref(), 30, 100)).unwrap_or(
            models::AppNotificationsResponse {
                items: Vec::new(),
                unread_count: 0,
            },
        ),
    )
}

async fn mark_read(
    State(state): State<AppState>,
    Json(body): Json<MarkReadRequest>,
) -> Json<models::AppNotificationsResponse> {
    let response = store::mark_read(
        &state.db,
        body.all.unwrap_or(false),
        body.ids.as_deref().unwrap_or(&[]),
    )
    .unwrap_or(models::AppNotificationsResponse {
        items: Vec::new(),
        unread_count: 0,
    });
    events::publish_snapshot(&state);
    Json(response)
}

async fn clear(State(state): State<AppState>) -> Json<serde_json::Value> {
    let deleted = store::clear(&state.db).unwrap_or(0);
    events::publish_snapshot(&state);
    Json(serde_json::json!({ "ok": true, "deleted": deleted }))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::CreateAppNotificationRequest>,
) -> Result<(StatusCode, Json<models::AppNotificationSummary>), (StatusCode, Json<serde_json::Value>)>
{
    let notification = store::create(&state.db, body).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
    })?;
    events::publish_notification(&state, &notification);
    events::publish_snapshot(&state);
    Ok((StatusCode::CREATED, Json(notification)))
}
