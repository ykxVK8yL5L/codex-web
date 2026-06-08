pub(crate) mod models;
mod proxy;
mod runtime;
pub(crate) mod store;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use super::common::{parse_limit, PageResponse};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/detect", post(draft_detect))
        .route("/models", post(draft_models))
        .route("/:id", patch(update).delete(remove))
        .route("/:id/detect", post(detect))
        .route("/:id/test", post(test))
        .route("/:id/models", get(models))
        .route("/:id/health", get(health).delete(clear_health))
        .route("/:id/proxy/responses", post(proxy_responses))
}

pub(crate) async fn proxy_responses_for_provider_id(
    state: &AppState,
    id: &str,
    headers: &HeaderMap,
    body: serde_json::Value,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let Some(provider) = store::get_provider_record(&state.db, id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
    else {
        return Err(error(StatusCode::NOT_FOUND, "provider_not_found"));
    };
    proxy::proxy_responses(&provider, headers, body)
        .await
        .map_err(|(status, value)| (status, Json(value)))
}

async fn list(State(state): State<AppState>) -> Json<Vec<models::ProviderSummary>> {
    Json(store::list_providers(&state.db).unwrap_or_default())
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<models::ProviderInput>,
) -> Result<(StatusCode, Json<models::ProviderSummary>), (StatusCode, Json<serde_json::Value>)> {
    let provider = store::create_provider(&state.db, body)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?;
    Ok((StatusCode::CREATED, Json(provider)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::ProviderInput>,
) -> Result<Json<models::ProviderSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::update_provider(&state.db, &id, body)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
        .map(Json)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "provider_not_found"))
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if store::delete_provider(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
    {
        Ok(Json(serde_json::json!({ "ok": true, "id": id })))
    } else {
        Err(error(StatusCode::NOT_FOUND, "provider_not_found"))
    }
}

#[derive(Deserialize)]
struct HealthQuery {
    limit: Option<String>,
}

async fn health(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<HealthQuery>,
) -> Result<Json<PageResponse<models::ProviderHealthCheck>>, (StatusCode, Json<serde_json::Value>)>
{
    if store::get_provider_record(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
        .is_none()
    {
        return Err(error(StatusCode::NOT_FOUND, "provider_not_found"));
    }
    let limit = parse_limit(query.limit.as_deref(), 20, 100);
    let mut items = store::list_health(&state.db, &id, limit + 1)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    Ok(Json(PageResponse {
        items,
        next_cursor: None,
        has_more,
    }))
}

async fn clear_health(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if store::get_provider_record(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
        .is_none()
    {
        return Err(error(StatusCode::NOT_FOUND, "provider_not_found"));
    }
    let deleted = store::clear_health(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?;
    Ok(Json(
        serde_json::json!({ "ok": true, "id": id, "deleted": deleted }),
    ))
}

async fn test(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ProviderTestResponse>, (StatusCode, Json<serde_json::Value>)> {
    let Some(provider) = store::get_provider_record(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
    else {
        return Err(error(StatusCode::NOT_FOUND, "provider_not_found"));
    };
    let result = runtime::test_provider(&provider).await;
    let _ = store::record_health(
        &state.db,
        &id,
        "test",
        result.ok,
        result.status,
        result.duration_ms,
        result.error.as_deref(),
    );
    if !result.ok {
        emit_provider_check_failed(
            &state,
            &provider.summary,
            result.status,
            result.error.as_deref(),
            Some(result.duration_ms),
        );
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
struct DetectQuery {
    apply: Option<String>,
}

async fn detect(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DetectQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(provider) = store::get_provider_record(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
    else {
        return Err(error(StatusCode::NOT_FOUND, "provider_not_found"));
    };
    let detection = runtime::detect_provider(&provider).await;
    let status = if detection.checks.responses.ok {
        detection.checks.responses.status
    } else {
        detection.checks.chat_completions.status
    };
    let _ = store::record_health(
        &state.db,
        &id,
        "test",
        detection.ok,
        status,
        detection.duration_ms,
        detection.error.as_deref(),
    );
    if !detection.ok {
        emit_provider_check_failed(
            &state,
            &provider.summary,
            status,
            detection.error.as_deref(),
            Some(detection.duration_ms),
        );
    }
    let apply = matches!(query.apply.as_deref(), Some("1" | "true"));
    let provider = if detection.ok && apply {
        store::apply_detection(&state.db, &id, &detection)
            .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
            .unwrap_or(provider.summary)
    } else {
        provider.summary
    };
    Ok(Json(
        serde_json::json!({ "provider": provider, "detection": detection }),
    ))
}

async fn models(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<models::ProviderModelsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let Some(provider) = store::get_provider_record(&state.db, &id)
        .map_err(|err| error(StatusCode::BAD_REQUEST, err.to_string()))?
    else {
        return Err(error(StatusCode::NOT_FOUND, "provider_not_found"));
    };
    let result = runtime::discover_models(&provider).await;
    if result.ok {
        let _ = store::save_model_cache(&state.db, &id, &result.models);
    }
    let _ = store::record_health(
        &state.db,
        &id,
        "models",
        result.ok,
        result.status,
        result.duration_ms,
        result.error.as_deref(),
    );
    Ok(Json(result))
}

async fn draft_models(
    Json(body): Json<models::ProviderInput>,
) -> Json<models::ProviderModelsResponse> {
    let provider = runtime::draft_provider(body);
    Json(runtime::discover_models(&provider).await)
}

async fn draft_detect(
    Json(body): Json<models::ProviderInput>,
) -> Json<models::ProviderDetectionResponse> {
    let provider = runtime::draft_provider(body);
    Json(runtime::detect_provider(&provider).await)
}

async fn proxy_responses(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    proxy_responses_for_provider_id(&state, &id, &headers, body).await
}

fn error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message.into() })))
}

fn emit_provider_check_failed(
    state: &AppState,
    provider: &models::ProviderSummary,
    status: Option<i64>,
    error: Option<&str>,
    duration_ms: Option<i64>,
) {
    crate::api::notifications::runtime::emit_external_notification(
        state.clone(),
        crate::api::notifications::runtime::NotificationEvent {
            event_type: "provider_check_failed".to_string(),
            severity: if status == Some(429) {
                "warning"
            } else {
                "error"
            }
            .to_string(),
            title: format!("Provider 测试失败：{}", provider.name),
            message: [
                status.map(|value| format!("HTTP {value}")),
                error.map(ToOwned::to_owned),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ")
            .if_empty("Provider 连接测试失败。"),
            source_type: Some("provider".to_string()),
            source_id: Some(provider.id.clone()),
            metadata: serde_json::json!({ "status": status, "error": error, "durationMs": duration_ms }),
        },
    );
}

trait EmptyFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}
