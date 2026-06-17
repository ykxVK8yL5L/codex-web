mod health;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Method, Request, Response, StatusCode},
    middleware::Next,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{api, state::AppState, web};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route(
            "/preview/:id/:token/access-requests",
            post(create_access_request),
        )
        .route(
            "/preview/:id/:token/access-requests/:requestId",
            get(get_access_request),
        )
        .route(
            "/preview/:id/:token/",
            get(preview_proxy_root)
                .post(preview_proxy_root)
                .put(preview_proxy_root)
                .patch(preview_proxy_root)
                .delete(preview_proxy_root),
        )
        .route(
            "/preview/:id/:token/*path",
            get(preview_proxy)
                .post(preview_proxy)
                .put(preview_proxy)
                .patch(preview_proxy)
                .delete(preview_proxy),
        )
        .merge(api::webhooks::inbound_router())
        .merge(api::notifications::inbound_router())
        .merge(api::router(state.clone()))
        .fallback(preview_referer_or_static_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            preview_referer_proxy_middleware,
        ))
        .with_state(state)
}

type JsonError = (StatusCode, Json<serde_json::Value>);

/// `POST /preview/:id/:token/access-requests` — create a private-preview access request.
/// Mirrors apps/api/src/server/routes.ts. Lives outside the `/api` auth guard.
async fn create_access_request(
    State(state): State<AppState>,
    Path((id, token)): Path<(String, String)>,
) -> Result<axum::response::Response, JsonError> {
    let Some(preview) = api::previews::store::get(&state.db, &id).map_err(bad_request)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    if preview.token != token {
        return Err(json_error(StatusCode::NOT_FOUND, "preview_not_found"));
    }
    if preview.access != "private" {
        return Err(json_error(StatusCode::BAD_REQUEST, "preview_is_public"));
    }
    let source_path = format!("/preview/{}/{}/", id, token);
    let (request_id, secret, reused) =
        api::previews::store::create_access_request_with_notification(
            &state,
            &preview.id,
            &source_path,
        )
        .map_err(bad_request)?;
    let body = serde_json::json!({ "status": "pending", "id": request_id, "secret": secret, "reused": reused });
    Ok((StatusCode::ACCEPTED, Json(body)).into_response())
}

#[derive(Deserialize)]
struct AccessRequestQuery {
    secret: Option<String>,
}

/// `GET /preview/:id/:token/access-requests/:requestId` — poll an access request status.
/// Mirrors apps/api/src/server/routes.ts. Sets a preview-access cookie when approved.
async fn get_access_request(
    State(state): State<AppState>,
    Path((id, token, request_id)): Path<(String, String, String)>,
    Query(query): Query<AccessRequestQuery>,
) -> Result<axum::response::Response, JsonError> {
    api::previews::store::expire_access_requests(&state.db).map_err(bad_request)?;
    let Some(preview) = api::previews::store::get(&state.db, &id).map_err(bad_request)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    if preview.token != token {
        return Err(json_error(StatusCode::NOT_FOUND, "preview_not_found"));
    }
    let Some(request) = api::previews::store::get_access_request(
        &state.db,
        &preview.id,
        &request_id,
        query.secret.as_deref(),
    )
    .map_err(bad_request)?
    else {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            "access_request_not_found",
        ));
    };
    let url = api::previews::models::preview_url(&preview.id, &preview.token);
    let body = serde_json::json!({
        "status": request.status,
        "approvedUntil": request.approved_until,
        "url": url,
    });
    let mut response = Json(body).into_response();
    if request.status == "approved" {
        let ttl = request
            .approved_until
            .as_deref()
            .and_then(seconds_until)
            .unwrap_or(15 * 60)
            .clamp(1, 30 * 24 * 60 * 60);
        let cookie_name = preview_access_cookie_name(&preview.id);
        let token = sign_preview_access_token(&state, &preview.id, &preview.token, ttl)
            .map_err(bad_request)?;
        let cookie =
            format!("{cookie_name}={token}; Path=/; Max-Age={ttl}; HttpOnly; SameSite=Lax");
        if let Ok(value) = axum::http::HeaderValue::from_str(&cookie) {
            response
                .headers_mut()
                .insert(axum::http::header::SET_COOKIE, value);
        }
    }
    Ok(response)
}

