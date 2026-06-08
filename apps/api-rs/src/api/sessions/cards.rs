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
        let preview = preview_store::get(db, preview_id)?;
        let valid = preview
            .map(|preview| preview.scope_type == "session" && preview.scope_id == session_id)
            .unwrap_or(false);
        if !valid {
            return Ok(DeleteCardOutcome::NotFound);
        }
        dismiss(
            db,
            session_id,
            "preview",
            &serde_json::json!({ "id": preview_id }),
        )?;
        let _ = preview_store::delete(db, preview_id);
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

fn card_suppression_keys(card_type: &str, payload: &serde_json::Value) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(url) = payload.get("url").and_then(|value| value.as_str()) {
        keys.push(format!("url:{url}"));
    }
    if let Some(preview_id) = payload.get("previewId").and_then(|value| value.as_str()) {
        keys.push(format!("preview:{preview_id}"));
    }
    if card_type == "preview" {
        if let Some(id) = payload.get("id").and_then(|value| value.as_str()) {
            keys.push(format!("preview:{id}"));
        }
    }
    keys.retain(|key| !key.is_empty());
    keys
}

fn is_dismissed(db: &Db, session_id: &str, keys: &[String]) -> bool {
    if keys.is_empty() {
        return false;
    }
    let Ok(Some(connection)) = db.open_read_only() else {
        return false;
    };
    if !table_exists(&connection, "message_card_dismissals").unwrap_or(false) {
        return false;
    }
    keys.iter().any(|key| {
        connection
            .query_row(
                "select 1 from message_card_dismissals where session_id = ? and suppression_key = ? limit 1",
                (session_id, key),
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
    })
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
