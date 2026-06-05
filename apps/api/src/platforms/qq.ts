import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type {
  NotificationAccountSummary,
  NotificationEventType,
  NotificationRuleTarget,
  NotificationSeverity,
  SessionSummary,
} from "@codex-web/protocol";

type NotificationEventInput = {
  title: string;
  message: string;
  severity: NotificationSeverity;
  eventType: NotificationEventType;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
};

type NotificationAccountRecord = NotificationAccountSummary;
type DispatchResult = { mode: string; queuedId?: string; messageId?: string };
type DispatchMessageToSession = (target: SessionSummary, content: string) => DispatchResult;
type ResolveTelegramTargetSession = (raw: string) => SessionSummary | null;
type TelegramSessionChoices = (limit?: number) => SessionSummary[];
type TelegramSessionLabel = (account: NotificationAccountRecord, session: SessionSummary, index?: number) => string;
type TelegramGroupedSessionText = (account: NotificationAccountRecord, sessions: SessionSummary[], limit?: number) => string;
type ListNotificationAccounts = (exposeSecrets?: boolean) => NotificationAccountSummary[];

type QQChatType = "c2c" | "group" | "guild" | "dm";

type QQGatewayPayload = {
  op?: number;
  t?: string;
  s?: number;
  d?: unknown;
};

type QQMessage = {
  id?: string | number;
  timestamp?: string | number;
  content?: string;
  message_type?: number;
  group_openid?: string;
  channel_id?: string;
  guild_id?: string;
  author?: Record<string, unknown>;
  member?: Record<string, unknown>;
  room_id?: string;
  chat_room_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  context_token?: string;
};

type QQRuntime = {
  accountId: string;
  key: string;
  ws: WebSocket | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  sessionId: string;
  lastSeq: number | null;
  closed: boolean;
  heartbeatIntervalMs: number;
};

type QQPlatformDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  sessionVisibleInChatTools?: (session: SessionSummary) => boolean;
  listNotificationAccounts: ListNotificationAccounts;
  dispatchMessageToSession: DispatchMessageToSession;
  resolveTelegramTargetSession: ResolveTelegramTargetSession;
  telegramSessionChoices: TelegramSessionChoices;
  telegramSessionLabel: TelegramSessionLabel;
  telegramGroupedSessionText: TelegramGroupedSessionText;
};

function visibleSessions(deps: Pick<QQPlatformDeps, "sessions" | "sessionVisibleInChatTools">) {
  const filter = deps.sessionVisibleInChatTools ?? (() => true);
  return deps.sessions.filter(filter);
}

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const runtimes = new Map<string, QQRuntime>();
const outboundQueues = new Map<string, Promise<void>>();
const activeReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
const queuedReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
const pendingSends = new Map<string, { message: string; sessionIds: string[]; createdAt: number }>();
const pendingBinds = new Map<string, { sessionIds: string[]; createdAt: number }>();
const pendingInputs = new Map<string, { kind: "send"; createdAt: number }>();
const chatTypeMap = new Map<string, QQChatType>();
let qqDb: Database.Database | null = null;