pub(crate) fn preview_access_cookie_header(
    state: &AppState,
    preview_id: &str,
    token: &str,
    ttl_seconds: i64,
) -> Option<String> {
    let cookie_name = preview_access_cookie_name(preview_id);
    let token = sign_preview_access_token(state, preview_id, token, ttl_seconds).ok()?;
    Some(format!(
        "{cookie_name}={token}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax",
        ttl_seconds.max(1)
    ))
}
/// Mirrors previewAccessCookieName(): `codex_preview_<id with non-alphanumerics replaced by _>`.
fn preview_access_cookie_name(preview_id: &str) -> String {
    let sanitized: String = preview_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("codex_preview_{sanitized}")
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewAccessTokenPayload {
    preview_id: String,
    token: String,
    exp: u64,
}

fn sign_preview_access_token(
    state: &AppState,
    preview_id: &str,
    token: &str,
    ttl_seconds: i64,
) -> anyhow::Result<String> {
    let config = api::auth::store::load_auth_config(&state.db)?
        .ok_or_else(|| anyhow::anyhow!("auth_not_configured"))?;
    let exp = now_ms().saturating_add((ttl_seconds.max(1) as u64) * 1000);
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&PreviewAccessTokenPayload {
        preview_id: preview_id.to_string(),
        token: token.to_string(),
        exp,
    })?);
    let signature = sign_sha256(&session_secret(&config), &payload);
    Ok(format!("{payload}.{signature}"))
}

pub(crate) fn preview_request_has_access(
    state: &AppState,
    preview_id: &str,
    token: &str,
    headers: &HeaderMap,
) -> bool {
    if let Some(config) = api::auth::store::load_auth_config(&state.db).ok().flatten() {
        let cookies = parse_cookie_header(
            headers
                .get(header::COOKIE)
                .and_then(|value| value.to_str().ok()),
        );
        let cookie_name = preview_access_cookie_name(preview_id);
        if verify_preview_access_token(
            &config,
            preview_id,
            token,
            cookies.get(&cookie_name).map(String::as_str),
        ) {
            return true;
        }
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| api::auth::session::bearer_token(Some(value)));
        if api::auth::session::verify_session_token(&config, bearer) {
            return true;
        }
        if api::auth::session::verify_session_token(
            &config,
            cookies.get("codex_session").map(|value| value.as_str()),
        ) {
            return true;
        }
    }
    false
}

fn verify_preview_access_token(
    config: &api::auth::models::AuthConfig,
    preview_id: &str,
    preview_token: &str,
    value: Option<&str>,
) -> bool {
    let Some(value) = value else {
        return false;
    };
    let mut parts = value.split('.');
    let (Some(payload), Some(signature), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let expected = sign_sha256(&session_secret(config), payload);
    if !constant_time_eq(signature.as_bytes(), expected.as_bytes()) {
        return false;
    }
    let parsed = URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<PreviewAccessTokenPayload>(&bytes).ok());
    parsed.is_some_and(|payload| {
        payload.preview_id == preview_id && payload.token == preview_token && payload.exp > now_ms()
    })
}

fn parse_cookie_header(value: Option<&str>) -> std::collections::HashMap<String, String> {
    let mut cookies = std::collections::HashMap::new();
    for part in value.unwrap_or("").split(';') {
        let Some((name, value)) = part.split_once('=') else {
            continue;
        };
        cookies.insert(name.trim().to_string(), value.trim().to_string());
    }
    cookies
}

fn session_secret(config: &api::auth::models::AuthConfig) -> Vec<u8> {
    Sha256::digest(format!(
        "{}:{}",
        config.access_token_hash, config.otp_secret
    ))
    .to_vec()
}

