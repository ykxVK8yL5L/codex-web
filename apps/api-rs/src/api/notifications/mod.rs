pub(crate) mod models;
pub(crate) mod runtime;
pub(crate) mod store;

use axum::{
    extract::{Json as ExtractJson, Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(settings))
        .route("/platforms", get(platforms))
        .route("/channels", get(channels).post(create_channel))
        .route(
            "/channels/:id",
            axum::routing::patch(update_channel).delete(delete_channel),
        )
        .route("/accounts", get(accounts).post(create_account))
        .route(
            "/accounts/:id",
            axum::routing::patch(update_account).delete(delete_account),
        )
        .route("/accounts/:id/test", axum::routing::post(test_account))
        .route(
            "/accounts/:id/weixin/qr/start",
            axum::routing::post(weixin_qr_start),
        )
        .route("/accounts/:id/weixin/qr/status", get(weixin_qr_status))
        .route(
            "/weixin/qr/start",
            axum::routing::post(weixin_qr_start_draft),
        )
        .route("/weixin/qr/status", get(weixin_qr_status_draft))
        .route("/recipients", get(recipients).post(create_recipient))
        .route(
            "/recipients/:id",
            axum::routing::patch(update_recipient).delete(delete_recipient),
        )
        .route("/recipients/:id/test", axum::routing::post(test_recipient))
        .route("/rules", get(rules).post(create_rule).delete(clear_rules))
        .route(
            "/rules/:id",
            axum::routing::patch(update_rule).delete(delete_rule),
        )
        .route(
            "/ephemeral-rules",
            get(ephemeral_rules).post(create_ephemeral_rule),
        )
        .route(
            "/ephemeral-rules/:id",
            axum::routing::patch(update_ephemeral_rule).delete(delete_ephemeral_rule),
        )
        .route("/deliveries", get(deliveries).delete(clear_deliveries))
        .route("/deliveries/:id", axum::routing::delete(delete_delivery))
        .route("/deliveries/:id/retry", axum::routing::post(retry_delivery))
}

