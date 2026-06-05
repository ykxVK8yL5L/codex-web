import React from "react";
import { X } from "lucide-react";
import type { NotificationChannelDefinition, NotificationSettingsResponse } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";
import type { NotificationChannelForm } from "../types";

type TFunction = (key: TranslationKey) => string;

type NotificationChannelManagerDialogProps = {
  busy: string;
  editingChannelId: string;
  form: NotificationChannelForm;
  settings: NotificationSettingsResponse | null;
  t: TFunction;
  onClose: () => void;
  onDelete: (channel: NotificationChannelDefinition) => void;
  onEdit: (channel: NotificationChannelDefinition) => void;
  onReset: () => void;
  onSubmit: (event: React.FormEvent) => void;
  setForm: React.Dispatch<React.SetStateAction<NotificationChannelForm>>;
};

export function NotificationChannelManagerDialog({
  busy,
  editingChannelId,
  form,
  settings,
  t,
  onClose,
  onDelete,
  onEdit,
  onReset,
  onSubmit,
  setForm,
}: NotificationChannelManagerDialogProps) {
  const editingChannel = settings?.channels.find((channel) => channel.id === editingChannelId);
  const editingBuiltin = Boolean(editingChannel?.builtin);

  function closeDialog() {
    onReset();
    onClose();
  }

  return (
    <div className="dialog-layer" role="presentation">
      <div className="dialog-backdrop" onClick={closeDialog} />
      <section className="dialog-card notification-channel-dialog" role="dialog" aria-modal="true" aria-label={t("settings.notificationManageChannels")}>
        <div className="dialog-head">
          <div>
            <strong>{t("settings.notificationManageChannels")}</strong>
            <p>{t("settings.notificationChannelsHelp")}</p>
          </div>
          <button className="drawer-close" type="button" onClick={closeDialog} aria-label={t("action.close")}><X size={18} /></button>
        </div>
        <form className="settings-list" onSubmit={onSubmit}>
          {editingChannelId && (
            <span className="subtle">
              {editingBuiltin ? t("settings.notificationBuiltinChannelReadonly") : t("settings.notificationEditingChannel")}
            </span>
          )}
          <label>
            <span>{t("settings.notificationChannelName")}</span>
            <input name="notification-channel-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required disabled={editingBuiltin} />
          </label>
          <label>
            <span>{t("settings.notificationChannelDescription")}</span>
            <input name="notification-channel-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label>
            <span>{t("settings.notificationChannelAdapter")}</span>
            <select name="notification-channel-adapter" value={form.adapter} onChange={(event) => setForm((current) => ({ ...current, adapter: event.target.value }))}>
              <option value="webhook">{t("settings.notificationChannelAdapterWebhook")}</option>
              <option value="authenticated_webhook">{t("settings.notificationChannelAdapterAuthenticatedWebhook")}</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationChannelAuthType")}</span>
            <select name="notification-channel-auth-type" value={form.authType} onChange={(event) => setForm((current) => ({ ...current, authType: event.target.value }))}>
              <option value="none">{t("settings.notificationChannelAuthNone")}</option>
              <option value="bearer">{t("settings.notificationChannelAuthBearer")}</option>
              <option value="query_token">{t("settings.notificationChannelAuthQueryToken")}</option>
              <option value="token_request">{t("settings.notificationChannelAuthTokenRequest")}</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationWebhookMethod")}</span>
            <select name="notification-channel-method" value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </label>
          <label>
            <span>{t("settings.notificationChannelUrlTemplate")}</span>
            <input name="notification-channel-url-template" value={form.urlTemplate} onChange={(event) => setForm((current) => ({ ...current, urlTemplate: event.target.value }))} placeholder="https://example.com/{{token}}" required />
          </label>
          <label>
            <span>{t("settings.notificationChannelFields")}</span>
            <input name="notification-channel-account-fields" value={form.accountFields} onChange={(event) => setForm((current) => ({ ...current, accountFields: event.target.value }))} placeholder="serverUrl,deviceKey,group" />
          </label>
          <label>
            <span>{t("settings.notificationWebhookHeaders")}</span>
            <textarea name="notification-channel-headers-template" rows={3} value={form.headersTemplate} onChange={(event) => setForm((current) => ({ ...current, headersTemplate: event.target.value }))} />
          </label>
          <label>
            <span>{t("settings.notificationWebhookTemplate")}</span>
            <textarea name="notification-channel-body-template" rows={5} value={form.bodyTemplate} onChange={(event) => setForm((current) => ({ ...current, bodyTemplate: event.target.value }))} />
          </label>
          <div className="dialog-actions">
            <button className="ghost-button" type="button" onClick={editingChannelId ? onReset : closeDialog}>{t("action.cancel")}</button>
            <button className="dark-button" type="submit" disabled={busy === "notification-channel" || editingBuiltin}>
              {editingChannelId ? t("action.saveChanges") : t("settings.notificationAddChannel")}
            </button>
          </div>
        </form>
        <div className="storage-list">
          {(settings?.channels ?? []).filter((channel) => channel.kind === "webhook").map((channel) => (
            <div className="storage-item" key={channel.id}>
              <div>
                <strong>{channel.name}</strong>
                <span>{channel.builtin ? t("settings.notificationBuiltinChannel") : t("settings.notificationCustomChannel")} · {channel.adapter ?? "webhook"} · {channel.authType ?? "none"} · {channel.accountFields?.join(", ") || "-"}</span>
              </div>
              <div className="storage-actions">
                <button className="ghost-button" type="button" onClick={() => onEdit(channel)}>{t("action.edit")}</button>
                {!channel.builtin && (
                  <button className="ghost-button danger-button" type="button" onClick={() => onDelete(channel)}>{t("action.delete")}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
