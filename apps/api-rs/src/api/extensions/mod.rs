mod models;
mod store;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/skills",
            get(skills)
                .post(create_skill)
                .put(update_skill)
                .delete(delete_skill),
        )
        .route("/skills/import", axum::routing::post(import_skill))
        .route("/plugins", get(plugins).post(create_plugin))
        .route("/mcp", get(mcp_servers).post(create_mcp_server))
        .route("/mcp/import", axum::routing::post(import_mcp_servers))
        .route(
            "/marketplace",
            get(marketplace)
                .post(import_marketplace)
                .delete(delete_marketplace_items),
        )
        .route(
            "/marketplace/all",
            axum::routing::delete(clear_marketplace_items),
        )
        .route(
            "/marketplace/import",
            axum::routing::post(import_marketplace),
        )
        .route(
            "/marketplace/install",
            axum::routing::post(install_marketplace_item),
        )
        .route("/detail", get(detail))
}

#[derive(Deserialize)]
struct PageQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
}

#[derive(Deserialize)]
struct DetailQuery {
    #[serde(rename = "type")]
    extension_type: Option<String>,
    name: Option<String>,
    path: Option<String>,
}

async fn skills(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let items = store::list_skills(&state.config.codex_home).map_err(api_error)?;
    Ok(Json(paged_or_full(items, query)))
}

async fn create_skill(
    State(state): State<AppState>,
    Json(body): Json<models::CreateSkillRequest>,
) -> Result<(StatusCode, Json<models::ExtensionSummary>), ApiError> {
    let item = store::create_local_skill(&state.config.codex_home, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn import_skill(
    State(state): State<AppState>,
    Json(body): Json<models::ImportSkillRequest>,
) -> Result<(StatusCode, Json<models::ImportSkillResponse>), ApiError> {
    if body.url.as_deref().unwrap_or("").trim().is_empty()
        && body.content.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err(json_error(StatusCode::BAD_REQUEST, "skill_import_empty"));
    }
    let result = store::import_skill(&state.config.codex_home, body)
        .await
        .map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(result)))
}

async fn update_skill(
    State(state): State<AppState>,
    Json(body): Json<models::UpdateSkillRequest>,
) -> Result<Json<models::ExtensionSummary>, ApiError> {
    store::update_local_skill(&state.config.codex_home, body)
        .map(Json)
        .map_err(api_error)
}

async fn delete_skill(
    State(state): State<AppState>,
    Json(body): Json<models::DeleteSkillRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    store::delete_local_skill(&state.config.codex_home, body)
        .map(Json)
        .map_err(api_error)
}

async fn plugins(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let items = store::list_plugins(&state.config.codex_home).map_err(api_error)?;
    Ok(Json(paged_or_full(items, query)))
}

async fn create_plugin(
    State(state): State<AppState>,
    Json(body): Json<models::CreatePluginRequest>,
) -> Result<(StatusCode, Json<models::ExtensionSummary>), ApiError> {
    let item = store::create_local_plugin(&state.config.codex_home, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn mcp_servers(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let items = store::list_mcp_servers(&state.config.codex_home).map_err(api_error)?;
    Ok(Json(paged_or_full(items, query)))
}

async fn create_mcp_server(
    State(state): State<AppState>,
    Json(body): Json<models::CreateMcpServerRequest>,
) -> Result<(StatusCode, Json<models::ExtensionSummary>), ApiError> {
    let item = store::create_mcp_server(&state.config.codex_home, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn import_mcp_servers(
    State(state): State<AppState>,
    Json(body): Json<models::ImportMcpServerRequest>,
) -> Result<(StatusCode, Json<models::ImportMcpServerResponse>), ApiError> {
    if body.url.as_deref().unwrap_or("").trim().is_empty()
        && body.content.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err(json_error(StatusCode::BAD_REQUEST, "mcp_import_empty"));
    }
    let result = store::import_mcp_servers(&state.config.codex_home, body)
        .await
        .map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(result)))
}

async fn marketplace(
    State(state): State<AppState>,
) -> Result<Json<models::MarketplaceCatalogResponse>, ApiError> {
    store::load_marketplace_catalog(&state.db)
        .map(Json)
        .map_err(api_error)
}

async fn import_marketplace(
    State(state): State<AppState>,
    Json(body): Json<models::ImportMarketplaceCatalogRequest>,
) -> Result<Json<models::MarketplaceCatalogResponse>, ApiError> {
    if body.url.as_deref().unwrap_or("").trim().is_empty()
        && body.content.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "marketplace_catalog_empty",
        ));
    }
    store::import_marketplace_catalog(&state.db, body)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn install_marketplace_item(
    State(state): State<AppState>,
    Json(body): Json<models::InstallMarketplaceItemRequest>,
) -> Result<(StatusCode, Json<models::InstallMarketplaceItemResponse>), ApiError> {
    let result = store::install_marketplace_item(&state.config.codex_home, body)
        .await
        .map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(result)))
}

async fn delete_marketplace_items(
    State(state): State<AppState>,
    Json(body): Json<models::DeleteMarketplaceItemsRequest>,
) -> Result<Json<models::MarketplaceCatalogResponse>, ApiError> {
    store::delete_marketplace_catalog_items(&state.db, body.ids)
        .map(Json)
        .map_err(api_error)
}

async fn clear_marketplace_items(
    State(state): State<AppState>,
) -> Result<Json<models::MarketplaceCatalogResponse>, ApiError> {
    store::clear_marketplace_catalog_items(&state.db)
        .map(Json)
        .map_err(api_error)
}

async fn detail(
    State(state): State<AppState>,
    Query(query): Query<DetailQuery>,
) -> Result<Json<models::ExtensionDetail>, ApiError> {
    let extension_type = query.extension_type.as_deref().unwrap_or("");
    if !matches!(extension_type, "plugin" | "skill" | "mcp") {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "invalid_extension_type",
        ));
    }
    store::read_extension_detail(
        &state.config.codex_home,
        extension_type,
        query.name.as_deref().unwrap_or(""),
        query.path.as_deref(),
    )
    .map(Json)
    .map_err(api_error)
}

type ApiError = (StatusCode, Json<serde_json::Value>);

fn paged_or_full(items: Vec<models::ExtensionSummary>, query: PageQuery) -> serde_json::Value {
    if query.limit.is_none() && query.cursor.is_none() && query.q.is_none() {
        serde_json::to_value(items).unwrap_or_else(|_| serde_json::json!([]))
    } else {
        let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
        serde_json::to_value(store::page_extensions(
            items,
            limit,
            query.cursor.as_deref(),
            query.q.as_deref(),
        ))
        .unwrap_or_else(
            |_| serde_json::json!({ "items": [], "nextCursor": null, "hasMore": false }),
        )
    }
}

fn api_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    let status = if message.ends_with("_exists") {
        StatusCode::CONFLICT
    } else if message.ends_with("_not_found") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    };
    json_error(status, message)
}

fn json_error(status: StatusCode, error: impl Into<String>) -> ApiError {
    (status, Json(serde_json::json!({ "error": error.into() })))
}
