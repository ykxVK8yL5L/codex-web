mod backup;
mod environment;
mod maintenance;
pub(crate) mod models;
mod storage;
pub(crate) mod store;

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

pub(crate) use models::CodexRuntimeSettings;
pub use models::UpdateCodexRuntimeSettings;
pub(crate) use store::codex_runtime as load_codex_runtime;
pub(crate) use store::session_compaction as load_session_compaction;

/// Read the current codex runtime settings (used by the approvals module's approve response).
pub fn current_codex_runtime(db: &crate::db::Db) -> anyhow::Result<models::CodexRuntimeSettings> {
    store::codex_runtime(db)
}

/// Apply codex runtime settings from an approval payload (sanitize + persist). Used by the
/// approvals module when an approval of type `codex-runtime-update` is approved.
pub fn apply_codex_runtime(
    db: &crate::db::Db,
    input: models::UpdateCodexRuntimeSettings,
) -> anyhow::Result<models::CodexRuntimeSettings> {
    let current = store::codex_runtime(db)?;
    let next = store::merge_codex_runtime(&current, input);
    store::save_codex_runtime(db, next)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/preview-access",
            get(preview_access).patch(update_preview_access),
        )
        .route(
            "/session-compaction",
            get(session_compaction).patch(update_session_compaction),
        )
        .route(
            "/token-usage-retention",
            get(token_usage_retention).patch(update_token_usage_retention),
        )
        .route(
            "/token-usage-display",
            get(token_usage_display).patch(update_token_usage_display),
        )
        .route(
            "/payload-rewrite",
            get(payload_rewrite).patch(update_payload_rewrite),
        )
        .route("/rate-limit", get(rate_limit).patch(update_rate_limit))
        .route(
            "/notification-test",
            get(notification_test).patch(update_notification_test),
        )
        .route(
            "/backup",
            get(backup_settings).patch(update_backup_settings),
        )
        .route("/backup/preview", get(backup_preview))
        .route("/backup/download", get(backup_download))
        .route("/restore/preview", post(restore_preview))
        .route("/restore", post(restore_apply))
        .route("/storage", get(storage_scan))
        .route("/storage/delete", post(storage_delete))
        .route("/storage/delete-batch", post(storage_delete_batch))
        .route("/credentials", get(credentials).post(upsert_credential))
        .route("/credentials/:name", delete(delete_credential))
        .route("/environment", get(environment_overview))
        .route("/environment/scan", post(environment_overview))
        .route(
            "/environment/restore-preview",
            post(environment_restore_preview),
        )
        .route(
            "/environment/restore-missing",
            post(environment_restore_missing),
        )
        .route(
            "/environment/restore-runs",
            delete(environment_clear_restore_runs),
        )
        .route(
            "/environment/restore-runs/:id",
            delete(environment_delete_restore_run),
        )
        .route("/environment/mise/install", post(environment_mise_install))
        .route("/environment/tool-registry", get(environment_tool_registry))
        .route("/environment/tool-versions", get(environment_tool_versions))
        .route("/environment/tool-probe", get(environment_tool_probe))
        .route(
            "/environment/tools/register",
            post(environment_register_tool),
        )
        .route("/environment/tools/install", post(environment_install_tool))
        .route("/environment/tools/:id", delete(environment_delete_tool))
        .route(
            "/environment/tools/:id/set-default",
            post(environment_set_default_tool),
        )
        .route(
            "/environment/tools/:id/uninstall",
            delete(environment_uninstall_tool),
        )
        .route(
            "/environment/tools/:id/packages",
            get(environment_tool_packages),
        )
        .route(
            "/environment/tools/:id/packages/probe",
            get(environment_tool_packages_probe),
        )
        .route("/environment/bulk", post(environment_bulk))
        .route(
            "/environment/packages/install",
            post(environment_install_package),
        )
        .route(
            "/environment/packages/:id",
            delete(environment_uninstall_package),
        )
        .route("/maintenance/cleanup", post(maintenance_cleanup))
        .route("/task-health", get(task_health))
        .route("/task-health/repair", post(task_health_repair))
        .route("/approvals/reset", post(approvals_reset))
        .route(
            "/codex-runtime",
            get(codex_runtime).patch(update_codex_runtime),
        )
}

