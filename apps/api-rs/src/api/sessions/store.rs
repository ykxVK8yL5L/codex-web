use std::{fs, path::PathBuf};

use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{
    CreateSessionRequest, SessionRuntimeUpdate, SessionSummary, UpdateSessionRequest,
};

pub fn list_sessions(
    db: &Db,
    include_automations: bool,
    include_agent_children: bool,
) -> anyhow::Result<Vec<SessionSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "sessions")? {
        return Ok(Vec::new());
    }
    let automation_session_ids = automation_session_ids(&connection)?;
    let mut statement = connection.prepare(
        "select id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at from sessions order by updated_at desc",
    )?;
    let sessions = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let conversation_type =
                normalize_conversation_type(row.get::<_, Option<String>>(2)?.as_deref());
            Ok(SessionSummary {
                direct_agent_id: direct_agent_id(&connection, &id).ok().flatten(),
                id: id.clone(),
                kind: row.get(1)?,
                conversation_type,
                room_id: row.get(3)?,
                title: row.get(4)?,
                project_id: row.get(5)?,
                workspace_path: row.get(6)?,
                provider_id: row.get(7)?,
                model: row.get(8)?,
                codex_session_id: row.get(9)?,
                notifications_enabled: row.get::<_, Option<i64>>(10)?.unwrap_or(1) != 0,
                show_message_usage: bool_override(row.get::<_, Option<i64>>(11)?),
                status: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                goal: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut session| {
            if automation_session_ids.contains(&session.id) {
                session.conversation_type = "automation".to_string();
            }
            session
        })
        .filter(|session| {
            include_agent_children
                || !(session.conversation_type == "agent" && session.room_id.is_some())
        })
        .filter(|session| {
            include_automations
                || session.conversation_type != "automation"
                || !automation_session_ids.contains(&session.id)
        })
        .collect();
    Ok(sessions)
}

pub fn get_session(db: &Db, id: &str) -> anyhow::Result<Option<SessionSummary>> {
    Ok(list_sessions(db, true, true)?
        .into_iter()
        .find(|session| session.id == id))
}

pub fn create_session(db: &Db, input: CreateSessionRequest) -> anyhow::Result<SessionSummary> {
    let title = input.title.trim();
    if title.is_empty() {
        anyhow::bail!("invalid_session");
    }
    let connection = db.open_read_write()?;
    ensure_session_schema(&connection)?;
    let project = match input
        .project_id
        .as_deref()
        .filter(|value| !value.trim().is_empty() && *value != "scratch")
    {
        Some(project_id) => Some(
            read_project(&connection, project_id)?
                .ok_or_else(|| anyhow::anyhow!("project_not_found"))?,
        ),
        None => None,
    };
    let id = format!("task-{}", random_hex(16));
    let now = crate::api::common::timestamp();
    let kind = if project.is_some() {
        "project"
    } else {
        "scratch"
    };
    let conversation_type = normalize_conversation_type(input.conversation_type.as_deref());
    let workspace_path = project
        .as_ref()
        .and_then(|project| project.workspace_path.clone())
        .unwrap_or_else(|| ensure_scratch_session_workspace(db, &id));
    connection.execute(
        "insert into sessions (id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, null, null, null, 1, null, 'paused', ?, ?)",
        (
            &id,
            kind,
            &conversation_type,
            input.room_id.as_deref(),
            title,
            project.as_ref().map(|project| project.id.as_str()),
            &workspace_path,
            &now,
            &now,
        ),
    )?;
    if let Some(goal) = input.goal.as_ref() {
        if let Some(text) = goal
            .text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            create_session_goal(
                &connection,
                &id,
                if conversation_type == "agent" {
                    "agent_session"
                } else {
                    "session"
                },
                text,
                &goal.metadata,
                &now,
            )?;
        }
    }
    get_session(db, &id)?.ok_or_else(|| anyhow::anyhow!("session_create_failed"))
}

pub fn update_session(
    db: &Db,
    id: &str,
    input: UpdateSessionRequest,
) -> anyhow::Result<Option<SessionSummary>> {
    let Some(mut session) = get_session(db, id)? else {
        return Ok(None);
    };
    if let Some(title) = input.title {
        let title = title.trim();
        if !title.is_empty() {
            session.title = title.to_string();
        }
    }
    if let Some(enabled) = input.notifications_enabled {
        session.notifications_enabled = enabled;
    }
    if let Some(show) = input.show_message_usage {
        session.show_message_usage = show;
    }
    let now = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_session_schema(&connection)?;
    connection.execute(
        "update sessions set title = ?, notifications_enabled = ?, show_message_usage = ?, updated_at = ? where id = ?",
        (
            &session.title,
            if session.notifications_enabled { 1 } else { 0 },
            session.show_message_usage.map(|value| if value { 1 } else { 0 }),
            &now,
            id,
        ),
    )?;
    get_session(db, id)
}

