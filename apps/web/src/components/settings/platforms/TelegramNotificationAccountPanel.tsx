import type { Dispatch, SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

type TelegramNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  telegramBotToken: string;
  telegramProxyUrl: string;
  telegramTestChatId: string;
  telegramInboundEnabled: boolean;
  telegramAllowedChatIds: string;
  telegramAllowedUserIds: string;
  telegramDefaultSessionId: string;
};

type Props = {
  form: TelegramNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
};

export function TelegramNotificationAccountPanel({ form, setForm, t }: Props) {
  return (
    <>
      <label>
        <span>{t("settings.notificationTelegramBotToken")}</span>
        <input name="notification-telegram-bot-token" className="search-input" type="password" value={form.telegramBotToken} onChange={(event) => setForm((current: any) => ({ ...current, telegramBotToken: event.target.value }))} />
      </label>
      <label>
        <span>{t("settings.notificationTelegramProxyUrl")}</span>
        <input name="notification-telegram-proxy-url" className="search-input" value={form.telegramProxyUrl} onChange={(event) => setForm((current: any) => ({ ...current, telegramProxyUrl: event.target.value }))} placeholder="https://proxy.example.com/" />
      </label>
      <label className="dialog-checkbox">
        <input name="notification-telegram-inbound-enabled" type="checkbox" checked={form.telegramInboundEnabled} onChange={(event) => setForm((current: any) => ({ ...current, telegramInboundEnabled: event.target.checked }))} />
        <span>{t("settings.notificationTelegramInboundEnabled")}</span>
      </label>
      <label>
        <span>{t("settings.notificationTelegramAllowedChatIds")}</span>
        <input name="notification-telegram-allowed-chat-ids" className="search-input" value={form.telegramAllowedChatIds} onChange={(event) => setForm((current: any) => ({ ...current, telegramAllowedChatIds: event.target.value }))} placeholder="-100123,123456" />
      </label>
      <label>
        <span>{t("settings.notificationTelegramAllowedUserIds")}</span>
        <input name="notification-telegram-allowed-user-ids" className="search-input" value={form.telegramAllowedUserIds} onChange={(event) => setForm((current: any) => ({ ...current, telegramAllowedUserIds: event.target.value }))} placeholder="123456,789012" />
      </label>
      <label>
        <span>{t("settings.notificationTelegramDefaultSessionId")}</span>
        <input name="notification-telegram-default-session-id" className="search-input" value={form.telegramDefaultSessionId} onChange={(event) => setForm((current: any) => ({ ...current, telegramDefaultSessionId: event.target.value }))} placeholder="task-..." />
      </label>
      <label>
        <span>{t("settings.notificationTelegramTestChatId")}</span>
        <input name="notification-telegram-test-chat-id" className="search-input" value={form.telegramTestChatId} onChange={(event) => setForm((current: any) => ({ ...current, telegramTestChatId: event.target.value }))} />
      </label>
    </>
  );
}
