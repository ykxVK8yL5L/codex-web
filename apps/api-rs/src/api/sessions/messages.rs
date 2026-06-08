use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{
    AppendSessionMessageRequest, SessionMessage, SessionMessageReply, SessionMessagesPage,
};

pub fn list(
    db: &Db,
    session_id: &str,
    limit: usize,
    before: Option<&str>,
) -> anyhow::Result<SessionMessagesPage> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(empty_page());
    };
    if !table_exists(&connection, "messages")? {
        return Ok(empty_page());
    }
    let page_size = limit.clamp(1, 100);
    let cursor = before
        .filter(|value| !value.trim().is_empty())
        .and_then(|id| {
            connection
                .query_row(
                    "select created_at, id from messages where id = ? and session_id = ?",
                    (id, session_id),
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .ok()
                .flatten()
        });
    let rows = if let Some((created_at, id)) = cursor {
        let mut statement = connection.prepare(
            "
            select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
              reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
            from messages
            left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
            where messages.session_id = ? and (messages.created_at < ? or (messages.created_at = ? and messages.id < ?))
            order by messages.created_at desc, messages.id desc
            limit ?
            ",
        )?;
        let items = statement
            .query_map(
                (
                    session_id,
                    &created_at,
                    &created_at,
                    &id,
                    page_size as i64 + 1,
                ),
                message_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        items
    } else {
        let mut statement = connection.prepare(
            "
            select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
              reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
            from messages
            left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
            where messages.session_id = ?
            order by messages.created_at desc, messages.id desc
            limit ?
            ",
        )?;
        let items = statement
            .query_map((session_id, page_size as i64 + 1), message_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        items
    };
    let has_more = rows.len() > page_size;
    let next_cursor = if has_more {
        rows.get(page_size - 1).map(|item| item.id.clone())
    } else {
        None
    };
    let mut items = rows.into_iter().take(page_size).collect::<Vec<_>>();
    items.reverse();
    Ok(SessionMessagesPage {
        items,
        next_cursor,
        has_more,
    })
}

pub fn append(
    db: &Db,
    session_id: &str,
    input: AppendSessionMessageRequest,
) -> anyhow::Result<SessionMessage> {
    let role = match input.role.as_deref().unwrap_or("user") {
        "assistant" => "assistant",
        "system" => "system",
        _ => "user",
    };
    let content = input.content.unwrap_or_default().trim().to_string();
    if content.is_empty() {
        anyhow::bail!("content_required");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let id = random_hex(16);
    let created_at = crate::api::common::timestamp();
    connection.execute(
        "insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, ?, ?, ?, ?)",
        (&id, session_id, role, &content, input.reply_to_message_id.as_deref(), &created_at),
    )?;
    get_message(&connection, session_id, &id)?
        .ok_or_else(|| anyhow::anyhow!("message_create_failed"))
}

fn get_message(
    connection: &rusqlite::Connection,
    session_id: &str,
    id: &str,
) -> anyhow::Result<Option<SessionMessage>> {
    connection
        .query_row(
            "
            select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
              reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
            from messages
            left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
            where messages.session_id = ? and messages.id = ?
            ",
            (session_id, id),
            message_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn message_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionMessage> {
    let reply_id: Option<String> = row.get(5)?;
    Ok(SessionMessage {
        id: row.get(0)?,
        role: row.get(1)?,
        content: row.get(2)?,
        reply_to_message_id: row.get(3)?,
        created_at: row.get(4)?,
        reply_to: reply_id.map(|id| SessionMessageReply {
            id,
            role: row.get(6).unwrap_or_else(|_| "user".to_string()),
            content: row.get(7).unwrap_or_default(),
        }),
    })
}

fn empty_page() -> SessionMessagesPage {
    SessionMessagesPage {
        items: Vec::new(),
        next_cursor: None,
        has_more: false,
    }
}

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists messages (
          id text primary key,
          session_id text not null,
          role text not null,
          content text not null,
          reply_to_message_id text,
          created_at text not null
        );
        create index if not exists messages_session_created_idx on messages(session_id, created_at desc, id desc);
        ",
    )?;
    ensure_column(connection, "messages", "reply_to_message_id", "text")?;
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

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
