import React from "react";
import { PanelLeftOpen, RefreshCw } from "lucide-react";
import { IconText } from "@/components/IconText";

export const NotificationCenterContext = React.createContext<React.ReactNode>(null);

function MobileMainToggle({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button className="mobile-main-toggle" type="button" onClick={onClick} aria-label={label} title={label}>
      <PanelLeftOpen size={17} />
    </button>
  );
}

export function PageHeader({
  crumb,
  title,
  action,
  onAction,
  onOpenMainNav,
  menuLabel,
}: {
  crumb: string;
  title: string;
  action?: string;
  onAction?: () => void;
  onOpenMainNav?: () => void;
  menuLabel?: string;
}) {
  const notificationCenter = React.useContext(NotificationCenterContext);
  return (
    <header className="page-header">
      <div className="header-title-row">
        <MobileMainToggle label={menuLabel ?? title} onClick={onOpenMainNav} />
        <div>
          <div className="crumb">{crumb}</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="header-actions page-header-actions">
        {notificationCenter}
        {action && <button className="dark-button icon-only" title={action} aria-label={action} onClick={onAction}><IconText icon={RefreshCw}>{action}</IconText></button>}
      </div>
    </header>
  );
}
