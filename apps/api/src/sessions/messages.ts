import type Database from "better-sqlite3";
import type { SessionMessage, SessionMessagesPage, SessionSummary } from "@codex-web/protocol";

type SessionMessageDeps = {
  db: Database.Database;
  messageFromRow: (row: Record<string, unknown>) => SessionMessage;
  syncRoomMessagesToSession: (session: SessionSummary) => void;
  findSessionById: (sessionId: string) => SessionSummary | undefined;
};

let sessionMessageDeps: SessionMessageDeps | null = null;

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
      select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
        reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
      from messages
      left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
      where messages.session_id = ? and (messages.created_at < ? or (messages.created_at = ? and messages.id < ?))
      order by messages.created_at desc, messages.id desc
      limit ?
    `).all(sessionId, cursor.created_at, cursor.created_at, cursor.id, pageSize + 1) as Array<Record<string, unknown>>
    : db.prepare(`
      select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
        reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
      from messages
      left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
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
    select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
      reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
    from messages
    left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
    where messages.session_id = @sessionId
    order by messages.created_at asc, messages.id asc
  `).all({ sessionId }) as Array<Record<string, unknown>>).map(messageFromRow);
}
