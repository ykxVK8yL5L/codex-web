use rusqlite::OptionalExtension;

use crate::db::Db;
use crate::state::AppState;

use super::models::ApprovalSummary;

pub fn list(
    db: &Db,
    status: Option<&str>,
    archived: bool,
    limit: usize,
) -> anyhow::Result<Vec<ApprovalSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "approvals")? {
        return Ok(Vec::new());
    }
    // Archived tab shows archived rows; otherwise only non-archived (optionally filtered by status).
    let archived_clause = if archived {
        "archived_at is not null"
    } else {
        "archived_at is null"
    };
    let status_clause = if status.is_some() {
        "and status = ?2"
    } else {
        ""
    };
    let sql = format!(
        "select id, action_type, risk, status, title, description, details, payload, created_at, resolved_at, archived_at from approvals where {archived_clause} {status_clause} order by created_at desc, id desc limit ?1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = if let Some(status) = status {
        statement
            .query_map((limit as i64, status), approval_from_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map([limit as i64], approval_from_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn deny(db: &Db, id: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    let approval = get(db, id)?;
    let resolved = resolve(db, id, "denied")?;
    if let Some(approval) = approval.filter(|item| item.action_type == "preview-access") {
        if let Some(request_id) = approval
            .related
            .as_ref()
            .and_then(|v| v.get("requestId"))
            .and_then(|v| v.as_str())
        {
            let _ = crate::api::previews::store::deny_access_request(db, request_id);
        }
    }
    Ok(resolved)
}

/// Create (or dedupe) a pending approval. Mirrors `createApproval` in auth/approvals.ts:
/// deduplicates on (status='pending', action_type, payload), inserts a new pending row otherwise.
pub fn create_approval(
    db: &Db,
    action_type: &str,
    risk: &str,
    title: &str,
    description: &str,
    details: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<ApprovalSummary> {
    create_approval_inner(
        db,
        action_type,
        risk,
        title,
        description,
        details,
        payload,
        true,
    )
    .map(|item| item.0)
}

pub fn create_approval_with_notification(
    state: &AppState,
    action_type: &str,
    risk: &str,
    title: &str,
    description: &str,
    details: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<ApprovalSummary> {
    let (approval, created) = create_approval_inner(
        &state.db,
        action_type,
        risk,
        title,
        description,
        details,
        payload,
        false,
    )?;
    if created {
        crate::api::notifications::runtime::emit_external_notification(
            state.clone(),
            crate::api::notifications::runtime::NotificationEvent {
                event_type: "needs_approval".to_string(),
                severity: if matches!(risk, "critical" | "high") {
                    "error".to_string()
                } else {
                    "warning".to_string()
                },
                title: title.to_string(),
                message: if description.trim().is_empty() {
                    details.to_string()
                } else {
                    description.to_string()
                },
                source_type: Some("approval".to_string()),
                source_id: Some(approval.id.clone()),
                metadata: serde_json::json!({ "actionType": action_type, "risk": risk }),
            },
        );
    }
    Ok(approval)
}

fn create_approval_inner(
    db: &Db,
    action_type: &str,
    risk: &str,
    title: &str,
    description: &str,
    details: &str,
    payload: &serde_json::Value,
    create_app_notification: bool,
) -> anyhow::Result<(ApprovalSummary, bool)> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let payload_text = serde_json::to_string(payload)?;
    if let Some(existing) = connection
        .query_row(
            "select id, action_type, risk, status, title, description, details, payload, created_at, resolved_at, archived_at from approvals where status = 'pending' and action_type = ? and payload = ? order by created_at desc limit 1",
            rusqlite::params![action_type, payload_text],
            approval_from_row,
        )
        .optional()?
    {
        return Ok((existing, false));
    }
    let id = crate::api::common::timestamp();
    let id = format!(
        "approval-{}-{}",
        id.replace([':', '.', '-', 'T', 'Z'], ""),
        rand::RngCore::next_u32(&mut rand::thread_rng())
    );
    let created_at = crate::api::common::timestamp();
    connection.execute(
        "insert into approvals (id, action_type, risk, status, title, description, details, payload, created_at, resolved_at) values (?, ?, ?, 'pending', ?, ?, ?, ?, ?, null)",
        rusqlite::params![id, action_type, risk, title, description, details, payload_text, created_at],
    )?;
    let approval = get(db, &id)?.ok_or_else(|| anyhow::anyhow!("approval_create_failed"))?;
    if create_app_notification {
        let _ = crate::api::app_notifications::store::create(
            db,
            crate::api::app_notifications::models::CreateAppNotificationRequest {
                event_type: "needs_approval".to_string(),
                severity: Some(match risk {
                    "critical" | "high" => "warning".to_string(),
                    _ => "info".to_string(),
                }),
                title: title.to_string(),
                message: description.to_string(),
                source_type: Some("approval".to_string()),
                source_id: Some(approval.id.clone()),
                metadata: Some(
                    serde_json::json!({ "approvalId": approval.id, "actionType": action_type, "risk": risk }),
                ),
            },
        );
    }
    Ok((approval, true))
}

/// Shared pending-approval validation used by the async approval handler, which performs
/// action-specific side effects before resolving the row.
pub fn pending(db: &Db, id: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    let Some(approval) = get(db, id)? else {
        return Ok(None);
    };
    if approval.status != "pending" {
        anyhow::bail!("approval_already_resolved");
    }
    Ok(Some(approval))
}

/// Returns the current codex runtime settings as a JSON value for the approve response payload.
pub fn approved_codex_runtime(db: &Db) -> anyhow::Result<serde_json::Value> {
    let settings = crate::api::settings::current_codex_runtime(db)?;
    Ok(serde_json::to_value(settings)?)
}

/// Mirrors saveApprovalGrant (auth/approvals.ts). grant_key uses a stable JSON of the payload.
pub fn save_grant(
    db: &Db,
    approval: &ApprovalSummary,
    expires_at: Option<String>,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_grants_schema(&connection)?;
    let now = crate::api::common::timestamp();
    let grant_key = approval
        .related
        .as_ref()
        .map(|value| approval_grant_key(&approval.action_type, value))
        .unwrap_or_else(|| stable_json(&serde_json::json!({})));
    connection.execute(
        "insert into approval_grants (id, action_type, grant_key, title, details, expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(action_type, grant_key) do update set title = excluded.title, details = excluded.details, expires_at = excluded.expires_at, created_at = excluded.created_at",
        (
            format!("approval-grant-{}", crate::api::common::timestamp()),
            &approval.action_type,
            grant_key,
            &approval.title,
            &approval.details,
            expires_at,
            now,
        ),
    )?;
    Ok(())
}

pub fn list_grants(
    db: &Db,
    limit: usize,
) -> anyhow::Result<Vec<super::models::ApprovalGrantSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "approval_grants")? {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare("select id, action_type, title, details, created_at, expires_at from approval_grants order by created_at desc, id desc limit ?")?;
    let rows = statement
        .query_map([limit as i64], |row| {
            Ok(super::models::ApprovalGrantSummary {
                id: row.get(0)?,
                action_type: row.get(1)?,
                title: row.get(2)?,
                details: row.get(3)?,
                created_at: row.get(4)?,
                expires_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete_grant(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_grants_schema(&connection)?;
    Ok(connection.execute("delete from approval_grants where id = ?", [id])? > 0)
}

pub fn approval_always_allowed(
    db: &Db,
    action_type: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<bool> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(false);
    };
    if !table_exists(&connection, "approval_grants")? {
        return Ok(false);
    }
    let grant_key = approval_grant_key(action_type, payload);
    Ok(connection
        .query_row(
            "select 1 from approval_grants where action_type = ? and grant_key = ? and (expires_at is null or expires_at > ?) limit 1",
            rusqlite::params![action_type, grant_key, crate::api::common::timestamp()],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn approval_grant_key(action_type: &str, payload: &serde_json::Value) -> String {
    if action_type == "preview-command-run" {
        return stable_json(&serde_json::json!({
            "command": payload.get("command").cloned().unwrap_or(serde_json::Value::Null),
            "cwd": payload.get("cwd").cloned().unwrap_or(serde_json::Value::Null),
            "targetHost": payload.get("targetHost").cloned().unwrap_or(serde_json::Value::Null),
            "port": payload.get("port").cloned().unwrap_or(serde_json::Value::Null),
            "scopeType": payload.get("scopeType").cloned().unwrap_or(serde_json::Value::Null),
            "scopeId": payload.get("scopeId").cloned().unwrap_or(serde_json::Value::Null),
        }));
    }
    if action_type == "project-git-operation" {
        return stable_json(&serde_json::json!({
            "projectId": payload.get("projectId").cloned().unwrap_or(serde_json::Value::Null),
            "operation": payload.get("operation").cloned().unwrap_or(serde_json::Value::Null),
        }));
    }
    if action_type == "project-delete-files" {
        return stable_json(&serde_json::json!({
            "projectId": payload.get("projectId").cloned().unwrap_or(serde_json::Value::Null),
            "deleteFiles": true,
        }));
    }
    if action_type == "room-run-merge" {
        return stable_json(&serde_json::json!({
            "roomId": payload.get("roomId").cloned().unwrap_or(serde_json::Value::Null),
        }));
    }
    stable_json(payload)
}

/// Mirrors stableJson in auth/approvals.ts: keys sorted, used to derive grant keys.
fn stable_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Array(items) => format!(
            "[{}]",
            items.iter().map(stable_json).collect::<Vec<_>>().join(",")
        ),
        serde_json::Value::Object(map) => {
            let mut entries: Vec<(&String, &serde_json::Value)> = map.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            let body = entries
                .into_iter()
                .map(|(key, item)| {
                    format!(
                        "{}:{}",
                        serde_json::Value::String(key.clone()),
                        stable_json(item)
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
        other => other.to_string(),
    }
}

fn ensure_grants_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists approval_grants (
          id text primary key,
          action_type text not null,
          grant_key text not null,
          title text not null,
          details text not null,
          expires_at text,
          created_at text not null,
          unique(action_type, grant_key)
        );
        ",
    )?;
    Ok(())
}

pub fn archive(db: &Db, id: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    let Some(approval) = get(db, id)? else {
        return Ok(None);
    };
    if approval.status == "pending" {
        anyhow::bail!("approval_pending_cannot_archive");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update approvals set archived_at = coalesce(archived_at, ?) where id = ?",
        (crate::api::common::timestamp(), id),
    )?;
    get(db, id)
}

pub fn restore(db: &Db, id: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let changed =
        connection.execute("update approvals set archived_at = null where id = ?", [id])?;
    if changed == 0 {
        return Ok(None);
    }
    get(db, id)
}

pub fn resolve_approved(db: &Db, id: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    resolve(db, id, "approved")
}

fn resolve(db: &Db, id: &str, status: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    let Some(approval) = get(db, id)? else {
        return Ok(None);
    };
    if approval.status != "pending" {
        anyhow::bail!("approval_already_resolved");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update approvals set status = ?, resolved_at = coalesce(resolved_at, ?) where id = ?",
        (status, crate::api::common::timestamp(), id),
    )?;
    get(db, id)
}

fn get(db: &Db, id: &str) -> anyhow::Result<Option<ApprovalSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "approvals")? {
        return Ok(None);
    }
    connection
        .query_row(
            "select id, action_type, risk, status, title, description, details, payload, created_at, resolved_at, archived_at from approvals where id = ?",
            [id],
            approval_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn approval_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovalSummary> {
    let payload: String = row.get(7)?;
    Ok(ApprovalSummary {
        id: row.get(0)?,
        action_type: row.get(1)?,
        risk: row.get(2)?,
        status: row.get(3)?,
        title: row.get(4)?,
        description: row.get(5)?,
        details: row.get(6)?,
        related: serde_json::from_str(&payload).ok(),
        created_at: row.get(8)?,
        resolved_at: row.get(9)?,
        archived_at: row.get(10)?,
    })
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

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists approvals (
          id text primary key,
          action_type text not null,
          risk text not null,
          status text not null,
          title text not null,
          description text not null,
          details text not null,
          payload text not null,
          created_at text not null,
          resolved_at text,
          archived_at text
        );
        create index if not exists approvals_status_created_idx on approvals(status, created_at desc, id desc);
        ",
    )?;
    Ok(())
}
