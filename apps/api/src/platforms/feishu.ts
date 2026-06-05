import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  Client,
  Domain,
  EventDispatcher,
  LoggerLevel,
  WSClient,
} from "@larksuiteoapi/node-sdk";
import type {
  NotificationAccountSummary,
  NotificationEventType,
  NotificationRuleTarget,
  NotificationSeverity,
  SessionMessage,
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
type TelegramSessionLabel = (...args: any[]) => string;
type TelegramGroupedSessionText = (limit?: number) => string;
type ListNotificationAccounts = (exposeSecrets?: boolean) => NotificationAccountSummary[];

type FeishuPlatformDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  listNotificationAccounts: ListNotificationAccounts;
  dispatchMessageToSession: DispatchMessageToSession;
  resolveTelegramTargetSession: ResolveTelegramTargetSession;
  telegramSessionChoices: TelegramSessionChoices;
  telegramSessionLabel: TelegramSessionLabel;
  telegramGroupedSessionText: TelegramGroupedSessionText;
};

type FeishuAccountConfig = Record<string, unknown>;
type FeishuReplyTarget = { accountId: string; chatId: string; createdAt: number };
type FeishuRuntime = {
  accountId: string;
  runtimeKey: string;
  client: Client;
  wsClient: WSClient;
  startPromise: Promise<void>;
};