pub fn update_runtime(
    db: &Db,
    id: &str,
    input: SessionRuntimeUpdate,
) -> anyhow::Result<Option<SessionSummary>> {
    let Some(mut session) = get_session(db, id)? else {
        return Ok(None);
    };
    if let Some(provider_id) = input.provider_id {
        session.provider_id = provider_id;
    }
    if let Some(workspace_path) = input
        .workspace_path
        .filter(|value| !value.trim().is_empty())
    {
        session.workspace_path = workspace_path;
    }
    if let Some(model) = input.model {
        session.model = model;
    }
    if let Some(codex_session_id) = input.codex_session_id {
        session.codex_session_id = codex_session_id;
    }
    if let Some(status) = input.status.filter(|value| !value.trim().is_empty()) {
        session.status = status;
    }
    let now = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_session_schema(&connection)?;
    connection.execute(
        "update sessions set workspace_path = ?, provider_id = ?, model = ?, codex_session_id = ?, status = ?, updated_at = ? where id = ?",
        (
            &session.workspace_path,
            session.provider_id.as_deref(),
            session.model.as_deref(),
            session.codex_session_id.as_deref(),
            &session.status,
            &now,
            id,
        ),
    )?;
    get_session(db, id)
}

pub fn delete_session(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_session_schema(&connection)?;
    let task_run_ids = if table_exists(&connection, "task_runs")? {
        let mut statement = connection.prepare("select id from task_runs where session_id = ?")?;
        let rows = statement
            .query_map([id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        Vec::new()
    };
    let deleted = connection.execute("delete from sessions where id = ?", [id])?;
    if deleted == 0 {
        return Ok(false);
    }
    if table_exists(&connection, "notification_ephemeral_rules")? {
        let _ = connection.execute(
            "delete from notification_ephemeral_rules where scope_type = 'session' and scope_id = ?",
            [id],
        );
        for task_run_id in &task_run_ids {
            let _ = connection.execute(
                "delete from notification_ephemeral_rules where scope_type = 'task' and scope_id = ?",
                [task_run_id],
            );
        }
    }
    for table in [
        "messages",
        "message_queue",
        "message_cards",
        "message_card_dismissals",
        "agent_sessions",
        "agent_runs",
        "task_runs",
        "task_activities",
        "execution_contexts",
        "session_compactions",
        "message_cards",
        "message_card_dismissals",
    ] {
        if table_exists(&connection, table)? {
            let sql = format!("delete from {table} where session_id = ?");
            let _ = connection.execute(&sql, [id]);
        }
    }
    // TS deleteSessionDatabaseRows also deletes previews scoped to the session and goals owned by
    // this session / agent_session. Keep this here so storage cleanup does not leave DB-only orphans.
    if table_exists(&connection, "previews")? {
        let _ = connection.execute(
            "delete from previews where scope_type = 'session' and scope_id = ?",
            [id],
        );
    }
    for owner_type in ["session", "agent_session"] {
        if table_exists(&connection, "goals")? {
            let goal_ids = {
                let mut stmt = connection
                    .prepare("select id from goals where owner_type = ? and owner_id = ?")?;
                let rows = stmt.query_map((owner_type, id), |row| row.get::<_, String>(0))?;
                let collected = rows.collect::<Result<Vec<_>, _>>()?;
                collected
            };
            for goal_id in goal_ids {
                for table in [
                    "goal_events",
                    "goal_proposals",
                    "goal_focuses",
                    "goal_items",
                ] {
                    if table_exists(&connection, table)? {
                        let _ = connection.execute(
                            &format!("delete from {table} where goal_id = ?"),
                            [&goal_id],
                        );
                    }
                }
                let _ = connection.execute("delete from goals where id = ?", [&goal_id]);
            }
        }
    }
    Ok(true)
}

fn create_session_goal(
    connection: &rusqlite::Connection,
    owner_id: &str,
    owner_type: &str,
    text: &str,
    metadata: &serde_json::Value,
    now: &str,
) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists goals (
          id text primary key,
          owner_type text not null,
          owner_id text not null,
          text text not null,
          status text not null,
          metadata text,
          created_by text,
          created_at text not null,
          updated_at text not null
        );
        create index if not exists goals_owner_idx on goals(owner_type, owner_id);
        ",
    )?;
    let id = format!("goal-{}", random_hex(16));
    connection.execute(
        "insert into goals (id, owner_type, owner_id, text, status, metadata, created_by, created_at, updated_at) values (?, ?, ?, ?, 'active', ?, 'user', ?, ?)",
        (&id, owner_type, owner_id, text, metadata.to_string(), now, now),
    )?;
    Ok(())
}

