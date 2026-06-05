import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { SessionSummary, WebhookRouteSummary } from "@codex-web/protocol";

type WebhookRoutesDeps = {
  appData: { sessions: SessionSummary[] };
  db: Database.Database;
  dispatchMessageToSession: (target: SessionSummary, content: string) => unknown;
  listWebhookAgentSummaries: (limit?: number) => unknown[];
  listWebhookRoomSummaries: (limit?: number) => unknown[];
  listWebhookRoutes: () => WebhookRouteSummary[];
  listWebhookSessionSummaries: (limit?: number) => unknown[];
  normalizeWebhookRouteSecret: (value: string) => string;
  parsePageLimit: (value: string | undefined, fallback: number) => number;
  parseWebhookPayload: (request: Request, rawBody: Buffer) => Record<string, unknown>;
  slugifyWebhookRouteName: (value: string) => string;
  upsertWebhookRoute: (route: {
    id: string;
    routeKey: string;
    name: string;
    enabled: boolean;
    secret: string;
    sessionId: string | null;
    promptTemplate: string;
    createdAt: string;
    updatedAt: string;
  }) => void;
  validateWebhookToken: (secret: string, request: Request) => boolean;
  webhookRouteFromRow: (row: Record<string, unknown>) => WebhookRouteSummary;
  webhookSecretIsSafe: (value: string) => boolean;
};

