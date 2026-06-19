use rusqlite::{params, OptionalExtension};

use crate::db::Db;

use crate::api::common::PageResponse;

use super::models::{AutomationInput, AutomationRunSummary, AutomationSummary};

pub fn list(db: &Db) -> anyhow::Result<Vec<AutomationSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "automations")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select id, name, project_id, session_id, provider_id, model, action_type, prompt, command, cwd, command_timeout_seconds, retry_max, retry_delay_minutes, overlap_policy, schedule, status, created_at, updated_at from automations order by updated_at desc",
    )?;
    let items = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            Ok(AutomationSummary {
                running_runs: count_runs(&connection, &id, "running").unwrap_or(0),
                queued_runs: count_runs(&connection, &id, "queued").unwrap_or(0),
                last_run_status: last_run_field(&connection, &id, "status").ok().flatten(),
                last_run_at: last_run_at(&connection, &id).ok().flatten(),
                next_run_at: next_run_at(
                    &connection,
                    &id,
                    row.get::<_, String>(14)?.as_str(),
                    row.get::<_, String>(15)?.as_str(),
                )
                .ok()
                .flatten(),
                id,
                name: row.get(1)?,
                project_id: row.get(2)?,
                session_id: row.get(3)?,
                provider_id: row.get(4)?,
                model: row.get(5)?,
                action_type: row.get(6)?,
                prompt: row.get(7)?,
                command: row.get(8)?,
                cwd: row.get(9)?,
                command_timeout_seconds: row.get(10)?,
                retry_max: row.get::<_, Option<i64>>(11)?.unwrap_or(0),
                retry_delay_minutes: row.get::<_, Option<i64>>(12)?.unwrap_or(5),
                overlap_policy: row.get(13)?,
                schedule: row.get(14)?,
                status: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn get(db: &Db, id: &str) -> anyhow::Result<Option<AutomationSummary>> {
    Ok(list(db)?.into_iter().find(|item| item.id == id))
}

pub fn create(db: &Db, input: AutomationInput) -> anyhow::Result<AutomationSummary> {
    let name = input.name.as_deref().unwrap_or("").trim();
    let schedule = input.schedule.as_deref().unwrap_or("").trim();
    if name.is_empty() || schedule.is_empty() {
        anyhow::bail!("invalid_automation");
    }
    let action_type = sanitize_action_type(input.action_type.as_deref());
    let prompt = clean(input.prompt)
        .or(input.command.clone().and_then(clean_optional))
        .unwrap_or_default();
    let command = input.command.and_then(clean_optional);
    if action_type == "agent" && prompt.trim().is_empty() {
        anyhow::bail!("invalid_automation_prompt");
    }
    if action_type == "command" && command.as_deref().unwrap_or("").trim().is_empty() {
        anyhow::bail!("invalid_automation_command");
    }
    if !valid_schedule(schedule) {
        anyhow::bail!("invalid_automation_schedule");
    }
    let now = crate::api::common::timestamp();
    let automation = AutomationSummary {
        id: format!("automation-{}", random_hex(16)),
        name: name.to_string(),
        project_id: input.project_id.and_then(clean_optional),
        provider_id: input.provider_id.and_then(clean_optional),
        model: input.model.and_then(clean_optional),
        action_type: action_type.clone(),
        prompt,
        command,
        cwd: input.cwd.and_then(clean_optional),
        command_timeout_seconds: if action_type == "command" {
            sanitize_timeout(input.command_timeout_seconds)
        } else {
            None
        },
        retry_max: sanitize_retry_max(input.retry_max),
        retry_delay_minutes: sanitize_retry_delay(input.retry_delay_minutes),
        overlap_policy: sanitize_overlap(input.overlap_policy.as_deref()),
        session_id: None,
        running_runs: 0,
        queued_runs: 0,
        last_run_status: None,
        last_run_at: None,
        next_run_at: None,
        schedule: schedule.to_string(),
        status: "active".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    upsert(db, &automation)?;
    get(db, &automation.id)?.ok_or_else(|| anyhow::anyhow!("automation_create_failed"))
}

pub fn update(
    db: &Db,
    id: &str,
    input: AutomationInput,
) -> anyhow::Result<Option<AutomationSummary>> {
    let Some(mut automation) = get(db, id)? else {
        return Ok(None);
    };
    if let Some(name) = input.name.and_then(clean_optional) {
        automation.name = name;
    }
    if input.project_id.is_some() {
        automation.project_id = input.project_id.and_then(clean_optional);
    }
    if input.provider_id.is_some() {
        automation.provider_id = input.provider_id.and_then(clean_optional);
    }
    if input.model.is_some() {
        automation.model = input.model.and_then(clean_optional);
    }
    if input.action_type.is_some() {
        automation.action_type = sanitize_action_type(input.action_type.as_deref());
    }
    if let Some(prompt) = input.prompt {
        let prompt = prompt.trim().to_string();
        if !prompt.is_empty() {
            automation.prompt = prompt;
        }
    }
    if input.command.is_some() {
        automation.command = input.command.and_then(clean_optional);
    }
    if input.cwd.is_some() {
        automation.cwd = input.cwd.and_then(clean_optional);
    }
    if input.command_timeout_seconds.is_some() {
        automation.command_timeout_seconds = if automation.action_type == "command" {
            sanitize_timeout(input.command_timeout_seconds)
        } else {
            None
        };
    }
    if input.retry_max.is_some() {
        automation.retry_max = sanitize_retry_max(input.retry_max);
    }
    if input.retry_delay_minutes.is_some() {
        automation.retry_delay_minutes = sanitize_retry_delay(input.retry_delay_minutes);
    }
    if input.overlap_policy.is_some() {
        automation.overlap_policy = sanitize_overlap(input.overlap_policy.as_deref());
    }
    if let Some(schedule) = input.schedule {
        if !valid_schedule(&schedule) {
            anyhow::bail!("invalid_automation_schedule");
        }
        automation.schedule = schedule.trim().to_string();
    }
    if let Some(status) = input.status {
        automation.status = if status == "paused" {
            "paused".to_string()
        } else {
            "active".to_string()
        };
    }
    if automation.action_type != "command" {
        automation.command_timeout_seconds = None;
    }
    if automation.action_type == "agent" && automation.prompt.trim().is_empty() {
        anyhow::bail!("invalid_automation_prompt");
    }
    if automation.action_type == "command"
        && automation
            .command
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        anyhow::bail!("invalid_automation_command");
    }
    automation.updated_at = crate::api::common::timestamp();
    upsert(db, &automation)?;
    get(db, id)
}

pub fn delete(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let deleted = connection.execute("delete from automations where id = ?", [id])?;
    if deleted == 0 {
        return Ok(false);
    }
    if table_exists(&connection, "automation_runs")? {
        let _ = connection.execute("delete from automation_runs where automation_id = ?", [id]);
    }
    if table_exists(&connection, "notification_ephemeral_rules")? {
        let _ = connection.execute("delete from notification_ephemeral_rules where scope_type = 'automation' and scope_id = ?", [id]);
    }
    Ok(true)
}

pub fn runs(
    db: &Db,
    automation_id: &str,
    limit: usize,
    status: Option<&str>,
    cursor: Option<&crate::api::common::PageCursor>,
) -> anyhow::Result<PageResponse<AutomationRunSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(PageResponse {
            items: Vec::new(),
            next_cursor: None,
            has_more: false,
        });
    };
    if !table_exists(&connection, "automation_runs")? {
        return Ok(PageResponse {
            items: Vec::new(),
            next_cursor: None,
            has_more: false,
        });
    }
    let mut statement = connection.prepare("select id, automation_id, session_id, status, exit_code, started_at, finished_at from automation_runs where automation_id = ? order by started_at desc, id desc")?;
    let mut rows = statement
        .query_map([automation_id], row_to_run)?
        .collect::<Result<Vec<_>, _>>()?;
    let status = status.filter(|value| valid_run_status(value));
    if let Some(status) = status {
        rows.retain(|run| run.status == status);
    }
    if let Some(cursor) = cursor {
        rows.retain(|run| {
            run.started_at < cursor.sort_value
                || (run.started_at == cursor.sort_value && run.id < cursor.id)
        });
    }
    let has_more = rows.len() > limit;
    let items = rows.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = if has_more {
        items
            .last()
            .and_then(|item| crate::api::common::encode_page_cursor(&item.started_at, &item.id))
    } else {
        None
    };
    Ok(PageResponse {
        items,
        next_cursor,
        has_more,
    })
}

