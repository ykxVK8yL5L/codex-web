use std::{
    collections::HashMap,
    process::Stdio,
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header, Method, Request, Response, StatusCode},
    response::IntoResponse,
    routing::{get as axum_get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::{Child, Command},
    sync::broadcast,
};

use crate::state::AppState;
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

use super::{models::PreviewRecord, store};

const OWNER_GRANT_TTL_MS: u128 = 90 * 1000;
const SHARE_COOKIE_TTL_SECONDS: i64 = 12 * 60 * 60;

#[derive(Clone)]
pub struct PreviewShareHandle {
    pub preview_id: String,
    summary: Arc<Mutex<PreviewShareSummary>>,
    grants: Arc<Mutex<HashMap<String, OwnerGrant>>>,
    stop: broadcast::Sender<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewShareSummary {
    pub preview_id: String,
    pub status: String,
    pub public_url: Option<String>,
    pub gateway_port: Option<u16>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone)]
struct OwnerGrant {
    preview_id: String,
    return_to: String,
    expires_at_ms: u128,
}

#[derive(Clone)]
struct GatewayState {
    app: AppState,
    preview_id: String,
    grants: Arc<Mutex<HashMap<String, OwnerGrant>>>,
    client: reqwest::Client,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareGrantRequest {
    pub return_to: Option<String>,
}

#[derive(Deserialize)]
struct GrantQuery {
    token: Option<String>,
}

#[derive(Deserialize)]
struct AccessRequestQuery {
    secret: Option<String>,
}

impl PreviewShareSummary {
    pub fn stopped(preview_id: String) -> Self {
        let now = crate::api::common::timestamp();
        Self {
            preview_id,
            status: "stopped".to_string(),
            public_url: None,
            gateway_port: None,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

pub fn get(state: &AppState, preview_id: &str) -> Option<PreviewShareSummary> {
    state
        .previews
        .get_share(preview_id)
        .and_then(|handle| handle.summary.lock().ok().map(|summary| summary.clone()))
}

pub async fn start(state: AppState, preview: PreviewRecord) -> anyhow::Result<PreviewShareSummary> {
    if let Some(existing) = state.previews.get_share(&preview.id) {
        if let Some(summary) = existing.summary.lock().ok().map(|summary| summary.clone()) {
            if summary.status == "starting" || summary.status == "running" {
                return Ok(summary);
            }
        }
    }
    let _ = stop(&state, &preview.id);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let now = crate::api::common::timestamp();
    let summary = Arc::new(Mutex::new(PreviewShareSummary {
        preview_id: preview.id.clone(),
        status: "starting".to_string(),
        public_url: None,
        gateway_port: Some(port),
        error: None,
        created_at: now.clone(),
        updated_at: now,
    }));
    let grants = Arc::new(Mutex::new(HashMap::new()));
    let (stop_tx, _) = broadcast::channel(4);
    state.previews.insert_share(PreviewShareHandle {
        preview_id: preview.id.clone(),
        summary: summary.clone(),
        grants: grants.clone(),
        stop: stop_tx.clone(),
    });

    append_share_log(
        &state,
        &preview,
        &format!("\n[share] auth gateway listening on 127.0.0.1:{port}\n"),
    );

    let gateway_state = GatewayState {
        app: state.clone(),
        preview_id: preview.id.clone(),
        grants,
        client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()?,
    };
    let gateway = Router::new()
        .route("/.codex-preview/grant", axum_get(owner_grant))
        .route(
            "/.codex-preview/access-requests",
            post(create_access_request),
        )
        .route(
            "/.codex-preview/access-requests/:requestId",
            axum_get(get_access_request),
        )
        .route("/", axum_get(gateway_get))
        .route("/*path", axum_get(gateway_get))
        .fallback(gateway_request)
        .with_state(gateway_state);
    let mut gateway_stop = stop_tx.subscribe();
    tokio::spawn(async move {
        let _ = axum::serve(listener, gateway)
            .with_graceful_shutdown(async move {
                let _ = gateway_stop.recv().await;
            })
            .await;
    });

    if let Err(err) = spawn_cftunnel(
        state.clone(),
        preview.clone(),
        port,
        summary.clone(),
        stop_tx.clone(),
    ) {
        update_summary(&summary, "error", None, Some(err.to_string()));
        append_share_log(&state, &preview, &format!("[share error] {err}\n"));
        let _ = stop_tx.send(());
    }

    Ok(summary
        .lock()
        .ok()
        .map(|summary| summary.clone())
        .unwrap_or_else(|| PreviewShareSummary::stopped(preview.id)))
}

pub fn stop(state: &AppState, preview_id: &str) -> Option<PreviewShareSummary> {
    let handle = state.previews.remove_share(preview_id)?;
    clear_stopped_summary(&handle.summary);
    let _ = handle.stop.send(());
    if let Ok(Some(preview)) = store::get(&state.db, preview_id) {
        append_share_log(state, &preview, "[share] stopped\n");
    }
    handle.summary.lock().ok().map(|summary| summary.clone())
}

pub fn create_grant_url(
    state: &AppState,
    preview: &PreviewRecord,
    return_to: Option<String>,
) -> anyhow::Result<String> {
    let Some(handle) = state.previews.get_share(&preview.id) else {
        anyhow::bail!("preview_share_not_running");
    };
    let summary = handle
        .summary
        .lock()
        .map_err(|_| anyhow::anyhow!("preview_share_not_running"))?
        .clone();
    let Some(public_url) = summary.public_url else {
        anyhow::bail!("preview_share_not_running");
    };
    let return_to = normalize_return_to(return_to.as_deref().unwrap_or("/"));
    if preview.access != "private" {
        return Ok(join_public_url(&public_url, &return_to));
    }
    expire_owner_grants(&handle.grants);
    let token = random_hex(16);
    if let Ok(mut grants) = handle.grants.lock() {
        grants.insert(
            token.clone(),
            OwnerGrant {
                preview_id: preview.id.clone(),
                return_to,
                expires_at_ms: crate::api::common::current_millis() + OWNER_GRANT_TTL_MS,
            },
        );
    }
    Ok(format!(
        "{}/.codex-preview/grant?token={}",
        public_url.trim_end_matches('/'),
        token
    ))
}

async fn owner_grant(
    State(gateway): State<GatewayState>,
    Query(query): Query<GrantQuery>,
) -> Response<Body> {
    expire_owner_grants(&gateway.grants);
    let preview = match store::get(&gateway.app.db, &gateway.preview_id) {
        Ok(Some(preview)) => preview,
        _ => return text_response(StatusCode::NOT_FOUND, "preview not found"),
    };
    let token = query.token.unwrap_or_default();
    let grant = gateway
        .grants
        .lock()
        .ok()
        .and_then(|mut grants| grants.remove(&token));
    let Some(grant) = grant else {
        return text_response(StatusCode::UNAUTHORIZED, "preview share grant expired");
    };
    if grant.preview_id != preview.id {
        return text_response(StatusCode::UNAUTHORIZED, "preview share grant expired");
    }
    let Some(cookie) = crate::http::preview_access_cookie_header(
        &gateway.app,
        &preview.id,
        &preview.token,
        SHARE_COOKIE_TTL_SECONDS,
    ) else {
        return text_response(StatusCode::BAD_REQUEST, "preview share grant failed");
    };
    Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::LOCATION, grant.return_to)
        .header(header::SET_COOKIE, cookie)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

async fn create_access_request(State(gateway): State<GatewayState>) -> Response<Body> {
    let preview = match store::get(&gateway.app.db, &gateway.preview_id) {
        Ok(Some(preview)) => preview,
        _ => {
            return json_response(
                StatusCode::NOT_FOUND,
                serde_json::json!({ "error": "preview_not_found" }),
            )
        }
    };
    if preview.access != "private" {
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "preview_is_public" }),
        );
    }
    let source_path = "/.codex-preview/access-requests";
    match store::create_access_request_with_notification(&gateway.app, &preview.id, source_path) {
        Ok((id, secret, reused)) => json_response(
            StatusCode::ACCEPTED,
            serde_json::json!({ "status": "pending", "id": id, "secret": secret, "reused": reused }),
        ),
        Err(err) => json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": err.to_string() }),
        ),
    }
}

