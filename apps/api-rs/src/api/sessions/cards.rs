use rand::RngCore;
use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::{api::previews::store as preview_store, db::Db};

// Port of listSessionCards / DELETE card from apps/api/src/sessions/runtime.ts and routes.ts.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCardSummary {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    #[serde(rename = "type")]
    pub card_type: String,
    pub title: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

pub fn list(db: &Db, session_id: &str) -> anyhow::Result<Vec<MessageCardSummary>> {
    ensure_session_url_cards(db, session_id)?;

    // Preview-backed cards.
    let mut preview_cards = Vec::new();
    let mut preview_ids = std::collections::HashSet::new();
    for preview in preview_store::list(
        db,
        Some("session"),
        Some(session_id),
        None,
        None,
        None,
        usize::MAX,
    )? {
        preview_ids.insert(preview.id.clone());
        preview_cards.push(MessageCardSummary {
            id: format!("preview:{}", preview.id),
            session_id: session_id.to_string(),
            message_id: None,
            card_type: "preview".to_string(),
            title: preview.label.clone(),
            payload: serde_json::to_value(&preview).unwrap_or_else(|_| serde_json::json!({})),
            created_at: preview.created_at.clone(),
        });
    }

    let mut stored = list_stored(db, session_id)?
        .into_iter()
        .filter(|card| {
            // Drop service cards that point at a live preview.
            if card.card_type == "service" {
                if let Some(preview_id) = card
                    .payload
                    .get("previewId")
                    .and_then(|value| value.as_str())
                {
                    return !preview_ids.contains(preview_id);
                }
            }
            true
        })
        .filter(|card| {
            !is_dismissed(
                db,
                session_id,
                &card_suppression_keys(&card.card_type, &card.payload),
            )
        })
        .collect::<Vec<_>>();

    let mut all = preview_cards;
    all.append(&mut stored);
    all.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(all)
}

pub enum DeleteCardOutcome {
    Deleted(String),
    NotFound,
}