pub fn clear_finished_runs(db: &Db, automation_id: &str) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection.execute("delete from automation_runs where automation_id = ? and status in ('done', 'failed', 'stopped', 'skipped', 'canceled')", [automation_id])? as i64)
}

pub fn cancel_queued_runs(db: &Db, automation_id: &str) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    let now = crate::api::common::timestamp();
    Ok(connection.execute("update automation_runs set status = 'canceled', finished_at = ? where automation_id = ? and status = 'queued'", (&now, automation_id))? as i64)
}

pub fn create_run(
    db: &Db,
    automation_id: &str,
    session_id: &str,
    status: &str,
) -> anyhow::Result<AutomationRunSummary> {
    create_run_at(
        db,
        automation_id,
        session_id,
        status,
        &crate::api::common::timestamp(),
        None,
    )
}

pub fn create_run_at(
    db: &Db,
    automation_id: &str,
    session_id: &str,
    status: &str,
    started_at: &str,
    finished_at: Option<&str>,
) -> anyhow::Result<AutomationRunSummary> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    let run = AutomationRunSummary {
        id: format!("automation-run-{}", random_hex(16)),
        automation_id: automation_id.to_string(),
        session_id: session_id.to_string(),
        status: sanitize_run_status(status).to_string(),
        exit_code: None,
        started_at: started_at.to_string(),
        finished_at: finished_at.map(str::to_string),
    };
    connection.execute(
        "insert into automation_runs (id, automation_id, session_id, status, exit_code, started_at, finished_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![&run.id, &run.automation_id, &run.session_id, &run.status, run.exit_code, &run.started_at, run.finished_at.as_deref()],
    )?;
    Ok(run)
}

