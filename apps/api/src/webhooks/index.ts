import { randomBytes, randomUUID } from "node:crypto";
import type { SessionSummary, WebhookRouteSummary } from "@codex-web/protocol";

type WebhookServiceDeps = Record<string, any>;

export function createWebhookService(deps: WebhookServiceDeps) {
  const { appData, db, host, listAgents, listRooms } = deps;

function listWebhookSessionSummaries(limit = 20) {
  return appData.sessions.slice(0, limit).map((session: SessionSummary) => ({
    id: session.id,
    title: session.title,
    status: session.status,
    conversationType: session.conversationType,
    roomId: session.roomId ?? null,
    projectId: session.projectId ?? null,
    updatedAt: session.updatedAt,
  }));
}

function listWebhookAgentSummaries(limit = 20) {
  return listAgents(limit).items.map((agent: any) => ({
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    roleId: agent.roleId,
    model: agent.model ?? null,
    workspaceMode: agent.workspaceMode,
    projectAccessMode: agent.projectAccessMode,
    updatedAt: agent.updatedAt,
  }));
}

function listWebhookRoomSummaries(limit = 20) {
  return listRooms(undefined, limit).items.map((room: any) => ({
    id: room.id,
    name: room.name,
    status: room.status,
    sessionId: room.sessionId ?? null,
    groupId: room.groupId ?? null,
    circleId: room.circleId ?? null,
    updatedAt: room.updatedAt,
  }));
}

function slugifyWebhookRouteName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "webhook";
}

function webhookSecretIsSafe(secret: string) {
  return secret !== "INSECURE_NO_AUTH" || host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function normalizeWebhookRouteSecret(secret?: string | null) {
  const value = String(secret ?? "").trim();
  if (value) return value;
  return `whsec_${randomBytes(18).toString("base64url")}`;
}

function webhookRouteFromRow(row: Record<string, unknown>): WebhookRouteSummary {
  const sessionId = row.session_id ? String(row.session_id) : null;
  const session = sessionId ? appData.sessions.find((item: SessionSummary) => item.id === sessionId) ?? null : null;
  const routeKey = String(row.route_key);
  const secret = String(row.secret ?? "");
  const publicBaseUrl = host.startsWith("0.0.0.0") || host === "127.0.0.1" || host === "::1"
    ? "http://localhost:5173"
    : `http://${host}:5173`;
  return {
    id: String(row.id),
    routeKey,
    name: String(row.name),
    enabled: Boolean(row.enabled),
    secret,
    curlExample: `curl "${publicBaseUrl}/api/webhook/${routeKey}?command=sessions" -H "X-Webhook-Token: ${secret}"`,
    sessionId,
    sessionTitle: session?.title ?? null,
    commandTemplate: String(row.prompt_template ?? ""),
    promptTemplate: String(row.prompt_template ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function listWebhookRoutes() {
  return (db.prepare("select * from webhook_routes order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map(webhookRouteFromRow);
}

function upsertWebhookRoute(route: {
  id: string;
  routeKey: string;
  name: string;
  enabled: boolean;
  secret: string;
  sessionId?: string | null;
  promptTemplate: string;
  createdAt: string;
  updatedAt: string;
}) {
  db.prepare(`
    insert into webhook_routes (id, route_key, name, enabled, secret, session_id, prompt_template, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      route_key = excluded.route_key,
      name = excluded.name,
      enabled = excluded.enabled,
      secret = excluded.secret,
      session_id = excluded.session_id,
      prompt_template = excluded.prompt_template,
      updated_at = excluded.updated_at
  `).run(
    route.id,
    route.routeKey,
    route.name,
    route.enabled ? 1 : 0,
    route.secret,
    route.sessionId ?? null,
    route.promptTemplate,
    route.createdAt,
    route.updatedAt,
  );
}


  return {
    listWebhookAgentSummaries,
    listWebhookRoomSummaries,
    listWebhookRoutes,
    listWebhookSessionSummaries,
    normalizeWebhookRouteSecret,
    slugifyWebhookRouteName,
    upsertWebhookRoute,
    webhookRouteFromRow,
    webhookSecretIsSafe,
  };
}
