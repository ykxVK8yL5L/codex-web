import type { PreviewSummary } from "@codex-web/protocol";
import type { TranslationKey } from "./i18n";

type ToastTone = "info" | "success" | "error";
type TFunction = (key: TranslationKey) => string;

export async function openPreviewUrl(preview: PreviewSummary, sessionToken: string, notify?: (message: string, tone?: ToastTone) => void, t?: TFunction) {
  let url = preview.url;
  if (preview.access === "private") {
    const response = await fetch(`/api/previews/${preview.id}/access`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify?.(t?.("preview.accessFailed") ?? "Preview access failed", "error");
      return;
    }
    const result = await response.json().catch(() => null) as { url?: string } | null;
    url = result?.url ?? url;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
