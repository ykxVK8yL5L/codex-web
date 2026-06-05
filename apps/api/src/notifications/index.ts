import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AppNotificationStreamEvent,
  AppNotificationsResponse,
  NotificationAccountSummary,
  NotificationChannelAdapter,
  NotificationChannelAuthType,
  NotificationChannelDefinition,
  NotificationChannelKind,
  NotificationDeliveryStatus,
  NotificationDeliverySummary,
  NotificationEphemeralRuleSummary,
  NotificationEventType,
  NotificationPermissionPolicy,
  NotificationRecipientSummary,
  NotificationRuleSummary,
  NotificationRuleTarget,
  NotificationSeverity,
} from "@codex-web/protocol";

type NotificationStoreDeps = {
  db: Database.Database;
  builtinNotificationChannels: NotificationChannelDefinition[];
  listNotificationAccounts: (exposeSecrets?: boolean) => NotificationAccountSummary[];
};

type NotificationEventInput = {
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
};

let notificationStoreDeps: NotificationStoreDeps | null = null;
const appNotificationSubscribers = new Set<(event: AppNotificationStreamEvent) => void>();

export const notificationSeverityRank: Record<NotificationSeverity, number> = { info: 0, success: 1, warning: 2, error: 3 };
export const notificationEventTypes: NotificationEventType[] = ["task_completed", "task_failed", "task_interrupted", "needs_approval", "task_health_issue", "provider_check_failed", "backup_failed", "restore_failed", "auth_login"];

function deps() {
  if (!notificationStoreDeps) throw new Error("notification_store_not_initialized");
  return notificationStoreDeps;
}

export function setNotificationStoreDeps(nextDeps: NotificationStoreDeps) {
  notificationStoreDeps = nextDeps;
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function notificationChannelFromRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    kind: String(row.kind) as NotificationChannelKind,
    adapter: String(row.adapter ?? "webhook") as NotificationChannelAdapter,
    authType: String(row.auth_type ?? "none") as NotificationChannelAuthType,
    name: String(row.name),
    description: String(row.description ?? ""),
    builtin: Boolean(row.builtin),
    method: String(row.method ?? "POST"),
    urlTemplate: String(row.url_template ?? ""),
    headersTemplate: String(row.headers_template ?? ""),
    bodyTemplate: String(row.body_template ?? ""),
    accountFields: parseJsonValue<string[]>(row.account_fields, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  } satisfies NotificationChannelDefinition;
}

