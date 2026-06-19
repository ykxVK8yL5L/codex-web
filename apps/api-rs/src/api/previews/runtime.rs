use std::{path::PathBuf, process::Stdio};

use axum::{
    body::Body,
    http::{header, Request, Response, StatusCode, Uri},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

use crate::state::{AppState, PreviewHandle};

use super::{models::PreviewRecord, store};

pub async fn start(state: AppState, preview: PreviewRecord) -> anyhow::Result<PreviewRecord> {
    if preview.status == "running" || preview.status == "starting" {
        return Ok(preview);
    }
    if let Some(running) = mark_running_if_reachable(&state, &preview).await? {
        return Ok(running);
    }
    if state.previews.get(&preview.id).is_some() {
        return Ok(preview);
    }
    let command = preview
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("preview_command_required"))?;
    let cwd = resolve_cwd(&state, &preview)?;
    if let Some(conflict) = store::preview_using_port(
        &state.db,
        &preview.target_host,
        preview.port,
        Some(&preview.id),
    )? {
        append_preview_log(
            &state,
            &preview,
            &format!(
                "[error] port {}:{} is already used by {}\n",
                preview.target_host, preview.port, conflict.label
            ),
        )?;
        anyhow::bail!("preview_port_in_use");
    }
    let rendered = render_command(command, &preview, &cwd);
    let starting =
        update_preview_cwd_status(&state, &preview.id, &cwd.display().to_string(), "starting")?
            .unwrap_or(preview.clone());
    append_preview_log(
        &state,
        &starting,
        &format!(
            "\n[start] {}\n$ {rendered}\ncwd: {}\n",
            crate::api::common::timestamp(),
            cwd.display()
        ),
    )?;
    let mut command = Command::new("/bin/sh");
    command
        .arg("-lc")
        .arg(&rendered)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
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
    let (kill_tx, mut kill_rx) = tokio::sync::mpsc::unbounded_channel();
    state.previews.insert(PreviewHandle {
        preview_id: preview.id.clone(),
        kill: kill_tx,
    });
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_state = state.clone();
    let stdout_preview = preview.clone();
    tokio::spawn(async move {
        if let Some(stdout) = stdout {
            stream_logs(stdout_state, stdout_preview, stdout).await;
        }
    });
    let stderr_state = state.clone();
    let stderr_preview = preview.clone();
    tokio::spawn(async move {
        if let Some(stderr) = stderr {
            stream_logs(stderr_state, stderr_preview, stderr).await;
        }
    });
    let ready_state = state.clone();
    let ready_preview = starting.clone();
    tokio::spawn(async move {
        wait_for_ready(ready_state, ready_preview).await;
    });
    let wait_state = state.clone();
    let wait_preview = starting.clone();
    tokio::spawn(async move {
        let exit_status = tokio::select! {
            _ = kill_rx.recv() => {
                terminate_preview_child(&mut child).await;
                None
            }
            result = child.wait() => result.ok().and_then(|status| status.code()),
        };
        wait_state.previews.remove(&wait_preview.id);
        settle_process_exit(wait_state, wait_preview, exit_status).await;
    });
    Ok(starting)
}

pub async fn mark_running_if_reachable(
    state: &AppState,
    preview: &PreviewRecord,
) -> anyhow::Result<Option<PreviewRecord>> {
    let Some(status) = is_preview_reachable(preview).await else {
        return Ok(None);
    };
    let running =
        update_preview_status(state, &preview.id, "running")?.unwrap_or_else(|| preview.clone());
    append_preview_log(
        state,
        &running,
        &format!(
            "\n[detect] upstream already responds with {}, marked running without starting command\n",
            status.as_u16()
        ),
    )?;
    Ok(Some(running))
}

