use anyhow::Context;
use rand::RngCore;
use rusqlite::{params, OptionalExtension};

use crate::api::common::timestamp;
use crate::db::Db;

use super::models::{CreatePreviewRequest, PreviewRecord, PreviewSummary};
use crate::api::common::PageCursor;

const PREVIEW_SELECT: &str = "select id, scope_type, scope_id, label, target_host, port, token, command, cwd, status, access, proxy_paths_json, created_at, updated_at from previews";

pub fn list(
    db: &Db,
    scope_type: Option<&str>,
    scope_id: Option<&str>,
    status: Option<&str>,
    q: Option<&str>,
    cursor: Option<&PageCursor>,
    limit: usize,
) -> anyhow::Result<Vec<PreviewSummary>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let needle = q
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let mut statement =
        connection.prepare(&format!("{PREVIEW_SELECT} order by updated_at desc, id desc"))?;
    let mut items = statement
        .query_map([], preview_from_row)?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|preview| scope_type.is_none_or(|value| preview.scope_type == value))
        .filter(|preview| scope_id.is_none_or(|value| preview.scope_id == value))
        .filter(|preview| status.is_none_or(|value| preview.status == value))
        .filter(|preview| {
            cursor.is_none_or(|cursor| {
                preview.updated_at < cursor.sort_value
                    || (preview.updated_at == cursor.sort_value && preview.id < cursor.id)
            })
        })
        .filter(|preview| {
            let Some(needle) = needle.as_deref() else {
                return true;
            };
            [
                preview.label.as_str(),
                preview.scope_type.as_str(),
                preview.scope_id.as_str(),
                preview.target_host.as_str(),
                &preview.port.to_string(),
                preview.command.as_deref().unwrap_or(""),
                preview.cwd.as_deref().unwrap_or(""),
                preview.access.as_str(),
            ]
            .iter()
            .any(|value| value.to_lowercase().contains(needle))
        })
        .take(limit)
        .map(|preview| preview.public())
        .collect::<Vec<_>>();
    items.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(items)
}

pub fn get(db: &Db, id: &str) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    connection
        .query_row(
            &format!("{PREVIEW_SELECT} where id = ?"),
            [id],
            preview_from_row,
        )
        .optional()
        .context("failed to load preview")
}

pub fn create_with_status(
    db: &Db,
    input: CreatePreviewRequest,
) -> anyhow::Result<(PreviewRecord, bool)> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let scope_type = normalize_scope_type(&input.scope_type)?;
    let scope_id = input.scope_id.trim();
    if scope_id.is_empty() {
        anyhow::bail!("invalid_scope");
    }
    if !scope_exists(&connection, &scope_type, scope_id)? {
        anyhow::bail!("scope_not_found");
    }
    let target_host = input
        .target_host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("127.0.0.1");
    if !valid_preview_host(target_host) {
        anyhow::bail!("invalid_target_host");
    }
    if input.port < 1 || input.port > 65_535 {
        anyhow::bail!("invalid_port");
    }
    let requested_command = non_empty(input.command.clone());
    let requested_cwd = non_empty(input.cwd.clone());
    let requested_access = normalize_access(input.access.as_deref());
    let has_requested_proxy_paths = input.proxy_paths.is_some();
    let requested_proxy_paths = normalize_proxy_paths(input.proxy_paths);
    if let Some(mut existing) =
        preview_for_scope_port(&connection, &scope_type, scope_id, target_host, input.port)?
    {
        // TS parity: reusing the same scope/host/port is allowed, but changing an existing command
        // conflicts if a different command is already registered. Missing command/access are updated.
        if let Some(command) = requested_command.as_ref() {
            if existing
                .command
                .as_deref()
                .is_some_and(|current| current != command)
            {
                anyhow::bail!("preview_port_in_use");
            }
            if existing.command.is_none() {
                existing.command = Some(command.clone());
                existing.cwd = requested_cwd.clone();
            }
        }
        if existing.access != requested_access {
            existing.access = requested_access.to_string();
        }
        if has_requested_proxy_paths {
            existing.proxy_paths = requested_proxy_paths;
        }
        existing.updated_at = timestamp();
        connection.execute(
            "update previews set command = ?, cwd = ?, access = ?, proxy_paths_json = ?, updated_at = ? where id = ?",
            params![
                existing.command,
                existing.cwd,
                existing.access,
                serde_json::to_string(&existing.proxy_paths).unwrap_or_else(|_| "[]".to_string()),
                existing.updated_at,
                existing.id
            ],
        )?;
        return Ok((existing, false));
    }
    if preview_using_port_with_connection(&connection, target_host, input.port, None)?.is_some() {
        anyhow::bail!("preview_port_in_use");
    }
    let now = timestamp();
    let record = PreviewRecord {
        id: format!("preview-{}", random_hex(16)),
        scope_type: scope_type.clone(),
        scope_id: scope_id.to_string(),
        label: input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("{scope_type}:{scope_id}:{}", input.port)),
        target_host: target_host.to_string(),
        port: input.port,
        token: random_hex(16),
        command: requested_command,
        cwd: requested_cwd,
        status: "registered".to_string(),
        access: requested_access.to_string(),
        proxy_paths: requested_proxy_paths,
        created_at: now.clone(),
        updated_at: now,
    };
    connection.execute(
        "insert into previews (id, scope_type, scope_id, label, target_host, port, token, command, cwd, status, access, proxy_paths_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &record.id,
            &record.scope_type,
            &record.scope_id,
            &record.label,
            &record.target_host,
            record.port,
            &record.token,
            &record.command,
            &record.cwd,
            &record.status,
            &record.access,
            serde_json::to_string(&record.proxy_paths).unwrap_or_else(|_| "[]".to_string()),
            &record.created_at,
            &record.updated_at,
        ],
    )?;
    Ok((record, true))
}