function notificationLanguage(account: NotificationAccountRecord) {
  return String((account.config as Record<string, unknown>).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function localizedText(account: NotificationAccountRecord, zh: string, en: string) {
  return notificationLanguage(account) === "en-US" ? en : zh;
}

function csvList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function qqUi(account: NotificationAccountRecord) {
  const en = notificationLanguage(account) === "en-US";
  return {
    noSessions: en ? "No sessions yet." : "暂无会话。",
    noAvailableSessions: en ? "No sessions are available. Create a session first." : "当前没有可用会话，请先创建一个会话。",
    selectSessionToSend: en ? "Select a session to send this message:" : "请选择一个会话发送这条消息：",
    selectSessionToBind: en ? "Select a session to bind this chat to:" : "请选择一个会话绑定当前聊天：",
    replyHint: en ? "Reply with the number, title, or session ID." : "回复序号、标题或会话 ID 即可。",
    canceled: en ? "Canceled." : "已取消。",
    pendingExpired: en ? "Pending input expired." : "待处理输入已过期。",
    sessionNotFound: en ? "Session not found. Use /sessions to view recent sessions." : "未找到会话，请先用 /sessions 查看最近会话。",
    boundSessionCleared: en ? "Bound session cleared." : "已清除绑定会话。",
    sendPrompt: en ? "Send me the message text." : "请发送消息内容。",
    messageEmpty: en ? "Message is empty. Use /send <sessionId or title> | <message>." : "消息为空，请使用 /send <会话ID或标题> | <消息>。",
    selectionExpired: en ? "This selection expired. Please start again." : "这次选择已过期，请重新开始。",
    boundTo: en ? "Bound to:" : "已绑定：",
    botTitle: en ? "Codex Web QQ Bot" : "Codex Web QQ 机器人",
    sessionsCommand: en ? "/sessions - list recent sessions" : "/sessions - 列出最近会话",
    bindCommand: en ? "/bind - bind this chat to a session" : "/bind - 将当前聊天绑定到某个会话",
    unbindCommand: en ? "/unbind - clear the bound session" : "/unbind - 清除绑定的会话",
    sendCommand: en ? "/send <index, title, or sessionId> | <message> - send to a session" : "/send <序号、标题或 sessionId> | <消息> - 向会话发送消息",
    sendCommandNoBind: en ? "/send <message> - choose a session when no session is bound" : "/send <消息> - 未绑定时选择一个会话",
    replyBehaviorTitle: en ? "Reply behavior:" : "回复规则：",
    replyBehaviorBound: en ? "- Bound/default session: plain text goes into that session and assistant replies are sent back here." : "- 已绑定/默认会话：普通文本会进入该会话，助手回复会发回这里。",
    replyBehaviorSend: en ? "- /send: sends one message to the chosen session and the assistant reply for that round is sent back here." : "- /send：向选定会话发送一条消息，本轮助手回复会发回这里。",
    plainTextHint: en ? "Plain text is sent to the bound/default session, or asks you to choose one." : "普通文本会发送到已绑定/默认会话，或者让你先选择一个会话。",
    currentChatId: en ? "Current chat ID:" : "当前聊天 ID：",
  } as const;
}

function qqHelpText(account: NotificationAccountRecord, chatId?: string) {
  const ui = qqUi(account);
  return [
    ui.botTitle,
    "",
    ui.sessionsCommand,
    ui.bindCommand,
    ui.unbindCommand,
    ui.sendCommand,
    ui.sendCommandNoBind,
    "",
    ui.replyBehaviorTitle,
    ui.replyBehaviorBound,
    ui.replyBehaviorSend,
    ui.plainTextHint,
    ...(chatId ? ["", `${ui.currentChatId} ${chatId}`] : []),
  ].join("\n");
}

function qqSessionCategory(session: SessionSummary) {
  if (session.conversationType === "automation") return "Automation";
  if (session.conversationType === "room") return "Room";
  if (session.conversationType === "agent") return "Agent";
  return "Codex";
}

function qqSessionChoices(sessions: SessionSummary[], limit = 8) {
  const categoryOrder = new Map<string, number>([
    ["Codex", 0],
    ["Agent", 1],
    ["Room", 2],
    ["Automation", 3],
  ]);
  return sessions
    .slice()
    .filter((session) => !(session.conversationType === "agent" && session.roomId))
    .sort((a, b) => {
      const categoryDiff = (categoryOrder.get(qqSessionCategory(a)) ?? 99) - (categoryOrder.get(qqSessionCategory(b)) ?? 99);
      if (categoryDiff !== 0) return categoryDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, limit);
}

function qqSessionLabel(account: NotificationAccountRecord, session: SessionSummary, index?: number) {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = session.id.length > 12 ? `${session.id.slice(0, 12)}...` : session.id;
  const category = notificationLanguage(account) === "en-US" ? qqSessionCategory(session) : session.conversationType === "automation" ? "自动化" : qqSessionCategory(session);
  return `${prefix}[${category}] ${session.title} (${shortId})`;
}

function qqGroupedSessionText(account: NotificationAccountRecord, sessions: SessionSummary[], limit = 12) {
  const order = ["Codex", "Agent", "Room", "Automation"] as const;
  const choices = qqSessionChoices(sessions, limit);
  const ui = qqUi(account);
  const sections = order
    .map((category) => {
      const rows = choices
        .map((session, index) => ({ session, index }))
        .filter(({ session }) => qqSessionCategory(session) === category)
        .map(({ session, index }) => `${qqSessionLabel(account, session, index)}\n${session.status} · ${session.updatedAt}\n${session.id}`);
      const title = notificationLanguage(account) === "en-US" ? category : category === "Automation" ? "自动化" : category;
      return rows.length ? [`${title}:`, ...rows].join("\n\n") : "";
    })
    .filter(Boolean);
  return sections.length ? sections.join("\n\n") : ui.noSessions;
}

function configOf(account: NotificationAccountRecord) {
  return account.config as Record<string, unknown>;
}

function isInboundEnabled(account: NotificationAccountRecord) {
  return configOf(account).inboundEnabled === true;
}

function normalizeTargetType(value: unknown) {
  const raw = String(value ?? "user").trim().toLowerCase();
  return raw === "group" || raw === "channel" ? raw : "user";
}

function qqMessageContent(event: NotificationEventInput) {
  return `${event.title}\n\n${event.message}`.trim().slice(0, 4000);
}

async function getAccessToken(account: NotificationAccountRecord) {
  const config = configOf(account);
  const appId = String(config.appId ?? "").trim();
  const clientSecret = String(config.clientSecret ?? config.appSecret ?? "").trim();
  if (!appId) throw new Error("qq_app_id_required");
  if (!clientSecret) throw new Error("qq_client_secret_required");
  const cacheKey = `${appId}\u0000${clientSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(text.slice(0, 500) || `qq_token_http_${response.status}`);
  const data = text ? JSON.parse(text) as Record<string, unknown> : {};
  const token = String(data.access_token ?? "").trim();
  if (!token) throw new Error("qq_access_token_missing");
  const expiresIn = Number(data.expires_in ?? 7200) || 7200;
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

async function getGatewayUrl(account: NotificationAccountRecord) {
  const token = await getAccessToken(account);
  const response = await fetch(`${API_BASE}/gateway`, {
    headers: {
      accept: "application/json",
      authorization: `QQBot ${token}`,
    },
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(text.slice(0, 500) || `qq_gateway_http_${response.status}`);
  const data = text ? JSON.parse(text) as Record<string, unknown> : {};
  const url = String(data.url ?? "").trim();
  if (!url) throw new Error("qq_gateway_url_missing");
  return { url, token };
}

function routeKey(accountId: string, chatId: string) {
  return `${accountId}:${chatId}`;
}

function routeContext(accountId: string, chatId: string) {
  const row = (qqDb?.prepare("select session_id from qq_chat_routes where account_id = ? and chat_id = ?").get(accountId, chatId) as { session_id?: string } | undefined);
  return row?.session_id ?? null;
}

function resolveRouteSession(account: NotificationAccountRecord, chatId: string, sessions: SessionSummary[]) {
  const sessionId = routeContext(account.id, chatId) ?? String(configOf(account).defaultSessionId ?? "");
  return sessionId ? sessions.find((item) => item.id === sessionId) ?? null : null;
}

function setRouteSession(accountId: string, chatId: string, sessionId: string) {
  qqDb?.prepare(`
    insert into qq_chat_routes (account_id, chat_id, session_id, updated_at)
    values (?, ?, ?, ?)
    on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at
  `)?.run(accountId, chatId, sessionId, new Date().toISOString());
}

function clearRouteSession(accountId: string, chatId: string) {
  qqDb?.prepare("delete from qq_chat_routes where account_id = ? and chat_id = ?").run(accountId, chatId);
}

function replyTargetsForSession(sessionId: string) {
  const deduped = new Map<string, { accountId: string; chatId: string }>();
  const now = Date.now();
  const rows = (qqDb?.prepare("select account_id, chat_id from qq_chat_routes where session_id = ?").all(sessionId) as Array<{ account_id?: string; chat_id?: string }>) ?? [];
  for (const row of rows) {
    const accountId = String(row.account_id ?? "").trim();
    const chatId = String(row.chat_id ?? "").trim();
    if (accountId && chatId) deduped.set(`${accountId}:${chatId}`, { accountId, chatId });
  }
  for (const item of activeReplyTargets.get(sessionId) ?? []) {
    if (now - item.createdAt < 30 * 60 * 1000) deduped.set(`${item.accountId}:${item.chatId}`, { accountId: item.accountId, chatId: item.chatId });
  }
  return [...deduped.values()];
}

function recordReplyTarget(list: Array<{ accountId: string; chatId: string; createdAt: number }> | undefined, accountId: string, chatId: string) {
  const createdAt = Date.now();
  const filtered = (list ?? []).filter((item) => createdAt - item.createdAt < 30 * 60 * 1000);
  if (!filtered.some((item) => item.accountId === accountId && item.chatId === chatId)) filtered.push({ accountId, chatId, createdAt });
  return filtered;
}

function queueActiveReplyTarget(sessionId: string, accountId: string, chatId: string) {
  activeReplyTargets.set(sessionId, recordReplyTarget(activeReplyTargets.get(sessionId), accountId, chatId));
}

function queueQueuedReplyTarget(queueId: string, accountId: string, chatId: string) {
  queuedReplyTargets.set(queueId, recordReplyTarget(queuedReplyTargets.get(queueId), accountId, chatId));
}

function activateReplyTargetsFromQueue(sessionId: string, queueId: string) {
  const pending = queuedReplyTargets.get(queueId) ?? [];
  queuedReplyTargets.delete(queueId);
  if (!pending.length) return;
  activeReplyTargets.set(sessionId, recordReplyTarget(activeReplyTargets.get(sessionId), pending[0].accountId, pending[0].chatId));
  for (const item of pending.slice(1)) queueActiveReplyTarget(sessionId, item.accountId, item.chatId);
}

function clearActiveReplyTargets(sessionId: string) {
  activeReplyTargets.delete(sessionId);
}

function outboundQueueKey(accountId: string, chatId: string) {
  return `${accountId}:${chatId}`;
}

async function sendQQText(account: NotificationAccountRecord, chatId: string, content: string, replyTo?: string | null) {
  if (!content.trim()) return;
  const config = configOf(account);
  const accessToken = await getAccessToken(account);
  const chatType = chatTypeMap.get(chatId) ?? normalizeTargetType(config.targetType);
  const path = chatType === "group"
    ? `/v2/groups/${chatId}/messages`
    : chatType === "channel"
      ? `/channels/${chatId}/messages`
      : `/v2/users/${chatId}/messages`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `QQBot ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      msg_type: 0,
      content: content.slice(0, 4000),
      msg_seq: Math.floor(Date.now() / 1000) % 65535,
      ...(replyTo ? { msg_id: replyTo } : {}),
    }),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(text.slice(0, 500) || `qq_http_${response.status}`);
}

function enqueueQQText(account: NotificationAccountRecord, chatId: string, content: string) {
  const key = outboundQueueKey(account.id, chatId);
  const previous = outboundQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => sendQQText(account, chatId, content));
  outboundQueues.set(key, next.finally(() => {
    if (outboundQueues.get(key) === next) outboundQueues.delete(key);
  }));
  return next;
}

