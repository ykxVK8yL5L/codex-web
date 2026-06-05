import type Database from "better-sqlite3";
import type { Hono } from "hono";
import type { AppNotificationsResponse, AppNotificationStreamEvent } from "@codex-web/protocol";

type AppNotificationRoutesDeps = {
  db: Database.Database;
  getBearerToken: (value: string | undefined) => string | null;
  listAppNotifications: (limit?: number) => AppNotificationsResponse;
  parsePageLimit: (value: string | undefined, fallback: number) => number;
  publishAppNotificationEvent: (event: AppNotificationStreamEvent) => void;
  publishAppNotificationsSnapshot: () => void;
  subscribeAppNotifications: (listener: (event: AppNotificationStreamEvent) => void) => () => void;
  verifySessionToken: (token: string | null) => boolean;
};

export function registerAppNotificationStreamRoute(app: Hono, deps: AppNotificationRoutesDeps) {
  app.get("/api/app-notifications/events", (c) => {
    const token = c.req.query("token") ?? deps.getBearerToken(c.req.header("authorization"));
    if (!deps.verifySessionToken(token)) return c.text("unauthorized", 401);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: AppNotificationStreamEvent) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        send({ type: "snapshot", ...deps.listAppNotifications(30) });
        const unsubscribe = deps.subscribeAppNotifications(send);
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
          } catch {
            clearInterval(heartbeat);
            unsubscribe();
          }
        }, 15_000);
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            return;
          }
        });
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });
}

export function registerAppNotificationRoutes(app: Hono, deps: AppNotificationRoutesDeps) {
  app.get("/api/app-notifications", (c) => c.json(deps.listAppNotifications(deps.parsePageLimit(c.req.query("limit"), 30))));

  app.patch("/api/app-notifications/read", async (c) => {
    const body = await c.req.json<{ ids?: string[]; all?: boolean }>().catch((): { ids?: string[]; all?: boolean } => ({}));
    const now = new Date().toISOString();
    if (body?.all) {
      deps.db.prepare("update app_notifications set read_at = coalesce(read_at, ?) where read_at is null").run(now);
    } else {
      const ids = Array.isArray(body?.ids) ? body.ids.map((id: string) => String(id)).filter(Boolean).slice(0, 100) : [];
      const update = deps.db.prepare("update app_notifications set read_at = coalesce(read_at, ?) where id = ?");
      for (const id of ids) update.run(now, id);
    }
    const next = deps.listAppNotifications(30);
    deps.publishAppNotificationEvent({ type: "snapshot", ...next });
    return c.json(next);
  });

  app.delete("/api/app-notifications", (c) => {
    const result = deps.db.prepare("delete from app_notifications").run();
    deps.publishAppNotificationsSnapshot();
    return c.json({ ok: true, deleted: result.changes });
  });
}
