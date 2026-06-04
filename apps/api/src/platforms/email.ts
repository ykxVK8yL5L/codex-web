import type Database from "better-sqlite3";
import { simpleParser } from "mailparser";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
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
type CreateInboundSession = (senderEmail: string, senderName: string, subject?: string | null) => SessionSummary;

type EmailRouteRow = {
  account_id?: string;
  chat_id?: string;
  session_id?: string;
  subject?: string | null;
  inbound_message_id?: string | null;
  last_message_id?: string | null;
  updated_at?: string;
};

type EmailPlatformDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  listNotificationAccounts: (exposeSecrets?: boolean) => NotificationAccountSummary[];
  dispatchMessageToSession: DispatchMessageToSession;
  createInboundSession: CreateInboundSession;
};

function listCsv(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function notificationLanguage(account: NotificationAccountRecord) {
  return String((account.config as Record<string, unknown>).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function emailUi(account: NotificationAccountRecord) {
  const en = notificationLanguage(account) === "en-US";
  return {
    noSessions: en ? "No sessions yet." : "暂无会话。",
    noAvailableSessions: en ? "No sessions are available. Create a session first." : "当前没有可用会话，请先创建一个会话。",
    inboundDisabled: en ? "Inbound is disabled for this account." : "当前账号未启用收信。",
    missingImap: en ? "IMAP settings are incomplete." : "IMAP 配置不完整。",
    sessionCreated: en ? "Email session created:" : "已创建邮件会话：",
    senderRejected: en ? "Sender is not allowlisted." : "发件人不在允许列表中。",
    fromUnknown: en ? "Unknown sender" : "未知发件人",
    subjectPrefix: en ? "[Subject: {subject}]" : "【主题：{subject}】",
    attachmentsPrefix: en ? "Attachments:" : "附件：",
    sentTo: en ? "Sent to" : "已发送到",
  } as const;
}

function normalizeEmailConfig(account: NotificationAccountRecord) {
  const config = account.config as Record<string, unknown>;
  const smtpUsername = String(config.username ?? "").trim();
  const smtpPassword = String(config.password ?? "").trim();
  const imapUsername = String(config.imapUsername ?? smtpUsername).trim();
  const imapPassword = String(config.imapPassword ?? smtpPassword).trim();
  const imapHost = String(config.imapHost ?? config.host ?? "").trim();
  const imapPort = Number(config.imapPort ?? 993) || 993;
  return {
    smtpHost: String(config.host ?? "").trim(),
    smtpPort: Number(config.port ?? 587) || 587,
    smtpSecure: config.secure === true,
    smtpUsername,
    smtpPassword,
    fromName: String(config.fromName ?? "Codex Web").trim(),
    fromEmail: String(config.fromEmail ?? "").trim(),
    testEmailTo: listCsv(config.testEmailTo),
    inboundEnabled: config.inboundEnabled === true,
    imapHost,
    imapPort,
    imapSecure: config.imapSecure === true || imapPort === 993,
    imapUsername,
    imapPassword,
    inboundMailbox: String(config.inboundMailbox ?? "INBOX").trim() || "INBOX",
    allowedSenderEmails: listCsv(config.allowedSenderEmails).map((item) => item.toLowerCase()),
    defaultSessionId: String(config.defaultSessionId ?? "").trim(),
    senderAddress: String(config.fromEmail ?? smtpUsername ?? "").trim().toLowerCase(),
  };
}

function emailReplySubject(subject?: string | null) {
  const clean = String(subject ?? "").trim();
  if (!clean) return "Re: Codex Web";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

function buildEmailBody(account: NotificationAccountRecord, senderName: string, senderEmail: string, subject?: string | null, body?: string, attachments?: string[]) {
  const ui = emailUi(account);
  const lines = [
    senderName && senderName !== senderEmail ? `${senderName} <${senderEmail}>` : senderEmail,
    subject ? ui.subjectPrefix.replace("{subject}", subject) : "",
    body?.trim() ?? "",
  ].filter(Boolean);
  if (attachments?.length) {
    lines.push("", ui.attachmentsPrefix, ...attachments.map((item, index) => `${index + 1}. ${item}`));
  }
  return lines.join("\n\n").trim();
}

function getEmailThreadRoutes(db: Database.Database, sessionId: string) {
  return db.prepare(`
    select *
    from email_chat_routes
    where session_id = ?
    order by updated_at desc, chat_id asc
  `).all(sessionId) as EmailRouteRow[];
}

function upsertEmailThreadRoute(db: Database.Database, accountId: string, chatId: string, sessionId: string, data: { subject?: string | null; inboundMessageId?: string | null; lastMessageId?: string | null } = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    insert into email_chat_routes (account_id, chat_id, session_id, subject, inbound_message_id, last_message_id, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(account_id, chat_id) do update set
      session_id = excluded.session_id,
      subject = coalesce(excluded.subject, email_chat_routes.subject),
      inbound_message_id = coalesce(excluded.inbound_message_id, email_chat_routes.inbound_message_id),
      last_message_id = coalesce(excluded.last_message_id, email_chat_routes.last_message_id),
      updated_at = excluded.updated_at
  `).run(accountId, chatId.toLowerCase(), sessionId, data.subject ?? null, data.inboundMessageId ?? null, data.lastMessageId ?? null, now);
}

function resolveThreadRoute(db: Database.Database, accountId: string, chatId: string) {
  return db.prepare("select * from email_chat_routes where account_id = ? and chat_id = ?").get(accountId, chatId.toLowerCase()) as EmailRouteRow | undefined;
}

function routeSenderToSession(deps: EmailPlatformDeps, account: NotificationAccountRecord, senderEmail: string, senderName: string, subject?: string | null, inboundMessageId?: string | null) {
  const config = normalizeEmailConfig(account);
  const existing = resolveThreadRoute(deps.db, account.id, senderEmail);
  const routedSession = existing ? deps.sessions.find((session) => session.id === existing.session_id) ?? null : null;
  let session = routedSession;
  if (!session) {
    session = config.defaultSessionId ? deps.sessions.find((item) => item.id === config.defaultSessionId) ?? null : null;
    if (!session) {
      session = deps.createInboundSession(senderEmail, senderName, subject ?? null);
    }
  }
  upsertEmailThreadRoute(deps.db, account.id, senderEmail, session.id, {
    subject: subject ?? existing?.subject ?? null,
    inboundMessageId: inboundMessageId ?? existing?.inbound_message_id ?? null,
    lastMessageId: existing?.last_message_id ?? null,
  });
  return session;
}

async function sendSmtpMessage(account: NotificationAccountRecord, to: string, subject: string, body: string, replyHeaders?: { inReplyTo?: string | null; references?: string | null }) {
  const config = normalizeEmailConfig(account);
  if (!config.smtpHost || !config.fromEmail) throw new Error("email_smtp_config_required");
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUsername || config.smtpPassword ? { user: config.smtpUsername, pass: config.smtpPassword } : undefined,
  });
  const message = await transporter.sendMail({
    from: config.fromName ? `"${config.fromName.replace(/"/g, "'")}" <${config.fromEmail}>` : config.fromEmail,
    to,
    subject,
    text: body,
    ...(replyHeaders?.inReplyTo ? { inReplyTo: replyHeaders.inReplyTo } : {}),
    ...(replyHeaders?.references ? { references: replyHeaders.references } : {}),
  });
  return message.messageId ?? null;
}

async function sendEmailReply(db: Database.Database, account: NotificationAccountRecord, to: string, subject: string, body: string, thread: EmailRouteRow) {
  const messageId = await sendSmtpMessage(account, to, subject, body, {
    inReplyTo: thread.inbound_message_id ?? thread.last_message_id ?? undefined,
    references: thread.inbound_message_id ?? thread.last_message_id ?? undefined,
  });
  if (messageId) {
    if (thread.session_id) {
      upsertEmailThreadRoute(db, account.id, thread.chat_id ?? to, thread.session_id, {
        subject: thread.subject ?? subject,
        inboundMessageId: thread.inbound_message_id ?? null,
        lastMessageId: messageId,
      });
    }
  }
  return messageId;
}

async function parseInboundEmail(source: Buffer) {
  const parsed = await simpleParser(source);
  const sender = parsed.from?.value?.[0] ?? null;
  const senderEmail = String(sender?.address ?? "").trim().toLowerCase();
  const senderName = String(sender?.name ?? senderEmail).trim() || senderEmail;
  const subject = String(parsed.subject ?? "(no subject)").trim();
  const body = String(parsed.text ?? (parsed.html ? stripHtml(String(parsed.html)) : "") ?? "").trim();
  const attachments = (parsed.attachments ?? []).map((attachment: { filename?: string | null }) => attachment.filename || "attachment").filter(Boolean);
  const messageId = String(parsed.messageId ?? "").trim();
  const headers = parsed.headers as Map<string, string> | undefined;
  const headerValue = (name: string) => String(headers?.get(name.toLowerCase()) ?? headers?.get(name) ?? "").trim();
  const automated = [
    senderEmail.includes("noreply"),
    senderEmail.includes("no-reply"),
    senderEmail.includes("donotreply"),
    senderEmail.includes("mailer-daemon"),
    /bulk|list|junk/i.test(headerValue("precedence")),
    headerValue("auto-submitted") && headerValue("auto-submitted").toLowerCase() !== "no",
    Boolean(headerValue("x-auto-response-suppress")),
    Boolean(headerValue("list-unsubscribe")),
  ].some(Boolean);
  return { senderEmail, senderName, subject, body, attachments, messageId, automated };
}

export function createEmailPlatform(deps: EmailPlatformDeps) {
  const pollingBusy = new Set<string>();
  const seenUids = new Map<string, Set<string>>();
  let inboundTimer: ReturnType<typeof setInterval> | null = null;

  function emailRecipientsForSession(sessionId: string) {
    return getEmailThreadRoutes(deps.db, sessionId).filter((route) => route.chat_id && route.session_id);
  }

  async function sendNotification(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
    const config = normalizeEmailConfig(account);
    const to = target?.emailTo?.length ? target.emailTo : [];
    if (!to.length) throw new Error("email_recipients_required");
    if (!config.smtpHost || !config.fromEmail) throw new Error("email_smtp_config_required");
    await sendSmtpMessage(account, to.join(", "), event.title, `${event.message}\n\n${event.eventType} · ${event.severity}`);
    return { responseStatus: null };
  }

  function forwardAssistantMessageToEmail(session: SessionSummary, message: SessionMessage) {
    if (message.role !== "assistant") return;
    const routes = emailRecipientsForSession(session.id);
    if (!routes.length) return;
    const accounts = new Map(deps.listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "email").map((account) => [account.id, account] as const));
    for (const route of routes) {
      const account = accounts.get(String(route.account_id ?? ""));
      const to = String(route.chat_id ?? "");
      if (!account || !to) continue;
      const body = message.content.trim() || "(empty message)";
      const subject = emailReplySubject(route.subject ?? session.title);
      void sendEmailReply(deps.db, account, to, subject, body, route).catch((error) => {
        console.warn("email reply forward failed", route.account_id, route.chat_id, error instanceof Error ? error.message : error);
      });
    }
  }

  async function handleInboundMessage(account: NotificationAccountRecord, raw: Buffer) {
    const config = normalizeEmailConfig(account);
    if (!config.inboundEnabled) return;
    const parsed = await parseInboundEmail(raw);
    if (!parsed.senderEmail) return;
    if (parsed.senderEmail === config.senderAddress) return;
    if (parsed.automated) return;
    if (config.allowedSenderEmails.length && !config.allowedSenderEmails.includes(parsed.senderEmail)) return;
    const session = routeSenderToSession(deps, account, parsed.senderEmail, parsed.senderName, parsed.subject, parsed.messageId);
    const content = buildEmailBody(account, parsed.senderName, parsed.senderEmail, parsed.subject, parsed.body, parsed.attachments);
    const result = deps.dispatchMessageToSession(session, content || parsed.subject);
    if (result.mode === "queued" && result.queuedId) {
      // no-op: queued sessions still receive assistant replies when they complete
    }
  }

  async function pollEmailAccount(account: NotificationAccountRecord) {
    const config = normalizeEmailConfig(account);
    if (!config.inboundEnabled) return;
    if (!config.imapHost || !config.imapUsername || !config.imapPassword) return;
    if (pollingBusy.has(account.id)) return;
    pollingBusy.add(account.id);
    try {
      const client = new ImapFlow({
        host: config.imapHost,
        port: config.imapPort,
        secure: config.imapSecure,
        auth: { user: config.imapUsername, pass: config.imapPassword },
      });
      await client.connect();
      try {
        const lock = await client.getMailboxLock(config.inboundMailbox);
        try {
          const uids = (await client.search({ seen: false })) || [];
          const processed = seenUids.get(account.id) ?? new Set<string>();
          for (const uid of uids) {
            const uidText = String(uid);
            if (processed.has(uidText)) continue;
            const entries = client.fetch(uid, { uid: true, source: true });
            for await (const entry of entries) {
              const source = Buffer.isBuffer(entry.source) ? entry.source : Buffer.from(entry.source ?? "");
              await handleInboundMessage(account, source);
              processed.add(uidText);
              try {
                await (client as any).messageFlagsAdd?.(uid, ["\\Seen"], { uid: true });
              } catch {
                // best-effort
              }
            }
          }
          seenUids.set(account.id, processed);
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch (error) {
      console.warn("email inbound poll failed", account.id, error instanceof Error ? error.message : error);
    } finally {
      pollingBusy.delete(account.id);
    }
  }

  function pollEmailInboundAccounts() {
    try {
      const accounts = deps.listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "email" && normalizeEmailConfig(account).inboundEnabled);
      for (const account of accounts) void pollEmailAccount(account);
    } catch (error) {
      console.warn("email inbound poll scheduler failed", error instanceof Error ? error.message : error);
    }
  }

  function start() {
    if (inboundTimer) return;
    inboundTimer = setInterval(pollEmailInboundAccounts, 15_000);
    inboundTimer.unref();
  }

  function shutdown() {
    if (inboundTimer) clearInterval(inboundTimer);
    inboundTimer = null;
    pollingBusy.clear();
    seenUids.clear();
  }

  return {
    start,
    shutdown,
    sendNotification,
    forwardAssistantMessageToEmail,
  };
}
