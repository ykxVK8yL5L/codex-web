import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { MessageCardSummary, PreviewSummary, SessionMessage, SessionSummary } from "@codex-web/protocol";

type ProviderPlatformForwarder = {
  forwardAssistantMessageToFeishu?: (session: SessionSummary, message: SessionMessage) => void;
  forwardAssistantMessageToWeCom?: (session: SessionSummary, message: SessionMessage) => void;
  forwardAssistantMessageToQQ?: (session: SessionSummary, message: SessionMessage) => void;
  forwardAssistantMessageToWeixin?: (session: SessionSummary, message: SessionMessage) => void;
};

type SessionMessageRuntimeDeps = {
  db: Database.Database;
  appData: { sessions: SessionSummary[] };
  previews: () => Map<string, any>;
  discoverPreviewUrls: (session: SessionSummary, value: string) => void;
  publicPreview: (preview: any) => PreviewSummary;
  forwardAssistantMessageToEmail: (session: SessionSummary, message: SessionMessage) => void;
  forwardAssistantMessageToTelegram: (session: SessionSummary, message: SessionMessage) => void;
  feishuPlatform: () => ProviderPlatformForwarder;
  wecomPlatform: () => ProviderPlatformForwarder;
  qqPlatform: () => ProviderPlatformForwarder;
  weixinPlatform: () => ProviderPlatformForwarder;
};

export function createSessionMessageRuntime(deps: SessionMessageRuntimeDeps) {
  const { db, appData, discoverPreviewUrls, publicPreview, forwardAssistantMessageToEmail, forwardAssistantMessageToTelegram } = deps;

function messageFromRow(row: Record<string, unknown>): SessionMessage {
  const replyToMessageId = row.reply_to_message_id ? String(row.reply_to_message_id) : null;
  const message: SessionMessage = {
    id: String(row.id),
    role: row.role as SessionMessage["role"],
    content: String(row.content),
    replyToMessageId,
    createdAt: String(row.created_at),
  };
  if (row.reply_id) {
    message.replyTo = {
      id: String(row.reply_id),
      role: row.reply_role as SessionMessage["role"],
      content: String(row.reply_content),
    };
  }
  return message;
}

function syncRoomMessagesToSession(session: SessionSummary) {
  if (session.conversationType !== "room" || !session.roomId) return;
  const rows = db.prepare(`
    select id, type, payload, created_at
    from room_events
    where room_id = ? and type in ('user.message', 'agent.message')
    order by created_at asc, id asc
  `).all(session.roomId) as Array<{ id: string; type: string; payload: string; created_at: string }>;
  const insert = db.prepare("insert or ignore into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, ?, ?, ?, ?)");
  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    if (!content) continue;
    const messageId = typeof payload.messageId === "string" && payload.messageId ? payload.messageId : `room-message-${row.id}`;
    const replyToMessageId = typeof payload.replyToMessageId === "string" ? payload.replyToMessageId : null;
    const result = insert.run(messageId, session.id, row.type === "agent.message" ? "assistant" : "user", content, replyToMessageId, row.created_at);
    if (row.type === "agent.message" && result.changes > 0) appendUrlCardsForMessage(session, messageId, content);
  }
}

function appendSessionMessage(sessionId: string, role: SessionMessage["role"], content: string, replyToMessageId?: string | null) {
  const message: SessionMessage = {
    id: randomUUID(),
    role,
    content,
    replyToMessageId: replyToMessageId ?? null,
    createdAt: new Date().toISOString(),
  };
  db.prepare("insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, ?, ?, ?, ?)").run(
    message.id,
    sessionId,
    role,
    content,
    message.replyToMessageId,
    message.createdAt,
  );
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session && role === "assistant") {
    appendUrlCardsForMessage(session, message.id, content);
    forwardAssistantMessageToEmail(session, message);
    forwardAssistantMessageToTelegram(session, message);
    deps.feishuPlatform().forwardAssistantMessageToFeishu?.(session, message);
    deps.wecomPlatform().forwardAssistantMessageToWeCom?.(session, message);
    deps.qqPlatform().forwardAssistantMessageToQQ?.(session, message);
    deps.weixinPlatform().forwardAssistantMessageToWeixin?.(session, message);
  }
  return message;
}

