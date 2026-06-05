import QRCode from "qrcode";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { NotificationAccountSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export type WeixinQrLoginResponse = {
  qrKey?: string;
  status: string;
  qrcode?: string;
  qrcodeUrl?: string;
  baseUrl?: string;
  currentBaseUrl?: string;
  redirectHost?: string | null;
  accountIdValue?: string;
  token?: string;
  userId?: string;
  error?: string;
  updatedAt?: string;
};

export type WeixinNotificationAccountForm = {
  channelKind: NotificationAccountSummary["channelKind"];
  weixinBotToken: string;
  weixinBaseUrl: string;
  weixinAccountId: string;
  weixinUserId: string;
  weixinCreateRecipient: boolean;
  weixinInboundEnabled: boolean;
  weixinAllowedChatIds: string;
  weixinAllowedUserIds: string;
  weixinDefaultSessionId: string;
  weixinTestChatId: string;
};

type Props = {
  accountId: string;
  form: WeixinNotificationAccountForm;
  setForm: Dispatch<SetStateAction<any>>;
  sessionToken: string;
  t: TFunction;
  loadNotifications: () => Promise<void>;
  showCreateRecipient?: boolean;
};

export function WeixinNotificationAccountPanel({
  accountId,
  form,
  setForm,
  sessionToken,
  t,
  loadNotifications,
  showCreateRecipient = false,
}: Props) {
  const pollingRef = useRef<number | null>(null);
  const [draftQrKey, setDraftQrKey] = useState("");
  const [qrState, setQrState] = useState({
    loading: false,
    status: "",
    qrcode: "",
    qrcodeUrl: "",
    error: "",
    accountId: "",
    currentBaseUrl: "",
    redirectHost: "",
    token: "",
    userId: "",
    baseUrl: "",
    updatedAt: "",
  });
  const [qrImage, setQrImage] = useState("");

  useEffect(() => () => {
    if (pollingRef.current !== null) window.clearInterval(pollingRef.current);
  }, []);

  function stopPolling() {
    if (pollingRef.current !== null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function applyQrState(state: WeixinQrLoginResponse) {
    setQrState({
      loading: false,
      status: state.status,
      qrcode: state.qrcode ?? "",
      qrcodeUrl: state.qrcodeUrl ?? "",
      error: state.error ?? "",
      accountId: state.accountIdValue ?? "",
      currentBaseUrl: state.currentBaseUrl ?? "",
      redirectHost: state.redirectHost ?? "",
      token: state.token ?? "",
      userId: state.userId ?? "",
      baseUrl: state.baseUrl ?? "",
      updatedAt: state.updatedAt ?? "",
    });
    if (state.qrcodeUrl || state.qrcode) {
      void QRCode.toDataURL(state.qrcodeUrl || state.qrcode || "", { margin: 1, errorCorrectionLevel: "M" })
        .then((dataUrl) => setQrImage(dataUrl))
        .catch(() => setQrImage(""));
    } else {
      setQrImage("");
    }
    if (state.token || state.baseUrl || state.accountIdValue || state.userId) {
      setForm((current: any) => current.channelKind === "weixin" ? {
        ...current,
        weixinBotToken: state.token ?? current.weixinBotToken,
        weixinBaseUrl: state.baseUrl ?? current.weixinBaseUrl,
        weixinAccountId: state.accountIdValue ?? current.weixinAccountId,
        weixinUserId: state.userId ?? current.weixinUserId,
        weixinAllowedUserIds: state.userId ?? current.weixinAllowedUserIds,
        weixinTestChatId: state.userId ?? current.weixinTestChatId,
      } : current);
    }
  }

  async function pollQrState(qrKey: string, isDraft: boolean) {
    const response = await fetch(isDraft ? `/api/notifications/weixin/qr/status?qrKey=${encodeURIComponent(qrKey)}` : `/api/notifications/accounts/${accountId}/weixin/qr/status`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await response.json().catch(() => null) as WeixinQrLoginResponse | { error?: string } | null;
    if (!response.ok || !result || !("status" in result) || typeof result.status !== "string") {
      const error = String(result && "error" in result ? result.error ?? "" : "");
      setQrState((current) => ({ ...current, loading: false, error: error || t("settings.notificationWeixinQrFailed") }));
      stopPolling();
      return;
    }
    applyQrState(result as WeixinQrLoginResponse);
    if (result.status === "confirmed") {
      await loadNotifications();
      stopPolling();
    } else if (result.status === "error") {
      stopPolling();
    }
  }

  async function startQrLogin() {
    stopPolling();
    setQrState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const isDraft = !accountId;
      const response = await fetch(isDraft ? "/api/notifications/weixin/qr/start" : `/api/notifications/accounts/${accountId}/weixin/qr/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ botType: "3" }),
      });
      const result = await response.json().catch(() => null) as WeixinQrLoginResponse | { error?: string } | null;
      if (!response.ok || !result || !("status" in result) || typeof result.status !== "string") {
        setQrState((current) => ({ ...current, loading: false, error: String(result && "error" in result ? result.error ?? "" : "") || t("settings.notificationWeixinQrFailed") }));
        return;
      }
      if (isDraft && result.qrKey) setDraftQrKey(result.qrKey);
      applyQrState(result as WeixinQrLoginResponse);
      const qrKey = result.qrKey ?? (isDraft ? draftQrKey : accountId);
      pollingRef.current = window.setInterval(() => {
        void pollQrState(qrKey, isDraft);
      }, 1500);
    } catch {
      setQrState((current) => ({ ...current, loading: false, error: t("settings.notificationWeixinQrFailed") }));
    }
  }

  return (
    <>
      <label className="dialog-checkbox">
        <input name="notification-weixin-inbound-enabled" type="checkbox" checked={form.weixinInboundEnabled} onChange={(event) => setForm((current: any) => ({ ...current, weixinInboundEnabled: event.target.checked }))} />
        <span>{t("settings.notificationWeixinInboundEnabled")}</span>
      </label>
      <div className="settings-actions" style={{ marginTop: 0 }}>
        <button className="ghost-button" type="button" disabled={qrState.loading} onClick={() => void startQrLogin()}>
          <IconText icon={RefreshCw}>{t("settings.notificationWeixinQrLogin")}</IconText>
        </button>
        <span className="subtle">{accountId ? t("settings.notificationWeixinQrPrompt") : "扫码后再保存这个新账号。"}</span>
      </div>
      {qrState.status && (
        <div className="environment-item" style={{ alignItems: "flex-start" }}>
          <div className="environment-item-main">
            <div className="environment-item-head">
              <strong>{t("settings.notificationWeixinQrStatus")}</strong>
              <span className={`pill ${qrState.status === "confirmed" ? "" : "warm"}`}>{qrState.status}</span>
            </div>
            {qrState.error && <span className="result-error">{qrState.error}</span>}
            {qrImage && <img alt={t("settings.notificationWeixinQrStatus")} src={qrImage} style={{ width: 220, maxWidth: "100%", borderRadius: 8, marginTop: 8 }} />}
            <div className="detail-tags" style={{ marginTop: 8 }}>
              {qrState.accountId && <span className="pill">{qrState.accountId}</span>}
              {qrState.userId && <span className="pill">{qrState.userId}</span>}
              {qrState.baseUrl && <span className="pill">{qrState.baseUrl}</span>}
            </div>
          </div>
        </div>
      )}
      <details className="settings-collapsible">
        <summary>
          <span>{t("settings.notificationWeixinAdvanced")}</span>
          <ChevronDown className="settings-collapsible-chevron" size={16} />
        </summary>
        <div className="settings-collapsible-body">
          <span className="subtle">{t("settings.notificationWeixinAdvancedHelp")}</span>
          <label>
            <span>{t("settings.notificationWeixinBotToken")}</span>
            <input name="notification-weixin-bot-token" className="search-input" type="password" value={form.weixinBotToken} onChange={(event) => setForm((current: any) => ({ ...current, weixinBotToken: event.target.value }))} />
          </label>
          <label>
            <span>{t("settings.notificationWeixinBaseUrl")}</span>
            <input name="notification-weixin-base-url" className="search-input" value={form.weixinBaseUrl} onChange={(event) => setForm((current: any) => ({ ...current, weixinBaseUrl: event.target.value }))} placeholder="https://ilinkai.weixin.qq.com" />
          </label>
          <label>
            <span>{t("settings.notificationWeixinAccountId")}</span>
            <input name="notification-weixin-account-id" className="search-input" value={form.weixinAccountId} onChange={(event) => setForm((current: any) => ({ ...current, weixinAccountId: event.target.value }))} placeholder="ilink_bot_id" />
          </label>
          <label>
            <span>{t("settings.notificationWeixinUserId")}</span>
            <input name="notification-weixin-user-id" className="search-input" value={form.weixinUserId} onChange={(event) => setForm((current: any) => ({ ...current, weixinUserId: event.target.value }))} placeholder="ilink_user_id" />
          </label>
          <label>
            <span>{t("settings.notificationWeixinAllowedChatIds")}</span>
            <input name="notification-weixin-allowed-chat-ids" className="search-input" value={form.weixinAllowedChatIds} onChange={(event) => setForm((current: any) => ({ ...current, weixinAllowedChatIds: event.target.value }))} placeholder="wxid_xxx,room_xxx" />
          </label>
          <label>
            <span>{t("settings.notificationWeixinAllowedUserIds")}</span>
            <input name="notification-weixin-allowed-user-ids" className="search-input" value={form.weixinAllowedUserIds} onChange={(event) => setForm((current: any) => ({ ...current, weixinAllowedUserIds: event.target.value }))} placeholder="wxid_xxx" />
          </label>
          <label>
            <span>{t("settings.notificationWeixinDefaultSessionId")}</span>
            <input name="notification-weixin-default-session-id" className="search-input" value={form.weixinDefaultSessionId} onChange={(event) => setForm((current: any) => ({ ...current, weixinDefaultSessionId: event.target.value }))} placeholder="task-..." />
          </label>
          {showCreateRecipient && (
            <label className="checkbox-row">
              <input name="notification-weixin-create-recipient" type="checkbox" checked={form.weixinCreateRecipient} onChange={(event) => setForm((current: any) => ({ ...current, weixinCreateRecipient: event.target.checked }))} />
              <span>{t("settings.notificationWeixinCreateRecipient")}</span>
            </label>
          )}
          <label>
            <span>{t("settings.notificationWeixinTestChatId")}</span>
            <input name="notification-weixin-test-chat-id" className="search-input" value={form.weixinTestChatId} onChange={(event) => setForm((current: any) => ({ ...current, weixinTestChatId: event.target.value }))} />
          </label>
        </div>
      </details>
    </>
  );
}
