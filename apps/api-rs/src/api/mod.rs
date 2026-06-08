pub mod agents;
pub mod app_notifications;
pub mod approvals;
pub mod auth;
pub mod automations;
pub mod common;
pub mod execution_contexts;
pub mod extensions;
pub mod files;
pub mod goals;
pub mod notifications;
pub mod previews;
pub mod projects;
pub mod providers;
pub mod rooms;
pub mod sessions;
pub mod settings;
pub mod tasks;
pub mod terminal;
pub mod webhooks;

use axum::{middleware, Router};

use crate::state::AppState;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/provider-proxy/:provider_id/:proxy_token/v1/responses",
            axum::routing::post(provider_proxy_responses),
        )
        .merge(
            protected_api_router().route_layer(middleware::from_fn_with_state(
                state,
                auth::guard::require_api_auth,
            )),
        )
}

fn protected_api_router() -> Router<AppState> {
    Router::new()
        .nest("/api", agents::router())
        .nest("/api/auth", auth::router())
        .nest("/api", files::router())
        .nest("/api/goals", goals::router())
        .nest("/api/app-notifications", app_notifications::router())
        .nest("/api/approvals", approvals::router())
        .nest("/api/approval-grants", approvals::grants_router())
        .nest("/api/automations", automations::router())
        .nest("/api/extensions", extensions::router())
        .nest("/api/notifications", notifications::router())
        .nest("/api/providers", providers::router())
        .nest("/api/previews", previews::router())
        .nest("/api/projects", projects::router())
        .nest("/api/rooms", rooms::router())
        .nest("/api/sessions", sessions::router())
        .nest("/api/settings", settings::router())
        .nest("/api/codex/tasks", tasks::router())
        .nest("/api/task-runs", tasks::task_runs_router())
        .nest("/api/execution-contexts", execution_contexts::router())
        .nest("/api/terminal", terminal::router())
        .nest("/api", webhooks::router())
}

async fn provider_proxy_responses(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Path((provider_id, proxy_token)): axum::extract::Path<(String, String)>,
    mut headers: axum::http::HeaderMap,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<axum::response::Response, (axum::http::StatusCode, axum::Json<serde_json::Value>)> {
    headers.insert(
        axum::http::header::AUTHORIZATION,
        axum::http::HeaderValue::from_str(&format!("Bearer {proxy_token}"))
            .unwrap_or_else(|_| axum::http::HeaderValue::from_static("Bearer invalid")),
    );
    providers::proxy_responses_for_provider_id(&state, &provider_id, &headers, body).await
}
