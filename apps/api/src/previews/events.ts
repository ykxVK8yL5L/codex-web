import type { PreviewSummary } from "@codex-web/protocol";

export type PreviewLogEvent =
  | { type: "snapshot"; preview: PreviewSummary; logs: string }
  | { type: "log"; previewId: string; chunk: string; at: string }
  | { type: "status"; preview: PreviewSummary };

export function createPreviewLogEventBus() {
  const subscribers = new Map<string, Set<(event: PreviewLogEvent) => void>>();

  function publishPreviewLogEvent(previewId: string, event: PreviewLogEvent) {
    for (const subscriber of subscribers.get(previewId) ?? []) subscriber(event);
  }

  function subscribePreviewLogEvents(previewId: string, subscriber: (event: PreviewLogEvent) => void) {
    const current = subscribers.get(previewId) ?? new Set<(event: PreviewLogEvent) => void>();
    current.add(subscriber);
    subscribers.set(previewId, current);
    return () => {
      current.delete(subscriber);
      if (!current.size) subscribers.delete(previewId);
    };
  }

  return { publishPreviewLogEvent, subscribePreviewLogEvents };
}