pub fn start_queued_run(
    db: &Db,
    run_id: &str,
    session_id: &str,
) -> anyhow::Result<Option<AutomationRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    connection.execute(
        "update automation_runs set status = 'running', session_id = ?, started_at = ?, finished_at = null, exit_code = null where id = ? and status = 'queued'",
        params![session_id, crate::api::common::timestamp(), run_id],
    )?;
    get_run(&connection, run_id)
}

pub fn finish_run(
    db: &Db,
    run_id: &str,
    status: &str,
    exit_code: Option<i64>,
) -> anyhow::Result<Option<AutomationRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    connection.execute(
        "update automation_runs set status = ?, exit_code = ?, finished_at = ? where id = ?",
        params![
            sanitize_run_status(status),
            exit_code,
            crate::api::common::timestamp(),
            run_id
        ],
    )?;
    get_run(&connection, run_id)
}

pub fn bind_session(db: &Db, automation_id: &str, session_id: &str) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update automations set session_id = ?, updated_at = ? where id = ?",
        params![session_id, crate::api::common::timestamp(), automation_id],
    )?;
    Ok(())
}

pub fn running_runs(db: &Db, automation_id: &str) -> anyhow::Result<Vec<AutomationRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    let mut statement = connection.prepare("select id, automation_id, session_id, status, exit_code, started_at, finished_at from automation_runs where automation_id = ? and status = 'running' order by started_at desc")?;
    let rows = statement
        .query_map([automation_id], row_to_run)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn has_active_run(db: &Db, automation_id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection
        .query_row(
            "select 1 from automation_runs where automation_id = ? and status in ('queued', 'running') limit 1",
            [automation_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub fn stop_running_runs(db: &Db, automation_id: &str) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection.execute(
        "update automation_runs set status = 'stopped', finished_at = ? where automation_id = ? and status = 'running'",
        params![crate::api::common::timestamp(), automation_id],
    )? as i64)
}

pub fn latest_running_run(
    db: &Db,
    automation_id: &str,
) -> anyhow::Result<Option<AutomationRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection.query_row(
        "select id, automation_id, session_id, status, exit_code, started_at, finished_at from automation_runs where automation_id = ? and status = 'running' order by started_at desc, id desc limit 1",
        [automation_id],
        row_to_run,
    ).optional()?)
}