#[derive(Deserialize)]
struct ToolQuery {
    tool: Option<String>,
    q: Option<String>,
}

async fn preview_access(
    State(state): State<AppState>,
) -> Result<Json<models::PreviewAccessSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(store::preview_access(&state.db).map_err(api_error)?))
}

async fn update_preview_access(
    State(state): State<AppState>,
    Json(body): Json<store::PartialPreviewAccessSettings>,
) -> Result<Json<models::PreviewAccessSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_preview_access(&state.db, body).map_err(api_error)?,
    ))
}

async fn session_compaction(
    State(state): State<AppState>,
) -> Result<Json<models::SessionCompactionSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::session_compaction(&state.db).map_err(api_error)?,
    ))
}

async fn update_session_compaction(
    State(state): State<AppState>,
    Json(body): Json<models::UpdateSessionCompactionSettings>,
) -> Result<Json<models::SessionCompactionSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_session_compaction(&state.db, body).map_err(api_error)?,
    ))
}

async fn token_usage_retention(
    State(state): State<AppState>,
) -> Result<Json<models::TokenUsageRetentionSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::token_usage_retention(&state.db).map_err(api_error)?,
    ))
}

async fn update_token_usage_retention(
    State(state): State<AppState>,
    Json(body): Json<models::UpdateTokenUsageRetentionSettings>,
) -> Result<Json<models::TokenUsageRetentionSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_token_usage_retention(&state.db, body).map_err(api_error)?,
    ))
}

async fn token_usage_display(
    State(state): State<AppState>,
) -> Result<Json<models::TokenUsageDisplaySettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::token_usage_display(&state.db).map_err(api_error)?,
    ))
}

async fn update_token_usage_display(
    State(state): State<AppState>,
    Json(body): Json<models::UpdateTokenUsageDisplaySettings>,
) -> Result<Json<models::TokenUsageDisplaySettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_token_usage_display(&state.db, body).map_err(api_error)?,
    ))
}

async fn payload_rewrite(
    State(state): State<AppState>,
) -> Result<Json<models::PayloadRewriteSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(store::payload_rewrite(&state.db).map_err(api_error)?))
}

async fn update_payload_rewrite(
    State(state): State<AppState>,
    Json(body): Json<models::UpdatePayloadRewriteSettings>,
) -> Result<Json<models::PayloadRewriteSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_payload_rewrite(&state.db, body).map_err(api_error)?,
    ))
}

async fn rate_limit(
    State(state): State<AppState>,
) -> Result<Json<models::RateLimitSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(store::rate_limit(&state.db).map_err(api_error)?))
}

async fn update_rate_limit(
    State(state): State<AppState>,
    Json(body): Json<store::PartialRateLimitSettings>,
) -> Result<Json<models::RateLimitSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_rate_limit(&state.db, body).map_err(api_error)?,
    ))
}

async fn notification_test(
    State(state): State<AppState>,
) -> Result<Json<models::NotificationTestSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::notification_test(&state.db).map_err(api_error)?,
    ))
}

async fn update_notification_test(
    State(state): State<AppState>,
    Json(body): Json<models::UpdateNotificationTestSettings>,
) -> Result<Json<models::NotificationTestSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        store::save_notification_test(&state.db, body).map_err(api_error)?,
    ))
}

async fn backup_settings(
    State(state): State<AppState>,
) -> Result<Json<backup::SystemBackupSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(backup::settings(&state.db).map_err(api_error)?))
}

async fn update_backup_settings(
    State(state): State<AppState>,
    Json(body): Json<backup::UpdateSystemBackupSettingsRequest>,
) -> Result<Json<backup::SystemBackupSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        backup::save_settings(&state.db, body).map_err(api_error)?,
    ))
}

async fn backup_preview(
    State(state): State<AppState>,
) -> Result<Json<backup::SystemBackupPreviewResponse>, (StatusCode, Json<serde_json::Value>)> {
    backup::preview(&state.db).map(Json).map_err(|error| {
        emit_settings_failure_notification(
            &state,
            "backup_failed",
            "备份预览失败",
            error.to_string(),
            "backup",
            "preview",
        );
        api_error(error)
    })
}

