use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{
    AppendSessionMessageRequest, SessionMessage, SessionMessageReply, SessionMessageUsage,
    SessionMessagesPage,
};

const USAGE_JOIN_SQL: &str = "
  left join token_usage_records usage on usage.id = (
    select usage_by_message.id
    from token_usage_records usage_by_message
    where usage_by_message.session_id = messages.session_id
      and usage_by_message.message_id = messages.id
    order by usage_by_message.created_at desc, usage_by_message.id desc
    limit 1
  )
";

const MESSAGE_SELECT_SQL: &str = "
  messages.id, messages.session_id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
  reply.id as reply_id, reply.role as reply_role, reply.content as reply_content,
  usage.id as usage_id,
  usage.session_id as usage_session_id,
  usage.session_title as usage_session_title,
  usage.message_id as usage_message_id,
  usage.task_run_id as usage_task_run_id,
  usage.provider_id as usage_provider_id,
  usage.provider_name as usage_provider_name,
  usage.model as usage_model,
  usage.source as usage_source,
  usage.input_tokens as usage_input_tokens,
  usage.cached_input_tokens as usage_cached_input_tokens,
  usage.output_tokens as usage_output_tokens,
  usage.reasoning_output_tokens as usage_reasoning_output_tokens,
  usage.total_tokens as usage_total_tokens,
  usage.created_at as usage_created_at
";

const MESSAGE_SELECT_SQL_WITHOUT_USAGE: &str = "
  messages.id, messages.session_id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
  reply.id as reply_id, reply.role as reply_role, reply.content as reply_content,
  null as usage_id,
  null as usage_session_id,
  null as usage_session_title,
  null as usage_message_id,
  null as usage_task_run_id,
  null as usage_provider_id,
  null as usage_provider_name,
  null as usage_model,
  null as usage_source,
  null as usage_input_tokens,
  null as usage_cached_input_tokens,
  null as usage_output_tokens,
  null as usage_reasoning_output_tokens,
  null as usage_total_tokens,
  null as usage_created_at
";

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
    let has_usage_records = table_exists(&connection, "token_usage_records")?;
    let select_sql = if has_usage_records { MESSAGE_SELECT_SQL } else { MESSAGE_SELECT_SQL_WITHOUT_USAGE };
    let usage_join_sql = if has_usage_records { USAGE_JOIN_SQL } else { "" };
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
            &format!("
            select {select_sql}
            from messages
            left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
            {usage_join_sql}
            where messages.session_id = ? and (messages.created_at < ? or (messages.created_at = ? and messages.id < ?))
            order by messages.created_at desc, messages.id desc
            limit ?
            "),
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
            &format!("
            select {select_sql}
            from messages
            left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
            {usage_join_sql}
            where messages.session_id = ?
            order by messages.created_at desc, messages.id desc
            limit ?
            "),
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
            select messages.id, messages.session_id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
              reply.id as reply_id, reply.role as reply_role, reply.content as reply_content,
              null as usage_id, null as usage_session_id, null as usage_session_title,
              null as usage_message_id,
              null as usage_task_run_id, null as usage_provider_id, null as usage_provider_name,
              null as usage_model, null as usage_source, null as usage_input_tokens,
              null as usage_cached_input_tokens, null as usage_output_tokens,
              null as usage_reasoning_output_tokens, null as usage_total_tokens,
              null as usage_created_at
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
    let reply_id: Option<String> = row.get(6)?;
    let usage_id: Option<String> = row.get(9)?;
    let input_tokens: i64 = row.get(18).unwrap_or(0);
    let cached_input_tokens: i64 = row.get(19).unwrap_or(0);
    Ok(SessionMessage {
        id: row.get(0)?,
        role: row.get(2)?,
        content: row.get(3)?,
        reply_to_message_id: row.get(4)?,
        created_at: row.get(5)?,
        reply_to: reply_id.map(|id| SessionMessageReply {
            id,
            role: row.get(7).unwrap_or_else(|_| "user".to_string()),
            content: row.get(8).unwrap_or_default(),
        }),
        usage: usage_id.map(|id| SessionMessageUsage {
            id,
            session_id: row.get(10).unwrap_or_default(),
            session_title: row.get(11).ok().flatten(),
            message_id: row.get(12).ok().flatten(),
            task_run_id: row.get(13).ok().flatten(),
            provider_id: row.get(14).ok().flatten(),
            provider_name: row.get(15).ok().flatten(),
            model: row.get(16).ok().flatten(),
            source: row.get(17).unwrap_or_else(|_| "codex_json".to_string()),
            input_tokens,
            cached_input_tokens,
            output_tokens: row.get(20).unwrap_or(0),
            reasoning_output_tokens: row.get(21).unwrap_or(0),
            total_tokens: row.get(22).unwrap_or(0),
            billable_input_tokens: (input_tokens - cached_input_tokens).max(0),
            created_at: row.get(23).unwrap_or_default(),
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