async fn get_access_request(
    State(gateway): State<GatewayState>,
    Path(request_id): Path<String>,
    Query(query): Query<AccessRequestQuery>,
) -> Response<Body> {
    if let Err(err) = store::expire_access_requests(&gateway.app.db) {
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": err.to_string() }),
        );
    }
    let preview = match store::get(&gateway.app.db, &gateway.preview_id) {
        Ok(Some(preview)) => preview,
        _ => {
            return json_response(
                StatusCode::NOT_FOUND,
                serde_json::json!({ "error": "preview_not_found" }),
            )
        }
    };
    let request = match store::get_access_request(
        &gateway.app.db,
        &preview.id,
        &request_id,
        query.secret.as_deref(),
    ) {
        Ok(Some(request)) => request,
        Ok(None) => {
            return json_response(
                StatusCode::NOT_FOUND,
                serde_json::json!({ "error": "access_request_not_found" }),
            )
        }
        Err(err) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": err.to_string() }),
            )
        }
    };
    let mut response = json_response(
        StatusCode::OK,
        serde_json::json!({ "status": request.status, "approvedUntil": request.approved_until }),
    );
    if request.status == "approved" {
        let ttl = request
            .approved_until
            .as_deref()
            .and_then(seconds_until)
            .unwrap_or(15 * 60)
            .clamp(1, 30 * 24 * 60 * 60);
        if let Some(cookie) = crate::http::preview_access_cookie_header(
            &gateway.app,
            &preview.id,
            &preview.token,
            ttl,
        ) {
            if let Ok(value) = header::HeaderValue::from_str(&cookie) {
                response.headers_mut().insert(header::SET_COOKIE, value);
            }
        }
    }
    response
}

