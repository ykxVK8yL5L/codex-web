import { ChevronDown } from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type QQNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  qqAppId: string;
  qqClientSecret: string;
  qqTargetType: string;
  qqTargetId: string;
  qqTestTargetId: string;
  qqCreateRecipient: boolean;
  qqInboundEnabled: boolean;
  qqIntents: string;
  qqAllowedChatIds: string;
  qqAllowedUserIds: string;
  qqDefaultSessionId: string;
  qqTestChatId: string;
};

type Props = {
  form: QQNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
  showCreateRecipient?: boolean;
};

export function QQNotificationAccountPanel({ form, setForm, t, showCreateRecipient = false }: Props) {
  return (
    <>
      <label>
        <span>{t("settings.notificationQQAppId")}</span>
        <input name="notification-qq-app-id" className="search-input" value={form.qqAppId} onChange={(event) => setForm((current: any) => ({ ...current, qqAppId: event.target.value }))} placeholder="1234567890" />
      </label>
      <label>
        <span>{t("settings.notificationQQClientSecret")}</span>
        <input name="notification-qq-client-secret" className="search-input" type="password" value={form.qqClientSecret} onChange={(event) => setForm((current: any) => ({ ...current, qqClientSecret: event.target.value }))} placeholder="client_secret" />
      </label>
      <label className="checkbox-row">
        <input name="notification-qq-inbound-enabled" type="checkbox" checked={form.qqInboundEnabled} onChange={(event) => setForm((current: any) => ({ ...current, qqInboundEnabled: event.target.checked }))} />
        <span>{t("settings.notificationQQInboundEnabled")}</span>
      </label>
      <details className="settings-collapsible">
        <summary>
          <span>{t("settings.notificationQQAdvanced")}</span>
          <ChevronDown className="settings-collapsible-chevron" size={16} />
        </summary>
        <div className="settings-collapsible-body">
          <span className="subtle">{t("settings.notificationQQAdvancedHelp")}</span>
          <label>
            <span>{t("settings.notificationQQIntents")}</span>
            <input name="notification-qq-intents" className="search-input" value={form.qqIntents} onChange={(event) => setForm((current: any) => ({ ...current, qqIntents: event.target.value }))} placeholder="1174409729" />
          </label>
          <label>
            <span>{t("settings.notificationQQAllowedChatIds")}</span>
            <input name="notification-qq-allowed-chat-ids" className="search-input" value={form.qqAllowedChatIds} onChange={(event) => setForm((current: any) => ({ ...current, qqAllowedChatIds: event.target.value }))} placeholder="chat-id-1, chat-id-2" />
          </label>
          <label>
            <span>{t("settings.notificationQQAllowedUserIds")}</span>
            <input name="notification-qq-allowed-user-ids" className="search-input" value={form.qqAllowedUserIds} onChange={(event) => setForm((current: any) => ({ ...current, qqAllowedUserIds: event.target.value }))} placeholder="user-id-1, user-id-2" />
          </label>
          <label>
            <span>{t("settings.notificationQQDefaultSessionId")}</span>
            <input name="notification-qq-default-session-id" className="search-input" value={form.qqDefaultSessionId} onChange={(event) => setForm((current: any) => ({ ...current, qqDefaultSessionId: event.target.value }))} placeholder="session-id" />
          </label>
          {showCreateRecipient && (
            <label className="checkbox-row">
              <input name="notification-qq-create-recipient" type="checkbox" checked={form.qqCreateRecipient} onChange={(event) => setForm((current: any) => ({ ...current, qqCreateRecipient: event.target.checked }))} />
              <span>{t("settings.notificationQQCreateRecipient")}</span>
            </label>
          )}
          <label>
            <span>{t("settings.notificationQQTargetType")}</span>
            <select name="notification-qq-target-type" className="search-input" value={form.qqTargetType} onChange={(event) => setForm((current: any) => ({ ...current, qqTargetType: event.target.value }))}>
              <option value="user">{t("settings.notificationQQTargetUser")}</option>
              <option value="group">{t("settings.notificationQQTargetGroup")}</option>
              <option value="channel">{t("settings.notificationQQTargetChannel")}</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationQQTargetId")}</span>
            <input name="notification-qq-target-id" className="search-input" value={form.qqTargetId} onChange={(event) => setForm((current: any) => ({ ...current, qqTargetId: event.target.value }))} placeholder="openid / group_openid / channel_id" />
          </label>
          <label>
            <span>{t("settings.notificationQQTestTargetId")}</span>
            <input name="notification-qq-test-target-id" className="search-input" value={form.qqTestTargetId} onChange={(event) => setForm((current: any) => ({ ...current, qqTestTargetId: event.target.value }))} placeholder="openid / group_openid / channel_id" />
          </label>
          <label>
            <span>{t("settings.notificationQQTestChatId")}</span>
            <input name="notification-qq-test-chat-id" className="search-input" value={form.qqTestChatId} onChange={(event) => setForm((current: any) => ({ ...current, qqTestChatId: event.target.value }))} placeholder="chat-id" />
          </label>
        </div>
      </details>
    </>
  );
}
