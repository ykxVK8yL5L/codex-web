import type {
  NotificationAccountSummary,
  NotificationChannelDefinition,
  NotificationRecipientSummary,
  NotificationRuleSummary,
  NotificationSettingsResponse,
} from "@codex-web/protocol";
import type { Locale, TranslationKey } from "@/lib/i18n";
import type {
  NotificationAccountForm,
  NotificationChannelForm,
  NotificationRecipientForm,
  NotificationRuleForm,
  NotificationTestSettingsForm,
} from "./types";

type TFunction = (key: TranslationKey) => string;
type NotificationPermissionForm = {
  permissionAgentIds: string;
  permissionRoomIds: string;
  permissionProjectIds: string;
};
type NotificationPermissionPolicy = {
  allowedAgentIds?: string[];
  allowedRoomIds?: string[];
  allowedProjectIds?: string[];
};

export function notificationKindLabel(t: TFunction, kind: NotificationAccountSummary["channelKind"] | NotificationRecipientSummary["kind"]) {
  if (kind === "email") return t("settings.notificationKindEmail");
  if (kind === "telegram") return t("settings.notificationKindTelegram");
  if (kind === "weixin") return t("settings.notificationKindWeixin");
  if (kind === "wecom") return t("settings.notificationKindWeCom");
  if (kind === "dingtalk") return t("settings.notificationKindDingTalk");
  if (kind === "feishu") return t("settings.notificationKindFeishu");
  if (kind === "qq") return t("settings.notificationKindQQ");
  if (kind === "bark") return t("settings.notificationKindBark");
  return t("settings.notificationKindWebhook");
}

export function csvIds(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function configListToCsv(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean).join(", ");
}

export function notificationFieldLabel(t: TFunction, field: string) {
  if (field === "url") return t("settings.notificationWebhookUrl");
  if (field === "serverUrl") return t("settings.notificationBarkServer");
  if (field === "deviceKey") return t("settings.notificationBarkDeviceKey");
  if (field === "group") return t("settings.notificationBarkGroup");
  if (field === "sound") return t("settings.notificationBarkSound");
  if (field === "icon") return t("settings.notificationBarkIcon");
  if (field === "botToken") return t("settings.notificationTelegramBotToken");
  if (field === "baseUrl") return t("settings.notificationWeixinBaseUrl");
  if (field === "botId") return t("settings.notificationWeComBotId");
  if (field === "secret") return t("settings.notificationWeComSecret");
  if (field === "websocketUrl") return t("settings.notificationWeComWebsocketUrl");
  if (field === "dmPolicy") return t("settings.notificationWeComDmPolicy");
  if (field === "allowFrom") return t("settings.notificationWeComAllowFrom");
  if (field === "groupPolicy") return t("settings.notificationWeComGroupPolicy");
  if (field === "groupAllowFrom") return t("settings.notificationWeComGroupAllowFrom");
  if (field === "appId") return t("settings.notificationQQAppId");
  if (field === "clientSecret") return t("settings.notificationQQClientSecret");
  if (field === "targetType") return t("settings.notificationQQTargetType");
  if (field === "targetId") return t("settings.notificationQQTargetId");
  if (field === "botSecret") return t("settings.notificationDingtalkBotSecret");
  return field;
}

export function notificationPermissionsFromForm(form: NotificationPermissionForm) {
  return {
    allowedAgentIds: csvIds(form.permissionAgentIds),
    allowedRoomIds: csvIds(form.permissionRoomIds),
    allowedProjectIds: csvIds(form.permissionProjectIds),
  };
}

export function notificationPermissionsToForm(permissions?: NotificationPermissionPolicy) {
  return {
    permissionAgentIds: (permissions?.allowedAgentIds ?? []).join(", "),
    permissionRoomIds: (permissions?.allowedRoomIds ?? []).join(", "),
    permissionProjectIds: (permissions?.allowedProjectIds ?? []).join(", "),
  };
}

export function notificationPermissionSummary(t: TFunction, permissions?: NotificationPermissionPolicy) {
  const count = (permissions?.allowedAgentIds?.length ?? 0) + (permissions?.allowedRoomIds?.length ?? 0) + (permissions?.allowedProjectIds?.length ?? 0);
  return count ? t("settings.notificationPermissionRestricted") : t("settings.notificationPermissionUnrestricted");
}