pub fn inbound_router() -> Router<AppState> {
    Router::new().route(
        "/api/notifications/feishu/events/:account_id",
        axum::routing::post(feishu_event_callback),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    limit: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteAccountQuery {
    delete_linked_recipients: Option<bool>,
}

async fn settings(
    State(state): State<AppState>,
) -> Result<Json<models::NotificationSettingsResponse>, ApiError> {
    store::settings(&state.db).map(Json).map_err(api_error)
}

async fn platforms(
    State(state): State<AppState>,
) -> Result<Json<models::PlatformSettingsResponse>, ApiError> {
    store::platform_overview(&state.db, &state.config.host)
        .map(Json)
        .map_err(api_error)
}

async fn feishu_event_callback(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    runtime::handle_feishu_event_callback(&state, &account_id, body)
        .await
        .map(Json)
        .map_err(api_error)
}

async fn channels(
    State(state): State<AppState>,
) -> Result<Json<Vec<models::NotificationChannelDefinition>>, ApiError> {
    store::channels(&state.db).map(Json).map_err(api_error)
}

async fn create_channel(
    State(state): State<AppState>,
    Json(body): Json<models::UpsertNotificationChannelRequest>,
) -> Result<(StatusCode, Json<models::NotificationChannelDefinition>), ApiError> {
    let channel = store::create_channel(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(channel)))
}

async fn update_channel(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpsertNotificationChannelRequest>,
) -> Result<Json<models::NotificationChannelDefinition>, ApiError> {
    store::update_channel(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_channel_not_found"))
}

async fn delete_channel(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    match store::delete_channel(&state.db, &id).map_err(api_error)? {
        Some("notification_channel_in_use") => Err(json_error(
            StatusCode::CONFLICT,
            "notification_channel_in_use",
        )),
        Some(error) => Err(json_error(StatusCode::NOT_FOUND, error)),
        None => Ok(Json(serde_json::json!({ "ok": true }))),
    }
}

async fn accounts(
    State(state): State<AppState>,
) -> Result<Json<Vec<models::NotificationAccountSummary>>, ApiError> {
    let accounts = store::accounts(&state.db).map_err(api_error)?;
    for account in store::accounts_private(&state.db).map_err(api_error)? {
        runtime::sync_telegram_account(state.clone(), account.clone());
        runtime::sync_weixin_account(state.clone(), account.clone());
        runtime::sync_qq_account(state.clone(), account.clone());
        runtime::sync_feishu_account(state.clone(), account.clone());
        runtime::sync_email_account(state.clone(), account.clone());
        runtime::sync_wecom_account(state.clone(), account);
    }
    Ok(Json(accounts))
}

async fn create_account(
    State(state): State<AppState>,
    Json(body): Json<models::UpsertNotificationAccountRequest>,
) -> Result<(StatusCode, Json<models::NotificationAccountSummary>), ApiError> {
    let account = store::create_account(&state.db, body).map_err(api_error)?;
    if let Some(private) = store::account_private(&state.db, &account.id).map_err(api_error)? {
        runtime::sync_telegram_account(state.clone(), private.clone());
        runtime::sync_weixin_account(state.clone(), private.clone());
        runtime::sync_qq_account(state.clone(), private.clone());
        runtime::sync_feishu_account(state.clone(), private.clone());
        runtime::sync_email_account(state.clone(), private.clone());
        runtime::sync_wecom_account(state.clone(), private);
    }
    Ok((StatusCode::CREATED, Json(account)))
}

async fn update_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpsertNotificationAccountRequest>,
) -> Result<Json<models::NotificationAccountSummary>, ApiError> {
    let account = store::update_account(&state.db, &id, body)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_account_not_found"))?;
    if let Some(private) = store::account_private(&state.db, &account.id).map_err(api_error)? {
        runtime::sync_telegram_account(state.clone(), private.clone());
        runtime::sync_weixin_account(state.clone(), private.clone());
        runtime::sync_qq_account(state.clone(), private.clone());
        runtime::sync_feishu_account(state.clone(), private.clone());
        runtime::sync_email_account(state.clone(), private.clone());
        runtime::sync_wecom_account(state.clone(), private);
    }
    Ok(Json(account))
}

async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DeleteAccountQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    match store::delete_account(
        &state.db,
        &id,
        query.delete_linked_recipients.unwrap_or(false),
    )
    .map_err(api_error)?
    {
        Some(linked_recipient_ids) => {
            runtime::stop_telegram_account(&state, &id);
            runtime::stop_weixin_account(&state, &id);
            runtime::stop_qq_account(&state, &id);
            runtime::stop_feishu_account(&state, &id);
            runtime::stop_email_account(&state, &id);
            runtime::stop_wecom_account(&state, &id);
            Ok(Json(
                serde_json::json!({ "ok": true, "linkedRecipientIds": linked_recipient_ids }),
            ))
        }
        None => Err(json_error(
            StatusCode::NOT_FOUND,
            "notification_account_not_found",
        )),
    }
}

async fn test_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<ExtractJson<models::TestNotificationRequest>>,
) -> Result<(StatusCode, Json<models::TestNotificationAccountResponse>), ApiError> {
    let body = body.map(|ExtractJson(value)| value).unwrap_or_default();
    let result = runtime::test_account(state.clone(), &id, body).await;
    let ok = result
        .as_ref()
        .is_ok_and(|delivery| delivery.status == "sent");
    let error = result.as_ref().err().map(|error| error.to_string());
    let account = store::account(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_account_not_found"))?;
    Ok((
        if ok {
            StatusCode::OK
        } else {
            StatusCode::BAD_REQUEST
        },
        Json(models::TestNotificationAccountResponse {
            ok,
            account,
            error,
            status: None,
        }),
    ))
}

async fn recipients(
    State(state): State<AppState>,
) -> Result<Json<Vec<models::NotificationRecipientSummary>>, ApiError> {
    store::recipients(&state.db).map(Json).map_err(api_error)
}

async fn create_recipient(
    State(state): State<AppState>,
    Json(body): Json<models::UpsertNotificationRecipientRequest>,
) -> Result<(StatusCode, Json<models::NotificationRecipientSummary>), ApiError> {
    let recipient = store::create_recipient(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(recipient)))
}