fn sign_sha256(secret: &[u8], value: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(value.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn constant_time_eq(actual: &[u8], expected: &[u8]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected.iter())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn seconds_until(value: &str) -> Option<i64> {
    let exp = parse_rfc3339_epoch_seconds(value)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    Some(exp - now)
}

fn parse_rfc3339_epoch_seconds(value: &str) -> Option<i64> {
    // Good enough for timestamps produced by time::Rfc3339 in this service: YYYY-MM-DDTHH:MM:SSZ
    let value = value.strip_suffix('Z').unwrap_or(value);
    let (date, time) = value.split_once('T')?;
    let mut date_parts = date.split('-').filter_map(|part| part.parse::<i32>().ok());
    let (year, month, day) = (
        date_parts.next()?,
        date_parts.next()? as u32,
        date_parts.next()? as u32,
    );
    let time = time.split('.').next().unwrap_or(time);
    let mut time_parts = time.split(':').filter_map(|part| part.parse::<u32>().ok());
    let (hour, minute, second) = (time_parts.next()?, time_parts.next()?, time_parts.next()?);
    Some(
        days_from_civil(year, month, day) * 86_400
            + hour as i64 * 3600
            + minute as i64 * 60
            + second as i64,
    )
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = month as i32 + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) as i64
}

fn bad_request(err: anyhow::Error) -> JsonError {
    json_error(StatusCode::BAD_REQUEST, err.to_string())
}

fn json_error(status: StatusCode, message: impl Into<String>) -> JsonError {
    (status, Json(serde_json::json!({ "error": message.into() })))
}

async fn preview_referer_proxy_middleware(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let path = request.uri().path().to_string();
    if path == "/health" || path.starts_with("/preview/") {
        return next.run(request).await;
    }
    let referer = request
        .headers()
        .get(header::REFERER)
        .and_then(|value| value.to_str().ok());
    let Some(preview) = preview_from_referer(&state, referer) else {
        return next.run(request).await;
    };
    if !api::previews::store::proxy_path_matches(&preview, &path) {
        return next.run(request).await;
    }
    if preview.access == "private"
        && !preview_request_has_access(&state, &preview.id, &preview.token, request.headers())
    {
        if request.method() == Method::GET || request.method() == Method::HEAD {
            return private_preview_access_response(&preview, &request);
        }
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("private preview requires Codex Web access"))
            .unwrap_or_else(|_| Response::new(Body::empty()));
    }
    proxy_preview_response(state, preview, path.trim_start_matches('/').to_string(), request).await
}

/// Catch-all parity with apps/api/src/server/routes.ts `app.all("*")`:
/// if an arbitrary same-origin request carries a Referer under `/preview/:id/:token/`,
/// route it back to that preview.  GET/HEAD are redirected to the canonical preview URL
/// (preserving query); mutating methods are proxied directly to the preview upstream.
async fn preview_referer_or_static_handler(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response<Body> {
    let path = request.uri().path().to_string();
    if path == "/health" || path.starts_with("/preview/") {
        return web::static_handler(State(state), request).await;
    }
    let referer = request
        .headers()
        .get(header::REFERER)
        .and_then(|value| value.to_str().ok());
    let Some(preview) = preview_from_referer(&state, referer) else {
        return web::static_handler(State(state), request).await;
    };
    if !api::previews::store::proxy_path_matches(&preview, &path) {
        return web::static_handler(State(state), request).await;
    }

    if preview.access == "private"
        && !preview_request_has_access(&state, &preview.id, &preview.token, request.headers())
    {
        if request.method() == Method::GET || request.method() == Method::HEAD {
            return private_preview_access_response(&preview, &request);
        }
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("private preview requires Codex Web access"))
            .unwrap_or_else(|_| Response::new(Body::empty()));
    }

    proxy_preview_response(state, preview, path.trim_start_matches('/').to_string(), request).await
}

async fn proxy_preview_response(
    state: AppState,
    preview: api::previews::models::PreviewRecord,
    upstream_path: String,
    request: Request<Body>,
) -> Response<Body> {
    match api::previews::runtime::proxy(state, preview.id, preview.token, upstream_path, request)
        .await
    {
        Ok(response) => response,
        Err((status, Json(value))) => {
            let body = serde_json::to_vec(&value).unwrap_or_default();
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap_or_else(|_| Response::new(Body::empty()))
        }
    }
}

