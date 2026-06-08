use rusqlite::{params, OptionalExtension};

use crate::api::sessions::store as session_store;
use crate::db::Db;

use super::models::{WebhookRouteInput, WebhookRouteRow, WebhookRouteSummary};

const DEFAULT_TEMPLATE: &str = "Webhook event from {{routeName}} ({{eventType}})\n\n{{body}}";

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists webhook_routes (
          id text primary key,
          route_key text not null unique,
          name text not null,
          enabled integer not null,
          secret text not null,
          session_id text,
          prompt_template text not null,
          created_at text not null,
          updated_at text not null
        );
        create index if not exists webhook_routes_updated_idx on webhook_routes(updated_at desc, id desc);
        ",
    )?;
    Ok(())
}

fn table_exists(connection: &rusqlite::Connection, table: &str) -> anyhow::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn row_from(row: &rusqlite::Row<'_>) -> rusqlite::Result<WebhookRouteRow> {
    Ok(WebhookRouteRow {
        id: row.get(0)?,
        route_key: row.get(1)?,
        name: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        secret: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        session_id: row.get::<_, Option<String>>(5)?,
        prompt_template: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

const SELECT_COLS: &str = "select id, route_key, name, enabled, secret, session_id, prompt_template, created_at, updated_at from webhook_routes";

pub fn list_rows(db: &Db) -> anyhow::Result<Vec<WebhookRouteRow>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "webhook_routes")? {
        return Ok(Vec::new());
    }
    let sql = format!("{SELECT_COLS} order by updated_at desc, id desc");
    let mut statement = connection.prepare(&sql)?;
    let items = statement
        .query_map([], row_from)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn get_by_id(db: &Db, id: &str) -> anyhow::Result<Option<WebhookRouteRow>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "webhook_routes")? {
        return Ok(None);
    }
    let sql = format!("{SELECT_COLS} where id = ?");
    Ok(connection.query_row(&sql, [id], row_from).optional()?)
}

pub fn get_by_route_key(db: &Db, route_key: &str) -> anyhow::Result<Option<WebhookRouteRow>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "webhook_routes")? {
        return Ok(None);
    }
    let sql = format!("{SELECT_COLS} where route_key = ?");
    Ok(connection
        .query_row(&sql, [route_key], row_from)
        .optional()?)
}

fn upsert(db: &Db, route: &WebhookRouteRow) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "
        insert into webhook_routes (id, route_key, name, enabled, secret, session_id, prompt_template, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          route_key = excluded.route_key,
          name = excluded.name,
          enabled = excluded.enabled,
          secret = excluded.secret,
          session_id = excluded.session_id,
          prompt_template = excluded.prompt_template,
          updated_at = excluded.updated_at
        ",
        params![
            &route.id,
            &route.route_key,
            &route.name,
            if route.enabled { 1 } else { 0 },
            &route.secret,
            route.session_id.as_deref(),
            &route.prompt_template,
            &route.created_at,
            &route.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let deleted = connection.execute("delete from webhook_routes where id = ?", [id])?;
    Ok(deleted != 0)
}

pub fn bind_session(db: &Db, id: &str, session_id: Option<&str>) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update webhook_routes set session_id = ?, updated_at = ? where id = ?",
        params![session_id, crate::api::common::timestamp(), id],
    )?;
    Ok(())
}

// === Create / update mirroring TS routes.ts ===

