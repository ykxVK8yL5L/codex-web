use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::db::Db;

use super::details;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivitySummary {
    pub id: String,
    pub session_id: String,
    pub activity_id: Option<String>,
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivityResponse {
    pub session_id: String,
    pub items: Vec<TaskActivitySummary>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

/// Parsed activity event, mirroring `apps/api/src/tasks/activity-parser.ts`.
struct ParsedActivity {
    id: Option<String>,
    kind: &'static str,
    label: String,
    detail: Option<String>,
    status: Option<String>,
}

pub fn record_activity(
    db: &Db,
    session_id: &str,
    kind: &'static str,
    label: impl Into<String>,
    detail: Option<String>,
    status: Option<String>,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    insert_activity(
        &connection,
        session_id,
        &ParsedActivity {
            id: None,
            kind,
            label: label.into(),
            detail,
            status,
        },
    )
}

pub fn list_response(
    db: &Db,
    session_id: &str,
    limit: usize,
    cursor: Option<&str>,
) -> anyhow::Result<TaskActivityResponse> {
    // Backfill from the task log when there are no stored activities yet.
    if list_rows(db, session_id, 1, None)?.is_empty() {
        backfill_from_log(db, session_id)?;
    }
    let page_size = limit.clamp(1, 100);
    let mut rows = list_rows(db, session_id, page_size + 1, cursor)?;
    let has_more = rows.len() > page_size;
    rows.truncate(page_size);
    let next_cursor = if has_more {
        rows.last()
            .map(|item| encode_cursor(&item.updated_at, &item.id))
    } else {
        None
    };
    Ok(TaskActivityResponse {
        session_id: session_id.to_string(),
        items: rows,
        next_cursor,
        has_more,
    })
}

fn list_rows(
    db: &Db,
    session_id: &str,
    limit: usize,
    cursor: Option<&str>,
) -> anyhow::Result<Vec<TaskActivitySummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "task_activities")? {
        return Ok(Vec::new());
    }
    let decoded = cursor.and_then(decode_cursor);
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(TaskActivitySummary {
            id: row.get(0)?,
            session_id: row.get(1)?,
            activity_id: row.get(2)?,
            kind: row.get(3)?,
            label: row.get(4)?,
            detail: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    };
    let select = "select id, session_id, activity_id, kind, label, detail, status, created_at, updated_at from task_activities";
    if let Some((sort_value, id)) = decoded {
        let mut statement = connection.prepare(&format!(
            "{select} where session_id = ? and (updated_at < ? or (updated_at = ? and id < ?)) order by updated_at desc, id desc limit ?"
        ))?;
        let items = statement
            .query_map(
                (session_id, &sort_value, &sort_value, &id, limit as i64),
                map_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    } else {
        let mut statement = connection.prepare(&format!(
            "{select} where session_id = ? order by updated_at desc, id desc limit ?"
        ))?;
        let items = statement
            .query_map((session_id, limit as i64), map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }
}

fn backfill_from_log(db: &Db, session_id: &str) -> anyhow::Result<()> {
    let content = details::read_task_log_for_session(db, session_id);
    if content.is_empty() {
        return Ok(());
    }
    // Only scan the trailing 512 KiB, mirroring the TS implementation.
    let tail = if content.len() > 512 * 1024 {
        &content[content.len() - 512 * 1024..]
    } else {
        content.as_str()
    };
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    for line in tail.split('\n') {
        if !line.trim_start().starts_with('{') {
            continue;
        }
        if let Some(activity) = read_activity_event(line) {
            insert_activity(&connection, session_id, &activity)?;
        }
    }
    Ok(())
}

fn insert_activity(
    connection: &rusqlite::Connection,
    session_id: &str,
    activity: &ParsedActivity,
) -> anyhow::Result<()> {
    let now = crate::api::common::timestamp();
    let id = format!("task-activity-{}", random_hex(16));
    if let Some(activity_id) = activity.id.as_deref().filter(|value| !value.is_empty()) {
        connection.execute(
            "insert into task_activities (id, session_id, activity_id, kind, label, detail, status, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?)
             on conflict(session_id, kind, activity_id) where activity_id is not null do update set
               label = excluded.label,
               detail = excluded.detail,
               status = excluded.status,
               updated_at = excluded.updated_at",
            (
                &id,
                session_id,
                activity_id,
                activity.kind,
                &activity.label,
                activity.detail.as_deref(),
                activity.status.as_deref(),
                &now,
                &now,
            ),
        )?;
    } else {
        connection.execute(
            "insert into task_activities (id, session_id, activity_id, kind, label, detail, status, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                &id,
                session_id,
                Option::<&str>::None,
                activity.kind,
                &activity.label,
                activity.detail.as_deref(),
                activity.status.as_deref(),
                &now,
                &now,
            ),
        )?;
    }
    Ok(())
}

// ---- activity-parser.ts port ----

fn shorten_detail(value: &str) -> String {
    if value.chars().count() > 180 {
        let prefix: String = value.chars().take(177).collect();
        format!("{prefix}...")
    } else {
        value.to_string()
    }
}

fn read_text_field(record: &serde_json::Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = record.get(*key).and_then(|item| item.as_str()) {
            if !value.trim().is_empty() {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}

fn activity_label(kind: &str, status: &str) -> String {
    let done = status == "completed";
    let failed = status == "failed";
    match kind {
        "command" => {
            if failed {
                "命令运行失败"
            } else if done {
                "运行命令完成"
            } else {
                "正在运行命令"
            }
        }
        "file" => {
            if failed {
                "文件操作失败"
            } else if done {
                "文件操作完成"
            } else {
                "正在编辑文件"
            }
        }
        _ => {
            if failed {
                "工具调用失败"
            } else if done {
                "工具调用完成"
            } else {
                "正在调用工具"
            }
        }
    }
    .to_string()
}

fn read_activity_status(item: &serde_json::Value, event: &serde_json::Value) -> String {
    let explicit = {
        let from_item = read_text_field(item, &["status"]);
        if from_item.is_empty() {
            read_text_field(event, &["status"])
        } else {
            from_item
        }
    };
    if !explicit.is_empty() {
        return explicit;
    }
    let event_type = event
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if event_type.ends_with(".started") {
        "in_progress".to_string()
    } else if event_type.ends_with(".completed") {
        "completed".to_string()
    } else {
        String::new()
    }
}

fn read_activity_id(item: &serde_json::Value, event: &serde_json::Value) -> Option<String> {
    let from_item = read_text_field(item, &["id", "call_id"]);
    let value = if from_item.is_empty() {
        read_text_field(event, &["id", "item_id"])
    } else {
        from_item
    };
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn read_file_activity_path(item: &serde_json::Value) -> String {
    let direct = read_text_field(
        item,
        &["path", "file", "file_path", "filename", "target_file"],
    );
    if !direct.is_empty() {
        return direct;
    }
    let Some(changes) = item.get("changes").and_then(|value| value.as_array()) else {
        return String::new();
    };
    for change in changes {
        if change.is_object() {
            let value = read_text_field(
                change,
                &["path", "file", "file_path", "filename", "target_file"],
            );
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

fn read_activity_event(line: &str) -> Option<ParsedActivity> {
    let event: serde_json::Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => {
            if line.contains("patch rejected") || line.contains("writing is blocked") {
                return Some(ParsedActivity {
                    id: None,
                    kind: "file",
                    label: "文件写入被沙箱拦截".to_string(),
                    detail: Some(shorten_detail(line)),
                    status: Some("failed".to_string()),
                });
            }
            return None;
        }
    };
    let item = event
        .get("item")
        .filter(|value| value.is_object())
        .unwrap_or(&event);
    let item_type = item
        .get("type")
        .and_then(|value| value.as_str())
        .or_else(|| event.get("type").and_then(|value| value.as_str()))
        .unwrap_or("")
        .to_string();
    let status = read_activity_status(item, &event);
    let id = read_activity_id(item, &event);

    if item_type == "command_execution" {
        let command = read_text_field(item, &["command"]);
        if command.is_empty() {
            return None;
        }
        return Some(ParsedActivity {
            id,
            kind: "command",
            label: activity_label("command", &status),
            detail: Some(shorten_detail(&command)),
            status: empty_to_none(status),
        });
    }

    let file_path = read_file_activity_path(item);
    if !file_path.is_empty()
        || matches!(
            item_type.as_str(),
            "file_change" | "file_operation" | "apply_patch" | "patch"
        )
    {
        let detail = if file_path.is_empty() {
            item_type.clone()
        } else {
            file_path
        };
        return Some(ParsedActivity {
            id,
            kind: "file",
            label: activity_label("file", &status),
            detail: Some(shorten_detail(&detail)),
            status: empty_to_none(status),
        });
    }

    let tool_name = read_text_field(item, &["tool", "name", "tool_name"]);
    if !tool_name.is_empty() || item_type.contains("tool") {
        let detail = if tool_name.is_empty() {
            item_type
        } else {
            tool_name
        };
        return Some(ParsedActivity {
            id,
            kind: "tool",
            label: activity_label("tool", &status),
            detail: Some(shorten_detail(&detail)),
            status: empty_to_none(status),
        });
    }

    None
}

fn empty_to_none(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Parse a single log line into the JSON activity event payload used by the SSE
/// stream, mirroring the `{ type: "activity", ... }` shape from events.ts.
pub fn parse_event_value(line: &str) -> Option<serde_json::Value> {
    if !line.trim_start().starts_with('{') {
        return None;
    }
    let activity = read_activity_event(line)?;
    let mut value = serde_json::json!({
        "type": "activity",
        "kind": activity.kind,
        "label": activity.label,
        "at": crate::api::common::timestamp(),
    });
    let object = value.as_object_mut().unwrap();
    if let Some(id) = activity.id {
        object.insert("id".to_string(), serde_json::Value::String(id));
    }
    if let Some(detail) = activity.detail {
        object.insert("detail".to_string(), serde_json::Value::String(detail));
    }
    if let Some(status) = activity.status {
        object.insert("status".to_string(), serde_json::Value::String(status));
    }
    Some(value)
}

pub fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists task_activities (
          id text primary key,
          session_id text not null,
          activity_id text,
          kind text not null,
          label text not null,
          detail text,
          status text,
          created_at text not null,
          updated_at text not null
        );
        create index if not exists task_activities_session_updated_idx on task_activities(session_id, updated_at desc);
        create unique index if not exists task_activities_session_activity_idx on task_activities(session_id, kind, activity_id) where activity_id is not null;
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

fn encode_cursor(sort_value: &str, id: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(format!("{sort_value}\n{id}"))
}

fn decode_cursor(value: &str) -> Option<(String, String)> {
    use base64::Engine;
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let decoded = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (sort_value, id) = text.split_once('\n')?;
    Some((sort_value.to_string(), id.to_string()))
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
