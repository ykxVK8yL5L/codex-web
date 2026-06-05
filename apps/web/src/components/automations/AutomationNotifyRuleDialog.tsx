import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AutomationSummary,
  NotificationEventType,
  NotificationEphemeralRuleSummary,
  NotificationRecipientSummary,
  NotificationRuleTarget,
  NotificationSettingsResponse,
} from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";

type Props = {
  open: boolean;
  automation: AutomationSummary | null;
  sessionToken: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
};

function eventTypeOptions(t: TFunction) {
  return [
    { id: "task_completed" as const, label: t("session.notifyEventCompleted") },
    { id: "task_failed" as const, label: t("session.notifyEventFailed") },
    { id: "task_interrupted" as const, label: t("session.notifyEventInterrupted") },
    { id: "needs_approval" as const, label: t("session.notifyEventApproval") },
  ];
}

function senderAccountsForRecipient(settings: NotificationSettingsResponse | null, recipient?: NotificationRecipientSummary | null) {
  if (!settings || !recipient) return [];
  if (recipient.kind === "email") return settings.accounts.filter((account) => account.enabled && account.channelKind === "email");
  if (recipient.kind === "telegram") return settings.accounts.filter((account) => account.enabled && account.channelKind === "telegram");
  if (recipient.kind === "weixin") return settings.accounts.filter((account) => account.enabled && account.channelKind === "weixin");
  if (recipient.kind === "dingtalk") return settings.accounts.filter((account) => account.enabled && account.channelKind === "dingtalk");
  if (recipient.kind === "feishu") return settings.accounts.filter((account) => account.enabled && account.channelKind === "feishu");
  if (recipient.kind === "wecom") return settings.accounts.filter((account) => account.enabled && account.channelKind === "wecom");
  if (recipient.kind === "qq") return settings.accounts.filter((account) => account.enabled && account.channelKind === "qq");
  return [];
}

function recipientKindLabel(t: TFunction, kind: NotificationRecipientSummary["kind"]) {
  if (kind === "email") return t("settings.notificationKindEmail");
  if (kind === "telegram") return t("settings.notificationKindTelegram");
  if (kind === "weixin") return t("settings.notificationKindWeixin");
  if (kind === "dingtalk") return t("settings.notificationKindDingTalk");
  if (kind === "feishu") return t("settings.notificationKindFeishu");
  if (kind === "wecom") return t("settings.notificationKindWeCom");
  if (kind === "qq") return t("settings.notificationKindQQ");
  if (kind === "bark") return t("settings.notificationKindBark");
  return t("settings.notificationKindWebhook");
}

function defaultSenderAccountId(settings: NotificationSettingsResponse | null, recipient?: NotificationRecipientSummary | null) {
  if (!recipient) return "";
  return recipient.senderAccountId ?? senderAccountsForRecipient(settings, recipient)[0]?.id ?? "";
}

