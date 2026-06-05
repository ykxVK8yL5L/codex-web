import { createHmac } from "node:crypto";
import type { NotificationAccountSummary, NotificationEventType, NotificationSeverity } from "@codex-web/protocol";

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

function notificationLanguage(account: NotificationAccountRecord) {
  return String((account.config as Record<string, unknown>).language ?? "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function localizedText(account: NotificationAccountRecord, zh: string, en: string) {
  return notificationLanguage(account) === "en-US" ? en : zh;
}

function dingtalkHelpText(account: NotificationAccountRecord) {
  return [
    localizedText(account, "Codex Web 钉钉机器人", "Codex Web DingTalk Bot"),
    "",
    localizedText(account, "这是一个钉钉机器人发送者。", "This is a DingTalk bot sender."),
    localizedText(account, "测试发送会把通知消息推送到钉钉机器人。", "Test sends push the notification to the DingTalk robot."),
  ].join("\n");
}

function normalizeBaseUrl(value: unknown) {
  const url = String(value ?? "https://oapi.dingtalk.com/robot/send").trim();
  return url || "https://oapi.dingtalk.com/robot/send";
}

function signWebhookUrl(baseUrl: string, token: string, secret: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("access_token", token);
  if (secret.trim()) {
    const timestamp = Date.now().toString();
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = createHmac("sha256", secret).update(stringToSign).digest("base64");
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("sign", sign);
  }
  return url;
}

export function createDingtalkPlatform() {
  async function sendNotification(account: NotificationAccountRecord, event: NotificationEventInput) {
    const config = account.config as Record<string, unknown>;
    const token = String(config.botToken ?? config.accessToken ?? config.token ?? "").trim();
    if (!token) throw new Error("dingtalk_bot_token_required");
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const secret = String(config.botSecret ?? config.secret ?? "").trim();
    const url = signWebhookUrl(baseUrl, token, secret);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: {
          content: `${event.title}\n\n${event.message}`,
        },
      }),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(text.slice(0, 500) || `dingtalk_http_${response.status}`);
    return { responseStatus: response.status };
  }

  return {
    dingtalkHelpText,
    sendNotification,
  };
}