async fn backup_download(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let archive = backup::create_archive(&state.db).map_err(|error| {
        emit_settings_failure_notification(
            &state,
            "backup_failed",
            "备份下载失败",
            error.to_string(),
            "backup",
            "download",
        );
        api_error(error)
    })?;
    let filename = format!(
        "codex-web-system-backup-{}.zip",
        archive.manifest.created_at.replace([':', '.'], "-")
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")).unwrap_or_else(
            |_| HeaderValue::from_static("attachment; filename=\"codex-web-system-backup.zip\""),
        ),
    );
    Ok((headers, archive.bytes))
}

async fn restore_preview(
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<Json<backup::SystemBackupPreviewResponse>, (StatusCode, Json<serde_json::Value>)> {
    let bytes = read_backup_upload(multipart).await.map_err(|error| {
        emit_settings_failure_notification(
            &state,
            "restore_failed",
            "恢复预览失败",
            error.to_string(),
            "restore",
            "preview",
        );
        api_error(error)
    })?;
    backup::preview_archive(&bytes).map(Json).map_err(|error| {
        emit_settings_failure_notification(
            &state,
            "restore_failed",
            "恢复预览失败",
            error.to_string(),
            "restore",
            "preview",
        );
        api_error(error)
    })
}

async fn restore_apply(
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<Json<backup::SystemRestoreResponse>, (StatusCode, Json<serde_json::Value>)> {
    let bytes = read_backup_upload(multipart).await.map_err(|error| {
        emit_settings_failure_notification(
            &state,
            "restore_failed",
            "系统恢复失败",
            error.to_string(),
            "restore",
            "apply",
        );
        api_error(error)
    })?;
    backup::restore_archive(&state.db, &bytes)
        .map(Json)
        .map_err(|error| {
            emit_settings_failure_notification(
                &state,
                "restore_failed",
                "系统恢复失败",
                error.to_string(),
                "restore",
                "apply",
            );
            api_error(error)
        })
}

async fn storage_scan(
    State(state): State<AppState>,
) -> Result<Json<storage::StorageScanResponse>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(storage::scan(&state.db).map_err(api_error)?))
}

#[derive(Deserialize)]
struct StorageDeleteRequest {
    r#type: Option<String>,
    path: Option<String>,
    #[serde(default)]
    force: bool,
}

#[derive(Deserialize)]
struct StorageDeleteItem {
    r#type: Option<String>,
    path: Option<String>,
}

#[derive(Deserialize)]
struct StorageDeleteBatchRequest {
    #[serde(default)]
    items: Vec<StorageDeleteItem>,
    #[serde(default)]
    force: bool,
}

async fn storage_delete(
    State(state): State<AppState>,
    Json(body): Json<StorageDeleteRequest>,
) -> Result<Json<storage::StorageScanResponse>, (StatusCode, Json<serde_json::Value>)> {
    let (Some(item_type), Some(path)) = (body.r#type.as_deref(), body.path.as_deref()) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_storage_item" })),
        ));
    };
    storage::delete_item(&state.db, item_type, path, body.force).map_err(api_error)?;
    Ok(Json(storage::scan(&state.db).map_err(api_error)?))
}

async fn storage_delete_batch(
    State(state): State<AppState>,
    Json(body): Json<StorageDeleteBatchRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if body.items.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_storage_items" })),
        ));
    }
    if !body.force {
        let current = storage::scan(&state.db).map_err(api_error)?;
        let has_active = body.items.iter().any(|item| {
            current.items.iter().any(|entry| {
                Some(entry.r#type.as_str()) == item.r#type.as_deref()
                    && Some(entry.path.as_str()) == item.path.as_deref()
                    && entry.status == "active"
            })
        });
        if has_active {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "storage_item_active", "deleted": 0 })),
            ));
        }
    }
    let mut deleted = 0u64;
    for item in &body.items {
        let (Some(item_type), Some(path)) = (item.r#type.as_deref(), item.path.as_deref()) else {
            continue;
        };
        if let Err(error) = storage::delete_item(&state.db, item_type, path, body.force) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": error.to_string(), "deleted": deleted })),
            ));
        }
        deleted += 1;
    }
    let snapshot = storage::scan(&state.db).map_err(api_error)?;
    let mut response = serde_json::to_value(&snapshot).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = response.as_object_mut() {
        object.insert("deleted".to_string(), serde_json::json!(deleted));
    }
    Ok(Json(response))
}