export function listNotificationChannels() {
  const { db, builtinNotificationChannels } = deps();
  const custom = (db.prepare("select * from notification_channels order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map(notificationChannelFromRow);
  return [...builtinNotificationChannels, ...custom];
}

export function getNotificationChannel(id?: string | null) {
  if (!id) return null;
  const { db, builtinNotificationChannels } = deps();
  return builtinNotificationChannels.find((channel) => channel.id === id)
    ?? ((db.prepare("select * from notification_channels where id = ?").get(id) as Record<string, unknown> | undefined) ? notificationChannelFromRow(db.prepare("select * from notification_channels where id = ?").get(id) as Record<string, unknown>) : null);
}

export function publicNotificationConfig(kind: NotificationAccountSummary["channelKind"], config: Record<string, unknown>) {
  const copy: Record<string, unknown> = { ...config };
  for (const key of ["password", "imapPassword", "deviceKey", "token", "secret", "botToken", "botSecret", "corpSecret", "accessToken", "bearerToken", "appSecret", "clientSecret", "encryptKey", "verificationToken"]) {
    if (copy[key]) copy[key] = "********";
  }
  if (kind === "webhook" && copy.headers && typeof copy.headers === "object") {
    copy.headers = Object.fromEntries(Object.entries(copy.headers as Record<string, unknown>).map(([key, value]) => [
      key,
      /authorization|token|secret|key/i.test(key) && value ? "********" : value,
    ]));
  }
  return copy;
}

export function notificationLanguageFromConfig(config?: Record<string, unknown> | null): "zh-CN" | "en-US" {
  return String(config?.language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

export function notificationLocaleText(language: "zh-CN" | "en-US", zh: string, en: string) {
  return language === "en-US" ? en : zh;
}

export function sanitizeNotificationPermissions(input?: NotificationPermissionPolicy | Record<string, unknown> | null): NotificationPermissionPolicy {
  const list = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return {
    allowedAgentIds: list(input?.allowedAgentIds),
    allowedRoomIds: list(input?.allowedRoomIds),
    allowedProjectIds: list(input?.allowedProjectIds),
  };
}

export function notificationAccountFromRow(row: Record<string, unknown>, exposeSecrets = false): NotificationAccountSummary {
  const channelId = row.channel_id ? String(row.channel_id) : null;
  const channelFromId = channelId ? getNotificationChannel(channelId) : null;
  const { builtinNotificationChannels } = deps();
  const channelKind = channelFromId?.kind
    ?? (builtinNotificationChannels.some((channel) => channel.kind === row.channel_kind) ? row.channel_kind as NotificationAccountSummary["channelKind"] : "webhook");
  const config = parseJsonValue<Record<string, unknown>>(row.config, {});
  return {
    id: String(row.id),
    name: String(row.name),
    channelId,
    channelKind,
    enabled: Boolean(row.enabled),
    config: exposeSecrets ? config : publicNotificationConfig(channelKind, config),
    permissions: sanitizeNotificationPermissions(parseJsonValue<NotificationPermissionPolicy>(row.permissions, {})),
    lastTestStatus: row.last_test_status ? String(row.last_test_status) as NotificationDeliveryStatus : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function notificationRecipientFromRow(row: Record<string, unknown>, exposeSecrets = false): NotificationRecipientSummary {
  const kind = ["email", "webhook", "bark", "telegram", "weixin", "wecom", "dingtalk", "feishu", "qq"].includes(String(row.kind)) ? String(row.kind) as NotificationRecipientSummary["kind"] : "webhook";
  const config = parseJsonValue<Record<string, unknown>>(row.config, {});
  return {
    id: String(row.id),
    name: String(row.name),
    kind,
    enabled: Boolean(row.enabled),
    senderAccountId: row.sender_account_id ? String(row.sender_account_id) : null,
    channelId: row.channel_id ? String(row.channel_id) : null,
    config: exposeSecrets ? config : publicNotificationConfig(kind === "email" ? "email" : kind === "bark" ? "bark" : kind === "telegram" ? "telegram" : kind === "weixin" ? "weixin" : kind === "wecom" ? "wecom" : kind === "dingtalk" ? "dingtalk" : kind === "feishu" ? "feishu" : kind === "qq" ? "qq" : "webhook", config),
    permissions: sanitizeNotificationPermissions(parseJsonValue<NotificationPermissionPolicy>(row.permissions, {})),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function notificationRuleFromRow(row: Record<string, unknown>): NotificationRuleSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    eventTypes: parseJsonValue<NotificationEventType[]>(row.event_types, []).filter((type) => notificationEventTypes.includes(type)),
    minSeverity: notificationSeverityRank[String(row.min_severity) as NotificationSeverity] !== undefined ? String(row.min_severity) as NotificationSeverity : "info",
    targets: parseJsonValue<NotificationRuleTarget[]>(row.targets, []),
    dedupeMinutes: Math.max(0, Number(row.dedupe_minutes) || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function notificationDeliveryFromRow(row: Record<string, unknown>): NotificationDeliverySummary {
  return {
    id: String(row.id),
    ruleId: row.rule_id ? String(row.rule_id) : null,
    accountId: row.account_id ? String(row.account_id) : null,
    eventType: String(row.event_type) as NotificationEventType,
    severity: String(row.severity) as NotificationSeverity,
    title: String(row.title),
    message: String(row.message),
    status: String(row.status) as NotificationDeliveryStatus,
    attempts: Number(row.attempts) || 0,
    responseStatus: row.response_status === null || row.response_status === undefined ? null : Number(row.response_status),
    lastError: row.last_error ? String(row.last_error) : null,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata, {}),
    createdAt: String(row.created_at),
    sentAt: row.sent_at ? String(row.sent_at) : null,
  };
}

export function notificationEphemeralRuleFromRow(row: Record<string, unknown>): NotificationEphemeralRuleSummary {
  const scopeType = String(row.scope_type);
  return {
    id: String(row.id),
    scopeType: scopeType === "task" || scopeType === "room_task" || scopeType === "automation" ? scopeType : "session",
    scopeId: String(row.scope_id),
    eventTypes: parseJsonValue<NotificationEventType[]>(row.event_types, []).filter((type) => notificationEventTypes.includes(type)),
    targets: parseJsonValue<NotificationRuleTarget[]>(row.targets, []),
    enabled: Boolean(row.enabled),
    expireMode: String(row.expire_mode) as NotificationEphemeralRuleSummary["expireMode"],
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    triggeredAt: row.triggered_at ? String(row.triggered_at) : null,
  };
}

export function appNotificationFromRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    eventType: String(row.event_type) as NotificationEventType,
    severity: String(row.severity) as NotificationSeverity,
    title: String(row.title),
    message: String(row.message),
    sourceType: row.source_type ? String(row.source_type) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata, {}),
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  };
}

export function createAppNotification(event: NotificationEventInput) {
  const { db } = deps();
  const id = `app-notification-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(`
    insert into app_notifications (id, event_type, severity, title, message, source_type, source_id, metadata, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.eventType,
    event.severity,
    event.title,
    event.message,
    event.sourceType ?? null,
    event.sourceId ?? null,
    JSON.stringify(event.metadata ?? {}),
    createdAt,
  );
  const notification = appNotificationFromRow(db.prepare("select * from app_notifications where id = ?").get(id) as Record<string, unknown>);
  publishAppNotificationEvent({ type: "notification", notification, unreadCount: appNotificationUnreadCount() });
  return notification;
}

export function listAppNotifications(limit = 30): AppNotificationsResponse {
  const { db } = deps();
  const rows = db.prepare(`
    select * from app_notifications
    order by created_at desc, id desc
    limit ?
  `).all(Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
  const unread = db.prepare("select count(*) as count from app_notifications where read_at is null").get() as { count?: number } | undefined;
  return {
    items: rows.map(appNotificationFromRow),
    unreadCount: unread?.count ?? 0,
  };
}

export function appNotificationUnreadCount() {
  const { db } = deps();
  const row = db.prepare("select count(*) as count from app_notifications where read_at is null").get() as { count?: number } | undefined;
  return row?.count ?? 0;
}

export function publishAppNotificationEvent(event: AppNotificationStreamEvent) {
  for (const subscriber of [...appNotificationSubscribers]) {
    try {
      subscriber(event);
    } catch {
      appNotificationSubscribers.delete(subscriber);
    }
  }
}

export function publishAppNotificationsSnapshot() {
  publishAppNotificationEvent({ type: "snapshot", ...listAppNotifications(30) });
}

export function subscribeAppNotifications(subscriber: (event: AppNotificationStreamEvent) => void) {
  appNotificationSubscribers.add(subscriber);
  return () => appNotificationSubscribers.delete(subscriber);
}