pub fn next_due_queued_run(
    db: &Db,
    automation_id: &str,
    now: &str,
) -> anyhow::Result<Option<AutomationRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection.query_row(
        "select id, automation_id, session_id, status, exit_code, started_at, finished_at from automation_runs where automation_id = ? and status = 'queued' and started_at <= ? order by started_at asc, id asc limit 1",
        (automation_id, now),
        row_to_run,
    ).optional()?)
}

pub fn automation_ids_with_due_queued_runs(db: &Db, now: &str) -> anyhow::Result<Vec<String>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    let mut statement = connection.prepare("select distinct automation_id from automation_runs where status = 'queued' and started_at <= ?")?;
    let rows = statement
        .query_map([now], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn running_run_for_session(
    db: &Db,
    session_id: &str,
) -> anyhow::Result<Option<AutomationRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection.query_row(
        "select id, automation_id, session_id, status, exit_code, started_at, finished_at from automation_runs where session_id = ? and status = 'running' order by started_at desc, id desc limit 1",
        [session_id],
        row_to_run,
    ).optional()?)
}

pub fn claim_startup_run(db: &Db, automation_id: &str, startup_key: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_startup_claim_schema(&connection)?;
    let changed = connection.execute(
        "insert or ignore into automation_startup_claims (automation_id, startup_key, claimed_at) values (?, ?, ?)",
        params![automation_id, startup_key, crate::api::common::timestamp()],
    )?;
    Ok(changed > 0)
}

fn upsert(db: &Db, automation: &AutomationSummary) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "
        insert into automations (id, name, project_id, provider_id, model, action_type, prompt, command, cwd, command_timeout_seconds, retry_max, retry_delay_minutes, overlap_policy, schedule, status, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          project_id = excluded.project_id,
          provider_id = excluded.provider_id,
          model = excluded.model,
          action_type = excluded.action_type,
          prompt = excluded.prompt,
          command = excluded.command,
          cwd = excluded.cwd,
          command_timeout_seconds = excluded.command_timeout_seconds,
          retry_max = excluded.retry_max,
          retry_delay_minutes = excluded.retry_delay_minutes,
          overlap_policy = excluded.overlap_policy,
          schedule = excluded.schedule,
          status = excluded.status,
          updated_at = excluded.updated_at
        ",
        params![
            &automation.id,
            &automation.name,
            automation.project_id.as_deref(),
            automation.provider_id.as_deref(),
            automation.model.as_deref(),
            &automation.action_type,
            &automation.prompt,
            automation.command.as_deref(),
            automation.cwd.as_deref(),
            automation.command_timeout_seconds,
            automation.retry_max,
            automation.retry_delay_minutes,
            &automation.overlap_policy,
            &automation.schedule,
            &automation.status,
            &automation.created_at,
            &automation.updated_at,
        ],
    )?;
    Ok(())
}

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists automations (
          id text primary key,
          name text not null,
          project_id text,
          session_id text,
          provider_id text,
          model text,
          action_type text not null default 'agent',
          prompt text not null,
          command text,
          cwd text,
          command_timeout_seconds integer,
          retry_max integer not null default 0,
          retry_delay_minutes integer not null default 5,
          overlap_policy text not null default 'queue',
          schedule text not null,
          status text not null,
          created_at text not null,
          updated_at text not null
        );
        ",
    )?;
    Ok(())
}