async fn terminate_preview_child(child: &mut tokio::process::Child) {
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

pub fn stop(state: &AppState, preview_id: &str) -> anyhow::Result<Option<PreviewRecord>> {
    if let Some(handle) = state.previews.get(preview_id) {
        let _ = handle.kill.send(());
    }
    let preview = store::stop(&state.db, preview_id)?;
    if let Some(preview) = preview.as_ref() {
        publish_preview_status(state, preview);
    }
    Ok(preview)
}

pub async fn proxy(
    state: AppState,
    preview_id: String,
    token: String,
    path: String,
    request: Request<Body>,
) -> Result<Response<Body>, (StatusCode, axum::Json<serde_json::Value>)> {
    let Some(preview) = store::get(&state.db, &preview_id).map_err(api_error)? else {
        return Err(json_error(StatusCode::NOT_FOUND, "preview_not_found"));
    };
    if preview.token != token {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "preview_token_invalid",
        ));
    }
    if preview.access == "private"
        && !crate::http::preview_request_has_access(
            &state,
            &preview.id,
            &preview.token,
            request.headers(),
        )
    {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "preview_access_required",
        ));
    }
    let path = if path.trim().is_empty() {
        "/".to_string()
    } else {
        format!("/{path}")
    };
    let query = request
        .uri()
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    let target = format!(
        "http://{}:{}{}{}",
        preview.target_host, preview.port, path, query
    );
    let uri: Uri = target
        .parse()
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, "invalid_preview_target"))?;
    let method = request.method().clone();
    let headers = request.headers().clone();
    let body = if method == axum::http::Method::GET || method == axum::http::Method::HEAD {
        None
    } else {
        Some(
            axum::body::to_bytes(request.into_body(), 10 * 1024 * 1024)
                .await
                .map_err(|_| json_error(StatusCode::BAD_REQUEST, "preview_body_read_failed"))?,
        )
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| json_error(StatusCode::BAD_GATEWAY, "preview_proxy_failed"))?;
    let mut upstream = client.request(method, uri.to_string());
    for (name, value) in headers.iter() {
        if should_forward_header(name.as_str()) {
            upstream = upstream.header(name, value);
        }
    }
    if !headers.contains_key(header::USER_AGENT) {
        upstream = upstream.header(header::USER_AGENT, "codex-web-preview");
    }
    let response = upstream
        .body(body.unwrap_or_default())
        .send()
        .await
        .map_err(|err| {
            let _ = append_preview_log(&state, &preview, &format!("[proxy error] {err}\n"));
            json_error(StatusCode::BAD_GATEWAY, "preview_proxy_failed")
        })?;
    let status = response.status();
    let upstream_url = uri.to_string();
    let base_path = super::models::preview_url(&preview.id, &preview.token);
    let mut builder = Response::builder().status(status);
    for (name, value) in response.headers() {
        if !should_forward_response_header(name.as_str()) {
            continue;
        }
        if name == header::LOCATION {
            if let Ok(location) = value.to_str() {
                if let Some(rewritten) =
                    rewrite_preview_location(location, &upstream_url, &base_path)
                {
                    builder = builder.header(name, rewritten);
                    continue;
                }
            }
        }
        builder = builder.header(name, value);
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if content_type.contains("text/html") || content_type.contains("text/css") {
        let text = response
            .text()
            .await
            .map_err(|_| json_error(StatusCode::BAD_GATEWAY, "preview_proxy_failed"))?;
        let rewritten = rewrite_preview_text(&text, &base_path, &content_type);
        return builder
            .body(Body::from(rewritten))
            .map_err(|_| json_error(StatusCode::BAD_GATEWAY, "preview_proxy_failed"));
    }
    let stream = response.bytes_stream();
    builder
        .body(Body::from_stream(stream))
        .map_err(|_| json_error(StatusCode::BAD_GATEWAY, "preview_proxy_failed"))
}

async fn stream_logs<R>(state: AppState, preview: PreviewRecord, reader: R)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = append_preview_log(&state, &preview, &(line + "\n"));
    }
}

fn resolve_cwd(state: &AppState, preview: &PreviewRecord) -> anyhow::Result<PathBuf> {
    let workspace = preview_scope_workspace(state, preview)?
        .ok_or_else(|| anyhow::anyhow!("scope_not_found"))?;
    let absolute_workspace = workspace.canonicalize().unwrap_or(workspace);
    let raw = preview
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(".");
    let candidate = if raw == "~" {
        absolute_workspace.clone()
    } else {
        absolute_workspace.join(raw)
    };
    let normalized = candidate.canonicalize().unwrap_or(candidate);
    if !normalized.starts_with(&absolute_workspace) {
        anyhow::bail!("invalid_preview_cwd");
    }
    Ok(normalized)
}

