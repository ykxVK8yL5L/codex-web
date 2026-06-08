use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use rusqlite::OptionalExtension;
use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::db::Db;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScanResponse {
    pub items: Vec<StorageItemSummary>,
    pub total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageItemSummary {
    pub id: String,
    pub r#type: String,
    pub status: String,
    pub label: String,
    pub path: String,
    pub bytes: u64,
    pub updated_at: String,
    pub session_type: Option<String>,
    pub session_kind: Option<String>,
    pub related_id: Option<String>,
    pub related_name: Option<String>,
    pub related_type: Option<String>,
}

pub fn scan(db: &Db) -> anyhow::Result<StorageScanResponse> {
    let connection = db.open_read_write()?;
    let sessions = sessions(&connection)?;
    let rooms = rooms_with_sessions(&connection)?;
    let active_room_ids: HashSet<String> = rooms
        .iter()
        .filter_map(|(room_id, room)| {
            let session_id = room.session_id.as_ref()?;
            let session = sessions.get(session_id)?;
            // TS room workspaces are active only when the room still has a live parent room
            // session. A stale rooms row whose session_id points at any other/old session must not
            // keep data_dir/rooms/<roomId> marked active after the group conversation was deleted.
            if session.conversation_type == "room"
                && session.room_id.as_deref() == Some(room_id.as_str())
            {
                Some(room_id.clone())
            } else {
                None
            }
        })
        .collect();
    let active_session_ids: HashSet<String> = sessions
        .iter()
        .filter_map(|(session_id, session)| {
            if session.conversation_type == "agent" {
                if let Some(room_id) = session.room_id.as_deref() {
                    if !active_room_ids.contains(room_id) {
                        return None;
                    }
                }
            }
            Some(session_id.clone())
        })
        .collect();
    let room_ids: HashSet<String> = rooms.keys().cloned().collect();
    let mut items = Vec::new();
    scan_sessions(&db.data_dir, &sessions, &active_session_ids, &mut items)?;
    scan_rooms(&db.data_dir, &room_ids, &rooms, &mut items)?;
    scan_preview_logs(&connection, &mut items)?;
    items.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let total_bytes = items.iter().map(|item| item.bytes).sum();
    Ok(StorageScanResponse { items, total_bytes })
}

fn scan_sessions(
    data_dir: &Path,
    sessions: &HashMap<String, SessionMeta>,
    active_session_ids: &HashSet<String>,
    items: &mut Vec<StorageItemSummary>,
) -> anyhow::Result<()> {
    let root = data_dir.join("sessions");
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let label = entry.file_name().to_string_lossy().to_string();
        let session = sessions.get(&label);
        let metadata = if session.is_none() {
            read_session_storage_metadata(&path)
        } else {
            None
        };
        let stats = path_stats(&path);
        let project_related = session.and_then(|item| item.project_id.as_ref()).is_some()
            || metadata
                .as_ref()
                .and_then(|item| item.project_id.as_ref())
                .is_some();
        items.push(StorageItemSummary {
            id: item_id("session-data", &path),
            r#type: "session-data".to_string(),
            status: if active_session_ids.contains(&label) {
                "active"
            } else {
                "orphan"
            }
            .to_string(),
            label: label.clone(),
            path: path.display().to_string(),
            bytes: stats.bytes,
            updated_at: stats.updated_at,
            session_type: session
                .map(|item| item.conversation_type.clone())
                .or_else(|| metadata.as_ref().and_then(|item| item.session_type.clone()))
                .or_else(|| Some("codex".to_string())),
            session_kind: session
                .and_then(|item| item.kind.clone())
                .or_else(|| metadata.as_ref().and_then(|item| item.kind.clone())),
            related_id: session
                .and_then(|item| item.project_id.clone())
                .or_else(|| metadata.as_ref().and_then(|item| item.project_id.clone()))
                .or_else(|| metadata.as_ref().and_then(|item| item.id.clone()))
                .or_else(|| Some(label)),
            related_name: session
                .map(|item| item.title.clone())
                .or_else(|| metadata.as_ref().and_then(|item| item.project_name.clone()))
                .or_else(|| metadata.as_ref().and_then(|item| item.title.clone())),
            related_type: Some(
                if project_related {
                    "project"
                } else {
                    "session"
                }
                .to_string(),
            ),
        });
    }
    Ok(())
}