pub fn delete(db: &Db, session_id: &str, card_id: &str) -> anyhow::Result<DeleteCardOutcome> {
    if let Some(preview_id) = card_id.strip_prefix("preview:") {
        let Some(preview) = preview_store::get(db, preview_id)? else {
            return Ok(DeleteCardOutcome::NotFound);
        };
        if preview.scope_type != "session" || preview.scope_id != session_id {
            return Ok(DeleteCardOutcome::NotFound);
        }
        dismiss(
            db,
            session_id,
            "preview",
            &serde_json::to_value(preview.public())?,
        )?;
        let connection = db.open_read_write()?;
        ensure_schema(&connection)?;
        let _ = connection.execute(
            "delete from message_cards where session_id = ? and json_extract(payload, '$.previewId') = ?",
            (session_id, preview_id),
        );
        return Ok(DeleteCardOutcome::Deleted(card_id.to_string()));
    }

    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let card = connection
        .query_row(
            "select type, payload from message_cards where id = ? and session_id = ?",
            (card_id, session_id),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((card_type, payload_raw)) = card else {
        return Ok(DeleteCardOutcome::NotFound);
    };
    let payload = serde_json::from_str::<serde_json::Value>(&payload_raw)
        .unwrap_or_else(|_| serde_json::json!({}));
    dismiss(db, session_id, &card_type, &payload)?;
    let deleted = connection.execute(
        "delete from message_cards where id = ? and session_id = ?",
        (card_id, session_id),
    )?;
    if deleted == 0 {
        Ok(DeleteCardOutcome::NotFound)
    } else {
        Ok(DeleteCardOutcome::Deleted(card_id.to_string()))
    }
}

fn list_stored(db: &Db, session_id: &str) -> anyhow::Result<Vec<MessageCardSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "message_cards")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select id, session_id, message_id, type, title, payload, created_at from message_cards where session_id = ? order by created_at desc, id desc",
    )?;
    let items = statement
        .query_map([session_id], |row| {
            let payload_raw: String = row.get(5)?;
            Ok(MessageCardSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                message_id: row.get(2)?,
                card_type: row.get(3)?,
                title: row.get(4)?,
                payload: serde_json::from_str(&payload_raw)
                    .unwrap_or_else(|_| serde_json::json!({})),
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn ensure_session_url_cards(db: &Db, session_id: &str) -> anyhow::Result<()> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(());
    };
    if !table_exists(&connection, "messages")? {
        return Ok(());
    }
    let mut statement = connection.prepare(
        "
        select id, content
        from messages
        where session_id = ? and role = 'assistant'
        order by created_at asc, id asc
        ",
    )?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    drop(connection);

    for (message_id, content) in rows {
        append_url_cards_for_message(db, session_id, &message_id, &content)?;
    }
    Ok(())
}

fn append_url_cards_for_message(
    db: &Db,
    session_id: &str,
    message_id: &str,
    content: &str,
) -> anyhow::Result<()> {
    let urls = message_urls(content);
    if urls.is_empty() {
        return Ok(());
    }

    discover_preview_urls(db, session_id, content)?;

    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let mut existing = existing_card_urls(&connection, session_id)?;
    for url in urls {
        if is_local_preview_url(&url) || existing.contains(&url) {
            continue;
        }
        if is_dismissed_with_connection(&connection, session_id, &[format!("url:{url}")])? {
            continue;
        }
        let payload = link_payload(&url);
        let title = link_title(&url);
        connection.execute(
            "insert into message_cards (id, session_id, message_id, type, title, payload, created_at) values (?, ?, ?, 'link', ?, ?, ?)",
            (
                format!("card-{}", random_hex(16)),
                session_id,
                message_id,
                title,
                serde_json::to_string(&payload)?,
                crate::api::common::timestamp(),
            ),
        )?;
        existing.push(url);
    }
    Ok(())
}

struct SessionCardInfo {
    title: String,
    workspace_path: String,
}

fn discover_preview_urls(db: &Db, session_id: &str, content: &str) -> anyhow::Result<()> {
    let matches = local_preview_urls(content);
    if matches.is_empty() || !can_create_discovered_preview(db, session_id)? {
        return Ok(());
    }
    let Some(session) = session_card_info(db, session_id)? else {
        return Ok(());
    };

    for (source, port) in matches {
        if should_ignore_discovered_preview_url(&source) {
            continue;
        }
        let keys = vec![
            format!("preview-port:{port}"),
            format!("url:{}", normalize_message_url(&source)),
        ];
        if is_dismissed(db, session_id, &keys) {
            continue;
        }
        let input = crate::api::previews::models::CreatePreviewRequest {
            scope_type: "session".to_string(),
            scope_id: session_id.to_string(),
            label: Some(format!(
                "{} :{}",
                if session.title.trim().is_empty() {
                    "Session"
                } else {
                    session.title.trim()
                },
                port
            )),
            target_host: Some("127.0.0.1".to_string()),
            port: i64::from(port),
            command: None,
            cwd: Some(session.workspace_path.clone()),
            access: Some("private".to_string()),
            proxy_paths: Some(Vec::new()),
            auto_start: Some(false),
        };
        let Ok((preview, created)) = preview_store::create_with_status(db, input) else {
            continue;
        };
        if !created {
            continue;
        }
        let _ = preview_store::append_logs(
            db,
            &preview.id,
            &preview.label,
            &format!("[discover] detected {source} from Codex output\n"),
        );
        append_service_card_for_preview(db, session_id, &preview, port, &source)?;
    }
    Ok(())
}

fn append_service_card_for_preview(
    db: &Db,
    session_id: &str,
    preview: &crate::api::previews::models::PreviewRecord,
    port: u16,
    source: &str,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let public = preview.public();
    connection.execute(
        "insert into message_cards (id, session_id, message_id, type, title, payload, created_at) values (?, ?, null, 'service', ?, ?, ?)",
        (
            format!("card-{}", random_hex(16)),
            session_id,
            format!("Detected service on :{port}"),
            serde_json::to_string(&serde_json::json!({
                "previewId": preview.id,
                "url": public.url,
                "port": port,
                "source": source,
            }))?,
            crate::api::common::timestamp(),
        ),
    )?;
    Ok(())
}

fn session_card_info(db: &Db, session_id: &str) -> anyhow::Result<Option<SessionCardInfo>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "sessions")? {
        return Ok(None);
    }
    connection
        .query_row(
            "select title, workspace_path from sessions where id = ?",
            [session_id],
            |row| {
                Ok(SessionCardInfo {
                    title: row.get(0)?,
                    workspace_path: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn can_create_discovered_preview(db: &Db, session_id: &str) -> anyhow::Result<bool> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(true);
    };
    if !table_exists(&connection, "execution_contexts")? {
        return Ok(true);
    }
    let resolved_permissions = connection
        .query_row(
            "
            select resolved_permissions
            from execution_contexts
            where session_id = ?
            order by created_at desc, id desc
            limit 1
            ",
            [session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(resolved_permissions) = resolved_permissions else {
        return Ok(true);
    };
    let permissions = serde_json::from_str::<serde_json::Value>(&resolved_permissions)
        .unwrap_or_else(|_| serde_json::json!({}));
    Ok(permissions
        .get("canCreatePreview")
        .and_then(|value| value.as_bool())
        .unwrap_or(true))
}

fn local_preview_urls(value: &str) -> Vec<(String, u16)> {
    let Ok(regex) = regex::Regex::new(
        r#"\bhttps?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(?:/[^\s"'`)]*)?"#,
    ) else {
        return Vec::new();
    };
    let mut urls = Vec::new();
    for captures in regex.captures_iter(value) {
        let Some(source) = captures.get(0).map(|match_value| match_value.as_str()) else {
            continue;
        };
        let Some(port) = captures
            .get(1)
            .and_then(|match_value| match_value.as_str().parse::<u16>().ok())
        else {
            continue;
        };
        let source = normalize_message_url(source);
        if !urls.iter().any(|(current, _)| current == &source) {
            urls.push((source, port));
        }
    }
    urls
}

fn should_ignore_discovered_preview_url(value: &str) -> bool {
    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };
    let path = parsed.path();
    path.starts_with("/provider-proxy")
        || path.starts_with("/api/")
        || path.starts_with("/preview/")
        || path == "/health"
}

fn message_urls(value: &str) -> Vec<String> {
    let Ok(regex) = regex::Regex::new(r#"\bhttps?://[^\s<>"'`]+"#) else {
        return Vec::new();
    };
    let mut urls = Vec::new();
    for match_value in regex.find_iter(value) {
        let url = normalize_message_url(match_value.as_str());
        if !url.is_empty() && !urls.contains(&url) {
            urls.push(url);
        }
    }
    urls
}

fn normalize_message_url(value: &str) -> String {
    let mut url = value.trim().to_string();
    while url
        .chars()
        .last()
        .is_some_and(|value| matches!(value, ')' | ',' | '.' | ';' | ':' | '!' | '?'))
    {
        url.pop();
    }
    url
}

fn is_local_preview_url(value: &str) -> bool {
    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    let host = parsed.host_str().unwrap_or_default();
    let is_local = matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0");
    is_local && parsed.port().is_some()
}

fn link_payload(url: &str) -> serde_json::Value {
    if let Ok(parsed) = url::Url::parse(url) {
        return serde_json::json!({
            "url": url,
            "host": parsed.host_str().unwrap_or_default(),
            "path": parsed.path(),
            "protocol": parsed.scheme(),
        });
    }
    serde_json::json!({ "url": url })
}

fn link_title(url: &str) -> String {
    let Ok(parsed) = url::Url::parse(url) else {
        return url.to_string();
    };
    let host = parsed.host_str().unwrap_or(url);
    let path = parsed.path();
    if path.is_empty() || path == "/" {
        host.to_string()
    } else {
        format!("{host}{path}")
    }
}

fn existing_card_urls(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut statement = connection.prepare(
        "
        select payload
        from message_cards
        where session_id = ? and type in ('link', 'service', 'preview')
        ",
    )?;
    let rows = statement
        .query_map([session_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|payload_raw| {
            serde_json::from_str::<serde_json::Value>(&payload_raw)
                .ok()
                .and_then(|payload| card_payload_url(&payload))
        })
        .collect())
}

fn card_payload_url(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("url")
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("source").and_then(|value| value.as_str()))
        .map(normalize_message_url)
        .filter(|value| !value.is_empty())
}

fn card_suppression_keys(card_type: &str, payload: &serde_json::Value) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(url) = card_payload_url(payload) {
        keys.push(format!("url:{url}"));
    }
    if let Some(preview_id) = payload.get("previewId").and_then(|value| value.as_str()) {
        keys.push(format!("preview:{preview_id}"));
    }
    if card_type == "preview" || card_type == "service" {
        if let Some(port) = card_payload_port(payload) {
            keys.push(format!("preview-port:{port}"));
        }
    }
    if card_type == "preview" {
        if let Some(id) = payload.get("id").and_then(|value| value.as_str()) {
            keys.push(format!("preview:{id}"));
        }
    }
    keys.retain(|key| !key.is_empty());
    keys
}

fn card_payload_port(payload: &serde_json::Value) -> Option<u16> {
    if let Some(port) = payload.get("port").and_then(|value| value.as_u64()) {
        return u16::try_from(port).ok();
    }
    if let Some(port) = payload.get("port").and_then(|value| value.as_str()) {
        if let Ok(port) = port.parse::<u16>() {
            return Some(port);
        }
    }
    for key in ["source", "url"] {
        let Some(value) = payload.get(key).and_then(|value| value.as_str()) else {
            continue;
        };
        if let Ok(parsed) = url::Url::parse(value) {
            if let Some(port) = parsed.port() {
                return Some(port);
            }
        }
    }
    None
}

fn is_dismissed(db: &Db, session_id: &str, keys: &[String]) -> bool {
    if keys.is_empty() {
        return false;
    }
    let Ok(Some(connection)) = db.open_read_only() else {
        return false;
    };
    is_dismissed_with_connection(&connection, session_id, keys).unwrap_or(false)
}

fn is_dismissed_with_connection(
    connection: &rusqlite::Connection,
    session_id: &str,
    keys: &[String],
) -> anyhow::Result<bool> {
    if !table_exists(connection, "message_card_dismissals")? {
        return Ok(false);
    }
    for key in keys {
        if connection
            .query_row(
                "select 1 from message_card_dismissals where session_id = ? and suppression_key = ? limit 1",
                (session_id, key),
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn dismiss(
    db: &Db,
    session_id: &str,
    card_type: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<()> {
    let keys = card_suppression_keys(card_type, payload);
    if keys.is_empty() {
        return Ok(());
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = crate::api::common::timestamp();
    for key in keys {
        let _ = connection.execute(
            "insert or ignore into message_card_dismissals (session_id, suppression_key, dismissed_at) values (?, ?, ?)",
            (session_id, &key, &now),
        );
    }
    Ok(())
}

pub fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists message_cards (
          id text primary key,
          session_id text not null,
          message_id text,
          type text not null,
          title text not null,
          payload text not null,
          created_at text not null
        );
        create index if not exists message_cards_session_created_idx on message_cards(session_id, created_at desc, id desc);
        create table if not exists message_card_dismissals (
          session_id text not null,
          suppression_key text not null,
          dismissed_at text not null,
          primary key (session_id, suppression_key)
        );
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

fn random_hex(size: usize) -> String {
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn temp_db() -> Db {
        let data_dir = std::env::temp_dir().join(format!("codex-web-cards-test-{}", random_hex(8)));
        Db {
            sqlite_path: data_dir.join("codex-web.sqlite"),
            data_dir,
        }
    }

    #[test]
    fn list_creates_link_cards_from_assistant_message_urls() -> anyhow::Result<()> {
        let db = temp_db();
        let connection = db.open_read_write()?;
        connection.execute_batch(
            "
            create table messages (
              id text primary key,
              session_id text not null,
              role text not null,
              content text not null,
              reply_to_message_id text,
              created_at text not null
            );
            ",
        )?;
        connection.execute(
            "insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values ('message-1', 'session-1', 'assistant', ?, null, '2026-06-19T00:00:00.000Z')",
            ["See https://example.com/docs). Local http://localhost:5173 should stay out."],
        )?;
        drop(connection);

        let cards = list(&db, "session-1")?;
        let link_cards = cards
            .iter()
            .filter(|card| card.card_type == "link")
            .collect::<Vec<_>>();
        assert_eq!(link_cards.len(), 1);
        assert_eq!(link_cards[0].title, "example.com/docs");
        assert_eq!(
            link_cards[0]
                .payload
                .get("url")
                .and_then(|value| value.as_str()),
            Some("https://example.com/docs")
        );

        let cards = list(&db, "session-1")?;
        assert_eq!(
            cards.iter().filter(|card| card.card_type == "link").count(),
            1
        );

        let _ = fs::remove_dir_all(&db.data_dir);
        Ok(())
    }

    #[test]
    fn list_registers_preview_from_localhost_url() -> anyhow::Result<()> {
        let db = temp_db();
        let connection = db.open_read_write()?;
        connection.execute_batch(
            "
            create table sessions (
              id text primary key,
              title text not null,
              workspace_path text not null
            );
            create table messages (
              id text primary key,
              session_id text not null,
              role text not null,
              content text not null,
              reply_to_message_id text,
              created_at text not null
            );
            ",
        )?;
        connection.execute(
            "insert into sessions (id, title, workspace_path) values ('session-1', 'Preview Work', '/tmp/project')",
            [],
        )?;
        connection.execute(
            "insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values ('message-1', 'session-1', 'assistant', 'Open http://localhost:5173 now.', null, '2026-06-19T00:00:00.000Z')",
            [],
        )?;
        drop(connection);

        let cards = list(&db, "session-1")?;
        let preview_cards = cards
            .iter()
            .filter(|card| card.card_type == "preview")
            .collect::<Vec<_>>();
        assert_eq!(preview_cards.len(), 1);
        assert_eq!(preview_cards[0].title, "Preview Work :5173");
        assert_eq!(
            preview_cards[0]
                .payload
                .get("port")
                .and_then(|value| value.as_i64()),
            Some(5173)
        );
        assert_eq!(
            cards.iter().filter(|card| card.card_type == "link").count(),
            0
        );

        let cards = list(&db, "session-1")?;
        assert_eq!(
            cards
                .iter()
                .filter(|card| card.card_type == "preview")
                .count(),
            1
        );

        let _ = fs::remove_dir_all(&db.data_dir);
        Ok(())
    }
}
