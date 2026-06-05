import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import type { AppNotificationSummary } from "@codex-web/protocol";
import { Switch } from "@/components/ui/switch";
import { formatShortDate } from "@/lib/format";
import type { TFunction } from "@/features/sessions/utils";

export function NotificationCenter({
  items,
  unreadCount,
  open,
  permission,
  browserNotificationsEnabled,
  t,
  onToggle,
  onClose,
  onMarkRead,
  onClear,
  onRequestBrowser,
  onBrowserNotificationsEnabledChange,
  onOpenSession,
}: {
  items: AppNotificationSummary[];
  unreadCount: number;
  open: boolean;
  permission: NotificationPermission;
  browserNotificationsEnabled: boolean;
  t: TFunction;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (ids?: string[]) => void;
  onClear: () => void;
  onRequestBrowser: () => void;
  onBrowserNotificationsEnabledChange: (enabled: boolean) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);
  return (
    <div className="notification-center" ref={rootRef}>
      <button className="notification-center-trigger" type="button" aria-label={t("notificationCenter.title")} title={t("notificationCenter.title")} onClick={onToggle}>
        <Bell size={17} />
        {unreadCount > 0 && <span className="notification-dot">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-center-panel">
          <div className="notification-center-head">
            <div>
              <strong>{t("notificationCenter.title")}</strong>
              <span>{unreadCount > 0 ? t("notificationCenter.unread").replace("{count}", String(unreadCount)) : t("notificationCenter.allRead")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => onMarkRead()}>{t("notificationCenter.markAllRead")}</button>
          </div>
          <div className="notification-center-actions">
            <label className="notification-browser-toggle">
              <span>{t("notificationCenter.browserToggle")}</span>
              <Switch checked={browserNotificationsEnabled} onCheckedChange={onBrowserNotificationsEnabledChange} />
            </label>
            {browserNotificationsEnabled && permission !== "granted" && <button className="ghost-button" type="button" onClick={onRequestBrowser}>{t("notificationCenter.enableBrowser")}</button>}
            <button className="ghost-button danger-button" type="button" disabled={!items.length} onClick={onClear}>{t("notificationCenter.clear")}</button>
          </div>
          <div className="notification-center-list">
            {items.map((item) => {
              const canOpenSession = item.sourceType === "session" && Boolean(item.sourceId);
              return (
                <button
                  className={`notification-center-item ${item.readAt ? "" : "unread"}`}
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onMarkRead([item.id]);
                    if (canOpenSession) onOpenSession(String(item.sourceId));
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                  <small>{item.eventType} · {item.severity} · {formatShortDate(item.createdAt)}</small>
                </button>
              );
            })}
            {!items.length && <div className="empty-state">{t("notificationCenter.empty")}</div>}
          </div>
        </section>
      )}
    </div>
  );
}
