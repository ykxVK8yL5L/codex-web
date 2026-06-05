import type Database from "better-sqlite3";
import type {
  NotificationAccountSummary,
  PlatformCapability,
  PlatformKind,
  PlatformRouteSummary,
  PlatformSettingsResponse,
  WebhookRouteSummary,
} from "@codex-web/protocol";
import type { SessionSummary } from "@codex-web/protocol";

type PlatformDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  listNotificationAccounts: (exposeSecrets?: boolean) => NotificationAccountSummary[];
  webhookRoutes: WebhookRouteSummary[];
};

export const platformBaselineCapabilities: PlatformCapability[] = [
  "inbound_messages",
  "outbound_messages",
  "session_binding",
  "session_selection",
  "reply_routing",
  "working_status",
  "command_menu",
  "file_browse",
  "terminal",
];

export const platformCapabilityLabels: Record<PlatformCapability, string> = {
  inbound_messages: "Inbound messages",
  outbound_messages: "Outbound messages",
  session_binding: "Session binding",
  session_selection: "Session selection",
  reply_routing: "Reply routing",
  working_status: "Working status",
  command_menu: "Command menu",
  file_browse: "File browsing",
  terminal: "Terminal",
};

export const platformSupportMap: Record<PlatformKind, PlatformCapability[]> = {
  telegram: [...platformBaselineCapabilities],
  email: ["inbound_messages", "outbound_messages", "session_binding", "reply_routing"],
  webhook: ["inbound_messages", "outbound_messages", "session_binding", "reply_routing"],
  bark: ["outbound_messages"],
  weixin: ["inbound_messages", "outbound_messages", "session_binding", "session_selection", "reply_routing", "working_status"],
  wecom: ["inbound_messages", "outbound_messages", "session_binding", "session_selection", "reply_routing", "working_status"],
  dingtalk: ["inbound_messages", "outbound_messages", "session_binding", "reply_routing"],
  feishu: ["inbound_messages", "outbound_messages", "session_binding", "session_selection", "reply_routing", "command_menu"],
  qq: ["inbound_messages", "outbound_messages", "session_binding", "session_selection", "reply_routing", "working_status"],
};

export const platformDescriptions: Record<PlatformKind, string> = {
  telegram: "Full interactive baseline with bind/send/session browsing and live replies.",
  email: "IMAP inbound plus SMTP outbound bridge with sender-to-session routing.",
  webhook: "Inbound webhook routes that can create or reuse Codex sessions.",
  bark: "iOS push delivery through Bark-compatible endpoints.",
  weixin: "Personal Weixin bridge with session binding and reply routing.",
  wecom: "WeCom AI bot bridge with session binding and reply routing.",
  dingtalk: "DingTalk robot bridge with signed webhook delivery.",
  feishu: "Feishu/Lark long-connection bot with session binding and reply routing.",
  qq: "QQ Bot bridge with session binding and reply routing.",
};

export function platformAccountMatchesKind(account: NotificationAccountSummary, kind: PlatformKind) {
  if (kind === "telegram") return account.channelKind === "telegram";
  if (kind === "email") return account.channelKind === "email";
  if (kind === "bark") return account.channelKind === "bark";
  if (kind === "weixin") return account.channelKind === "weixin";
  if (kind === "wecom") return account.channelKind === "wecom";
  if (kind === "dingtalk") return account.channelKind === "dingtalk";
  if (kind === "feishu") return account.channelKind === "feishu";
  if (kind === "qq") return account.channelKind === "qq";
  if (kind === "webhook") return account.channelKind === "webhook";
  return account.channelId === kind;
}