fn scan_rooms(
    data_dir: &Path,
    rooms: &HashSet<String>,
    room_meta: &HashMap<String, RoomMeta>,
    items: &mut Vec<StorageItemSummary>,
) -> anyhow::Result<()> {
    let root = data_dir.join("rooms");
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let label = entry.file_name().to_string_lossy().to_string();
        let stats = path_stats(&path);
        let meta = room_meta.get(&label);
        items.push(StorageItemSummary {
            id: item_id("room-workspace", &path),
            r#type: "room-workspace".to_string(),
            status: if rooms.contains(&label) {
                "active"
            } else {
                "orphan"
            }
            .to_string(),
            label: label.clone(),
            path: path.display().to_string(),
            bytes: stats.bytes,
            updated_at: stats.updated_at,
            session_type: None,
            session_kind: None,
            related_id: Some(label.clone()),
            related_name: meta
                .and_then(|item| item.name.clone())
                .or_else(|| Some(label)),
            related_type: Some("room".to_string()),
        });
    }
    Ok(())
}

fn scan_preview_logs(
    connection: &rusqlite::Connection,
    items: &mut Vec<StorageItemSummary>,
) -> anyhow::Result<()> {
    if !table_exists(connection, "preview_logs")? {
        return Ok(());
    }
    let preview_ids = if table_exists(connection, "previews")? {
        let mut statement = connection.prepare("select id from previews")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        ids
    } else {
        HashSet::new()
    };
    let mut statement = connection.prepare(
        "select preview_id, logs, updated_at, label from preview_logs order by updated_at desc",
    )?;
    for row in statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })? {
        let (preview_id, logs, updated_at, label) = row?;
        items.push(StorageItemSummary {
            id: hash_id(&format!("preview-log:{preview_id}")),
            r#type: "preview-log".to_string(),
            status: if preview_ids.contains(&preview_id) {
                "active"
            } else {
                "orphan"
            }
            .to_string(),
            label: preview_id.clone(),
            path: format!("sqlite:preview_logs/{preview_id}"),
            bytes: logs.len() as u64,
            updated_at,
            session_type: None,
            session_kind: None,
            related_id: Some(preview_id),
            related_name: label,
            related_type: Some("preview".to_string()),
        });
    }
    Ok(())
}

#[derive(Clone)]
struct SessionStorageMetadata {
    id: Option<String>,
    title: Option<String>,
    kind: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
    session_type: Option<String>,
}

#[derive(Clone)]
struct SessionMeta {
    title: String,
    project_id: Option<String>,
    conversation_type: String,
    room_id: Option<String>,
    kind: Option<String>,
}

#[derive(Clone)]
struct RoomMeta {
    session_id: Option<String>,
    name: Option<String>,
}

fn read_session_storage_metadata(path: &Path) -> Option<SessionStorageMetadata> {
    let metadata_path = if path.join(".codex-web.json").exists() {
        path.join(".codex-web.json")
    } else {
        path.join("metadata.json")
    };
    let text = fs::read_to_string(metadata_path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    let session = value.get("session");
    let string_at = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned)
    };
    let nested_string_at = |key: &str| {
        session
            .and_then(|s| s.get(key))
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned)
    };
    let session_type = string_at("sessionType")
        .or_else(|| string_at("conversationType"))
        .or_else(|| nested_string_at("conversationType"));
    Some(SessionStorageMetadata {
        id: string_at("id").or_else(|| nested_string_at("id")),
        title: string_at("title").or_else(|| nested_string_at("title")),
        kind: string_at("kind").or_else(|| nested_string_at("kind")),
        project_id: string_at("projectId").or_else(|| nested_string_at("projectId")),
        project_name: string_at("projectName"),
        session_type,
    })
}

