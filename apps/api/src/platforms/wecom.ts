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

type WeComGatewayPayload = { cmd?: string; headers?: { req_id?: string }; body?: unknown };
type WeComMessage = {
  msgid?: string | number;
  chattype?: string;
  chatid?: string;
  from?: { userid?: string };
  text?: { content?: string };
  quote?: { text?: { content?: string } };
};
type WeComRuntime = {
  accountId: string;
  key: string;
  ws: WebSocket | null;
  subscribed: boolean;
  lastError: string | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastSeq: number | null;
  sessionId: string;
  closed: boolean;
};

type WeComPlatformDeps = {
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

function visibleSessions(deps: Pick<WeComPlatformDeps, "sessions" | "sessionVisibleInChatTools">) {
  const filter = deps.sessionVisibleInChatTools ?? (() => true);
  return deps.sessions.filter(filter);
}

const DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";
const APP_CMD_SUBSCRIBE = "aibot_subscribe";
const APP_CMD_CALLBACK = "aibot_msg_callback";
const APP_CMD_EVENT_CALLBACK = "aibot_event_callback";
const APP_CMD_SEND = "aibot_send_msg";
const APP_CMD_RESPONSE = "aibot_respond_msg";
const APP_CMD_PING = "ping";

const runtimes = new Map<string, WeComRuntime>();
const outboundQueues = new Map<string, Promise<void>>();
const activeReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
const queuedReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
const pendingSends = new Map<string, { message: string; sessionIds: string[]; createdAt: number }>();
const pendingBinds = new Map<string, { sessionIds: string[]; createdAt: number }>();
const pendingInputs = new Map<string, { kind: "send"; createdAt: number }>();
const chatReqIds = new Map<string, string>();
const replyReqIds = new Map<string, string>();
let wecomDb: Database.Database | null = null;

function configOf(account: NotificationAccountRecord) {
  return account.config as Record<string, unknown>;
}

function notificationLanguage(account: NotificationAccountRecord) {
  return String(configOf(account).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function csvList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isInboundEnabled(account: NotificationAccountRecord) {
  return configOf(account).inboundEnabled === true;
}

function updateAccountConnectionStatus(accountId: string, status: "success" | "failed", error: string | null) {
  wecomDb?.prepare("update notification_accounts set last_test_status = ?, last_error = ?, updated_at = ? where id = ?")
    .run(status, error, new Date().toISOString(), accountId);
}

function wecomUi(account: NotificationAccountRecord) {
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
    botTitle: en ? "Codex Web WeCom AI Bot" : "Codex Web 企业微信 AI Bot",
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

function wecomHelpText(account: NotificationAccountRecord, chatId?: string) {
  const ui = wecomUi(account);
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

function sessionCategory(session: SessionSummary) {
  if (session.conversationType === "automation") return "Automation";
  if (session.conversationType === "room") return "Room";
  if (session.conversationType === "agent") return "Agent";
  return "Codex";
}

function sessionChoices(sessions: SessionSummary[], limit = 8) {
  const order = new Map<string, number>([
    ["Codex", 0],
    ["Agent", 1],
    ["Room", 2],
    ["Automation", 3],
  ]);
  return sessions
    .slice()
    .filter((session) => !(session.conversationType === "agent" && session.roomId))
    .sort((a, b) => {
      const diff = (order.get(sessionCategory(a)) ?? 99) - (order.get(sessionCategory(b)) ?? 99);
      if (diff !== 0) return diff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, limit);
}

function sessionLabel(account: NotificationAccountRecord, session: SessionSummary, index?: number) {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = session.id.length > 12 ? `${session.id.slice(0, 12)}...` : session.id;
  const category = notificationLanguage(account) === "en-US" ? sessionCategory(session) : session.conversationType === "automation" ? "自动化" : sessionCategory(session);
  return `${prefix}[${category}] ${session.title} (${shortId})`;
}

function groupedSessionText(account: NotificationAccountRecord, sessions: SessionSummary[], limit = 12) {
  const choices = sessionChoices(sessions, limit);
  const ui = wecomUi(account);
  const sections = ["Codex", "Agent", "Room", "Automation"]
    .map((category) => {
      const rows = choices
        .map((session, index) => ({ session, index }))
        .filter(({ session }) => sessionCategory(session) === category)
        .map(({ session, index }) => `${sessionLabel(account, session, index)}\n${session.status} · ${session.updatedAt}\n${session.id}`);
      const title = notificationLanguage(account) === "en-US" ? category : category === "Automation" ? "自动化" : category;
      return rows.length ? [`${title}:`, ...rows].join("\n\n") : "";
    })
    .filter(Boolean);
  return sections.length ? sections.join("\n\n") : ui.noSessions;
}

function routeKey(accountId: string, chatId: string) {
  return `${accountId}:${chatId}`;
}

function routeContext(accountId: string, chatId: string) {
  const row = (wecomDb?.prepare("select session_id from wecom_chat_routes where account_id = ? and chat_id = ?").get(accountId, chatId) as { session_id?: string } | undefined);
  return row?.session_id ?? null;
}

function resolveRouteSession(account: NotificationAccountRecord, chatId: string, sessions: SessionSummary[]) {
  const sessionId = routeContext(account.id, chatId) ?? String(configOf(account).defaultSessionId ?? "");
  return sessionId ? sessions.find((item) => item.id === sessionId) ?? null : null;
}

function setRouteSession(accountId: string, chatId: string, sessionId: string) {
  wecomDb?.prepare(`
    insert into wecom_chat_routes (account_id, chat_id, session_id, updated_at)
    values (?, ?, ?, ?)
    on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at
  `).run(accountId, chatId, sessionId, new Date().toISOString());
}

function clearRouteSession(accountId: string, chatId: string) {
  wecomDb?.prepare("delete from wecom_chat_routes where account_id = ? and chat_id = ?").run(accountId, chatId);
}

function replyTargetsForSession(sessionId: string) {
  const deduped = new Map<string, { accountId: string; chatId: string }>();
  const now = Date.now();
  const rows = (wecomDb?.prepare("select account_id, chat_id from wecom_chat_routes where session_id = ?").all(sessionId) as Array<{ account_id?: string; chat_id?: string }>) ?? [];
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

function parsePayload(raw: string) {
  try {
    return JSON.parse(raw) as WeComGatewayPayload;
  } catch {
    return null;
  }
}

function messageText(message: WeComMessage) {
  return String(message.text?.content ?? message.quote?.text?.content ?? "").trim();
}

function messageChatId(message: WeComMessage) {
  return String(message.chatid ?? message.from?.userid ?? "").trim();
}

function messageUserId(message: WeComMessage) {
  return String(message.from?.userid ?? "").trim();
}

function normalizePolicy(value: unknown) {
  const raw = String(value ?? "open").trim().toLowerCase();
  return raw === "allowlist" || raw === "disabled" || raw === "open" ? raw : "open";
}

async function sendWeComText(account: NotificationAccountRecord, chatId: string, content: string, replyTo?: string | null) {
  if (!content.trim()) return;
  const ws = runtimes.get(account.id)?.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("wecom_websocket_not_connected");
  const normalizedReplyTo = String(replyTo ?? "").trim();
  const replyReqId = normalizedReplyTo && replyReqIds.get(normalizedReplyTo) ? replyReqIds.get(normalizedReplyTo) : (chatReqIds.get(chatId) ?? null);
  const cmd = replyReqId ? APP_CMD_RESPONSE : APP_CMD_SEND;
  const body = replyReqId
    ? { msgtype: "markdown", markdown: { content: content.slice(0, 4000) } }
    : { chatid: chatId, msgtype: "markdown", markdown: { content: content.slice(0, 4000) } };
  const reqId = replyReqId ?? randomUUID();
  const payload = JSON.stringify({ cmd, headers: { req_id: reqId }, body });
  ws.send(payload);
}

function enqueueWeComText(account: NotificationAccountRecord, chatId: string, content: string) {
  const key = outboundQueueKey(account.id, chatId);
  const previous = outboundQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => sendWeComText(account, chatId, content));
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

async function sendNotification(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
  const chatId = String(target?.chatId ?? configOf(account).testChatId ?? "").trim();
  if (!chatId) throw new Error("wecom_chat_id_required");
  await sendWeComText(account, chatId, `${event.title}\n\n${event.message}`.trim());
  return { responseStatus: 200 };
}

async function sendSessionPicker(account: NotificationAccountRecord, chatId: string, message: string, sessions: SessionSummary[]) {
  const ui = wecomUi(account);
  const choices = sessionChoices(sessions);
  if (!choices.length) {
    await sendWeComText(account, chatId, ui.noAvailableSessions);
    return;
  }
  pendingSends.set(routeKey(account.id, chatId), { message, sessionIds: choices.map((session) => session.id), createdAt: Date.now() });
  await sendWeComText(account, chatId, [ui.selectSessionToSend, ...choices.map((session, index) => sessionLabel(account, session, index)), "", ui.replyHint].join("\n"));
}

async function sendBindPicker(account: NotificationAccountRecord, chatId: string, sessions: SessionSummary[]) {
  const ui = wecomUi(account);
  const choices = sessionChoices(sessions);
  if (!choices.length) {
    await sendWeComText(account, chatId, ui.noAvailableSessions);
    return;
  }
  pendingBinds.set(routeKey(account.id, chatId), { sessionIds: choices.map((session) => session.id), createdAt: Date.now() });
  await sendWeComText(account, chatId, [ui.selectSessionToBind, ...choices.map((session, index) => sessionLabel(account, session, index)), "", ui.replyHint].join("\n"));
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

async function routeSendMessage(account: NotificationAccountRecord, chatId: string, message: string, sessions: SessionSummary[], dispatchMessageToSession: DispatchMessageToSession) {
  const target = resolveRouteSession(account, chatId, sessions);
  if (!target) {
    await sendSessionPicker(account, chatId, message, sessions);
    return;
  }
  const result = dispatchMessageToSession(target, `WeCom message from chat ${chatId}:\n\n${message}`);
  setRouteSession(account.id, chatId, target.id);
  if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
  else queueActiveReplyTarget(target.id, account.id, chatId);
}

async function handleWeComMessage(
  account: NotificationAccountRecord,
  message: WeComMessage,
  reqId: string,
  deps: Pick<WeComPlatformDeps, "sessions" | "sessionVisibleInChatTools" | "dispatchMessageToSession" | "resolveTelegramTargetSession">,
) {
  const chatId = messageChatId(message);
  if (!chatId) return;
  const userId = messageUserId(message);
  const config = configOf(account);
  const allowedFrom = csvList(config.allowFrom ?? config.allow_from);
  const groupAllowedFrom = csvList(config.groupAllowFrom ?? config.group_allow_from);
  const dmPolicy = normalizePolicy(config.dmPolicy);
  const groupPolicy = normalizePolicy(config.groupPolicy);
  const isGroup = String(message.chattype ?? "").toLowerCase() === "group";
  if (isGroup) {
    if (groupPolicy === "disabled") return;
    if (groupPolicy === "allowlist" && !groupAllowedFrom.includes(chatId)) return;
    if (allowedFrom.length && userId && !allowedFrom.includes(userId)) return;
  } else {
    if (dmPolicy === "disabled") return;
    if (dmPolicy === "allowlist" && userId && !allowedFrom.includes(userId)) return;
  }
  const text = messageText(message);
  if (!text) return;
  const normalizedReqId = String(reqId ?? "").trim();
  if (normalizedReqId) chatReqIds.set(chatId, normalizedReqId);
  const messageId = String(message.msgid ?? randomUUID()).trim();
  if (normalizedReqId) replyReqIds.set(messageId, normalizedReqId);
  const pendingKey = routeKey(account.id, chatId);
  if (text === "/cancel") {
    pendingSends.delete(pendingKey);
    pendingBinds.delete(pendingKey);
    pendingInputs.delete(pendingKey);
    await sendWeComText(account, chatId, wecomUi(account).canceled);
    return;
  }
  const pendingInput = pendingInputs.get(pendingKey);
  if (pendingInput) {
    if (Date.now() - pendingInput.createdAt > 10 * 60 * 1000) {
      pendingInputs.delete(pendingKey);
      await sendWeComText(account, chatId, wecomUi(account).pendingExpired);
      return;
    }
    pendingInputs.delete(pendingKey);
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
    await sendWeComText(account, chatId, wecomHelpText(account, chatId));
    return;
  }
  if (command === "/sessions") {
    await sendWeComText(account, chatId, groupedSessionText(account, visibleSessions(deps), 12));
    return;
  }
  if (command === "/bind") {
    if (!rest) {
      await sendBindPicker(account, chatId, visibleSessions(deps));
      return;
    }
    const target = deps.resolveTelegramTargetSession(rest);
    if (!target) {
      await sendWeComText(account, chatId, wecomUi(account).sessionNotFound);
      return;
    }
    setRouteSession(account.id, chatId, target.id);
    await sendWeComText(account, chatId, `${wecomUi(account).boundTo} ${target.title}\n${target.id}`);
    return;
  }
  if (command === "/unbind") {
    clearRouteSession(account.id, chatId);
    await sendWeComText(account, chatId, wecomUi(account).boundSessionCleared);
    return;
  }
  if (command === "/send") {
    if (!rest) {
      pendingInputs.set(pendingKey, { kind: "send", createdAt: Date.now() });
      await sendWeComText(account, chatId, wecomUi(account).sendPrompt);
      return;
    }
    const separator = rest.indexOf("|");
    const targetText = separator >= 0 ? rest.slice(0, separator).trim() : "";
    const messageText = separator >= 0 ? rest.slice(separator + 1).trim() : rest;
    if (!messageText) {
      await sendWeComText(account, chatId, wecomUi(account).messageEmpty);
      return;
    }
    if (!targetText) {
      await routeSendMessage(account, chatId, messageText, visibleSessions(deps), deps.dispatchMessageToSession);
      return;
    }
    const target = deps.resolveTelegramTargetSession(targetText);
    if (!target) {
      await sendWeComText(account, chatId, wecomUi(account).sessionNotFound);
      return;
    }
    const result = deps.dispatchMessageToSession(target, `WeCom message from chat ${chatId}:\n\n${messageText}`);
    setRouteSession(account.id, chatId, target.id);
    if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueActiveReplyTarget(target.id, account.id, chatId);
    return;
  }

  const selection = resolveSelection(account, chatId, text, visibleSessions(deps), deps.resolveTelegramTargetSession);
  if (selection) {
    if ("error" in selection) {
      await sendWeComText(account, chatId, selection.error === "expired" ? wecomUi(account).selectionExpired : wecomUi(account).sessionNotFound);
      return;
    }
    if (selection.kind === "send") {
      pendingSends.delete(pendingKey);
      const result = deps.dispatchMessageToSession(selection.target, `WeCom message from chat ${chatId}:\n\n${selection.message}`);
      setRouteSession(account.id, chatId, selection.target.id);
      if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
      else queueActiveReplyTarget(selection.target.id, account.id, chatId);
      return;
    }
    if (selection.kind === "bind") {
      pendingBinds.delete(pendingKey);
      setRouteSession(account.id, chatId, selection.target.id);
      await sendWeComText(account, chatId, `${wecomUi(account).boundTo} ${selection.target.title}\n${selection.target.id}`);
      return;
    }
  }

  if (!route) {
    await routeSendMessage(account, chatId, text, visibleSessions(deps), deps.dispatchMessageToSession);
    return;
  }
  const result = deps.dispatchMessageToSession(route, `WeCom message from chat ${chatId}:\n\n${text}`);
  setRouteSession(account.id, chatId, route.id);
  if (result.mode === "queued" && result.queuedId) queueQueuedReplyTarget(result.queuedId, account.id, chatId);
  else queueActiveReplyTarget(route.id, account.id, chatId);
}

async function sendRequest(ws: WebSocket, cmd: string, body: Record<string, unknown>, reqId: string = randomUUID()) {
  ws.send(JSON.stringify({ cmd, headers: { req_id: reqId }, body }));
  return reqId;
}

function startRuntime(account: NotificationAccountRecord, deps: WeComPlatformDeps) {
  const existing = runtimes.get(account.id);
  const config = configOf(account);
  const botId = String(config.botId ?? "").trim();
  const secret = String(config.secret ?? "").trim();
  const websocketUrl = String(config.websocketUrl ?? DEFAULT_WS_URL).trim() || DEFAULT_WS_URL;
  if (!botId || !secret) {
    stopRuntime(account.id);
    updateAccountConnectionStatus(account.id, "failed", "WeCom AI Bot ID and secret are required for inbound messages.");
    return null;
  }
  const runtimeKey = [botId, secret, websocketUrl].join("\u0000");
  if (existing && existing.key === runtimeKey) return existing;
  stopRuntime(account.id);
  const runtime: WeComRuntime = {
    accountId: account.id,
    key: runtimeKey,
    ws: null,
    subscribed: false,
    lastError: null,
    heartbeatTimer: null,
    reconnectTimer: null,
    lastSeq: null,
    sessionId: "",
    closed: false,
  };
  const connect = async () => {
    if (runtime.closed) return;
    try {
      const ws = new WebSocket(websocketUrl);
      runtime.ws = ws;
      ws.on("open", () => {
        const subscribeReqId = `subscribe-${randomUUID()}`;
        void sendRequest(ws, APP_CMD_SUBSCRIBE, {
          bot_id: botId,
          secret,
          device_id: runtime.accountId,
        }, subscribeReqId).catch(() => undefined);
      });
      ws.on("message", (data) => {
        const payload = parsePayload(String(data));
        if (!payload) return;
        const reqId = String(payload.headers?.req_id ?? "").trim();
        if (reqId) replyReqIds.set(reqId, reqId);
        if (reqId && reqId.startsWith("subscribe")) {
          const body = payload.body && typeof payload.body === "object" ? payload.body as Record<string, unknown> : {};
          const errcode = Number(body.errcode ?? body.err_code ?? (payload as Record<string, unknown>).errcode ?? (payload as Record<string, unknown>).err_code ?? 0);
          if (errcode) {
            const errmsg = String(body.errmsg ?? body.message ?? (payload as Record<string, unknown>).errmsg ?? (payload as Record<string, unknown>).message ?? "subscription failed").trim();
            runtime.subscribed = false;
            runtime.lastError = `WeCom AI Bot subscribe failed: ${errmsg} (${errcode})`;
            updateAccountConnectionStatus(account.id, "failed", runtime.lastError);
            ws.close();
            return;
          }
          runtime.subscribed = true;
          runtime.lastError = null;
          updateAccountConnectionStatus(account.id, "success", null);
          return;
        }
        if (payload.cmd === APP_CMD_PING || payload.cmd === APP_CMD_EVENT_CALLBACK) return;
        if (payload.cmd === APP_CMD_CALLBACK && payload.body && typeof payload.body === "object") {
          void handleWeComMessage(account, payload.body as WeComMessage, reqId, deps).catch((error) => {
            console.warn("wecom inbound update failed", account.id, error instanceof Error ? error.message : error);
          });
          return;
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
      ws.on("error", (error) => {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        updateAccountConnectionStatus(account.id, "failed", runtime.lastError);
      });
      runtime.heartbeatTimer = setInterval(() => {
        if (runtime.ws && runtime.ws.readyState === WebSocket.OPEN) void sendRequest(runtime.ws, APP_CMD_PING, {}).catch(() => undefined);
      }, 30_000);
    } catch (error) {
      if (!runtime.closed) runtime.reconnectTimer = setTimeout(() => connect().catch(() => undefined), 5000);
      console.warn("wecom connect failed", account.id, error instanceof Error ? error.message : error);
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

function syncConnections(accounts: NotificationAccountRecord[], deps: WeComPlatformDeps) {
  const activeIds = new Set(accounts.filter((account) => account.enabled && account.channelKind === "wecom" && isInboundEnabled(account)).map((account) => account.id));
  for (const account of accounts) {
    const runtime = runtimes.get(account.id);
    const shouldRun = activeIds.has(account.id);
    if (shouldRun) startRuntime(account, deps);
    else if (runtime) stopRuntime(account.id);
  }
}

function connectionStatus(account: NotificationAccountRecord) {
  const config = configOf(account);
  const botId = String(config.botId ?? "").trim();
  const secret = String(config.secret ?? "").trim();
  const runtime = runtimes.get(account.id);
  if (!account.enabled) return { ok: false, status: "disabled", error: "WeCom AI Bot account is disabled." };
  if (!isInboundEnabled(account)) return { ok: false, status: "inbound_disabled", error: "WeCom AI Bot inbound messages are disabled." };
  if (!botId || !secret) return { ok: false, status: "missing_credentials", error: "WeCom AI Bot ID and secret are required." };
  if (!runtime) return { ok: false, status: "not_connected", error: "WeCom AI Bot connection is not running yet." };
  if (runtime.lastError) return { ok: false, status: "failed", error: runtime.lastError };
  if (runtime.subscribed && runtime.ws?.readyState === WebSocket.OPEN) return { ok: true, status: "connected", error: null };
  if (runtime.ws?.readyState === WebSocket.OPEN) return { ok: false, status: "subscribing", error: "WeCom AI Bot connection is open but subscription is not confirmed yet." };
  return { ok: false, status: "not_connected", error: "WeCom AI Bot websocket is not connected." };
}

function forwardAssistantMessageToWeCom(accountList: ListNotificationAccounts, session: SessionSummary, message: { role?: string; content: string }) {
  if (message.role !== "assistant") return;
  const destinations = replyTargetsForSession(session.id);
  if (!destinations.length) return;
  const accounts = new Map(accountList(true).filter((account) => account.enabled && account.channelKind === "wecom").map((account) => [account.id, account] as const));
  const text = formatSessionReply(session, message.content);
  for (const destination of destinations) {
    const account = accounts.get(destination.accountId);
    if (!account) continue;
    void enqueueWeComText(account, destination.chatId, text).catch((error) => {
      console.warn("wecom reply forward failed", destination.accountId, destination.chatId, error instanceof Error ? error.message : error);
    });
  }
}

export function createWeComPlatform(deps: WeComPlatformDeps) {
  wecomDb = deps.db;
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
      chatReqIds.clear();
      replyReqIds.clear();
    },
    syncConnections() {
      syncConnections(deps.listNotificationAccounts(true), deps);
    },
    connectionStatus,
    sendNotification,
    wecomHelpText,
    forwardAssistantMessageToWeCom: (session: SessionSummary, message: { role?: string; content: string }) => forwardAssistantMessageToWeCom(deps.listNotificationAccounts, session, message),
    clearActiveReplyTargets,
    activateReplyTargetFromQueue: activateReplyTargetsFromQueue,
  };
}
