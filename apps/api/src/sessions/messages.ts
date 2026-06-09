import type Database from "better-sqlite3";
import type { SessionMessage, SessionMessagesPage, SessionSummary } from "@codex-web/protocol";

type SessionMessageDeps = {
  db: Database.Database;
  messageFromRow: (row: Record<string, unknown>) => SessionMessage;
  syncRoomMessagesToSession: (session: SessionSummary) => void;
  findSessionById: (sessionId: string) => SessionSummary | undefined;
};

let sessionMessageDeps: SessionMessageDeps | null = null;
const usageJoinSql = `
  left join token_usage_records usage on usage.id = (
    select usage_by_message.id
    from token_usage_records usage_by_message
    where usage_by_message.session_id = messages.session_id
      and usage_by_message.message_id = messages.id
    order by usage_by_message.created_at desc, usage_by_message.id desc
    limit 1
  )
`;
const messageSelectSql = `
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
`;

export function setSessionMessageDeps(nextDeps: SessionMessageDeps) {
  sessionMessageDeps = nextDeps;
}

function deps() {
  if (!sessionMessageDeps) throw new Error("session_message_store_not_initialized");
  return sessionMessageDeps;
}

export function listSessionMessages(sessionId: string, limit = 20, before?: string): SessionMessagesPage {
  const { db, syncRoomMessagesToSession, messageFromRow, findSessionById } = deps();
  const session = findSessionById(sessionId);
  if (session) syncRoomMessagesToSession(session);
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const cursor = before
    ? db.prepare("select created_at, id from messages where id = ? and session_id = ?").get(before, sessionId) as
        | { created_at: string; id: string }
        | undefined
    : undefined;
  const rows = cursor
    ? db.prepare(`
      select ${messageSelectSql}
      from messages
      left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
      ${usageJoinSql}
      where messages.session_id = ? and (messages.created_at < ? or (messages.created_at = ? and messages.id < ?))
      order by messages.created_at desc, messages.id desc
      limit ?
    `).all(sessionId, cursor.created_at, cursor.created_at, cursor.id, pageSize + 1) as Array<Record<string, unknown>>
    : db.prepare(`
      select ${messageSelectSql}
      from messages
      left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
      ${usageJoinSql}
      where messages.session_id = ?
      order by messages.created_at desc, messages.id desc
      limit ?
    `).all(sessionId, pageSize + 1) as Array<Record<string, unknown>>;
  const hasMore = rows.length > pageSize;
  return {
    items: rows.slice(0, pageSize).reverse().map(messageFromRow),
    nextCursor: hasMore ? String(rows[pageSize - 1].id) : null,
    hasMore,
  };
}

export function allSessionMessages(sessionId: string) {
  const { db, messageFromRow } = deps();
  return (db.prepare(`
    select ${messageSelectSql}
    from messages
    left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
    ${usageJoinSql}
    where messages.session_id = @sessionId
    order by messages.created_at asc, messages.id asc
  `).all({ sessionId }) as Array<Record<string, unknown>>).map(messageFromRow);
}