fn ensure_runs_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists automation_runs (
          id text primary key,
          automation_id text not null,
          session_id text not null,
          status text not null,
          exit_code integer,
          started_at text not null,
          finished_at text
        );
        ",
    )?;
    Ok(())
}

fn ensure_startup_claim_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists automation_startup_claims (
          automation_id text not null,
          startup_key text not null,
          claimed_at text not null,
          primary key (automation_id, startup_key)
        );
        ",
    )?;
    Ok(())
}

fn get_run(
    connection: &rusqlite::Connection,
    run_id: &str,
) -> anyhow::Result<Option<AutomationRunSummary>> {
    Ok(connection.query_row("select id, automation_id, session_id, status, exit_code, started_at, finished_at from automation_runs where id = ?", [run_id], row_to_run).optional()?)
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

fn count_runs(
    connection: &rusqlite::Connection,
    automation_id: &str,
    status: &str,
) -> anyhow::Result<i64> {
    if !table_exists(connection, "automation_runs")? {
        return Ok(0);
    }
    Ok(connection.query_row(
        "select count(*) from automation_runs where automation_id = ? and status = ?",
        (automation_id, status),
        |row| row.get(0),
    )?)
}

fn last_run_field(
    connection: &rusqlite::Connection,
    automation_id: &str,
    field: &str,
) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "automation_runs")? {
        return Ok(None);
    }
    let sql = format!("select {field} from automation_runs where automation_id = ? order by started_at desc, id desc limit 1");
    Ok(connection
        .query_row(&sql, [automation_id], |row| row.get(0))
        .optional()?)
}

fn last_run_at(
    connection: &rusqlite::Connection,
    automation_id: &str,
) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "automation_runs")? {
        return Ok(None);
    }
    Ok(connection.query_row(
        "select coalesce(finished_at, started_at) from automation_runs where automation_id = ? order by started_at desc, id desc limit 1",
        [automation_id],
        |row| row.get(0),
    ).optional()?)
}

fn next_run_at(
    connection: &rusqlite::Connection,
    automation_id: &str,
    schedule: &str,
    status: &str,
) -> anyhow::Result<Option<String>> {
    let automation = AutomationSummary {
        id: automation_id.to_string(),
        name: String::new(),
        project_id: None,
        provider_id: None,
        model: None,
        action_type: "agent".to_string(),
        prompt: String::new(),
        command: None,
        cwd: None,
        command_timeout_seconds: None,
        retry_max: 0,
        retry_delay_minutes: 5,
        overlap_policy: "queue".to_string(),
        session_id: None,
        running_runs: 0,
        queued_runs: 0,
        last_run_status: None,
        last_run_at: None,
        next_run_at: None,
        schedule: schedule.to_string(),
        status: if status == "paused" {
            "paused".to_string()
        } else {
            "active".to_string()
        },
        created_at: String::new(),
        updated_at: String::new(),
    };
    if let Some(next) = compute_next_run_at(&automation, time::OffsetDateTime::now_utc()) {
        return Ok(Some(next));
    }
    if !table_exists(connection, "automation_runs")? {
        return Ok(None);
    }
    Ok(connection.query_row(
        "select started_at from automation_runs where automation_id = ? and status = 'queued' order by started_at asc, id asc limit 1",
        [automation_id],
        |row| row.get(0),
    ).optional()?)
}

fn row_to_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRunSummary> {
    let status: String = row.get(3)?;
    Ok(AutomationRunSummary {
        id: row.get(0)?,
        automation_id: row.get(1)?,
        session_id: row.get(2)?,
        status: if valid_run_status(&status) {
            status
        } else {
            "running".to_string()
        },
        exit_code: row.get(4)?,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
    })
}

