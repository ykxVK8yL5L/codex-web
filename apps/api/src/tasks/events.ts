import type { QueuedMessage, SessionMessage, SessionSummary } from "@codex-web/protocol";

export type TaskEvent =
  | { type: "started"; session: SessionSummary }
  | { type: "output"; bytes: number; at: string }
  | { type: "activity"; id?: string; kind: "command" | "file" | "tool"; label: string; detail?: string; status?: string; at: string }
  | { type: "workspace"; session: SessionSummary; reason: "activity" | "done" | "revert"; at: string }
  | { type: "message"; message: SessionMessage; session: SessionSummary }
  | { type: "queue"; queue: QueuedMessage[]; session: SessionSummary }
  | { type: "done"; session: SessionSummary; exitCode: number | null }
  | { type: "error"; session: SessionSummary; error: string };

type TaskEventBusDeps = {
  recordTaskActivity: (sessionId: string, activity: Extract<TaskEvent, { type: "activity" }>) => void;
};

export function createTaskEventBus(deps: TaskEventBusDeps) {
  const subscribers = new Map<string, Set<(event: TaskEvent) => void>>();

  function publishTaskEvent(sessionId: string, event: TaskEvent) {
    if (event.type === "activity") deps.recordTaskActivity(sessionId, event);
    for (const subscriber of subscribers.get(sessionId) ?? []) subscriber(event);
  }

  function subscribeTaskEvents(sessionId: string, subscriber: (event: TaskEvent) => void) {
    const current = subscribers.get(sessionId) ?? new Set<(event: TaskEvent) => void>();
    current.add(subscriber);
    subscribers.set(sessionId, current);
    return () => {
      current.delete(subscriber);
      if (!current.size) subscribers.delete(sessionId);
    };
  }

  return { publishTaskEvent, subscribeTaskEvents };
}