async fn gateway_get(
    State(gateway): State<GatewayState>,
    ws: Option<WebSocketUpgrade>,
    request: Request<Body>,
) -> Response<Body> {
    let Some(ws) = ws else {
        return gateway_request(State(gateway), request).await;
    };
    let preview = match store::get(&gateway.app.db, &gateway.preview_id) {
        Ok(Some(preview)) => preview,
        _ => return text_response(StatusCode::NOT_FOUND, "preview not found"),
    };
    if preview.access == "private"
        && !crate::http::preview_request_has_access(
            &gateway.app,
            &preview.id,
            &preview.token,
            request.headers(),
        )
    {
        return text_response(StatusCode::UNAUTHORIZED, "private preview requires access");
    }
    let path = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());
    let state = gateway.app.clone();
    ws.on_upgrade(move |socket| proxy_websocket(state, preview, path, socket))
        .into_response()
}

async fn gateway_request(
    State(gateway): State<GatewayState>,
    request: Request<Body>,
) -> Response<Body> {
    let preview = match store::get(&gateway.app.db, &gateway.preview_id) {
        Ok(Some(preview)) => preview,
        _ => return text_response(StatusCode::NOT_FOUND, "preview not found"),
    };
    if preview.access == "private"
        && !crate::http::preview_request_has_access(
            &gateway.app,
            &preview.id,
            &preview.token,
            request.headers(),
        )
    {
        if request.method() == Method::GET || request.method() == Method::HEAD {
            return access_page(
                request
                    .uri()
                    .path_and_query()
                    .map(|v| v.as_str())
                    .unwrap_or("/"),
            );
        }
        return text_response(StatusCode::UNAUTHORIZED, "private preview requires access");
    }
    proxy_http(gateway, preview, request).await
}

