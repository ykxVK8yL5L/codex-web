import { ChevronDown } from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type EmailNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  emailInboundEnabled: boolean;
  emailHost: string;
  emailPort: string;
  emailSecure: boolean;
  emailUsername: string;
  emailPassword: string;
  emailFromName: string;
  emailFromEmail: string;
  emailCreateRecipient: boolean;
  emailImapHost: string;
  emailImapPort: string;
  emailImapSecure: boolean;
  emailImapUsername: string;
  emailImapPassword: string;
  emailInboundMailbox: string;
  emailAllowedSenderEmails: string;
  emailDefaultSessionId: string;
  testEmailTo: string;
};

type Props = {
  form: EmailNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  t: TFunction;
  showCreateRecipient?: boolean;
};

export function EmailNotificationAccountPanel({ form, setForm, t, showCreateRecipient = false }: Props) {
  return (
    <>
      <label>
        <span>{t("settings.notificationEmailHost")}</span>
        <input name="notification-email-host" className="search-input" value={form.emailHost} onChange={(event) => setForm((current: any) => ({ ...current, emailHost: event.target.value }))} />
      </label>
      <label>
        <span>{t("settings.notificationEmailPort")}</span>
        <input name="notification-email-port" className="search-input" type="number" min="1" value={form.emailPort} onChange={(event) => setForm((current: any) => ({ ...current, emailPort: event.target.value }))} />
      </label>
      <label className="checkbox-row">
        <input name="notification-email-secure" type="checkbox" checked={form.emailSecure} onChange={(event) => setForm((current: any) => ({ ...current, emailSecure: event.target.checked }))} />
        <span>{t("settings.notificationEmailSecure")}</span>
      </label>
      <label>
        <span>{t("settings.notificationEmailUsername")}</span>
        <input name="notification-email-username" className="search-input" value={form.emailUsername} onChange={(event) => setForm((current: any) => ({ ...current, emailUsername: event.target.value }))} />
      </label>
      <label>
        <span>{t("settings.notificationEmailPassword")}</span>
        <input name="notification-email-password" className="search-input" type="password" value={form.emailPassword} onChange={(event) => setForm((current: any) => ({ ...current, emailPassword: event.target.value }))} />
      </label>
      <label>
        <span>{t("settings.notificationEmailFromName")}</span>
        <input name="notification-email-from-name" className="search-input" value={form.emailFromName} onChange={(event) => setForm((current: any) => ({ ...current, emailFromName: event.target.value }))} />
      </label>
      <label>
        <span>{t("settings.notificationEmailFromEmail")}</span>
        <input name="notification-email-from-email" className="search-input" value={form.emailFromEmail} onChange={(event) => setForm((current: any) => ({ ...current, emailFromEmail: event.target.value }))} />
      </label>
      {showCreateRecipient && (
        <label className="checkbox-row">
          <input name="notification-email-create-recipient" type="checkbox" checked={form.emailCreateRecipient} onChange={(event) => setForm((current: any) => ({ ...current, emailCreateRecipient: event.target.checked }))} />
          <span>{t("settings.notificationEmailCreateRecipient")}</span>
        </label>
      )}
      <label className="checkbox-row">
        <input name="notification-email-inbound-enabled" type="checkbox" checked={form.emailInboundEnabled} onChange={(event) => setForm((current: any) => ({ ...current, emailInboundEnabled: event.target.checked }))} />
        <span>{t("settings.notificationEmailInboundEnabled")}</span>
      </label>
      <details className="settings-collapsible">
        <summary>
          <span>{t("settings.notificationEmailAdvanced")}</span>
          <ChevronDown className="settings-collapsible-chevron" size={16} />
        </summary>
        <div className="settings-collapsible-body">
          <span className="subtle">{t("settings.notificationEmailAdvancedHelp")}</span>
          <label>
            <span>{t("settings.notificationEmailImapHost")}</span>
            <input name="notification-email-imap-host" className="search-input" value={form.emailImapHost} onChange={(event) => setForm((current: any) => ({ ...current, emailImapHost: event.target.value }))} placeholder={t("settings.notificationEmailHost")} />
          </label>
          <label>
            <span>{t("settings.notificationEmailImapPort")}</span>
            <input name="notification-email-imap-port" className="search-input" type="number" min="1" value={form.emailImapPort} onChange={(event) => setForm((current: any) => ({ ...current, emailImapPort: event.target.value }))} />
          </label>
          <label className="checkbox-row">
            <input name="notification-email-imap-secure" type="checkbox" checked={form.emailImapSecure} onChange={(event) => setForm((current: any) => ({ ...current, emailImapSecure: event.target.checked }))} />
            <span>{t("settings.notificationEmailImapSecure")}</span>
          </label>
          <label>
            <span>{t("settings.notificationEmailImapUsername")}</span>
            <input name="notification-email-imap-username" className="search-input" value={form.emailImapUsername} onChange={(event) => setForm((current: any) => ({ ...current, emailImapUsername: event.target.value }))} placeholder={t("settings.notificationEmailUsername")} />
          </label>
          <label>
            <span>{t("settings.notificationEmailImapPassword")}</span>
            <input name="notification-email-imap-password" className="search-input" type="password" value={form.emailImapPassword} onChange={(event) => setForm((current: any) => ({ ...current, emailImapPassword: event.target.value }))} />
          </label>
          <label>
            <span>{t("settings.notificationEmailInboundMailbox")}</span>
            <input name="notification-email-inbound-mailbox" className="search-input" value={form.emailInboundMailbox} onChange={(event) => setForm((current: any) => ({ ...current, emailInboundMailbox: event.target.value }))} placeholder="INBOX" />
          </label>
          <label>
            <span>{t("settings.notificationEmailAllowedSenderEmails")}</span>
            <input name="notification-email-allowed-sender-emails" className="search-input" value={form.emailAllowedSenderEmails} onChange={(event) => setForm((current: any) => ({ ...current, emailAllowedSenderEmails: event.target.value }))} placeholder="a@example.com,b@example.com" />
          </label>
      <label>
        <span>{t("settings.notificationEmailDefaultSessionId")}</span>
        <input name="notification-email-default-session-id" className="search-input" value={form.emailDefaultSessionId} onChange={(event) => setForm((current: any) => ({ ...current, emailDefaultSessionId: event.target.value }))} placeholder="task-..." />
      </label>
      <label>
        <span>{t("settings.notificationTestEmailTo")}</span>
        <input name="notification-test-email" className="search-input" value={form.testEmailTo} onChange={(event) => setForm((current: any) => ({ ...current, testEmailTo: event.target.value }))} placeholder="a@example.com,b@example.com" />
      </label>
    </div>
      </details>
    </>
  );
}
