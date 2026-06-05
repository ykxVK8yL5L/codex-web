import { Plus } from "lucide-react";
import type { NotificationRecipientSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

type NotificationRecipientListProps = {
  busy: string;
  recipients: NotificationRecipientSummary[];
  t: TFunction;
  kindLabel: (kind: NotificationRecipientSummary["kind"]) => string;
  permissionSummary: (permissions: NotificationRecipientSummary["permissions"]) => string;
  onAdd: () => void;
  onDelete: (recipient: NotificationRecipientSummary) => void;
  onEdit: (recipient: NotificationRecipientSummary) => void;
  onTest: (recipient: NotificationRecipientSummary) => void;
};

export function NotificationRecipientList({
  busy,
  recipients,
  t,
  kindLabel,
  permissionSummary,
  onAdd,
  onDelete,
  onEdit,
  onTest,
}: NotificationRecipientListProps) {
  return (
    <section className="notification-card">
      <div className="environment-card-head">
        <div>
          <strong>{t("settings.notificationRecipientList")}</strong>
          <span>{t("settings.notificationRecipientsHelp")}</span>
        </div>
        <button className="ghost-button" type="button" onClick={onAdd}><IconText icon={Plus}>{t("settings.notificationAddRecipient")}</IconText></button>
      </div>
      {recipients.map((recipient) => (
        <div className="storage-item" key={recipient.id}>
          <div>
            <strong>{recipient.name}</strong>
            <span>{kindLabel(recipient.kind)} · {recipient.enabled ? "enabled" : "disabled"} · {permissionSummary(recipient.permissions)}</span>
          </div>
          <div className="storage-actions">
            <button className="ghost-button" type="button" onClick={() => onEdit(recipient)}>{t("action.edit")}</button>
            <button className="ghost-button" type="button" disabled={busy === `notification-recipient-test:${recipient.id}`} onClick={() => onTest(recipient)}>{t("settings.notificationTest")}</button>
            <button className="ghost-button danger-button" type="button" onClick={() => onDelete(recipient)}>{t("action.delete")}</button>
          </div>
        </div>
      ))}
      {!recipients.length && <div className="empty-state">{t("settings.notificationNoRecipients")}</div>}
    </section>
  );
}