function getSessionMessage(sessionId: string, messageId?: string | null) {
  if (!messageId) return null;
  const row = db.prepare(`
    select id, role, content, reply_to_message_id, created_at
    from messages
    where session_id = ? and id = ?
  `).get(sessionId, messageId) as Record<string, unknown> | undefined;
  return row ? messageFromRow(row) : null;
}

function promptWithReplyContext(sessionId: string, prompt: string, replyToMessageId?: string | null) {
  const replyTo = getSessionMessage(sessionId, replyToMessageId);
  if (!replyTo) return prompt;
  return [
    "The user is replying to this earlier message:",
    `Role: ${replyTo.role}`,
    `Message: ${replyTo.content}`,
    "",
    "User reply:",
    prompt,
  ].join("\n");
}


function deleteSessionMessages(sessionId: string) {
  db.prepare("delete from messages where session_id = ?").run(sessionId);
  db.prepare("delete from message_cards where session_id = ?").run(sessionId);
}


function messageCardFromRow(row: Record<string, unknown>): MessageCardSummary {
  let payload: unknown = {};
  try {
    payload = JSON.parse(String(row.payload));
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    messageId: row.message_id ? String(row.message_id) : null,
    type: row.type as MessageCardSummary["type"],
    title: String(row.title),
    payload,
    createdAt: String(row.created_at),
  };
}

function appendMessageCard(sessionId: string, type: MessageCardSummary["type"], title: string, payload: unknown, messageId?: string | null) {
  const card: MessageCardSummary = {
    id: `card-${randomUUID()}`,
    sessionId,
    messageId: messageId ?? null,
    type,
    title,
    payload,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    insert into message_cards (id, session_id, message_id, type, title, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(card.id, card.sessionId, card.messageId ?? null, card.type, card.title, JSON.stringify(card.payload ?? {}), card.createdAt);
  return card;
}

function normalizeMessageUrl(value: string) {
  let url = value.trim();
  while (/[),.;:!?]+$/.test(url)) url = url.slice(0, -1);
  return url;
}

function messageUrls(value: string) {
  const urls = new Set<string>();
  for (const match of value.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/g)) {
    const url = normalizeMessageUrl(match[0]);
    if (url) urls.add(url);
  }
  return [...urls];
}

function linkTitle(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return path ? `${parsed.host}${path}` : parsed.host;
  } catch {
    return url;
  }
}

function cardPayloadUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  return typeof record.url === "string" ? record.url : typeof record.source === "string" ? record.source : null;
}

function cardPayloadPort(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.port === "number" && Number.isInteger(record.port)) return record.port;
  if (typeof record.port === "string" && /^\d+$/.test(record.port)) return Number(record.port);
  for (const key of ["source", "url"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    try {
      const parsed = new URL(value);
      const port = Number(parsed.port);
      if (Number.isInteger(port)) return port;
    } catch {
      // Ignore non-URL payload fields.
    }
  }
  return null;
}

function cardSuppressionKeys(type: MessageCardSummary["type"], payload: unknown) {
  const keys = new Set<string>();
  const url = cardPayloadUrl(payload);
  if (url) keys.add(`url:${normalizeMessageUrl(url)}`);
  if (type === "preview" || type === "service") {
    const port = cardPayloadPort(payload);
    if (port !== null) keys.add(`preview-port:${port}`);
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const previewId = typeof record.previewId === "string" ? record.previewId : typeof record.id === "string" ? record.id : "";
      if (previewId) keys.add(`preview:${previewId}`);
    }
  }
  return [...keys].filter(Boolean);
}

function isMessageCardDismissed(sessionId: string, keys: string[]) {
  if (!keys.length) return false;
  const read = db.prepare("select 1 from message_card_dismissals where session_id = ? and suppression_key = ? limit 1");
  return keys.some((key) => Boolean(read.get(sessionId, key)));
}

