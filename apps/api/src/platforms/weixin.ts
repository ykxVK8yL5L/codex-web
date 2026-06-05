import type Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
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
type ListNotificationAccounts = (exposeSecrets?: boolean) => NotificationAccountSummary[];

type WeixinUpdate = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

type WeixinMessage = {
  message_id?: string | number;
  from_user_id?: string | number;
  to_user_id?: string | number;
  room_id?: string | number;
  chat_room_id?: string | number;
  context_token?: string;
  msg_type?: number;
  item_list?: Array<Record<string, unknown>>;
};

type WeixinQrLoginState = {
  qrKey: string;
  accountId: string;
  persistAccountId?: string | null;
  botType: string;
  status: "wait" | "scaned" | "scaned_but_redirect" | "expired" | "confirmed" | "error";
  qrcode: string;
  qrcodeUrl: string;
  baseUrl: string;
  currentBaseUrl: string;
  refreshCount: number;
  createdAt: string;
  updatedAt: string;
  redirectHost?: string | null;
  accountIdValue?: string;
  token?: string;
  userId?: string;
  error?: string;
};

type WeixinPlatformDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  sessionVisibleInChatTools?: (session: SessionSummary) => boolean;
  listNotificationAccounts: ListNotificationAccounts;
  dispatchMessageToSession: DispatchMessageToSession;
  resolveTelegramTargetSession: ResolveTelegramTargetSession;
  telegramSessionChoices: (limit?: number) => SessionSummary[];
  telegramSessionLabel: (session: SessionSummary, index?: number) => string;
  telegramGroupedSessionText: (limit?: number) => string;
};

function notificationLanguage(account: NotificationAccountRecord) {
  return String((account.config as Record<string, unknown>).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function localizedText(account: NotificationAccountRecord, zh: string, en: string) {
  return notificationLanguage(account) === "en-US" ? en : zh;
}

function weixinLocalizedCategory(account: NotificationAccountRecord, category: "Codex" | "Agent" | "Room" | "Automation") {
  const zhMap: Record<typeof category, string> = {
    Codex: "Codex",
    Agent: "Agent",
    Room: "Room",
    Automation: "自动化",
  };
  return notificationLanguage(account) === "en-US" ? category : zhMap[category];
}

function weixinUi(account: NotificationAccountRecord) {
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
    createdAndBoundSession: en ? "Created and bound session:" : "已创建并绑定会话：",
    botTitle: en ? "Codex Web Weixin Bot" : "Codex Web 微信机器人",
    sessionsCommand: en ? "/sessions - list recent sessions" : "/sessions - 列出最近会话",
    bindCommand: en ? "/bind - bind this chat to a session" : "/bind - 将当前聊天绑定到某个会话",
    unbindCommand: en ? "/unbind - clear the bound session" : "/unbind - 清除绑定的会话",
    sendCommand: en ? "/send <index, title, or sessionId> | <message> - send to a session" : "/send <序号、标题或 sessionId> | <消息> - 向会话发送消息",
    sendCommandNoBind: en ? "/send <message> - choose a session when no session is bound" : "/send <消息> - 未绑定时选择一个会话",
    replyBehaviorTitle: en ? "Reply behavior:" : "回复规则：",
    replyBehaviorBound: en ? "- Bound/default session: plain text goes into that session and assistant replies are sent back here." : "- 已绑定/默认会话：普通文本会进入该会话，助手回复会发回这里。",
    replyBehaviorSend: en ? "- /send: sends one message to the chosen session and the assistant reply for that round is sent back here." : "- /send：向选定会话发送一条消息，本轮助手回复会发回这里。",
    plainTextHint: en ? "Plain text is sent to the bound/default session, or asks you to choose one." : "普通文本会发送到已绑定/默认会话，或者让你先选择一个会话。",
  } as const;
}

function weixinHelpText(account: NotificationAccountRecord) {
  const ui = weixinUi(account);
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
  ].join("\n");
}

function csvList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function weixinSessionCategory(session: SessionSummary) {
  if (session.conversationType === "automation") return "Automation";
  if (session.conversationType === "room") return "Room";
  if (session.conversationType === "agent") return "Agent";
  return "Codex";
}

function weixinSessionChoices(sessions: SessionSummary[], limit = 8) {
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
      const categoryDiff = (categoryOrder.get(weixinSessionCategory(a)) ?? 99) - (categoryOrder.get(weixinSessionCategory(b)) ?? 99);
      if (categoryDiff !== 0) return categoryDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, limit);
}

function weixinSessionLabel(account: NotificationAccountRecord, session: SessionSummary, index?: number) {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = session.id.length > 12 ? `${session.id.slice(0, 12)}...` : session.id;
  return `${prefix}[${weixinLocalizedCategory(account, weixinSessionCategory(session))}] ${session.title} (${shortId})`;
}

