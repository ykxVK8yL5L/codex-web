use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::api::common::timestamp;
use crate::db::Db;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCleanupRequest {
    pub delete_archived_approvals: Option<bool>,
    pub archived_approval_retention_days: Option<i64>,
    pub delete_approval_audit_log: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCleanupDeleted {
    pub previews: i64,
    pub preview_logs: i64,
    pub messages: i64,
    pub queued_messages: i64,
    pub task_activities: i64,
    pub project_check_runs: i64,
    pub automation_runs: i64,
    pub provider_health_checks: i64,
    pub closed_terminal_sessions: i64,
    pub archived_approvals: i64,
    pub approval_audit_log: i64,
    pub orphan_agent_sessions: i64,
    pub orphan_room_records: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCleanupUpdated {
    pub detached_sessions: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCleanupResponse {
    pub ok: bool,
    pub deleted: MaintenanceCleanupDeleted,
    pub updated: MaintenanceCleanupUpdated,
}

/// Mirrors cleanupDatabaseRedundancy in apps/api/src/index.ts at the durable-state level.
/// Runtime-only teardown (killing already-detached in-memory preview/task processes) is handled by
/// the relevant Rust runtimes when records are stopped/deleted; this maintenance path repairs the
/// SQLite state and reports actual affected-row counts.
pub fn cleanup(
    db: &Db,
    options: MaintenanceCleanupRequest,
) -> anyhow::Result<MaintenanceCleanupResponse> {
    let connection = db.open_read_write()?;

    let delete_if = |sql: &str| -> anyhow::Result<i64> {
        if !table_exists(&connection, sql_table(sql))? {
            return Ok(0);
        }
        Ok(connection.execute(sql, [])? as i64)
    };

    let messages = delete_if(
        "delete from messages where not exists (select 1 from sessions where sessions.id = messages.session_id)",
    )?;
    let preview_logs = delete_if(
        "delete from preview_logs where not exists (select 1 from previews where previews.id = preview_logs.preview_id)",
    )?;
    let queued_messages = delete_if(
        "delete from message_queue where not exists (select 1 from sessions where sessions.id = message_queue.session_id)",
    )?;
    let task_activities = delete_if(
        "delete from task_activities where not exists (select 1 from sessions where sessions.id = task_activities.session_id)",
    )?;
    let project_check_runs = delete_if(
        "delete from project_check_runs where not exists (select 1 from projects where projects.id = project_check_runs.project_id)",
    )?;
    let automation_runs = delete_if(
        "delete from automation_runs where not exists (select 1 from automations where automations.id = automation_runs.automation_id) or not exists (select 1 from sessions where sessions.id = automation_runs.session_id)",
    )?;

    let provider_health_checks = if table_exists(&connection, "provider_health_checks")?
        && table_exists(&connection, "providers")?
    {
        connection.execute(
            "delete from provider_health_checks where not exists (select 1 from providers where providers.id = provider_health_checks.provider_id)",
            [],
        )? as i64
    } else {
        0
    };

    // TS only deletes closed terminal sessions that no longer exist in the runtime map.  Rust's
    // runtime map is process-local and closed sessions are removed immediately, so deleting closed
    // DB rows is equivalent and keeps the counter real.
    let closed_terminal_sessions =
        delete_if("delete from terminal_sessions where status = 'closed'")?;

    let detached_sessions = detach_sessions_with_missing_projects(&connection, db)?;
    let previews = cleanup_orphan_previews(&connection)?;
    let orphan_agent_sessions = cleanup_orphan_agent_sessions(&connection)?;
    let orphan_room_records = cleanup_orphan_room_records(&connection)?;

    let retention_days = options
        .archived_approval_retention_days
        .unwrap_or(30)
        .clamp(0, 3650);
    let cutoff = retention_cutoff(retention_days);
    let archived_approvals = if options.delete_archived_approvals == Some(false) {
        0
    } else if table_exists(&connection, "approvals")? {
        connection.execute(
            "delete from approvals where archived_at is not null and archived_at < ?",
            [cutoff],
        )? as i64
    } else {
        0
    };
    let approval_audit_log = if options.delete_approval_audit_log == Some(true)
        && table_exists(&connection, "approvals")?
    {
        connection.execute("delete from approvals where status != 'pending'", [])? as i64
    } else {
        0
    };

    Ok(MaintenanceCleanupResponse {
        ok: true,
        deleted: MaintenanceCleanupDeleted {
            previews,
            preview_logs,
            messages,
            queued_messages,
            task_activities,
            project_check_runs,
            automation_runs,
            provider_health_checks,
            closed_terminal_sessions,
            archived_approvals,
            approval_audit_log,
            orphan_agent_sessions,
            orphan_room_records,
        },
        updated: MaintenanceCleanupUpdated { detached_sessions },
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHealthItem {
    pub session_id: String,
    pub title: String,
    pub session_status: String,
    pub run_id: Option<String>,
    pub run_status: Option<String>,
    pub pid: Option<i64>,
    pub pid_alive: bool,
    pub runner_running: Option<bool>,
    pub runner_exit_code: Option<i64>,
    pub child_pid: Option<i64>,
    pub child_pid_alive: Option<bool>,
    pub log_bytes: i64,
    pub updated_at: String,
    pub issue: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHealthResponse {
    pub ok: bool,
    pub checked_at: String,
    pub items: Vec<TaskHealthItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHealthRepairItem {
    pub session_id: String,
    pub issue: String,
    pub action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHealthRepairResponse {
    pub ok: bool,
    pub repaired: Vec<TaskHealthRepairItem>,
    pub health: TaskHealthResponse,
}

/// Mirrors listTaskHealth in apps/api/src/tasks/runs.ts using DB rows plus the per-session
/// `logs/codex.json` task meta file produced by the Rust/TS runners.
pub fn list_task_health(db: &Db) -> anyhow::Result<TaskHealthResponse> {
    let mut items = Vec::new();
    if let Some(connection) = db.open_read_only()? {
        if table_exists(&connection, "task_runs")? {
            let mut statement = connection.prepare(
                "select id, session_id, status, pid, started_at from task_runs where status = 'running' order by started_at desc, id desc limit 100",
            )?;
            let rows = statement
                .query_map([], |row| {
                    let pid: Option<i64> = row.get(3)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        pid,
                        row.get::<_, String>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (run_id, session_id, run_status, pid, started_at) in rows {
                let session = session_health_row(&connection, &session_id)?;
                let meta = read_task_meta(db, &session_id);
                let pid_alive = pid.map(process_alive).unwrap_or(false);
                let child_pid = meta.get("childPid").and_then(|value| value.as_i64());
                let child_pid_alive = child_pid.map(process_alive);
                let runner_running = meta.get("running").and_then(|value| value.as_bool());
                let runner_exit_code = meta.get("exitCode").and_then(|value| value.as_i64());
                let issue = if session.is_none() {
                    Some("session_missing".to_string())
                } else if session
                    .as_ref()
                    .is_some_and(|(_, status, _)| status != "running")
                {
                    Some("session_not_running".to_string())
                } else if runner_running == Some(false) {
                    Some("runner_finished".to_string())
                } else if !pid_alive {
                    Some("runner_pid_missing".to_string())
                } else {
                    None
                };
                let (title, session_status, updated_at) = session.unwrap_or_else(|| {
                    (
                        session_id.clone(),
                        "interrupted".to_string(),
                        started_at.clone(),
                    )
                });
                let log_bytes = task_log_bytes(db, &session_id);
                items.push(TaskHealthItem {
                    title,
                    session_id,
                    session_status,
                    run_id: Some(run_id),
                    run_status: Some(run_status),
                    pid,
                    pid_alive,
                    runner_running,
                    runner_exit_code,
                    child_pid,
                    child_pid_alive,
                    log_bytes,
                    updated_at,
                    issue,
                });
            }
        }
    }
    let ok = items.iter().all(|item| item.issue.is_none());
    Ok(TaskHealthResponse {
        ok,
        checked_at: timestamp(),
        items,
    })
}

/// Mirrors repairTaskHealth in apps/api/src/index.ts for durable DB/session state.
pub fn repair_task_health(db: &Db) -> anyhow::Result<TaskHealthRepairResponse> {
    let before = list_task_health(db)?;
    let mut repaired = Vec::new();
    let connection = db.open_read_write()?;
    let has_table = table_exists(&connection, "task_runs")?;
    for item in &before.items {
        match item.issue.as_deref() {
            Some("runner_finished") if has_table => {
                let meta = read_task_meta(db, &item.session_id);
                let exit_code = meta.get("exitCode").and_then(|value| value.as_i64());
                let status = if exit_code == Some(0) {
                    "done"
                } else {
                    "failed"
                };
                finish_running_task_run(
                    &connection,
                    &item.session_id,
                    status,
                    exit_code,
                    meta.get("error").and_then(|value| value.as_str()),
                )?;
                update_session_status(
                    &connection,
                    &item.session_id,
                    if status == "done" {
                        "completed"
                    } else {
                        "failed"
                    },
                )?;
                repaired.push(TaskHealthRepairItem {
                    session_id: item.session_id.clone(),
                    issue: "runner_finished".to_string(),
                    action: "finalized_from_runner_meta".to_string(),
                });
            }
            Some("runner_pid_missing") if has_table => {
                finish_running_task_run(
                    &connection,
                    &item.session_id,
                    "interrupted",
                    None,
                    Some("task_health_repair_runner_pid_missing"),
                )?;
                update_session_status(&connection, &item.session_id, "interrupted")?;
                repaired.push(TaskHealthRepairItem {
                    session_id: item.session_id.clone(),
                    issue: "runner_pid_missing".to_string(),
                    action: "marked_interrupted".to_string(),
                });
            }
            Some("session_not_running") if has_table => {
                finish_running_task_run(
                    &connection,
                    &item.session_id,
                    "interrupted",
                    None,
                    Some("task_health_repair_session_not_running"),
                )?;
                repaired.push(TaskHealthRepairItem {
                    session_id: item.session_id.clone(),
                    issue: "session_not_running".to_string(),
                    action: "closed_running_task_run".to_string(),
                });
            }
            Some("session_missing") if has_table => {
                finish_running_task_run(
                    &connection,
                    &item.session_id,
                    "interrupted",
                    None,
                    Some("task_health_repair_session_missing"),
                )?;
                repaired.push(TaskHealthRepairItem {
                    session_id: item.session_id.clone(),
                    issue: "session_missing".to_string(),
                    action: "closed_running_task_run".to_string(),
                });
            }
            _ => {}
        }
    }
    let health = list_task_health(db)?;
    Ok(TaskHealthRepairResponse {
        ok: true,
        repaired,
        health,
    })
}

/// Mirrors POST /api/settings/approvals/reset: delete all approval_grants.
pub fn reset_approval_grants(db: &Db) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    if !table_exists(&connection, "approval_grants")? {
        return Ok(0);
    }
    Ok(connection.execute("delete from approval_grants", [])? as i64)
}

fn detach_sessions_with_missing_projects(
    connection: &rusqlite::Connection,
    db: &Db,
) -> anyhow::Result<i64> {
    if !table_exists(connection, "sessions")? || !table_exists(connection, "projects")? {
        return Ok(0);
    }
    let mut statement = connection.prepare(
        "select id from sessions where project_id is not null and project_id != '' and not exists (select 1 from projects where projects.id = sessions.project_id)",
    )?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut changed = 0;
    for id in ids {
        let workspace = db.data_dir.join("sessions").join(&id).join("workspace");
        let _ = std::fs::create_dir_all(&workspace);
        changed += connection.execute(
            "update sessions set project_id = null, kind = 'scratch', workspace_path = ?, updated_at = ? where id = ?",
            rusqlite::params![workspace.display().to_string(), timestamp(), id],
        )? as i64;
        if table_exists(connection, "previews")? {
            connection.execute("delete from preview_logs where preview_id in (select id from previews where scope_type = 'session' and scope_id = ?)", [&id])?;
            connection.execute("delete from preview_access_requests where preview_id in (select id from previews where scope_type = 'session' and scope_id = ?)", [&id])?;
            connection.execute(
                "delete from previews where scope_type = 'session' and scope_id = ?",
                [&id],
            )?;
        }
    }
    Ok(changed)
}

fn cleanup_orphan_previews(connection: &rusqlite::Connection) -> anyhow::Result<i64> {
    if !table_exists(connection, "previews")? {
        return Ok(0);
    }
    let mut statement = connection.prepare("select id, scope_type, scope_id from previews")?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut deleted = 0;
    for (id, scope_type, scope_id) in rows {
        let has_scope = match scope_type.as_str() {
            "project" => table_has_id(connection, "projects", &scope_id)?,
            "session" => table_has_id(connection, "sessions", &scope_id)?,
            "folder" => std::path::Path::new(&scope_id).is_dir(),
            _ => false,
        };
        if !has_scope {
            connection.execute("delete from preview_logs where preview_id = ?", [&id])?;
            connection.execute(
                "delete from preview_access_requests where preview_id = ?",
                [&id],
            )?;
            deleted += connection.execute("delete from previews where id = ?", [&id])? as i64;
        }
    }
    Ok(deleted)
}

fn cleanup_orphan_agent_sessions(connection: &rusqlite::Connection) -> anyhow::Result<i64> {
    if !table_exists(connection, "sessions")? || !table_exists(connection, "rooms")? {
        return Ok(0);
    }
    let mut statement = connection.prepare(
        "select id from sessions where conversation_type = 'agent' and room_id is not null and not exists (select 1 from rooms where rooms.id = sessions.room_id)",
    )?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut deleted = 0;
    for id in ids {
        delete_session_rows(connection, &id)?;
        deleted += connection.execute("delete from sessions where id = ?", [&id])? as i64;
    }
    Ok(deleted)
}

fn cleanup_orphan_room_records(connection: &rusqlite::Connection) -> anyhow::Result<i64> {
    let mut total = 0;
    if table_exists(connection, "rooms")? && table_exists(connection, "sessions")? {
        let mut statement = connection.prepare("select id from rooms where session_id is null or not exists (select 1 from sessions where sessions.id = rooms.session_id)")?;
        let room_ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for room_id in room_ids {
            if table_exists(connection, "sessions")? {
                let mut children = connection.prepare(
                    "select id from sessions where conversation_type = 'agent' and room_id = ?",
                )?;
                for child in children
                    .query_map([&room_id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?
                {
                    delete_session_rows(connection, &child)?;
                    total +=
                        connection.execute("delete from sessions where id = ?", [&child])? as i64;
                }
            }
            total += delete_room_database_rows(connection, &room_id)?;
            total += connection.execute("delete from rooms where id = ?", [&room_id])? as i64;
        }
    }
    for table in [
        "room_agents",
        "room_events",
        "room_tasks",
        "room_artifacts",
        "room_handoffs",
        "room_decisions",
        "room_schedules",
        "room_run_merges",
        "room_agent_threads",
        "agent_runs",
    ] {
        if table_exists(connection, table)? && table_exists(connection, "rooms")? {
            total += connection.execute(&format!("delete from {table} where not exists (select 1 from rooms where rooms.id = {table}.room_id)"), [])? as i64;
        }
    }
    if table_exists(connection, "execution_contexts")? && table_exists(connection, "rooms")? {
        total += connection.execute("delete from execution_contexts where room_id is not null and not exists (select 1 from rooms where rooms.id = execution_contexts.room_id)", [])? as i64;
    }
    Ok(total)
}

fn delete_session_rows(connection: &rusqlite::Connection, session_id: &str) -> anyhow::Result<i64> {
    let mut total = 0;
    for (table, column) in [
        ("messages", "session_id"),
        ("message_queue", "session_id"),
        ("message_cards", "session_id"),
        ("message_card_dismissals", "session_id"),
        ("agent_sessions", "session_id"),
        ("task_runs", "session_id"),
        ("task_activities", "session_id"),
        ("execution_contexts", "session_id"),
        ("agent_runs", "session_id"),
    ] {
        if table_exists(connection, table)? {
            total += connection.execute(
                &format!("delete from {table} where {column} = ?"),
                [session_id],
            )? as i64;
        }
    }
    Ok(total)
}

fn delete_room_database_rows(
    connection: &rusqlite::Connection,
    room_id: &str,
) -> anyhow::Result<i64> {
    let mut total = 0;
    let room_task_ids = if table_exists(connection, "room_tasks")? {
        let mut statement = connection.prepare("select id from room_tasks where room_id = ?")?;
        let rows = statement
            .query_map([room_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        Vec::new()
    };
    if table_exists(connection, "notification_ephemeral_rules")? {
        for task_id in &room_task_ids {
            total += connection.execute(
                "delete from notification_ephemeral_rules where scope_type = 'room_task' and scope_id = ?",
                [task_id],
            )? as i64;
        }
    }
    for table in [
        "room_agents",
        "room_events",
        "room_tasks",
        "room_artifacts",
        "room_handoffs",
        "room_decisions",
        "room_schedules",
        "room_run_merges",
        "room_agent_threads",
        "agent_runs",
    ] {
        if table_exists(connection, table)? {
            total += connection
                .execute(&format!("delete from {table} where room_id = ?"), [room_id])?
                as i64;
        }
    }
    if table_exists(connection, "execution_contexts")? {
        total += connection.execute(
            "delete from execution_contexts where room_id = ?",
            [room_id],
        )? as i64;
    }
    Ok(total)
}

fn table_has_id(connection: &rusqlite::Connection, table: &str, id: &str) -> anyhow::Result<bool> {
    if !table_exists(connection, table)? {
        return Ok(false);
    }
    Ok(connection
        .query_row(
            &format!("select 1 from {table} where id = ? limit 1"),
            [id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn session_health_row(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> anyhow::Result<Option<(String, String, String)>> {
    if !table_exists(connection, "sessions")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select title, status, updated_at from sessions where id = ?",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?)
}

fn read_task_meta(db: &Db, session_id: &str) -> serde_json::Value {
    let path = db
        .data_dir
        .join("sessions")
        .join(session_id)
        .join("logs")
        .join("codex.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn task_log_bytes(db: &Db, session_id: &str) -> i64 {
    let path = db
        .data_dir
        .join("sessions")
        .join(session_id)
        .join("logs")
        .join("codex.ndjson");
    std::fs::metadata(path)
        .map(|meta| meta.len() as i64)
        .unwrap_or(0)
}

fn finish_running_task_run(
    connection: &rusqlite::Connection,
    session_id: &str,
    status: &str,
    exit_code: Option<i64>,
    reason: Option<&str>,
) -> anyhow::Result<i64> {
    Ok(connection.execute(
        "update task_runs set status = ?, ended_at = ?, exit_code = ?, interrupted_reason = coalesce(?, interrupted_reason) where session_id = ? and status = 'running'",
        rusqlite::params![status, timestamp(), exit_code, reason, session_id],
    )? as i64)
}

fn update_session_status(
    connection: &rusqlite::Connection,
    session_id: &str,
    status: &str,
) -> anyhow::Result<i64> {
    if !table_exists(connection, "sessions")? {
        return Ok(0);
    }
    Ok(connection.execute(
        "update sessions set status = ?, updated_at = ? where id = ?",
        rusqlite::params![status, timestamp(), session_id],
    )? as i64)
}

fn retention_cutoff(retention_days: i64) -> String {
    let now = time::OffsetDateTime::now_utc();
    let cutoff = now - time::Duration::seconds(retention_days * 24 * 60 * 60);
    cutoff
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn process_alive(pid: i64) -> bool {
    if pid <= 0 {
        return false;
    }
    // `kill -0 <pid>` checks existence without sending a signal; exit 0 means the process exists.
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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

/// Best-effort extraction of the primary table name from a `delete from <table> ...` statement.
fn sql_table(sql: &str) -> &str {
    sql.trim_start_matches("delete from ")
        .split_whitespace()
        .next()
        .unwrap_or("")
}