async fn credentials(
    State(state): State<AppState>,
) -> Result<Json<Vec<store::CredentialSummary>>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(store::credentials(&state.db).map_err(api_error)?))
}

async fn upsert_credential(
    State(state): State<AppState>,
    Json(body): Json<store::UpsertCredentialRequest>,
) -> Result<Json<store::CredentialSummary>, (StatusCode, Json<serde_json::Value>)> {
    store::upsert_credential(&state.db, body)
        .map(Json)
        .map_err(api_error)
}

async fn delete_credential(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    store::delete_credential(&state.db, &name).map_err(api_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn environment_overview(
    State(state): State<AppState>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(environment::overview(&state.db).map_err(api_error)?))
}

async fn environment_restore_preview(
    State(state): State<AppState>,
    Json(body): Json<environment::EnvironmentRestoreMissingRequest>,
) -> Result<
    Json<environment::EnvironmentRestorePreviewResponse>,
    (StatusCode, Json<serde_json::Value>),
> {
    Ok(Json(
        environment::restore_preview(&state.db, body).map_err(api_error)?,
    ))
}

async fn environment_restore_missing(
    State(state): State<AppState>,
    Json(body): Json<environment::EnvironmentRestoreMissingRequest>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        environment::restore_missing(&state.db, body).map_err(api_error)?,
    ))
}

async fn environment_register_tool(
    State(state): State<AppState>,
    Json(body): Json<environment::RegisterEnvironmentToolRequest>,
) -> Result<
    (StatusCode, Json<environment::EnvironmentOverview>),
    (StatusCode, Json<serde_json::Value>),
> {
    let overview = environment::register_tool(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(overview)))
}

async fn environment_delete_tool(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        environment::delete_tool(&state.db, &id).map_err(api_error)?,
    ))
}

async fn environment_set_default_tool(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        environment::set_default_tool(&state.db, &id).map_err(api_error)?,
    ))
}

async fn environment_tool_probe(
    Query(query): Query<ToolQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let tool = query.tool.as_deref().unwrap_or("").trim();
    if tool.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "tool_required" })),
        ));
    }
    Ok(Json(
        serde_json::json!({ "probe": environment::probe_tool(tool), "mise": environment::detect_mise_status() }),
    ))
}

async fn environment_tool_registry(
    Query(query): Query<ToolQuery>,
) -> Json<environment::EnvironmentToolRegistryResponse> {
    Json(environment::registry(query.q.as_deref()))
}

async fn environment_mise_install(
    State(state): State<AppState>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    match environment::install_mise(&state.db) {
        Ok(overview) => Ok(Json(overview)),
        Err(error) => Err(environment_error("mise_install_failed", error, &state)),
    }
}

async fn environment_tool_versions(
    Query(query): Query<ToolQuery>,
) -> Json<environment::EnvironmentToolVersionsResponse> {
    Json(environment::list_tool_versions(
        query.tool.as_deref().unwrap_or(""),
    ))
}

async fn environment_install_tool(
    State(state): State<AppState>,
    Json(body): Json<environment::InstallEnvironmentToolRequest>,
) -> Result<
    (StatusCode, Json<environment::EnvironmentOverview>),
    (StatusCode, Json<serde_json::Value>),
> {
    let tool_blank = body.tool.as_deref().unwrap_or("").trim().is_empty();
    let version_blank = body.version.as_deref().unwrap_or("").trim().is_empty();
    if tool_blank || version_blank {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_environment_tool" })),
        ));
    }
    match environment::install_tool(&state.db, body) {
        Ok(overview) => Ok((StatusCode::CREATED, Json(overview))),
        Err(error) => Err(environment_error(
            "environment_tool_install_failed",
            error,
            &state,
        )),
    }
}

async fn environment_uninstall_tool(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    match environment::uninstall_tool(&state.db, &id) {
        Ok(overview) => Ok(Json(overview)),
        Err(error) => Err(environment_error_message(error, &state)),
    }
}

