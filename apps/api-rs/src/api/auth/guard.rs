use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};

use crate::state::AppState;

use super::{api_keys, session, store};

pub async fn require_api_auth(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let method = request.method().as_str();
    let path = request.uri().path();

    if is_public_api_route(path) {
        return Ok(next.run(request).await);
    }
    if is_provider_proxy_route(path) {
        return Ok(next.run(request).await);
    }

    let Some(config) = store::load_auth_config(&state.db).map_err(api_error)? else {
        return Err(json_error(StatusCode::CONFLICT, "setup_required"));
    };

    let header_bearer = session::bearer_token(
        request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
    );
    // EventSource (SSE) cannot send an Authorization header, so the frontend passes the session
    // token via the `?token=` query parameter. Fall back to it when no bearer header is present.
    let query_token = query_param_token(request.uri().query());
    let bearer = header_bearer.or(query_token.as_deref());

    if session::verify_session_token(&config, bearer) {
        return Ok(next.run(request).await);
    }

    let Some(token) = bearer else {
        return Err(json_error(StatusCode::UNAUTHORIZED, "unauthorized"));
    };
    let Some(key) = api_keys::find_api_key_by_token(&state.db, token).map_err(api_error)? else {
        return Err(json_error(StatusCode::UNAUTHORIZED, "unauthorized"));
    };
    let Some(permission) = route_permission_for_request(method, path) else {
        return Err(json_error(StatusCode::FORBIDDEN, "forbidden"));
    };
    if !key.permissions.iter().any(|item| item == permission) {
        return Err(json_error(StatusCode::FORBIDDEN, "forbidden"));
    }

    api_keys::touch_last_used(&state.db, &key.id).map_err(api_error)?;
    Ok(next.run(request).await)
}

fn is_public_api_route(path: &str) -> bool {
    if path.starts_with("/api/webhook/") {
        // Inbound webhook dispatch is authenticated per-route via the route secret,
        // not via session/API-key auth. (Also registered outside the guarded router.)
        return true;
    }
    matches!(
        path,
        "/api/auth/state"
            | "/api/auth/setup/start"
            | "/api/auth/setup/complete"
            | "/api/auth/login"
            | "/api/auth/logout"
    )
}

fn is_provider_proxy_route(path: &str) -> bool {
    path.starts_with("/api/providers/") && path.ends_with("/proxy/responses")
}

fn route_permission_for_request(method: &str, path: &str) -> Option<&'static str> {
    if path.starts_with("/api/auth/api-key-permissions") {
        return Some("auth.read");
    }
    if path.starts_with("/api/auth/api-keys") {
        return Some("auth.manage");
    }
    if path.starts_with("/api/providers") {
        return Some(if method == "GET" {
            "providers.read"
        } else {
            "providers.manage"
        });
    }
    if path.starts_with("/api/sessions")
        || path.starts_with("/api/codex/tasks")
        || path.starts_with("/api/task-runs")
        || path.starts_with("/api/execution-contexts")
    {
        if method == "GET" {
            return Some("sessions.read");
        }
        return Some(
            if path.contains("/messages")
                || path.contains("/queue")
                || path.contains("/stop")
                || path.contains("/recover")
                || path.contains("/compact")
            {
                "sessions.run"
            } else {
                "sessions.manage"
            },
        );
    }
    if path.starts_with("/api/rooms") {
        if method == "GET" {
            return Some("rooms.read");
        }
        return Some(
            if path.contains("/messages")
                || path.contains("/runs/")
                || path.contains("/tasks")
                || path.contains("/retry-failed")
            {
                "rooms.run"
            } else {
                "rooms.manage"
            },
        );
    }
    if path.starts_with("/api/agents")
        || path.starts_with("/api/agent-roles")
        || path.starts_with("/api/agent-role-templates")
        || path.starts_with("/api/agent-groups")
        || path.starts_with("/api/agent-circles")
        || path.starts_with("/api/permission-profiles")
    {
        return Some(if method == "GET" {
            "agents.read"
        } else {
            "agents.manage"
        });
    }
    if path.starts_with("/api/automations") {
        if method == "GET" {
            return Some("automations.read");
        }
        return Some(if path.contains("/run") || path.contains("/stop") {
            "automations.run"
        } else {
            "automations.manage"
        });
    }
    if path.starts_with("/api/goals") {
        if method == "GET" {
            return Some("goals.read");
        }
        return Some(if path.contains("/plan") || path.contains("/orchestrate") {
            "goals.run"
        } else {
            "goals.manage"
        });
    }
    if path.starts_with("/api/previews") {
        return Some(if method == "GET" {
            "previews.read"
        } else {
            "previews.manage"
        });
    }
    if path.starts_with("/api/files") || path.starts_with("/api/file-mounts") {
        return Some(if method == "GET" {
            "files.read"
        } else {
            "files.write"
        });
    }
    if path.starts_with("/api/terminal") {
        return Some("terminal.exec");
    }
    if path.starts_with("/api/settings/environment/restore") {
        return Some("environment.restore");
    }
    if path.starts_with("/api/settings/environment") {
        return Some(if method == "GET" {
            "environment.read"
        } else {
            "environment.manage"
        });
    }
    if path.starts_with("/api/notifications") {
        return Some(if method == "GET" {
            "notifications.read"
        } else {
            "notifications.manage"
        });
    }
    if path.starts_with("/api/settings/storage") {
        return Some(if method == "GET" {
            "storage.read"
        } else {
            "storage.manage"
        });
    }
    if path.starts_with("/api/settings/backup") {
        return Some(if method == "GET" {
            "backup.read"
        } else {
            "backup.restore"
        });
    }
    if path.starts_with("/api/settings") {
        return Some(if method == "GET" {
            "settings.read"
        } else {
            "settings.manage"
        });
    }
    if path.starts_with("/api/app-notifications") {
        return Some(if method == "GET" {
            "notifications.read"
        } else {
            "notifications.manage"
        });
    }
    if path.starts_with("/api/approvals") || path.starts_with("/api/approval-grants") {
        return Some(if method == "GET" {
            "approvals.read"
        } else {
            "approvals.decide"
        });
    }
    // Note: TS routePermissionForRequest has no mapping for /api/webhook-routes,
    // so API keys cannot access webhook route management — it is session-only.
    // Returning None below mirrors that (guard yields `forbidden` for API keys).
    if path.starts_with("/api/extensions") {
        return Some(if method == "GET" {
            "extensions.read"
        } else {
            "extensions.manage"
        });
    }
    None
}

fn api_error(error: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    json_error(StatusCode::BAD_REQUEST, error.to_string())
}

/// Extract the `token` query parameter (used by EventSource/SSE which cannot send an
/// Authorization header). Returns the percent-decoded value if present and non-empty.
fn query_param_token(query: Option<&str>) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some("token") {
            let raw = parts.next().unwrap_or("");
            let decoded = percent_decode(raw);
            let trimmed = decoded.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Minimal application/x-www-form-urlencoded value decode (`%XX` + `+` → space).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hi = (bytes[index + 1] as char).to_digit(16);
                let lo = (bytes[index + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    index += 3;
                    continue;
                }
                out.push(bytes[index]);
                index += 1;
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn json_error(
    status: StatusCode,
    error: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": error.into() })))
}