export function notificationAccountKind(account: NotificationAccountSummary, channels?: NotificationChannelDefinition[]) {
  return channels?.find((channel) => channel.id === account.channelId)?.kind ?? account.channelKind;
}

export function notificationAccountFormFromAccount(
  account: NotificationAccountSummary,
  channels: NotificationChannelDefinition[] | undefined,
): NotificationAccountForm {
  const config = account.config as Record<string, unknown>;
  const channelKind = notificationAccountKind(account, channels);
  return {
    name: account.name,
    channelId: account.channelId ?? (channelKind === "feishu" ? "feishu-bot" : channelKind === "wecom" ? "wecom-bot" : channelKind === "qq" ? "qq-bot" : channelKind),
    channelKind,
    language: String(config.language ?? "") === "en-US" ? "en-US" : "zh-CN",
    enabled: account.enabled,
    customConfig: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value ?? "")])),
    webhookUrl: String(config.url ?? ""),
    webhookMethod: String(config.method ?? "POST"),
    webhookHeaders: config.headers && typeof config.headers === "object"
      ? Object.entries(config.headers as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value ?? "")}`).join("\n")
      : "",
    webhookBodyTemplate: String(config.bodyTemplate ?? ""),
    barkServerUrl: String(config.serverUrl ?? "https://api.day.app"),
    barkDeviceKey: String(config.deviceKey ?? ""),
    barkGroup: String(config.group ?? "Codex Web"),
    barkSound: String(config.sound ?? ""),
    barkIcon: String(config.icon ?? ""),
    barkUrl: String(config.url ?? ""),
    emailHost: String(config.host ?? ""),
    emailPort: String(config.port ?? "587"),
    emailSecure: config.secure === true,
    emailUsername: String(config.username ?? ""),
    emailPassword: String(config.password ?? ""),
    emailFromName: String(config.fromName ?? "Codex Web"),
    emailFromEmail: String(config.fromEmail ?? ""),
    emailCreateRecipient: true,
    emailInboundEnabled: config.inboundEnabled === true,
    emailImapHost: String(config.imapHost ?? config.host ?? ""),
    emailImapPort: String(config.imapPort ?? "993"),
    emailImapSecure: config.imapSecure === true,
    emailImapUsername: String(config.imapUsername ?? config.username ?? ""),
    emailImapPassword: String(config.imapPassword ?? config.password ?? ""),
    emailInboundMailbox: String(config.inboundMailbox ?? "INBOX"),
    emailAllowedSenderEmails: configListToCsv(config.allowedSenderEmails),
    emailDefaultSessionId: String(config.defaultSessionId ?? ""),
    testEmailTo: configListToCsv(config.testEmailTo),
    telegramBotToken: String(config.botToken ?? ""),
    telegramProxyUrl: String(config.proxyUrl ?? ""),
    telegramTestChatId: String(config.testChatId ?? ""),
    telegramCreateRecipient: true,
    telegramInboundEnabled: config.inboundEnabled === true,
    telegramAllowedChatIds: configListToCsv(config.allowedChatIds),
    telegramAllowedUserIds: configListToCsv(config.allowedUserIds),
    telegramDefaultSessionId: String(config.defaultSessionId ?? ""),
    weixinBotToken: String(config.botToken ?? ""),
    weixinBaseUrl: String(config.baseUrl ?? "https://ilinkai.weixin.qq.com"),
    weixinAccountId: String(config.accountId ?? ""),
    weixinUserId: String(config.userId ?? ""),
    weixinTestChatId: String(config.testChatId ?? ""),
    weixinCreateRecipient: true,
    weixinInboundEnabled: config.inboundEnabled === true,
    weixinAllowedChatIds: configListToCsv(config.allowedChatIds),
    weixinAllowedUserIds: configListToCsv(config.allowedUserIds),
    weixinDefaultSessionId: String(config.defaultSessionId ?? ""),
    wecomBotId: String(config.botId ?? ""),
    wecomSecret: String(config.secret ?? config.botSecret ?? ""),
    wecomWebsocketUrl: String(config.websocketUrl ?? config.websocket_url ?? "wss://openws.work.weixin.qq.com"),
    wecomDmPolicy: String(config.dmPolicy ?? "open"),
    wecomAllowFrom: configListToCsv(config.allowFrom ?? config.allow_from),
    wecomGroupPolicy: String(config.groupPolicy ?? "open"),
    wecomGroupAllowFrom: configListToCsv(config.groupAllowFrom ?? config.group_allow_from),
    wecomCreateRecipient: true,
    wecomInboundEnabled: config.inboundEnabled === true,
    wecomDefaultSessionId: String(config.defaultSessionId ?? ""),
    wecomTestChatId: String(config.testChatId ?? ""),
    qqAppId: String(config.appId ?? ""),
    qqClientSecret: String(config.clientSecret ?? config.appSecret ?? ""),
    qqTargetType: String(config.targetType ?? "user"),
    qqTargetId: String(config.targetId ?? config.openId ?? ""),
    qqTestTargetId: String(config.testTargetId ?? config.testChatId ?? config.targetId ?? config.openId ?? ""),
    qqCreateRecipient: true,
    qqInboundEnabled: config.inboundEnabled === true,
    qqAllowedChatIds: configListToCsv(config.allowedChatIds),
    qqAllowedUserIds: configListToCsv(config.allowedUserIds),
    qqDefaultSessionId: String(config.defaultSessionId ?? ""),
    qqTestChatId: String(config.testChatId ?? ""),
    dingtalkBotToken: String(config.botToken ?? config.accessToken ?? ""),
    dingtalkBotSecret: String(config.botSecret ?? config.secret ?? ""),
    dingtalkBaseUrl: String(config.baseUrl ?? "https://oapi.dingtalk.com/robot/send"),
    dingtalkCreateRecipient: true,
    feishuAppId: String(config.appId ?? ""),
    feishuAppSecret: String(config.appSecret ?? ""),
    feishuDomain: String(config.domain ?? "feishu"),
    feishuInboundEnabled: config.inboundEnabled === true,
    feishuTestChatId: String(config.testChatId ?? ""),
    feishuCreateRecipient: true,
    ...notificationPermissionsToForm(account.permissions),
  };
}

export function notificationRecipientFormFromRecipient(
  recipient: NotificationRecipientSummary,
  accounts: NotificationAccountSummary[],
): NotificationRecipientForm {
  const config = recipient.config as Record<string, unknown>;
  const senderAccountId = notificationSenderAccountsForKind(accounts, recipient.kind).some((account) => account.id === recipient.senderAccountId)
    ? recipient.senderAccountId ?? ""
    : "";
  return {
    name: recipient.name,
    kind: recipient.kind,
    enabled: recipient.enabled,
    senderAccountId,
    channelId: recipient.channelId ?? "webhook",
    email: String(config.email ?? ""),
    webhookUrl: String(config.url ?? ""),
    barkServerUrl: String(config.serverUrl ?? "https://api.day.app"),
    barkDeviceKey: String(config.deviceKey ?? ""),
    barkGroup: String(config.group ?? "Codex Web"),
    telegramChatId: String(config.chatId ?? ""),
    telegramSenderAccountId: senderAccountId,
    weixinChatId: String(config.chatId ?? ""),
    weixinSenderAccountId: senderAccountId,
    dingtalkSenderAccountId: senderAccountId,
    feishuChatId: String(config.chatId ?? ""),
    feishuSenderAccountId: senderAccountId,
    wecomChatId: String(config.chatId ?? ""),
    wecomSenderAccountId: senderAccountId,
    qqChatId: String(config.chatId ?? ""),
    qqSenderAccountId: senderAccountId,
    customConfig: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value ?? "")])),
    ...notificationPermissionsToForm(recipient.permissions),
  };
}

export function notificationRuleFormFromRule(rule: NotificationRuleSummary, recipients: NotificationRecipientSummary[]) {
  const targetRecipientIds = rule.targets.map((target) => target.recipientId).filter(Boolean) as string[];
  const emailSenderAccountId = rule.targets.find((target) => {
    const recipient = recipients.find((item) => item.id === target.recipientId);
    return recipient?.kind === "email" && target.senderAccountId;
  })?.senderAccountId ?? "";
  const telegramSenderAccountId = rule.targets.find((target) => {
    const recipient = recipients.find((item) => item.id === target.recipientId);
    return recipient?.kind === "telegram" && target.senderAccountId;
  })?.senderAccountId ?? "";
  return {
    name: rule.name,
    enabled: rule.enabled,
    eventTypes: rule.eventTypes,
    minSeverity: rule.minSeverity,
    recipientIds: targetRecipientIds,
    senderAccountId: emailSenderAccountId,
    telegramSenderAccountId,
    emailTo: "",
    dedupeMinutes: String(rule.dedupeMinutes),
  };
}

export function selectedNotificationChannel(form: NotificationAccountForm, channels?: NotificationSettingsResponse["channels"]) {
  return channels?.find((channel) => channel.id === form.channelId)
    ?? channels?.find((channel) => channel.kind === form.channelKind)
    ?? null;
}

export function notificationSenderAccountsForKind(accounts: NotificationAccountSummary[], kind: NotificationAccountSummary["channelKind"]) {
  return accounts.filter((account) => account.enabled && account.channelKind === kind);
}

export function notificationDefaultRecipientSenderId(accounts: NotificationAccountSummary[], kind: NotificationRecipientSummary["kind"], senderAccountId?: string | null) {
  if (senderAccountId && notificationSenderAccountsForKind(accounts, kind).some((account) => account.id === senderAccountId)) return senderAccountId;
  const senders = notificationSenderAccountsForKind(accounts, kind);
  return senders[0]?.id ?? "";
}

export function buildNotificationAccountConfig(form: NotificationAccountForm, selectedChannel: NotificationChannelDefinition | null) {
  if (selectedChannel && selectedChannel.builtin === false) return form.customConfig;
  if (form.channelKind === "email") {
    return {
      host: form.emailHost,
      port: Number(form.emailPort) || 587,
      secure: form.emailSecure,
      username: form.emailUsername,
      password: form.emailPassword,
      fromName: form.emailFromName,
      fromEmail: form.emailFromEmail,
      inboundEnabled: form.emailInboundEnabled,
      imapHost: form.emailImapHost,
      imapPort: Number(form.emailImapPort) || 993,
      imapSecure: form.emailImapSecure,
      imapUsername: form.emailImapUsername,
      imapPassword: form.emailImapPassword,
      inboundMailbox: form.emailInboundMailbox,
      allowedSenderEmails: csvIds(form.emailAllowedSenderEmails),
      defaultSessionId: form.emailDefaultSessionId,
      testEmailTo: csvIds(form.testEmailTo),
    };
  }
  if (form.channelKind === "telegram") {
    return {
      botToken: form.telegramBotToken,
      proxyUrl: form.telegramProxyUrl,
      language: form.language,
      inboundEnabled: form.telegramInboundEnabled,
      allowedChatIds: csvIds(form.telegramAllowedChatIds),
      allowedUserIds: csvIds(form.telegramAllowedUserIds),
      defaultSessionId: form.telegramDefaultSessionId,
      testChatId: form.telegramTestChatId,
    };
  }
  if (form.channelKind === "weixin") {
    return {
      botToken: form.weixinBotToken,
      baseUrl: form.weixinBaseUrl,
      accountId: form.weixinAccountId,
      userId: form.weixinUserId,
      language: form.language,
      inboundEnabled: form.weixinInboundEnabled,
      allowedChatIds: csvIds(form.weixinAllowedChatIds),
      allowedUserIds: csvIds(form.weixinAllowedUserIds),
      defaultSessionId: form.weixinDefaultSessionId,
      testChatId: form.weixinTestChatId,
    };
  }
  if (form.channelKind === "wecom") {
    return {
      botId: form.wecomBotId,
      secret: form.wecomSecret,
      websocketUrl: form.wecomWebsocketUrl,
      dmPolicy: form.wecomDmPolicy,
      allowFrom: csvIds(form.wecomAllowFrom),
      groupPolicy: form.wecomGroupPolicy,
      groupAllowFrom: csvIds(form.wecomGroupAllowFrom),
      inboundEnabled: form.wecomInboundEnabled,
      defaultSessionId: form.wecomDefaultSessionId,
      testChatId: form.wecomTestChatId,
      language: form.language,
    };
  }
  if (form.channelKind === "qq") {
    return {
      appId: form.qqAppId,
      clientSecret: form.qqClientSecret,
      targetType: form.qqTargetType,
      targetId: form.qqTargetId,
      testTargetId: form.qqTestTargetId,
      language: form.language,
      inboundEnabled: form.qqInboundEnabled,
      allowedChatIds: csvIds(form.qqAllowedChatIds),
      allowedUserIds: csvIds(form.qqAllowedUserIds),
      defaultSessionId: form.qqDefaultSessionId,
      testChatId: form.qqTestChatId,
    };
  }
  if (form.channelKind === "dingtalk") {
    return {
      botToken: form.dingtalkBotToken,
      botSecret: form.dingtalkBotSecret,
      baseUrl: form.dingtalkBaseUrl,
      language: form.language,
    };
  }
  if (form.channelKind === "feishu") {
    return {
      appId: form.feishuAppId,
      appSecret: form.feishuAppSecret,
      domain: form.feishuDomain,
      inboundEnabled: form.feishuInboundEnabled,
      testChatId: form.feishuTestChatId,
      language: form.language,
    };
  }
  if (form.channelKind === "webhook") {
    const headers: Record<string, string> = {};
    for (const line of form.webhookHeaders.split("\n")) {
      const index = line.indexOf(":");
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) headers[key] = value;
    }
    return {
      url: form.webhookUrl,
      method: form.webhookMethod,
      headers,
      bodyTemplate: form.webhookBodyTemplate,
    };
  }
  return {
    serverUrl: form.barkServerUrl,
    deviceKey: form.barkDeviceKey,
    group: form.barkGroup,
    sound: form.barkSound,
    icon: form.barkIcon,
    url: form.barkUrl,
  };
}

export function buildNotificationRecipientConfig(form: NotificationRecipientForm, channels?: NotificationSettingsResponse["channels"]) {
  if (form.kind === "email") return { email: form.email };
  if (form.kind === "telegram") return { chatId: form.telegramChatId };
  if (form.kind === "weixin") return { chatId: form.weixinChatId };
  if (form.kind === "dingtalk") return {};
  if (form.kind === "feishu") return { chatId: form.feishuChatId };
  if (form.kind === "wecom") return { chatId: form.wecomChatId };
  if (form.kind === "qq") return { chatId: form.qqChatId };
  const channel = channels?.find((item) => item.id === form.channelId);
  if (channel?.id && channel.id !== "webhook") return form.customConfig;
  return { url: form.webhookUrl, method: "POST", headers: {} };
}

export function notificationAccountTestTarget(form: NotificationAccountForm, account: NotificationAccountSummary) {
  const accountConfig = account.config && typeof account.config === "object" ? account.config as Record<string, unknown> : {};
  const chatId = account.channelKind === "weixin"
    ? form.weixinTestChatId.trim() || String(accountConfig.testChatId ?? accountConfig.userId ?? accountConfig.accountId ?? "").trim()
    : account.channelKind === "wecom"
      ? form.wecomTestChatId.trim() || String(accountConfig.testChatId ?? "").trim()
      : account.channelKind === "feishu"
        ? form.feishuTestChatId.trim() || String(accountConfig.testChatId ?? "").trim()
        : account.channelKind === "qq"
          ? form.qqTestChatId.trim() || form.qqTestTargetId.trim() || String(accountConfig.testChatId ?? accountConfig.testTargetId ?? accountConfig.targetId ?? accountConfig.openId ?? "").trim()
          : form.telegramTestChatId.trim() || String(accountConfig.testChatId ?? "").trim();
  return {
    emailTo: form.testEmailTo.split(",").map((item: string) => item.trim()).filter(Boolean),
    chatId,
  };
}

export function createNotificationTestSettingsForm(): NotificationTestSettingsForm {
  return {
    titleZh: "Codex Web 测试通知",
    titleEn: "Codex Web test notification",
    messageZh: "这是一条来自 Codex Web 的测试通知。",
    messageEn: "This is a test notification from Codex Web.",
    includeHelp: true,
  };
}

export function createNotificationAccountForm(locale: Locale): NotificationAccountForm {
  return {
    name: "",
    channelId: "email",
    channelKind: "email",
    language: locale,
    enabled: true,
    customConfig: {},
    webhookUrl: "",
    webhookMethod: "POST",
    webhookHeaders: "",
    webhookBodyTemplate: "",
    barkServerUrl: "https://api.day.app",
    barkDeviceKey: "",
    barkGroup: "Codex Web",
    barkSound: "",
    barkIcon: "",
    barkUrl: "",
    emailHost: "",
    emailPort: "587",
    emailSecure: false,
    emailUsername: "",
    emailPassword: "",
    emailFromName: "Codex Web",
    emailFromEmail: "",
    emailCreateRecipient: true,
    emailInboundEnabled: false,
    emailImapHost: "",
    emailImapPort: "993",
    emailImapSecure: true,
    emailImapUsername: "",
    emailImapPassword: "",
    emailInboundMailbox: "INBOX",
    emailAllowedSenderEmails: "",
    emailDefaultSessionId: "",
    telegramBotToken: "",
    telegramProxyUrl: "",
    telegramTestChatId: "",
    telegramCreateRecipient: true,
    telegramInboundEnabled: false,
    telegramAllowedChatIds: "",
    telegramAllowedUserIds: "",
    telegramDefaultSessionId: "",
    weixinBotToken: "",
    weixinBaseUrl: "https://ilinkai.weixin.qq.com",
    weixinAccountId: "",
    weixinUserId: "",
    weixinTestChatId: "",
    weixinCreateRecipient: true,
    weixinInboundEnabled: false,
    weixinAllowedChatIds: "",
    weixinAllowedUserIds: "",
    weixinDefaultSessionId: "",
    wecomBotId: "",
    wecomSecret: "",
    wecomWebsocketUrl: "wss://openws.work.weixin.qq.com",
    wecomDmPolicy: "open",
    wecomAllowFrom: "",
    wecomGroupPolicy: "open",
    wecomGroupAllowFrom: "",
    wecomCreateRecipient: true,
    wecomInboundEnabled: true,
    wecomDefaultSessionId: "",
    wecomTestChatId: "",
    qqAppId: "",
    qqClientSecret: "",
    qqTargetType: "user",
    qqTargetId: "",
    qqTestTargetId: "",
    qqCreateRecipient: true,
    qqInboundEnabled: false,
    qqAllowedChatIds: "",
    qqAllowedUserIds: "",
    qqDefaultSessionId: "",
    qqTestChatId: "",
    dingtalkBotToken: "",
    dingtalkBotSecret: "",
    dingtalkBaseUrl: "https://oapi.dingtalk.com/robot/send",
    dingtalkCreateRecipient: true,
    feishuAppId: "",
    feishuAppSecret: "",
    feishuDomain: "feishu",
    feishuInboundEnabled: false,
    feishuTestChatId: "",
    feishuCreateRecipient: true,
    testEmailTo: "",
    permissionAgentIds: "",
    permissionRoomIds: "",
    permissionProjectIds: "",
  };
}

export function createNotificationRuleForm(): NotificationRuleForm {
  return {
    name: "",
    enabled: true,
    eventTypes: ["task_completed", "task_failed", "needs_approval"],
    minSeverity: "info",
    recipientIds: [],
    senderAccountId: "",
    telegramSenderAccountId: "",
    emailTo: "",
    dedupeMinutes: "5",
  };
}

export function createNotificationRecipientForm(): NotificationRecipientForm {
  return {
    name: "",
    kind: "email",
    enabled: true,
    senderAccountId: "",
    channelId: "webhook",
    email: "",
    webhookUrl: "",
    barkServerUrl: "https://api.day.app",
    barkDeviceKey: "",
    barkGroup: "Codex Web",
    telegramChatId: "",
    telegramSenderAccountId: "",
    weixinChatId: "",
    weixinSenderAccountId: "",
    dingtalkSenderAccountId: "",
    feishuChatId: "",
    feishuSenderAccountId: "",
    wecomChatId: "",
    wecomSenderAccountId: "",
    qqChatId: "",
    qqSenderAccountId: "",
    customConfig: {},
    permissionAgentIds: "",
    permissionRoomIds: "",
    permissionProjectIds: "",
  };
}

export function createNotificationChannelForm(): NotificationChannelForm {
  return {
    name: "",
    description: "",
    adapter: "webhook",
    authType: "none",
    method: "POST",
    urlTemplate: "",
    headersTemplate: "",
    bodyTemplate: "{\n  \"title\": \"{{title}}\",\n  \"message\": \"{{message}}\"\n}",
    accountFields: "",
  };
}
