import React from "react";
import { Menu, PanelLeftOpen } from "lucide-react";
import { NotificationCenterContext } from "@/components/PageHeader";
import { Bubble } from "@/features/sessions/Bubble";
import type { TFunction } from "@/features/sessions/utils";

export function MobileMainToggle({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button className="mobile-main-toggle" type="button" onClick={onClick} aria-label={label} title={label}>
      <PanelLeftOpen size={17} />
    </button>
  );
}

export function MobileSessionToggle({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button className="mobile-session-toggle" type="button" onClick={onClick}>
      <Menu size={16} />
      <span>{label}</span>
    </button>
  );
}

export function SessionLoadingPage({ t, onOpenMainNav, onOpenSessionNav }: { t: TFunction; onOpenMainNav?: () => void; onOpenSessionNav?: () => void }) {
  const notificationCenter = React.useContext(NotificationCenterContext);
  return (
    <main className="conversation">
      <header className="task-header page-header">
        <div className="header-title-row">
          <MobileMainToggle label={t("nav.sessions")} onClick={onOpenMainNav} />
          <div>
            <div className="crumb">{t("page.sessionLoadingCrumb")}</div>
            <h1>{t("session.loadingTitle")}</h1>
            <div className="task-path">{t("session.loadingHint")}</div>
          </div>
        </div>
        {notificationCenter && <div className="header-actions session-actions">{notificationCenter}</div>}
      </header>
      <div className="mobile-session-bar">
        <MobileSessionToggle label={t("session.sessionList")} onClick={onOpenSessionNav} />
      </div>
      <section className="timeline">
        <Bubble who="C" text={t("session.loadingBubble")} t={t} />
      </section>
    </main>
  );
}