async fn proxy_websocket(state: AppState, preview: PreviewRecord, path: String, socket: WebSocket) {
    let target = format!("ws://{}:{}{}", preview.target_host, preview.port, path);
    let upstream = match tokio_tungstenite::connect_async(&target).await {
        Ok((stream, _)) => stream,
        Err(err) => {
            append_share_log(
                &state,
                &preview,
                &format!("[share websocket error] {err}\n"),
            );
            return;
        }
    };
    let (mut client_tx, mut client_rx) = socket.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    loop {
        tokio::select! {
            message = client_rx.next() => {
                let Some(Ok(message)) = message else { break; };
                let close = matches!(message, Message::Close(_));
                if upstream_tx.send(axum_to_tungstenite(message)).await.is_err() || close {
                    break;
                }
            }
            message = upstream_rx.next() => {
                let Some(Ok(message)) = message else { break; };
                let close = matches!(message, TungsteniteMessage::Close(_));
                if let Some(message) = tungstenite_to_axum(message) {
                    if client_tx.send(message).await.is_err() || close {
                        break;
                    }
                }
            }
        }
    }
}

async fn proxy_http(
    gateway: GatewayState,
    preview: PreviewRecord,
    request: Request<Body>,
) -> Response<Body> {
    let method = request.method().clone();
    let path = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/");
    let target = format!("http://{}:{}{}", preview.target_host, preview.port, path);
    let headers = request.headers().clone();
    let body = if method == Method::GET || method == Method::HEAD {
        bytes::Bytes::new()
    } else {
        match axum::body::to_bytes(request.into_body(), 25 * 1024 * 1024).await {
            Ok(body) => body,
            Err(_) => {
                return text_response(StatusCode::BAD_REQUEST, "preview share body read failed")
            }
        }
    };
    let mut upstream = gateway.client.request(method, target).header(
        header::HOST,
        format!("{}:{}", preview.target_host, preview.port),
    );
    for (name, value) in headers.iter() {
        if should_forward_header(name.as_str()) {
            upstream = upstream.header(name, value);
        }
    }
    let response = match upstream.body(body).send().await {
        Ok(response) => response,
        Err(err) => {
            append_share_log(
                &gateway.app,
                &preview,
                &format!("[share proxy error] {err}\n"),
            );
            return text_response(StatusCode::BAD_GATEWAY, "preview share proxy failed");
        }
    };
    let mut builder = Response::builder().status(response.status());
    for (name, value) in response.headers() {
        if should_forward_response_header(name.as_str()) {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(|_| text_response(StatusCode::BAD_GATEWAY, "preview share proxy failed"))
}

fn spawn_cftunnel(
    state: AppState,
    preview: PreviewRecord,
    port: u16,
    summary: Arc<Mutex<PreviewShareSummary>>,
    stop_tx: broadcast::Sender<()>,
) -> anyhow::Result<()> {
    let binary = std::env::var("CFTUNNEL_BIN").unwrap_or_else(|_| "cftunnel".to_string());
    let mut command = Command::new(binary);
    command
        .arg("quick")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
    let mut child = command.spawn()?;
    append_share_log(
        &state,
        &preview,
        &format!("[share] starting cftunnel quick {port}\n"),
    );

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(stream_tunnel_output(
            state.clone(),
            preview.clone(),
            summary.clone(),
            stdout,
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(stream_tunnel_output(
            state.clone(),
            preview.clone(),
            summary.clone(),
            stderr,
        ));
    }
    let mut stop_rx = stop_tx.subscribe();
    tokio::spawn(async move {
        let exit_code = tokio::select! {
            _ = stop_rx.recv() => {
                terminate_tunnel_child(&mut child).await;
                None
            }
            result = child.wait() => result.ok().and_then(|status| status.code()),
        };
        let current_status = summary
            .lock()
            .ok()
            .map(|summary| summary.status.clone())
            .unwrap_or_default();
        if current_status == "stopped" {
            return;
        }
        if exit_code == Some(0) {
            clear_stopped_summary(&summary);
        } else {
            update_summary(
                &summary,
                "error",
                None,
                Some(format!(
                    "cftunnel exited with {}",
                    exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "null".to_string())
                )),
            );
        }
        append_share_log(
            &state,
            &preview,
            &format!(
                "[share exit] {}\n",
                exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "null".to_string())
            ),
        );
        let _ = stop_tx.send(());
    });
    Ok(())
}

async fn stream_tunnel_output<R>(
    state: AppState,
    preview: PreviewRecord,
    summary: Arc<Mutex<PreviewShareSummary>>,
    reader: R,
) where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let chunk = format!("{line}\n");
        append_share_log(&state, &preview, &chunk);
        if let Some(public_url) = extract_public_url(&chunk) {
            let should_log = if let Ok(mut value) = summary.lock() {
                if value.public_url.is_none() {
                    value.public_url = Some(public_url.clone());
                    value.status = "running".to_string();
                    value.error = None;
                    value.updated_at = crate::api::common::timestamp();
                    true
                } else {
                    false
                }
            } else {
                false
            };
            if should_log {
                append_share_log(
                    &state,
                    &preview,
                    &format!("[share] public url {public_url}\n"),
                );
            }
        }
    }
}

