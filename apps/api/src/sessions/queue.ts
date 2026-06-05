import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  QueuedMessage,
  QueueMessageRequest,
  SessionSummary,
  UpdateQueuedMessageRequest,
} from "@codex-web/protocol";
import type { TaskEvent } from "../tasks/events.js";

type SessionQueueDeps = {
  db: Database.Database;
  publishTaskEvent: (sessionId: string, event: TaskEvent) => void;
};

let sessionQueueDeps: SessionQueueDeps | null = null;

export function setSessionQueueDeps(nextDeps: SessionQueueDeps) {
  sessionQueueDeps = nextDeps;
}

function deps() {
  if (!sessionQueueDeps) throw new Error("session_queue_store_not_initialized");
  return sessionQueueDeps;
}

function queuedMessageFromRow(row: Record<string, unknown>): QueuedMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    prompt: String(row.prompt),
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    replyToMessageId: row.reply_to_message_id ? String(row.reply_to_message_id) : null,
    orderIndex: Number(row.order_index ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listQueuedMessages(sessionId: string) {
  const { db } = deps();
  return (db.prepare(`
    select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at
    from message_queue
    where session_id = ?
    order by order_index asc, created_at asc, id asc
  `).all(sessionId) as Array<Record<string, unknown>>).map(queuedMessageFromRow);
}

export function getQueuedMessage(sessionId: string, queueId: string) {
  const { db } = deps();
  const row = db.prepare(`
    select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at
    from message_queue
    where session_id = ? and id = ?
  `).get(sessionId, queueId) as Record<string, unknown> | undefined;
  return row ? queuedMessageFromRow(row) : null;
}

export function enqueueMessage(session: SessionSummary, input: QueueMessageRequest) {
  const { db, publishTaskEvent } = deps();
  const now = new Date().toISOString();
  const orderIndex = Number((db.prepare("select coalesce(max(order_index), 0) as max_order from message_queue where session_id = ?").get(session.id) as { max_order?: number } | undefined)?.max_order ?? 0) + 1000;
  const item: QueuedMessage = {
    id: randomUUID(),
    sessionId: session.id,
    prompt: input.prompt.trim(),
    providerId: input.providerId ?? session.providerId ?? null,
    model: input.model ?? session.model ?? null,
    replyToMessageId: input.replyToMessageId ?? null,
    orderIndex,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(`
    insert into message_queue (id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.sessionId, item.prompt, item.providerId ?? null, item.model ?? null, item.replyToMessageId ?? null, item.orderIndex, item.createdAt, item.updatedAt);
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
  return item;
}

export function updateQueuedMessage(session: SessionSummary, queueId: string, input: UpdateQueuedMessageRequest) {
  const { db, publishTaskEvent } = deps();
  const current = getQueuedMessage(session.id, queueId);
  if (!current) return null;
  const updated: QueuedMessage = {
    ...current,
    prompt: input.prompt.trim(),
    providerId: input.providerId ?? current.providerId ?? session.providerId ?? null,
    model: input.model ?? current.model ?? session.model ?? null,
    replyToMessageId: input.replyToMessageId ?? current.replyToMessageId ?? null,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(`
    update message_queue
    set prompt = ?, provider_id = ?, model = ?, reply_to_message_id = ?, updated_at = ?
    where session_id = ? and id = ?
  `).run(updated.prompt, updated.providerId ?? null, updated.model ?? null, updated.replyToMessageId ?? null, updated.updatedAt, session.id, queueId);
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
  return updated;
}

export function deleteQueuedMessage(session: SessionSummary, queueId: string) {
  const { db, publishTaskEvent } = deps();
  db.prepare("delete from message_queue where session_id = ? and id = ?").run(session.id, queueId);
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
}

export function reorderQueuedMessages(session: SessionSummary, orderedIds: string[]) {
  const { db, publishTaskEvent } = deps();
  const currentIds = new Set(listQueuedMessages(session.id).map((item) => item.id));
  const nextIds = orderedIds.filter((id) => currentIds.has(id));
  if (nextIds.length !== currentIds.size) return null;
  const updatedAt = new Date().toISOString();
  const updateOrder = db.prepare("update message_queue set order_index = ?, updated_at = ? where session_id = ? and id = ?");
  db.transaction(() => {
    nextIds.forEach((id, index) => updateOrder.run((index + 1) * 1000, updatedAt, session.id, id));
  })();
  const queue = listQueuedMessages(session.id);
  publishTaskEvent(session.id, { type: "queue", queue, session });
  return queue;
}

export function popNextQueuedMessage(sessionId: string) {
  const { db } = deps();
  const row = db.prepare(`
    select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at
    from message_queue
    where session_id = ?
    order by order_index asc, created_at asc, id asc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const item = queuedMessageFromRow(row);
  db.prepare("delete from message_queue where id = ?").run(item.id);
  return item;
}
