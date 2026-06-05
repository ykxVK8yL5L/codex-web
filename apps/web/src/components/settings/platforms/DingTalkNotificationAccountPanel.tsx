import { ChevronDown } from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type DingTalkNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  dingtalkBotToken: string;
  dingtalkBotSecret: string;
  dingtalkBaseUrl: string;
};

type Props = {
  form: DingTalkNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
};

export function DingTalkNotificationAccountPanel({ form, setForm, t }: Props) {
  return (
    <>
      <label>
        <span>{t("settings.notificationDingtalkBotToken")}</span>
        <input name="notification-dingtalk-bot-token" className="search-input" value={form.dingtalkBotToken} onChange={(event) => setForm((current: any) => ({ ...current, dingtalkBotToken: event.target.value }))} placeholder="access_token" />
      </label>
      <details className="settings-collapsible">
        <summary>
          <span>{t("settings.notificationDingtalkAdvanced")}</span>
          <ChevronDown className="settings-collapsible-chevron" size={16} />
        </summary>
        <div className="settings-collapsible-body">
          <span className="subtle">{t("settings.notificationDingtalkAdvancedHelp")}</span>
          <label>
            <span>{t("settings.notificationDingtalkBotSecret")}</span>
            <input name="notification-dingtalk-bot-secret" className="search-input" type="password" value={form.dingtalkBotSecret} onChange={(event) => setForm((current: any) => ({ ...current, dingtalkBotSecret: event.target.value }))} placeholder="secret" />
          </label>
          <label>
            <span>{t("settings.notificationDingtalkBaseUrl")}</span>
            <input name="notification-dingtalk-base-url" className="search-input" value={form.dingtalkBaseUrl} onChange={(event) => setForm((current: any) => ({ ...current, dingtalkBaseUrl: event.target.value }))} placeholder="https://oapi.dingtalk.com/robot/send" />
          </label>
        </div>
      </details>
    </>
  );
}
