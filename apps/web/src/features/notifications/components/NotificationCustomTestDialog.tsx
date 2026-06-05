import React from "react";
import { Send, X } from "lucide-react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import type { TranslationKey } from "@/lib/i18n";
import type { NotificationCustomTestForm } from "../types";

type TFunction = (key: TranslationKey) => string;

type NotificationCustomTestDialogProps = {
  account: NotificationAccountSummary;
  busy: boolean;
  form: NotificationCustomTestForm;
  t: TFunction;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  setForm: React.Dispatch<React.SetStateAction<NotificationCustomTestForm>>;
};

export function NotificationCustomTestDialog({
  account,
  busy,
  form,
  t,
  onClose,
  onSubmit,
  setForm,
}: NotificationCustomTestDialogProps) {
  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={onClose} />
      <form className="dialog-card notification-custom-test-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-custom-test-title" onSubmit={onSubmit}>
        <div className="dialog-head">
          <div>
            <strong id="notification-custom-test-title">{t("settings.notificationCustomTestTitle")}</strong>
            <p>{account.name} · {t("settings.notificationCustomTestHelp")}</p>
          </div>
          <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={onClose}><X size={16} /></button>
        </div>
        <label>
          <span>{t("settings.notificationCustomTestSubject")}</span>
          <input name="notification-custom-test-title" className="search-input" value={form.title} placeholder={t("settings.notificationCustomTestSubjectPlaceholder")} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label>
          <span>{t("settings.notificationCustomTestMessage")}</span>
          <textarea name="notification-custom-test-message" rows={6} className="search-input" value={form.message} placeholder={t("settings.notificationCustomTestMessagePlaceholder")} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} required />
        </label>
        <label className="checkbox-row">
          <input name="notification-custom-test-include-help" type="checkbox" checked={form.includeHelp} onChange={(event) => setForm((current) => ({ ...current, includeHelp: event.target.checked }))} />
          <span>{t("settings.notificationCustomTestIncludeHelp")}</span>
        </label>
        <div className="dialog-actions">
          <button className="ghost-button" type="button" onClick={onClose}>{t("action.cancel")}</button>
          <button className="dark-button" type="submit" disabled={busy}><IconText icon={Send}>{t("action.send")}</IconText></button>
        </div>
      </form>
    </div>
  );
}
