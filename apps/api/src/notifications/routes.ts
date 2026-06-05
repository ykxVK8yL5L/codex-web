import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type {
  NotificationAccountSummary,
  NotificationChannelDefinition,
  NotificationDeliverySummary,
  NotificationDeliveryStatus,
  NotificationEphemeralRuleSummary,
  NotificationEventType,
  NotificationPermissionPolicy,
  NotificationRecipientSummary,
  NotificationRuleTarget,
  NotificationRuleSummary,
  NotificationSeverity,
  SessionSummary,
  TestNotificationAccountRequest,
  NotificationTestSettings,
  UpsertNotificationAccountRequest,
  UpsertNotificationChannelRequest,
  UpsertNotificationRecipientRequest,
  UpsertNotificationRuleRequest,
  WebhookRouteSummary,
} from "@codex-web/protocol";
import { platformOverview } from "./platforms.js";
import { parsePageLimit } from "../pagination.js";

type NotificationBaseRoutesDeps = {
  appData: { sessions: SessionSummary[] };
  db: Database.Database;
  listNotificationAccounts: () => NotificationAccountSummary[];
  listNotificationChannels: () => NotificationChannelDefinition[];
  listNotificationDeliveries: (limit?: number, cursor?: string | null, filters?: Record<string, unknown>) => { items: NotificationDeliverySummary[] };
  listNotificationEphemeralRules: (limit?: number, cursor?: string | null) => { items: NotificationEphemeralRuleSummary[] };
  listNotificationRecipients: () => NotificationRecipientSummary[];
  listNotificationRules: (limit?: number, cursor?: string | null, filters?: Record<string, unknown>) => { items: NotificationRuleSummary[] };
  listWebhookRoutes: () => WebhookRouteSummary[];
  notificationChannelFromRow: (row: Record<string, unknown>) => NotificationChannelDefinition;
  notificationRecipientFromRow: (row: Record<string, unknown>, exposeSecrets?: boolean) => NotificationRecipientSummary;
  sanitizeNotificationPermissions: (permissions?: NotificationPermissionPolicy | Record<string, unknown> | null) => NotificationPermissionPolicy;
};

type NotificationRecipientRoutesDeps = NotificationBaseRoutesDeps & {
  cleanupNotificationTargetsForDeletedReferences: (deleted: { recipientIds?: string[] }) => void;
  deliverNotificationToRecipient: (
    recipient: NotificationRecipientSummary,
    event: { eventType: "task_completed"; severity: "info"; title: string; message: string; sourceType: string; sourceId: string },
    ruleId: string | null,
    target: { recipientId: string },
  ) => Promise<boolean>;
  recipientHelpText: (kind: NotificationRecipientSummary["kind"]) => string;
};

type NotificationAccountRoutesDeps = NotificationBaseRoutesDeps & {
  deleteNotificationAccount: (id: string, options: { deleteLinkedRecipients?: boolean }) => { deleted: boolean; linkedRecipientIds: string[] };
  deliverNotification: (...args: any[]) => Promise<boolean>;
  getNotificationChannel: (id?: string | null) => NotificationChannelDefinition | null | undefined;
  notificationAccountFromRow: (row: Record<string, unknown>, exposeSecrets?: boolean) => NotificationAccountSummary;
  notificationAccountHelpText: (account: NotificationAccountSummary) => string;
  getNotificationChannels: () => NotificationChannelDefinition[];
  notificationLanguageFromConfig: (config: Record<string, unknown>) => string;
  getNotificationTestSettings: () => NotificationTestSettings;
  notificationLocaleText: (language: string, zh: string, en: string) => string;
  parseJsonValue: <T>(value: unknown, fallback: T) => T;
  platformSyncConnections: () => void;
  sanitizeNotificationConfig: (kind: NotificationAccountSummary["channelKind"], config?: Record<string, unknown>, previous?: Record<string, unknown>) => Record<string, unknown>;
  syncTelegramBotCommands: (account: NotificationAccountSummary) => Promise<void>;
  wecomConnectionStatus: (account: NotificationAccountSummary) => { ok: boolean; status: string; error?: string | null };
  weixinGetQrLoginState: (key: string) => any;
  weixinRefreshQrLogin: (key: string) => Promise<any>;
  weixinStartDraftQrLogin: (botType: string) => Promise<any>;
  weixinStartQrLogin: (accountId: string, botType: string) => Promise<any>;
};