fn value_str(value: &Option<serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn slugify_route_name(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    let slug: String = slug.chars().take(24).collect();
    if slug.is_empty() {
        "webhook".to_string()
    } else {
        slug
    }
}

fn normalize_secret(secret: &str) -> String {
    let value = secret.trim();
    if !value.is_empty() {
        return value.to_string();
    }
    format!("whsec_{}", base64_url(&random_bytes(18)))
}

/// Mirrors TS `webhookSecretIsSafe`: INSECURE_NO_AUTH only allowed on loopback hosts.
fn secret_is_safe(secret: &str, host: &str) -> bool {
    secret != "INSECURE_NO_AUTH" || host == "127.0.0.1" || host == "localhost" || host == "::1"
}

pub fn create(
    db: &Db,
    input: WebhookRouteInput,
    host: &str,
) -> anyhow::Result<Result<WebhookRouteSummary, &'static str>> {
    let name = value_str(&input.name).trim().to_string();
    if name.is_empty() {
        return Ok(Err("invalid_webhook_route"));
    }
    let now = crate::api::common::timestamp();
    let id = format!("webhook-route-{}", uuid_v4());
    let route_key_source = value_str(&input.route_key);
    let route_key_base = slugify_route_name(if route_key_source.is_empty() {
        &name
    } else {
        &route_key_source
    });
    let route_key = format!("{route_key_base}-{}", &uuid_v4().replace('-', "")[..8]);
    let secret = normalize_secret(&value_str(&input.secret));
    if !secret_is_safe(&secret, host) {
        return Ok(Err("webhook_insecure_secret_requires_loopback"));
    }
    let command_template =
        command_template_or_default(&input.command_template, &input.prompt_template, None);

    let enabled = !matches!(input.enabled, Some(serde_json::Value::Bool(false)));
    let route = WebhookRouteRow {
        id: id.clone(),
        route_key,
        name,
        enabled,
        secret,
        session_id: None,
        prompt_template: command_template,
        created_at: now.clone(),
        updated_at: now,
    };
    upsert(db, &route)?;
    let row = get_by_id(db, &id)?.ok_or_else(|| anyhow::anyhow!("webhook_route_create_failed"))?;
    Ok(Ok(route_summary(db, &row, host)))
}

pub fn update(
    db: &Db,
    id: &str,
    input: WebhookRouteInput,
    host: &str,
) -> anyhow::Result<Result<Option<WebhookRouteSummary>, &'static str>> {
    let Some(current) = get_by_id(db, id)? else {
        return Ok(Ok(None));
    };
    let now = crate::api::common::timestamp();

    let secret_input = value_str(&input.secret);
    let secret = if !secret_input.trim().is_empty() {
        normalize_secret(&secret_input)
    } else {
        current.secret.clone()
    };
    if !secret_is_safe(&secret, host) {
        return Ok(Err("webhook_insecure_secret_requires_loopback"));
    }

    let name = {
        let candidate = value_str(&input.name);
        let trimmed = candidate.trim();
        if input.name.is_some() && !trimmed.is_empty() {
            trimmed.to_string()
        } else {
            current.name.clone()
        }
    };

    let enabled = match input.enabled {
        None => current.enabled,
        Some(serde_json::Value::Bool(false)) => false,
        Some(_) => true,
    };

    let prompt_template = command_template_or_default(
        &input.command_template,
        &input.prompt_template,
        Some(&current.prompt_template),
    );

    let route = WebhookRouteRow {
        id: current.id.clone(),
        route_key: current.route_key.clone(),
        name,
        enabled,
        secret,
        session_id: current.session_id.clone(),
        prompt_template,
        created_at: current.created_at.clone(),
        updated_at: now,
    };
    upsert(db, &route)?;
    let row = get_by_id(db, id)?.ok_or_else(|| anyhow::anyhow!("webhook_route_update_failed"))?;
    Ok(Ok(Some(route_summary(db, &row, host))))
}

fn command_template_or_default(
    command_template: &Option<serde_json::Value>,
    prompt_template: &Option<serde_json::Value>,
    current: Option<&str>,
) -> String {
    let mut candidate = value_str(command_template);
    if candidate.trim().is_empty() {
        candidate = value_str(prompt_template);
    }
    if candidate.trim().is_empty() {
        if let Some(current) = current {
            candidate = current.to_string();
        }
    }
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        DEFAULT_TEMPLATE.to_string()
    } else {
        trimmed.to_string()
    }
}

// === Summary projection (mirrors TS webhookRouteFromRow) ===

