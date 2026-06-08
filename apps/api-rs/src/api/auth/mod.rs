pub mod api_keys;
pub mod guard;
pub(crate) mod models;
pub(crate) mod session;
pub(crate) mod store;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};

use crate::state::AppState;

pub fn generate_pending_setup_secret() -> String {
    session::generate_otp_secret()
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/state", get(auth_state))
        .route("/setup/start", post(setup_start))
        .route("/setup/complete", post(setup_complete))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/access-token", post(update_access_token))
        .route("/otp/reset", post(otp_reset))
        .route("/otp/reset/confirm", post(otp_reset_confirm))
        .route("/api-key-permissions", get(api_key_permissions))
        .route("/api-keys", get(list_api_keys).post(create_api_key))
        .route(
            "/api-keys/:id",
            patch(update_api_key).delete(revoke_api_key),
        )
        .route("/api-keys/:id/record", delete(delete_revoked_api_key))
}

async fn auth_state(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<models::AuthStateResponse> {
    let auth_config = store::load_auth_config(&state.db).ok().flatten();
    let Some(auth_config) = auth_config else {
        return Json(models::AuthStateResponse::anonymous(true));
    };
    let bearer = session::bearer_token(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok()),
    );
    if session::verify_session_token(&auth_config, bearer) {
        return Json(models::AuthStateResponse::authenticated());
    }
    Json(models::AuthStateResponse::anonymous(false))
}

async fn setup_start(State(state): State<AppState>) -> Json<models::SetupStartResponse> {
    if store::load_auth_config(&state.db).ok().flatten().is_some() {
        return Json(models::SetupStartResponse {
            setup_required: false,
            otp_secret: None,
            otpauth_url: None,
        });
    }
    let secret = state.auth.pending_setup_secret();
    Json(models::SetupStartResponse {
        setup_required: true,
        otpauth_url: Some(session::otpauth_url(&secret)),
        otp_secret: Some(secret),
    })
}

async fn setup_complete(
    State(state): State<AppState>,
    Json(body): Json<models::SetupCompleteRequest>,
) -> Result<Json<models::LoginResponse>, (StatusCode, Json<models::LoginResponse>)> {
    if store::load_auth_config(&state.db).ok().flatten().is_some() {
        return Err(login_error(
            StatusCode::CONFLICT,
            "already_configured",
            false,
        ));
    }
    let secret = state.auth.pending_setup_secret();
    if body.access_token.trim().is_empty() || !session::verify_totp(&secret, &body.otp) {
        return Err(login_error(
            StatusCode::UNAUTHORIZED,
            "invalid_setup_token_or_otp",
            true,
        ));
    }
    let config = models::AuthConfig {
        access_token_hash: session::hash_access_token(&body.access_token),
        otp_secret: secret,
    };
    store::save_auth_config(&state.db, &config)
        .map_err(|_| login_error(StatusCode::INTERNAL_SERVER_ERROR, "setup_failed", true))?;
    state.auth.rotate_pending_setup_secret();
    emit_auth_login(&state, "setup_complete", "本地管理员完成首次设置并登录。");
    Ok(Json(success_response(&config)))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<models::LoginRequest>,
) -> Result<Json<models::LoginResponse>, (StatusCode, Json<models::LoginResponse>)> {
    let Some(config) = store::load_auth_config(&state.db).ok().flatten() else {
        return Err(login_error(StatusCode::CONFLICT, "setup_required", true));
    };
    let access_hash = session::hash_access_token(&body.access_token);
    if access_hash != config.access_token_hash
        || !session::verify_totp(&config.otp_secret, &body.otp)
    {
        return Err(login_error(
            StatusCode::UNAUTHORIZED,
            "invalid_token_or_otp",
            false,
        ));
    }
    emit_auth_login(&state, "login", "本地管理员已登录。");
    Ok(Json(success_response(&config)))
}

async fn logout() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

async fn update_access_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<models::UpdateAccessTokenRequest>,
) -> Result<Json<models::LoginResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    let Some(config) = store::load_auth_config(&state.db).map_err(api_error)? else {
        return Err(json_error(StatusCode::CONFLICT, "setup_required"));
    };
    if body.current_access_token.trim().is_empty() || body.access_token.trim().is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "access_token_required"));
    }
    if session::hash_access_token(&body.current_access_token) != config.access_token_hash {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "invalid_current_access_token",
        ));
    }
    let next_config = models::AuthConfig {
        access_token_hash: session::hash_access_token(&body.access_token),
        otp_secret: config.otp_secret,
    };
    store::save_auth_config(&state.db, &next_config).map_err(api_error)?;
    Ok(Json(success_response(&next_config)))
}