type NotificationRuleRoutesDeps = NotificationBaseRoutesDeps & {
  createNotificationEphemeralRule: (input: {
    scopeType?: "session" | "task" | "room_task" | "automation";
    scopeId?: string;
    eventTypes?: NotificationEventType[];
    targets?: NotificationRuleTarget[];
    expireMode?: "after_trigger" | "session_end" | "manual";
  }) => NotificationEphemeralRuleSummary | null;
  deliverNotification: (...args: any[]) => Promise<boolean>;
  deliverNotificationToRecipient: (...args: any[]) => Promise<boolean>;
  notificationAccountFromRow: (row: Record<string, unknown>, exposeSecrets?: boolean) => NotificationAccountSummary;
  notificationDeliveryFromRow: (row: Record<string, unknown>) => NotificationDeliverySummary;
  notificationEphemeralRuleFromRow: (row: Record<string, unknown>) => NotificationEphemeralRuleSummary;
  notificationEventTypes: NotificationEventType[];
  notificationRuleFromRow: (row: Record<string, unknown>) => NotificationRuleSummary;
  notificationSeverityRank: Record<NotificationSeverity, number>;
  parseJsonValue: <T>(value: unknown, fallback: T) => T;
  sanitizeNotificationTargets: (targets?: NotificationRuleTarget[]) => NotificationRuleTarget[];
};

export function registerNotificationBaseRoutes(app: Hono, deps: NotificationBaseRoutesDeps) {
  app.get("/api/notifications", (c) => c.json({
    channels: deps.listNotificationChannels(),
    accounts: deps.listNotificationAccounts(),
    recipients: deps.listNotificationRecipients(),
    rules: deps.listNotificationRules(20).items,
    ephemeralRules: deps.listNotificationEphemeralRules(20).items,
    recentDeliveries: deps.listNotificationDeliveries(20).items,
  }));

  app.get("/api/notifications/platforms", (c) => c.json(platformOverview({
    db: deps.db,
    sessions: deps.appData.sessions,
    listNotificationAccounts: deps.listNotificationAccounts,
    webhookRoutes: deps.listWebhookRoutes(),
  })));

  app.get("/api/notifications/accounts", (c) => c.json(deps.listNotificationAccounts()));

  app.get("/api/notifications/channels", (c) => c.json(deps.listNotificationChannels()));

  app.post("/api/notifications/channels", async (c) => {
    const body = await c.req.json<UpsertNotificationChannelRequest>().catch(() => null);
    if (!body?.name?.trim() || !body.urlTemplate?.trim()) return c.json({ error: "invalid_notification_channel" }, 400);
    const now = new Date().toISOString();
    const id = `notification-channel-${randomUUID()}`;
    const adapter = body.adapter === "authenticated_webhook" ? "authenticated_webhook" : "webhook";
    const authType = body.authType && ["none", "bearer", "query_token", "token_request"].includes(body.authType) ? body.authType : "none";
    deps.db.prepare(`
      insert into notification_channels (id, name, kind, adapter, auth_type, description, method, url_template, headers_template, body_template, account_fields, builtin, created_at, updated_at)
      values (?, ?, 'webhook', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      body.name.trim(),
      adapter,
      authType,
      body.description?.trim() ?? "",
      body.method?.trim().toUpperCase() || "POST",
      body.urlTemplate.trim(),
      body.headersTemplate ?? "",
      body.bodyTemplate ?? "",
      JSON.stringify((body.accountFields ?? []).map((field) => field.trim()).filter(Boolean)),
      now,
      now,
    );
    return c.json(deps.notificationChannelFromRow(deps.db.prepare("select * from notification_channels where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/notifications/channels/:id", async (c) => {
    const current = deps.db.prepare("select * from notification_channels where id = ? and builtin = 0").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "notification_channel_not_found" }, 404);
    const body = await c.req.json<UpsertNotificationChannelRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_notification_channel" }, 400);
    const channel = deps.notificationChannelFromRow(current);
    const adapter = body.adapter === "authenticated_webhook" ? "authenticated_webhook" : channel.adapter ?? "webhook";
    const authType = body.authType && ["none", "bearer", "query_token", "token_request"].includes(body.authType) ? body.authType : channel.authType ?? "none";
    deps.db.prepare(`
      update notification_channels
      set name = ?, adapter = ?, auth_type = ?, description = ?, method = ?, url_template = ?, headers_template = ?, body_template = ?, account_fields = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || channel.name,
      adapter,
      authType,
      body.description?.trim() ?? channel.description,
      body.method?.trim().toUpperCase() || channel.method || "POST",
      body.urlTemplate?.trim() || channel.urlTemplate || "",
      body.headersTemplate ?? channel.headersTemplate ?? "",
      body.bodyTemplate ?? channel.bodyTemplate ?? "",
      JSON.stringify(body.accountFields ? body.accountFields.map((field) => field.trim()).filter(Boolean) : channel.accountFields ?? []),
      new Date().toISOString(),
      c.req.param("id"),
    );
    return c.json(deps.notificationChannelFromRow(deps.db.prepare("select * from notification_channels where id = ?").get(c.req.param("id")) as Record<string, unknown>));
  });

  app.delete("/api/notifications/channels/:id", (c) => {
    const used = deps.db.prepare("select id from notification_accounts where channel_id = ? limit 1").get(c.req.param("id"))
      ?? deps.db.prepare("select id from notification_recipients where channel_id = ? limit 1").get(c.req.param("id"));
    if (used) return c.json({ error: "notification_channel_in_use" }, 409);
    const result = deps.db.prepare("delete from notification_channels where id = ? and builtin = 0").run(c.req.param("id"));
    if (!result.changes) return c.json({ error: "notification_channel_not_found" }, 404);
    return c.json({ ok: true });
  });
}