async fn update_recipient(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpsertNotificationRecipientRequest>,
) -> Result<Json<models::NotificationRecipientSummary>, ApiError> {
    store::update_recipient(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_recipient_not_found"))
}

async fn delete_recipient(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if store::delete_recipient(&state.db, &id).map_err(api_error)? {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(json_error(
            StatusCode::NOT_FOUND,
            "notification_recipient_not_found",
        ))
    }
}

async fn test_recipient(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<ExtractJson<models::TestNotificationRequest>>,
) -> Result<(StatusCode, Json<models::TestNotificationRecipientResponse>), ApiError> {
    let body = body.map(|ExtractJson(value)| value).unwrap_or_default();
    let result = runtime::test_recipient(state.clone(), &id, body).await;
    let ok = result
        .as_ref()
        .is_ok_and(|delivery| delivery.status == "sent");
    let error = result.as_ref().err().map(|error| error.to_string());
    let recipient = store::recipient(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_recipient_not_found"))?;
    Ok((
        if ok {
            StatusCode::OK
        } else {
            StatusCode::BAD_REQUEST
        },
        Json(models::TestNotificationRecipientResponse {
            ok,
            recipient,
            error,
        }),
    ))
}

async fn rules(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<crate::api::common::PageResponse<models::NotificationRuleSummary>>, ApiError> {
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
    store::rules(&state.db, limit).map(Json).map_err(api_error)
}

async fn create_rule(
    State(state): State<AppState>,
    Json(body): Json<models::UpsertNotificationRuleRequest>,
) -> Result<(StatusCode, Json<models::NotificationRuleSummary>), ApiError> {
    let rule = store::create_rule(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(rule)))
}

async fn update_rule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpsertNotificationRuleRequest>,
) -> Result<Json<models::NotificationRuleSummary>, ApiError> {
    store::update_rule(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_rule_not_found"))
}

async fn delete_rule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if store::delete_rule(&state.db, &id).map_err(api_error)? {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(json_error(
            StatusCode::NOT_FOUND,
            "notification_rule_not_found",
        ))
    }
}

async fn clear_rules(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let cleared = store::clear_rules(&state.db).map_err(api_error)?;
    Ok(Json(serde_json::json!({ "ok": true, "cleared": cleared })))
}

async fn ephemeral_rules(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<
    Json<crate::api::common::PageResponse<models::NotificationEphemeralRuleSummary>>,
    ApiError,
> {
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
    store::ephemeral_rules(&state.db, limit)
        .map(Json)
        .map_err(api_error)
}

async fn create_ephemeral_rule(
    State(state): State<AppState>,
    Json(body): Json<models::UpsertNotificationEphemeralRuleRequest>,
) -> Result<(StatusCode, Json<models::NotificationEphemeralRuleSummary>), ApiError> {
    let rule = store::create_ephemeral_rule(&state.db, body).map_err(api_error)?;
    Ok((StatusCode::CREATED, Json(rule)))
}

async fn update_ephemeral_rule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<models::UpsertNotificationEphemeralRuleRequest>,
) -> Result<Json<models::NotificationEphemeralRuleSummary>, ApiError> {
    store::update_ephemeral_rule(&state.db, &id, body)
        .map_err(api_error)?
        .map(Json)
        .ok_or_else(|| {
            json_error(
                StatusCode::NOT_FOUND,
                "notification_ephemeral_rule_not_found",
            )
        })
}

async fn delete_ephemeral_rule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if store::delete_ephemeral_rule(&state.db, &id).map_err(api_error)? {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(json_error(
            StatusCode::NOT_FOUND,
            "notification_ephemeral_rule_not_found",
        ))
    }
}