pub fn update(
    db: &Db,
    id: &str,
    input: super::models::UpdatePreviewRequest,
) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let Some(mut record) = get_with_connection(&connection, id)? else {
        return Ok(None);
    };
    if let Some(label) = input
        .label
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        record.label = label.to_string();
    }
    if let Some(proxy_paths) = input.proxy_paths {
        record.proxy_paths = normalize_proxy_paths(Some(proxy_paths));
    }
    record.updated_at = timestamp();
    connection.execute(
        "update previews set label = ?, proxy_paths_json = ?, updated_at = ? where id = ?",
        params![
            record.label,
            serde_json::to_string(&record.proxy_paths).unwrap_or_else(|_| "[]".to_string()),
            record.updated_at,
            record.id
        ],
    )?;
    Ok(Some(record))
}

pub fn update_access(
    db: &Db,
    id: &str,
    access: Option<&str>,
) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let Some(mut record) = get_with_connection(&connection, id)? else {
        return Ok(None);
    };
    record.access = normalize_access(access);
    record.updated_at = timestamp();
    connection.execute(
        "update previews set access = ?, updated_at = ? where id = ?",
        params![record.access, record.updated_at, record.id],
    )?;
    Ok(Some(record))
}

pub fn update_cwd(db: &Db, id: &str, cwd: &str) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let Some(mut record) = get_with_connection(&connection, id)? else {
        return Ok(None);
    };
    record.cwd = Some(cwd.to_string());
    record.updated_at = timestamp();
    connection.execute(
        "update previews set cwd = ?, updated_at = ? where id = ?",
        params![record.cwd, record.updated_at, record.id],
    )?;
    Ok(Some(record))
}

pub fn update_status(db: &Db, id: &str, status: &str) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let Some(mut record) = get_with_connection(&connection, id)? else {
        return Ok(None);
    };
    record.status = normalize_status(status).to_string();
    record.updated_at = timestamp();
    connection.execute(
        "update previews set status = ?, updated_at = ? where id = ?",
        params![record.status, record.updated_at, record.id],
    )?;
    Ok(Some(record))
}

pub fn stop(db: &Db, id: &str) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let Some(mut record) = get_with_connection(&connection, id)? else {
        return Ok(None);
    };
    record.status = "stopped".to_string();
    record.updated_at = timestamp();
    connection.execute(
        "update previews set status = ?, updated_at = ? where id = ?",
        params![record.status, record.updated_at, record.id],
    )?;
    Ok(Some(record))
}