fn sessions(connection: &rusqlite::Connection) -> anyhow::Result<HashMap<String, SessionMeta>> {
    if !table_exists(connection, "sessions")? {
        return Ok(HashMap::new());
    }
    let mut statement = connection
        .prepare("select id, title, project_id, conversation_type, room_id, kind from sessions")?;
    let mut items = HashMap::new();
    for row in statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            SessionMeta {
                title: row.get(1)?,
                project_id: row.get(2)?,
                conversation_type: row
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "codex".to_string()),
                room_id: row.get(4)?,
                kind: row.get(5)?,
            },
        ))
    })? {
        let (id, meta) = row?;
        items.insert(id, meta);
    }
    Ok(items)
}

fn rooms_with_sessions(
    connection: &rusqlite::Connection,
) -> anyhow::Result<HashMap<String, RoomMeta>> {
    if !table_exists(connection, "rooms")? {
        return Ok(HashMap::new());
    }
    let mut statement = connection.prepare("select id, session_id, name from rooms")?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                RoomMeta {
                    session_id: row.get(1)?,
                    name: row.get(2)?,
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
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

struct PathStats {
    bytes: u64,
    updated_at: String,
}

fn path_stats(path: &Path) -> PathStats {
    let mut bytes = 0;
    let mut updated = std::time::UNIX_EPOCH;
    collect_path_stats(path, &mut bytes, &mut updated);
    PathStats {
        bytes,
        updated_at: crate::api::files::store::file_time(updated),
    }
}

fn collect_path_stats(path: &Path, bytes: &mut u64, updated: &mut std::time::SystemTime) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if let Ok(modified) = metadata.modified() {
        if modified > *updated {
            *updated = modified;
        }
    }
    if metadata.is_file() {
        *bytes += metadata.len();
        return;
    }
    if metadata.is_dir() {
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            collect_path_stats(&entry.path(), bytes, updated);
        }
    }
}

fn item_id(kind: &str, path: &Path) -> String {
    hash_id(&format!("{kind}:{}", path.display()))
}

fn hash_id(value: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn delete_item(db: &Db, item_type: &str, item_path: &str, force: bool) -> anyhow::Result<()> {
    let snapshot = scan(db)?;
    let existing = snapshot
        .items
        .iter()
        .find(|entry| entry.r#type == item_type && entry.path == item_path);
    if existing
        .map(|item| item.status == "active")
        .unwrap_or(false)
        && !force
    {
        anyhow::bail!("storage_item_active");
    }

    if item_type == "preview-log" {
        let preview_id = item_path
            .strip_prefix("sqlite:preview_logs/")
            .unwrap_or(item_path)
            .to_string();
        let connection = db.open_read_write()?;
        connection.execute(
            "delete from preview_logs where preview_id = ?",
            [&preview_id],
        )?;
        return Ok(());
    }

    let resolved = fs::canonicalize(item_path).unwrap_or_else(|_| PathBuf::from(item_path));
    let allowed_roots: Vec<PathBuf> = [db.data_dir.join("sessions"), db.data_dir.join("rooms")]
        .iter()
        .map(|root| fs::canonicalize(root).unwrap_or_else(|_| root.clone()))
        .collect();
    let allowed = allowed_roots
        .iter()
        .any(|root| resolved == *root || resolved.starts_with(root));
    if !allowed {
        anyhow::bail!("storage_path_not_allowed");
    }

    if item_type == "session-data" {
        if let Some(session_id) = resolved
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
        {
            let connection = db.open_read_write()?;
            let info: Option<(Option<String>, Option<String>)> = connection
                .query_row(
                    "select conversation_type, room_id from sessions where id = ?",
                    [&session_id],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, Option<String>>(1)?,
                        ))
                    },
                )
                .optional()?;
            let orphan_room_agent = match info {
                Some((conversation_type, Some(room_id)))
                    if conversation_type.as_deref() == Some("agent") =>
                {
                    connection
                        .query_row("select 1 from rooms where id = ?", [&room_id], |_| Ok(()))
                        .optional()?
                        .is_none()
                }
                _ => false,
            };
            drop(connection);
            if orphan_room_agent {
                crate::api::sessions::store::delete_session(db, &session_id)?;
            }
        }
    }

    if resolved.is_dir() {
        fs::remove_dir_all(&resolved).ok();
    } else {
        fs::remove_file(&resolved).ok();
    }
    Ok(())
}
