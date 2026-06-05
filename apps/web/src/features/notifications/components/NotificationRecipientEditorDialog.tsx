import React from "react";
import { Plus, Save, X } from "lucide-react";
import type { NotificationAccountSummary, NotificationChannelDefinition, NotificationRecipientSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import type { TranslationKey } from "@/lib/i18n";
import { notificationFieldLabel, notificationSenderAccountsForKind } from "../utils";
import type { NotificationRecipientForm } from "../types";

type TFunction = (key: TranslationKey) => string;

type NotificationRecipientEditorDialogProps = {
  busy: string;
  editingRecipientId: string;
  form: NotificationRecipientForm;
  notificationSettings: { channels: NotificationChannelDefinition[] } | null;
  t: TFunction;
  kindLabel: (kind: NotificationRecipientSummary["kind"]) => string;
  onClose: () => void;
  onManageChannels: () => void;
  onSubmit: (event: React.FormEvent) => void;
  setForm: React.Dispatch<React.SetStateAction<NotificationRecipientForm>>;
  accounts: NotificationAccountSummary[];
};

function senderLabel(account: NotificationAccountSummary) {
  return account.name;
}

export function NotificationRecipientEditorDialog({
  busy,
  editingRecipientId,
  form,
  notificationSettings,
  t,
  kindLabel,
  onClose,
  onManageChannels,
  onSubmit,
  setForm,
  accounts,
}: NotificationRecipientEditorDialogProps) {
  const selectedChannel = notificationSettings?.channels.find((channel) => channel.id === form.channelId);
  const senderAccountsForKind = (kind: NotificationRecipientSummary["kind"]) => notificationSenderAccountsForKind(accounts, kind);

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={onClose} />
      <form className="dialog-card notification-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-recipient-editor-title" onSubmit={onSubmit}>
        <div className="dialog-head">
          <div>
            <strong id="notification-recipient-editor-title">{editingRecipientId ? t("action.saveChanges") : t("settings.notificationAddRecipient")}</strong>
            <p>{t("settings.notificationRecipientsHelp")}</p>
          </div>
          <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={onClose}><X size={16} /></button>
        </div>
        <label>
          <span>{t("settings.notificationRecipientName")}</span>
          <input name="notification-recipient-name" className="search-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
        </label>
        <label>
          <span>{t("settings.notificationRecipientKind")}</span>
          <select name="notification-recipient-kind" className="search-input" value={form.kind} disabled={Boolean(editingRecipientId)} onChange={(event) => {
            const kind = event.target.value as NotificationRecipientSummary["kind"];
            const senderAccountId = senderAccountsForKind(kind)[0]?.id ?? "";
            setForm((current) => ({
              ...current,
              kind,
              senderAccountId,
            }));
          }}>
            {(["email", "telegram", "weixin", "wecom", "dingtalk", "feishu", "qq", "webhook"] as NotificationRecipientSummary["kind"][]).map((kind) => (
              <option key={kind} value={kind}>{kindLabel(kind)}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-row">
          <input name="notification-recipient-enabled" type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
          <span>{t("settings.notificationEnabled")}</span>
        </label>
        <label>
          <span>{t("settings.notificationAllowedAgents")}</span>
          <input name="notification-recipient-allowed-agents" className="search-input" value={form.permissionAgentIds} onChange={(event) => setForm((current) => ({ ...current, permissionAgentIds: event.target.value }))} placeholder="agent-id-1, agent-id-2" />
        </label>
        <label>
          <span>{t("settings.notificationAllowedRooms")}</span>
          <input name="notification-recipient-allowed-rooms" className="search-input" value={form.permissionRoomIds} onChange={(event) => setForm((current) => ({ ...current, permissionRoomIds: event.target.value }))} placeholder="room-id-1, room-id-2" />
        </label>
        <label>
          <span>{t("settings.notificationAllowedProjects")}</span>
          <input name="notification-recipient-allowed-projects" className="search-input" value={form.permissionProjectIds} onChange={(event) => setForm((current) => ({ ...current, permissionProjectIds: event.target.value }))} placeholder="project-id-1, project-id-2" />
        </label>
        {form.kind === "webhook" && (
          <>
            <label>
              <span>{t("settings.notificationChannel")}</span>
              <div className="notification-channel-select">
                <select name="notification-recipient-channel-id" className="search-input" value={form.channelId} onChange={(event) => {
                  const channelId = event.target.value;
                  setForm((current) => ({
                    ...current,
                    channelId,
                    customConfig: (channelId === "bark" ? { serverUrl: "https://api.day.app", group: "Codex Web" } : {}) as Record<string, string>,
                  }));
                }}>
                  {(notificationSettings?.channels ?? []).filter((channel) => channel.kind === "webhook").map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <button className="ghost-button icon-only" type="button" title={t("settings.notificationManageChannels")} aria-label={t("settings.notificationManageChannels")} onClick={onManageChannels}><IconText icon={Plus}>{t("settings.notificationManageChannels")}</IconText></button>
              </div>
            </label>
            {(selectedChannel?.id !== "webhook")
              ? (selectedChannel?.accountFields ?? []).map((field) => (
                <label key={field}>
                  <span>{notificationFieldLabel(t, field)}</span>
                  <input name={`notification-recipient-field-${field}`} className="search-input" type={/key|token|secret|password/i.test(field) ? "password" : "text"} value={form.customConfig[field] ?? ""} onChange={(event) => setForm((current) => ({ ...current, customConfig: { ...current.customConfig, [field]: event.target.value } }))} />
                </label>
              ))
              : (
                <label>
                  <span>{t("settings.notificationWebhookUrl")}</span>
                  <input name="notification-recipient-webhook-url" className="search-input" value={form.webhookUrl} onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))} />
                </label>
              )}
          </>
        )}
        {form.kind === "email" && (
          <>
            <label>
              <span>{t("settings.notificationEmailTo")}</span>
              <input name="notification-recipient-email" className="search-input" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="user@example.com" />
            </label>
            {senderAccountsForKind("email").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultEmailSender")}</span>
                <select name="notification-recipient-email-sender" className="search-input" value={form.senderAccountId} onChange={(event) => setForm((current) => ({ ...current, senderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("email").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("email").length === 1 ? t("settings.notificationEmailSenderAuto") : t("settings.notificationEmailSenderMissing")}</span>
            )}
          </>
        )}
        {form.kind === "telegram" && (
          <>
            <label>
              <span>{t("settings.notificationTelegramChatId")}</span>
              <input name="notification-recipient-telegram-chat-id" className="search-input" value={form.telegramChatId} onChange={(event) => setForm((current) => ({ ...current, telegramChatId: event.target.value }))} />
            </label>
            {senderAccountsForKind("telegram").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultTelegramSender")}</span>
                <select name="notification-recipient-telegram-sender" className="search-input" value={form.telegramSenderAccountId} onChange={(event) => setForm((current) => ({ ...current, telegramSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("telegram").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("telegram").length === 1 ? t("settings.notificationTelegramSenderAuto") : t("settings.notificationTelegramSenderMissing")}</span>
            )}
          </>
        )}
        {form.kind === "weixin" && (
          <>
            <label>
              <span>{t("settings.notificationWeixinChatId")}</span>
              <input name="notification-recipient-weixin-chat-id" className="search-input" value={form.weixinChatId} onChange={(event) => setForm((current) => ({ ...current, weixinChatId: event.target.value }))} />
            </label>
            {senderAccountsForKind("weixin").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultWeixinSender")}</span>
                <select name="notification-recipient-weixin-sender" className="search-input" value={form.weixinSenderAccountId} onChange={(event) => setForm((current) => ({ ...current, weixinSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("weixin").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("weixin").length === 1 ? t("settings.notificationWeixinSenderAuto") : t("settings.notificationWeixinSenderMissing")}</span>
            )}
          </>
        )}
        {form.kind === "dingtalk" && (
          <>
            {senderAccountsForKind("dingtalk").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultDingTalkSender")}</span>
                <select name="notification-recipient-dingtalk-sender" className="search-input" value={form.dingtalkSenderAccountId} onChange={(event) => setForm((current) => ({ ...current, dingtalkSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("dingtalk").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("dingtalk").length === 1 ? t("settings.notificationDingTalkSenderAuto") : t("settings.notificationDingTalkSenderMissing")}</span>
            )}
          </>
        )}
        {form.kind === "feishu" && (
          <>
            <label>
              <span>{t("settings.notificationFeishuChatId")}</span>
              <input name="notification-recipient-feishu-chat-id" className="search-input" value={form.feishuChatId} onChange={(event) => setForm((current) => ({ ...current, feishuChatId: event.target.value }))} />
            </label>
            {senderAccountsForKind("feishu").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultFeishuSender")}</span>
                <select name="notification-recipient-feishu-sender" className="search-input" value={form.feishuSenderAccountId} onChange={(event) => setForm((current) => ({ ...current, feishuSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("feishu").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("feishu").length === 1 ? t("settings.notificationFeishuSenderAuto") : t("settings.notificationFeishuSenderMissing")}</span>
            )}
          </>
        )}
        {form.kind === "wecom" && (
          <>
            <label>
              <span>{t("settings.notificationWeComChatId")}</span>
              <input name="notification-recipient-wecom-chat-id" className="search-input" value={form.wecomChatId} onChange={(event) => setForm((current) => ({ ...current, wecomChatId: event.target.value }))} />
            </label>
            {senderAccountsForKind("wecom").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultWeComSender")}</span>
                <select name="notification-recipient-wecom-sender" className="search-input" value={form.wecomSenderAccountId} onChange={(event) => setForm((current) => ({ ...current, wecomSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("wecom").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("wecom").length === 1 ? t("settings.notificationWeComSenderAuto") : t("settings.notificationWeComSenderMissing")}</span>
            )}
          </>
        )}
        {form.kind === "qq" && (
          <>
            <label>
              <span>{t("settings.notificationQQChatId")}</span>
              <input name="notification-recipient-qq-chat-id" className="search-input" value={form.qqChatId} onChange={(event) => setForm((current) => ({ ...current, qqChatId: event.target.value }))} />
            </label>
            {senderAccountsForKind("qq").length > 0 ? (
              <label>
                <span>{t("settings.notificationDefaultQQSender")}</span>
                <select name="notification-recipient-qq-sender" className="search-input" value={form.qqSenderAccountId} onChange={(event) => setForm((current) => ({ ...current, qqSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationChooseSender")}</option>
                  {senderAccountsForKind("qq").map((account) => <option key={account.id} value={account.id}>{senderLabel(account)}</option>)}
                </select>
              </label>
            ) : (
              <span className="subtle">{senderAccountsForKind("qq").length === 1 ? t("settings.notificationQQSenderAuto") : t("settings.notificationQQSenderMissing")}</span>
            )}
          </>
        )}
        <div className="settings-actions">
          <button className="ghost-button" type="submit" disabled={busy === "notification-recipient"}><IconText icon={editingRecipientId ? Save : Plus}>{editingRecipientId ? t("action.saveChanges") : t("settings.notificationAddRecipient")}</IconText></button>
          <button className="ghost-button" type="button" onClick={onClose}>{t("action.cancel")}</button>
        </div>
      </form>
    </div>
  );
}