pub fn append_logs(db: &Db, id: &str, label: &str, chunk: &str) -> anyhow::Result<()> {
    if chunk.is_empty() {
        return Ok(());
    }
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let now = timestamp();
    connection.execute(
        "
        insert into preview_logs (preview_id, label, logs, updated_at) values (?, ?, ?, ?)
        on conflict(preview_id) do update set
          label = excluded.label,
          logs = substr(preview_logs.logs || excluded.logs, -200000),
          updated_at = excluded.updated_at
        ",
        params![id, label, chunk, now],
    )?;
    Ok(())
}

pub fn logs(db: &Db, id: &str) -> anyhow::Result<Option<String>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    if get_with_connection(&connection, id)?.is_none() {
        return Ok(None);
    }
    let logs = connection
        .query_row(
            "select logs from preview_logs where preview_id = ?",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();
    Ok(Some(logs))
}

pub fn delete(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let affected = connection.execute("delete from previews where id = ?", [id])?;
    connection.execute("delete from preview_logs where preview_id = ?", [id])?;
    connection.execute(
        "delete from preview_access_requests where preview_id = ?",
        [id],
    )?;
    Ok(affected > 0)
}

fn ensure_tables(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists previews (
          id text primary key,
          scope_type text not null,
          scope_id text not null,
          label text not null,
          target_host text not null,
          port integer not null,
          token text not null,
          command text,
          cwd text,
          status text not null default 'registered',
          access text not null default 'public',
          proxy_paths_json text not null default '[]',
          created_at text not null,
          updated_at text
        );
        create index if not exists previews_scope_updated_idx on previews(scope_type, scope_id, updated_at desc, id desc);
        create table if not exists preview_logs (
          preview_id text primary key,
          label text,
          logs text not null,
          updated_at text not null
        );
        create table if not exists preview_access_requests (
          id text primary key,
          preview_id text not null,
          secret text not null,
          status text not null,
          approved_until text,
          created_at text not null,
          updated_at text not null
        );
        create index if not exists preview_access_requests_preview_status_idx on preview_access_requests(preview_id, status, created_at desc);
        update previews set updated_at = created_at where updated_at is null;
        ",
    )?;
    let columns = connection
        .prepare("pragma table_info(previews)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|column| column == "proxy_paths_json") {
        connection.execute(
            "alter table previews add column proxy_paths_json text not null default '[]'",
            [],
        )?;
    }
    Ok(())
}

fn preview_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PreviewRecord> {
    let proxy_paths_json: Option<String> = row.get(11)?;
    let created_at: String = row.get(12)?;
    let updated_at: Option<String> = row.get(13)?;
    Ok(PreviewRecord {
        id: row.get(0)?,
        scope_type: row.get(1)?,
        scope_id: row.get(2)?,
        label: row.get(3)?,
        target_host: row.get(4)?,
        port: row.get(5)?,
        token: row.get(6)?,
        command: row.get(7)?,
        cwd: row.get(8)?,
        status: row.get(9)?,
        access: row.get(10)?,
        proxy_paths: proxy_paths_from_json(proxy_paths_json.as_deref()),
        created_at: created_at.clone(),
        updated_at: updated_at.unwrap_or(created_at),
    })
}

fn get_with_connection(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<PreviewRecord>> {
    connection
        .query_row(
            &format!("{PREVIEW_SELECT} where id = ?"),
            [id],
            preview_from_row,
        )
        .optional()
        .context("failed to load preview")
}

fn preview_for_scope_port(
    connection: &rusqlite::Connection,
    scope_type: &str,
    scope_id: &str,
    target_host: &str,
    port: i64,
) -> anyhow::Result<Option<PreviewRecord>> {
    connection
        .query_row(
            &format!("{PREVIEW_SELECT} where scope_type = ? and scope_id = ? and target_host = ? and port = ? limit 1"),
            params![scope_type, scope_id, target_host, port],
            preview_from_row,
        )
        .optional()
        .context("failed to load preview")
}

pub fn preview_using_port(
    db: &Db,
    target_host: &str,
    port: i64,
    except_id: Option<&str>,
) -> anyhow::Result<Option<PreviewRecord>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    preview_using_port_with_connection(&connection, target_host, port, except_id)
}