async fn otp_reset(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<models::ResetOtpResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    if store::load_auth_config(&state.db)
        .map_err(api_error)?
        .is_none()
    {
        return Err(json_error(StatusCode::CONFLICT, "setup_required"));
    }
    let secret = session::generate_otp_secret();
    state
        .auth
        .set_pending_reset_otp_secret(Some(secret.clone()));
    Ok(Json(models::ResetOtpResponse {
        otpauth_url: session::otpauth_url(&secret),
        otp_secret: secret,
    }))
}

async fn otp_reset_confirm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<models::ConfirmOtpResetRequest>,
) -> Result<Json<models::LoginResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    let Some(config) = store::load_auth_config(&state.db).map_err(api_error)? else {
        return Err(json_error(StatusCode::CONFLICT, "setup_required"));
    };
    let Some(pending) = state.auth.pending_reset_otp_secret() else {
        return Err(json_error(StatusCode::BAD_REQUEST, "otp_reset_not_started"));
    };
    if body.current_access_token.trim().is_empty()
        || session::hash_access_token(&body.current_access_token) != config.access_token_hash
    {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "invalid_current_access_token",
        ));
    }
    if body.otp.is_empty() || !session::verify_totp(&pending, &body.otp) {
        return Err(json_error(StatusCode::UNAUTHORIZED, "invalid_otp"));
    }
    let next_config = models::AuthConfig {
        access_token_hash: config.access_token_hash,
        otp_secret: pending,
    };
    store::save_auth_config(&state.db, &next_config).map_err(api_error)?;
    state.auth.set_pending_reset_otp_secret(None);
    Ok(Json(success_response(&next_config)))
}

async fn api_key_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<api_keys::ApiKeyPermissionsResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    Ok(Json(api_keys::permissions_response()))
}

async fn list_api_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<api_keys::ApiKeySummary>>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    Ok(Json(api_keys::list_api_keys(&state.db).map_err(api_error)?))
}

async fn create_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<api_keys::ApiKeyInput>,
) -> Result<(StatusCode, Json<api_keys::ApiKeyDetailResponse>), (StatusCode, Json<serde_json::Value>)>
{
    require_session(&state, &headers)?;
    let key = api_keys::create_api_key(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(key)))
}

async fn update_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<api_keys::ApiKeyInput>,
) -> Result<Json<api_keys::ApiKeySummary>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    api_keys::update_api_key(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "api_key_not_found"))
}

async fn revoke_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<api_keys::ApiKeySummary>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    api_keys::revoke_api_key(&state.db, &id)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "api_key_not_found"))
}

async fn delete_revoked_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<api_keys::ApiKeySummary>, (StatusCode, Json<serde_json::Value>)> {
    require_session(&state, &headers)?;
    api_keys::delete_revoked_api_key(&state.db, &id)
        .map_err(|err| {
            if err.to_string() == "api_key_not_revoked" {
                json_error(StatusCode::CONFLICT, "api_key_not_revoked")
            } else {
                api_error(err)
            }
        })?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "api_key_not_found"))
}

fn success_response(config: &models::AuthConfig) -> models::LoginResponse {
    models::LoginResponse {
        ok: true,
        session_token: Some(session::sign_session_token(config)),
        auth: models::AuthStateResponse::authenticated(),
        error: None,
    }
}

fn require_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let Some(config) = store::load_auth_config(&state.db).map_err(api_error)? else {
        return Err(json_error(StatusCode::CONFLICT, "setup_required"));
    };
    let bearer = session::bearer_token(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok()),
    );
    if session::verify_session_token(&config, bearer) {
        Ok(())
    } else {
        Err(json_error(
            StatusCode::UNAUTHORIZED,
            "session_auth_required",
        ))
    }
}

fn api_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn emit_auth_login(state: &AppState, action: &str, message: &str) {
    crate::api::notifications::runtime::emit_external_notification(
        state.clone(),
        crate::api::notifications::runtime::NotificationEvent {
            event_type: "auth_login".to_string(),
            severity: "success".to_string(),
            title: "Codex Web 登录成功".to_string(),
            message: message.to_string(),
            source_type: Some("auth".to_string()),
            source_id: Some("local-admin".to_string()),
            metadata: serde_json::json!({ "action": action }),
        },
    );
}

fn json_error(
    status: StatusCode,
    error: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": error.into() })))
}

fn login_error(
    status: StatusCode,
    error: &'static str,
    setup_required: bool,
) -> (StatusCode, Json<models::LoginResponse>) {
    (
        status,
        Json(models::LoginResponse {
            ok: false,
            session_token: None,
            auth: models::AuthStateResponse::anonymous(setup_required),
            error: Some(error),
        }),
    )
}
