import { randomUUID } from "node:crypto";
import type {
  NotificationAccountSummary,
  NotificationChannelDefinition,
  NotificationDeliveryStatus,
  NotificationEphemeralRuleSummary,
  NotificationEventType,
  NotificationRecipientSummary,
  NotificationRuleTarget,
  NotificationSeverity,
  SessionSummary,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows } from "../pagination.js";
import {
  appNotificationFromRow,
  createAppNotification,
  getNotificationChannel,
  listNotificationChannels,
  notificationAccountFromRow,
  notificationDeliveryFromRow,
  notificationEphemeralRuleFromRow,
  notificationEventTypes,
  notificationLanguageFromConfig,
  notificationLocaleText,
  notificationRecipientFromRow,
  notificationRuleFromRow,
  notificationSeverityRank,
  publicNotificationConfig,
  sanitizeNotificationPermissions,
} from "./index.js";

type NotificationServiceDeps = Record<string, any>;

export function createNotificationService(deps: NotificationServiceDeps) {
  const { appData, db, dingtalkPlatform, feishuPlatform, host, notificationChannels, qqPlatform, sendEmailNotification, wecomPlatform, weixinPlatform } = deps;

type NotificationAccountRecord = NotificationAccountSummary;
type NotificationEventInput = {
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
};

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function listNotificationAccounts(exposeSecrets = false) {
  return (db.prepare("select * from notification_accounts order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map((row) => notificationAccountFromRow(row, exposeSecrets));
}

function readNotificationRecipients(exposeSecrets = false) {
  return (db.prepare("select * from notification_recipients order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map((row) => notificationRecipientFromRow(row, exposeSecrets));
}

function defaultRecipientConfigForAccount(account: NotificationAccountSummary) {
  const config = account.config as Record<string, unknown>;
  if (account.channelKind === "email") {
    const email = String(config.fromEmail ?? "").trim();
    return email ? { email } : null;
  }
  if (account.channelKind === "telegram") {
    const chatId = String(config.testChatId ?? "").trim();
    return chatId ? { chatId } : null;
  }
  if (account.channelKind === "weixin") {
    const chatId = String(config.testChatId ?? config.userId ?? config.accountId ?? "").trim();
    return chatId ? { chatId } : null;
  }
  if (account.channelKind === "wecom") {
    const chatId = String(config.testChatId ?? "").trim();
    return chatId ? { chatId } : null;
  }
  if (account.channelKind === "qq") {
    const chatId = String(config.testChatId ?? config.testTargetId ?? config.targetId ?? config.openId ?? "").trim();
    return chatId ? { chatId } : null;
  }
  return null;
}

function syncDefaultNotificationRecipients() {
  const existing = readNotificationRecipients(true);
  const existingKeys = new Set(existing.map((recipient) => `${recipient.kind}:${recipient.senderAccountId ?? ""}`));
  const accounts = listNotificationAccounts(true).filter((account) => account.enabled && ["email", "telegram", "weixin", "wecom", "qq"].includes(account.channelKind));
  const now = new Date().toISOString();
  let changed = false;
  for (const account of accounts) {
    const key = `${account.channelKind}:${account.id}`;
    if (existingKeys.has(key)) continue;
    const config = defaultRecipientConfigForAccount(account);
    if (!config) continue;
    const language = notificationLanguageFromConfig(account.config as Record<string, unknown> | null);
    const recipientSuffix = notificationLocaleText(language, "接收者", "recipient");
    const id = `notification-recipient-${randomUUID()}`;
    db.prepare(`
      insert into notification_recipients (id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at)
      values (?, ?, ?, 1, ?, null, ?, ?, ?, ?)
    `).run(
      id,
      `${account.name} ${recipientSuffix}`,
      account.channelKind,
      account.id,
      JSON.stringify(config),
      JSON.stringify({}),
      now,
      now,
    );
    changed = true;
  }
  return changed;
}

function listNotificationRecipients(exposeSecrets = false) {
  syncDefaultNotificationRecipients();
  return readNotificationRecipients(exposeSecrets);
}

function listAllNotificationRules() {
  return (db.prepare("select * from notification_rules order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map(notificationRuleFromRow);
}

function listNotificationRules(limit = 50, cursorValue?: string | null, filters: { enabled?: boolean } = {}) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(filters.enabled === undefined ? [] : ["enabled = @enabled"]),
    ...(cursor ? ["(updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from notification_rules
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ enabled: filters.enabled === undefined ? undefined : filters.enabled ? 1 : 0, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(notificationRuleFromRow), limit, (item) => item.updatedAt);
}

function listNotificationEphemeralRules(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from notification_ephemeral_rules
    ${cursor ? "where (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map((row) => enrichNotificationEphemeralRuleSource(notificationEphemeralRuleFromRow(row))), limit, (item) => item.createdAt);
}

function enrichNotificationEphemeralRuleSource(rule: NotificationEphemeralRuleSummary): NotificationEphemeralRuleSummary {
  if (rule.scopeType === "session") {
    const session = db.prepare("select title, conversation_type, status from sessions where id = ?").get(rule.scopeId) as { title?: string; conversation_type?: string; status?: string } | undefined;
    return {
      ...rule,
      source: {
        type: "session",
        id: rule.scopeId,
        label: session?.title ? String(session.title) : rule.scopeId,
        detail: session ? [session.conversation_type, session.status].filter(Boolean).join(" · ") : null,
        exists: Boolean(session),
      },
    };
  }
  if (rule.scopeType === "task") {
    const task = db.prepare(`
      select task_runs.status, task_runs.session_id, sessions.title as session_title
      from task_runs
      left join sessions on sessions.id = task_runs.session_id
      where task_runs.id = ?
    `).get(rule.scopeId) as { status?: string; session_id?: string; session_title?: string } | undefined;
    return {
      ...rule,
      source: {
        type: "task",
        id: rule.scopeId,
        label: task?.session_title ? String(task.session_title) : rule.scopeId,
        detail: task ? ["task", task.status, task.session_id].filter(Boolean).join(" · ") : null,
        exists: Boolean(task),
      },
    };
  }
  if (rule.scopeType === "room_task") {
    const task = db.prepare(`
      select room_tasks.title, room_tasks.status, rooms.name as room_name
      from room_tasks
      left join rooms on rooms.id = room_tasks.room_id
      where room_tasks.id = ?
    `).get(rule.scopeId) as { title?: string; status?: string; room_name?: string } | undefined;
    return {
      ...rule,
      source: {
        type: "room_task",
        id: rule.scopeId,
        label: task?.title ? String(task.title) : rule.scopeId,
        detail: task ? [task.room_name, task.status].filter(Boolean).join(" · ") : null,
        exists: Boolean(task),
      },
    };
  }
  const automation = db.prepare("select name, status, action_type from automations where id = ?").get(rule.scopeId) as { name?: string; status?: string; action_type?: string } | undefined;
  return {
    ...rule,
    source: {
      type: "automation",
      id: rule.scopeId,
      label: automation?.name ? String(automation.name) : rule.scopeId,
      detail: automation ? [automation.action_type, automation.status].filter(Boolean).join(" · ") : null,
      exists: Boolean(automation),
    },
  };
}

function createNotificationEphemeralRule(input: {
  scopeType?: "session" | "task" | "room_task" | "automation";
  scopeId?: string;
  eventTypes?: NotificationEventType[];
  targets?: NotificationRuleTarget[];
  expireMode?: "after_trigger" | "session_end" | "manual";
}) {
  const scopeType = input.scopeType === "task" || input.scopeType === "room_task" || input.scopeType === "automation" ? input.scopeType : "session";
  const scopeId = input.scopeId?.trim();
  const eventTypes = (input.eventTypes ?? []).filter((type) => notificationEventTypes.includes(type));
  const targets = sanitizeNotificationTargets(input.targets ?? []);
  const expireMode = input.expireMode === "session_end" || input.expireMode === "manual" ? input.expireMode : "after_trigger";
  if (!scopeId || !eventTypes.length || !targets.length) return null;
  const now = new Date().toISOString();
  if (scopeType === "automation") {
    const existing = db.prepare(`
      select * from notification_ephemeral_rules
      where scope_type = ? and scope_id = ?
      order by created_at desc, id desc
      limit 1
    `).get(scopeType, scopeId) as Record<string, unknown> | undefined;
    if (existing) {
      db.prepare(`
        update notification_ephemeral_rules
        set event_types = ?, targets = ?, enabled = 1, expire_mode = ?
        where id = ?
      `).run(JSON.stringify(eventTypes), JSON.stringify(targets), expireMode, String(existing.id));
      return notificationEphemeralRuleFromRow(db.prepare("select * from notification_ephemeral_rules where id = ?").get(String(existing.id)) as Record<string, unknown>);
    }
  }
  const id = `notification-ephemeral-${randomUUID()}`;
  db.prepare(`
    insert into notification_ephemeral_rules (id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at)
    values (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, scopeType, scopeId, JSON.stringify(eventTypes), JSON.stringify(targets), expireMode, now);
  return {
    id,
    scopeType,
    scopeId,
    eventTypes,
    targets,
    enabled: true,
    expireMode,
    createdAt: now,
  } satisfies NotificationEphemeralRuleSummary;
}

function listNotificationDeliveries(limit = 50, cursorValue?: string | null, filters: { eventType?: NotificationEventType; status?: NotificationDeliveryStatus; severity?: NotificationSeverity } = {}) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(filters.eventType ? ["event_type = @eventType"] : []),
    ...(filters.status ? ["status = @status"] : []),
    ...(filters.severity ? ["severity = @severity"] : []),
    ...(cursor ? ["(created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from notification_deliveries
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ eventType: filters.eventType, status: filters.status, severity: filters.severity, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(notificationDeliveryFromRow), limit, (item) => item.createdAt);
}

function sanitizeNotificationConfig(kind: NotificationAccountSummary["channelKind"], input?: Record<string, unknown>, previous?: Record<string, unknown>) {
  const config = input ?? {};
  const list = (value: unknown) => Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (kind === "email") {
    const password = String(config.password ?? "").trim();
    const imapPassword = String(config.imapPassword ?? "").trim();
    return {
      host: String(config.host ?? previous?.host ?? "").trim(),
      port: Number(config.port ?? previous?.port ?? 587) || 587,
      secure: config.secure === true,
      username: String(config.username ?? previous?.username ?? "").trim(),
      password: password && password !== "********" ? password : String(previous?.password ?? ""),
      fromName: String(config.fromName ?? previous?.fromName ?? "Codex Web").trim(),
      fromEmail: String(config.fromEmail ?? previous?.fromEmail ?? "").trim(),
      testEmailTo: list(config.testEmailTo ?? previous?.testEmailTo),
      inboundEnabled: config.inboundEnabled === true,
      imapHost: String(config.imapHost ?? previous?.imapHost ?? config.host ?? previous?.host ?? "").trim(),
      imapPort: Number(config.imapPort ?? previous?.imapPort ?? 993) || 993,
      imapSecure: config.imapSecure === true || (config.imapSecure === undefined && Number(config.imapPort ?? previous?.imapPort ?? 993) === 993),
      imapUsername: String(config.imapUsername ?? previous?.imapUsername ?? config.username ?? previous?.username ?? "").trim(),
      imapPassword: imapPassword && imapPassword !== "********" ? imapPassword : String(previous?.imapPassword ?? previous?.password ?? ""),
      inboundMailbox: String(config.inboundMailbox ?? previous?.inboundMailbox ?? "INBOX").trim() || "INBOX",
      allowedSenderEmails: list(config.allowedSenderEmails ?? previous?.allowedSenderEmails),
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
    };
  }
  if (kind === "telegram") {
    const botToken = String(config.botToken ?? "").trim();
    return {
      botToken: botToken && botToken !== "********" ? botToken : String(previous?.botToken ?? ""),
      proxyUrl: String(config.proxyUrl ?? previous?.proxyUrl ?? "").trim(),
      language: String(config.language ?? previous?.language ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN",
      inboundEnabled: config.inboundEnabled === true,
      allowedChatIds: list(config.allowedChatIds ?? previous?.allowedChatIds),
      allowedUserIds: list(config.allowedUserIds ?? previous?.allowedUserIds),
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
      testChatId: String(config.testChatId ?? previous?.testChatId ?? "").trim(),
    };
  }
  if (kind === "weixin") {
    const botToken = String(config.botToken ?? "").trim();
    return {
      botToken: botToken && botToken !== "********" ? botToken : String(previous?.botToken ?? ""),
      baseUrl: String(config.baseUrl ?? previous?.baseUrl ?? "https://ilinkai.weixin.qq.com").trim(),
      accountId: String(config.accountId ?? previous?.accountId ?? "").trim(),
      userId: String(config.userId ?? previous?.userId ?? "").trim(),
      language: String(config.language ?? previous?.language ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN",
      inboundEnabled: config.inboundEnabled === true,
      allowedChatIds: list(config.allowedChatIds ?? previous?.allowedChatIds),
      allowedUserIds: list(config.allowedUserIds ?? previous?.allowedUserIds),
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
      testChatId: String(config.testChatId ?? previous?.testChatId ?? "").trim(),
    };
  }
  if (kind === "feishu") {
    const appSecret = String(config.appSecret ?? "").trim();
    return {
      appId: String(config.appId ?? previous?.appId ?? "").trim(),
      appSecret: appSecret && appSecret !== "********" ? appSecret : String(previous?.appSecret ?? ""),
      domain: String(config.domain ?? previous?.domain ?? "feishu").trim() || "feishu",
      connectionMode: String(config.connectionMode ?? previous?.connectionMode ?? "websocket").trim() || "websocket",
      language: String(config.language ?? previous?.language ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN",
      testChatId: String(config.testChatId ?? previous?.testChatId ?? "").trim(),
      encryptKey: String(config.encryptKey ?? previous?.encryptKey ?? "").trim(),
      verificationToken: String(config.verificationToken ?? previous?.verificationToken ?? "").trim(),
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
      allowedChatIds: list(config.allowedChatIds ?? previous?.allowedChatIds),
      allowedUserIds: list(config.allowedUserIds ?? previous?.allowedUserIds),
    };
  }
  if (kind === "wecom") {
    const secret = String(config.secret ?? config.botSecret ?? "").trim();
    return {
      botId: String(config.botId ?? previous?.botId ?? "").trim(),
      secret: secret && secret !== "********" ? secret : String(previous?.secret ?? previous?.botSecret ?? ""),
      websocketUrl: String(config.websocketUrl ?? config.websocket_url ?? previous?.websocketUrl ?? previous?.websocket_url ?? "wss://openws.work.weixin.qq.com").trim() || "wss://openws.work.weixin.qq.com",
      dmPolicy: String(config.dmPolicy ?? previous?.dmPolicy ?? "open").trim().toLowerCase() || "open",
      allowFrom: list(config.allowFrom ?? config.allow_from ?? previous?.allowFrom ?? previous?.allow_from),
      groupPolicy: String(config.groupPolicy ?? previous?.groupPolicy ?? "open").trim().toLowerCase() || "open",
      groupAllowFrom: list(config.groupAllowFrom ?? config.group_allow_from ?? previous?.groupAllowFrom ?? previous?.group_allow_from),
      inboundEnabled: config.inboundEnabled === true,
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
      testChatId: String(config.testChatId ?? previous?.testChatId ?? "").trim(),
      language: String(config.language ?? previous?.language ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN",
    };
  }
  if (kind === "qq") {
    const clientSecret = String(config.clientSecret ?? config.appSecret ?? "").trim();
    return {
      appId: String(config.appId ?? previous?.appId ?? "").trim(),
      clientSecret: clientSecret && clientSecret !== "********" ? clientSecret : String(previous?.clientSecret ?? previous?.appSecret ?? ""),
      targetType: String(config.targetType ?? previous?.targetType ?? "user").trim().toLowerCase() || "user",
      targetId: String(config.targetId ?? config.openId ?? previous?.targetId ?? previous?.openId ?? "").trim(),
      testTargetId: String(config.testTargetId ?? config.testChatId ?? previous?.testTargetId ?? previous?.testChatId ?? previous?.targetId ?? previous?.openId ?? "").trim(),
      language: String(config.language ?? previous?.language ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN",
      inboundEnabled: config.inboundEnabled === true,
      allowedChatIds: list(config.allowedChatIds ?? previous?.allowedChatIds),
      allowedUserIds: list(config.allowedUserIds ?? previous?.allowedUserIds),
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
      testChatId: String(config.testChatId ?? previous?.testChatId ?? "").trim(),
    };
  }
  if (kind === "bark") {
    const deviceKey = String(config.deviceKey ?? "").trim();
    return {
      serverUrl: String(config.serverUrl ?? previous?.serverUrl ?? "https://api.day.app").trim(),
      deviceKey: deviceKey && deviceKey !== "********" ? deviceKey : String(previous?.deviceKey ?? ""),
      sound: String(config.sound ?? previous?.sound ?? "").trim(),
      group: String(config.group ?? previous?.group ?? "Codex Web").trim(),
      icon: String(config.icon ?? previous?.icon ?? "").trim(),
      url: String(config.url ?? previous?.url ?? "").trim(),
    };
  }
  if (["webhook", "weixin", "feishu"].includes(kind)) {
    return {
      url: String(config.url ?? previous?.url ?? "").trim(),
      method: String(config.method ?? previous?.method ?? "POST").trim().toUpperCase() || "POST",
      headers: typeof config.headers === "object" && config.headers && !Array.isArray(config.headers) ? config.headers : previous?.headers ?? {},
      bodyTemplate: String(config.bodyTemplate ?? previous?.bodyTemplate ?? "").trim(),
    };
  }
  return {
    url: String(config.url ?? previous?.url ?? "").trim(),
    method: String(config.method ?? previous?.method ?? "POST").trim().toUpperCase() || "POST",
    headers: typeof config.headers === "object" && config.headers && !Array.isArray(config.headers) ? config.headers : previous?.headers ?? {},
    bodyTemplate: String(config.bodyTemplate ?? previous?.bodyTemplate ?? "").trim(),
  };
}

function sanitizeNotificationTargets(targets?: NotificationRuleTarget[]) {
  return (targets ?? [])
    .map((target) => ({
      accountId: target.accountId ? String(target.accountId).trim() : undefined,
      recipientId: target.recipientId ? String(target.recipientId).trim() : undefined,
      senderAccountId: target.senderAccountId ? String(target.senderAccountId).trim() : undefined,
      chatId: target.chatId ? String(target.chatId).trim() : undefined,
      emailTo: Array.isArray(target.emailTo) ? target.emailTo.map((item) => String(item).trim()).filter(Boolean) : undefined,
    }))
    .filter((target) => target.accountId || target.recipientId);
}

function cleanupNotificationTargetsForDeletedReferences(input: { accountIds?: string[]; recipientIds?: string[] }) {
  const accountIds = new Set((input.accountIds ?? []).map((item) => item.trim()).filter(Boolean));
  const recipientIds = new Set((input.recipientIds ?? []).map((item) => item.trim()).filter(Boolean));
  if (!accountIds.size && !recipientIds.size) return;

  const cleanTargets = (rawTargets: unknown) => {
    const mapped: Array<NotificationRuleTarget | null> = sanitizeNotificationTargets(parseJsonValue<NotificationRuleTarget[]>(rawTargets, []))
    .map((target): NotificationRuleTarget | null => {
      if (target.accountId && accountIds.has(target.accountId)) return null;
      if (target.recipientId && recipientIds.has(target.recipientId)) return null;
      const next = { ...target };
      if (next.senderAccountId && accountIds.has(next.senderAccountId)) delete next.senderAccountId;
      return next;
    });
    return mapped.filter((target): target is NotificationRuleTarget => Boolean(target));
  };

  const rules = db.prepare("select id, targets from notification_rules").all() as Array<{ id?: string; targets?: unknown }>;
  for (const rule of rules) {
    const targets = cleanTargets(rule.targets);
    if (!targets.length) db.prepare("delete from notification_rules where id = ?").run(String(rule.id));
    else db.prepare("update notification_rules set targets = ?, updated_at = ? where id = ?").run(JSON.stringify(targets), new Date().toISOString(), String(rule.id));
  }

  const ephemeralRules = db.prepare("select id, targets from notification_ephemeral_rules").all() as Array<{ id?: string; targets?: unknown }>;
  for (const rule of ephemeralRules) {
    const targets = cleanTargets(rule.targets);
    if (!targets.length) db.prepare("delete from notification_ephemeral_rules where id = ?").run(String(rule.id));
    else db.prepare("update notification_ephemeral_rules set targets = ? where id = ?").run(JSON.stringify(targets), String(rule.id));
  }
}

function deleteNotificationAccount(accountId: string, options: { deleteLinkedRecipients?: boolean } = {}) {
  const linkedRecipients = (db.prepare("select id from notification_recipients where sender_account_id = ?").all(accountId) as Array<{ id?: string }>)
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
  const result = db.prepare("delete from notification_accounts where id = ?").run(accountId);
  if (!result.changes) return { deleted: false, linkedRecipientIds: [] as string[] };
  if (options.deleteLinkedRecipients) {
    db.prepare("delete from notification_recipients where sender_account_id = ?").run(accountId);
    cleanupNotificationTargetsForDeletedReferences({ accountIds: [accountId], recipientIds: linkedRecipients });
    return { deleted: true, linkedRecipientIds: linkedRecipients };
  }
  db.prepare("update notification_recipients set sender_account_id = null, updated_at = ? where sender_account_id = ?").run(new Date().toISOString(), accountId);
  cleanupNotificationTargetsForDeletedReferences({ accountIds: [accountId] });
  return { deleted: true, linkedRecipientIds: linkedRecipients };
}

function renderNotificationTemplate(template: string, event: NotificationEventInput, extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    ...extra,
    title: event.title,
    message: event.message,
    severity: event.severity,
    eventType: event.eventType,
    sourceType: event.sourceType ?? "",
    sourceId: event.sourceId ?? "",
    createdAt: new Date().toISOString(),
    metadata: event.metadata ?? {},
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, values);
    return value === undefined || value === null ? "" : String(value);
  });
}

function parseNotificationHeaders(template: string, event: NotificationEventInput, extra: Record<string, unknown>) {
  return Object.fromEntries(String(template ?? "").split("\n").map((line) => {
    const rendered = renderNotificationTemplate(line, event, extra);
    const index = rendered.indexOf(":");
    return index > 0 ? [rendered.slice(0, index).trim(), rendered.slice(index + 1).trim()] : ["", ""];
  }).filter(([key]) => key));
}

function parseWebhookPayload(request: Request, rawBody: Buffer) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const text = rawBody.toString("utf8");
  if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { body: text };
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  }
  return { body: text };
}

function validateWebhookToken(secret: string, request: Request) {
  if (secret === "INSECURE_NO_AUTH") return host === "127.0.0.1" || host === "localhost" || host === "::1";
  const provided = [
    request.headers.get("x-webhook-token"),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    new URL(request.url).searchParams.get("token"),
  ].find((value) => Boolean(value))?.trim();
  return Boolean(provided && provided === secret);
}

function normalizeWebhookConfig(config: Record<string, unknown>) {
  const copy = { ...config };
  if (copy.serverUrl) copy.serverUrl = String(copy.serverUrl).replace(/\/+$/, "");
  if (!copy.serverUrl && copy.deviceKey) copy.serverUrl = "https://api.day.app";
  if (!copy.group) copy.group = "Codex Web";
  return copy;
}

async function sendWebhookNotification(channel: NotificationChannelDefinition | null, config: Record<string, unknown>, event: NotificationEventInput) {
  const webhookConfig = normalizeWebhookConfig(config);
  const method = String(channel?.method ?? webhookConfig.method ?? "POST").toUpperCase();
  const headers = {
    "content-type": "application/json",
    ...(typeof webhookConfig.headers === "object" && webhookConfig.headers ? webhookConfig.headers as Record<string, string> : {}),
    ...parseNotificationHeaders(channel?.headersTemplate ?? "", event, webhookConfig),
  };
  const urlTemplate = channel?.urlTemplate || String(webhookConfig.url ?? "");
  if (!urlTemplate.trim()) throw new Error("webhook_url_required");
  const renderedUrl = new URL(renderNotificationTemplate(urlTemplate, event, webhookConfig));
  if (channel?.authType === "bearer") {
    const token = String(webhookConfig.token ?? webhookConfig.accessToken ?? webhookConfig.bearerToken ?? "").trim();
    if (!token) throw new Error("webhook_bearer_token_required");
    headers.authorization = `Bearer ${token}`;
  }
  if (channel?.authType === "query_token") {
    const token = String(webhookConfig.token ?? webhookConfig.accessToken ?? "").trim();
    if (!token) throw new Error("webhook_query_token_required");
    renderedUrl.searchParams.set(String(webhookConfig.tokenParam ?? "access_token"), token);
  }
  if (channel?.authType === "token_request") {
    throw new Error("webhook_token_request_auth_not_configured");
  }
  const bodyTemplate = channel?.bodyTemplate || String(webhookConfig.bodyTemplate ?? "") || JSON.stringify(event);
  const init: RequestInit = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD") init.body = renderNotificationTemplate(bodyTemplate, event, webhookConfig);
  const response = await fetch(renderedUrl.toString(), init);
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(text.slice(0, 500) || `webhook_http_${response.status}`);
  if (channel?.id === "bark" && text && /"code"\s*:\s*(?!200\b)\d+/i.test(text)) throw new Error(text.slice(0, 500) || `bark_http_${response.status}`);
  return { responseStatus: response.status };
}

async function sendNotificationToAccount(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
  const config = account.config;
  const customChannel = account.channelId ? getNotificationChannel(account.channelId) : null;
  if (account.channelKind === "webhook" && customChannel?.id && customChannel.id !== "webhook") return sendWebhookNotification(customChannel, config, event);
  if (account.channelKind === "email") return sendEmailNotification(account, event, target);
  if (account.channelKind === "telegram") {
    if (!config.botToken) throw new Error("telegram_bot_token_required");
    if (!target?.chatId) throw new Error("telegram_chat_id_required");
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: target.chatId,
      text: `${event.title}\n\n${event.message}`,
      disable_web_page_preview: true,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(text.slice(0, 500) || `telegram_http_${response.status}`);
    return { responseStatus: response.status };
  }
  if (account.channelKind === "weixin") return weixinPlatform.sendNotification(account, event, target);
  if (account.channelKind === "wecom") return wecomPlatform.sendNotification(account, event, target);
  if (account.channelKind === "dingtalk") return dingtalkPlatform.sendNotification(account, event);
  if (account.channelKind === "feishu") return feishuPlatform.sendNotification(account, event, target);
  if (account.channelKind === "qq") return qqPlatform.sendNotification(account, event, target);
  if (account.channelKind === "bark") return sendWebhookNotification(getNotificationChannel("bark"), config, event);
  return sendWebhookNotification(customChannel, config, event);
}

function telegramApiBase(account: NotificationAccountRecord) {
  const config = account.config as Record<string, unknown>;
  const proxyUrl = String(config.proxyUrl ?? "").trim();
  return (proxyUrl || "https://api.telegram.org").replace(/\/+$/, "");
}

async function telegramBotApi(account: NotificationAccountRecord, method: string, payload: Record<string, unknown>) {
  const config = account.config as Record<string, unknown>;
  if (!config.botToken) throw new Error("telegram_bot_token_required");
  return fetch(`${telegramApiBase(account)}/bot${String(config.botToken)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
  });
}

async function syncTelegramBotCommands(account: NotificationAccountRecord) {
  if (account.channelKind !== "telegram") return;
  const config = account.config as Record<string, unknown>;
  if (!config.botToken || config.botToken === "********") return;
  const language = notificationLanguageFromConfig(config);
  const commands = language === "en-US" ? [
    { command: "start", description: "Show bot help" },
    { command: "sessions", description: "List recent sessions" },
    { command: "agents", description: "List agents" },
    { command: "rooms", description: "List rooms" },
    { command: "files", description: "Browse files" },
    { command: "terminal", description: "Run a terminal command" },
    { command: "bind", description: "Bind this chat to a session" },
    { command: "unbind", description: "Clear the bound session" },
    { command: "send", description: "Send a message to a session" },
    { command: "help", description: "Show help" },
  ] : [
    { command: "start", description: "显示机器人帮助" },
    { command: "sessions", description: "列出最近会话" },
    { command: "agents", description: "列出代理" },
    { command: "rooms", description: "列出 Room" },
    { command: "files", description: "浏览文件" },
    { command: "terminal", description: "运行终端命令" },
    { command: "bind", description: "把当前聊天绑定到会话" },
    { command: "unbind", description: "清除绑定的会话" },
    { command: "send", description: "向会话发送消息" },
    { command: "help", description: "显示帮助" },
  ];
  if (account.enabled && config.inboundEnabled === true) {
    await telegramBotApi(account, "setMyCommands", {
      commands,
    });
    await telegramBotApi(account, "setChatMenuButton", {
      menu_button: { type: "commands" },
    });
    return;
  }
  await telegramBotApi(account, "deleteMyCommands", {});
  await telegramBotApi(account, "setChatMenuButton", {
    menu_button: { type: "default" },
  });
}

function notificationDeliveryMetadata(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget, recipient?: NotificationRecipientSummary) {
  return {
    eventMetadata: event.metadata ?? {},
    sourceType: event.sourceType ?? null,
    sourceId: event.sourceId ?? null,
    target: target ? {
      accountId: target.accountId ?? null,
      recipientId: target.recipientId ?? null,
      senderAccountId: target.senderAccountId ?? null,
      chatId: target.chatId ?? null,
      emailToCount: target.emailTo?.length ?? 0,
      emailTo: target.emailTo ?? [],
    } : null,
    account: {
      id: account.id,
      name: account.name,
      kind: account.channelKind,
      channelId: account.channelId ?? null,
    },
    recipient: recipient ? {
      id: recipient.id,
      name: recipient.name,
      kind: recipient.kind,
      senderAccountId: recipient.senderAccountId ?? null,
      channelId: recipient.channelId ?? null,
    } : null,
  };
}

async function deliverNotification(account: NotificationAccountRecord, event: NotificationEventInput, ruleId: string | null, target?: NotificationRuleTarget, recipient?: NotificationRecipientSummary) {
  const id = `notification-delivery-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(`
    insert into notification_deliveries (id, rule_id, account_id, event_type, severity, title, message, status, attempts, metadata, created_at)
    values (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(id, ruleId, account.id, event.eventType, event.severity, event.title, event.message, JSON.stringify(notificationDeliveryMetadata(account, event, target, recipient)), createdAt);
  try {
    const result = await sendNotificationToAccount(account, event, target);
    db.prepare("update notification_deliveries set status = 'sent', attempts = 1, response_status = ?, sent_at = ? where id = ?").run(result.responseStatus ?? null, new Date().toISOString(), id);
    return true;
  } catch (error) {
    db.prepare("update notification_deliveries set status = 'failed', attempts = 1, last_error = ? where id = ?").run(error instanceof Error ? error.message : String(error), id);
    return false;
  }
}

function chooseEmailNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const emailSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "email");
  return (target?.senderAccountId ? emailSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? emailSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (emailSenders.length === 1 ? emailSenders[0] : null);
}

function chooseTelegramNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const telegramSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "telegram");
  return (target?.senderAccountId ? telegramSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? telegramSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (telegramSenders.length === 1 ? telegramSenders[0] : null);
}

function chooseWeixinNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const weixinSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "weixin");
  return (target?.senderAccountId ? weixinSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? weixinSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (weixinSenders.length === 1 ? weixinSenders[0] : null);
}

function chooseWeComNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const wecomSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "wecom");
  return (target?.senderAccountId ? wecomSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? wecomSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (wecomSenders.length === 1 ? wecomSenders[0] : null);
}

function chooseDingtalkNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const dingtalkSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "dingtalk");
  return (target?.senderAccountId ? dingtalkSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? dingtalkSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (dingtalkSenders.length === 1 ? dingtalkSenders[0] : null);
}

function chooseFeishuNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const feishuSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "feishu");
  return (target?.senderAccountId ? feishuSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? feishuSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (feishuSenders.length === 1 ? feishuSenders[0] : null);
}

function chooseQQNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const qqSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "qq");
  return (target?.senderAccountId ? qqSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? qqSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (qqSenders.length === 1 ? qqSenders[0] : null);
}

async function deliverNotificationToRecipient(recipient: NotificationRecipientSummary, event: NotificationEventInput, ruleId: string | null, target?: NotificationRuleTarget) {
  if (recipient.kind === "email") {
    const sender = chooseEmailNotificationSender(recipient, target);
    if (!sender) throw new Error("email_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, emailTo: [String(recipient.config.email ?? "")].filter(Boolean) }, recipient);
  }
  if (recipient.kind === "telegram") {
    const sender = chooseTelegramNotificationSender(recipient, target);
    if (!sender) throw new Error("telegram_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, chatId: String(recipient.config.chatId ?? "") }, recipient);
  }
  if (recipient.kind === "weixin") {
    const sender = chooseWeixinNotificationSender(recipient, target);
    if (!sender) throw new Error("weixin_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, chatId: String(recipient.config.chatId ?? "") }, recipient);
  }
  if (recipient.kind === "wecom") {
    const sender = chooseWeComNotificationSender(recipient, target);
    if (!sender) throw new Error("wecom_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, chatId: String(recipient.config.chatId ?? "") }, recipient);
  }
  if (recipient.kind === "dingtalk") {
    const sender = chooseDingtalkNotificationSender(recipient, target);
    if (!sender) throw new Error("dingtalk_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id }, recipient);
  }
  if (recipient.kind === "qq") {
    const sender = chooseQQNotificationSender(recipient, target);
    if (!sender) throw new Error("qq_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, chatId: String(recipient.config.chatId ?? "") }, recipient);
  }
  if (recipient.kind === "feishu") {
    const sender = chooseFeishuNotificationSender(recipient, target);
    if (!sender) throw new Error("feishu_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, chatId: String(recipient.config.chatId ?? "") }, recipient);
  }
  const account: NotificationAccountRecord = {
    id: recipient.id,
    name: recipient.name,
    channelId: recipient.channelId ?? null,
    channelKind: "webhook",
    enabled: recipient.enabled,
    config: recipient.config,
    createdAt: recipient.createdAt,
    updatedAt: recipient.updatedAt,
  };
  return deliverNotification(account, event, ruleId, { recipientId: recipient.id, accountId: account.id }, recipient);
}

function notificationRecentlyDelivered(ruleId: string, accountId: string, eventType: NotificationEventType, dedupeMinutes: number) {
  if (dedupeMinutes <= 0) return false;
  const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
  return Boolean(db.prepare(`
    select id from notification_deliveries
    where rule_id = ? and account_id = ? and event_type = ? and created_at >= ? and status in ('sent', 'pending')
    limit 1
  `).get(ruleId, accountId, eventType, since));
}

function notificationEventTypesFromPrompt(prompt: string): NotificationEventType[] {
  const text = prompt.toLowerCase();
  if (/审批|批准|确认|approval/.test(text)) return ["needs_approval"];
  if (/失败|报错|错误|fail|error/.test(text)) return ["task_failed"];
  return ["task_completed"];
}

function registerEphemeralNotificationsFromPrompt(session: SessionSummary, prompt: string) {
  const text = prompt.trim();
  if (!/通知|提醒|notify/i.test(text)) return;
  const recipients = listNotificationRecipients(true).filter((recipient) => recipient.enabled);
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  const matched = recipients.filter((recipient) => {
    const name = recipient.name.toLowerCase().replace(/\s+/g, "");
    return name && normalized.includes(name);
  });
  const targets = (matched.length ? matched : recipients.length === 1 ? recipients : [])
    .map((recipient) => ({ recipientId: recipient.id }));
  if (!targets.length) return;
  const now = new Date().toISOString();
  db.prepare(`
    insert into notification_ephemeral_rules (id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at)
    values (?, 'session', ?, ?, ?, 1, 'after_trigger', ?)
  `).run(
    `notification-ephemeral-${randomUUID()}`,
    session.id,
    JSON.stringify(notificationEventTypesFromPrompt(text)),
    JSON.stringify(targets),
    now,
  );
}

function notificationScopesForEvent(event: NotificationEventInput) {
  const scopes: Array<{ scopeType: "session" | "task" | "room_task" | "automation"; scopeId: string }> = [];
  if (event.sourceType === "session" && event.sourceId) scopes.push({ scopeType: "session", scopeId: event.sourceId });
  if (event.sourceType === "automation" && event.sourceId) scopes.push({ scopeType: "automation", scopeId: event.sourceId });
  const metadataScopes = Array.isArray(event.metadata?.notificationScopes) ? event.metadata.notificationScopes : [];
  for (const item of metadataScopes) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const scopeType = record.scopeType === "session" || record.scopeType === "task" || record.scopeType === "room_task" || record.scopeType === "automation" ? record.scopeType : null;
    const scopeId = typeof record.scopeId === "string" && record.scopeId.trim() ? record.scopeId.trim() : "";
    if (scopeType && scopeId) scopes.push({ scopeType, scopeId });
  }
  return Array.from(new Map(scopes.map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope])).values());
}

function listEphemeralNotificationRulesForEvent(event: NotificationEventInput) {
  const scopes = notificationScopesForEvent(event);
  if (!scopes.length) return [];
  const rows = scopes.flatMap((scope) => db.prepare(`
    select * from notification_ephemeral_rules
    where enabled = 1 and scope_type = ? and scope_id = ?
    order by created_at asc
  `).all(scope.scopeType, scope.scopeId) as Array<Record<string, unknown>>);
  return rows
    .map((row) => ({
      id: String(row.id),
      scopeType: String(row.scope_type),
      scopeId: String(row.scope_id),
      eventTypes: parseJsonValue<NotificationEventType[]>(row.event_types, []).filter((type) => notificationEventTypes.includes(type)),
      targets: sanitizeNotificationTargets(parseJsonValue<NotificationRuleTarget[]>(row.targets, [])),
      expireMode: String(row.expire_mode),
    }))
    .filter((rule) => rule.eventTypes.includes(event.eventType) && rule.targets.length);
}

async function createExternalNotification(event: NotificationEventInput) {
  const accounts = new Map(listNotificationAccounts(true).filter((account) => account.enabled).map((account) => [account.id, account]));
  const recipients = new Map(listNotificationRecipients(true).filter((recipient) => recipient.enabled).map((recipient) => [recipient.id, recipient]));
  const rules = listAllNotificationRules().filter((rule) =>
    rule.enabled
    && rule.eventTypes.includes(event.eventType)
    && notificationSeverityRank[event.severity] >= notificationSeverityRank[rule.minSeverity]
  );
  for (const rule of rules) {
    for (const target of rule.targets) {
      if (target.recipientId) {
        const recipient = recipients.get(target.recipientId);
        if (!recipient || notificationRecentlyDelivered(rule.id, recipient.id, event.eventType, rule.dedupeMinutes)) continue;
        void deliverNotificationToRecipient(recipient, event, rule.id, target).catch((error) => console.error("recipient notification failed", error));
        continue;
      }
      if (!target.accountId) continue;
      const account = accounts.get(target.accountId);
      if (!account || notificationRecentlyDelivered(rule.id, account.id, event.eventType, rule.dedupeMinutes)) continue;
      void deliverNotification(account, event, rule.id, target);
    }
  }
  for (const rule of listEphemeralNotificationRulesForEvent(event)) {
    for (const target of rule.targets) {
      if (!target.recipientId) continue;
      const recipient = recipients.get(target.recipientId);
      if (!recipient) continue;
      void deliverNotificationToRecipient(recipient, event, rule.id, target).catch((error) => console.error("ephemeral recipient notification failed", error));
    }
    if (rule.expireMode === "after_trigger") {
      db.prepare("update notification_ephemeral_rules set enabled = 0, triggered_at = ? where id = ?").run(new Date().toISOString(), rule.id);
    }
  }
}

function sessionNotificationsEnabled(session?: SessionSummary | null) {
  return session?.notificationsEnabled !== false;
}

function roomSessionForRoomId(roomId?: string | null) {
  if (!roomId) return null;
  const room = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  return room?.session_id ? appData.sessions.find((session: SessionSummary) => session.id === room.session_id) ?? null : null;
}

function notificationsEnabledForEvent(event: NotificationEventInput) {
  const sourceSession = event.sourceType === "session" && event.sourceId
    ? appData.sessions.find((session: SessionSummary) => session.id === event.sourceId)
    : null;
  if (sourceSession && !sessionNotificationsEnabled(sourceSession)) return false;
  const metadataRoomId = typeof event.metadata?.roomId === "string" ? event.metadata.roomId : null;
  const roomSession = roomSessionForRoomId(metadataRoomId ?? sourceSession?.roomId ?? null);
  if (roomSession && !sessionNotificationsEnabled(roomSession)) return false;
  return true;
}

function emitExternalNotification(event: NotificationEventInput) {
  if (!notificationsEnabledForEvent(event)) return;
  createAppNotification(event);
  void createExternalNotification(event).catch((error) => console.error("notification dispatch failed", error));
}


  return {
    cleanupNotificationTargetsForDeletedReferences,
    createExternalNotification,
    createNotificationEphemeralRule,
    deleteNotificationAccount,
    deliverNotification,
    deliverNotificationToRecipient,
    emitExternalNotification,
    listAllNotificationRules,
    listNotificationAccounts,
    listNotificationDeliveries,
    listNotificationEphemeralRules,
    listNotificationRecipients,
    listNotificationRules,
    parseJsonValue,
    parseWebhookPayload,
    readNotificationRecipients,
    registerEphemeralNotificationsFromPrompt,
    sanitizeNotificationConfig,
    sanitizeNotificationTargets,
    sendNotificationToAccount,
    sendWebhookNotification,
    syncDefaultNotificationRecipients,
    syncTelegramBotCommands,
    validateWebhookToken,
  };
}