fn preview_using_port_with_connection(
    connection: &rusqlite::Connection,
    target_host: &str,
    port: i64,
    except_id: Option<&str>,
) -> anyhow::Result<Option<PreviewRecord>> {
    let except_id = except_id.unwrap_or("");
    connection
        .query_row(
            &format!("{PREVIEW_SELECT} where target_host = ? and port = ? and id != ? and status in ('running', 'starting') limit 1"),
            params![target_host, port, except_id],
            preview_from_row,
        )
        .optional()
        .context("failed to load preview")
}

pub fn proxy_path_matches(preview: &PreviewRecord, path: &str) -> bool {
    preview.proxy_paths.iter().any(|prefix| {
        path == prefix || path.starts_with(&format!("{prefix}/"))
    })
}

fn proxy_paths_from_json(value: Option<&str>) -> Vec<String> {
    value
        .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .map(|items| normalize_proxy_paths(Some(items)))
        .unwrap_or_default()
}

fn normalize_proxy_paths(value: Option<Vec<String>>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    value
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| normalize_proxy_path(&item))
        .filter(|item| seen.insert(item.clone()))
        .collect()
}

fn normalize_proxy_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.contains("://") {
        return None;
    }
    let path = format!("/{}", trimmed.trim_start_matches('/'))
        .trim_end_matches('/')
        .to_string();
    (path.len() > 1).then_some(path)
}

fn scope_exists(
    connection: &rusqlite::Connection,
    scope_type: &str,
    scope_id: &str,
) -> anyhow::Result<bool> {
    match scope_type {
        "project" => table_has_id(connection, "projects", scope_id),
        "session" => table_has_id(connection, "sessions", scope_id),
        "folder" => Ok(std::path::Path::new(scope_id).is_dir()),
        _ => Ok(false),
    }
}

