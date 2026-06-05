import React from "react";
import { Plus, RefreshCw, Save, X } from "lucide-react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import { localeLabels, type Locale, type TranslationKey } from "@/lib/i18n";
import { WebhookNotificationAccountPanel } from "@/components/settings/platforms/WebhookNotificationAccountPanel";
import {
  DingTalkNotificationAccountPanel,
  EmailNotificationAccountPanel,
  FeishuNotificationAccountPanel,
  QQNotificationAccountPanel,
  TelegramNotificationAccountPanel,
  WeComNotificationAccountPanel,
  WeixinNotificationAccountPanel,
} from "@/components/settings/platforms";
import type { NotificationAccountForm } from "../types";

type TFunction = (key: TranslationKey) => string;

type NotificationAccountEditorDialogProps = {
  busy: string;
  editingAccountId: string;
  form: NotificationAccountForm;
  sessionToken: string;
  t: TFunction;
  kindLabel: (kind: NotificationAccountSummary["channelKind"]) => string;
  loadNotifications: () => Promise<void>;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  setForm: React.Dispatch<React.SetStateAction<NotificationAccountForm>>;
};

export function NotificationAccountEditorDialog({
  busy,
  editingAccountId,
  form,
  sessionToken,
  t,
  kindLabel,
  loadNotifications,
  onClose,
  onSubmit,
  setForm,
}: NotificationAccountEditorDialogProps) {
  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={onClose} />
      <form className="dialog-card notification-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-account-editor-title" onSubmit={onSubmit}>
        <div className="dialog-head">
          <div>
            <strong id="notification-account-editor-title">{editingAccountId ? t("action.saveChanges") : t("settings.notificationAddAccount")}</strong>
            <p>{t("settings.notificationAccountsHelp")}</p>
          </div>
          <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={onClose}><X size={16} /></button>
        </div>
        <label>
          <span>{t("settings.notificationAccountName")}</span>
          <input name="notification-account-name" className="search-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
        </label>
        <label>
          <span>{t("settings.notificationSenderType")}</span>
          <select name="notification-account-channel-kind" className="search-input" value={form.channelKind} disabled={Boolean(editingAccountId)} onChange={(event) => {
            const channelKind = event.target.value as NotificationAccountSummary["channelKind"];
            setForm((current) => ({ ...current, channelKind, channelId: channelKind === "feishu" ? "feishu-bot" : channelKind === "wecom" ? "wecom-bot" : channelKind === "qq" ? "qq-bot" : channelKind }));
          }}>
            <option value="email">{kindLabel("email")}</option>
            <option value="telegram">{kindLabel("telegram")}</option>
            <option value="weixin">{kindLabel("weixin")}</option>
            <option value="wecom">{kindLabel("wecom")}</option>
            <option value="dingtalk">{kindLabel("dingtalk")}</option>
            <option value="feishu">{kindLabel("feishu")}</option>
            <option value="qq">{kindLabel("qq")}</option>
            <option value="webhook">{kindLabel("webhook")}</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input name="notification-account-enabled" type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
          <span>{t("settings.notificationEnabled")}</span>
        </label>
        <label>
          <span>{t("settings.notificationAllowedAgents")}</span>
          <input name="notification-account-allowed-agents" className="search-input" value={form.permissionAgentIds} onChange={(event) => setForm((current) => ({ ...current, permissionAgentIds: event.target.value }))} placeholder="agent-id-1, agent-id-2" />
        </label>
        <label>
          <span>{t("settings.notificationAllowedRooms")}</span>
          <input name="notification-account-allowed-rooms" className="search-input" value={form.permissionRoomIds} onChange={(event) => setForm((current) => ({ ...current, permissionRoomIds: event.target.value }))} placeholder="room-id-1, room-id-2" />
        </label>
        <label>
          <span>{t("settings.notificationAllowedProjects")}</span>
          <input name="notification-account-allowed-projects" className="search-input" value={form.permissionProjectIds} onChange={(event) => setForm((current) => ({ ...current, permissionProjectIds: event.target.value }))} placeholder="project-id-1, project-id-2" />
        </label>
        {(form.channelKind === "telegram" || form.channelKind === "weixin" || form.channelKind === "dingtalk" || form.channelKind === "feishu" || form.channelKind === "qq") && (
          <label>
            <span>{t("common.language")}</span>
            <select name="notification-account-language" className="search-input" value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value as Locale }))}>
              {(Object.keys(localeLabels) as Locale[]).map((item) => <option key={item} value={item}>{localeLabels[item]}</option>)}
            </select>
          </label>
        )}
        {form.channelKind === "email" && (
          <EmailNotificationAccountPanel form={form} setForm={setForm} t={t} showCreateRecipient />
        )}
        {form.channelKind === "telegram" && (
          <TelegramNotificationAccountPanel form={form} setForm={setForm} t={t} showCreateRecipient />
        )}
        {form.channelKind === "weixin" && (
          <WeixinNotificationAccountPanel
            accountId={editingAccountId}
            form={form}
            setForm={setForm}
            sessionToken={sessionToken}
            t={t}
            loadNotifications={loadNotifications}
            showCreateRecipient
          />
        )}
        {form.channelKind === "wecom" && (
          <WeComNotificationAccountPanel form={form} setForm={setForm} t={t} showCreateRecipient />
        )}
        {form.channelKind === "dingtalk" && (
          <DingTalkNotificationAccountPanel form={form} setForm={setForm} t={t} showCreateRecipient />
        )}
        {form.channelKind === "feishu" && (
          <FeishuNotificationAccountPanel form={form} setForm={setForm} t={t} showCreateRecipient />
        )}
        {form.channelKind === "qq" && (
          <QQNotificationAccountPanel form={form} setForm={setForm} t={t} showCreateRecipient />
        )}
        {form.channelKind === "webhook" && (
          <WebhookNotificationAccountPanel form={form} setForm={setForm} t={t} />
        )}
        <div className="settings-actions">
          <button className="ghost-button" type="submit" disabled={busy === "notification-account"}><IconText icon={editingAccountId ? Save : Plus}>{editingAccountId ? t("action.saveChanges") : t("settings.notificationAddAccount")}</IconText></button>
          <button className="ghost-button" type="button" onClick={onClose}>{t("action.cancel")}</button>
          <button className="ghost-button" type="button" onClick={() => void loadNotifications()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
        </div>
      </form>
    </div>
  );
}