fn preview_from_referer(
    state: &AppState,
    value: Option<&str>,
) -> Option<api::previews::models::PreviewRecord> {
    let value = value?;
    let path = if let Some(rest) = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
    {
        let slash = rest.find('/').unwrap_or(rest.len());
        &rest[slash..]
    } else {
        value
    };
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    if parts.next()? != "preview" {
        return None;
    }
    let id = percent_decode(parts.next().unwrap_or_default());
    let token = percent_decode(parts.next().unwrap_or_default());
    let preview = api::previews::store::get(&state.db, &id).ok().flatten()?;
    (preview.token == token).then_some(preview)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn private_preview_access_response(
    preview: &api::previews::models::PreviewRecord,
    request: &Request<Body>,
) -> Response<Body> {
    let origin = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(|host| format!("http://{host}"))
        .unwrap_or_default();
    let current = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/");
    let preview_base = serde_json::to_string(
        api::previews::models::preview_url(&preview.id, &preview.token).trim_end_matches('/'),
    )
    .unwrap_or_else(|_| "\"/preview\"".to_string());
    let current_json = serde_json::to_string(current).unwrap_or_else(|_| "\"/\"".to_string());
    let html = format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Private Preview</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f4;color:#172018}}main{{width:min(460px,calc(100vw - 32px));border:1px solid #d9ded6;border-radius:10px;background:white;padding:20px;box-shadow:0 24px 80px rgba(14,20,16,.16)}}h1{{margin:0 0 8px;font-size:18px}}p{{margin:0 0 14px;color:#586256}}.actions{{display:flex;flex-wrap:wrap;gap:10px}}a,button{{display:inline-flex;align-items:center;min-height:34px;border-radius:8px;border:1px solid #cdd5ca;background:#172018;color:white;padding:0 12px;text-decoration:none;cursor:pointer}}a.secondary{{background:white;color:#172018}}.muted{{margin-top:12px;font-size:12px;color:#7a8378}}</style></head>
<body><main><h1>私有预览需要授权</h1><p id="message">这是一个私有预览。你可以发起访问授权请求，等待 Codex Web 管理员批准。</p><div class="actions"><button id="request" type="button">请求授权</button><a class="secondary" href="{origin}/#approvals">打开审批页面</a><a class="secondary" href="{origin}/#previews">打开预览列表</a></div><p class="muted">Private preview requires an authenticated Codex Web session.</p></main>
<script>(()=>{{const message=document.getElementById("message"),button=document.getElementById("request");let timer=null;async function poll(id,secret){{const response=await fetch({base}+"/access-requests/"+encodeURIComponent(id)+"?secret="+encodeURIComponent(secret),{{cache:"no-store"}});const result=await response.json().catch(()=>null);if(response.ok&&result?.status==="approved"){{message.textContent="授权已批准，正在打开预览...";window.location.replace({current_json});return}}if(result?.status==="denied"){{message.textContent="授权请求已被拒绝。";if(timer)window.clearInterval(timer)}}}}button.addEventListener("click",async()=>{{button.disabled=true;message.textContent="正在创建授权请求...";const response=await fetch({base}+"/access-requests",{{method:"POST"}});const result=await response.json().catch(()=>null);if(!response.ok||!result?.id||!result?.secret){{message.textContent="授权请求创建失败，请回到 Codex Web 后重试。";button.disabled=false;return}}message.textContent="授权请求已发送，请等待审批通过。";timer=window.setInterval(()=>void poll(result.id,result.secret),2000);void poll(result.id,result.secret)}});}})();</script></body></html>"#,
        origin = html_escape(&origin),
        base = preview_base,
        current_json = current_json
    );
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(html))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn preview_proxy(
    State(state): State<AppState>,
    Path((id, token, path)): Path<(String, String, String)>,
    request: axum::http::Request<axum::body::Body>,
) -> Result<
    axum::http::Response<axum::body::Body>,
    (axum::http::StatusCode, axum::Json<serde_json::Value>),
> {
    preview_proxy_with_access_page(state, id, token, path, request).await
}

async fn preview_proxy_root(
    State(state): State<AppState>,
    Path((id, token)): Path<(String, String)>,
    request: axum::http::Request<axum::body::Body>,
) -> Result<
    axum::http::Response<axum::body::Body>,
    (axum::http::StatusCode, axum::Json<serde_json::Value>),
> {
    preview_proxy_with_access_page(state, id, token, String::new(), request).await
}

async fn preview_proxy_with_access_page(
    state: AppState,
    id: String,
    token: String,
    path: String,
    request: axum::http::Request<axum::body::Body>,
) -> Result<
    axum::http::Response<axum::body::Body>,
    (axum::http::StatusCode, axum::Json<serde_json::Value>),
> {
    if let Some(preview) = api::previews::store::get(&state.db, &id).map_err(bad_request)? {
        if preview.token != token {
            return Err(json_error(StatusCode::NOT_FOUND, "preview_not_found"));
        }
        if preview.access == "private"
            && !preview_request_has_access(&state, &preview.id, &preview.token, request.headers())
        {
            if request.method() == Method::GET || request.method() == Method::HEAD {
                return Ok(private_preview_access_response(&preview, &request));
            }
            return Err(json_error(
                StatusCode::UNAUTHORIZED,
                "preview_access_required",
            ));
        }
    }
    api::previews::runtime::proxy(state, id, token, path, request).await
}
