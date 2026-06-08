use std::{fs, path::PathBuf};

use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::{
    api::sessions::{models::SessionSummary, store},
    db::Db,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTaskDetail {
    pub session: SessionSummary,
    pub messages: Vec<TaskMessage>,
    pub output: String,
    pub exit_code: Option<i64>,
    pub error_summary: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogResponse {
    pub session_id: String,
    pub log: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub reply_to_message_id: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextFileSummary {
    pub name: String,
    pub bytes: u64,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextResponse {
    pub session_id: String,
    pub files: Vec<TaskContextFileSummary>,
    pub active_context_pack: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextFileResponse {
    pub session_id: String,
    pub name: String,
    pub content: String,
    pub updated_at: String,
}

pub fn detail(db: &Db, session_id: &str) -> anyhow::Result<Option<CodexTaskDetail>> {
    let Some(session) = store::get_session(db, session_id)? else {
        return Ok(None);
    };
    let messages = list_messages(db, session_id, 100)?;
    let output = read_task_log_content(db, &session);
    let exit_code = read_task_exit_code(db, session_id);
    let error_summary = exit_code
        .filter(|code| *code != 0)
        .map(|_| error_summary(&output));
    Ok(Some(CodexTaskDetail {
        session,
        messages,
        output,
        exit_code,
        error_summary,
    }))
}

pub fn log(db: &Db, session_id: &str, max_bytes: usize) -> anyhow::Result<Option<TaskLogResponse>> {
    let Some(session) = store::get_session(db, session_id)? else {
        return Ok(None);
    };
    let mut log = read_task_log_content(db, &session);
    if log.len() > max_bytes {
        log = log[log.len() - max_bytes..].to_string();
    }
    Ok(Some(TaskLogResponse {
        session_id: session_id.to_string(),
        log,
    }))
}

pub fn context_files(db: &Db, session_id: &str) -> anyhow::Result<Option<TaskContextResponse>> {
    if store::get_session(db, session_id)?.is_none() {
        return Ok(None);
    }
    let root = session_context_path(db, session_id);
    let mut files = Vec::new();
    if root.exists() {
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains('/') || name.contains('\\') {
                continue;
            }
            let metadata = entry.metadata()?;
            if metadata.is_file() {
                files.push(TaskContextFileSummary {
                    name,
                    bytes: metadata.len(),
                    updated_at: metadata
                        .modified()
                        .ok()
                        .map(system_time_string)
                        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
                });
            }
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    let active_context_pack = if files.iter().any(|file| file.name == "context-pack.md") {
        Some(root.join("context-pack.md").display().to_string())
    } else {
        None
    };
    Ok(Some(TaskContextResponse {
        session_id: session_id.to_string(),
        files,
        active_context_pack,
    }))
}

pub fn context_file(
    db: &Db,
    session_id: &str,
    name: &str,
) -> anyhow::Result<Option<TaskContextFileResponse>> {
    if store::get_session(db, session_id)?.is_none() {
        return Ok(None);
    }
    if !name
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        anyhow::bail!("invalid_context_file");
    }
    let path = session_context_path(db, session_id).join(name);
    let metadata = fs::metadata(&path).map_err(|_| anyhow::anyhow!("context_file_not_found"))?;
    if !metadata.is_file() {
        anyhow::bail!("context_file_not_found");
    }
    Ok(Some(TaskContextFileResponse {
        session_id: session_id.to_string(),
        name: name.to_string(),
        content: fs::read_to_string(&path)?,
        updated_at: metadata
            .modified()
            .ok()
            .map(system_time_string)
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
    }))
}

pub fn read_task_log_for_session(db: &Db, session_id: &str) -> String {
    match store::get_session(db, session_id) {
        Ok(Some(session)) => read_task_log_content(db, &session),
        _ => String::new(),
    }
}

fn read_task_log_content(db: &Db, session: &SessionSummary) -> String {
    let path = task_log_path(db, &session.id);
    if path.exists() {
        return fs::read_to_string(path).unwrap_or_default();
    }
    let legacy = db
        .data_dir
        .join("task-logs")
        .join(format!("{}.log", session.id));
    fs::read_to_string(legacy).unwrap_or_default()
}

fn list_messages(db: &Db, session_id: &str, limit: usize) -> anyhow::Result<Vec<TaskMessage>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "messages")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, role, content, reply_to_message_id, created_at from messages where session_id = ? order by created_at desc, id desc limit ?")?;
    let mut items = statement
        .query_map((session_id, limit.clamp(1, 200) as i64), |row| {
            Ok(TaskMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                reply_to_message_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    items.reverse();
    Ok(items)
}

fn read_task_exit_code(db: &Db, session_id: &str) -> Option<i64> {
    let path = task_meta_path(db, session_id);
    let meta_path = if path.exists() {
        path
    } else {
        db.data_dir
            .join("task-logs")
            .join(format!("{session_id}.json"))
    };
    let parsed =
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(meta_path).ok()?).ok()?;
    parsed.get("exitCode").and_then(|value| value.as_i64())
}

fn error_summary(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            !line.starts_with("{\"type\":\"item.completed\",\"item\":{\"id\":")
                && !line.starts_with("{\"type\":\"turn.completed\"")
        })
        .rev()
        .take(16)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(2000)
        .collect()
}

fn session_data_path(db: &Db, session_id: &str) -> PathBuf {
    db.data_dir.join("sessions").join(session_id)
}

fn session_context_path(db: &Db, session_id: &str) -> PathBuf {
    session_data_path(db, session_id).join("context")
}

fn task_log_path(db: &Db, session_id: &str) -> PathBuf {
    session_data_path(db, session_id)
        .join("logs")
        .join("codex.log")
}

fn task_meta_path(db: &Db, session_id: &str) -> PathBuf {
    session_data_path(db, session_id)
        .join("logs")
        .join("codex.json")
}

fn system_time_string(value: std::time::SystemTime) -> String {
    time::OffsetDateTime::from(value)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
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