function notificationLanguage(account: NotificationAccountRecord) {
  return String((account.config as Record<string, unknown>).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function localizedText(account: NotificationAccountRecord, zh: string, en: string) {
  return notificationLanguage(account) === "en-US" ? en : zh;
}

function feishuUi(account: NotificationAccountRecord) {
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
    sendPrompt: en ? "Send the message content in your next reply." : "请在下一条消息里发送内容。",
    messageEmpty: en ? "Message is empty. Use /send <sessionId or title> | <message>." : "消息为空，请使用 /send <会话ID或标题> | <消息>。",
    selectionExpired: en ? "This selection expired. Please start again." : "这次选择已过期，请重新开始。",
    boundTo: en ? "Bound to:" : "已绑定：",
    createdAndBoundSession: en ? "Created and bound session:" : "已创建并绑定会话：",
    botTitle: en ? "Codex Web Feishu Bot" : "Codex Web 飞书机器人",
    sessionsCommand: en ? "/sessions - list recent sessions" : "/sessions - 列出最近会话",
    bindCommand: en ? "/bind - bind this chat to a session" : "/bind - 将当前聊天绑定到某个会话",
    unbindCommand: en ? "/unbind - clear the bound session" : "/unbind - 清除绑定的会话",
    sendCommand: en ? "/send <index, title, or sessionId> | <message> - send to a session" : "/send <序号、标题或 sessionId> | <消息> - 向会话发送消息",
    sendCommandNoBind: en ? "/send <message> - choose a session when no session is bound" : "/send <消息> - 未绑定时选择一个会话",
    replyBehaviorTitle: en ? "Reply behavior:" : "回复规则：",
    replyBehaviorBound: en ? "- Bound/default session: plain text goes into that session and assistant replies are sent back here." : "- 已绑定/默认会话：普通文本会进入该会话，助手回复会发回这里。",
    replyBehaviorSend: en ? "- /send: sends one message to the chosen session and the assistant reply for that round is sent back here." : "- /send：向选定会话发送一条消息，本轮助手回复会发回这里。",
    plainTextHint: en ? "Plain text is sent to the bound/default session, or asks you to choose one." : "普通文本会发送到已绑定/默认会话，或者让你先选择一个会话。",
    helpTitle: en ? "Usage:" : "用法：",
  } as const;
}

function feishuHelpText(account: NotificationAccountRecord) {
  const ui = feishuUi(account);
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

function normalizeDomain(value: unknown) {
  const raw = String(value ?? "feishu").trim().toLowerCase();
  return raw === "lark" ? Domain.Lark : Domain.Feishu;
}

function normalizeDomainName(value: unknown) {
  const raw = String(value ?? "feishu").trim().toLowerCase();
  return raw === "lark" ? "lark" : "feishu";
}

function createFeishuClient(account: NotificationAccountRecord) {
  const config = account.config as FeishuAccountConfig;
  const appId = String(config.appId ?? "").trim();
  const appSecret = String(config.appSecret ?? "").trim();
  if (!appId) throw new Error("feishu_app_id_required");
  if (!appSecret) throw new Error("feishu_app_secret_required");
  return new Client({
    appId,
    appSecret,
    domain: normalizeDomain(config.domain),
    loggerLevel: LoggerLevel.error,
  });
}

function splitFeishuText(content: string, maxLength = 3900) {
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

function parseFeishuText(message: { message_type?: string; content?: string }) {
  const rawType = String(message.message_type ?? "").trim().toLowerCase();
  const rawContent = String(message.content ?? "");
  if (!rawContent) return "";
  try {
    const payload = JSON.parse(rawContent) as Record<string, unknown>;
    if (rawType === "text") return String(payload.text ?? "").trim();
    if (typeof payload.text === "string") return payload.text.trim();
    if (typeof payload.content === "string") return payload.content.trim();
    return rawContent.trim();
  } catch {
    return rawContent.trim();
  }
}

function feishuAccountRuntimeKey(account: NotificationAccountRecord) {
  const config = account.config as FeishuAccountConfig;
  return [
    normalizeDomainName(config.domain),
    String(config.appId ?? "").trim(),
    String(config.appSecret ?? "").trim(),
    String(config.connectionMode ?? "websocket").trim().toLowerCase() || "websocket",
    String(config.encryptKey ?? "").trim(),
    String(config.verificationToken ?? "").trim(),
  ].join("\u0000");
}

export function createFeishuPlatform(deps?: FeishuPlatformDeps) {
  const db = deps?.db;
  const sessions: SessionSummary[] = deps?.sessions ?? [];
  const listNotificationAccounts: ListNotificationAccounts = deps?.listNotificationAccounts ?? (() => []);
  const dispatchMessageToSession: DispatchMessageToSession = deps?.dispatchMessageToSession ?? (() => ({ mode: "started" } as DispatchResult));
  const resolveTelegramTargetSession: ResolveTelegramTargetSession = deps?.resolveTelegramTargetSession ?? (() => null);
  const telegramSessionChoices: TelegramSessionChoices = deps?.telegramSessionChoices ?? (() => sessions);
  const telegramSessionLabel: TelegramSessionLabel = deps?.telegramSessionLabel ?? ((...args: any[]) => {
    const session = args.find((item) => item && typeof item === "object" && "title" in item) as SessionSummary | undefined;
    return session?.title ?? "";
  });
  const telegramGroupedSessionText: TelegramGroupedSessionText = deps?.telegramGroupedSessionText ?? (() => sessions.map((item) => item.title).join("\n"));

  const pendingSends = new Map<string, { message: string; sessionIds: string[]; createdAt: number }>();
  const pendingBinds = new Map<string, { sessionIds: string[]; createdAt: number }>();
  const pendingInputs = new Map<string, { kind: "send"; createdAt: number }>();
  const queuedReplyTargets = new Map<string, FeishuReplyTarget[]>();
  const activeReplyTargets = new Map<string, FeishuReplyTarget[]>();
  const outboundQueues = new Map<string, Promise<void>>();
  const runtimes = new Map<string, FeishuRuntime>();
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;

  function feishuPendingKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function feishuOutboundQueueKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function setFeishuRouteSession(accountId: string, chatId: string, sessionId: string) {
    if (!db) return;
    db.prepare(`
      create table if not exists feishu_chat_routes (
        account_id text not null,
        chat_id text not null,
        session_id text not null,
        updated_at text not null,
        primary key (account_id, chat_id)
      )
    `).run();
    db.prepare(`
      insert into feishu_chat_routes (account_id, chat_id, session_id, updated_at)
      values (?, ?, ?, ?)
      on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at
    `).run(accountId, chatId, sessionId, new Date().toISOString());
  }

  function clearFeishuRouteSession(accountId: string, chatId: string) {
    if (!db) return;
    db.prepare("delete from feishu_chat_routes where account_id = ? and chat_id = ?").run(accountId, chatId);
  }

  function feishuRouteSession(account: NotificationAccountRecord, chatId: string) {
    if (!db) return null;
    const row = db.prepare("select session_id from feishu_chat_routes where account_id = ? and chat_id = ?").get(account.id, chatId) as { session_id?: string } | undefined;
    const sessionId = row?.session_id ?? String((account.config as FeishuAccountConfig).defaultSessionId ?? "");
    return sessionId ? sessions.find((session) => session.id === sessionId) ?? null : null;
  }

  function appendFeishuReplyTarget(current: FeishuReplyTarget[] | undefined, accountId: string, chatId: string) {
    const createdAt = Date.now();
    const filtered = (current ?? []).filter((item) => createdAt - item.createdAt < 30 * 60 * 1000);
    if (!filtered.some((item) => item.accountId === accountId && item.chatId === chatId)) {
      filtered.push({ accountId, chatId, createdAt });
    }
    return filtered;
  }

  function queueFeishuQueuedReplyTarget(queueId: string, accountId: string, chatId: string) {
    queuedReplyTargets.set(queueId, appendFeishuReplyTarget(queuedReplyTargets.get(queueId), accountId, chatId));
  }

  function queueFeishuActiveReplyTarget(sessionId: string, accountId: string, chatId: string) {
    activeReplyTargets.set(sessionId, appendFeishuReplyTarget(activeReplyTargets.get(sessionId), accountId, chatId));
  }

  function activateFeishuReplyTargetFromQueue(sessionId: string, queueId: string) {
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

  function clearFeishuActiveReplyTargets(sessionId: string) {
    activeReplyTargets.delete(sessionId);
  }

  function boundFeishuReplyTargets(sessionId: string) {
    if (!db) return [];
    return (db.prepare("select account_id, chat_id from feishu_chat_routes where session_id = ?").all(sessionId) as Array<{ account_id?: string; chat_id?: string }>)
      .map((row) => ({ accountId: String(row.account_id ?? ""), chatId: String(row.chat_id ?? "") }))
      .filter((item) => item.accountId && item.chatId);
  }

  function feishuReplyDestinations(sessionId: string) {
    const deduped = new Map<string, { accountId: string; chatId: string }>();
    const active = activeReplyTargets.get(sessionId) ?? [];
    const now = Date.now();
    for (const item of [...boundFeishuReplyTargets(sessionId), ...active.filter((entry) => now - entry.createdAt < 30 * 60 * 1000)]) {
      deduped.set(`${item.accountId}:${item.chatId}`, item);
    }
    return [...deduped.values()];
  }

  async function sendFeishuTextRaw(account: NotificationAccountRecord, chatId: string, text: string) {
    const client = createFeishuClient(account);
    const chunks = splitFeishuText(text);
    for (const chunk of chunks.length ? chunks : [""]) {
      const response = await client.im.v1.message.create({
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: chunk }),
          uuid: randomUUID(),
        },
        params: {
          receive_id_type: "chat_id",
        },
      });
      if (!response || response.code !== 0) {
        throw new Error(response?.msg?.slice(0, 500) || "feishu_http_error");
      }
    }
  }

  function enqueueFeishuText(account: NotificationAccountRecord, chatId: string, text: string) {
    const key = feishuOutboundQueueKey(account.id, chatId);
    const previous = outboundQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => sendFeishuTextRaw(account, chatId, text));
    outboundQueues.set(key, next.finally(() => {
      if (outboundQueues.get(key) === next) outboundQueues.delete(key);
    }));
    return next;
  }

  async function sendFeishuSessionPicker(account: NotificationAccountRecord, chatId: string, message: string) {
    const ui = feishuUi(account);
    const choices = telegramSessionChoices(12);
    if (!choices.length) {
      await sendFeishuTextRaw(account, chatId, ui.noAvailableSessions);
      return;
    }
    pendingSends.set(feishuPendingKey(account.id, chatId), {
      message,
      sessionIds: choices.map((session) => session.id),
      createdAt: Date.now(),
    });
    await sendFeishuTextRaw(account, chatId, [
      ui.selectSessionToSend,
      telegramGroupedSessionText(12),
      "",
      ui.replyHint,
    ].join("\n"));
  }

  async function sendFeishuBindPicker(account: NotificationAccountRecord, chatId: string) {
    const ui = feishuUi(account);
    const choices = telegramSessionChoices(12);
    if (!choices.length) {
      await sendFeishuTextRaw(account, chatId, ui.noAvailableSessions);
      return;
    }
    pendingBinds.set(feishuPendingKey(account.id, chatId), {
      sessionIds: choices.map((session) => session.id),
      createdAt: Date.now(),
    });
    await sendFeishuTextRaw(account, chatId, [
      ui.selectSessionToBind,
      ...choices.map((session, index) => telegramSessionLabel(account, session, index)),
      "",
      ui.replyHint,
    ].join("\n"));
  }

  function resolveFeishuSelection(account: NotificationAccountRecord, chatId: string, raw: string) {
    const pendingKey = feishuPendingKey(account.id, chatId);
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
      const target = selectedId
        ? sessions.find((session) => session.id === selectedId) ?? null
        : resolveTelegramTargetSession(targetText);
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
      const target = selectedId
        ? sessions.find((session) => session.id === selectedId) ?? null
        : resolveTelegramTargetSession(targetText);
      if (!target) return { error: "session_not_found" as const };
      return { kind: "bind" as const, target };
    }
    return null;
  }

  async function routeFeishuSendMessage(account: NotificationAccountRecord, chatId: string, message: string) {
    const target = feishuRouteSession(account, chatId);
    if (!target) {
      await sendFeishuSessionPicker(account, chatId, message);
      return;
    }
    const result = dispatchMessageToSession(target, `Feishu message from chat ${chatId}:\n\n${message}`);
    setFeishuRouteSession(account.id, chatId, target.id);
    if (result.mode === "queued" && result.queuedId) queueFeishuQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueFeishuActiveReplyTarget(target.id, account.id, chatId);
  }

  async function handleFeishuMessage(account: NotificationAccountRecord, message: {
    sender?: { sender_type?: string; sender_id?: { open_id?: string; user_id?: string; union_id?: string } };
    message?: { message_id?: string; chat_id?: string; message_type?: string; content?: string; chat_type?: string };
  }) {
    const senderType = String(message.sender?.sender_type ?? "").trim().toLowerCase();
    if (senderType === "bot" || senderType === "app") return;
    const chatId = String(message.message?.chat_id ?? "").trim();
    const messageId = String(message.message?.message_id ?? "").trim();
    if (!chatId || !messageId) return;
    const text = parseFeishuText({
      message_type: message.message?.message_type,
      content: message.message?.content,
    }).trim();
    if (!text) return;

    if (text === "/cancel") {
      pendingSends.delete(feishuPendingKey(account.id, chatId));
      pendingBinds.delete(feishuPendingKey(account.id, chatId));
      pendingInputs.delete(feishuPendingKey(account.id, chatId));
      await sendFeishuTextRaw(account, chatId, feishuUi(account).canceled);
      return;
    }

    const pendingInput = pendingInputs.get(feishuPendingKey(account.id, chatId));
    if (pendingInput) {
      if (Date.now() - pendingInput.createdAt > 10 * 60 * 1000) {
        pendingInputs.delete(feishuPendingKey(account.id, chatId));
        await sendFeishuTextRaw(account, chatId, feishuUi(account).pendingExpired);
        return;
      }
      pendingInputs.delete(feishuPendingKey(account.id, chatId));
      if (pendingInput.kind === "send") {
        await routeFeishuSendMessage(account, chatId, text);
        return;
      }
    }

    const selection = resolveFeishuSelection(account, chatId, text);
    if (selection) {
      if ("error" in selection) {
        await sendFeishuTextRaw(account, chatId, selection.error === "expired" ? feishuUi(account).selectionExpired : feishuUi(account).sessionNotFound);
        return;
      }
      if (selection.kind === "send") {
        pendingSends.delete(feishuPendingKey(account.id, chatId));
        const result = dispatchMessageToSession(selection.target, `Feishu message from chat ${chatId}:\n\n${selection.message}`);
        setFeishuRouteSession(account.id, chatId, selection.target.id);
        if (result.mode === "queued" && result.queuedId) queueFeishuQueuedReplyTarget(result.queuedId, account.id, chatId);
        else queueFeishuActiveReplyTarget(selection.target.id, account.id, chatId);
        return;
      }
      if (selection.kind === "bind") {
        pendingBinds.delete(feishuPendingKey(account.id, chatId));
        setFeishuRouteSession(account.id, chatId, selection.target.id);
        await sendFeishuTextRaw(account, chatId, `${feishuUi(account).boundTo} ${selection.target.title}\n${selection.target.id}`);
        return;
      }
    }

    const [rawCommand, ...restParts] = text.split(/\s+/);
    const command = rawCommand.replace(/@[^@\s]+$/, "");
    const rest = restParts.join(" ").trim();

    if (command === "/start" || command === "/help") {
      await sendFeishuTextRaw(account, chatId, feishuHelpText(account));
      return;
    }
    if (command === "/sessions") {
      await sendFeishuTextRaw(account, chatId, telegramGroupedSessionText(12));
      return;
    }
    if (command === "/bind") {
      if (!rest) {
        await sendFeishuBindPicker(account, chatId);
        return;
      }
      const target = resolveTelegramTargetSession(rest);
      if (!target) {
        await sendFeishuTextRaw(account, chatId, feishuUi(account).sessionNotFound);
        return;
      }
      setFeishuRouteSession(account.id, chatId, target.id);
      await sendFeishuTextRaw(account, chatId, `${feishuUi(account).boundTo} ${target.title}\n${target.id}`);
      return;
    }
    if (command === "/unbind") {
      clearFeishuRouteSession(account.id, chatId);
      await sendFeishuTextRaw(account, chatId, feishuUi(account).boundSessionCleared);
      return;
    }
    if (command === "/send") {
      if (!rest) {
        pendingInputs.set(feishuPendingKey(account.id, chatId), { kind: "send", createdAt: Date.now() });
        await sendFeishuTextRaw(account, chatId, feishuUi(account).sendPrompt);
        return;
      }
      const separator = rest.indexOf("|");
      const targetText = separator >= 0 ? rest.slice(0, separator).trim() : "";
      const messageText = separator >= 0 ? rest.slice(separator + 1).trim() : rest;
      if (!messageText) {
        await sendFeishuTextRaw(account, chatId, feishuUi(account).messageEmpty);
        return;
      }
      if (!targetText) {
        await routeFeishuSendMessage(account, chatId, messageText);
        return;
      }
      const target = resolveTelegramTargetSession(targetText);
      if (!target) {
        await sendFeishuTextRaw(account, chatId, feishuUi(account).sessionNotFound);
        return;
      }
      const result = dispatchMessageToSession(target, `Feishu message from chat ${chatId}:\n\n${messageText}`);
      setFeishuRouteSession(account.id, chatId, target.id);
      if (result.mode === "queued" && result.queuedId) queueFeishuQueuedReplyTarget(result.queuedId, account.id, chatId);
      else queueFeishuActiveReplyTarget(target.id, account.id, chatId);
      await sendFeishuTextRaw(account, chatId, `${feishuUi(account).boundTo} ${target.title}: ${result.mode}`);
      return;
    }

    const route = feishuRouteSession(account, chatId);
    if (route) {
      const result = dispatchMessageToSession(route, `Feishu message from chat ${chatId}:\n\n${text}`);
      setFeishuRouteSession(account.id, chatId, route.id);
      if (result.mode === "queued" && result.queuedId) queueFeishuQueuedReplyTarget(result.queuedId, account.id, chatId);
      else queueFeishuActiveReplyTarget(route.id, account.id, chatId);
      return;
    }

    await routeFeishuSendMessage(account, chatId, text);
  }

  function normalizeFeishuAccountRuntime(account: NotificationAccountRecord) {
    const config = account.config as FeishuAccountConfig;
    return {
      enabled: account.enabled,
      inboundEnabled: config.inboundEnabled === true,
      runtimeKey: feishuAccountRuntimeKey(account),
      connectionMode: String(config.connectionMode ?? "websocket").trim().toLowerCase() || "websocket",
      appId: String(config.appId ?? "").trim(),
      appSecret: String(config.appSecret ?? "").trim(),
    };
  }

  async function stopRuntime(accountId: string) {
    const runtime = runtimes.get(accountId);
    if (!runtime) return;
    runtimes.delete(accountId);
    try {
      runtime.wsClient.close({ force: true });
    } catch {
      // ignore
    }
    await runtime.startPromise.catch(() => undefined);
  }

  async function startRuntime(account: NotificationAccountRecord) {
    const normalized = normalizeFeishuAccountRuntime(account);
    if (!normalized.enabled || !normalized.inboundEnabled) return;
    if (!normalized.appId || !normalized.appSecret) return;
    if (normalized.connectionMode !== "websocket") {
      console.warn("[Feishu] account %s is configured for %s; only websocket long-connection mode is active for now.", account.id, normalized.connectionMode);
      return;
    }

    const existing = runtimes.get(account.id);
    if (existing && existing.runtimeKey === normalized.runtimeKey) return;
    if (existing) await stopRuntime(account.id);

    const client = createFeishuClient(account);
    const dispatcher = new EventDispatcher({
      verificationToken: String((account.config as FeishuAccountConfig).verificationToken ?? "").trim(),
      encryptKey: String((account.config as FeishuAccountConfig).encryptKey ?? "").trim(),
    });
    dispatcher.register({
      "im.message.receive_v1": async (data: {
        sender?: { sender_type?: string };
        message?: { message_id?: string; chat_id?: string; message_type?: string; content?: string; chat_type?: string };
      }) => {
        await handleFeishuMessage(account, data).catch((error) => {
          console.error("feishu inbound message failed", account.id, error);
        });
      },
    });

    const wsClient = new WSClient({
      appId: String((account.config as FeishuAccountConfig).appId ?? "").trim(),
      appSecret: String((account.config as FeishuAccountConfig).appSecret ?? "").trim(),
      domain: normalizeDomain((account.config as FeishuAccountConfig).domain),
      loggerLevel: LoggerLevel.error,
    });

    const runtime: FeishuRuntime = {
      accountId: account.id,
      runtimeKey: normalized.runtimeKey,
      client,
      wsClient,
      startPromise: Promise.resolve(),
    };
    runtimes.set(account.id, runtime);
    runtime.startPromise = wsClient.start({ eventDispatcher: dispatcher }).catch((error) => {
      console.error("feishu websocket client failed", account.id, error instanceof Error ? error.message : error);
    }).finally(() => {
      const current = runtimes.get(account.id);
      if (current && current.runtimeKey === runtime.runtimeKey) {
        runtimes.delete(account.id);
      }
    });
  }

  async function syncConnections() {
    const accounts = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "feishu" && (account.config as FeishuAccountConfig).inboundEnabled === true);
    const activeIds = new Set(accounts.map((account) => account.id));
    for (const accountId of [...runtimes.keys()]) {
      if (!activeIds.has(accountId)) {
        await stopRuntime(accountId);
      }
    }
    for (const account of accounts) {
      await startRuntime(account);
    }
  }

  function start() {
    if (reconcileTimer) return;
    setTimeout(() => {
      void syncConnections().catch((error) => {
        console.warn("feishu sync failed", error instanceof Error ? error.message : error);
      });
    }, 0);
    reconcileTimer = setInterval(() => {
      void syncConnections().catch((error) => {
        console.warn("feishu reconcile failed", error instanceof Error ? error.message : error);
      });
    }, 10_000);
    reconcileTimer.unref();
  }

  async function shutdown() {
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = null;
    for (const runtime of [...runtimes.values()]) {
      try {
        runtime.wsClient.close({ force: true });
      } catch {
        // ignore
      }
    }
    await Promise.all([...runtimes.values()].map((runtime) => runtime.startPromise.catch(() => undefined)));
    runtimes.clear();
    pendingSends.clear();
    pendingBinds.clear();
    pendingInputs.clear();
    queuedReplyTargets.clear();
    activeReplyTargets.clear();
    outboundQueues.clear();
  }

  function sendNotification(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
    const config = account.config as FeishuAccountConfig;
    const targetChatId = String(target?.chatId ?? config.testChatId ?? "").trim();
    if (!targetChatId) throw new Error("feishu_chat_id_required");
    return enqueueFeishuText(account, targetChatId, `${event.title}\n\n${event.message}`).then(() => ({ responseStatus: 200 }));
  }

  function forwardAssistantMessageToFeishu(session: SessionSummary, message: SessionMessage) {
    if (message.role !== "assistant") return;
    const destinations = feishuReplyDestinations(session.id);
    if (!destinations.length) return;
    const accounts = new Map(
      listNotificationAccounts(true)
        .filter((account) => account.enabled && account.channelKind === "feishu")
        .map((account) => [account.id, account]),
    );
    const text = formatFeishuSessionReply(session, message.content);
    for (const destination of destinations) {
      const account = accounts.get(destination.accountId);
      if (!account) continue;
      void enqueueFeishuText(account, destination.chatId, text).catch((error) => {
        console.warn("feishu reply forward failed", destination.accountId, destination.chatId, error instanceof Error ? error.message : error);
      });
    }
  }

  function formatFeishuSessionReply(session: SessionSummary, content: string) {
    const title = session.title?.trim() || session.id;
    const body = content.trim();
    return body ? `[${title}]\n\n${body}` : `[${title}]`;
  }

  return {
    start,
    shutdown,
    syncConnections,
    sendNotification,
    feishuHelpText,
    forwardAssistantMessageToFeishu,
    clearActiveReplyTargets: clearFeishuActiveReplyTargets,
    activateReplyTargetFromQueue: activateFeishuReplyTargetFromQueue,
    handleFeishuMessage,
  };
}