async fn terminate_tunnel_child(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Some(pid) = child.id() {
            signal_process_group(pid, libc::SIGTERM);
            if tokio::time::timeout(std::time::Duration::from_millis(2500), child.wait())
                .await
                .is_err()
            {
                signal_process_group(pid, libc::SIGKILL);
                let _ = child.wait().await;
            }
            return;
        }
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
}

#[cfg(unix)]
fn signal_process_group(pid: u32, signal: libc::c_int) {
    let pgid = -(pid as libc::pid_t);
    unsafe {
        let _ = libc::kill(pgid, signal);
    }
}

fn extract_public_url(value: &str) -> Option<String> {
    let re = Regex::new(r#"https://[^\s"'<>]+\.trycloudflare\.com\b"#).ok()?;
    let result = re
        .find_iter(value)
        .map(|item| item.as_str().to_string())
        .find(|url| {
            url::Url::parse(url)
                .ok()
                .is_some_and(|parsed| parsed.host_str() != Some("api.trycloudflare.com"))
        });
    result
}

fn update_summary(
    summary: &Arc<Mutex<PreviewShareSummary>>,
    status: &str,
    public_url: Option<String>,
    error: Option<String>,
) {
    if let Ok(mut summary) = summary.lock() {
        summary.status = status.to_string();
        if public_url.is_some() {
            summary.public_url = public_url;
        }
        summary.error = error;
        summary.updated_at = crate::api::common::timestamp();
    }
}

fn clear_stopped_summary(summary: &Arc<Mutex<PreviewShareSummary>>) {
    if let Ok(mut summary) = summary.lock() {
        summary.status = "stopped".to_string();
        summary.public_url = None;
        summary.gateway_port = None;
        summary.error = None;
        summary.updated_at = crate::api::common::timestamp();
    }
}

fn append_share_log(state: &AppState, preview: &PreviewRecord, chunk: &str) {
    let _ = store::append_logs(&state.db, &preview.id, &preview.label, chunk);
    state.previews.publish_event(
        &preview.id,
        serde_json::json!({
            "type": "log",
            "previewId": preview.id,
            "chunk": chunk,
            "at": crate::api::common::timestamp(),
        }),
    );
}

fn expire_owner_grants(grants: &Arc<Mutex<HashMap<String, OwnerGrant>>>) {
    let now = crate::api::common::current_millis();
    if let Ok(mut grants) = grants.lock() {
        grants.retain(|_, grant| grant.expires_at_ms > now);
    }
}

fn random_hex(bytes: usize) -> String {
    let mut data = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut data);
    data.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn normalize_return_to(value: &str) -> String {
    let trimmed = value.trim();
    let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
    let lower = trimmed.to_ascii_lowercase();
    if trimmed.starts_with("//")
        || lower.chars().position(|c| c == ':').is_some_and(|index| {
            trimmed[..index]
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        })
    {
        return "/".to_string();
    }
    format!("/{}", trimmed.trim_start_matches('/'))
}

fn join_public_url(public_url: &str, path: &str) -> String {
    format!(
        "{}{}",
        public_url.trim_end_matches('/'),
        normalize_return_to(path)
    )
}

fn should_forward_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "content-length"
            | "accept-encoding"
            | "upgrade"
            | "proxy-authorization"
    )
}

