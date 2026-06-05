import { ChevronDown } from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type WeComNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
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
};

type Props = {
  form: WeComNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
  showCreateRecipient?: boolean;
};

export function WeComNotificationAccountPanel({ form, setForm, t, showCreateRecipient = false }: Props) {
  return (
    <>
      <p className="settings-inline-help">{t("settings.notificationWeComSetupHelp")}</p>
      <label>
        <span>{t("settings.notificationWeComBotId")}</span>
        <input name="notification-wecom-bot-id" className="search-input" value={form.wecomBotId} onChange={(event) => setForm((current: any) => ({ ...current, wecomBotId: event.target.value }))} placeholder="bot_id" />
      </label>
      <label>
        <span>{t("settings.notificationWeComSecret")}</span>
        <input name="notification-wecom-secret" className="search-input" type="password" value={form.wecomSecret} onChange={(event) => setForm((current: any) => ({ ...current, wecomSecret: event.target.value }))} placeholder="secret" />
      </label>
      <label>
        <span>{t("settings.notificationWeComWebsocketUrl")}</span>
        <input name="notification-wecom-websocket-url" className="search-input" value={form.wecomWebsocketUrl} onChange={(event) => setForm((current: any) => ({ ...current, wecomWebsocketUrl: event.target.value }))} placeholder="wss://openws.work.weixin.qq.com" />
      </label>
      <label className="checkbox-row">
        <input name="notification-wecom-inbound-enabled" type="checkbox" checked={form.wecomInboundEnabled} onChange={(event) => setForm((current: any) => ({ ...current, wecomInboundEnabled: event.target.checked }))} />
        <span>{t("settings.notificationWeComInboundEnabled")}</span>
      </label>
      <span className="subtle">{t("settings.notificationWeComInboundHelp")}</span>
      <details className="settings-collapsible">
        <summary>
          <span>{t("settings.notificationWeComAdvanced")}</span>
          <ChevronDown className="settings-collapsible-chevron" size={16} />
        </summary>
        <div className="settings-collapsible-body">
          <span className="subtle">{t("settings.notificationWeComAdvancedHelp")}</span>
          <label>
            <span>{t("settings.notificationWeComDmPolicy")}</span>
            <select name="notification-wecom-dm-policy" className="search-input" value={form.wecomDmPolicy} onChange={(event) => setForm((current: any) => ({ ...current, wecomDmPolicy: event.target.value }))}>
              <option value="open">{t("settings.notificationWeComPolicyOpen")}</option>
              <option value="allowlist">{t("settings.notificationWeComPolicyAllowlist")}</option>
              <option value="disabled">{t("settings.notificationWeComPolicyDisabled")}</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationWeComAllowFrom")}</span>
            <input name="notification-wecom-allow-from" className="search-input" value={form.wecomAllowFrom} onChange={(event) => setForm((current: any) => ({ ...current, wecomAllowFrom: event.target.value }))} placeholder="user_id_1, user_id_2" />
          </label>
          <label>
            <span>{t("settings.notificationWeComGroupPolicy")}</span>
            <select name="notification-wecom-group-policy" className="search-input" value={form.wecomGroupPolicy} onChange={(event) => setForm((current: any) => ({ ...current, wecomGroupPolicy: event.target.value }))}>
              <option value="open">{t("settings.notificationWeComPolicyOpen")}</option>
              <option value="allowlist">{t("settings.notificationWeComPolicyAllowlist")}</option>
              <option value="disabled">{t("settings.notificationWeComPolicyDisabled")}</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationWeComGroupAllowFrom")}</span>
            <input name="notification-wecom-group-allow-from" className="search-input" value={form.wecomGroupAllowFrom} onChange={(event) => setForm((current: any) => ({ ...current, wecomGroupAllowFrom: event.target.value }))} placeholder="group_id_1, group_id_2" />
          </label>
          <label>
            <span>{t("settings.notificationWeComDefaultSessionId")}</span>
            <input name="notification-wecom-default-session-id" className="search-input" value={form.wecomDefaultSessionId} onChange={(event) => setForm((current: any) => ({ ...current, wecomDefaultSessionId: event.target.value }))} placeholder="session-id" />
          </label>
          {showCreateRecipient && (
            <label className="checkbox-row">
              <input name="notification-wecom-create-recipient" type="checkbox" checked={form.wecomCreateRecipient} onChange={(event) => setForm((current: any) => ({ ...current, wecomCreateRecipient: event.target.checked }))} />
              <span>{t("settings.notificationWeComCreateRecipient")}</span>
            </label>
          )}
          <label>
            <span>{t("settings.notificationWeComTestChatId")}</span>
            <input name="notification-wecom-test-chat-id" className="search-input" value={form.wecomTestChatId} onChange={(event) => setForm((current: any) => ({ ...current, wecomTestChatId: event.target.value }))} placeholder="chat-id" />
          </label>
        </div>
      </details>
    </>
  );
}