export function AutomationNotifyRuleDialog({ open, automation, sessionToken, t, notify, onClose, onCreated }: Props) {
  const [settings, setSettings] = useState<NotificationSettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<NotificationEventType[]>(["task_completed", "task_failed"]);

  const recipients = useMemo(() => settings?.recipients.filter((recipient) => recipient.enabled) ?? [], [settings]);
  const existingRule = useMemo(() =>
    settings?.ephemeralRules.find((rule: NotificationEphemeralRuleSummary) => rule.scopeType === "automation" && rule.scopeId === automation?.id) ?? null,
  [automation?.id, settings]);
  const availableRecipientKinds = useMemo(() => Array.from(new Set(recipients.map((recipient) => recipient.kind))), [recipients]);
  const groupedRecipients = useMemo(() => availableRecipientKinds.map((kind) => ({
    kind,
    items: recipients.filter((recipient) => recipient.kind === kind),
  })), [availableRecipientKinds, recipients]);
  const selectedRecipientCount = selectedRecipientIds.length;

  useEffect(() => {
    if (!open || !automation) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/notifications", { headers: { authorization: `Bearer ${sessionToken}` } });
        if (!response.ok) return;
        const nextSettings = (await response.json()) as NotificationSettingsResponse;
        if (!active) return;
        setSettings(nextSettings);
        const firstRecipient = nextSettings.recipients.find((recipient) => recipient.enabled);
        if (firstRecipient) {
          setSelectedRecipientIds([firstRecipient.id]);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [automation, open, sessionToken]);

  useEffect(() => {
    if (!open) return;
    if (existingRule) {
      setSelectedEventTypes(existingRule.eventTypes);
      setSelectedRecipientIds(existingRule.targets.map((target) => target.recipientId).filter((value): value is string => Boolean(value)));
      return;
    }
    setSelectedEventTypes(["task_completed", "task_failed"]);
    setSelectedRecipientIds([]);
  }, [existingRule, open]);

  if (!open || !automation) return null;

  function toggleEventType(type: NotificationEventType) {
    setSelectedEventTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    if (!automation) return;
    if (!selectedRecipientIds.length || !selectedEventTypes.length) return;
    const targets: NotificationRuleTarget[] = selectedRecipientIds.map((recipientId) => {
      const recipient = settings?.recipients.find((item) => item.id === recipientId) ?? null;
      return {
        recipientId,
        senderAccountId: defaultSenderAccountId(settings, recipient) || undefined,
      };
    });
    const response = await fetch(existingRule ? `/api/notifications/ephemeral-rules/${existingRule.id}` : "/api/notifications/ephemeral-rules", {
      method: existingRule ? "PATCH" : "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        scopeType: "automation",
        scopeId: automation.id,
        eventTypes: selectedEventTypes,
        targets,
        expireMode: "manual",
        enabled: true,
      }),
    });
    if (!response.ok) {
      notify(t("automation.notifyRuleCreateFailed"), "error");
      return;
    }
    notify(t("automation.notifyRuleCreated"), "success");
    await onCreated?.();
    onClose();
  }

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={onClose} />
      <form className="dialog-card notify-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-notify-builder-title" onSubmit={createRule}>
        <div className="dialog-head">
          <div>
            <strong id="automation-notify-builder-title">{t("automation.notifyTitle")}</strong>
            <p>{t("automation.notifyHelp")}</p>
          </div>
          <button className="drawer-close" type="button" onClick={onClose} title={t("action.close")}><span aria-hidden="true">×</span></button>
        </div>
        <div className="notify-builder-summary">
          <div className="notify-builder-badge">
            <strong>{t("settings.notificationEvents")}</strong>
            <span>{selectedEventTypes.length}</span>
          </div>
          <div className="notify-builder-badge">
            <strong>{t("settings.notificationRecipientName")}</strong>
            <span>{selectedRecipientCount}</span>
          </div>
          <div className="notify-builder-badge">
            <strong>{t("settings.notificationRecipientKind")}</strong>
            <span>{groupedRecipients.length}</span>
          </div>
        </div>
        <div className="notify-builder-grid">
          <section className="notify-builder-section">
            <div className="notify-builder-section-head">
              <strong>{t("settings.notificationEvents")}</strong>
              <span className="subtle">{selectedEventTypes.length}</span>
            </div>
            <div className="settings-checklist notify-builder-list">
              {eventTypeOptions(t).map((item) => (
                <label className="checkbox-row notify-builder-option" key={item.id}>
                  <input type="checkbox" checked={selectedEventTypes.includes(item.id)} onChange={() => toggleEventType(item.id)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </section>
          <section className="notify-builder-section">
            <div className="notify-builder-section-head">
              <strong>{t("settings.notificationRecipientName")}</strong>
              <span className="subtle">{selectedRecipientCount}</span>
            </div>
            <div className="notify-builder-groups">
              {groupedRecipients.map((group) => (
                <div className="notify-builder-group" key={group.kind}>
                <div className="notify-builder-group-head">
                    <strong>{recipientKindLabel(t, group.kind)}</strong>
                    <span>{group.items.length}</span>
                  </div>
                  <div className="settings-checklist notify-builder-list">
                    {group.items.map((recipient) => (
                      <label className="checkbox-row notify-builder-option" key={recipient.id}>
                        <input
                          type="checkbox"
                          checked={selectedRecipientIds.includes(recipient.id)}
                          onChange={() => {
                            setSelectedRecipientIds((current) => current.includes(recipient.id)
                              ? current.filter((item) => item !== recipient.id)
                              : [...current, recipient.id]);
                          }}
                        />
                        <span>{recipient.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <span className="subtle notify-builder-footer">{t("automation.notifySelectedRecipients").replace("{count}", String(selectedRecipientCount))}</span>
        <div className="dialog-actions">
          <button className="ghost-button" type="button" onClick={onClose}>{t("action.cancel")}</button>
          <button className="dark-button" type="submit" disabled={!selectedRecipientIds.length || !selectedEventTypes.length}>{t("action.create")}</button>
        </div>
      </form>
    </div>
  );
}
