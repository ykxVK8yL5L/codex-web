import type {
  NotificationChannelAdapter,
  NotificationChannelDefinition,
  NotificationChannelKind,
} from "@codex-web/protocol";

function builtinWebhookChannel(
  id: string,
  name: string,
  description: string,
  bodyTemplate: string,
  accountFields: string[] = ["url"],
): NotificationChannelDefinition {
  return {
    id,
    kind: "webhook",
    adapter: "webhook",
    authType: "none",
    name,
    description,
    builtin: true,
    method: "POST",
    urlTemplate: "{{url}}",
    bodyTemplate,
    accountFields,
  };
}

function builtinNotificationChannel(
  id: string,
  kind: NotificationChannelKind,
  adapter: NotificationChannelAdapter,
  name: string,
  description: string,
  accountFields: string[],
): NotificationChannelDefinition {
  return {
    id,
    kind,
    adapter,
    authType: "none",
    name,
    description,
    builtin: true,
    accountFields,
  };
}

export const notificationChannels: NotificationChannelDefinition[] = [
  builtinWebhookChannel(
    "webhook",
    "Webhook",
    "Send a JSON or templated HTTP request.",
    JSON.stringify({
      title: "{{title}}",
      message: "{{message}}",
      severity: "{{severity}}",
      eventType: "{{eventType}}",
      sourceType: "{{sourceType}}",
      sourceId: "{{sourceId}}",
    }),
  ),
  {
    id: "bark",
    kind: "webhook",
    adapter: "webhook",
    authType: "none",
    name: "Bark",
    description: "Send iOS push notifications through a Bark-compatible webhook endpoint.",
    builtin: true,
    method: "POST",
    urlTemplate: "{{serverUrl}}/push",
    bodyTemplate: JSON.stringify({
      device_key: "{{deviceKey}}",
      title: "{{title}}",
      body: "{{message}}",
      group: "{{group}}",
      sound: "{{sound}}",
      icon: "{{icon}}",
      url: "{{url}}",
    }),
    accountFields: ["serverUrl", "deviceKey", "group", "sound", "icon", "url"],
  },
  builtinWebhookChannel(
    "weixin-webhook",
    "Weixin Bot",
    "Send notifications to a Weixin-compatible webhook bridge.",
    JSON.stringify({
      msgtype: "text",
      text: {
        content: "{{title}}\n\n{{message}}",
      },
    }),
  ),
  builtinWebhookChannel(
    "wecom",
    "WeCom AI Bot",
    "Send notifications to a WeCom AI Bot webhook.",
    JSON.stringify({
      msgtype: "text",
      text: {
        content: "{{title}}\n\n{{message}}",
      },
    }),
  ),
  builtinWebhookChannel(
    "feishu",
    "Feishu / Lark Bot",
    "Send notifications to a Feishu or Lark bot webhook.",
    JSON.stringify({
      msg_type: "text",
      content: {
        text: "{{title}}\n\n{{message}}",
      },
    }),
  ),
  builtinNotificationChannel("wecom-bot", "wecom", "wecom", "WeCom AI Bot", "Send WeCom AI Bot messages through an AI Bot gateway.", ["botId", "secret", "websocketUrl", "dmPolicy", "allowFrom", "groupPolicy", "groupAllowFrom", "defaultSessionId", "testChatId", "language"]),
  builtinNotificationChannel("qq-bot", "qq", "qq", "QQ Bot", "Send QQ Bot notifications through an app ID, client secret, and target ID.", ["appId", "clientSecret", "targetType", "targetId"]),
  { id: "email", kind: "email", adapter: "email", authType: "none", name: "Email SMTP", description: "Send email through an SMTP sender account.", builtin: true, accountFields: ["host", "port", "username", "password", "fromEmail"] },
  { id: "telegram", kind: "telegram", adapter: "telegram", authType: "none", name: "Telegram Bot", description: "Send Telegram messages through a bot token.", builtin: true, accountFields: ["botToken", "proxyUrl"] },
  { id: "weixin", kind: "weixin", adapter: "weixin", authType: "none", name: "Weixin Bot", description: "Send personal Weixin messages through iLink Bot.", builtin: true, accountFields: ["botToken", "baseUrl"] },
  builtinNotificationChannel("dingtalk", "dingtalk", "dingtalk", "DingTalk Bot", "Send DingTalk robot messages through a bot token and secret.", ["botToken", "botSecret", "baseUrl"]),
  builtinNotificationChannel("feishu-bot", "feishu", "feishu", "Feishu Bot", "Send Feishu messages through an app ID and app secret.", ["appId", "appSecret", "domain", "testChatId"]),
];