fn should_forward_response_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "connection" | "content-encoding" | "content-length" | "transfer-encoding" | "upgrade"
    )
}

fn axum_to_tungstenite(message: Message) -> TungsteniteMessage {
    match message {
        Message::Text(value) => TungsteniteMessage::Text(value),
        Message::Binary(value) => TungsteniteMessage::Binary(value),
        Message::Ping(value) => TungsteniteMessage::Ping(value),
        Message::Pong(value) => TungsteniteMessage::Pong(value),
        Message::Close(_) => TungsteniteMessage::Close(None),
    }
}

fn tungstenite_to_axum(message: TungsteniteMessage) -> Option<Message> {
    match message {
        TungsteniteMessage::Text(value) => Some(Message::Text(value)),
        TungsteniteMessage::Binary(value) => Some(Message::Binary(value)),
        TungsteniteMessage::Ping(value) => Some(Message::Ping(value)),
        TungsteniteMessage::Pong(value) => Some(Message::Pong(value)),
        TungsteniteMessage::Close(Some(frame)) => Some(Message::Close(Some(CloseFrame {
            code: frame.code.into(),
            reason: frame.reason,
        }))),
        TungsteniteMessage::Close(None) => Some(Message::Close(None)),
        TungsteniteMessage::Frame(_) => None,
    }
}

fn json_response(status: StatusCode, value: serde_json::Value) -> Response<Body> {
    let body = serde_json::to_vec(&value).unwrap_or_default();
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn text_response(status: StatusCode, value: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(value.to_string()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn access_page(return_to: &str) -> Response<Body> {
    let return_to = serde_json::to_string(return_to).unwrap_or_else(|_| "\"/\"".to_string());
    let html = format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Private Preview Share</title>
  <style>
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f4; color: #172018; }}
    main {{ width: min(460px, calc(100vw - 32px)); border: 1px solid #d9ded6; border-radius: 10px; background: white; padding: 20px; box-shadow: 0 24px 80px rgba(14, 20, 16, .16); }}
    h1 {{ margin: 0 0 8px; font-size: 18px; }}
    p {{ margin: 0 0 14px; color: #586256; }}
    button {{ min-height: 34px; border-radius: 8px; border: 1px solid #172018; background: #172018; color: white; padding: 0 12px; cursor: pointer; }}
    .muted {{ margin-top: 12px; font-size: 12px; color: #7a8378; }}
  </style>
</head>
<body>
  <main>
    <h1>私有公开预览需要授权</h1>
    <p id="message">这是一个私有预览分享。请发起访问请求，等待 Codex Web 管理员批准。</p>
    <button id="request" type="button">请求授权</button>
    <p class="muted">Access is granted per preview share after approval.</p>
  </main>
  <script>
    (() => {{
      const message = document.getElementById("message");
      const button = document.getElementById("request");
      let timer = null;
      async function poll(id, secret) {{
        const response = await fetch("/.codex-preview/access-requests/" + encodeURIComponent(id) + "?secret=" + encodeURIComponent(secret), {{ cache: "no-store" }});
        const result = await response.json().catch(() => null);
        if (response.ok && result?.status === "approved") {{
          message.textContent = "授权已批准，正在打开预览...";
          window.location.replace({return_to});
          return;
        }}
        if (result?.status === "denied") {{
          message.textContent = "授权请求已被拒绝。";
          if (timer) window.clearInterval(timer);
        }}
      }}
      button.addEventListener("click", async () => {{
        button.disabled = true;
        message.textContent = "正在创建授权请求...";
        const response = await fetch("/.codex-preview/access-requests", {{ method: "POST" }});
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.id || !result?.secret) {{
          message.textContent = "授权请求创建失败，请回到 Codex Web 后重试。";
          button.disabled = false;
          return;
        }}
        message.textContent = "授权请求已发送，请等待审批通过。";
        timer = window.setInterval(() => void poll(result.id, result.secret), 2000);
        void poll(result.id, result.secret);
      }});
    }})();
  </script>
</body>
</html>"#
    );
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(html))
        .unwrap_or_else(|_| Response::new(Body::empty()))
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
