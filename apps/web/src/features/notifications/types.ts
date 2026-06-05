import type {
  NotificationAccountSummary,
  NotificationEventType,
  NotificationRecipientSummary,
  NotificationSeverity,
} from "@codex-web/protocol";
import type { Locale } from "@/lib/i18n";

export type NotificationAccountForm = {
  name: string;
  channelId: string;
  channelKind: NotificationAccountSummary["channelKind"];
  language: Locale;
  enabled: boolean;
  customConfig: Record<string, string>;
  webhookUrl: string;
  webhookMethod: string;
  webhookHeaders: string;
  webhookBodyTemplate: string;
  barkServerUrl: string;
  barkDeviceKey: string;
  barkGroup: string;
  barkSound: string;
  barkIcon: string;
  barkUrl: string;
  emailHost: string;
  emailPort: string;
  emailSecure: boolean;
  emailUsername: string;
  emailPassword: string;
  emailFromName: string;
  emailFromEmail: string;
  emailCreateRecipient: boolean;
  emailInboundEnabled: boolean;
  emailImapHost: string;
  emailImapPort: string;
  emailImapSecure: boolean;
  emailImapUsername: string;
  emailImapPassword: string;
  emailInboundMailbox: string;
  emailAllowedSenderEmails: string;
  emailDefaultSessionId: string;
  telegramBotToken: string;
  telegramProxyUrl: string;
  telegramTestChatId: string;
  telegramCreateRecipient: boolean;
  telegramInboundEnabled: boolean;
  telegramAllowedChatIds: string;
  telegramAllowedUserIds: string;
  telegramDefaultSessionId: string;
  weixinBotToken: string;
  weixinBaseUrl: string;
  weixinAccountId: string;
  weixinUserId: string;
  weixinTestChatId: string;
  weixinCreateRecipient: boolean;
  weixinInboundEnabled: boolean;
  weixinAllowedChatIds: string;
  weixinAllowedUserIds: string;
  weixinDefaultSessionId: string;
  wecomBotId: string;
  wecomSecret: string;
  wecomWebsocketUrl: string;
  wecomDmPolicy: string;
  wecomAllowFrom: string;
  wecomGroupPolicy: string;
  wecomGroupAllowFrom: string;
  wecomCreateRecipient: boolean;
  wecomInboundEnabled: boolean;
  wecomDefaultSessionId: string;
  wecomTestChatId: string;
  qqAppId: string;
  qqClientSecret: string;
  qqTargetType: string;
  qqTargetId: string;
  qqTestTargetId: string;
  qqCreateRecipient: boolean;
  qqInboundEnabled: boolean;
  qqAllowedChatIds: string;
  qqAllowedUserIds: string;
  qqDefaultSessionId: string;
  qqTestChatId: string;
  dingtalkBotToken: string;
  dingtalkBotSecret: string;
  dingtalkBaseUrl: string;
  dingtalkCreateRecipient: boolean;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: string;
  feishuInboundEnabled: boolean;
  feishuTestChatId: string;
  feishuCreateRecipient: boolean;
  testEmailTo: string;
  permissionAgentIds: string;
  permissionRoomIds: string;
  permissionProjectIds: string;
};

export type NotificationChannelForm = {
  name: string;
  description: string;
  adapter: string;
  authType: string;
  method: string;
  urlTemplate: string;
  headersTemplate: string;
  bodyTemplate: string;
  accountFields: string;
};

export type NotificationCustomTestForm = {
  title: string;
  message: string;
  includeHelp: boolean;
};

export type NotificationTestSettingsForm = {
  titleZh: string;
  titleEn: string;
  messageZh: string;
  messageEn: string;
  includeHelp: boolean;
};

export type NotificationRecipientForm = {
  name: string;
  kind: NotificationRecipientSummary["kind"];
  enabled: boolean;
  senderAccountId: string;
  channelId: string;
  email: string;
  webhookUrl: string;
  barkServerUrl: string;
  barkDeviceKey: string;
  barkGroup: string;
  telegramChatId: string;
  telegramSenderAccountId: string;
  weixinChatId: string;
  weixinSenderAccountId: string;
  dingtalkSenderAccountId: string;
  feishuChatId: string;
  feishuSenderAccountId: string;
  wecomChatId: string;
  wecomSenderAccountId: string;
  qqChatId: string;
  qqSenderAccountId: string;
  customConfig: Record<string, string>;
  permissionAgentIds: string;
  permissionRoomIds: string;
  permissionProjectIds: string;
};

export type NotificationRuleForm = {
  name: string;
  enabled: boolean;
  eventTypes: NotificationEventType[];
  minSeverity: NotificationSeverity;
  recipientIds: string[];
  senderAccountId: string;
  telegramSenderAccountId: string;
  emailTo: string;
  dedupeMinutes: string;
};
