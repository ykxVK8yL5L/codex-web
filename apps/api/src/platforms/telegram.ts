import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type {
  AgentSummary,
  NotificationAccountSummary,
  SessionMessage,
  SessionSummary,
  RoomSummary,
} from "@codex-web/protocol";

type NotificationAccountRecord = NotificationAccountSummary;
type DispatchResult = { mode: string; queuedId?: string; messageId?: string };
type DispatchMessageToSession = (target: SessionSummary, content: string) => DispatchResult;

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string; title?: string; username?: string; type?: string };
    from?: { id?: number | string; username?: string; first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id?: number;
      chat?: { id?: number | string; title?: string; username?: string; type?: string };
    };
    from?: { id?: number | string; username?: string; first_name?: string };
  };
};

type TelegramPlatformDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  providers: Array<{ id: string; defaultModel?: string | null }>;
  listNotificationAccounts: (exposeSecrets?: boolean) => NotificationAccountSummary[];
  dispatchMessageToSession: DispatchMessageToSession;
  workspaceRoot: string;
  resolveShellPath: () => string;
  managedChildEnv: () => NodeJS.ProcessEnv;
  spawnProcess: typeof import("node:child_process").spawn;
  pathWithinRoot: (targetPath: string, rootPath: string) => boolean;
  resolveTerminalCwd: (inputPath?: string) => string;
  ensureScratchSessionWorkspace: (sessionId: string) => string;
  resolveAgentProject: (agent: AgentSummary) => { id: string; workspacePath: string } | null;
  upsertSession: (session: SessionSummary) => void;
  agentFromRow: (row: Record<string, unknown>) => AgentSummary;
  roomFromRow: (row: Record<string, unknown>) => RoomSummary;
};