async fn environment_tool_packages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<
    Json<environment::EnvironmentPackageDetailResponse>,
    (StatusCode, Json<serde_json::Value>),
> {
    environment::tool_packages(&state.db, &id)
        .map(Json)
        .map_err(|error| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": error.to_string() })),
            )
        })
}

#[derive(Deserialize)]
struct PackageProbeQuery {
    manager: Option<String>,
    package: Option<String>,
}

async fn environment_tool_packages_probe(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PackageProbeQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let overview = environment::overview(&state.db).map_err(api_error)?;
    if !overview.tools.iter().any(|item| item.id == id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "environment_tool_not_found" })),
        ));
    }
    let manager = query.manager.as_deref().unwrap_or("").trim();
    let package = query.package.as_deref().unwrap_or("").trim();
    if manager.is_empty() || package.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_environment_package_probe" })),
        ));
    }
    Ok(Json(environment::inspect_package(manager, package)))
}

async fn environment_bulk(
    State(state): State<AppState>,
    Json(body): Json<environment::EnvironmentBulkActionRequest>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    if body.action.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_environment_bulk_action" })),
        ));
    }
    environment::bulk_action(&state.db, body)
        .map(Json)
        .map_err(|error| {
            let message = error.to_string();
            let status = if message == "environment_tool_not_found" {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(serde_json::json!({ "error": message })))
        })
}

async fn environment_install_package(
    State(state): State<AppState>,
    Json(body): Json<environment::InstallEnvironmentPackageRequest>,
) -> Result<
    (StatusCode, Json<environment::EnvironmentOverview>),
    (StatusCode, Json<serde_json::Value>),
> {
    let tool_blank = body.tool_record_id.as_deref().unwrap_or("").is_empty();
    let manager_blank = body.manager.as_deref().unwrap_or("").trim().is_empty();
    let package_blank = body.package_name.as_deref().unwrap_or("").trim().is_empty();
    if tool_blank || manager_blank || package_blank {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_environment_package" })),
        ));
    }
    if !environment::overview(&state.db)
        .map_err(api_error)?
        .tools
        .iter()
        .any(|item| Some(item.id.as_str()) == body.tool_record_id.as_deref())
    {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "environment_tool_not_found" })),
        ));
    }
    match environment::install_package(&state.db, body) {
        Ok(overview) => Ok((StatusCode::CREATED, Json(overview))),
        Err(error) => Err(environment_error(
            "environment_package_install_failed",
            error,
            &state,
        )),
    }
}

async fn environment_uninstall_package(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<environment::UninstallEnvironmentPackageRequest>>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    let manager = body.and_then(|Json(value)| value.manager);
    match environment::uninstall_package(&state.db, &id, manager.as_deref()) {
        Ok(overview) => Ok(Json(overview)),
        Err(error) => Err(environment_error_message(error, &state)),
    }
}

async fn environment_delete_restore_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        environment::delete_restore_run(&state.db, &id).map_err(api_error)?,
    ))
}

async fn environment_clear_restore_runs(
    State(state): State<AppState>,
) -> Result<Json<environment::EnvironmentOverview>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        environment::clear_restore_runs(&state.db).map_err(api_error)?,
    ))
}

/// Mirror TS error shape `{ error, detail, overview }` for failed shell-out operations.
fn environment_error(
    code: &str,
    error: anyhow::Error,
    state: &AppState,
) -> (StatusCode, Json<serde_json::Value>) {
    let overview = environment::overview(&state.db).ok();
    (
        StatusCode::BAD_REQUEST,
        Json(
            serde_json::json!({ "error": code, "detail": error.to_string(), "overview": overview }),
        ),
    )
}

/// Mirror TS error shape `{ error, overview }` where the message itself is the error code.
fn environment_error_message(
    error: anyhow::Error,
    state: &AppState,
) -> (StatusCode, Json<serde_json::Value>) {
    let overview = environment::overview(&state.db).ok();
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": error.to_string(), "overview": overview })),
    )
}

async fn maintenance_cleanup(
    State(state): State<AppState>,
    body: Option<Json<maintenance::MaintenanceCleanupRequest>>,
) -> Result<Json<maintenance::MaintenanceCleanupResponse>, (StatusCode, Json<serde_json::Value>)> {
    let request = body.map(|Json(value)| value).unwrap_or_default();
    Ok(Json(
        maintenance::cleanup(&state.db, request).map_err(api_error)?,
    ))
}

