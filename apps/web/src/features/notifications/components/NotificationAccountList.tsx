import { Info, Plus, X } from "lucide-react";
import { useState } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

type NotificationAccountListProps = {
  accounts: NotificationAccountSummary[];
  busy: string;
  t: TFunction;
  accountKindLabel: (account: NotificationAccountSummary) => string;
  permissionSummary: (permissions: NotificationAccountSummary["permissions"]) => string;
  onAdd: () => void;
  onCustomTest: (account: NotificationAccountSummary) => void;
  onDelete: (account: NotificationAccountSummary) => void;
  onEdit: (account: NotificationAccountSummary) => void;
  onTest: (account: NotificationAccountSummary) => void;
};

export function NotificationAccountList({
  accounts,
  busy,
  t,
  accountKindLabel,
  permissionSummary,
  onAdd,
  onCustomTest,
  onDelete,
  onEdit,
  onTest,
}: NotificationAccountListProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <section className="notification-card">
      <div className="environment-card-head">
        <div>
          <div className="notification-card-title-row">
            <strong>{t("settings.notificationAccountList")}</strong>
            <button className="notification-title-info-button" type="button" title={t("action.details")} aria-label={t("action.details")} onClick={() => setHelpOpen(true)}><Info size={16} /></button>
          </div>
        </div>
        <button className="ghost-button" type="button" onClick={onAdd}><IconText icon={Plus}>{t("settings.notificationAddAccount")}</IconText></button>
      </div>
      {helpOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setHelpOpen(false)} />
          <div className="dialog-card notification-help-dialog" role="dialog" aria-modal="true">
            <div className="dialog-head">
              <div>
                <strong>{t("settings.notificationAccountList")}</strong>
                <p>{t("settings.notificationAccountsHelp")}</p>
              </div>
              <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={() => setHelpOpen(false)}><X size={16} /></button>
            </div>
          </div>
        </div>
      )}
      {accounts.map((account) => (
        <div className="storage-item" key={account.id}>
          <div>
            <strong>{account.name}</strong>
            <span>{accountKindLabel(account)} · {account.enabled ? "enabled" : "disabled"} · {account.lastTestStatus ?? "untested"} · {permissionSummary(account.permissions)}</span>
            {account.lastError && <span className="result-error">{account.lastError}</span>}
          </div>
          <div className="storage-actions">
            <button className="ghost-button" type="button" onClick={() => onEdit(account)}>{t("action.edit")}</button>
            <button className="ghost-button" type="button" disabled={busy === `notification-test:${account.id}`} onClick={() => onTest(account)}>{t("settings.notificationTest")}</button>
            <button className="ghost-button" type="button" disabled={busy === `notification-custom-test:${account.id}`} onClick={() => onCustomTest(account)}>{t("settings.notificationCustomTest")}</button>
            <button className="ghost-button danger-button" type="button" onClick={() => onDelete(account)}>{t("action.delete")}</button>
          </div>
        </div>
      ))}
      {!accounts.length && <div className="empty-state">{t("settings.notificationNoAccounts")}</div>}
    </section>
  );
}
