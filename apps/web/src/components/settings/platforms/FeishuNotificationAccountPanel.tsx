import { type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type FeishuNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: string;
  feishuInboundEnabled: boolean;
  feishuTestChatId: string;
  feishuCreateRecipient: boolean;
  language: string;
};

type Props = {
  form: FeishuNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
  showCreateRecipient?: boolean;
};

export function FeishuNotificationAccountPanel({ form, setForm, t, showCreateRecipient = false }: Props) {
  return (
    <>
      <label className="checkbox-row">
        <input
          name="notification-feishu-inbound-enabled"
          type="checkbox"
          checked={form.feishuInboundEnabled}
          onChange={(event) => setForm((current: any) => ({ ...current, feishuInboundEnabled: event.target.checked }))}
        />
        <span>{t("settings.notificationFeishuInboundEnabled")}</span>
      </label>
      <label>
        <span>{t("settings.notificationFeishuAppId")}</span>
        <input name="notification-feishu-app-id" className="search-input" value={form.feishuAppId} onChange={(event) => setForm((current: any) => ({ ...current, feishuAppId: event.target.value }))} placeholder="cli_xxx" />
      </label>
      <label>
        <span>{t("settings.notificationFeishuAppSecret")}</span>
        <input name="notification-feishu-app-secret" className="search-input" type="password" value={form.feishuAppSecret} onChange={(event) => setForm((current: any) => ({ ...current, feishuAppSecret: event.target.value }))} placeholder="secret" />
      </label>
      <label>
        <span>{t("settings.notificationFeishuDomain")}</span>
        <select name="notification-feishu-domain" className="search-input" value={form.feishuDomain} onChange={(event) => setForm((current: any) => ({ ...current, feishuDomain: event.target.value }))}>
          <option value="feishu">Feishu</option>
          <option value="lark">Lark</option>
        </select>
      </label>
      <label>
        <span>{t("settings.notificationFeishuTestChatId")}</span>
        <input name="notification-feishu-test-chat-id" className="search-input" value={form.feishuTestChatId} onChange={(event) => setForm((current: any) => ({ ...current, feishuTestChatId: event.target.value }))} placeholder="oc_xxx / ou_xxx" />
      </label>
      {showCreateRecipient && (
        <label className="checkbox-row">
          <input name="notification-feishu-create-recipient" type="checkbox" checked={form.feishuCreateRecipient} onChange={(event) => setForm((current: any) => ({ ...current, feishuCreateRecipient: event.target.checked }))} />
          <span>{t("settings.notificationFeishuCreateRecipient")}</span>
        </label>
      )}
    </>
  );
}