async fn task_health(
    State(state): State<AppState>,
) -> Result<Json<maintenance::TaskHealthResponse>, (StatusCode, Json<serde_json::Value>)> {
    let health = maintenance::list_task_health(&state.db).map_err(api_error)?;
    if !health.ok {
        let message = health
            .items
            .iter()
            .filter_map(|item| {
                item.issue
                    .as_ref()
                    .map(|issue| format!("{}: {issue}", item.title))
            })
            .collect::<Vec<_>>()
            .join("\n");
        emit_settings_failure_notification(
            &state,
            "task_health_issue",
            "任务健康检查发现异常",
            if message.trim().is_empty() {
                "运行任务状态异常。".to_string()
            } else {
                message
            },
            "task-health",
            &health.checked_at,
        );
    }
    Ok(Json(health))
}

async fn task_health_repair(
    State(state): State<AppState>,
) -> Result<Json<maintenance::TaskHealthRepairResponse>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(
        maintenance::repair_task_health(&state.db).map_err(api_error)?,
    ))
}

async fn approvals_reset(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let deleted = maintenance::reset_approval_grants(&state.db).map_err(api_error)?;
    Ok(Json(
        serde_json::json!({ "ok": true, "deletedGrants": deleted }),
    ))
}

async fn codex_runtime(
    State(state): State<AppState>,
) -> Result<Json<models::CodexRuntimeSettings>, (StatusCode, Json<serde_json::Value>)> {
    Ok(Json(store::codex_runtime(&state.db).map_err(api_error)?))
}

/// Mirrors PATCH /api/settings/codex-runtime. When the change crosses a risk boundary the TS
/// version creates a pending approval and returns 409 `approval_required` with the persisted
/// approval, so it shows up in the approvals list. We now persist a real approval row.
async fn update_codex_runtime(
    State(state): State<AppState>,
    Json(body): Json<models::UpdateCodexRuntimeSettings>,
) -> Result<Json<models::CodexRuntimeSettings>, (StatusCode, Json<serde_json::Value>)> {
    let current = store::codex_runtime(&state.db).map_err(api_error)?;
    let next = store::merge_codex_runtime(&current, body);
    if let Some(risk) = store::codex_runtime_risk(&current, &next) {
        let title = "Codex execution permission change";
        let description = if risk == "critical" {
            "Enable Codex sandbox and approval bypass for new tasks."
        } else {
            "Enable full filesystem access for new Codex tasks."
        };
        let details = format!(
            "sandboxMode={}\napprovalPolicy={}\nbypassSandbox={}",
            next.sandbox_mode, next.approval_policy, next.bypass_sandbox
        );
        let payload = serde_json::to_value(&next).unwrap_or_else(|_| serde_json::json!({}));
        let approval = crate::api::approvals::store::create_approval_with_notification(
            &state,
            "codex-runtime-update",
            risk,
            title,
            description,
            &details,
            &payload,
        )
        .map_err(api_error)?;
        return Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "approval_required", "approval": approval })),
        ));
    }
    Ok(Json(
        store::save_codex_runtime(&state.db, next).map_err(api_error)?,
    ))
}

fn api_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": error.to_string() })),
    )
}

fn emit_settings_failure_notification(
    state: &AppState,
    event_type: &str,
    title: &str,
    message: String,
    source_type: &str,
    source_id: &str,
) {
    crate::api::notifications::runtime::emit_external_notification(
        state.clone(),
        crate::api::notifications::runtime::NotificationEvent {
            event_type: event_type.to_string(),
            severity: "error".to_string(),
            title: title.to_string(),
            message,
            source_type: Some(source_type.to_string()),
            source_id: Some(source_id.to_string()),
            metadata: serde_json::json!({}),
        },
    );
}

async fn read_backup_upload(mut multipart: Multipart) -> anyhow::Result<Vec<u8>> {
    while let Some(field) = multipart.next_field().await? {
        if field.name() == Some("backup") {
            return Ok(field.bytes().await?.to_vec());
        }
    }
    anyhow::bail!("backup_file_required");
}