export function platformRouteSummaries({ db, sessions, listNotificationAccounts }: PlatformDeps): PlatformRouteSummary[] {
  const accounts = new Map(listNotificationAccounts(true).filter((account) => ["telegram", "weixin", "wecom", "email", "feishu", "qq"].includes(account.channelKind)).map((account) => [account.id, account] as const));
  const routeTables: Array<{ kind: PlatformKind; table: string }> = [
    { kind: "telegram", table: "telegram_chat_routes" },
    { kind: "weixin", table: "weixin_chat_routes" },
    { kind: "wecom", table: "wecom_chat_routes" },
    { kind: "email", table: "email_chat_routes" },
    { kind: "feishu", table: "feishu_chat_routes" },
    { kind: "qq", table: "qq_chat_routes" },
  ];
  return routeTables.flatMap(({ kind, table }) => (db.prepare(`select * from ${table} order by updated_at desc, chat_id asc`).all() as Array<Record<string, unknown>>).map((row) => {
    const sessionId = String(row.session_id ?? "");
    const session = sessions.find((item) => item.id === sessionId) ?? null;
    return {
      id: `${kind}:${String(row.account_id ?? "")}:${String(row.chat_id ?? "")}`,
      kind,
      accountId: String(row.account_id ?? ""),
      chatId: String(row.chat_id ?? ""),
      sessionId,
      sessionTitle: session?.title ?? sessionId,
      sessionConversationType: session?.conversationType ?? null,
      updatedAt: String(row.updated_at ?? ""),
    };
  })).filter((route) => route.accountId && route.chatId && route.sessionId && accounts.has(route.accountId));
}

export function platformOverview(deps: PlatformDeps): PlatformSettingsResponse {
  const accounts = deps.listNotificationAccounts(true);
  const routes = platformRouteSummaries(deps);
  const webhookRoutes = deps.webhookRoutes.slice();
  const platforms = ([
    "telegram",
    "email",
    "webhook",
    "bark",
    "weixin",
    "wecom",
    "dingtalk",
    "feishu",
    "qq",
  ] as PlatformKind[]).map((kind) => {
    const matchedAccounts = accounts.filter((account) => platformAccountMatchesKind(account, kind));
    const routeEnabled = kind === "webhook" ? webhookRoutes.some((route) => route.enabled) : matchedAccounts.some((account) => account.enabled);
    return {
      id: kind,
      kind,
      label: kind === "weixin" ? "Weixin Bot"
        : kind === "dingtalk" ? "DingTalk Bot"
        : kind === "wecom" ? "WeCom AI Bot"
          : kind === "feishu" ? "Feishu / Lark Bot"
            : kind === "qq" ? "QQ Bot"
              : kind === "bark" ? "Bark"
                : kind === "email" ? "Email SMTP"
                  : kind === "webhook" ? "Webhook"
                    : "Telegram Bot",
      description: platformDescriptions[kind],
      enabled: routeEnabled,
      builtin: true,
      channelId: kind,
      accountCount: matchedAccounts.length,
      connectedRouteCount: kind === "webhook"
        ? webhookRoutes.length
        : kind === "telegram" || kind === "weixin" || kind === "wecom" || kind === "dingtalk" || kind === "feishu" || kind === "qq"
          ? routes.filter((route) => route.kind === kind).length
          : 0,
      baselineCapabilities: platformBaselineCapabilities,
      supportedCapabilities: platformSupportMap[kind],
      notes: kind === "telegram"
        ? "This is the reference platform. All other platforms are compared against this contract."
        : kind === "weixin"
          ? "Personal Weixin bridge with session binding and reply routing."
          : kind === "wecom"
          ? "WeCom AI Bot bridge with session binding and reply routing."
          : kind === "qq"
          ? "QQ Bot bridge with session binding and reply routing."
          : kind === "dingtalk"
          ? "DingTalk robot sender with signed delivery."
          : kind === "feishu"
            ? "Feishu long-connection bot with inbound reply routing."
          : kind === "email"
            ? "IMAP inbound polling plus SMTP outbound replies with per-sender routing."
          : kind === "webhook"
            ? "Each route accepts HTTP POSTs, validates a shared secret, and forwards the payload into a Codex session."
            : "Outbound-only notification bridge.",
    };
  });
  return { baselineCapabilities: platformBaselineCapabilities, capabilityLabels: platformCapabilityLabels, platforms, routes, webhookRoutes };
}