function dismissMessageCard(sessionId: string, type: MessageCardSummary["type"], payload: unknown) {
  const keys = cardSuppressionKeys(type, payload);
  if (!keys.length) return;
  const insert = db.prepare("insert or ignore into message_card_dismissals (session_id, suppression_key, dismissed_at) values (?, ?, ?)");
  const now = new Date().toISOString();
  for (const key of keys) insert.run(sessionId, key, now);
}

function isLocalPreviewUrl(url: string) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/|$)/.test(url);
}

function appendUrlCardsForMessage(session: SessionSummary, messageId: string, content: string) {
  const urls = messageUrls(content);
  if (!urls.length) return;
  discoverPreviewUrls(session, content);
  const existing = (db.prepare(`
    select payload
    from message_cards
    where session_id = ? and type in ('link', 'service', 'preview')
  `).all(session.id) as Array<{ payload: string }>).map((row) => {
    try {
      return cardPayloadUrl(JSON.parse(row.payload));
    } catch {
      return null;
    }
  }).filter(Boolean);
  for (const url of urls) {
    if (isLocalPreviewUrl(url)) continue;
    if (existing.includes(url)) continue;
    if (isMessageCardDismissed(session.id, [`url:${url}`])) continue;
    let payload: Record<string, unknown> = { url };
    try {
      const parsed = new URL(url);
      payload = { url, host: parsed.host, path: parsed.pathname, protocol: parsed.protocol.replace(":", "") };
    } catch {
      payload = { url };
    }
    appendMessageCard(session.id, "link", linkTitle(url), payload, messageId);
    existing.push(url);
  }
}

function ensureSessionUrlCards(session: SessionSummary) {
  const rows = db.prepare(`
    select id, content
    from messages
    where session_id = ? and role = 'assistant'
    order by created_at asc, id asc
  `).all(session.id) as Array<{ id: string; content: string }>;
  for (const row of rows) appendUrlCardsForMessage(session, row.id, row.content);
}

function listSessionCards(sessionId: string): MessageCardSummary[] {
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session) ensureSessionUrlCards(session);
  const previewCards = Array.from(deps.previews().values())
    .filter((preview) => preview.scopeType === "session" && preview.scopeId === sessionId)
    .map((preview) => ({
      id: `preview:${preview.id}`,
      sessionId,
      messageId: null,
      type: "preview" as const,
      title: preview.label,
      payload: publicPreview(preview),
      createdAt: preview.createdAt,
    }));
  const previewIds = new Set(previewCards.map((card) => (card.payload as PreviewSummary).id));
  const stored = (db.prepare(`
    select id, session_id, message_id, type, title, payload, created_at
    from message_cards
    where session_id = ?
    order by created_at desc, id desc
  `).all(sessionId) as Array<Record<string, unknown>>)
    .map(messageCardFromRow)
    .filter((card) => {
      if (card.type !== "service" || !card.payload || typeof card.payload !== "object") return true;
      const previewId = (card.payload as Record<string, unknown>).previewId;
      return typeof previewId !== "string" || !previewIds.has(previewId);
    })
    .filter((card) => {
      return !isMessageCardDismissed(sessionId, cardSuppressionKeys(card.type, card.payload));
    });
  const seen = new Set<string>();
  return [...previewCards, ...stored]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .filter((card) => {
      if (isMessageCardDismissed(sessionId, cardSuppressionKeys(card.type, card.payload))) return false;
      const payload = card.payload && typeof card.payload === "object" ? card.payload as Record<string, unknown> : {};
      const key = typeof payload.previewId === "string"
        ? `preview:${payload.previewId}`
        : typeof payload.url === "string"
          ? `url:${payload.url}`
          : `${card.type}:${card.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}



  return {
    appendMessageCard,
    appendSessionMessage,
    appendUrlCardsForMessage,
    deleteSessionMessages,
    dismissMessageCard,
    ensureSessionUrlCards,
    getSessionMessage,
    isMessageCardDismissed,
    listSessionCards,
    messageCardFromRow,
    messageFromRow,
    messageWithReplyContext: promptWithReplyContext,
    promptWithReplyContext,
    syncRoomMessagesToSession,
  };
}
