use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::db::Db;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunSummary {
    pub id: String,
    pub session_id: String,
    pub status: String,
    pub pid: Option<i64>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i64>,
    pub stop_requested: bool,
    pub interrupted_reason: Option<String>,
    pub prompt_chars: Option<i64>,
    pub prompt_hash: Option<String>,
    pub context_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRunRequest {
    pub session_id: String,
    pub pid: Option<i64>,
    pub prompt_chars: Option<i64>,
    pub prompt_hash: Option<String>,
    pub context_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishTaskRunRequest {
    pub status: String,
    pub exit_code: Option<i64>,
    pub interrupted_reason: Option<String>,
}

pub fn create(db: &Db, input: CreateTaskRunRequest) -> anyhow::Result<TaskRunSummary> {
    let session_id = input.session_id.trim();
    if session_id.is_empty() {
        anyhow::bail!("session_id_required");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let id = format!("task-run-{}", random_hex(16));
    let started_at = crate::api::common::timestamp();
    connection.execute(
        "insert into task_runs (id, session_id, status, pid, started_at, stop_requested, prompt_chars, prompt_hash, context_path) values (?, ?, 'running', ?, ?, 0, ?, ?, ?)",
        (
            &id,
            session_id,
            input.pid,
            &started_at,
            input.prompt_chars,
            input.prompt_hash.as_deref(),
            input.context_path.as_deref(),
        ),
    )?;
    get(db, &id)?.ok_or_else(|| anyhow::anyhow!("task_run_create_failed"))
}

pub fn update_pid(db: &Db, run_id: &str, pid: Option<i64>) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update task_runs set pid = ? where id = ? and status = 'running'",
        (pid, run_id),
    )?;
    Ok(())
}

pub fn finish_running_for_session(
    db: &Db,
    session_id: &str,
    status: &str,
    exit_code: Option<i64>,
    reason: Option<&str>,
) -> anyhow::Result<usize> {
    let status = sanitize_status(status)?;
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute(
        "update task_runs set status = ?, ended_at = ?, exit_code = ?, interrupted_reason = coalesce(?, interrupted_reason) where session_id = ? and status = 'running'",
        (status, crate::api::common::timestamp(), exit_code, reason, session_id),
    )?)
}

pub fn list(
    db: &Db,
    status: Option<&str>,
    limit: usize,
    cursor: Option<&crate::api::common::PageCursor>,
) -> anyhow::Result<Vec<TaskRunSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "task_runs")? {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 100) as i64;
    let status = status.filter(|value| !value.trim().is_empty());
    match (status, cursor) {
        (Some(status), Some(cursor)) => {
            let mut statement = connection.prepare("select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs where status = ? and (started_at < ? or (started_at = ? and id < ?)) order by started_at desc, id desc limit ?")?;
            let items = statement
                .query_map(
                    (
                        status,
                        &cursor.sort_value,
                        &cursor.sort_value,
                        &cursor.id,
                        limit,
                    ),
                    run_from_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(items)
        }
        (Some(status), None) => {
            let mut statement = connection.prepare("select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs where status = ? order by started_at desc, id desc limit ?")?;
            let items = statement
                .query_map((status, limit), run_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(items)
        }
        (None, Some(cursor)) => {
            let mut statement = connection.prepare("select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs where (started_at < ? or (started_at = ? and id < ?)) order by started_at desc, id desc limit ?")?;
            let items = statement
                .query_map(
                    (&cursor.sort_value, &cursor.sort_value, &cursor.id, limit),
                    run_from_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(items)
        }
        (None, None) => {
            let mut statement = connection.prepare("select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs order by started_at desc, id desc limit ?")?;
            let items = statement
                .query_map([limit], run_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(items)
        }
    }
}

pub fn list_for_session(
    db: &Db,
    session_id: &str,
    limit: usize,
    cursor: Option<&crate::api::common::PageCursor>,
) -> anyhow::Result<Vec<TaskRunSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "task_runs")? {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 100) as i64;
    if let Some(cursor) = cursor {
        let mut statement = connection.prepare("select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs where session_id = ? and (started_at < ? or (started_at = ? and id < ?)) order by started_at desc, id desc limit ?")?;
        let items = statement
            .query_map(
                (
                    session_id,
                    &cursor.sort_value,
                    &cursor.sort_value,
                    &cursor.id,
                    limit,
                ),
                run_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    } else {
        let mut statement = connection.prepare("select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs where session_id = ? order by started_at desc, id desc limit ?")?;
        let items = statement
            .query_map((session_id, limit), run_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }
}

pub fn finish(
    db: &Db,
    run_id: &str,
    input: FinishTaskRunRequest,
) -> anyhow::Result<Option<TaskRunSummary>> {
    let status = sanitize_status(&input.status)?;
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let changed = connection.execute(
        "update task_runs set status = ?, ended_at = ?, exit_code = ?, interrupted_reason = coalesce(?, interrupted_reason) where id = ?",
        (status, crate::api::common::timestamp(), input.exit_code, input.interrupted_reason.as_deref(), run_id),
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get(db, run_id)
}

pub fn mark_stop_requested(db: &Db, session_id: &str) -> anyhow::Result<usize> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute(
        "update task_runs set stop_requested = 1 where session_id = ? and status = 'running'",
        [session_id],
    )?)
}

fn get(db: &Db, run_id: &str) -> anyhow::Result<Option<TaskRunSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "task_runs")? {
        return Ok(None);
    }
    connection
        .query_row(
            "select id, session_id, status, pid, started_at, ended_at, exit_code, stop_requested, interrupted_reason, prompt_chars, prompt_hash, context_path from task_runs where id = ?",
            [run_id],
            run_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRunSummary> {
    Ok(TaskRunSummary {
        id: row.get(0)?,
        session_id: row.get(1)?,
        status: row.get(2)?,
        pid: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        exit_code: row.get(6)?,
        stop_requested: row.get::<_, i64>(7)? != 0,
        interrupted_reason: row.get(8)?,
        prompt_chars: row.get(9)?,
        prompt_hash: row.get(10)?,
        context_path: row.get(11)?,
    })
}

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists task_runs (
          id text primary key,
          session_id text not null,
          status text not null,
          pid integer,
          started_at text not null,
          ended_at text,
          exit_code integer,
          stop_requested integer not null default 0,
          interrupted_reason text,
          prompt_chars integer,
          prompt_hash text,
          context_path text
        );
        create index if not exists task_runs_session_started_idx on task_runs(session_id, started_at desc, id desc);
        create index if not exists task_runs_status_started_idx on task_runs(status, started_at desc, id desc);
        ",
    )?;
    for (column, kind) in [
        ("prompt_chars", "integer"),
        ("prompt_hash", "text"),
        ("context_path", "text"),
    ] {
        ensure_column(connection, "task_runs", column, kind)?;
    }
    Ok(())
}

fn ensure_column(
    connection: &rusqlite::Connection,
    table: &str,
    column: &str,
    kind: &str,
) -> anyhow::Result<()> {
    let mut statement = connection.prepare(&format!("pragma table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|item| item == column) {
        connection.execute_batch(&format!("alter table {table} add column {column} {kind}"))?;
    }
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

fn sanitize_status(status: &str) -> anyhow::Result<&str> {
    match status {
        "done" => Ok("done"),
        "failed" => Ok("failed"),
        "stopped" => Ok("stopped"),
        "interrupted" => Ok("interrupted"),
        "running" => Ok("running"),
        _ => anyhow::bail!("invalid_task_run_status"),
    }
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