function formatSessionReply(session: SessionSummary, content: string) {
  const title = session.title?.trim() || session.id;
  const body = content.trim();
  return body ? `[${title}]\n\n${body}` : `[${title}]`;
}

async function sendQQNotification(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
  const targetId = String(target?.chatId ?? configOf(account).targetId ?? "").trim();
  if (!targetId) throw new Error("qq_target_id_required");
  await sendQQText(account, targetId, qqMessageContent(event));
  return { responseStatus: 200 };
}

function parseGatewayMessage(raw: unknown): QQGatewayPayload | null {
  if (typeof raw !== "string") return null;
  try {
    const payload = JSON.parse(raw) as QQGatewayPayload;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function qqMessageText(message: QQMessage) {
  return String(message.content ?? "").trim();
}

function qqMessageChatId(eventType: string, message: QQMessage) {
  if (eventType === "C2C_MESSAGE_CREATE") return String(message.from_user_id ?? message.author?.id ?? "").trim();
  if (eventType === "GROUP_AT_MESSAGE_CREATE") return String(message.group_openid ?? "").trim();
  if (eventType === "DIRECT_MESSAGE_CREATE") return String(message.guild_id ?? message.channel_id ?? "").trim();
  if (eventType === "GUILD_MESSAGE_CREATE" || eventType === "GUILD_AT_MESSAGE_CREATE") return String(message.channel_id ?? "").trim();
  return String(message.group_openid ?? message.channel_id ?? message.guild_id ?? message.from_user_id ?? "").trim();
}

function qqMessageUserId(eventType: string, message: QQMessage) {
  if (eventType === "C2C_MESSAGE_CREATE") return String(message.from_user_id ?? message.author?.id ?? "").trim();
  if (eventType === "GROUP_AT_MESSAGE_CREATE") return String(message.author?.member_openid ?? message.from_user_id ?? "").trim();
  if (eventType === "DIRECT_MESSAGE_CREATE") return String(message.author?.id ?? "").trim();
  if (eventType === "GUILD_MESSAGE_CREATE" || eventType === "GUILD_AT_MESSAGE_CREATE") return String(message.author?.id ?? "").trim();
  return String(message.from_user_id ?? "").trim();
}

async function routeSendMessage(
  account: NotificationAccountRecord,
  chatId: string,
  message: string,
  sessions: SessionSummary[],
  dispatchMessageToSession: DispatchMessageToSession,
) {
  const target = resolveRouteSession(account, chatId, sessions);
  if (!target) {
    await sendSessionPicker(account, chatId, message, sessions);
    return;
  }
  const result = dispatchMessageToSession(target, `QQ message from chat ${chatId}:\n\n${message}`);
  setRouteSession(account.id, chatId, target.id);
  if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
  else queueActiveReplyTarget(target.id, account.id, chatId);
}

async function sendSessionPicker(account: NotificationAccountRecord, chatId: string, message: string, sessions: SessionSummary[]) {
  const ui = qqUi(account);
  const choices = qqSessionChoices(sessions);
  if (!choices.length) {
    await sendQQText(account, chatId, ui.noAvailableSessions);
    return;
  }
  pendingSends.set(routeKey(account.id, chatId), { message, sessionIds: choices.map((session) => session.id), createdAt: Date.now() });
  await sendQQText(account, chatId, [ui.selectSessionToSend, ...choices.map((session, index) => qqSessionLabel(account, session, index)), "", ui.replyHint].join("\n"));
}

async function sendBindPicker(account: NotificationAccountRecord, chatId: string, sessions: SessionSummary[]) {
  const ui = qqUi(account);
  const choices = qqSessionChoices(sessions);
  if (!choices.length) {
    await sendQQText(account, chatId, ui.noAvailableSessions);
    return;
  }
  pendingBinds.set(routeKey(account.id, chatId), { sessionIds: choices.map((session) => session.id), createdAt: Date.now() });
  await sendQQText(account, chatId, [ui.selectSessionToBind, ...choices.map((session, index) => qqSessionLabel(account, session, index)), "", ui.replyHint].join("\n"));
}

function resolveSelection(account: NotificationAccountRecord, chatId: string, raw: string, sessions: SessionSummary[], resolveTelegramTargetSession: ResolveTelegramTargetSession) {
  const pendingKey = routeKey(account.id, chatId);
  const pendingSend = pendingSends.get(pendingKey);
  const pendingBind = pendingBinds.get(pendingKey);
  const text = raw.trim();
  if (pendingSend) {
    if (Date.now() - pendingSend.createdAt > 10 * 60 * 1000) {
      pendingSends.delete(pendingKey);
      return { error: "expired" as const };
    }
    const numericIndex = Number(text);
    const selectedId = Number.isInteger(numericIndex) && numericIndex >= 1 ? pendingSend.sessionIds[numericIndex - 1] : null;
    const target = selectedId ? sessions.find((session) => session.id === selectedId) ?? null : resolveTelegramTargetSession(text);
    if (!target) return { error: "session_not_found" as const };
    return { kind: "send" as const, target, message: pendingSend.message };
  }
  if (pendingBind) {
    if (Date.now() - pendingBind.createdAt > 10 * 60 * 1000) {
      pendingBinds.delete(pendingKey);
      return { error: "expired" as const };
    }
    const numericIndex = Number(text);
    const selectedId = Number.isInteger(numericIndex) && numericIndex >= 1 ? pendingBind.sessionIds[numericIndex - 1] : null;
    const target = selectedId ? sessions.find((session) => session.id === selectedId) ?? null : resolveTelegramTargetSession(text);
    if (!target) return { error: "session_not_found" as const };
    return { kind: "bind" as const, target };
  }
  return null;
}

async function handleQQMessage(
  account: NotificationAccountRecord,
  eventType: string,
  message: QQMessage,
  deps: Pick<QQPlatformDeps, "sessions" | "dispatchMessageToSession" | "resolveTelegramTargetSession">,
) {
  const chatId = qqMessageChatId(eventType, message);
  if (!chatId) return;
  const userId = qqMessageUserId(eventType, message);
  const text = qqMessageText(message);
  const contextToken = String(message.context_token ?? "").trim() || null;
  const config = configOf(account);
  const allowedChatIds = csvList(config.allowedChatIds);
  const allowedUserIds = csvList(config.allowedUserIds);
  if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return;
  if (allowedUserIds.length && userId && !allowedUserIds.includes(userId)) return;
  chatTypeMap.set(chatId, eventType === "C2C_MESSAGE_CREATE" ? "c2c" : eventType === "GROUP_AT_MESSAGE_CREATE" ? "group" : eventType === "DIRECT_MESSAGE_CREATE" ? "dm" : "guild");
  if (!text) return;
  if (text === "/cancel") {
    pendingSends.delete(routeKey(account.id, chatId));
    pendingBinds.delete(routeKey(account.id, chatId));
    pendingInputs.delete(routeKey(account.id, chatId));
    await sendQQText(account, chatId, qqUi(account).canceled);
    return;
  }

  const pendingInput = pendingInputs.get(routeKey(account.id, chatId));
  if (pendingInput) {
    if (Date.now() - pendingInput.createdAt > 10 * 60 * 1000) {
      pendingInputs.delete(routeKey(account.id, chatId));
      await sendQQText(account, chatId, qqUi(account).pendingExpired);
      return;
    }
    pendingInputs.delete(routeKey(account.id, chatId));
    if (pendingInput.kind === "send") {
      await routeSendMessage(account, chatId, text, visibleSessions(deps), deps.dispatchMessageToSession);
      return;
    }
  }

  const [rawCommand, ...restParts] = text.split(/\s+/);
  const command = rawCommand.replace(/@[^@\s]+$/, "");
  const rest = restParts.join(" ").trim();
  const route = resolveRouteSession(account, chatId, deps.sessions);

  if (command === "/start" || command === "/help") {
    await sendQQText(account, chatId, qqHelpText(account, chatId));
    return;
  }
  if (command === "/sessions") {
    await sendQQText(account, chatId, qqGroupedSessionText(account, visibleSessions(deps), 12));
    return;
  }
  if (command === "/bind") {
    if (!rest) {
      await sendBindPicker(account, chatId, visibleSessions(deps));
      return;
    }
    const target = deps.resolveTelegramTargetSession(rest);
    if (!target) {
      await sendQQText(account, chatId, qqUi(account).sessionNotFound);
      return;
    }
    setRouteSession(account.id, chatId, target.id);
    if (contextToken) setRouteSession(account.id, chatId, target.id);
    await sendQQText(account, chatId, `${qqUi(account).boundTo} ${target.title}\n${target.id}`);
    return;
  }
  if (command === "/unbind") {
    clearRouteSession(account.id, chatId);
    await sendQQText(account, chatId, qqUi(account).boundSessionCleared);
    return;
  }
  if (command === "/send") {
    if (!rest) {
      pendingInputs.set(routeKey(account.id, chatId), { kind: "send", createdAt: Date.now() });
      await sendQQText(account, chatId, qqUi(account).sendPrompt);
      return;
    }
    const separator = rest.indexOf("|");
    const targetText = separator >= 0 ? rest.slice(0, separator).trim() : "";
    const messageText = separator >= 0 ? rest.slice(separator + 1).trim() : rest;
    if (!messageText) {
      await sendQQText(account, chatId, qqUi(account).messageEmpty);
      return;
    }
    if (!targetText) {
      await routeSendMessage(account, chatId, messageText, visibleSessions(deps), deps.dispatchMessageToSession);
      return;
    }
    const target = deps.resolveTelegramTargetSession(targetText);
    if (!target) {
      await sendQQText(account, chatId, qqUi(account).sessionNotFound);
      return;
    }
    const result = deps.dispatchMessageToSession(target, `QQ message from chat ${chatId}:\n\n${messageText}`);
    setRouteSession(account.id, chatId, target.id);
    if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueActiveReplyTarget(target.id, account.id, chatId);
    return;
  }

  const selection = resolveSelection(account, chatId, text, visibleSessions(deps), deps.resolveTelegramTargetSession);
  if (selection) {
    if ("error" in selection) {
      await sendQQText(account, chatId, selection.error === "expired" ? qqUi(account).selectionExpired : qqUi(account).sessionNotFound);
      return;
    }
    if (selection.kind === "send") {
      pendingSends.delete(routeKey(account.id, chatId));
      const result = deps.dispatchMessageToSession(selection.target, `QQ message from chat ${chatId}:\n\n${selection.message}`);
      setRouteSession(account.id, chatId, selection.target.id);
      if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
      else queueActiveReplyTarget(selection.target.id, account.id, chatId);
      return;
    }
    if (selection.kind === "bind") {
      pendingBinds.delete(routeKey(account.id, chatId));
      setRouteSession(account.id, chatId, selection.target.id);
      await sendQQText(account, chatId, `${qqUi(account).boundTo} ${selection.target.title}\n${selection.target.id}`);
      return;
    }
  }

  if (!route) {
    await routeSendMessage(account, chatId, text, visibleSessions(deps), deps.dispatchMessageToSession);
    return;
  }
  const result = deps.dispatchMessageToSession(route, `QQ message from chat ${chatId}:\n\n${text}`);
  setRouteSession(account.id, chatId, route.id);
  if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
  else queueActiveReplyTarget(route.id, account.id, chatId);
}

function startRuntime(account: NotificationAccountRecord, deps: QQPlatformDeps) {
  const existing = runtimes.get(account.id);
  const config = configOf(account);
  const runtimeKey = [
    String(config.appId ?? "").trim(),
    String(config.clientSecret ?? config.appSecret ?? "").trim(),
  ].join("\u0000");
  if (existing && existing.key === runtimeKey) return existing;
  stopRuntime(account.id);
  const runtime: QQRuntime = {
    accountId: account.id,
    key: runtimeKey,
    ws: null,
    heartbeatTimer: null,
    reconnectTimer: null,
    sessionId: "",
    lastSeq: null,
    closed: false,
    heartbeatIntervalMs: 30_000,
  };
  const connect = async () => {
    if (runtime.closed) return;
    try {
      const { url, token } = await getGatewayUrl(account);
      const ws = new WebSocket(url);
      runtime.ws = ws;
      ws.on("open", () => {
        ws.send(JSON.stringify({ op: 2, d: { token: `QQBot ${token}`, intents: (1 << 25) | (1 << 30) | (1 << 12) | (1 << 26), shard: [0, 1], properties: { $os: "linux", $browser: "codex-web", $device: "codex-web" } } }));
      });
      ws.on("message", (data) => {
        const payload = parseGatewayMessage(String(data));
        if (!payload) return;
        if (typeof payload.s === "number" && (runtime.lastSeq === null || payload.s > runtime.lastSeq)) runtime.lastSeq = payload.s;
        if (payload.op === 10 && payload.d && typeof payload.d === "object") {
          const hello = payload.d as Record<string, unknown>;
          const intervalMs = Number(hello.heartbeat_interval ?? 30000) || 30000;
          runtime.heartbeatIntervalMs = Math.max(1000, Math.floor(intervalMs * 0.8));
          if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
          runtime.heartbeatTimer = setInterval(() => {
            if (runtime.ws && runtime.ws.readyState === WebSocket.OPEN) runtime.ws.send(JSON.stringify({ op: 1, d: runtime.lastSeq }));
          }, runtime.heartbeatIntervalMs);
          if (runtime.sessionId && runtime.lastSeq !== null) {
            ws.send(JSON.stringify({ op: 6, d: { token: `QQBot ${token}`, session_id: runtime.sessionId, seq: runtime.lastSeq } }));
          } else {
            ws.send(JSON.stringify({ op: 2, d: { token: `QQBot ${token}`, intents: (1 << 25) | (1 << 30) | (1 << 12) | (1 << 26), shard: [0, 1], properties: { $os: "linux", $browser: "codex-web", $device: "codex-web" } } }));
          }
          return;
        }
        if (payload.op === 0 && payload.t === "READY" && payload.d && typeof payload.d === "object") {
          runtime.sessionId = String((payload.d as Record<string, unknown>).session_id ?? "");
          return;
        }
        if (payload.op === 0 && payload.t && payload.d && typeof payload.d === "object") {
          const message = payload.d as QQMessage;
          const eventType = payload.t;
          if (["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "DIRECT_MESSAGE_CREATE", "GUILD_MESSAGE_CREATE", "GUILD_AT_MESSAGE_CREATE"].includes(eventType)) {
            void handleQQMessage(account, eventType, message, deps).catch((error) => {
              console.warn("qq inbound update failed", account.id, error instanceof Error ? error.message : error);
            });
          }
        }
      });
      ws.on("close", () => {
        if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
        runtime.heartbeatTimer = null;
        runtime.ws = null;
        if (!runtime.closed && account.enabled && isInboundEnabled(account)) {
          runtime.reconnectTimer = setTimeout(() => connect().catch(() => undefined), 5000);
        }
      });
      ws.on("error", () => undefined);
    } catch (error) {
      if (!runtime.closed) runtime.reconnectTimer = setTimeout(() => connect().catch(() => undefined), 5000);
      console.warn("qq connect failed", account.id, error instanceof Error ? error.message : error);
    }
  };
  void connect();
  runtimes.set(account.id, runtime);
  return runtime;
}

function stopRuntime(accountId: string) {
  const runtime = runtimes.get(accountId);
  if (!runtime) return;
  runtime.closed = true;
  if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  runtime.ws?.close();
  runtimes.delete(accountId);
}

function syncConnections(accounts: NotificationAccountRecord[], deps: QQPlatformDeps) {
  const activeIds = new Set(
    accounts.filter((account) => account.enabled && account.channelKind === "qq" && isInboundEnabled(account)).map((account) => account.id),
  );
  for (const account of accounts) {
    const runtime = runtimes.get(account.id);
    const shouldRun = activeIds.has(account.id);
    if (shouldRun) startRuntime(account, deps);
    else if (runtime) stopRuntime(account.id);
  }
}

function forwardAssistantMessageToQQ(accountList: ListNotificationAccounts, session: SessionSummary, message: { role?: string; content: string }) {
  if (message.role !== "assistant") return;
  const destinations = replyTargetsForSession(session.id);
  if (!destinations.length) return;
  const accounts = new Map(accountList(true).filter((account) => account.enabled && account.channelKind === "qq").map((account) => [account.id, account] as const));
  const text = formatSessionReply(session, message.content);
  for (const destination of destinations) {
    const account = accounts.get(destination.accountId);
    if (!account) continue;
    void enqueueQQText(account, destination.chatId, text).catch((error) => {
      console.warn("qq reply forward failed", destination.accountId, destination.chatId, error instanceof Error ? error.message : error);
    });
  }
}

export function createQQPlatform(deps: QQPlatformDeps) {
  qqDb = deps.db;
  return {
    start() {
      syncConnections(deps.listNotificationAccounts(true), deps);
    },
    shutdown() {
      for (const accountId of [...runtimes.keys()]) stopRuntime(accountId);
      outboundQueues.clear();
      activeReplyTargets.clear();
      queuedReplyTargets.clear();
      pendingSends.clear();
      pendingBinds.clear();
      pendingInputs.clear();
      chatTypeMap.clear();
    },
    syncConnections() {
      syncConnections(deps.listNotificationAccounts(true), deps);
    },
    sendNotification: sendQQNotification,
    qqHelpText,
    forwardAssistantMessageToQQ: (session: SessionSummary, message: { role?: string; content: string }) => forwardAssistantMessageToQQ(deps.listNotificationAccounts, session, message),
    handleMessage(account: NotificationAccountRecord, eventType: string, message: QQMessage) {
      return handleQQMessage(account, eventType, message, deps);
    },
    clearActiveReplyTargets,
    activateReplyTargetFromQueue: activateReplyTargetsFromQueue,
  };
}