export function registerNotificationRecipientRoutes(app: Hono, deps: NotificationRecipientRoutesDeps) {
  app.get("/api/notifications/recipients", (c) => c.json(deps.listNotificationRecipients()));

  app.post("/api/notifications/recipients", async (c) => {
    const body = await c.req.json<UpsertNotificationRecipientRequest>().catch(() => null);
    const kind = body?.kind && ["email", "webhook", "bark", "telegram", "weixin", "wecom", "dingtalk", "feishu", "qq"].includes(body.kind) ? body.kind : null;
    if (!body?.name?.trim() || !kind) return c.json({ error: "invalid_notification_recipient" }, 400);
    const now = new Date().toISOString();
    const id = `notification-recipient-${randomUUID()}`;
    deps.db.prepare(`
      insert into notification_recipients (id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name.trim(), kind, body.enabled === false ? 0 : 1, body.senderAccountId ?? null, body.channelId ?? null, JSON.stringify(body.config ?? {}), JSON.stringify(deps.sanitizeNotificationPermissions(body.permissions)), now, now);
    return c.json(deps.notificationRecipientFromRow(deps.db.prepare("select * from notification_recipients where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/notifications/recipients/:id", async (c) => {
    const current = deps.db.prepare("select * from notification_recipients where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "notification_recipient_not_found" }, 404);
    const body = await c.req.json<UpsertNotificationRecipientRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_notification_recipient" }, 400);
    const recipient = deps.notificationRecipientFromRow(current, true);
    deps.db.prepare(`
      update notification_recipients
      set name = ?, kind = ?, enabled = ?, sender_account_id = ?, channel_id = ?, config = ?, permissions = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || recipient.name,
      body.kind ?? recipient.kind,
      body.enabled === undefined ? (recipient.enabled ? 1 : 0) : body.enabled ? 1 : 0,
      body.senderAccountId === undefined ? recipient.senderAccountId : body.senderAccountId,
      body.channelId === undefined ? recipient.channelId : body.channelId,
      JSON.stringify({ ...recipient.config, ...(body.config ?? {}) }),
      JSON.stringify(body.permissions === undefined ? recipient.permissions ?? {} : deps.sanitizeNotificationPermissions(body.permissions)),
      new Date().toISOString(),
      c.req.param("id"),
    );
    return c.json(deps.notificationRecipientFromRow(deps.db.prepare("select * from notification_recipients where id = ?").get(c.req.param("id")) as Record<string, unknown>));
  });

  app.post("/api/notifications/recipients/:id/test", async (c) => {
    const row = deps.db.prepare("select * from notification_recipients where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row) return c.json({ error: "notification_recipient_not_found" }, 404);
    const recipient = deps.notificationRecipientFromRow(row, true);
    try {
      const ok = await deps.deliverNotificationToRecipient(recipient, {
        eventType: "task_completed",
        severity: "info",
        title: "Codex Web test notification",
        message: [
          "This is a test notification from Codex Web.",
          "",
          deps.recipientHelpText(recipient.kind),
        ].join("\n"),
        sourceType: "notification-recipient",
        sourceId: recipient.id,
      }, null, { recipientId: recipient.id });
      return c.json({ ok, recipient: deps.notificationRecipientFromRow(row) }, ok ? 200 : 400);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error), recipient: deps.notificationRecipientFromRow(row) }, 400);
    }
  });

  app.delete("/api/notifications/recipients/:id", (c) => {
    const recipientId = c.req.param("id");
    const result = deps.db.prepare("delete from notification_recipients where id = ?").run(recipientId);
    if (!result.changes) return c.json({ error: "notification_recipient_not_found" }, 404);
    deps.cleanupNotificationTargetsForDeletedReferences({ recipientIds: [recipientId] });
    return c.json({ ok: true });
  });
}

