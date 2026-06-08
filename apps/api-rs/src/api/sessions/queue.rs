use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{
    QueueMessageRequest, QueuedMessage, ReorderQueuedMessagesRequest, SessionSummary,
    UpdateQueuedMessageRequest,
};

pub fn list(db: &Db, session_id: &str) -> anyhow::Result<Vec<QueuedMessage>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "message_queue")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at from message_queue where session_id = ? order by order_index asc, created_at asc, id asc",
    )?;
    let items = statement
        .query_map([session_id], queued_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn enqueue(
    db: &Db,
    session: &SessionSummary,
    input: QueueMessageRequest,
) -> anyhow::Result<QueuedMessage> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        anyhow::bail!("prompt_required");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let order_index = connection
        .query_row(
            "select coalesce(max(order_index), 0) from message_queue where session_id = ?",
            [&session.id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        + 1000;
    let now = crate::api::common::timestamp();
    let item = QueuedMessage {
        id: random_hex(16),
        session_id: session.id.clone(),
        prompt: prompt.to_string(),
        provider_id: input.provider_id.or_else(|| session.provider_id.clone()),
        model: input.model.or_else(|| session.model.clone()),
        reply_to_message_id: input.reply_to_message_id,
        order_index,
        created_at: now.clone(),
        updated_at: now,
    };
    connection.execute(
        "insert into message_queue (id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            &item.id,
            &item.session_id,
            &item.prompt,
            item.provider_id.as_deref(),
            item.model.as_deref(),
            item.reply_to_message_id.as_deref(),
            item.order_index,
            &item.created_at,
            &item.updated_at,
        ),
    )?;
    Ok(item)
}

pub fn update(
    db: &Db,
    session: &SessionSummary,
    queue_id: &str,
    input: UpdateQueuedMessageRequest,
) -> anyhow::Result<Option<QueuedMessage>> {
    let Some(mut item) = get(db, &session.id, queue_id)? else {
        return Ok(None);
    };
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        anyhow::bail!("prompt_required");
    }
    item.prompt = prompt.to_string();
    item.provider_id = input
        .provider_id
        .or(item.provider_id)
        .or_else(|| session.provider_id.clone());
    item.model = input.model.or(item.model).or_else(|| session.model.clone());
    item.reply_to_message_id = input.reply_to_message_id.or(item.reply_to_message_id);
    item.updated_at = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update message_queue set prompt = ?, provider_id = ?, model = ?, reply_to_message_id = ?, updated_at = ? where session_id = ? and id = ?",
        (&item.prompt, item.provider_id.as_deref(), item.model.as_deref(), item.reply_to_message_id.as_deref(), &item.updated_at, &session.id, queue_id),
    )?;
    Ok(Some(item))
}

pub fn reorder(
    db: &Db,
    session_id: &str,
    input: ReorderQueuedMessagesRequest,
) -> anyhow::Result<Option<Vec<QueuedMessage>>> {
    let current = list(db, session_id)?;
    let current_ids = current
        .iter()
        .map(|item| item.id.clone())
        .collect::<std::collections::HashSet<_>>();
    let next_ids = input
        .ordered_ids
        .into_iter()
        .filter(|id| current_ids.contains(id))
        .collect::<Vec<_>>();
    if next_ids.len() != current_ids.len() {
        return Ok(None);
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let updated_at = crate::api::common::timestamp();
    for (index, id) in next_ids.iter().enumerate() {
        connection.execute(
            "update message_queue set order_index = ?, updated_at = ? where session_id = ? and id = ?",
            (((index as i64) + 1) * 1000, &updated_at, session_id, id),
        )?;
    }
    Ok(Some(list(db, session_id)?))
}

pub fn delete(db: &Db, session_id: &str, queue_id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute(
        "delete from message_queue where session_id = ? and id = ?",
        (session_id, queue_id),
    )? > 0)
}

/// Pop the next queued message in order and delete it atomically enough for our single-process
/// runtime. Mirrors TS popNextQueuedMessage.
pub fn pop_next(db: &Db, session_id: &str) -> anyhow::Result<Option<QueuedMessage>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let item = connection
        .query_row(
            "select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at from message_queue where session_id = ? order by order_index asc, created_at asc, id asc limit 1",
            [session_id],
            queued_from_row,
        )
        .optional()?;
    if let Some(item) = item {
        connection.execute("delete from message_queue where id = ?", [&item.id])?;
        Ok(Some(item))
    } else {
        Ok(None)
    }
}

fn get(db: &Db, session_id: &str, queue_id: &str) -> anyhow::Result<Option<QueuedMessage>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "message_queue")? {
        return Ok(None);
    }
    connection
        .query_row(
            "select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at from message_queue where session_id = ? and id = ?",
            (session_id, queue_id),
            queued_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn queued_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueuedMessage> {
    Ok(QueuedMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        prompt: row.get(2)?,
        provider_id: row.get(3)?,
        model: row.get(4)?,
        reply_to_message_id: row.get(5)?,
        order_index: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists message_queue (
          id text primary key,
          session_id text not null,
          prompt text not null,
          provider_id text,
          model text,
          reply_to_message_id text,
          order_index integer not null default 0,
          created_at text not null,
          updated_at text not null
        );
        create index if not exists message_queue_session_created_idx on message_queue(session_id, created_at asc);
        ",
    )?;
    ensure_column(connection, "message_queue", "reply_to_message_id", "text")?;
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
