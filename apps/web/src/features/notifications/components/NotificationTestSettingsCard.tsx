import React from "react";
import { ChevronDown, ChevronUp, Save } from "lucide-react";
import type { NotificationTestSettings } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import { formatShortDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import type { NotificationTestSettingsForm } from "../types";

type TFunction = (key: TranslationKey) => string;

type NotificationTestSettingsCardProps = {
  busy: boolean;
  collapsed: boolean;
  form: NotificationTestSettingsForm;
  settings: NotificationTestSettings | null;
  t: TFunction;
  onSubmit: (event: React.FormEvent) => void;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setForm: React.Dispatch<React.SetStateAction<NotificationTestSettingsForm>>;
};

export function NotificationTestSettingsCard({
  busy,
  collapsed,
  form,
  settings,
  t,
  onSubmit,
  setCollapsed,
  setForm,
}: NotificationTestSettingsCardProps) {
  return (
    <form className="notification-card" onSubmit={onSubmit}>
      <div className="environment-card-head">
        <div>
          <strong>{t("settings.notificationTestSettingsTitle")}</strong>
          <span>{t("settings.notificationTestSettingsHelp")}</span>
        </div>
        <button className="ghost-button icon-only" type="button" title={collapsed ? t("action.open") : t("action.collapse")} aria-label={collapsed ? t("action.open") : t("action.collapse")} onClick={() => setCollapsed((current) => !current)}>
          <IconText icon={collapsed ? ChevronDown : ChevronUp}>{collapsed ? t("action.open") : t("action.collapse")}</IconText>
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="backup-scope-grid">
            <label>
              <span>{t("settings.notificationTestTitleZh")}</span>
              <input name="notification-test-title-zh" className="search-input" value={form.titleZh} onChange={(event) => setForm((current) => ({ ...current, titleZh: event.target.value }))} required />
            </label>
            <label>
              <span>{t("settings.notificationTestTitleEn")}</span>
              <input name="notification-test-title-en" className="search-input" value={form.titleEn} onChange={(event) => setForm((current) => ({ ...current, titleEn: event.target.value }))} required />
            </label>
          </div>
          <label>
            <span>{t("settings.notificationTestMessageZh")}</span>
            <textarea name="notification-test-message-zh" className="search-input" rows={3} value={form.messageZh} onChange={(event) => setForm((current) => ({ ...current, messageZh: event.target.value }))} required />
          </label>
          <label>
            <span>{t("settings.notificationTestMessageEn")}</span>
            <textarea name="notification-test-message-en" className="search-input" rows={3} value={form.messageEn} onChange={(event) => setForm((current) => ({ ...current, messageEn: event.target.value }))} required />
          </label>
          <label className="checkbox-row">
            <input name="notification-test-include-help" type="checkbox" checked={form.includeHelp} onChange={(event) => setForm((current) => ({ ...current, includeHelp: event.target.checked }))} />
            <span>{t("settings.notificationCustomTestIncludeHelp")}</span>
          </label>
          {settings && <span className="subtle">{formatShortDate(settings.updatedAt)}</span>}
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
        </>
      )}
    </form>
  );
}