function notificationLanguage(account: NotificationAccountRecord) {
  return String((account.config as Record<string, unknown>).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function localizedText(account: NotificationAccountRecord, zh: string, en: string) {
  return notificationLanguage(account) === "en-US" ? en : zh;
}

function telegramLocalizedCategory(account: NotificationAccountRecord, category: "Codex" | "Agent" | "Room" | "Automation") {
  const zhMap: Record<typeof category, string> = {
    Codex: "Codex",
    Agent: "Agent",
    Room: "Room",
    Automation: "自动化",
  };
  return notificationLanguage(account) === "en-US" ? category : zhMap[category];
}

function telegramUi(account: NotificationAccountRecord) {
  const en = notificationLanguage(account) === "en-US";
  return {
    noSessions: en ? "No sessions yet." : "暂无会话。",
    systemWorkspace: en ? "System workspace" : "系统工作区",
    noAvailableSessions: en ? "No sessions are available. Create a session first." : "当前没有可用会话，请先创建一个会话。",
    selectSessionToSend: en ? "Select a session to send this message:" : "请选择一个会话发送这条消息：",
    selectSessionToBind: en ? "Select a session to bind this chat to:" : "请选择一个会话绑定当前聊天：",
    selectAgentToCreate: en ? "Select an agent to create and bind a new session." : "请选择一个 Agent 来创建并绑定新会话。",
    selectRoomToBind: en ? "Select a room to bind this chat to its session." : "请选择一个 Room 来绑定当前聊天对应的会话。",
    selectFileRoot: en ? "Select a file root:" : "请选择文件根目录：",
    selectTerminalRoot: en ? "Select where to run:" : "请选择运行位置：",
    noEnabledAgents: en ? "No enabled agents are available." : "当前没有可用的已启用 Agent。",
    noRooms: en ? "No rooms are available." : "当前没有可用的 Room。",
    noFileRoots: en ? "No file roots are available." : "当前没有可用的文件根目录。",
    noTerminalRoots: en ? "No terminal roots are available." : "当前没有可用的终端根目录。",
    directoryUnavailable: en ? "Directory is not available." : "目录不可用。",
    terminalDirectoryUnavailable: en ? "Terminal directory is not available." : "终端目录不可用。",
    usageTerminal: en ? "Usage: /terminal <command>" : "用法：/terminal <命令>",
    commandBlocked: en ? "Command blocked by safety guard." : "命令已被安全规则拦截。",
    timedOut: en ? "Timed out." : "执行超时。",
    working: en ? "Working..." : "处理中...",
    showing: (start: number, end: number, total: number, page: number, totalPages: number) => {
      return en
        ? `Showing ${start}-${end} of ${total} (${page}/${totalPages})`
        : `显示 ${start}-${end} / 共 ${total}（第 ${page}/${totalPages} 页）`;
    },
    cancel: en ? "Cancel" : "取消",
    prev: en ? "Prev" : "上一页",
    next: en ? "Next" : "下一页",
    canceled: en ? "Canceled." : "已取消。",
    expiredPendingMessage: en ? "This pending message expired." : "这条待处理消息已过期。",
    expiredBindList: en ? "This bind list expired." : "这条绑定列表已过期。",
    expiredList: en ? "This list expired." : "这条列表已过期。",
    expiredAgentList: en ? "This agent list expired." : "这条 Agent 列表已过期。",
    expiredRoomList: en ? "This room list expired." : "这条 Room 列表已过期。",
    expiredFileList: en ? "This file list expired." : "这条文件列表已过期。",
    expiredTerminal: en ? "This terminal command expired." : "这条终端命令已过期。",
    invalidPage: en ? "Invalid page." : "页码无效。",
    sessionUnavailable: en ? "Session is no longer available." : "会话已不可用。",
    agentUnavailable: en ? "Agent is no longer available." : "Agent 已不可用。",
    roomUnavailable: en ? "Room session is no longer available." : "Room 会话已不可用。",
    fileRootUnavailable: en ? "File root is no longer available." : "文件根目录已不可用。",
    terminalRootUnavailable: en ? "Terminal root is no longer available." : "终端根目录已不可用。",
    messageEmpty: en ? "Message is empty. Use /send <sessionId or title> | <message>." : "消息为空，请使用 /send <会话ID或标题> | <消息>。",
    sessionNotFound: en ? "Session not found. Use /sessions to view recent sessions." : "未找到会话，请先用 /sessions 查看最近会话。",
    boundTo: en ? "Bound to:" : "已绑定：",
    boundSessionCleared: en ? "Bound session cleared." : "已清除绑定会话。",
    createdAndBoundSession: en ? "Created and bound session:" : "已创建并绑定会话：",
    boundRoomSession: en ? "Bound room session:" : "已绑定 Room 会话：",
    sentTo: en ? "Sent to" : "已发送到",
    sentMode: en ? {
      queued: "queued",
      started: "started",
      done: "done",
      failed: "failed",
    } : {
      queued: "排队中",
      started: "已开始",
      done: "已完成",
      failed: "失败",
    },
    replyRulesTitle: en ? "Reply behavior:" : "回复规则：",
    replyRuleBound: en ? "- Bound/default session: plain text goes into that session and assistant replies are sent back here." : "- 已绑定/默认会话：普通文本会进入该会话，助手回复会发回这里。",
    replyRuleSend: en ? "- /send: sends one message to the chosen session and the assistant reply for that round is sent back here." : "- /send：向选定会话发送一条消息，本轮助手回复会发回这里。",
    replyBehaviorHint: en ? "Plain text is sent to the bound/default session, or asks you to choose one." : "普通文本会发送到已绑定/默认会话，或者让你先选择一个会话。",
    botTitle: en ? "Codex Web Telegram Bot" : "Codex Web Telegram 机器人",
    sessionsCommand: en ? "/sessions - list recent sessions" : "/sessions - 列出最近会话",
    agentsCommand: en ? "/agents - list agents and create a bound agent session" : "/agents - 列出代理并创建绑定代理会话",
    roomsCommand: en ? "/rooms - list rooms and bind a room session" : "/rooms - 列出 Room 并绑定 Room 会话",
    filesCommand: en ? "/files - browse bound or system files" : "/files - 浏览绑定或系统文件",
    terminalCommand: en ? "/terminal <command> - run in bound or selected workspace" : "/terminal <命令> - 在绑定或选定的工作区运行终端命令",
    bindCommand: en ? "/bind - pick a session to bind this chat to, or /bind <index, title, or sessionId>" : "/bind - 选择会话绑定当前聊天，或 /bind <序号、标题、sessionId>",
    unbindCommand: en ? "/unbind - clear the bound session" : "/unbind - 清除绑定的会话",
    sendCommand: en ? "/send <index, title, or sessionId> | <message> - send to a session" : "/send <序号、标题或 sessionId> | <消息> - 向会话发送消息",
    sendCommandNoBind: en ? "/send <message> - choose a session when no session is bound" : "/send <消息> - 未绑定时选择会话",
    runningIn: en ? "Running in" : "运行于",
    stdout: "stdout",
    stderr: "stderr",
    exitCode: en ? "Exit code" : "退出码",
    unknown: en ? "unknown" : "未知",
  } as const;
}

function telegramConfigList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function telegramSessionCategory(session: SessionSummary) {
  if (session.conversationType === "automation") return "Automation";
  if (session.conversationType === "room") return "Room";
  if (session.conversationType === "agent") return "Agent";
  return "Codex";
}

function telegramSessionChoices(sessions: SessionSummary[], limit = 8) {
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
      const categoryDiff = (categoryOrder.get(telegramSessionCategory(a)) ?? 99) - (categoryOrder.get(telegramSessionCategory(b)) ?? 99);
      if (categoryDiff !== 0) return categoryDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, limit);
}

function telegramSessionLabel(session: SessionSummary, index?: number): string;
function telegramSessionLabel(account: NotificationAccountRecord, session: SessionSummary, index?: number): string;
function telegramSessionLabel(arg1: NotificationAccountRecord | SessionSummary, arg2?: SessionSummary | number, arg3?: number) {
  const hasAccount = typeof arg1 === "object" && arg1 !== null && "config" in arg1;
  const account = hasAccount ? arg1 as NotificationAccountRecord : null;
  const session = hasAccount ? arg2 as SessionSummary : arg1 as SessionSummary;
  const index = hasAccount ? arg3 : arg2 as number | undefined;
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = session.id.length > 12 ? `${session.id.slice(0, 12)}...` : session.id;
  const category = account ? telegramLocalizedCategory(account, telegramSessionCategory(session)) : telegramSessionCategory(session);
  return `${prefix}[${category}] ${session.title} (${shortId})`;
}

function telegramDispatchModeLabel(account: NotificationAccountRecord, mode: string) {
  const ui = telegramUi(account);
  return ui.sentMode[mode as keyof typeof ui.sentMode] ?? mode;
}

function telegramHelpText(account: NotificationAccountRecord) {
  const ui = telegramUi(account);
  return [
    ui.botTitle,
    "",
    ui.sessionsCommand,
    ui.agentsCommand,
    ui.roomsCommand,
    ui.filesCommand,
    ui.terminalCommand,
    ui.bindCommand,
    ui.unbindCommand,
    ui.sendCommand,
    ui.sendCommandNoBind,
    "",
    ui.replyRulesTitle,
    ui.replyRuleBound,
    ui.replyRuleSend,
    ui.replyBehaviorHint,
  ].join("\n");
}

function telegramGroupedSessionText(sessions: SessionSummary[], limit?: number): string;
function telegramGroupedSessionText(account: NotificationAccountRecord, sessions: SessionSummary[], limit?: number): string;
function telegramGroupedSessionText(arg1: NotificationAccountRecord | SessionSummary[], arg2?: SessionSummary[] | number, arg3 = 12) {
  const hasAccount = typeof arg1 === "object" && arg1 !== null && !Array.isArray(arg1) && "config" in arg1;
  const account = hasAccount ? arg1 as NotificationAccountRecord : null;
  const sessions = hasAccount ? arg2 as SessionSummary[] : arg1 as SessionSummary[];
  const limit = hasAccount ? (typeof arg3 === "number" ? arg3 : 12) : (typeof arg2 === "number" ? arg2 : 12);
  const order = ["Codex", "Agent", "Room", "Automation"] as const;
  const ui = account ? telegramUi(account) : null;
  const choices = telegramSessionChoices(sessions, limit);
  const sections = order
    .map((category) => {
      const rows = choices
        .map((session, index) => ({ session, index }))
        .filter(({ session }) => telegramSessionCategory(session) === category)
        .map(({ session, index }) => account ? `${telegramSessionLabel(account, session, index)}\n${session.status} · ${session.updatedAt}\n${session.id}` : `${telegramSessionLabel(session, index)}\n${session.status} · ${session.updatedAt}\n${session.id}`);
      return rows.length ? [account ? `${telegramLocalizedCategory(account, category)}:` : `${category}:`, ...rows].join("\n\n") : "";
    })
    .filter(Boolean);
  return sections.length ? sections.join("\n\n") : (ui?.noSessions ?? "No sessions yet.");
}

function telegramRecentSessionsText(sessions: SessionSummary[]) {
  return telegramGroupedSessionText(sessions, 12);
}

export function createTelegramPlatform(deps: TelegramPlatformDeps) {
  const {
    db,
    sessions,
    providers,
    listNotificationAccounts,
    dispatchMessageToSession,
    workspaceRoot,
    resolveShellPath,
    managedChildEnv,
    spawnProcess,
    pathWithinRoot,
    resolveTerminalCwd,
    ensureScratchSessionWorkspace,
    resolveAgentProject,
    upsertSession,
    agentFromRow,
    roomFromRow,
  } = deps;

  const pollingOffsets = new Map<string, number>();
  const pollingBusy = new Set<string>();
  const pendingSends = new Map<string, { message: string; sessionIds: string[]; createdAt: number }>();
  const pendingBinds = new Map<string, { sessionIds: string[]; createdAt: number }>();
  const pendingBrowse = new Map<string, { kind: "agent" | "room"; ids: string[]; page: number; pageSize: number; createdAt: number }>();
  const pendingFileRoots = new Map<string, { roots: Array<{ label: string; root: string }>; createdAt: number }>();
  const pendingFiles = new Map<string, { root: string; relPath: string; dirNames: string[]; createdAt: number }>();
  const pendingTerminal = new Map<string, { command: string; roots: Array<{ label: string; root: string }>; createdAt: number }>();
  const pendingInputs = new Map<string, { kind: "send" | "terminal"; createdAt: number }>();
  const queuedReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
  const activeReplyTargets = new Map<string, Array<{ accountId: string; chatId: string; createdAt: number }>>();
  const outboundQueues = new Map<string, Promise<void>>();
  const typingTimers = new Map<string, { timeoutId: ReturnType<typeof setTimeout>; intervalId: ReturnType<typeof setInterval>; startedAt: number }>();
  const pendingSelections = new Map<string, { ids: string[]; createdAt: number }>();
  let inboundTimer: ReturnType<typeof setInterval> | null = null;

  type TelegramAccountConfig = Record<string, unknown>;

  function telegramUpdateChatId(update: TelegramUpdate) {
    const id = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    return id === undefined ? "" : String(id);
  }

  function telegramUpdateUserId(update: TelegramUpdate) {
    const id = update.message?.from?.id ?? update.callback_query?.from?.id;
    return id === undefined ? "" : String(id);
  }

  function telegramInboundAllowed(account: NotificationAccountRecord, update: TelegramUpdate) {
    const config = account.config as TelegramAccountConfig;
    const chatId = telegramUpdateChatId(update);
    const userId = telegramUpdateUserId(update);
    const allowedChatIds = telegramConfigList(config.allowedChatIds);
    const allowedUserIds = telegramConfigList(config.allowedUserIds);
    if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return false;
    if (allowedUserIds.length && !allowedUserIds.includes(userId)) return false;
    return Boolean(chatId);
  }

  function telegramRouteSession(account: NotificationAccountRecord, chatId: string) {
    const row = db.prepare("select session_id from telegram_chat_routes where account_id = ? and chat_id = ?").get(account.id, chatId) as { session_id?: string } | undefined;
    const sessionId = row?.session_id ?? String((account.config as TelegramAccountConfig).defaultSessionId ?? "");
    return sessionId ? sessions.find((session) => session.id === sessionId) ?? null : null;
  }

  function telegramAgentChoices(limit?: number) {
    const rows = limit === undefined
      ? db.prepare("select * from agents where enabled = 1 order by updated_at desc, id desc").all() as Array<Record<string, unknown>>
      : db.prepare("select * from agents where enabled = 1 order by updated_at desc, id desc limit ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(agentFromRow);
  }

  function telegramAgentLabel(agent: AgentSummary, index?: number) {
    const prefix = index === undefined ? "" : `${index + 1}. `;
    const shortId = agent.id.length > 12 ? `${agent.id.slice(0, 12)}...` : agent.id;
    return `${prefix}${agent.name} (${shortId})`;
  }

  function telegramRoomChoices(limit?: number) {
    const rows = limit === undefined
      ? db.prepare("select * from rooms order by updated_at desc, id desc").all() as Array<Record<string, unknown>>
      : db.prepare("select * from rooms order by updated_at desc, id desc limit ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(roomFromRow);
  }

  function telegramRoomLabel(room: RoomSummary, index?: number) {
    const prefix = index === undefined ? "" : `${index + 1}. `;
    const shortId = room.id.length > 12 ? `${room.id.slice(0, 12)}...` : room.id;
    return `${prefix}${room.name} (${shortId})`;
  }

  function telegramPageCount(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  function telegramPageSlice<T>(items: T[], page = 0, pageSize = 10) {
    const total = items.length;
    const totalPages = telegramPageCount(total, pageSize);
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = currentPage * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    return { total, totalPages, page: currentPage, pageItems, start, end: Math.min(start + pageItems.length, total) };
  }

  function telegramAgentBrowseItems(ids: string[]) {
    const rows = db.prepare("select * from agents where enabled = 1 order by updated_at desc, id desc").all() as Array<Record<string, unknown>>;
    const rowsById = new Map(rows.map((row) => [String(row.id ?? ""), row] as const));
    return ids
      .map((id) => rowsById.get(id))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map(agentFromRow);
  }

  function telegramRoomBrowseItems(ids: string[]) {
    const rows = db.prepare("select * from rooms order by updated_at desc, id desc").all() as Array<Record<string, unknown>>;
    const rowsById = new Map(rows.map((row) => [String(row.id ?? ""), row] as const));
    return ids
      .map((id) => rowsById.get(id))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map(roomFromRow);
  }

  function telegramPendingKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function telegramSelectionKey(accountId: string, chatId: string, kind: "agent" | "room") {
    return `${accountId}:${chatId}:${kind}`;
  }

  function createTelegramAgentSession(agent: AgentSummary) {
    if (!agent.enabled) throw new Error("agent_disabled");
    const project = resolveAgentProject(agent);
    const provider = agent.providerId ? providers.find((item) => item.id === agent.providerId) : providers[0];
    const now = new Date().toISOString();
    const id = `task-${randomUUID()}`;
    const session: SessionSummary = {
      id,
      kind: project ? "project" : "scratch",
      conversationType: "agent",
      roomId: null,
      directAgentId: agent.id,
      title: agent.name,
      projectId: project?.id ?? null,
      workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id),
      providerId: provider?.id ?? null,
      model: agent.model ?? provider?.defaultModel ?? null,
      status: "paused",
      createdAt: now,
      updatedAt: now,
    };
    sessions.unshift(session);
    upsertSession(session);
    db.prepare("insert into agent_sessions (session_id, agent_id, created_at) values (?, ?, ?)").run(session.id, agent.id, now);
    return session;
  }

  function telegramRootChoices(account: NotificationAccountRecord, chatSession?: SessionSummary | null) {
    const ui = telegramUi(account);
    const roots: Array<{ label: string; root: string }> = [];
    if (chatSession?.workspacePath) roots.push({ label: telegramSessionLabel(account, chatSession), root: chatSession.workspacePath });
    if (!chatSession) roots.push({ label: ui.systemWorkspace, root: workspaceRoot });
    for (const session of telegramSessionChoices(sessions, 8)) {
      if (chatSession?.id === session.id || !session.workspacePath) continue;
      roots.push({ label: telegramSessionLabel(account, session), root: session.workspacePath });
    }
    const seen = new Set<string>();
    return roots.filter((item) => {
      const root = resolve(item.root);
      if (seen.has(root) || !existsSync(root) || !statSync(root).isDirectory()) return false;
      seen.add(root);
      item.root = root;
      return true;
    }).slice(0, 9);
  }

  function telegramSafeRelativePath(input = "") {
    return input.split("/").map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..").join("/");
  }

  function telegramDangerousCommand(command: string) {
    return /\b(rm\s+-[^\n]*r|shutdown|reboot|halt|mkfs|dd\s+if=|:\(\)\s*\{)\b/i.test(command);
  }

  function setTelegramRouteSession(accountId: string, chatId: string, sessionId: string) {
    db.prepare(`
      insert into telegram_chat_routes (account_id, chat_id, session_id, updated_at)
      values (?, ?, ?, ?)
      on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at
    `).run(accountId, chatId, sessionId, new Date().toISOString());
  }

  function clearTelegramRouteSession(accountId: string, chatId: string) {
    db.prepare("delete from telegram_chat_routes where account_id = ? and chat_id = ?").run(accountId, chatId);
  }

  function appendTelegramReplyTarget(
    current: Array<{ accountId: string; chatId: string; createdAt: number }> | undefined,
    accountId: string,
    chatId: string,
  ) {
    const createdAt = Date.now();
    const filtered = (current ?? []).filter((item) => createdAt - item.createdAt < 30 * 60 * 1000);
    if (!filtered.some((item) => item.accountId === accountId && item.chatId === chatId)) {
      filtered.push({ accountId, chatId, createdAt });
    }
    return filtered;
  }

  function queueTelegramQueuedReplyTarget(queueId: string, accountId: string, chatId: string) {
    queuedReplyTargets.set(queueId, appendTelegramReplyTarget(queuedReplyTargets.get(queueId), accountId, chatId));
  }

  function queueTelegramActiveReplyTarget(sessionId: string, accountId: string, chatId: string) {
    activeReplyTargets.set(sessionId, appendTelegramReplyTarget(activeReplyTargets.get(sessionId), accountId, chatId));
  }

  function activateTelegramReplyTargetFromQueue(sessionId: string, queueId: string) {
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

  function boundTelegramReplyTargets(sessionId: string) {
    return (db.prepare("select account_id, chat_id from telegram_chat_routes where session_id = ?").all(sessionId) as Array<{ account_id?: string; chat_id?: string }>)
      .map((row) => ({ accountId: String(row.account_id ?? ""), chatId: String(row.chat_id ?? "") }))
      .filter((item) => item.accountId && item.chatId);
  }

  function telegramReplyDestinations(sessionId: string) {
    const deduped = new Map<string, { accountId: string; chatId: string }>();
    const active = activeReplyTargets.get(sessionId) ?? [];
    const now = Date.now();
    for (const item of [...boundTelegramReplyTargets(sessionId), ...active.filter((entry) => now - entry.createdAt < 30 * 60 * 1000)]) {
      deduped.set(`${item.accountId}:${item.chatId}`, item);
    }
    return [...deduped.values()];
  }

  function clearTelegramActiveReplyTargets(sessionId: string) {
    activeReplyTargets.delete(sessionId);
  }

  function telegramOutboundQueueKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function telegramTypingKey(accountId: string, chatId: string) {
    return `${accountId}:${chatId}`;
  }

  function stopTelegramTyping(accountId: string, chatId: string) {
    const key = telegramTypingKey(accountId, chatId);
    const entry = typingTimers.get(key);
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    clearInterval(entry.intervalId);
    typingTimers.delete(key);
  }

  function telegramApiBase(account: NotificationAccountRecord) {
    const config = account.config as TelegramAccountConfig;
    return String(config.proxyUrl ?? "https://api.telegram.org").trim().replace(/\/+$/, "") || "https://api.telegram.org";
  }

  async function telegramBotApi(account: NotificationAccountRecord, method: string, payload: Record<string, unknown>) {
    const config = account.config as TelegramAccountConfig;
    if (!config.botToken) throw new Error("telegram_bot_token_required");
    return fetch(`${telegramApiBase(account)}/bot${String(config.botToken)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  function startTelegramTyping(account: NotificationAccountRecord, chatId: string) {
    const key = telegramTypingKey(account.id, chatId);
    stopTelegramTyping(account.id, chatId);
    const sendTyping = () => {
      void telegramBotApi(account, "sendChatAction", {
        chat_id: chatId,
        action: "typing",
      }).catch(() => undefined);
    };
    sendTyping();
    const intervalId = setInterval(sendTyping, 4000);
    const timeoutId = setTimeout(() => stopTelegramTyping(account.id, chatId), 90_000);
    typingTimers.set(key, { timeoutId, intervalId, startedAt: Date.now() });
  }

  function formatTelegramSessionReply(session: SessionSummary, content: string) {
    const title = session.title?.trim() || session.id;
    const body = content.trim();
    return body ? `[${title}]\n\n${body}` : `[${title}]`;
  }

  async function sendTelegramText(account: NotificationAccountRecord, chatId: string, text: string) {
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 3900),
      disable_web_page_preview: true,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function editTelegramText(account: NotificationAccountRecord, chatId: string, messageId: number, text: string, replyMarkup?: Record<string, unknown>) {
    const response = await telegramBotApi(account, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 3900),
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  function enqueueTelegramText(account: NotificationAccountRecord, chatId: string, text: string) {
    const key = telegramOutboundQueueKey(account.id, chatId);
    const previous = outboundQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => sendTelegramText(account, chatId, text));
    outboundQueues.set(key, next.finally(() => {
      if (outboundQueues.get(key) === next) outboundQueues.delete(key);
    }));
    return next;
  }

  function forwardAssistantMessageToTelegram(session: SessionSummary, message: SessionMessage) {
    if (message.role !== "assistant") return;
    const destinations = telegramReplyDestinations(session.id);
    if (!destinations.length) return;
    const accounts = new Map(
      listNotificationAccounts(true)
        .filter((account) => account.enabled && account.channelKind === "telegram")
        .map((account) => [account.id, account]),
    );
    const text = formatTelegramSessionReply(session, message.content);
    for (const destination of destinations) {
      const account = accounts.get(destination.accountId);
      if (!account) continue;
      stopTelegramTyping(destination.accountId, destination.chatId);
      void enqueueTelegramText(account, destination.chatId, text).catch((error) => {
        console.warn("telegram reply forward failed", destination.accountId, destination.chatId, error instanceof Error ? error.message : error);
      });
    }
  }

  async function answerTelegramCallback(account: NotificationAccountRecord, callbackQueryId: string, text: string) {
    await telegramBotApi(account, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text.slice(0, 180),
    });
  }

  async function sendTelegramSessionPicker(account: NotificationAccountRecord, chatId: string, message: string) {
    const ui = telegramUi(account);
    const choices = telegramSessionChoices(sessions);
    if (!choices.length) {
      await sendTelegramText(account, chatId, ui.noAvailableSessions);
      return;
    }
    pendingSends.set(telegramPendingKey(account.id, chatId), {
      message,
      sessionIds: choices.map((session) => session.id),
      createdAt: Date.now(),
    });
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text: ui.selectSessionToSend,
      reply_markup: {
        inline_keyboard: [
          ...choices.map((session, index) => ([{
            text: telegramSessionLabel(account, session, index).slice(0, 64),
            callback_data: `send:${index}`,
          }])),
          [{ text: ui.cancel, callback_data: "cancel" }],
        ],
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function sendTelegramAgents(account: NotificationAccountRecord, chatId: string) {
    const ui = telegramUi(account);
    const choices = telegramAgentChoices();
    if (!choices.length) {
      await sendTelegramText(account, chatId, ui.noEnabledAgents);
      return;
    }
    const pageSize = 8;
    const { page } = telegramPageSlice(choices, 0, pageSize);
    pendingBrowse.set(telegramPendingKey(account.id, chatId), {
      kind: "agent",
      ids: choices.map((agent) => agent.id),
      page,
      pageSize,
      createdAt: Date.now(),
    });
    await sendTelegramAgentsPage(account, chatId, 0);
  }

  async function sendTelegramAgentsPage(account: NotificationAccountRecord, chatId: string, page: number, messageId?: number) {
    const ui = telegramUi(account);
    const pendingKey = telegramPendingKey(account.id, chatId);
    const pending = pendingBrowse.get(pendingKey);
    if (!pending || pending.kind !== "agent") return;
    const choices = telegramAgentBrowseItems(pending.ids);
    if (!choices.length) {
      pendingBrowse.delete(pendingKey);
      await sendTelegramText(account, chatId, ui.noEnabledAgents);
      return;
    }
    const pageSize = pending.pageSize || 8;
    const { total, totalPages, page: currentPage, pageItems, start, end } = telegramPageSlice(choices, page, pageSize);
    pendingBrowse.set(pendingKey, { ...pending, page: currentPage, pageSize, createdAt: Date.now() });
    const payload = {
      text: `${ui.selectAgentToCreate}\n${ui.showing(start + 1, end, total, currentPage + 1, totalPages)}`,
      reply_markup: {
        inline_keyboard: [
          ...pageItems.map((agent, index) => ([{
            text: telegramAgentLabel(agent, start + index).slice(0, 64),
            callback_data: `agent:${start + index}`,
          }])),
          ...(totalPages > 1 ? [[
            ...(currentPage > 0 ? [{ text: ui.prev, callback_data: `agentpage:${currentPage - 1}` }] : []),
            ...(currentPage < totalPages - 1 ? [{ text: ui.next, callback_data: `agentpage:${currentPage + 1}` }] : []),
          ]] : []),
          [{ text: ui.cancel, callback_data: "cancel" }],
        ],
      },
    };
    if (messageId !== undefined) {
      await editTelegramText(account, chatId, messageId, payload.text, payload.reply_markup);
      return;
    }
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      ...payload,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function sendTelegramRooms(account: NotificationAccountRecord, chatId: string) {
    const ui = telegramUi(account);
    const choices = telegramRoomChoices();
    if (!choices.length) {
      await sendTelegramText(account, chatId, ui.noRooms);
      return;
    }
    const pageSize = 8;
    const { page } = telegramPageSlice(choices, 0, pageSize);
    pendingBrowse.set(telegramPendingKey(account.id, chatId), {
      kind: "room",
      ids: choices.map((room) => room.id),
      page,
      pageSize,
      createdAt: Date.now(),
    });
    await sendTelegramRoomsPage(account, chatId, 0);
  }

  async function sendTelegramRoomsPage(account: NotificationAccountRecord, chatId: string, page: number, messageId?: number) {
    const ui = telegramUi(account);
    const pendingKey = telegramPendingKey(account.id, chatId);
    const pending = pendingBrowse.get(pendingKey);
    if (!pending || pending.kind !== "room") return;
    const choices = telegramRoomBrowseItems(pending.ids);
    if (!choices.length) {
      pendingBrowse.delete(pendingKey);
      await sendTelegramText(account, chatId, ui.noRooms);
      return;
    }
    const pageSize = pending.pageSize || 8;
    const { total, totalPages, page: currentPage, pageItems, start, end } = telegramPageSlice(choices, page, pageSize);
    pendingBrowse.set(pendingKey, { ...pending, page: currentPage, pageSize, createdAt: Date.now() });
    const payload = {
      text: `${ui.selectRoomToBind}\n${ui.showing(start + 1, end, total, currentPage + 1, totalPages)}`,
      reply_markup: {
        inline_keyboard: [
          ...pageItems.map((room, index) => ([{
            text: telegramRoomLabel(room, start + index).slice(0, 64),
            callback_data: `room:${start + index}`,
          }])),
          ...(totalPages > 1 ? [[
            ...(currentPage > 0 ? [{ text: ui.prev, callback_data: `roompage:${currentPage - 1}` }] : []),
            ...(currentPage < totalPages - 1 ? [{ text: ui.next, callback_data: `roompage:${currentPage + 1}` }] : []),
          ]] : []),
          [{ text: ui.cancel, callback_data: "cancel" }],
        ],
      },
    };
    if (messageId !== undefined) {
      await editTelegramText(account, chatId, messageId, payload.text, payload.reply_markup);
      return;
    }
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      ...payload,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function sendTelegramFileRootPicker(account: NotificationAccountRecord, chatId: string) {
    const ui = telegramUi(account);
    const roots = telegramRootChoices(account, null);
    if (!roots.length) {
      await sendTelegramText(account, chatId, ui.noFileRoots);
      return;
    }
    pendingFileRoots.set(telegramPendingKey(account.id, chatId), { roots, createdAt: Date.now() });
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text: ui.selectFileRoot,
      reply_markup: {
        inline_keyboard: [
          ...roots.map((root, index) => ([{ text: root.label.slice(0, 64), callback_data: `filectx:${index}` }])),
          [{ text: ui.cancel, callback_data: "cancel" }],
        ],
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function sendTelegramFiles(account: NotificationAccountRecord, chatId: string, root: string, relPath = "") {
    const safeRel = telegramSafeRelativePath(relPath);
    const target = resolve(root, safeRel);
    if (!pathWithinRoot(target, root) || !existsSync(target) || !statSync(target).isDirectory()) {
      await sendTelegramText(account, chatId, telegramUi(account).directoryUnavailable);
      return;
    }
    const entries = readdirSync(target, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const fullPath = join(target, entry.name);
        const stat = statSync(fullPath);
        return { name: entry.name, directory: entry.isDirectory(), size: stat.size, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
      .slice(0, 40);
    const dirs = entries.filter((entry) => entry.directory).slice(0, 20);
    pendingFiles.set(telegramPendingKey(account.id, chatId), {
      root,
      relPath: safeRel,
      dirNames: dirs.map((entry) => entry.name),
      createdAt: Date.now(),
    });
    const text = [
      `Files: /${safeRel}`,
      "",
      ...entries.map((entry) => `${entry.directory ? "[dir]" : "[file]"} ${entry.name}${entry.directory ? "" : ` · ${entry.size} bytes`}`),
    ].join("\n").slice(0, 3900);
    const keyboard = [
      ...dirs.map((entry, index) => ([{ text: `[dir] ${entry.name}`.slice(0, 64), callback_data: `file:${index}` }])),
      ...(safeRel ? [[{ text: "..", callback_data: "fileup" }]] : []),
      [{ text: telegramUi(account).cancel, callback_data: "cancel" }],
    ];
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: keyboard },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function sendTelegramTerminalRootPicker(account: NotificationAccountRecord, chatId: string, command: string) {
    const roots = telegramRootChoices(account, null);
    if (!roots.length) {
      await sendTelegramText(account, chatId, telegramUi(account).noTerminalRoots);
      return;
    }
    pendingTerminal.set(telegramPendingKey(account.id, chatId), { command, roots, createdAt: Date.now() });
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text: `${telegramUi(account).selectTerminalRoot}\n${command}`,
      reply_markup: {
        inline_keyboard: [
          ...roots.map((root, index) => ([{ text: root.label.slice(0, 64), callback_data: `term:${index}` }])),
          [{ text: telegramUi(account).cancel, callback_data: "cancel" }],
        ],
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function runTelegramTerminal(account: NotificationAccountRecord, chatId: string, cwd: string, command: string) {
    if (!command.trim()) {
      await sendTelegramText(account, chatId, telegramUi(account).usageTerminal);
      return;
    }
    if (telegramDangerousCommand(command)) {
      await sendTelegramText(account, chatId, telegramUi(account).commandBlocked);
      return;
    }
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      await sendTelegramText(account, chatId, telegramUi(account).terminalDirectoryUnavailable);
      return;
    }
    const ui = telegramUi(account);
    await sendTelegramText(account, chatId, `${ui.runningIn} ${cwd}:\n${command}`);
    const shell = resolveShellPath();
    const output = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolveRun) => {
      const child = spawnProcess(shell, ["-lc", command], { cwd, env: managedChildEnv() });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolveRun({ code: null, stdout, stderr, timedOut: true });
      }, 20_000);
      child.stdout?.on("data", (chunk) => { stdout += String(chunk).slice(0, 20_000); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk).slice(0, 20_000); });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveRun({ code, stdout, stderr, timedOut: false });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolveRun({ code: null, stdout, stderr: error.message, timedOut: false });
      });
    });
    await sendTelegramText(account, chatId, [
      output.timedOut ? ui.timedOut : `${ui.exitCode}: ${output.code ?? ui.unknown}`,
      `\n${ui.stdout}:\n${output.stdout || "(empty)"}`,
      output.stderr ? `\n${ui.stderr}:\n${output.stderr}` : "",
    ].join("\n").slice(0, 3900));
  }

  async function sendTelegramBindPicker(account: NotificationAccountRecord, chatId: string) {
    const ui = telegramUi(account);
    const choices = telegramSessionChoices(sessions);
    if (!choices.length) {
      await sendTelegramText(account, chatId, ui.noAvailableSessions);
      return;
    }
    pendingBinds.set(telegramPendingKey(account.id, chatId), {
      sessionIds: choices.map((session) => session.id),
      createdAt: Date.now(),
    });
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text: ui.selectSessionToBind,
      reply_markup: {
        inline_keyboard: [
          ...choices.map((session, index) => ([{
            text: telegramSessionLabel(account, session, index).slice(0, 64),
            callback_data: `bind:${index}`,
          }])),
          [{ text: ui.cancel, callback_data: "cancel" }],
        ],
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function sendTelegramInputPrompt(account: NotificationAccountRecord, chatId: string, kind: "send" | "terminal") {
    const ui = telegramUi(account);
    pendingInputs.set(telegramPendingKey(account.id, chatId), { kind, createdAt: Date.now() });
    const text = kind === "send"
      ? (notificationLanguage(account) === "en-US" ? "Send the message content in your next reply." : "请在下一条消息里发送内容。")
      : (notificationLanguage(account) === "en-US" ? "Send the terminal command in your next reply." : "请在下一条消息里发送终端命令。");
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [[{ text: ui.cancel, callback_data: "cancel" }]] },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
    }
  }

  async function routeTelegramSendMessage(account: NotificationAccountRecord, chatId: string, message: string) {
    const target = telegramRouteSession(account, chatId);
    if (!target) {
      await sendTelegramSessionPicker(account, chatId, message);
      return;
    }
    startTelegramTyping(account, chatId);
    const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${message}`);
    if (result.mode === "queued" && result.queuedId) queueTelegramQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueTelegramActiveReplyTarget(target.id, account.id, chatId);
    await sendTelegramText(account, chatId, `${telegramUi(account).sentTo} ${target.title}: ${telegramDispatchModeLabel(account, result.mode)}`);
  }

  function resolveTelegramTargetSession(raw: string) {
    const value = raw.trim();
    if (!value) return null;
    const choices = telegramSessionChoices(sessions, 12);
    const numericIndex = Number(value);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && choices[numericIndex - 1]) return choices[numericIndex - 1];
    return sessions.find((session) => session.id === value)
      ?? choices.find((session) => session.title.toLowerCase().includes(value.toLowerCase()))
      ?? sessions.find((session) => `${session.title} ${session.id}`.toLowerCase().includes(value.toLowerCase()))
      ?? null;
  }

  async function handleTelegramUpdate(account: NotificationAccountRecord, update: TelegramUpdate) {
    const ui = telegramUi(account);
    if (!telegramInboundAllowed(account, update)) return;
    if (update.callback_query) {
      const chatId = telegramUpdateChatId(update);
      const data = update.callback_query.data ?? "";
      if (!chatId) return;
      if (data === "cancel") {
        pendingSends.delete(telegramPendingKey(account.id, chatId));
        pendingBinds.delete(telegramPendingKey(account.id, chatId));
        pendingBrowse.delete(telegramPendingKey(account.id, chatId));
        pendingSelections.delete(telegramSelectionKey(account.id, chatId, "agent"));
        pendingSelections.delete(telegramSelectionKey(account.id, chatId, "room"));
        pendingFileRoots.delete(telegramPendingKey(account.id, chatId));
        pendingFiles.delete(telegramPendingKey(account.id, chatId));
        pendingTerminal.delete(telegramPendingKey(account.id, chatId));
        pendingInputs.delete(telegramPendingKey(account.id, chatId));
        await answerTelegramCallback(account, update.callback_query.id, ui.canceled);
        await sendTelegramText(account, chatId, ui.canceled);
        return;
      }
      if (data.startsWith("send:")) {
        const pendingKey = telegramPendingKey(account.id, chatId);
        const pending = pendingSends.get(pendingKey);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingSends.delete(pendingKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredPendingMessage);
          return;
        }
        const index = Number(data.slice("send:".length));
        const sessionId = Number.isInteger(index) ? pending.sessionIds[index] : "";
        const target = sessionId ? sessions.find((session) => session.id === sessionId) ?? null : null;
        if (!target) {
          await answerTelegramCallback(account, update.callback_query.id, ui.sessionUnavailable);
          return;
        }
        pendingSends.delete(pendingKey);
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        startTelegramTyping(account, chatId);
        const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${pending.message}`);
        if (result.mode === "queued" && result.queuedId) queueTelegramQueuedReplyTarget(result.queuedId, account.id, chatId);
        else queueTelegramActiveReplyTarget(target.id, account.id, chatId);
        return;
      }
      if (data.startsWith("bind:")) {
        const pendingKey = telegramPendingKey(account.id, chatId);
        const pending = pendingBinds.get(pendingKey);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingBinds.delete(pendingKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredBindList);
          return;
        }
        const index = Number(data.slice("bind:".length));
        const sessionId = Number.isInteger(index) ? pending.sessionIds[index] : "";
        const target = sessionId ? sessions.find((session) => session.id === sessionId) ?? null : null;
        if (!target) {
          await answerTelegramCallback(account, update.callback_query.id, ui.sessionUnavailable);
          return;
        }
        pendingBinds.delete(pendingKey);
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        setTelegramRouteSession(account.id, chatId, target.id);
        await sendTelegramText(account, chatId, `${ui.boundTo} ${target.title}\n${target.id}`);
        return;
      }
      if (data.startsWith("agentpage:") || data.startsWith("roompage:")) {
        const pendingKey = telegramPendingKey(account.id, chatId);
        const pending = pendingBrowse.get(pendingKey);
        const kind = data.startsWith("agentpage:") ? "agent" : "room";
        if (!pending || pending.kind !== kind || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingBrowse.delete(pendingKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredList);
          return;
        }
        const nextPage = Number(data.split(":")[1]);
        if (!Number.isInteger(nextPage) || nextPage < 0) {
          await answerTelegramCallback(account, update.callback_query.id, ui.invalidPage);
          return;
        }
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        const messageId = update.callback_query.message?.message_id;
        if (kind === "agent") {
          await sendTelegramAgentsPage(account, chatId, nextPage, messageId);
        } else {
          await sendTelegramRoomsPage(account, chatId, nextPage, messageId);
        }
        return;
      }
      if (data.startsWith("agent:")) {
        const pendingKey = telegramPendingKey(account.id, chatId);
        const pending = pendingBrowse.get(pendingKey);
        if (!pending || pending.kind !== "agent" || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingBrowse.delete(pendingKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredAgentList);
          return;
        }
        const index = Number(data.slice("agent:".length));
        const agentId = Number.isInteger(index) ? pending.ids[index] : "";
        const row = agentId ? db.prepare("select * from agents where id = ?").get(agentId) as Record<string, unknown> | undefined : undefined;
        if (!row) {
          await answerTelegramCallback(account, update.callback_query.id, ui.agentUnavailable);
          return;
        }
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        const session = createTelegramAgentSession(agentFromRow(row));
        setTelegramRouteSession(account.id, chatId, session.id);
        await sendTelegramText(account, chatId, `${ui.createdAndBoundSession}\n${telegramSessionLabel(account, session)}\n${session.id}`);
        return;
      }
      if (data.startsWith("room:")) {
        const pendingKey = telegramPendingKey(account.id, chatId);
        const pending = pendingBrowse.get(pendingKey);
        if (!pending || pending.kind !== "room" || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingBrowse.delete(pendingKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredRoomList);
          return;
        }
        const index = Number(data.slice("room:".length));
        const roomId = Number.isInteger(index) ? pending.ids[index] : "";
        const row = roomId ? db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined : undefined;
        const room = row ? roomFromRow(row) : null;
        if (!room?.sessionId) {
          await answerTelegramCallback(account, update.callback_query.id, ui.roomUnavailable);
          return;
        }
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        setTelegramRouteSession(account.id, chatId, room.sessionId);
        await sendTelegramText(account, chatId, `${ui.boundRoomSession}\n${telegramRoomLabel(room)}\n${room.sessionId}`);
        return;
      }
      if (data.startsWith("filectx:")) {
        const rootKey = telegramPendingKey(account.id, chatId);
        const pending = pendingFileRoots.get(rootKey);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingFileRoots.delete(rootKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredFileList);
          return;
        }
        const index = Number(data.slice("filectx:".length));
        const root = Number.isInteger(index) ? pending.roots[index]?.root : "";
        if (!root) {
          await answerTelegramCallback(account, update.callback_query.id, ui.fileRootUnavailable);
          return;
        }
        pendingFileRoots.delete(rootKey);
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        await sendTelegramFiles(account, chatId, root);
        return;
      }
      if (data.startsWith("file:") || data === "fileup") {
        const pendingKey = telegramPendingKey(account.id, chatId);
        const pending = pendingFiles.get(pendingKey);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingFiles.delete(pendingKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredFileList);
          return;
        }
        const nextRel = data === "fileup"
          ? dirname(pending.relPath) === "." ? "" : dirname(pending.relPath)
          : join(pending.relPath, pending.dirNames[Number(data.slice("file:".length))] ?? "");
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        await sendTelegramFiles(account, chatId, pending.root, nextRel);
        return;
      }
      if (data.startsWith("term:")) {
        const terminalKey = telegramPendingKey(account.id, chatId);
        const pending = pendingTerminal.get(terminalKey);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingTerminal.delete(terminalKey);
          await answerTelegramCallback(account, update.callback_query.id, ui.expiredTerminal);
          return;
        }
        const index = Number(data.slice("term:".length));
        const root = Number.isInteger(index) ? pending.roots[index]?.root : "";
        if (!root) {
          await answerTelegramCallback(account, update.callback_query.id, ui.terminalRootUnavailable);
          return;
        }
        pendingTerminal.delete(terminalKey);
        await answerTelegramCallback(account, update.callback_query.id, ui.working);
        await runTelegramTerminal(account, chatId, root, pending.command);
        return;
      }
    }
    const text = update.message?.text?.trim() ?? "";
    const chatId = String(update.message?.chat?.id ?? "");
    if (!text || !chatId) return;
    const pendingInputKey = telegramPendingKey(account.id, chatId);
    const pendingInput = pendingInputs.get(pendingInputKey);
    if (pendingInput) {
      if (text === "/cancel" || Date.now() - pendingInput.createdAt > 10 * 60 * 1000) {
        pendingInputs.delete(pendingInputKey);
        await sendTelegramText(account, chatId, text === "/cancel" ? ui.canceled : ui.expiredPendingMessage);
        return;
      }
      pendingInputs.delete(pendingInputKey);
      if (pendingInput.kind === "send") {
        await routeTelegramSendMessage(account, chatId, text);
      } else {
        const target = telegramRouteSession(account, chatId);
        if (target?.workspacePath) {
          await runTelegramTerminal(account, chatId, target.workspacePath, text);
        } else {
          await sendTelegramTerminalRootPicker(account, chatId, text);
        }
      }
      return;
    }
    const [rawCommand, ...restParts] = text.split(/\s+/);
    const command = rawCommand.replace(/@[^@\s]+$/, "");
    const rest = restParts.join(" ").trim();
    if (command === "/start" || command === "/help") {
      await sendTelegramText(account, chatId, telegramHelpText(account));
      return;
    }
    if (command === "/sessions") {
      await sendTelegramText(account, chatId, telegramGroupedSessionText(account, sessions, 12));
      return;
    }
    if (command === "/agents") {
      await sendTelegramAgents(account, chatId);
      return;
    }
    if (command === "/rooms") {
      await sendTelegramRooms(account, chatId);
      return;
    }
    if (command === "/files") {
      const target = telegramRouteSession(account, chatId);
      if (target?.workspacePath) {
        await sendTelegramFiles(account, chatId, target.workspacePath, rest);
      } else {
        await sendTelegramFileRootPicker(account, chatId);
      }
      return;
    }
    if (command === "/terminal") {
      if (!rest) {
        await sendTelegramInputPrompt(account, chatId, "terminal");
        return;
      }
      const target = telegramRouteSession(account, chatId);
      if (target?.workspacePath) {
        await runTelegramTerminal(account, chatId, target.workspacePath, rest);
      } else {
        await sendTelegramTerminalRootPicker(account, chatId, rest);
      }
      return;
    }
    if (command === "/bind") {
      if (!rest) {
        await sendTelegramBindPicker(account, chatId);
        return;
      }
      const target = resolveTelegramTargetSession(rest);
      if (!target) {
        await sendTelegramText(account, chatId, ui.sessionNotFound);
        return;
      }
      setTelegramRouteSession(account.id, chatId, target.id);
      await sendTelegramText(account, chatId, `${telegramUi(account).boundTo} ${target.title}\n${target.id}`);
      return;
    }
    if (command === "/unbind") {
      clearTelegramRouteSession(account.id, chatId);
      await sendTelegramText(account, chatId, ui.boundSessionCleared);
      return;
    }
    if (command === "/send") {
      if (!rest) {
        await sendTelegramInputPrompt(account, chatId, "send");
        return;
      }
      const separator = rest.indexOf("|");
      const targetText = separator >= 0 ? rest.slice(0, separator).trim() : "";
      const message = separator >= 0 ? rest.slice(separator + 1).trim() : rest;
      if (!message) {
        await sendTelegramText(account, chatId, ui.messageEmpty);
        return;
      }
      const target = targetText ? resolveTelegramTargetSession(targetText) : telegramRouteSession(account, chatId);
      if (!target) {
        if (targetText) {
          await sendTelegramText(account, chatId, ui.sessionNotFound);
        } else {
          await sendTelegramSessionPicker(account, chatId, message);
        }
        return;
      }
      startTelegramTyping(account, chatId);
      const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${message}`);
      if (result.mode === "queued" && result.queuedId) queueTelegramQueuedReplyTarget(result.queuedId, account.id, chatId);
      else queueTelegramActiveReplyTarget(target.id, account.id, chatId);
      return;
    }
    const target = telegramRouteSession(account, chatId);
    if (!target) {
      await sendTelegramSessionPicker(account, chatId, text);
      return;
    }
    startTelegramTyping(account, chatId);
    const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${text}`);
    if (result.mode === "queued" && result.queuedId) queueTelegramQueuedReplyTarget(result.queuedId, account.id, chatId);
    else queueTelegramActiveReplyTarget(target.id, account.id, chatId);
  }

  async function pollTelegramAccount(account: NotificationAccountRecord) {
    if (pollingBusy.has(account.id)) return;
    pollingBusy.add(account.id);
    try {
      const offset = pollingOffsets.get(account.id) ?? 0;
      const response = await telegramBotApi(account, "getUpdates", {
        offset: offset ? offset + 1 : undefined,
        timeout: 0,
        limit: 20,
        allowed_updates: ["message", "callback_query"],
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; result?: TelegramUpdate[] } | null;
      if (!response.ok || !body?.ok || !Array.isArray(body.result)) return;
      for (const update of body.result) {
        pollingOffsets.set(account.id, Math.max(pollingOffsets.get(account.id) ?? 0, update.update_id));
        await handleTelegramUpdate(account, update).catch((error) => {
          console.error("telegram inbound update failed", account.id, error);
        });
      }
    } catch (error) {
      console.warn("telegram inbound poll failed", account.id, error instanceof Error ? error.message : error);
    } finally {
      pollingBusy.delete(account.id);
    }
  }

  function pollTelegramInboundBots() {
    try {
      const accounts = listNotificationAccounts(true)
        .filter((account) => account.enabled && account.channelKind === "telegram" && (account.config as TelegramAccountConfig).inboundEnabled === true);
      for (const account of accounts) void pollTelegramAccount(account);
    } catch (error) {
      console.warn("telegram inbound poll scheduler failed", error instanceof Error ? error.message : error);
    }
  }

  function start() {
    if (inboundTimer) return;
    inboundTimer = setInterval(pollTelegramInboundBots, 10_000);
    inboundTimer.unref();
  }

  function shutdown() {
    if (inboundTimer) clearInterval(inboundTimer);
    inboundTimer = null;
    pollingBusy.clear();
  }

  return {
    start,
    shutdown,
    forwardAssistantMessageToTelegram,
    telegramHelpText,
    resolveTelegramTargetSession,
    telegramSessionChoices: (limit?: number) => telegramSessionChoices(sessions, limit),
    telegramSessionLabel,
    telegramGroupedSessionText: (limit?: number) => telegramGroupedSessionText(sessions, limit),
    telegramRecentSessionsText,
    telegramAgentChoices,
    telegramAgentLabel,
    telegramRoomChoices,
    telegramRoomLabel,
    telegramPageSlice,
    telegramRootChoices,
    telegramDangerousCommand,
    clearTelegramRouteSession,
    setTelegramRouteSession,
    activateTelegramReplyTargetFromQueue,
    clearTelegramActiveReplyTargets,
    queueTelegramQueuedReplyTarget,
    queueTelegramActiveReplyTarget,
    pollTelegramAccount,
    handleTelegramUpdate,
  };
}