function weixinGroupedSessionText(account: NotificationAccountRecord, sessions: SessionSummary[], limit = 12) {
  const order = ["Codex", "Agent", "Room", "Automation"] as const;
  const choices = weixinSessionChoices(sessions, limit);
  const ui = weixinUi(account);
  const sections = order
    .map((category) => {
      const rows = choices
        .map((session, index) => ({ session, index }))
        .filter(({ session }) => weixinSessionCategory(session) === category)
        .map(({ session, index }) => `${weixinSessionLabel(account, session, index)}\n${session.status} · ${session.updatedAt}\n${session.id}`);
      return rows.length ? [`${weixinLocalizedCategory(account, category)}:`, ...rows].join("\n\n") : "";
    })
    .filter(Boolean);
  return sections.length ? sections.join("\n\n") : ui.noSessions;
}

export function createWeixinPlatform(deps: WeixinPlatformDeps) {
  const {
    db,
    sessions,
    sessionVisibleInChatTools = () => true,
    listNotificationAccounts,
    dispatchMessageToSession,
    resolveTelegramTargetSession,
  } = deps;

  function visibleChatSessions() {
    return sessions.filter(sessionVisibleInChatTools);
  }

  const pollingOffsets = new Map<string, string>();
  const pollingBusy = new Set<string>();
  const pendingSends = new Map<string, { message: string; sessionIds: string[]; createdAt: number }>();
  const pendingBinds = new Map<string, { sessionIds: string[]; createdAt: number }>();
  const queuedReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
  const activeReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
  const outboundQueues = new Map<string, Promise<void>>();
  const typingTimers = new Map<string, { timeoutId: ReturnType<typeof setTimeout>; intervalId: ReturnType<typeof setInterval>; startedAt: number }>();
  const typingTickets = new Map<string, { ticket: string; createdAt: number }>();
  const pendingInputs = new Map<string, { kind: "send"; createdAt: number }>();
  const qrLogins = new Map<string, WeixinQrLoginState>();
  let inboundTimer: ReturnType<typeof setInterval> | null = null;

  function getWeixinAccountConfig(accountId: string) {
    const row = db.prepare("select * from notification_accounts where id = ?").get(accountId) as Record<string, unknown> | undefined;
    if (!row) return null;
    let config: Record<string, unknown> = {};
    try {
      config = row.config && typeof row.config === "string" ? JSON.parse(String(row.config || "{}")) as Record<string, unknown> : {};
    } catch {
      config = {};
    }
    return { row, config };
  }

  function updateWeixinAccountConfig(accountId: string, nextConfig: Record<string, unknown>) {
    const row = db.prepare("select * from notification_accounts where id = ?").get(accountId) as Record<string, unknown> | undefined;
    if (!row) return false;
    db.prepare("update notification_accounts set config = ?, updated_at = ? where id = ?")
      .run(JSON.stringify(nextConfig), new Date().toISOString(), accountId);
    return true;
  }

  function weixinApiBase(account: NotificationAccountRecord) {
    const config = account.config as Record<string, unknown>;
    return String(config.baseUrl ?? "https://ilinkai.weixin.qq.com").trim().replace(/\/+$/, "") || "https://ilinkai.weixin.qq.com";
  }

  function weixinRandomUin() {
    return Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64");
  }

  async function weixinBotApi(account: NotificationAccountRecord, method: string, payload: Record<string, unknown>) {
    const config = account.config as Record<string, unknown>;
    if (!config.botToken) throw new Error("weixin_bot_token_required");
    const body = JSON.stringify({
      ...payload,
      base_info: { channel_version: "2.2.0" },
    });
    return fetch(`${weixinApiBase(account)}/ilink/bot/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "AuthorizationType": "ilink_bot_token",
        "X-WECHAT-UIN": weixinRandomUin(),
        "iLink-App-Id": "bot",
        "iLink-App-ClientVersion": String((2 << 16) | (2 << 8) | 0),
        authorization: `Bearer ${String(config.botToken)}`,
      },
      body,
    });
  }

  async function fetchWeixinQrCode(botType: string, baseUrl = "https://ilinkai.weixin.qq.com") {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`);
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) throw new Error(String(body?.errmsg ?? `weixin_qr_http_${response.status}`));
    const qrcode = String(body.qrcode ?? "").trim();
    if (!qrcode) throw new Error("weixin_qrcode_missing");
    return {
      qrcode,
      qrcodeUrl: String(body.qrcode_img_content ?? "").trim(),
    };
  }

  async function fetchWeixinQrStatus(currentBaseUrl: string, qrcode: string) {
    const response = await fetch(`${currentBaseUrl.replace(/\/+$/, "")}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`);
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) throw new Error(String(body?.errmsg ?? `weixin_qr_http_${response.status}`));
    return body;
  }

  function qrLoginStateForKey(qrKey: string) {
    return qrLogins.get(qrKey) ?? null;
  }

  function saveWeixinQrCredentials(accountId: string, credentials: { token: string; baseUrl: string; accountIdValue: string; userId: string }) {
    const account = getWeixinAccountConfig(accountId);
    if (!account) return false;
    const nextConfig = {
      ...account.config,
      botToken: credentials.token,
      baseUrl: credentials.baseUrl,
      accountId: credentials.accountIdValue,
      userId: credentials.userId,
    };
    updateWeixinAccountConfig(accountId, nextConfig);
    return true;
  }

  function weixinInboundAllowed(account: NotificationAccountRecord, message: WeixinMessage) {
    const config = account.config as Record<string, unknown>;
    const chatId = String(message.room_id ?? message.chat_room_id ?? message.from_user_id ?? "").trim();
    const userId = String(message.from_user_id ?? "").trim();
    const allowedChatIds = csvList(config.allowedChatIds);
    const allowedUserIds = csvList(config.allowedUserIds);
    if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return false;
    if (allowedUserIds.length && !allowedUserIds.includes(userId)) return false;
    return Boolean(chatId);
  }

  function weixinMessageChatId(message: WeixinMessage) {
    return String(message.room_id ?? message.chat_room_id ?? message.from_user_id ?? "").trim();
  }

  function weixinMessageUserId(message: WeixinMessage) {
    return String(message.from_user_id ?? "").trim();
  }

  function weixinMessageText(message: WeixinMessage) {
    const items = Array.isArray(message.item_list) ? message.item_list : [];
    for (const item of items) {
      if (Number(item.type) === 1) {
        const text = String((item.text_item as Record<string, unknown> | undefined)?.text ?? "").trim();
        if (text) return text;
      }
      if (Number(item.type) === 3) {
        const voiceText = String((item.voice_item as Record<string, unknown> | undefined)?.text ?? "").trim();
        if (voiceText) return voiceText;
      }
    }
    return "";
  }

  function weixinRouteContextToken(accountId: string, chatId: string) {
    const row = db.prepare("select context_token from weixin_chat_routes where account_id = ? and chat_id = ?").get(accountId, chatId) as { context_token?: string } | undefined;
    return String(row?.context_token ?? "").trim() || null;
  }

  function weixinRouteSession(account: NotificationAccountRecord, chatId: string) {
    const row = db.prepare("select session_id from weixin_chat_routes where account_id = ? and chat_id = ?").get(account.id, chatId) as { session_id?: string } | undefined;
    const sessionId = row?.session_id ?? String((account.config as Record<string, unknown>).defaultSessionId ?? "");
    return sessionId ? sessions.find((session) => session.id === sessionId) ?? null : null;
  }

  function setWeixinRouteSession(accountId: string, chatId: string, sessionId: string, contextToken?: string | null) {
    db.prepare(`
      insert into weixin_chat_routes (account_id, chat_id, session_id, context_token, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(account_id, chat_id) do update set session_id = excluded.session_id, context_token = excluded.context_token, updated_at = excluded.updated_at
    `).run(accountId, chatId, sessionId, contextToken ?? null, new Date().toISOString());
  }

  function clearWeixinRouteSession(accountId: string, chatId: string) {
    db.prepare("delete from weixin_chat_routes where account_id = ? and chat_id = ?").run(accountId, chatId);
  }

  function appendWeixinReplyTarget(
    current: Array<{ accountId: string; chatId: string; createdAt: number }> | undefined,
    accountId: string,
    chatId: string,
  ) {
    const createdAt = Date.now();
    const filtered = (current ?? []).filter((item) => createdAt - item.createdAt < 30 * 60 * 1000);
    if (!filtered.some((item) => item.accountId === accountId && item.chatId === chatId)) filtered.push({ accountId, chatId, createdAt });
    return filtered;
  }

  function queueWeixinQueuedReplyTarget(queueId: string, accountId: string, chatId: string) {
    queuedReplyTargets.set(queueId, appendWeixinReplyTarget(queuedReplyTargets.get(queueId), accountId, chatId));
  }

  function queueWeixinActiveReplyTarget(sessionId: string, accountId: string, chatId: string) {
    activeReplyTargets.set(sessionId, appendWeixinReplyTarget(activeReplyTargets.get(sessionId), accountId, chatId));
  }

  function activateWeixinReplyTargetFromQueue(sessionId: string, queueId: string) {
    const pending = queuedReplyTargets.get(queueId) ?? [];
    queuedReplyTargets.delete(queueId);
    if (!pending.length) return;
    const current = activeReplyTargets.get(sessionId) ?? [];
    const now = Date.now();
    activeReplyTargets.set(sessionId, [...current, ...pending].filter((item, index, items) => {
      if (now - item.createdAt >= 30 * 60 * 1000) return false;
      return items.findIndex((candidate) => candidate.accountId === item.accountId && candidate.chatId === item.chatId) === index;
    }));
  }

  function boundWeixinReplyTargets(sessionId: string) {
    return (db.prepare("select account_id, chat_id from weixin_chat_routes where session_id = ?").all(sessionId) as Array<{ account_id?: string; chat_id?: string }>)
      .map((row) => ({ accountId: String(row.account_id ?? ""), chatId: String(row.chat_id ?? "") }))
      .filter((item) => item.accountId && item.chatId);
  }

  function weixinReplyDestinations(sessionId: string) {
    const deduped = new Map<string, { accountId: string; chatId: string }>();
    const active = activeReplyTargets.get(sessionId) ?? [];
    const now = Date.now();
    for (const item of [...boundWeixinReplyTargets(sessionId), ...active.filter((entry) => now - entry.createdAt < 30 * 60 * 1000)]) {
      deduped.set(`${item.accountId}:${item.chatId}`, item);
    }
    return [...deduped.values()];
  }

  function clearWeixinActiveReplyTargets(sessionId: string) {
    activeReplyTargets.delete(sessionId);
  }

  function weixinOutboundQueueKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function weixinTypingKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function stopWeixinTyping(accountId: string, chatId: string) {
    const key = weixinTypingKey(accountId, chatId);
    const entry = typingTimers.get(key);
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    clearInterval(entry.intervalId);
    typingTimers.delete(key);
  }

  function startWeixinTyping(account: NotificationAccountRecord, chatId: string) {
    const key = weixinTypingKey(account.id, chatId);
    stopWeixinTyping(account.id, chatId);
    const typingTicket = typingTickets.get(key)?.ticket?.trim() ?? "";
    if (!typingTicket) return;
    const sendTyping = () => {
      void weixinBotApi(account, "sendtyping", {
        ilink_user_id: chatId,
        typing_ticket: typingTicket,
        status: 1,
      }).catch(() => undefined);
    };
    sendTyping();
    const intervalId = setInterval(sendTyping, 4000);
    const timeoutId = setTimeout(() => stopWeixinTyping(account.id, chatId), 90_000);
    typingTimers.set(key, { timeoutId, intervalId, startedAt: Date.now() });
  }

  async function maybeFetchWeixinTypingTicket(account: NotificationAccountRecord, chatId: string, contextToken?: string | null) {
    if (!account.enabled) return;
    const key = weixinTypingKey(account.id, chatId);
    const cached = typingTickets.get(key);
    if (cached && Date.now() - cached.createdAt < 10 * 60 * 1000) return;
    try {
      const response = await weixinBotApi(account, "getconfig", {
        ilink_user_id: chatId,
        ...(contextToken ? { context_token: contextToken } : {}),
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      const typingTicket = String(body?.typing_ticket ?? "").trim();
      if (typingTicket) typingTickets.set(key, { ticket: typingTicket, createdAt: Date.now() });
    } catch {
      return;
    }
  }

  function splitWeixinText(content: string, maxLength = 3900) {
    const text = content.trim();
    if (!text) return [];
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let current = "";
    for (const line of text.split(/\r?\n/)) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      if (line.length <= maxLength) {
        current = line;
        continue;
      }
      for (let offset = 0; offset < line.length; offset += maxLength) {
        const slice = line.slice(offset, offset + maxLength);
        if (slice.length === maxLength) chunks.push(slice);
        else current = slice;
      }
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  async function sendWeixinText(account: NotificationAccountRecord, chatId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    const config = account.config as Record<string, unknown>;
    const contextToken = weixinRouteContextToken(account.id, chatId) ?? (String(config.defaultContextToken ?? "").trim() || null);
    const chunks = splitWeixinText(text);
    let lastError: Error | null = null;
    for (const chunk of chunks.length ? chunks : [""]) {
      const response = await weixinBotApi(account, "sendmessage", {
        msg: {
          from_user_id: "",
          to_user_id: chatId,
          client_id: `codex-web-${randomUUID()}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: chunk } }],
          ...(contextToken ? { context_token: contextToken } : {}),
        },
      });
      const body = await response.text().catch(() => "");
      if (!response.ok) {
        lastError = new Error(body.slice(0, 500) || `weixin_http_${response.status}`);
        break;
      }
    }
    if (lastError) throw lastError;
  }

  function enqueueWeixinText(account: NotificationAccountRecord, chatId: string, text: string) {
    const key = weixinOutboundQueueKey(account.id, chatId);
    const previous = outboundQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => sendWeixinText(account, chatId, text));
    outboundQueues.set(key, next.finally(() => {
      if (outboundQueues.get(key) === next) outboundQueues.delete(key);
    }));
    return next;
  }

  function formatWeixinSessionReply(session: SessionSummary, content: string) {
    const title = session.title?.trim() || session.id;
    const body = content.trim();
    return body ? `[${title}]\n\n${body}` : `[${title}]`;
  }

  function forwardAssistantMessageToWeixin(session: SessionSummary, message: { role?: string; content: string }) {
    if (message.role !== "assistant") return;
    const destinations = weixinReplyDestinations(session.id);
    if (!destinations.length) return;
    const accounts = new Map(
      listNotificationAccounts(true)
        .filter((account) => account.enabled && account.channelKind === "weixin")
        .map((account) => [account.id, account]),
    );
    const text = formatWeixinSessionReply(session, message.content);
    for (const destination of destinations) {
      const account = accounts.get(destination.accountId);
      if (!account) continue;
      stopWeixinTyping(destination.accountId, destination.chatId);
      void enqueueWeixinText(account, destination.chatId, text).catch((error) => {
        console.warn("weixin reply forward failed", destination.accountId, destination.chatId, error instanceof Error ? error.message : error);
      });
    }
  }

  async function sendWeixinNotification(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
    const config = account.config as Record<string, unknown>;
    if (!config.botToken) throw new Error("weixin_bot_token_required");
    if (!target?.chatId) throw new Error("weixin_chat_id_required");
    const response = await weixinBotApi(account, "sendmessage", {
      msg: {
        from_user_id: "",
        to_user_id: target.chatId,
        client_id: `codex-web-${randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: `${event.title}\n\n${event.message}` } }],
      },
      ...(weixinRouteContextToken(account.id, target.chatId) ? { context_token: weixinRouteContextToken(account.id, target.chatId) } : {}),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(text.slice(0, 500) || `weixin_http_${response.status}`);
    return { responseStatus: response.status };
  }

  async function startWeixinQrLogin(accountId: string, botType = "3") {
    const account = getWeixinAccountConfig(accountId);
    if (!account) throw new Error("notification_account_not_found");
    const baseUrl = String(account.config.baseUrl ?? "https://ilinkai.weixin.qq.com").trim().replace(/\/+$/, "") || "https://ilinkai.weixin.qq.com";
    const qr = await fetchWeixinQrCode(botType, baseUrl);
    const state: WeixinQrLoginState = {
      qrKey: accountId,
      accountId,
      persistAccountId: accountId,
      botType,
      status: "wait",
      qrcode: qr.qrcode,
      qrcodeUrl: qr.qrcodeUrl,
      baseUrl,
      currentBaseUrl: baseUrl,
      refreshCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    qrLogins.set(accountId, state);
    return state;
  }

  async function startWeixinDraftQrLogin(botType = "3") {
    const qrKey = `draft-${randomUUID()}`;
    const baseUrl = "https://ilinkai.weixin.qq.com";
    const qr = await fetchWeixinQrCode(botType, baseUrl);
    const state: WeixinQrLoginState = {
      qrKey,
      accountId: "",
      persistAccountId: null,
      botType,
      status: "wait",
      qrcode: qr.qrcode,
      qrcodeUrl: qr.qrcodeUrl,
      baseUrl,
      currentBaseUrl: baseUrl,
      refreshCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    qrLogins.set(qrKey, state);
    return state;
  }

  async function refreshWeixinQrLogin(accountId: string) {
    const current = qrLogins.get(accountId);
    if (!current) throw new Error("weixin_qr_session_not_found");
    if (current.status === "confirmed" || current.status === "error") return current;
    try {
      const statusResp = await fetchWeixinQrStatus(current.currentBaseUrl, current.qrcode);
      const status = String(statusResp.status ?? "wait") as WeixinQrLoginState["status"];
      const next: WeixinQrLoginState = {
        ...current,
        status,
        updatedAt: new Date().toISOString(),
        redirectHost: status === "scaned_but_redirect" ? String(statusResp.redirect_host ?? "").trim() || null : undefined,
      };
      if (status === "scaned_but_redirect") {
        const redirectHost = String(statusResp.redirect_host ?? "").trim();
        if (redirectHost) next.currentBaseUrl = `https://${redirectHost}`;
      } else if (status === "expired") {
        next.refreshCount += 1;
        if (next.refreshCount > 3) {
          next.status = "error";
          next.error = "weixin_qr_expired";
        } else {
          const fresh = await fetchWeixinQrCode(next.botType, next.baseUrl);
          next.qrcode = fresh.qrcode;
          next.qrcodeUrl = fresh.qrcodeUrl;
          next.currentBaseUrl = next.baseUrl;
          next.status = "wait";
        }
      } else if (status === "confirmed") {
        const token = String(statusResp.bot_token ?? "").trim();
        const accountIdValue = String(statusResp.ilink_bot_id ?? "").trim();
        const baseUrl = String(statusResp.baseurl ?? current.baseUrl).trim().replace(/\/+$/, "") || current.baseUrl;
        const userId = String(statusResp.ilink_user_id ?? "").trim();
        if (!token || !accountIdValue) {
          next.status = "error";
          next.error = "weixin_qr_credential_incomplete";
        } else {
          next.token = token;
          next.accountIdValue = accountIdValue;
          next.baseUrl = baseUrl;
          next.currentBaseUrl = baseUrl;
          next.userId = userId;
          next.status = "confirmed";
          if (current.persistAccountId) {
            saveWeixinQrCredentials(current.persistAccountId, {
              token,
              baseUrl,
              accountIdValue,
              userId,
            });
          }
        }
      }
      qrLogins.set(accountId, next);
      return next;
    } catch (error) {
      const next: WeixinQrLoginState = {
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
      qrLogins.set(accountId, next);
      return next;
    }
  }

  async function sendWeixinHelp(account: NotificationAccountRecord, chatId: string) {
    await sendWeixinText(account, chatId, weixinHelpText(account));
  }

  async function sendWeixinSessionPicker(account: NotificationAccountRecord, chatId: string, message: string) {
    const ui = weixinUi(account);
    const choices = weixinSessionChoices(visibleChatSessions());
    if (!choices.length) {
      await sendWeixinText(account, chatId, ui.noAvailableSessions);
      return;
    }
    pendingSends.set(`${account.id}:${chatId}`, {
      message,
      sessionIds: choices.map((session) => session.id),
      createdAt: Date.now(),
    });
    await sendWeixinText(account, chatId, [
      ui.selectSessionToSend,
      ...choices.map((session, index) => `${index + 1}. ${weixinSessionLabel(account, session)}`),
      "",
      ui.replyHint,
    ].join("\n"));
  }

  async function sendWeixinBindPicker(account: NotificationAccountRecord, chatId: string) {
    const ui = weixinUi(account);
    const choices = weixinSessionChoices(visibleChatSessions());
    if (!choices.length) {
      await sendWeixinText(account, chatId, ui.noAvailableSessions);
      return;
    }
    pendingBinds.set(`${account.id}:${chatId}`, {
      sessionIds: choices.map((session) => session.id),
      createdAt: Date.now(),
    });
    await sendWeixinText(account, chatId, [
      ui.selectSessionToBind,
      ...choices.map((session, index) => `${index + 1}. ${weixinSessionLabel(account, session)}`),
      "",
      ui.replyHint,
    ].join("\n"));
  }

  async function routeWeixinSendMessage(account: NotificationAccountRecord, chatId: string, message: string) {
    const target = weixinRouteSession(account, chatId);
    if (!target) {
      await sendWeixinSessionPicker(account, chatId, message);
      return;
    }
    startWeixinTyping(account, chatId);
    const result = dispatchMessageToSession(target, `Weixin message from chat ${chatId}:\n\n${message}`);
    setWeixinRouteSession(account.id, chatId, target.id, weixinRouteContextToken(account.id, chatId));
    if (result.mode === "queued" && result.queuedId) queueWeixinQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueWeixinActiveReplyTarget(target.id, account.id, chatId);
  }

  function resolveWeixinSelection(account: NotificationAccountRecord, chatId: string, raw: string) {
    const pendingKey = `${account.id}:${chatId}`;
    const pendingSend = pendingSends.get(pendingKey);
    const pendingBind = pendingBinds.get(pendingKey);
    const targetText = raw.trim();
    if (!targetText) return null;
    if (pendingSend) {
      if (Date.now() - pendingSend.createdAt > 10 * 60 * 1000) {
        pendingSends.delete(pendingKey);
        return { error: "expired" as const };
      }
      const sessionIds = pendingSend.sessionIds;
      const numericIndex = Number(targetText);
      const selectedId = Number.isInteger(numericIndex) && numericIndex >= 1 ? sessionIds[numericIndex - 1] : null;
      const target = selectedId ? sessions.find((session) => session.id === selectedId) ?? null : resolveTelegramTargetSession(targetText);
      if (!target) return { error: "session_not_found" as const };
      return { kind: "send" as const, target, message: pendingSend.message };
    }
    if (pendingBind) {
      if (Date.now() - pendingBind.createdAt > 10 * 60 * 1000) {
        pendingBinds.delete(pendingKey);
        return { error: "expired" as const };
      }
      const sessionIds = pendingBind.sessionIds;
      const numericIndex = Number(targetText);
      const selectedId = Number.isInteger(numericIndex) && numericIndex >= 1 ? sessionIds[numericIndex - 1] : null;
      const target = selectedId ? sessions.find((session) => session.id === selectedId) ?? null : resolveTelegramTargetSession(targetText);
      if (!target) return { error: "session_not_found" as const };
      return { kind: "bind" as const, target };
    }
    return null;
  }

  async function handleWeixinMessage(account: NotificationAccountRecord, message: WeixinMessage) {
    if (!weixinInboundAllowed(account, message)) return;
    const chatId = weixinMessageChatId(message);
    if (!chatId) return;
    const userId = weixinMessageUserId(message);
    const text = weixinMessageText(message).trim();
    const contextToken = String(message.context_token ?? "").trim() || null;
    const route = weixinRouteSession(account, chatId);
    if (contextToken && route) setWeixinRouteSession(account.id, chatId, route.id, contextToken);
    void maybeFetchWeixinTypingTicket(account, userId || chatId, contextToken);
    if (!text) return;
    if (text === "/cancel") {
      pendingSends.delete(`${account.id}:${chatId}`);
      pendingBinds.delete(`${account.id}:${chatId}`);
      pendingInputs.delete(`${account.id}:${chatId}`);
      await sendWeixinText(account, chatId, weixinUi(account).canceled);
      return;
    }

    const pendingInput = pendingInputs.get(`${account.id}:${chatId}`);
    if (pendingInput) {
      if (Date.now() - pendingInput.createdAt > 10 * 60 * 1000) {
        pendingInputs.delete(`${account.id}:${chatId}`);
        await sendWeixinText(account, chatId, weixinUi(account).pendingExpired);
        return;
      }
      pendingInputs.delete(`${account.id}:${chatId}`);
      if (pendingInput.kind === "send") {
        await routeWeixinSendMessage(account, chatId, text);
        return;
      }
    }

    const [rawCommand, ...restParts] = text.split(/\s+/);
    const command = rawCommand.replace(/@[^@\s]+$/, "");
    const rest = restParts.join(" ").trim();

    if (command === "/start" || command === "/help") {
      await sendWeixinHelp(account, chatId);
      return;
    }
    if (command === "/sessions") {
      await sendWeixinText(account, chatId, weixinGroupedSessionText(account, visibleChatSessions(), 12));
      return;
    }
    if (command === "/bind") {
      if (!rest) {
        await sendWeixinBindPicker(account, chatId);
        return;
      }
      const target = resolveTelegramTargetSession(rest);
      if (!target) {
        await sendWeixinText(account, chatId, weixinUi(account).sessionNotFound);
        return;
      }
      setWeixinRouteSession(account.id, chatId, target.id, contextToken ?? undefined);
      await sendWeixinText(account, chatId, `${weixinUi(account).boundTo} ${target.title}\n${target.id}`);
      return;
    }
    if (command === "/unbind") {
      clearWeixinRouteSession(account.id, chatId);
      await sendWeixinText(account, chatId, weixinUi(account).boundSessionCleared);
      return;
    }
    if (command === "/send") {
      if (!rest) {
        pendingInputs.set(`${account.id}:${chatId}`, { kind: "send", createdAt: Date.now() });
        await sendWeixinText(account, chatId, weixinUi(account).sendPrompt);
        return;
      }
      const separator = rest.indexOf("|");
      const targetText = separator >= 0 ? rest.slice(0, separator).trim() : "";
      const messageText = separator >= 0 ? rest.slice(separator + 1).trim() : rest;
      if (!messageText) {
        await sendWeixinText(account, chatId, weixinUi(account).messageEmpty);
        return;
      }
      if (!targetText) {
        await routeWeixinSendMessage(account, chatId, messageText);
        return;
      }
      const target = resolveTelegramTargetSession(targetText);
      if (!target) {
        await sendWeixinText(account, chatId, weixinUi(account).sessionNotFound);
        return;
      }
      startWeixinTyping(account, chatId);
      const result = dispatchMessageToSession(target, `Weixin message from chat ${chatId}:\n\n${messageText}`);
      setWeixinRouteSession(account.id, chatId, target.id, contextToken ?? undefined);
      if (result.mode === "queued" && result.queuedId) queueWeixinQueuedReplyTarget(result.queuedId, account.id, chatId);
      else queueWeixinActiveReplyTarget(target.id, account.id, chatId);
      return;
    }

    const selection = resolveWeixinSelection(account, chatId, text);
    if (selection) {
      if ("error" in selection) {
        await sendWeixinText(account, chatId, selection.error === "expired" ? weixinUi(account).selectionExpired : weixinUi(account).sessionNotFound);
        return;
      }
      if (selection.kind === "send") {
        pendingSends.delete(`${account.id}:${chatId}`);
        startWeixinTyping(account, chatId);
        const result = dispatchMessageToSession(selection.target, `Weixin message from chat ${chatId}:\n\n${selection.message}`);
        setWeixinRouteSession(account.id, chatId, selection.target.id, contextToken ?? undefined);
        if (result.mode === "queued" && result.queuedId) queueWeixinQueuedReplyTarget(result.queuedId, account.id, chatId);
        else queueWeixinActiveReplyTarget(selection.target.id, account.id, chatId);
        return;
      }
      if (selection.kind === "bind") {
        pendingBinds.delete(`${account.id}:${chatId}`);
        setWeixinRouteSession(account.id, chatId, selection.target.id, contextToken ?? undefined);
        await sendWeixinText(account, chatId, `${weixinUi(account).boundTo} ${selection.target.title}\n${selection.target.id}`);
        return;
      }
    }

    if (!route) {
      await routeWeixinSendMessage(account, chatId, text);
      return;
    }
    startWeixinTyping(account, chatId);
    const result = dispatchMessageToSession(route, `Weixin message from chat ${chatId}:\n\n${text}`);
    setWeixinRouteSession(account.id, chatId, route.id, contextToken ?? undefined);
    if (result.mode === "queued" && result.queuedId) queueWeixinQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueWeixinActiveReplyTarget(route.id, account.id, chatId);
    if (userId && contextToken && route) {
      setWeixinRouteSession(account.id, chatId, route.id, contextToken);
    }
  }

  async function pollWeixinAccount(account: NotificationAccountRecord) {
    if (pollingBusy.has(account.id)) return;
    pollingBusy.add(account.id);
    try {
      const offset = pollingOffsets.get(account.id) ?? "";
      const response = await weixinBotApi(account, "getupdates", {
        get_updates_buf: offset || undefined,
      });
      const body = await response.json().catch(() => null) as WeixinUpdate | null;
      if (!response.ok || !body) return;
      if (typeof body.get_updates_buf === "string" && body.get_updates_buf.trim()) {
        pollingOffsets.set(account.id, body.get_updates_buf.trim());
      }
      if ((body.ret && body.ret !== 0) || (body.errcode && body.errcode !== 0)) return;
      for (const message of body.msgs ?? []) {
        await handleWeixinMessage(account, message).catch((error) => {
          console.error("weixin inbound update failed", account.id, error);
        });
      }
    } catch (error) {
      console.warn("weixin inbound poll failed", account.id, error instanceof Error ? error.message : error);
    } finally {
      pollingBusy.delete(account.id);
    }
  }

  function pollWeixinInboundBots() {
    try {
      const accounts = listNotificationAccounts(true)
        .filter((account) => account.enabled && account.channelKind === "weixin" && (account.config as Record<string, unknown>).inboundEnabled === true);
      for (const account of accounts) void pollWeixinAccount(account);
    } catch (error) {
      console.warn("weixin inbound poll scheduler failed", error instanceof Error ? error.message : error);
    }
  }

  function start() {
    if (inboundTimer) return;
    inboundTimer = setInterval(pollWeixinInboundBots, 10_000);
    inboundTimer.unref();
  }

  function shutdown() {
    if (inboundTimer) clearInterval(inboundTimer);
    inboundTimer = null;
    for (const entry of typingTimers.values()) {
      clearTimeout(entry.timeoutId);
      clearInterval(entry.intervalId);
    }
    typingTimers.clear();
    pollingBusy.clear();
    pollingOffsets.clear();
    pendingSends.clear();
    pendingBinds.clear();
    queuedReplyTargets.clear();
    activeReplyTargets.clear();
    outboundQueues.clear();
    typingTickets.clear();
    pendingInputs.clear();
  }

  return {
    start,
    shutdown,
    sendNotification: sendWeixinNotification,
    weixinHelpText,
    startQrLogin: startWeixinQrLogin,
    startDraftQrLogin: startWeixinDraftQrLogin,
    refreshQrLogin: refreshWeixinQrLogin,
    getQrLoginState: (accountId: string) => qrLoginStateForKey(accountId),
    forwardAssistantMessageToWeixin,
    clearActiveReplyTargets: clearWeixinActiveReplyTargets,
    activateReplyTargetFromQueue: activateWeixinReplyTargetFromQueue,
    pollWeixinInboundBots,
    handleWeixinMessage,
  };
}
