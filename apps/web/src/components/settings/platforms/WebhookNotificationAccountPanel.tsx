import { ChevronDown } from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type WebhookNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  webhookUrl: string;
  webhookMethod: string;
  webhookHeaders: string;
  webhookBodyTemplate: string;
};

type Props = {
  form: WebhookNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
};

export function WebhookNotificationAccountPanel({ form, setForm, t }: Props) {
  return (
    <>
      <label>
        <span>{t("settings.notificationWebhookUrl")}</span>
        <input name="notification-webhook-url" className="search-input" value={form.webhookUrl} onChange={(event) => setForm((current: any) => ({ ...current, webhookUrl: event.target.value }))} placeholder="https://example.com/webhook" />
      </label>
      <details className="settings-collapsible">
        <summary>
          <span>{t("settings.notificationWebhookAdvanced")}</span>
          <ChevronDown className="settings-collapsible-chevron" size={16} />
        </summary>
        <div className="settings-collapsible-body">
          <span className="subtle">{t("settings.notificationWebhookAdvancedHelp")}</span>
          <label>
            <span>{t("settings.notificationWebhookMethod")}</span>
            <select name="notification-webhook-method" className="search-input" value={form.webhookMethod} onChange={(event) => setForm((current: any) => ({ ...current, webhookMethod: event.target.value }))}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationWebhookHeaders")}</span>
            <textarea name="notification-webhook-headers" className="search-input" rows={3} value={form.webhookHeaders} onChange={(event) => setForm((current: any) => ({ ...current, webhookHeaders: event.target.value }))} placeholder="Authorization: Bearer xxx" />
          </label>
          <label>
            <span>{t("settings.notificationWebhookTemplate")}</span>
            <textarea name="notification-webhook-template" className="search-input" rows={5} value={form.webhookBodyTemplate} onChange={(event) => setForm((current: any) => ({ ...current, webhookBodyTemplate: event.target.value }))} placeholder="{&#10;  &quot;title&quot;: &quot;{{title}}&quot;,&#10;  &quot;message&quot;: &quot;{{message}}&quot;&#10;}" />
          </label>
        </div>
      </details>
    </>
  );
}