fn automation_session_ids(
    connection: &rusqlite::Connection,
) -> anyhow::Result<std::collections::HashSet<String>> {
    let mut ids = std::collections::HashSet::new();
    if table_exists(connection, "automation_runs")? {
        let mut statement = connection.prepare("select distinct session_id from automation_runs where session_id is not null and session_id != ''")?;
        for row in statement.query_map([], |row| row.get::<_, String>(0))? {
            ids.insert(row?);
        }
    }
    if table_exists(connection, "automations")? {
        let mut statement = connection.prepare(
            "select session_id from automations where session_id is not null and session_id != ''",
        )?;
        for row in statement.query_map([], |row| row.get::<_, String>(0))? {
            ids.insert(row?);
        }
    }
    Ok(ids)
}

fn direct_agent_id(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "agent_sessions")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select agent_id from agent_sessions where session_id = ? limit 1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?)
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
        connection.execute(&format!("alter table {table} add column {column} {kind}"), [])?;
    }
    Ok(())
}

fn ensure_session_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists sessions (
          id text primary key,
          kind text not null,
          conversation_type text not null default 'codex',
          room_id text,
          title text not null,
          project_id text,
          workspace_path text,
          provider_id text,
          model text,
          codex_session_id text,
          notifications_enabled integer not null default 1,
          show_message_usage integer,
          status text not null,
          created_at text,
          updated_at text not null
        );
        create index if not exists sessions_project_updated_idx on sessions(project_id, updated_at desc, id desc);
        create index if not exists sessions_status_updated_idx on sessions(status, updated_at desc, id desc);
        ",
    )?;
    ensure_column(connection, "sessions", "show_message_usage", "integer")?;
    relax_show_message_usage_column(connection)?;
    Ok(())
}

fn bool_override(value: Option<i64>) -> Option<bool> {
    value.map(|item| item != 0)
}

fn relax_show_message_usage_column(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    let mut statement = connection.prepare("pragma table_info(sessions)")?;
    let columns = statement
        .query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|(name, notnull)| name == "show_message_usage" && *notnull != 0) {
        return Ok(());
    }
    connection.execute_batch(
        "
        create table if not exists sessions_next (
          id text primary key,
          kind text not null,
          conversation_type text not null default 'codex',
          room_id text,
          title text not null,
          project_id text,
          workspace_path text,
          provider_id text,
          model text,
          codex_session_id text,
          notifications_enabled integer not null default 1,
          show_message_usage integer,
          status text not null,
          created_at text,
          updated_at text not null
        );
        insert into sessions_next (
          id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id,
          model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at
        )
        select
          id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id,
          model, codex_session_id, notifications_enabled, case when show_message_usage = 1 then 1 else null end,
          status, created_at, updated_at
        from sessions;
        drop table sessions;
        alter table sessions_next rename to sessions;
        create index if not exists sessions_project_updated_idx on sessions(project_id, updated_at desc, id desc);
        create index if not exists sessions_status_updated_idx on sessions(status, updated_at desc, id desc);
        ",
    )?;
    Ok(())
}

fn normalize_conversation_type(value: Option<&str>) -> String {
    match value {
        Some("agent") => "agent",
        Some("room") => "room",
        Some("codex") => "codex",
        Some("automation") => "automation",
        _ => "codex",
    }
    .to_string()
}

struct ProjectRow {
    id: String,
    workspace_path: Option<String>,
}

fn read_project(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> anyhow::Result<Option<ProjectRow>> {
    if !table_exists(connection, "projects")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select id, workspace_path from projects where id = ? limit 1",
            [project_id],
            |row| {
                Ok(Some(ProjectRow {
                    id: row.get(0)?,
                    workspace_path: row.get(1)?,
                }))
            },
        )
        .optional()?
        .flatten())
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn scratch_session_workspace_path(db: &Db, session_id: &str) -> PathBuf {
    db.data_dir
        .join("sessions")
        .join(session_id)
        .join("workspace")
}

fn ensure_scratch_session_workspace(db: &Db, session_id: &str) -> String {
    let path = scratch_session_workspace_path(db, session_id);
    let _ = fs::create_dir_all(&path);
    let _ = ensure_git_repository_sync(&path);
    path.display().to_string()
}

fn ensure_git_repository_sync(path: &PathBuf) -> anyhow::Result<()> {
    if path.join(".git").exists() {
        return Ok(());
    }
    let output = std::process::Command::new("git")
        .arg("init")
        .current_dir(path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}