export function registerWebhookRoutes(app: Hono, deps: WebhookRoutesDeps) {
  app.get("/api/webhook-routes", (c) => c.json(deps.listWebhookRoutes()));

  app.post("/api/webhook-routes", async (c) => {
    const body = await c.req.json<{ name?: unknown; enabled?: unknown; secret?: unknown; commandTemplate?: unknown; promptTemplate?: unknown; routeKey?: unknown }>().catch(() => null);
    const name = String(body?.name ?? "").trim();
    if (!name) return c.json({ error: "invalid_webhook_route" }, 400);
    const now = new Date().toISOString();
    const id = `webhook-route-${randomUUID()}`;
    const routeKeyBase = deps.slugifyWebhookRouteName(String(body?.routeKey ?? name));
    const routeKey = `${routeKeyBase}-${randomUUID().slice(0, 8)}`;
    const secret = deps.normalizeWebhookRouteSecret(String(body?.secret ?? ""));
    if (!deps.webhookSecretIsSafe(secret)) return c.json({ error: "webhook_insecure_secret_requires_loopback" }, 400);
    const commandTemplate = String(body?.commandTemplate ?? body?.promptTemplate ?? "").trim() || "Webhook event from {{routeName}} ({{eventType}})\n\n{{body}}";
    deps.upsertWebhookRoute({
      id,
      routeKey,
      name,
      enabled: body?.enabled === false ? false : true,
      secret,
      sessionId: null,
      promptTemplate: commandTemplate,
      createdAt: now,
      updatedAt: now,
    });
    return c.json(deps.webhookRouteFromRow(deps.db.prepare("select * from webhook_routes where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/webhook-routes/:id", async (c) => {
    const current = deps.db.prepare("select * from webhook_routes where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "webhook_route_not_found" }, 404);
    const body = await c.req.json<{ name?: unknown; enabled?: unknown; secret?: unknown; commandTemplate?: unknown; promptTemplate?: unknown }>().catch(() => null);
    if (!body) return c.json({ error: "invalid_webhook_route" }, 400);
    const now = new Date().toISOString();
    const secret = String(body.secret ?? "").trim() ? deps.normalizeWebhookRouteSecret(String(body.secret ?? "")) : String(current.secret ?? "");
    if (!deps.webhookSecretIsSafe(secret)) return c.json({ error: "webhook_insecure_secret_requires_loopback" }, 400);
    deps.upsertWebhookRoute({
      id: String(current.id),
      routeKey: String(current.route_key),
      name: String(body.name ?? current.name).trim() || String(current.name),
      enabled: body.enabled === undefined ? Boolean(current.enabled) : body.enabled !== false,
      secret,
      sessionId: current.session_id ? String(current.session_id) : null,
      promptTemplate: String(body.commandTemplate ?? body.promptTemplate ?? current.prompt_template ?? "").trim() || "Webhook event from {{routeName}} ({{eventType}})\n\n{{body}}",
      createdAt: String(current.created_at),
      updatedAt: now,
    });
    return c.json(deps.webhookRouteFromRow(deps.db.prepare("select * from webhook_routes where id = ?").get(c.req.param("id")) as Record<string, unknown>));
  });

  app.delete("/api/webhook-routes/:id", (c) => {
    const result = deps.db.prepare("delete from webhook_routes where id = ?").run(c.req.param("id"));
    if (!result.changes) return c.json({ error: "webhook_route_not_found" }, 404);
    return c.json({ ok: true });
  });

  async function handleWebhookCommandRoute(c: any) {
    const route = deps.db.prepare("select * from webhook_routes where route_key = ?").get(c.req.param("routeKey")) as Record<string, unknown> | undefined;
    if (!route) return c.json({ error: "webhook_route_not_found" }, 404);
    if (!Boolean(route.enabled)) return c.json({ error: "webhook_route_disabled" }, 403);

    let rawBody = Buffer.from("");
    try {
      const body = await c.req.raw.clone().arrayBuffer();
      rawBody = Buffer.from(body);
    } catch {
      return c.json({ error: "webhook_bad_request" }, 400);
    }
    if (rawBody.byteLength > 1_048_576) return c.json({ error: "webhook_payload_too_large" }, 413);

    const secret = String(route.secret ?? "");
    if (!deps.validateWebhookToken(secret, c.req.raw)) {
      return c.json({ error: "invalid_signature" }, 401);
    }

    const payload = deps.parseWebhookPayload(c.req.raw, rawBody);
    const command = String(c.req.query("command") ?? payload.command ?? payload.action ?? "").trim().toLowerCase();
    const payloadSessionId = String(payload.sessionId ?? payload.session_id ?? payload.targetSessionId ?? "").trim();
    const payloadSessionTarget = String(payload.target ?? payload.session ?? payload.bind ?? "").trim();
    const payloadMessage = String(payload.message ?? payload.content ?? payload.text ?? "").trim();
    const sessionId = String(c.req.query("sessionId") ?? payloadSessionId ?? payloadSessionTarget).trim();
    const message = String(c.req.query("message") ?? payloadMessage).trim();
    const routeSummary = deps.webhookRouteFromRow(deps.db.prepare("select * from webhook_routes where id = ?").get(String(route.id)) as Record<string, unknown>);
    const routeSessionId = String(route.session_id ?? "").trim();
    const boundSession = routeSessionId ? deps.appData.sessions.find((item) => item.id === routeSessionId) ?? null : null;

    if (!command || command === "help") {
      return c.json({
        ok: true,
        command: "help",
        route: routeSummary,
        commands: [
          { command: "help", usage: `GET /api/webhook/${routeSummary.routeKey}?command=help`, description: "Show command list and usage." },
          { command: "sessions", usage: `GET /api/webhook/${routeSummary.routeKey}?command=sessions`, description: "List recent sessions." },
          { command: "agents", usage: `GET /api/webhook/${routeSummary.routeKey}?command=agents`, description: "List recent agents." },
          { command: "rooms", usage: `GET /api/webhook/${routeSummary.routeKey}?command=rooms`, description: "List recent rooms." },
          { command: "bind", usage: `POST /api/webhook/${routeSummary.routeKey}?command=bind&sessionId=<sessionId>`, description: "Bind this route to an existing session." },
          { command: "unbind", usage: `POST /api/webhook/${routeSummary.routeKey}?command=unbind`, description: "Clear the bound session." },
          { command: "send", usage: `POST /api/webhook/${routeSummary.routeKey}?command=send&sessionId=<sessionId>&message=<message>`, description: "Send a message to an existing session." },
        ],
      });
    }

    if (command === "sessions") {
      return c.json({ ok: true, command: "sessions", route: routeSummary, sessions: deps.listWebhookSessionSummaries(deps.parsePageLimit(c.req.query("limit"), 20)) });
    }

    if (command === "agents") {
      return c.json({ ok: true, command: "agents", route: routeSummary, agents: deps.listWebhookAgentSummaries(deps.parsePageLimit(c.req.query("limit"), 20)) });
    }

    if (command === "rooms") {
      return c.json({ ok: true, command: "rooms", route: routeSummary, rooms: deps.listWebhookRoomSummaries(deps.parsePageLimit(c.req.query("limit"), 20)) });
    }

    if (command === "bind") {
      if (!sessionId) {
        return c.json({
          ok: false,
          command: "bind",
          error: "webhook_session_id_required",
          route: routeSummary,
          boundSession,
          sessions: deps.listWebhookSessionSummaries(deps.parsePageLimit(c.req.query("limit"), 20)),
        }, 400);
      }
      const targetSession = deps.appData.sessions.find((item) => item.id === sessionId) ?? null;
      if (!targetSession) return c.json({ error: "session_not_found" }, 404);
      deps.db.prepare("update webhook_routes set session_id = ?, updated_at = ? where id = ?").run(targetSession.id, new Date().toISOString(), String(route.id));
      return c.json({
        ok: true,
        command: "bind",
        route: deps.webhookRouteFromRow(deps.db.prepare("select * from webhook_routes where id = ?").get(String(route.id)) as Record<string, unknown>),
        boundSession: {
          id: targetSession.id,
          title: targetSession.title,
          status: targetSession.status,
          conversationType: targetSession.conversationType,
          roomId: targetSession.roomId ?? null,
          projectId: targetSession.projectId ?? null,
          updatedAt: targetSession.updatedAt,
        },
      });
    }

    if (command === "unbind") {
      deps.db.prepare("update webhook_routes set session_id = null, updated_at = ? where id = ?").run(new Date().toISOString(), String(route.id));
      return c.json({
        ok: true,
        command: "unbind",
        route: deps.webhookRouteFromRow(deps.db.prepare("select * from webhook_routes where id = ?").get(String(route.id)) as Record<string, unknown>),
      });
    }

    if (command === "send") {
      const targetSessionId = sessionId || routeSessionId;
      if (!targetSessionId) {
        return c.json({
          error: "webhook_session_id_required",
          route: routeSummary,
          boundSession,
          sessions: deps.listWebhookSessionSummaries(deps.parsePageLimit(c.req.query("limit"), 20)),
        }, 400);
      }
      if (!message) return c.json({ error: "webhook_message_required" }, 400);
      const targetSession = deps.appData.sessions.find((item) => item.id === targetSessionId) ?? null;
      if (!targetSession) return c.json({ error: "session_not_found" }, 404);
      const result = deps.dispatchMessageToSession(targetSession, message);
      return c.json({ ok: true, command: "send", route: routeSummary, sessionId: targetSession.id, dispatch: result }, 202);
    }

    return c.json({ error: "unsupported_webhook_command", allowedCommands: ["help", "sessions", "agents", "rooms", "bind", "unbind", "send"] }, 400);
  }

  app.all("/api/webhook/:routeKey", handleWebhookCommandRoute);
  app.all("/webhooks/:routeKey", handleWebhookCommandRoute);
}
