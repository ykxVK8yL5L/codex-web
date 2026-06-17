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

export function parsePreviewProxyPaths(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n|,/)
    .map((item) => normalizePreviewProxyPath(item))
    .filter((item): item is string => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function formatPreviewProxyPaths(paths?: string[]) {
  return (paths ?? []).join("\n");
}

function normalizePreviewProxyPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return "";
  const path = `/${trimmed.replace(/^\/+/, "")}`.replace(/\/+$/g, "");
  return path.length > 1 ? path : "";
}