fn clean(value: Option<String>) -> Option<String> {
    value.and_then(clean_optional)
}

fn clean_optional(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn sanitize_action_type(value: Option<&str>) -> String {
    if value == Some("command") {
        "command".to_string()
    } else {
        "agent".to_string()
    }
}

fn sanitize_retry_max(value: Option<i64>) -> i64 {
    value.unwrap_or(0).clamp(0, 10)
}

fn sanitize_retry_delay(value: Option<i64>) -> i64 {
    value.unwrap_or(5).clamp(1, 24 * 60)
}

fn sanitize_overlap(value: Option<&str>) -> String {
    if value == Some("skip") {
        "skip".to_string()
    } else {
        "queue".to_string()
    }
}

fn sanitize_timeout(value: Option<i64>) -> Option<i64> {
    value
        .filter(|item| *item > 0)
        .map(|item| item.clamp(1, 24 * 60 * 60))
}

fn valid_run_status(value: &str) -> bool {
    matches!(
        value,
        "queued" | "running" | "done" | "failed" | "stopped" | "skipped" | "canceled"
    )
}

fn sanitize_run_status(value: &str) -> &str {
    if valid_run_status(value) {
        value
    } else {
        "running"
    }
}

pub(crate) fn valid_schedule(value: &str) -> bool {
    let value = value.trim().to_lowercase();
    value == "manual"
        || value == "startup"
        || value == "hourly"
        || valid_daily(&value)
        || valid_weekly(&value)
        || value
            .strip_prefix("cron ")
            .map(|expr| expr.split_whitespace().count() == 5)
            .unwrap_or(false)
}

fn valid_daily(value: &str) -> bool {
    let Some(time) = value.strip_prefix("daily ") else {
        return false;
    };
    valid_hhmm(time)
}

fn valid_weekly(value: &str) -> bool {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    parts.len() == 3
        && parts[0] == "weekly"
        && parts[1]
            .parse::<i64>()
            .map(|day| (0..=7).contains(&day))
            .unwrap_or(false)
        && valid_hhmm(parts[2])
}

fn valid_hhmm(value: &str) -> bool {
    let Some((hour, minute)) = value.split_once(':') else {
        return false;
    };
    hour.parse::<i64>()
        .map(|value| (0..=23).contains(&value))
        .unwrap_or(false)
        && minute
            .parse::<i64>()
            .map(|value| (0..=59).contains(&value))
            .unwrap_or(false)
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn should_run_now(
    db: &Db,
    automation: &AutomationSummary,
    now: time::OffsetDateTime,
) -> anyhow::Result<bool> {
    if automation.status != "active" {
        return Ok(false);
    }
    let schedule = automation.schedule.trim().to_lowercase();
    if schedule.is_empty() || schedule == "manual" || schedule == "startup" {
        return Ok(false);
    }
    let minute_key = now.format(&time::format_description::well_known::Rfc3339)?[..16].to_string();
    if ran_in_minute(db, &automation.id, &minute_key)? {
        return Ok(false);
    }
    let hour = now.hour() as i64;
    let minute = now.minute() as i64;
    if schedule == "hourly" {
        return Ok(minute == 0);
    }
    if let Some((h, m)) = parse_daily(&schedule) {
        return Ok(hour == h && minute == m);
    }
    if let Some((day, h, m)) = parse_weekly(&schedule) {
        return Ok(now.weekday().number_days_from_sunday() as i64 == day % 7
            && hour == h
            && minute == m);
    }
    if let Some(expr) = schedule.strip_prefix("cron ") {
        return Ok(cron_matches(expr, now));
    }
    Ok(false)
}

pub(crate) fn compute_next_run_at(
    automation: &AutomationSummary,
    from: time::OffsetDateTime,
) -> Option<String> {
    if automation.status != "active" {
        return None;
    }
    let schedule = automation.schedule.trim().to_lowercase();
    if schedule == "manual" || schedule == "startup" || schedule.is_empty() {
        return None;
    }
    let mut next =
        from.replace_second(0).ok()?.replace_nanosecond(0).ok()? + time::Duration::minutes(1);
    if schedule == "hourly" {
        next = next.replace_minute(0).ok()?;
        if next <= from {
            next += time::Duration::hours(1);
        }
        return next
            .format(&time::format_description::well_known::Rfc3339)
            .ok();
    }
    if let Some((h, m)) = parse_daily(&schedule) {
        next = next
            .replace_hour(h as u8)
            .ok()?
            .replace_minute(m as u8)
            .ok()?;
        if next <= from {
            next += time::Duration::days(1);
        }
        return next
            .format(&time::format_description::well_known::Rfc3339)
            .ok();
    }
    if let Some((day, h, m)) = parse_weekly(&schedule) {
        next = next
            .replace_hour(h as u8)
            .ok()?
            .replace_minute(m as u8)
            .ok()?;
        let current = next.weekday().number_days_from_sunday() as i64;
        let delta = (day % 7 - current + 7) % 7;
        next += time::Duration::days(delta);
        if next <= from {
            next += time::Duration::days(7);
        }
        return next
            .format(&time::format_description::well_known::Rfc3339)
            .ok();
    }
    if let Some(expr) = schedule.strip_prefix("cron ") {
        let mut probe = next;
        for _ in 0..(366 * 24 * 60) {
            if cron_matches(expr, probe) {
                return probe
                    .format(&time::format_description::well_known::Rfc3339)
                    .ok();
            }
            probe += time::Duration::minutes(1);
        }
    }
    None
}

fn ran_in_minute(db: &Db, automation_id: &str, minute_key: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_runs_schema(&connection)?;
    Ok(connection.query_row(
        "select 1 from automation_runs where automation_id = ? and substr(started_at, 1, 16) = ? limit 1",
        (automation_id, minute_key),
        |_| Ok(()),
    ).optional()?.is_some())
}

fn parse_daily(value: &str) -> Option<(i64, i64)> {
    let time = value.strip_prefix("daily ")?;
    let (h, m) = time.split_once(':')?;
    Some((h.parse().ok()?, m.parse().ok()?))
}

fn parse_weekly(value: &str) -> Option<(i64, i64, i64)> {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 3 || parts[0] != "weekly" {
        return None;
    }
    let (h, m) = parts[2].split_once(':')?;
    Some((parts[1].parse().ok()?, h.parse().ok()?, m.parse().ok()?))
}

fn cron_matches(expression: &str, now: time::OffsetDateTime) -> bool {
    let fields = expression.split_whitespace().collect::<Vec<_>>();
    fields.len() == 5
        && cron_field_matches(fields[0], now.minute() as i64, 0, 59)
        && cron_field_matches(fields[1], now.hour() as i64, 0, 23)
        && cron_field_matches(fields[2], now.day() as i64, 1, 31)
        && cron_field_matches(fields[3], now.month() as i64, 1, 12)
        && cron_field_matches(
            fields[4],
            now.weekday().number_days_from_sunday() as i64,
            0,
            7,
        )
}

fn cron_field_matches(field: &str, value: i64, min: i64, max: i64) -> bool {
    field.split(',').any(|part| {
        let item = part.trim();
        if item.is_empty() {
            return false;
        }
        if item == "*" {
            return true;
        }
        if let Some(step) = item.strip_prefix("*/").and_then(|v| v.parse::<i64>().ok()) {
            return step > 0 && (value - min) % step == 0;
        }
        if let Some((start, end)) = item.split_once('-') {
            if let (Ok(start), Ok(end)) = (start.parse::<i64>(), end.parse::<i64>()) {
                return start <= value && value <= end;
            }
        }
        item.parse::<i64>()
            .map(|exact| exact >= min && exact <= max && exact == value)
            .unwrap_or(false)
    })
}
