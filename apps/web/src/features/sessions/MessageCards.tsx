import { useState } from "react";
import { Globe, Info, Trash2 } from "lucide-react";
import type { MessageCardSummary, PreviewSummary } from "@codex-web/protocol";
import { IconText } from "@/components/IconText";
import { openPreviewUrl } from "@/lib/previews";
import type { TFunction } from "@/features/sessions/utils";

type ToastTone = "info" | "success" | "error";

export function MessageCards({ items, sessionToken, t, notify, onDelete }: { items: MessageCardSummary[]; sessionToken: string; t: TFunction; notify: (message: string, tone?: ToastTone) => void; onDelete: (cardId: string) => void }) {
  const [openPayloadId, setOpenPayloadId] = useState<string | null>(null);
  return (
    <section className="message-cards">
      {items.map((item) => {
        const preview = item.type === "preview" ? item.payload as PreviewSummary : null;
        const payload = (item.payload && typeof item.payload === "object" ? item.payload : {}) as Record<string, unknown>;
        const hasPayload = Object.keys(payload).length > 0;
        const payloadOpen = openPayloadId === item.id;
        const detail = preview
          ? `${preview.status} · ${preview.access} · ${preview.port}`
          : [item.type, payload.status, payload.risk, payload.reason].filter(Boolean).join(" · ");
        const href = preview?.url || (typeof payload.url === "string" ? payload.url : null);
        return (
          <article className="message-card" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>{detail}</span>
              {hasPayload && payloadOpen && <code className="message-card-json">{JSON.stringify(payload, null, 2)}</code>}
            </div>
            <div className="message-card-actions">
              {preview ? (
                <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, notify, t)}>
                  <IconText icon={Globe}>{t("project.preview")}</IconText>
                </button>
              ) : href && (
                <a className="ghost-button" href={href} target="_blank" rel="noreferrer">
                  <IconText icon={Globe}>{t("action.open")}</IconText>
                </a>
              )}
              {hasPayload && (
                <button className="ghost-button icon-only" type="button" onClick={() => setOpenPayloadId((current) => current === item.id ? null : item.id)} title={t("action.details")} aria-label={t("action.details")}>
                  <Info size={16} />
                </button>
              )}
              <button className="ghost-button icon-only danger-button" type="button" onClick={() => onDelete(item.id)} title={t("action.delete")} aria-label={t("action.delete")}>
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
