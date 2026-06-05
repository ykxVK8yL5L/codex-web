import { useState } from "react";
import { Info, X } from "lucide-react";
import { IconText } from "@/components/IconText";
import type { TFunction } from "@/features/sessions/utils";

type ActivityItem = { id?: string; kind: "command" | "file" | "tool"; label: string; detail?: string; status?: string; at: string };

function readableActivityStatus(status: string | undefined, kind: string, t: TFunction) {
  if (status === "in_progress") return t("session.activityInProgress");
  if (status === "completed") return t("session.activityCompleted");
  if (status === "failed") return t("session.activityFailed");
  return status || kind;
}

export function ActivityPanel({ items, hasMore, onLoadMore, t }: { items: ActivityItem[]; hasMore?: boolean; onLoadMore?: () => void; t: TFunction }) {
  const [detailItem, setDetailItem] = useState<ActivityItem | null>(null);

  return (
    <section className="activity-panel">
      <div className="activity-head">
        <strong>{t("session.activityTitle")}</strong>
        <span>{t("session.recentPrefix")} {items.length} {t("session.queueUnit")}</span>
      </div>
      {items.map((item) => (
        <div className={`activity-item ${item.kind}`} key={`${item.at}-${item.label}-${item.detail ?? ""}`}>
          <span className="activity-dot" />
          <div title={[item.label, item.detail].filter(Boolean).join("\n")}>
            <strong>{item.label}</strong>
            {item.detail && <code>{item.detail}</code>}
          </div>
          <button className="ghost-button icon-only activity-detail-button" type="button" title={t("session.activityDetails")} aria-label={t("session.activityDetails")} onClick={() => setDetailItem(item)}>
            <IconText icon={Info}>{t("session.activityDetails")}</IconText>
          </button>
          <em>{readableActivityStatus(item.status, item.kind, t)}</em>
        </div>
      ))}
      {hasMore && <button className="ghost-button load-more" type="button" onClick={onLoadMore}>{t("session.loadMore")}</button>}
      {detailItem && (
        <div className="dialog-layer activity-detail-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setDetailItem(null)} />
          <div className="dialog-card activity-detail-card" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title">
            <div className="dialog-head">
              <div>
                <strong id="activity-detail-title">{t("session.activityDetails")}</strong>
                <p>{readableActivityStatus(detailItem.status, detailItem.kind, t)}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setDetailItem(null)} title={t("action.close")} aria-label={t("action.close")}>
                <X size={16} />
              </button>
            </div>
            <div className="activity-detail-content">
              <label>
                <span>{t("session.activityLabel")}</span>
                <pre>{detailItem.label}</pre>
              </label>
              {detailItem.detail && (
                <label>
                  <span>{t("session.activityDetail")}</span>
                  <pre>{detailItem.detail}</pre>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