fn table_has_id(connection: &rusqlite::Connection, table: &str, id: &str) -> anyhow::Result<bool> {
    if !table_exists(connection, table)? {
        return Ok(false);
    }
    let sql = format!("select 1 from {table} where id = ? limit 1");
    Ok(connection
        .query_row(&sql, [id], |_| Ok(()))
        .optional()?
        .is_some())
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

fn normalize_scope_type(value: &str) -> anyhow::Result<String> {
    let value = value.trim();
    if matches!(value, "project" | "session" | "folder") {
        Ok(value.to_string())
    } else {
        anyhow::bail!("invalid_scope")
    }
}

fn normalize_access(value: Option<&str>) -> String {
    match value.unwrap_or("public").trim() {
        "private" => "private".to_string(),
        _ => "public".to_string(),
    }
}

fn normalize_status(value: &str) -> &str {
    match value {
        "registered" | "starting" | "running" | "stopped" | "error" => value,
        _ => "registered",
    }
}

fn valid_preview_host(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn random_hex(size: usize) -> String {
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ===========================================================================
// Preview access-requests (mirror apps/api/src/previews/access.ts).
// ===========================================================================

/// A pending/approved/denied access request for a private preview.
#[derive(Clone)]
#[allow(dead_code)] // id/created_at/updated_at are read back via SQL projections, kept for parity
pub struct PreviewAccessRequest {
    pub id: String,
    pub preview_id: String,
    pub secret: String,
    pub status: String,
    pub approved_until: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const ACCESS_REQUEST_TTL_MS: i64 = 15 * 60 * 1000;

/// Expire stale pending access requests (createdAt older than 15 minutes), mirroring
/// expirePreviewAccessRequests().
pub fn expire_access_requests(db: &Db) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let cutoff = chrono_millis_ago(ACCESS_REQUEST_TTL_MS);
    connection.execute(
        "update preview_access_requests set status = 'denied', updated_at = ? where status = 'pending' and created_at < ?",
        params![timestamp(), cutoff],
    )?;
    Ok(())
}

/// Create (or reuse a recent pending) access request. Mirrors createPreviewAccessRequest():
/// returns (id, secret, reused).
#[allow(dead_code)]
pub fn create_access_request(
    db: &Db,
    preview_id: &str,
    source_path: &str,
) -> anyhow::Result<(String, String, bool)> {
    create_access_request_inner(db, None, preview_id, source_path)
}

pub fn create_access_request_with_notification(
    state: &crate::state::AppState,
    preview_id: &str,
    source_path: &str,
) -> anyhow::Result<(String, String, bool)> {
    create_access_request_inner(&state.db, Some(state), preview_id, source_path)
}

fn create_access_request_inner(
    db: &Db,
    state: Option<&crate::state::AppState>,
    preview_id: &str,
    source_path: &str,
) -> anyhow::Result<(String, String, bool)> {
    expire_access_requests(db)?;
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let cutoff = chrono_millis_ago(ACCESS_REQUEST_TTL_MS);
    let existing = connection
        .query_row(
            "select id, secret from preview_access_requests where preview_id = ? and status = 'pending' and created_at >= ? order by created_at desc limit 1",
            params![preview_id, cutoff],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((id, secret)) = existing {
        return Ok((id, secret, true));
    }
    let id = format!("preview-access-{}", random_hex(16));
    let secret = random_hex(16);
    let now = timestamp();
    connection.execute(
        "insert into preview_access_requests (id, preview_id, secret, status, approved_until, created_at, updated_at) values (?, ?, ?, 'pending', null, ?, ?)",
        params![id, preview_id, secret, now, now],
    )?;
    if let Some(preview) = get(db, preview_id)? {
        let payload =
            serde_json::json!({ "requestId": id, "previewId": preview.id, "url": source_path });
        let details = [
            format!("preview={}", preview.label),
            format!("previewId={}", preview.id),
            format!("target={}:{}", preview.target_host, preview.port),
            format!("requestId={id}"),
            format!("url={source_path}"),
        ]
        .join("\n");
        let result = if let Some(state) = state {
            crate::api::approvals::store::create_approval_with_notification(
                state,
                "preview-access",
                "low",
                "Private preview access request",
                &format!(
                    "Allow temporary access to private preview {}.",
                    preview.label
                ),
                &details,
                &payload,
            )
        } else {
            crate::api::approvals::store::create_approval(
                db,
                "preview-access",
                "low",
                "Private preview access request",
                &format!(
                    "Allow temporary access to private preview {}.",
                    preview.label
                ),
                &details,
                &payload,
            )
        };
        let _ = result;
    }
    Ok((id, secret, false))
}

/// Fetch an access request validating preview ownership + secret. Mirrors getPreviewAccessRequest().
pub fn get_access_request(
    db: &Db,
    preview_id: &str,
    request_id: &str,
    secret: Option<&str>,
) -> anyhow::Result<Option<PreviewAccessRequest>> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let request = connection
        .query_row(
            "select id, preview_id, secret, status, approved_until, created_at, updated_at from preview_access_requests where id = ?",
            [request_id],
            |row| {
                Ok(PreviewAccessRequest {
                    id: row.get(0)?,
                    preview_id: row.get(1)?,
                    secret: row.get(2)?,
                    status: row.get(3)?,
                    approved_until: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()?;
    let Some(request) = request else {
        return Ok(None);
    };
    if request.preview_id != preview_id || request.secret != secret.unwrap_or("") {
        return Ok(None);
    }
    Ok(Some(request))
}

pub fn approve_access_request(
    db: &Db,
    request_id: &str,
    preview_id: Option<&str>,
    ttl_seconds: i64,
) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    let ttl = ttl_seconds.clamp(1, 30 * 24 * 60 * 60);
    let approved_until = (time::OffsetDateTime::now_utc() + time::Duration::seconds(ttl))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| timestamp());
    let now = timestamp();
    let changed = if let Some(preview_id) = preview_id.filter(|value| !value.is_empty()) {
        connection.execute(
            "update preview_access_requests set status = 'approved', approved_until = ?, updated_at = ? where (id = ? or (preview_id = ? and status = 'pending'))",
            params![approved_until, now, request_id, preview_id],
        )?
    } else {
        connection.execute(
            "update preview_access_requests set status = 'approved', approved_until = ?, updated_at = ? where id = ?",
            params![approved_until, now, request_id],
        )?
    };
    Ok(changed > 0)
}

pub fn deny_access_request(db: &Db, request_id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_tables(&connection)?;
    Ok(connection.execute(
        "update preview_access_requests set status = 'denied', updated_at = ? where id = ?",
        params![timestamp(), request_id],
    )? > 0)
}

fn chrono_millis_ago(millis: i64) -> String {
    let now = time::OffsetDateTime::now_utc();
    let target = now - time::Duration::milliseconds(millis);
    target
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