async fn deliveries(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<crate::api::common::PageResponse<models::NotificationDeliverySummary>>, ApiError> {
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 20, 100);
    store::deliveries(&state.db, limit)
        .map(Json)
        .map_err(api_error)
}

async fn clear_deliveries(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cleared = store::clear_deliveries(&state.db).map_err(api_error)?;
    Ok(Json(serde_json::json!({ "ok": true, "cleared": cleared })))
}

async fn delete_delivery(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if store::delete_delivery(&state.db, &id).map_err(api_error)? {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(json_error(
            StatusCode::NOT_FOUND,
            "notification_delivery_not_found",
        ))
    }
}

async fn retry_delivery(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ok = runtime::retry_delivery(state, &id)
        .await
        .map_err(retry_error)?;
    Ok(Json(serde_json::json!({ "ok": ok })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeixinQrStartRequest {
    bot_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeixinQrStatusQuery {
    qr_key: Option<String>,
}

async fn fetch_weixin_qr_code(base_url: &str, bot_type: &str) -> anyhow::Result<(String, String)> {
    let url = format!(
        "{}/ilink/bot/get_bot_qrcode?bot_type={}",
        base_url.trim_end_matches('/'),
        url_escape(bot_type)
    );
    let response = reqwest::get(url).await?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        anyhow::bail!(body
            .get("errmsg")
            .and_then(|v| v.as_str())
            .unwrap_or("weixin_qr_http_error")
            .to_string());
    }
    let qrcode = body
        .get("qrcode")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow::anyhow!("weixin_qrcode_missing"))?
        .to_string();
    let qrcode_url = body
        .get("qrcode_img_content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok((qrcode, qrcode_url))
}

async fn fetch_weixin_qr_status(base_url: &str, qrcode: &str) -> anyhow::Result<serde_json::Value> {
    let url = format!(
        "{}/ilink/bot/get_qrcode_status?qrcode={}",
        base_url.trim_end_matches('/'),
        url_escape(qrcode)
    );
    let response = reqwest::get(url).await?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        anyhow::bail!(body
            .get("errmsg")
            .and_then(|v| v.as_str())
            .unwrap_or("weixin_qr_http_error")
            .to_string());
    }
    Ok(body)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0_u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn weixin_base_url(config: &serde_json::Value) -> String {
    normalize_weixin_base_url(config.get("baseUrl").and_then(|v| v.as_str()).unwrap_or(""))
}

fn normalize_weixin_base_url(value: &str) -> String {
    let value = value.trim().trim_end_matches('/');
    if value.is_empty() {
        "https://ilinkai.weixin.qq.com".to_string()
    } else {
        value.to_string()
    }
}

fn json_string(value: &serde_json::Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| {
            value
                .get(*key)
                .and_then(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default()
}

fn url_escape(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('?', "%3F")
        .replace('#', "%23")
        .replace('+', "%2B")
}

async fn start_weixin_qr_session(
    state: &AppState,
    account_id: Option<String>,
    bot_type: Option<&str>,
    config: serde_json::Value,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bot_type = bot_type.unwrap_or("3").trim();
    let bot_type = if bot_type.is_empty() { "3" } else { bot_type };
    let base_url = weixin_base_url(&config);
    let (qrcode, qrcode_url) = fetch_weixin_qr_code(&base_url, bot_type)
        .await
        .map_err(api_error)?;
    let qr_key = account_id
        .clone()
        .unwrap_or_else(|| format!("weixin-qr-{}", random_hex(16)));
    state.weixin_qr.insert(crate::state::WeixinQrSession {
        qr_key: qr_key.clone(),
        account_id: account_id.clone(),
        bot_type: bot_type.to_string(),
        base_url: base_url.clone(),
        current_base_url: base_url.clone(),
        qrcode: qrcode.clone(),
        qrcode_url: qrcode_url.clone(),
        refresh_count: 0,
        created_at_ms: now_ms(),
    });
    Ok(Json(serde_json::json!({
        "qrKey": qr_key,
        "accountId": account_id,
        "botType": bot_type,
        "status": "wait",
        "qrcode": qrcode,
        "qrcodeUrl": qrcode_url,
        "baseUrl": base_url,
        "currentBaseUrl": base_url,
    })))
}

async fn weixin_qr_start(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<WeixinQrStartRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let account = store::weixin_account(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_account_not_found"))?;
    start_weixin_qr_session(
        &state,
        Some(account.id),
        body.bot_type.as_deref(),
        account.config,
    )
    .await
}

async fn weixin_qr_start_draft(
    State(state): State<AppState>,
    Json(body): Json<WeixinQrStartRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    start_weixin_qr_session(
        &state,
        None,
        body.bot_type.as_deref(),
        serde_json::json!({}),
    )
    .await
}

async fn finish_weixin_qr_session(
    state: &AppState,
    qr_key: &str,
    session: crate::state::WeixinQrSession,
    status_body: serde_json::Value,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = json_string(&status_body, &["bot_token", "botToken", "token"]);
    let account_id_value = json_string(&status_body, &["ilink_bot_id", "account_id", "accountId"]);
    let user_id = json_string(&status_body, &["ilink_user_id", "user_id", "userId"]);
    let base_url = normalize_weixin_base_url(&json_string(
        &status_body,
        &["baseurl", "baseUrl", "base_url"],
    ));
    if token.is_empty() || account_id_value.is_empty() {
        return Ok(Json(serde_json::json!({
            "qrKey": qr_key,
            "accountId": session.account_id,
            "botType": session.bot_type,
            "status": "error",
            "error": "weixin_qr_credential_incomplete",
            "body": status_body,
        })));
    }
    state.weixin_qr.remove(qr_key);
    let token_saved = if let Some(account_id) = session.account_id.as_deref() {
        let account = store::account_private(&state.db, account_id)
            .map_err(api_error)?
            .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_account_not_found"))?;
        let mut config = account.config.as_object().cloned().unwrap_or_default();
        config.insert(
            "botToken".to_string(),
            serde_json::Value::String(token.clone()),
        );
        config.insert(
            "baseUrl".to_string(),
            serde_json::Value::String(base_url.clone()),
        );
        config.insert(
            "accountId".to_string(),
            serde_json::Value::String(account_id_value.clone()),
        );
        if !user_id.is_empty() {
            config.insert(
                "userId".to_string(),
                serde_json::Value::String(user_id.clone()),
            );
        }
        store::update_account_config(&state.db, account_id, serde_json::Value::Object(config))
            .map_err(api_error)?;
        true
    } else {
        false
    };
    Ok(Json(serde_json::json!({
        "qrKey": qr_key,
        "accountId": session.account_id,
        "botType": session.bot_type,
        "status": "confirmed",
        "tokenSaved": token_saved,
        "token": token,
        "baseUrl": base_url,
        "currentBaseUrl": base_url,
        "accountIdValue": account_id_value,
        "userId": user_id,
    })))
}

async fn refresh_weixin_qr_session(
    state: &AppState,
    qr_key: &str,
    mut session: crate::state::WeixinQrSession,
) -> Result<Json<serde_json::Value>, ApiError> {
    let status_body = match fetch_weixin_qr_status(&session.current_base_url, &session.qrcode).await
    {
        Ok(value) => value,
        Err(error) => {
            state.weixin_qr.remove(qr_key);
            return Ok(Json(serde_json::json!({
                "qrKey": qr_key,
                "accountId": session.account_id,
                "botType": session.bot_type,
                "status": "error",
                "error": error.to_string(),
            })));
        }
    };
    let status = status_body
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("wait");
    match status {
        "confirmed" => finish_weixin_qr_session(state, qr_key, session, status_body).await,
        "scaned_but_redirect" => {
            if let Some(host) = status_body
                .get("redirect_host")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                session.current_base_url = format!("https://{host}");
                state.weixin_qr.insert(session.clone());
            }
            Ok(Json(serde_json::json!({
                "qrKey": qr_key,
                "accountId": session.account_id,
                "botType": session.bot_type,
                "status": "scaned_but_redirect",
                "qrcode": session.qrcode,
                "qrcodeUrl": session.qrcode_url,
                "baseUrl": session.base_url,
                "currentBaseUrl": session.current_base_url,
                "redirectHost": status_body.get("redirect_host").and_then(|value| value.as_str()).unwrap_or(""),
            })))
        }
        "expired" => {
            session.refresh_count += 1;
            if session.refresh_count > 3 {
                state.weixin_qr.remove(qr_key);
                return Ok(Json(serde_json::json!({
                    "qrKey": qr_key,
                    "accountId": session.account_id,
                    "botType": session.bot_type,
                    "status": "error",
                    "error": "weixin_qr_expired",
                })));
            }
            let (qrcode, qrcode_url) = fetch_weixin_qr_code(&session.base_url, &session.bot_type)
                .await
                .map_err(api_error)?;
            session.qrcode = qrcode;
            session.qrcode_url = qrcode_url;
            session.current_base_url = session.base_url.clone();
            state.weixin_qr.insert(session.clone());
            Ok(Json(serde_json::json!({
                "qrKey": qr_key,
                "accountId": session.account_id,
                "botType": session.bot_type,
                "status": "wait",
                "qrcode": session.qrcode,
                "qrcodeUrl": session.qrcode_url,
                "baseUrl": session.base_url,
                "currentBaseUrl": session.current_base_url,
                "refreshCount": session.refresh_count,
            })))
        }
        "scaned" => Ok(Json(serde_json::json!({
            "qrKey": qr_key,
            "accountId": session.account_id,
            "botType": session.bot_type,
            "status": "scaned",
            "qrcode": session.qrcode,
            "qrcodeUrl": session.qrcode_url,
            "baseUrl": session.base_url,
            "currentBaseUrl": session.current_base_url,
        }))),
        _ => Ok(Json(serde_json::json!({
            "qrKey": qr_key,
            "accountId": session.account_id,
            "botType": session.bot_type,
            "status": "wait",
            "qrcode": session.qrcode,
            "qrcodeUrl": session.qrcode_url,
            "baseUrl": session.base_url,
            "currentBaseUrl": session.current_base_url,
        }))),
    }
}

async fn weixin_qr_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<WeixinQrStatusQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    store::weixin_account(&state.db, &id)
        .map_err(api_error)?
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "notification_account_not_found"))?;
    let qr_key = query.qr_key.unwrap_or_else(|| id.clone());
    let session = state
        .weixin_qr
        .get(&qr_key)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "weixin_qr_session_not_found"))?;
    if session.account_id.as_deref() != Some(&id) {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            "weixin_qr_session_not_found",
        ));
    }
    refresh_weixin_qr_session(&state, &qr_key, session).await
}

async fn weixin_qr_status_draft(
    State(state): State<AppState>,
    Query(query): Query<WeixinQrStatusQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let qr_key = query.qr_key.unwrap_or_default();
    if qr_key.trim().is_empty() {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            "weixin_qr_session_not_found",
        ));
    }
    let session = state
        .weixin_qr
        .get(&qr_key)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "weixin_qr_session_not_found"))?;
    if session.account_id.is_some() {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            "weixin_qr_session_not_found",
        ));
    }
    refresh_weixin_qr_session(&state, &qr_key, session).await
}

type ApiError = (StatusCode, Json<serde_json::Value>);

fn api_error(error: anyhow::Error) -> ApiError {
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn retry_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    let status = match message.as_str() {
        "notification_delivery_not_found"
        | "notification_recipient_not_found"
        | "notification_account_not_found" => StatusCode::NOT_FOUND,
        _ => StatusCode::BAD_REQUEST,
    };
    json_error(status, message)
}

fn json_error(status: StatusCode, error: impl Into<String>) -> ApiError {
    (status, Json(serde_json::json!({ "error": error.into() })))
}