pub fn route_summary(db: &Db, row: &WebhookRouteRow, host: &str) -> WebhookRouteSummary {
    let session_title = row.session_id.as_ref().and_then(|session_id| {
        session_store::list_sessions(db, true, true)
            .ok()
            .and_then(|sessions| {
                sessions
                    .into_iter()
                    .find(|item| &item.id == session_id)
                    .map(|item| item.title)
            })
    });
    let public_base_url = if host.starts_with("0.0.0.0") || host == "127.0.0.1" || host == "::1" {
        "http://localhost:5173".to_string()
    } else {
        format!("http://{host}:5173")
    };
    let curl_example = format!(
        "curl \"{public_base_url}/api/webhook/{}?command=sessions\" -H \"X-Webhook-Token: {}\"",
        row.route_key, row.secret
    );
    WebhookRouteSummary {
        id: row.id.clone(),
        route_key: row.route_key.clone(),
        name: row.name.clone(),
        enabled: row.enabled,
        secret: row.secret.clone(),
        curl_example,
        session_id: row.session_id.clone(),
        session_title,
        command_template: row.prompt_template.clone(),
        prompt_template: row.prompt_template.clone(),
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    }
}

pub fn list(db: &Db, host: &str) -> anyhow::Result<Vec<WebhookRouteSummary>> {
    Ok(list_rows(db)?
        .iter()
        .map(|row| route_summary(db, row, host))
        .collect())
}

// === Inbound token validation / payload parsing (mirror notifications/service.ts) ===

pub fn validate_webhook_token(
    secret: &str,
    headers: &axum::http::HeaderMap,
    query_token: Option<&str>,
    host: &str,
) -> bool {
    if secret == "INSECURE_NO_AUTH" {
        return host == "127.0.0.1" || host == "localhost" || host == "::1";
    }
    let header_token = headers
        .get("x-webhook-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            let trimmed = s.trim();
            if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("Bearer ") {
                trimmed[7..].to_string()
            } else {
                trimmed.to_string()
            }
        });
    let provided = [header_token, bearer, query_token.map(|s| s.to_string())]
        .into_iter()
        .flatten()
        .map(|s| s.trim().to_string())
        .find(|s| !s.is_empty());
    matches!(provided, Some(value) if value == secret)
}

pub fn parse_webhook_payload(
    content_type: Option<&str>,
    raw_body: &[u8],
) -> serde_json::Map<String, serde_json::Value> {
    let content_type = content_type.unwrap_or("").to_lowercase();
    let text = String::from_utf8_lossy(raw_body).to_string();
    let trimmed = text.trim_start();
    if content_type.contains("application/json")
        || trimmed.starts_with('{')
        || trimmed.starts_with('[')
    {
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&text)
        {
            return map;
        }
        // Arrays / parse failures fall back to { body }
        let mut map = serde_json::Map::new();
        map.insert("body".to_string(), serde_json::Value::String(text));
        return map;
    }
    if content_type.contains("application/x-www-form-urlencoded") {
        let mut map = serde_json::Map::new();
        for pair in text.split('&') {
            if pair.is_empty() {
                continue;
            }
            let mut iter = pair.splitn(2, '=');
            let key = url_decode(iter.next().unwrap_or(""));
            let value = url_decode(iter.next().unwrap_or(""));
            map.insert(key, serde_json::Value::String(value));
        }
        return map;
    }
    let mut map = serde_json::Map::new();
    map.insert("body".to_string(), serde_json::Value::String(text));
    map
}

fn url_decode(input: &str) -> String {
    let bytes = input.replace('+', " ");
    let mut out = Vec::new();
    let mut chars = bytes.bytes().peekable();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next();
            let lo = chars.next();
            if let (Some(hi), Some(lo)) = (hi, lo) {
                if let (Some(h), Some(l)) = (hex_val(hi), hex_val(lo)) {
                    out.push(h * 16 + l);
                    continue;
                }
            }
            out.push(b'%');
        } else {
            out.push(b);
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// === small helpers ===

fn random_bytes(size: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(n & 63) as usize] as char);
        }
    }
    out
}

fn uuid_v4() -> String {
    let mut bytes = random_bytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10],
        bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}