fn preview_scope_workspace(
    state: &AppState,
    preview: &PreviewRecord,
) -> anyhow::Result<Option<PathBuf>> {
    let Some(connection) = state.db.open_read_only()? else {
        return Ok(None);
    };
    match preview.scope_type.as_str() {
        "project" => Ok(connection
            .query_row(
                "select workspace_path from projects where id = ?",
                [&preview.scope_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .map(PathBuf::from)),
        "session" => Ok(connection
            .query_row(
                "select workspace_path from sessions where id = ?",
                [&preview.scope_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .map(PathBuf::from)),
        "folder" => {
            let path = PathBuf::from(&preview.scope_id);
            Ok(if path.is_dir() { Some(path) } else { None })
        }
        _ => Ok(None),
    }
}

fn render_command(command: &str, preview: &PreviewRecord, cwd: &std::path::Path) -> String {
    command
        .replace("{port}", &preview.port.to_string())
        .replace("{host}", &preview.target_host)
        .replace("{dir}", &shell_quote(&cwd.display().to_string()))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn is_preview_reachable(preview: &PreviewRecord) -> Option<reqwest::StatusCode> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .ok()?;
    client
        .get(format!("http://{}:{}/", preview.target_host, preview.port))
        .send()
        .await
        .ok()
        .map(|response| response.status())
}

async fn wait_for_ready(state: AppState, preview: PreviewRecord) {
    for _ in 0..24 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let Ok(Some(current)) = store::get(&state.db, &preview.id) else {
            return;
        };
        if current.status != "starting" {
            return;
        }
        if let Some(status) = is_preview_reachable(&preview).await {
            let _ = update_preview_status(&state, &preview.id, "running");
            let _ = append_preview_log(
                &state,
                &preview,
                &format!("[ready] upstream responded with {}\n", status.as_u16()),
            );
            return;
        }
    }
    let Ok(Some(current)) = store::get(&state.db, &preview.id) else {
        return;
    };
    if current.status == "starting" {
        let _ = update_preview_status(&state, &preview.id, "error");
        let _ = append_preview_log(
            &state,
            &preview,
            "[error] upstream did not become ready within 12s\n",
        );
    }
}

async fn settle_process_exit(state: AppState, preview: PreviewRecord, exit_code: Option<i32>) {
    let Ok(Some(current)) = store::get(&state.db, &preview.id) else {
        return;
    };
    if current.status != "running" && current.status != "starting" {
        return;
    }
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    if exit_code == Some(0) {
        if let Some(status) = is_preview_reachable(&current).await {
            let _ = update_preview_status(&state, &preview.id, "running");
            let _ = append_preview_log(
                &state,
                &preview,
                &format!(
                    "\n[exit] shell exited with 0, upstream still responds with {}\n",
                    status.as_u16()
                ),
            );
            return;
        }
    }
    let next = if exit_code == Some(0) {
        "stopped"
    } else {
        "error"
    };
    let _ = update_preview_status(&state, &preview.id, next);
    let _ = append_preview_log(
        &state,
        &preview,
        &format!(
            "\n[exit] {}\n",
            exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "null".to_string())
        ),
    );
}

fn update_preview_cwd_status(
    state: &AppState,
    preview_id: &str,
    cwd: &str,
    status: &str,
) -> anyhow::Result<Option<PreviewRecord>> {
    let mut preview = store::update_cwd(&state.db, preview_id, cwd)?;
    if preview.is_some() {
        preview = store::update_status(&state.db, preview_id, status)?;
    }
    if let Some(preview) = preview.as_ref() {
        publish_preview_status(state, preview);
    }
    Ok(preview)
}

fn update_preview_status(
    state: &AppState,
    preview_id: &str,
    status: &str,
) -> anyhow::Result<Option<PreviewRecord>> {
    let preview = store::update_status(&state.db, preview_id, status)?;
    if let Some(preview) = preview.as_ref() {
        publish_preview_status(state, preview);
    }
    Ok(preview)
}

fn publish_preview_status(state: &AppState, preview: &PreviewRecord) {
    if let Ok(preview_value) = serde_json::to_value(preview.public()) {
        state.previews.publish_event(
            &preview.id,
            serde_json::json!({ "type": "status", "preview": preview_value }),
        );
    }
}

fn append_preview_log(
    state: &AppState,
    preview: &PreviewRecord,
    chunk: &str,
) -> anyhow::Result<()> {
    store::append_logs(&state.db, &preview.id, &preview.label, chunk)?;
    state.previews.publish_event(
        &preview.id,
        serde_json::json!({
            "type": "log",
            "previewId": preview.id,
            "chunk": chunk,
            "at": crate::api::common::timestamp(),
        }),
    );
    Ok(())
}

fn rewrite_preview_html(value: &str, base_path: &str) -> String {
    // Rust's regex crate intentionally does not support look-around/backreferences, so implement
    // TS's simple rewrite rules with broader captures + explicit prefix checks.
    let attr_re =
        regex::Regex::new(r#"\b(src|href|action)=(["'])/([^"']*)"#).expect("valid attr regex");
    let srcset_re =
        regex::Regex::new(r#"\bsrcset=(["'])([^"']*)(["'])"#).expect("valid srcset regex");
    let value = attr_re
        .replace_all(value, |caps: &regex::Captures<'_>| {
            let attr = &caps[1];
            let quote = &caps[2];
            let rest = &caps[3];
            if rest.starts_with('/') || rest.starts_with("preview/") || rest.starts_with("api/") {
                format!("{attr}={quote}/{rest}")
            } else {
                format!("{attr}={quote}{base_path}{rest}")
            }
        })
        .to_string();
    srcset_re
        .replace_all(&value, |caps: &regex::Captures<'_>| {
            let open_quote = &caps[1];
            let srcset = &caps[2];
            let close_quote = &caps[3];
            let rewritten = srcset
                .split(',')
                .map(|item| {
                    let trimmed = item.trim();
                    let mut parts = trimmed.split_whitespace();
                    let Some(url) = parts.next() else {
                        return trimmed.to_string();
                    };
                    if !url.starts_with('/')
                        || url.starts_with("//")
                        || url.starts_with("/preview/")
                        || url.starts_with("/api/")
                    {
                        return trimmed.to_string();
                    }
                    let rest = parts.collect::<Vec<_>>();
                    if rest.is_empty() {
                        format!("{}{}", base_path, url.trim_start_matches('/'))
                    } else {
                        format!(
                            "{}{} {}",
                            base_path,
                            url.trim_start_matches('/'),
                            rest.join(" ")
                        )
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("srcset={open_quote}{rewritten}{close_quote}")
        })
        .to_string()
}

fn rewrite_preview_css(value: &str, base_path: &str) -> String {
    let css_re = regex::Regex::new(r#"url\((["']?)/([^)'\"]*)"#).expect("valid css regex");
    css_re
        .replace_all(value, |caps: &regex::Captures<'_>| {
            let quote = &caps[1];
            let rest = &caps[2];
            if rest.starts_with('/') || rest.starts_with("preview/") || rest.starts_with("api/") {
                format!("url({quote}/{rest}")
            } else {
                format!("url({quote}{base_path}{rest}")
            }
        })
        .to_string()
}

fn rewrite_preview_text(value: &str, base_path: &str, content_type: &str) -> String {
    if content_type.contains("text/html") {
        return rewrite_preview_css(&rewrite_preview_html(value, base_path), base_path);
    }
    if content_type.contains("text/css") {
        return rewrite_preview_css(value, base_path);
    }
    value.to_string()
}

fn rewrite_preview_location(value: &str, upstream_url: &str, base_path: &str) -> Option<String> {
    let target = reqwest::Url::parse(value)
        .or_else(|_| reqwest::Url::parse(upstream_url).and_then(|base| base.join(value)))
        .ok()?;
    let upstream = reqwest::Url::parse(upstream_url).ok()?;
    if target.scheme() != upstream.scheme()
        || target.host_str() != upstream.host_str()
        || target.port_or_known_default() != upstream.port_or_known_default()
    {
        return None;
    }
    Some(format!(
        "{}{}{}{}",
        base_path,
        target.path().trim_start_matches('/'),
        target.query().map(|q| format!("?{q}")).unwrap_or_default(),
        target
            .fragment()
            .map(|f| format!("#{f}"))
            .unwrap_or_default()
    ))
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

fn api_error(err: anyhow::Error) -> (StatusCode, axum::Json<serde_json::Value>) {
    json_error(StatusCode::BAD_REQUEST, err.to_string())
}

fn json_error(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        status,
        axum::Json(serde_json::json!({ "error": message.into() })),
    )
}