export function registerNotificationAccountRoutes(app: Hono, deps: NotificationAccountRoutesDeps) {
  app.post("/api/notifications/accounts", async (c) => {
    const body = await c.req.json<UpsertNotificationAccountRequest>().catch(() => null);
    const selectedChannel = deps.getNotificationChannel(body?.channelId) ?? (body?.channelKind ? deps.getNotificationChannels().find((channel) => channel.kind === body.channelKind) : null);
    const channelKind = selectedChannel?.kind ?? null;
    if (!body?.name?.trim() || !channelKind) return c.json({ error: "invalid_notification_account" }, 400);
    const now = new Date().toISOString();
    const id = `notification-account-${randomUUID()}`;
    const config = selectedChannel?.builtin === false ? (body.config ?? {}) : deps.sanitizeNotificationConfig(channelKind, body.config);
    deps.db.prepare(`
      insert into notification_accounts (id, name, channel_id, channel_kind, enabled, config, permissions, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name.trim(), selectedChannel?.id ?? null, channelKind, body.enabled === false ? 0 : 1, JSON.stringify(config), JSON.stringify(deps.sanitizeNotificationPermissions(body.permissions)), now, now);
    const account = deps.notificationAccountFromRow(deps.db.prepare("select * from notification_accounts where id = ?").get(id) as Record<string, unknown>, true);
    void deps.syncTelegramBotCommands(account).catch((error) => console.warn("telegram command menu sync failed", account.id, error));
    deps.platformSyncConnections();
    return c.json(deps.notificationAccountFromRow(deps.db.prepare("select * from notification_accounts where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/notifications/accounts/:id", async (c) => {
    const current = deps.db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "notification_account_not_found" }, 404);
    const body = await c.req.json<UpsertNotificationAccountRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_notification_account" }, 400);
    const currentKind = String(current.channel_kind) as NotificationAccountSummary["channelKind"];
    const selectedChannel = deps.getNotificationChannel(body.channelId ?? (current.channel_id ? String(current.channel_id) : null)) ?? (body.channelKind ? deps.getNotificationChannels().find((channel) => channel.kind === body.channelKind) : null);
    const channelKind = selectedChannel?.kind ?? currentKind;
    const previousConfig = deps.parseJsonValue<Record<string, unknown>>(current.config, {});
    deps.db.prepare(`
      update notification_accounts
      set name = ?, channel_id = ?, channel_kind = ?, enabled = ?, config = ?, permissions = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || String(current.name),
      selectedChannel?.id ?? current.channel_id ?? null,
      channelKind,
      body.enabled === undefined ? (Boolean(current.enabled) ? 1 : 0) : body.enabled ? 1 : 0,
      JSON.stringify(selectedChannel?.builtin === false ? { ...previousConfig, ...(body.config ?? {}) } : deps.sanitizeNotificationConfig(channelKind, body.config, previousConfig)),
      JSON.stringify(body.permissions === undefined ? deps.sanitizeNotificationPermissions(deps.parseJsonValue<NotificationPermissionPolicy>(current.permissions, {})) : deps.sanitizeNotificationPermissions(body.permissions)),
      new Date().toISOString(),
      c.req.param("id"),
    );
    const account = deps.notificationAccountFromRow(deps.db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown>, true);
    void deps.syncTelegramBotCommands(account).catch((error) => console.warn("telegram command menu sync failed", account.id, error));
    deps.platformSyncConnections();
    return c.json(deps.notificationAccountFromRow(deps.db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown>));
  });

  app.post("/api/notifications/accounts/:id/weixin/qr/start", async (c) => {
    const row = deps.db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row || String(row.channel_kind) !== "weixin") return c.json({ error: "notification_account_not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { botType?: string };
    try {
      return c.json(await deps.weixinStartQrLogin(String(row.id), String(body.botType ?? "3")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/notifications/weixin/qr/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { botType?: string };
    try {
      return c.json(await deps.weixinStartDraftQrLogin(String(body.botType ?? "3")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/notifications/accounts/:id/weixin/qr/status", async (c) => {
    const row = deps.db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row || String(row.channel_kind) !== "weixin") return c.json({ error: "notification_account_not_found" }, 404);
    try {
      const state = deps.weixinGetQrLoginState(String(row.id));
      if (!state) return c.json({ error: "weixin_qr_session_not_found" }, 404);
      if (state.status === "wait" || state.status === "scaned" || state.status === "scaned_but_redirect") {
        return c.json(await deps.weixinRefreshQrLogin(String(row.id)));
      }
      return c.json(state);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/notifications/weixin/qr/status", async (c) => {
    const qrKey = String(c.req.query("qrKey") ?? "").trim();
    if (!qrKey) return c.json({ error: "weixin_qr_session_not_found" }, 404);
    try {
      const state = deps.weixinGetQrLoginState(qrKey);
      if (!state) return c.json({ error: "weixin_qr_session_not_found" }, 404);
      if (state.status === "wait" || state.status === "scaned" || state.status === "scaned_but_redirect") {
        return c.json(await deps.weixinRefreshQrLogin(qrKey));
      }
      return c.json(state);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/notifications/accounts/:id", (c) => {
    const deleteLinkedRecipients = c.req.query("deleteLinkedRecipients") === "true";
    const result = deps.deleteNotificationAccount(c.req.param("id"), { deleteLinkedRecipients });
    if (!result.deleted) return c.json({ error: "notification_account_not_found" }, 404);
    deps.platformSyncConnections();
    return c.json({ ok: true, deletedRecipientIds: deleteLinkedRecipients ? result.linkedRecipientIds : [] });
  });

  app.post("/api/notifications/accounts/:id/test", async (c) => {
    const row = deps.db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row) return c.json({ error: "notification_account_not_found" }, 404);
    const body = await c.req.json<TestNotificationAccountRequest>().catch((): TestNotificationAccountRequest => ({}));
    const account = deps.notificationAccountFromRow(row, true);
    const config = account.config as Record<string, unknown>;
    const language = deps.notificationLanguageFromConfig(config);
    const emailTo = body?.emailTo?.length
      ? body.emailTo
      : Array.isArray(config.testEmailTo)
        ? config.testEmailTo.map((item) => String(item).trim()).filter(Boolean)
        : String(config.testEmailTo ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const chatId = String(body?.chatId ?? config.testChatId ?? "").trim() || undefined;
    if (account.channelKind === "wecom" && !chatId) {
      deps.platformSyncConnections();
      let status = deps.wecomConnectionStatus(account);
      const deadline = Date.now() + 3_000;
      while (!status.ok && status.status === "subscribing" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = deps.wecomConnectionStatus(account);
      }
      deps.db.prepare("update notification_accounts set last_test_status = ?, last_error = ?, updated_at = ? where id = ?")
        .run(status.ok ? "sent" : "failed", status.error, new Date().toISOString(), account.id);
      return c.json({
        ok: status.ok,
        status: status.status,
        error: status.error,
        account: deps.notificationAccountFromRow(deps.db.prepare("select * from notification_accounts where id = ?").get(account.id) as Record<string, unknown>),
      }, status.ok ? 200 : 400);
    }
    const helpText = deps.notificationAccountHelpText(account);
    const customTitle = String(body?.title ?? "").trim();
    const customMessage = String(body?.message ?? "").trim();
    const includeHelp = body?.includeHelp !== false;
    const notificationTestSettings = deps.getNotificationTestSettings();
    const title = customTitle || deps.notificationLocaleText(language, notificationTestSettings.titleZh, notificationTestSettings.titleEn);
    const message = customMessage
      ? [customMessage, includeHelp ? helpText : ""].filter(Boolean).join("\n\n")
      : [
        deps.notificationLocaleText(language, notificationTestSettings.messageZh, notificationTestSettings.messageEn),
        "",
        notificationTestSettings.includeHelp ? helpText : "",
      ].filter((item, index) => index === 1 || Boolean(item)).join("\n");
    const ok = await deps.deliverNotification(account, {
      eventType: "task_completed",
      severity: "info",
      title,
      message,
      sourceType: "notification-account",
      sourceId: account.id,
    }, null, { accountId: account.id, emailTo, chatId });
    deps.db.prepare("update notification_accounts set last_test_status = ?, last_error = (select last_error from notification_deliveries where account_id = ? order by created_at desc limit 1), updated_at = ? where id = ?")
      .run(ok ? "sent" : "failed", account.id, new Date().toISOString(), account.id);
    return c.json({ ok, account: deps.notificationAccountFromRow(deps.db.prepare("select * from notification_accounts where id = ?").get(account.id) as Record<string, unknown>) }, ok ? 200 : 400);
  });
}

export function registerNotificationRuleRoutes(app: Hono, deps: NotificationRuleRoutesDeps) {
  app.post("/api/notifications/ephemeral-rules", async (c) => {
    const body = await c.req.json<{
      scopeType?: "session" | "task" | "room_task" | "automation";
      scopeId?: string;
      eventTypes?: NotificationEventType[];
      targets?: NotificationRuleTarget[];
      expireMode?: "after_trigger" | "session_end" | "manual";
    }>().catch(() => null);
    const rule = body ? deps.createNotificationEphemeralRule(body) : null;
    if (!rule) return c.json({ error: "invalid_notification_ephemeral_rule" }, 400);
    return c.json(rule, 201);
  });

  app.patch("/api/notifications/ephemeral-rules/:id", async (c) => {
    const current = deps.db.prepare("select * from notification_ephemeral_rules where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "notification_ephemeral_rule_not_found" }, 404);
    const body = await c.req.json<{
      scopeType?: "session" | "task" | "room_task" | "automation";
      scopeId?: string;
      eventTypes?: NotificationEventType[];
      targets?: NotificationRuleTarget[];
      expireMode?: "after_trigger" | "session_end" | "manual";
      enabled?: boolean;
    }>().catch(() => null);
    if (!body) return c.json({ error: "invalid_notification_ephemeral_rule" }, 400);
    const nextScopeType = body.scopeType === "task" || body.scopeType === "room_task" || body.scopeType === "automation" ? body.scopeType : String(current.scope_type) as "session" | "task" | "room_task" | "automation";
    const nextScopeId = String(body.scopeId ?? current.scope_id).trim();
    const nextEventTypes = (body.eventTypes ?? deps.parseJsonValue<NotificationEventType[]>(current.event_types, [])).filter((type) => deps.notificationEventTypes.includes(type));
    const nextTargets = deps.sanitizeNotificationTargets(body.targets ?? deps.parseJsonValue<NotificationRuleTarget[]>(current.targets, []));
    const nextExpireMode = body.expireMode === "session_end" || body.expireMode === "manual" ? body.expireMode : String(current.expire_mode) as "after_trigger" | "session_end" | "manual";
    if (!nextScopeId || !nextEventTypes.length || !nextTargets.length) return c.json({ error: "invalid_notification_ephemeral_rule" }, 400);
    deps.db.prepare(`
      update notification_ephemeral_rules
      set scope_type = ?, scope_id = ?, event_types = ?, targets = ?, enabled = ?, expire_mode = ?
      where id = ?
    `).run(
      nextScopeType,
      nextScopeId,
      JSON.stringify(nextEventTypes),
      JSON.stringify(nextTargets),
      body.enabled === undefined ? Number(current.enabled ?? 1) : body.enabled ? 1 : 0,
      nextExpireMode,
      c.req.param("id"),
    );
    return c.json(deps.notificationEphemeralRuleFromRow(deps.db.prepare("select * from notification_ephemeral_rules where id = ?").get(c.req.param("id")) as Record<string, unknown>));
  });

  app.delete("/api/notifications/ephemeral-rules/:id", (c) => {
    const result = deps.db.prepare("delete from notification_ephemeral_rules where id = ?").run(c.req.param("id"));
    if (!result.changes) return c.json({ error: "notification_ephemeral_rule_not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/notifications/ephemeral-rules", (c) => c.json(deps.listNotificationEphemeralRules(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));

  app.get("/api/notifications/rules", (c) => c.json(deps.listNotificationRules(
    parsePageLimit(c.req.query("limit"), 50),
    c.req.query("cursor"),
    { enabled: c.req.query("enabled") === "true" ? true : c.req.query("enabled") === "false" ? false : undefined },
  )));

  app.delete("/api/notifications/rules", (c) => {
    const rules = deps.db.prepare("delete from notification_rules").run();
    const ephemeral = deps.db.prepare("delete from notification_ephemeral_rules").run();
    return c.json({ ok: true, deleted: rules.changes + ephemeral.changes });
  });

  app.post("/api/notifications/rules", async (c) => {
    const body = await c.req.json<UpsertNotificationRuleRequest>().catch(() => null);
    if (!body?.name?.trim()) return c.json({ error: "invalid_notification_rule" }, 400);
    const eventTypes = (body.eventTypes ?? []).filter((type) => deps.notificationEventTypes.includes(type));
    const targets = deps.sanitizeNotificationTargets(body.targets);
    if (!eventTypes.length || !targets.length) return c.json({ error: "notification_rule_requires_events_and_targets" }, 400);
    const now = new Date().toISOString();
    const id = `notification-rule-${randomUUID()}`;
    deps.db.prepare(`
      insert into notification_rules (id, name, enabled, event_types, min_severity, targets, dedupe_minutes, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name.trim(),
      body.enabled === false ? 0 : 1,
      JSON.stringify(eventTypes),
      body.minSeverity && deps.notificationSeverityRank[body.minSeverity] !== undefined ? body.minSeverity : "info",
      JSON.stringify(targets),
      Math.max(0, Number(body.dedupeMinutes) || 0),
      now,
      now,
    );
    return c.json(deps.notificationRuleFromRow(deps.db.prepare("select * from notification_rules where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/notifications/rules/:id", async (c) => {
    const current = deps.db.prepare("select * from notification_rules where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "notification_rule_not_found" }, 404);
    const body = await c.req.json<UpsertNotificationRuleRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_notification_rule" }, 400);
    const rule = deps.notificationRuleFromRow(current);
    const eventTypes = body.eventTypes ? body.eventTypes.filter((type) => deps.notificationEventTypes.includes(type)) : rule.eventTypes;
    const targets = body.targets ? deps.sanitizeNotificationTargets(body.targets) : rule.targets;
    if (!eventTypes.length || !targets.length) return c.json({ error: "notification_rule_requires_events_and_targets" }, 400);
    deps.db.prepare(`
      update notification_rules
      set name = ?, enabled = ?, event_types = ?, min_severity = ?, targets = ?, dedupe_minutes = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || rule.name,
      body.enabled === undefined ? (rule.enabled ? 1 : 0) : body.enabled ? 1 : 0,
      JSON.stringify(eventTypes),
      body.minSeverity && deps.notificationSeverityRank[body.minSeverity] !== undefined ? body.minSeverity : rule.minSeverity,
      JSON.stringify(targets),
      Math.max(0, Number(body.dedupeMinutes ?? rule.dedupeMinutes) || 0),
      new Date().toISOString(),
      c.req.param("id"),
    );
    return c.json(deps.notificationRuleFromRow(deps.db.prepare("select * from notification_rules where id = ?").get(c.req.param("id")) as Record<string, unknown>));
  });

  app.delete("/api/notifications/rules/:id", (c) => {
    const result = deps.db.prepare("delete from notification_rules where id = ?").run(c.req.param("id"));
    if (!result.changes) return c.json({ error: "notification_rule_not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/notifications/deliveries", (c) => {
    const eventType = c.req.query("eventType") as NotificationEventType | undefined;
    const status = c.req.query("status") as NotificationDeliveryStatus | undefined;
    const severity = c.req.query("severity") as NotificationSeverity | undefined;
    return c.json(deps.listNotificationDeliveries(
      parsePageLimit(c.req.query("limit"), 50),
      c.req.query("cursor"),
      {
        eventType: eventType && deps.notificationEventTypes.includes(eventType) ? eventType : undefined,
        status: status && ["pending", "sent", "failed", "skipped"].includes(status) ? status : undefined,
        severity: severity && deps.notificationSeverityRank[severity] !== undefined ? severity : undefined,
      },
    ));
  });

  app.delete("/api/notifications/deliveries", (c) => {
    const result = deps.db.prepare("delete from notification_deliveries").run();
    return c.json({ ok: true, deleted: result.changes });
  });

  app.post("/api/notifications/deliveries/:id/retry", async (c) => {
    const row = deps.db.prepare("select * from notification_deliveries where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row) return c.json({ error: "notification_delivery_not_found" }, 404);
    const delivery = deps.notificationDeliveryFromRow(row);
    const metadata = delivery.metadata ?? {};
    const metadataTarget = metadata.target && typeof metadata.target === "object" ? metadata.target as Record<string, unknown> : {};
    const metadataRecipient = metadata.recipient && typeof metadata.recipient === "object" ? metadata.recipient as Record<string, unknown> : {};
    const target: NotificationRuleTarget = deps.sanitizeNotificationTargets([{
      accountId: metadataTarget.accountId ? String(metadataTarget.accountId) : delivery.accountId ?? undefined,
      recipientId: metadataTarget.recipientId ? String(metadataTarget.recipientId) : metadataRecipient.id ? String(metadataRecipient.id) : undefined,
      senderAccountId: metadataTarget.senderAccountId ? String(metadataTarget.senderAccountId) : undefined,
      chatId: metadataTarget.chatId ? String(metadataTarget.chatId) : undefined,
      emailTo: Array.isArray(metadataTarget.emailTo) ? metadataTarget.emailTo.map((item) => String(item)) : undefined,
    }])[0] ?? {};
    const event = {
      eventType: delivery.eventType,
      severity: delivery.severity,
      title: delivery.title,
      message: delivery.message,
      sourceType: typeof metadata.sourceType === "string" ? metadata.sourceType : undefined,
      sourceId: typeof metadata.sourceId === "string" ? metadata.sourceId : undefined,
      metadata: {
        ...(metadata.eventMetadata && typeof metadata.eventMetadata === "object" ? metadata.eventMetadata as Record<string, unknown> : {}),
        retryOfDeliveryId: delivery.id,
      },
    };
    if (target.recipientId) {
      const recipientRow = deps.db.prepare("select * from notification_recipients where id = ?").get(target.recipientId) as Record<string, unknown> | undefined;
      if (!recipientRow) return c.json({ error: "notification_recipient_not_found" }, 404);
      const ok = await deps.deliverNotificationToRecipient(deps.notificationRecipientFromRow(recipientRow, true), event, delivery.ruleId ?? null, target);
      return c.json({ ok });
    }
    if (!delivery.accountId) return c.json({ error: "notification_delivery_target_missing" }, 400);
    const accountRow = deps.db.prepare("select * from notification_accounts where id = ?").get(delivery.accountId) as Record<string, unknown> | undefined;
    if (!accountRow) {
      const recipientRow = deps.db.prepare("select * from notification_recipients where id = ?").get(delivery.accountId) as Record<string, unknown> | undefined;
      if (recipientRow) {
        const ok = await deps.deliverNotificationToRecipient(deps.notificationRecipientFromRow(recipientRow, true), event, delivery.ruleId ?? null, { ...target, recipientId: delivery.accountId });
        return c.json({ ok });
      }
    }
    if (!accountRow) return c.json({ error: "notification_account_not_found" }, 404);
    const ok = await deps.deliverNotification(deps.notificationAccountFromRow(accountRow, true), event, delivery.ruleId ?? null, { ...target, accountId: delivery.accountId });
    return c.json({ ok });
  });

  app.delete("/api/notifications/deliveries/:id", (c) => {
    const result = deps.db.prepare("delete from notification_deliveries where id = ?").run(c.req.param("id"));
    if (!result.changes) return c.json({ error: "notification_delivery_not_found" }, 404);
    return c.json({ ok: true });
  });
}
