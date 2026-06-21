import type { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ApprovalRisk,
  ApprovalSummary,
  CreatePreviewRequest,
  PreviewAccess,
  PreviewSummary,
  ProjectSummary,
  SessionSummary,
  UpdatePreviewRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows, parsePageLimit } from "../pagination.js";

type PreviewRecord = Omit<PreviewSummary, "url"> & { token: string };
type PreviewShareSummary = {
  previewId: string;
  status: "starting" | "running" | "stopped" | "error";
  publicUrl?: string;
  gatewayPort?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
type PreviewLogEvent =
  | { type: "snapshot"; preview: PreviewSummary; logs: string }
  | { type: "log"; previewId: string; chunk: string; at: string }
  | { type: "status"; preview: PreviewSummary };
type ApprovalRecord = ApprovalSummary & { payload: unknown };

type PreviewRoutesDeps = {
  appData: { projects: ProjectSummary[]; sessions: SessionSummary[] };
  approvalAlwaysAllowed: (actionType: "preview-command-run", payload: unknown) => boolean;
  createPreviewApproval: (preview: PreviewRecord, risk: ApprovalRisk) => ApprovalRecord;
  deletePreview: (previewId: string) => void;
  getBearerToken: (authorization?: string) => string | null;
  insertPreview: (preview: PreviewRecord) => void;
  normalizePreviewProxyPaths: (value: unknown) => string[];
  previewAccess: (value: unknown, fallback?: PreviewAccess) => PreviewAccess;
  previewAccessCookie: (preview: PreviewRecord, ttlMs?: number) => string;
  previewCommandRisk: (preview: PreviewRecord) => ApprovalRisk | null;
  previewLogs: Map<string, string>;
  previews: Map<string, PreviewRecord>;
  previewUrl: (preview: PreviewRecord) => string;
  previewUsingPort: (preview: Pick<PreviewRecord, "id" | "targetHost" | "port">) => PreviewRecord | null;
  publicApproval: (approval: ApprovalRecord) => ApprovalSummary;
  publicPreview: (preview: PreviewRecord) => PreviewSummary;
  markPreviewRunningIfReachable: (preview: PreviewRecord) => Promise<PreviewRecord | null>;
  startPreviewProcess: (preview: PreviewRecord) => Promise<PreviewRecord>;
  createPreviewShareGrantUrl: (preview: PreviewRecord, returnTo?: string) => string;
  getPreviewShare: (previewId: string) => PreviewShareSummary | null;
  startPreviewShare: (preview: PreviewRecord) => Promise<PreviewShareSummary>;
  stopPreviewShare: (previewId: string) => PreviewShareSummary | null;
  stopPreviewProcess: (previewId: string) => void;
  subscribePreviewLogEvents: (previewId: string, subscriber: (event: PreviewLogEvent) => void) => () => void;
  updatePreview: (preview: PreviewRecord) => void;
  validPreviewHost: (value: string) => boolean;
  verifySessionToken: (token: string | null) => unknown;
};

export function registerPreviewLogStreamRoute(app: Hono, deps: PreviewRoutesDeps) {
  app.get("/api/previews/:id/logs/events", (c) => {
    const token = c.req.query("token") ?? deps.getBearerToken(c.req.header("authorization"));
    if (!deps.verifySessionToken(token)) return c.text("unauthorized", 401);
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.text("preview_not_found", 404);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: PreviewLogEvent) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        send({ type: "snapshot", preview: deps.publicPreview(preview), logs: deps.previewLogs.get(preview.id) ?? "" });
        const unsubscribe = deps.subscribePreviewLogEvents(preview.id, send);
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

export function registerPreviewRoutes(app: Hono, deps: PreviewRoutesDeps) {
  app.get("/api/previews", (c) => {
    const scopeType = c.req.query("scopeType");
    const scopeId = c.req.query("scopeId");
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const status = c.req.query("status");
    const cursor = decodePageCursor(c.req.query("cursor"));
    const items = Array.from(deps.previews.values()).map(deps.publicPreview).filter((preview) => {
      if (scopeType && preview.scopeType !== scopeType) return false;
      if (scopeId && preview.scopeId !== scopeId) return false;
      if (status && preview.status !== status) return false;
      if (q && ![preview.label, preview.scopeType, preview.scopeId, preview.targetHost, String(preview.port), preview.command, preview.cwd, preview.access].some((value) => value?.toLowerCase().includes(q))) return false;
      if (cursor && !(preview.updatedAt < cursor.sortValue || (preview.updatedAt === cursor.sortValue && preview.id < cursor.id))) return false;
      return true;
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    if (!c.req.query("limit") && !c.req.query("cursor") && !q && !status) return c.json(items);
    const limit = parsePageLimit(c.req.query("limit"), 20);
    return c.json(pageFromRows(items.slice(0, limit + 1), limit, (item) => item.updatedAt));
  });

  app.post("/api/previews", async (c) => {
    const body = await c.req.json<CreatePreviewRequest>().catch(() => null);
    if (!body || (body.scopeType !== "project" && body.scopeType !== "session" && body.scopeType !== "folder")) return c.json({ error: "invalid_scope" }, 400);
    if (!body.scopeId?.trim()) return c.json({ error: "invalid_scope" }, 400);
    const folderScopePath = body.scopeType === "folder" ? resolve(body.scopeId) : "";
    const scopeExists = body.scopeType === "project"
      ? deps.appData.projects.some((project) => project.id === body.scopeId)
      : body.scopeType === "folder"
        ? existsSync(folderScopePath) && statSync(folderScopePath).isDirectory()
        : deps.appData.sessions.some((session) => session.id === body.scopeId);
    if (!scopeExists) return c.json({ error: "scope_not_found" }, 404);
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return c.json({ error: "invalid_port" }, 400);
    const targetHost = body.targetHost?.trim() || "127.0.0.1";
    if (!deps.validPreviewHost(targetHost)) return c.json({ error: "invalid_target_host" }, 400);
    const requestedCommand = body.command?.trim() || undefined;
    const requestedCwd = body.cwd?.trim() || undefined;
    const requestedAccess = deps.previewAccess(body.access);
    const requestedProxyPaths = deps.normalizePreviewProxyPaths(body.proxyPaths);
    const existing = Array.from(deps.previews.values()).find((preview) =>
      preview.scopeType === body.scopeType
      && preview.scopeId === body.scopeId
      && preview.targetHost === targetHost
      && preview.port === port
    );
    if (existing) {
      if (requestedCommand && existing.command && existing.command !== requestedCommand) {
        return c.json({ error: "preview_port_in_use", preview: deps.publicPreview(existing) }, 409);
      }
      if (requestedCommand && !existing.command) {
        existing.command = requestedCommand;
        existing.cwd = requestedCwd;
        deps.updatePreview(existing);
      }
      if (existing.access !== requestedAccess) {
        existing.access = requestedAccess;
        deps.updatePreview(existing);
      }
      if (body.proxyPaths !== undefined) {
        existing.proxyPaths = requestedProxyPaths;
        deps.updatePreview(existing);
      }
      if (body.autoStart && existing.command && existing.status !== "running" && existing.status !== "starting") {
        const detected = await deps.markPreviewRunningIfReachable(existing);
        if (detected) return c.json(deps.publicPreview(detected));
        const risk = deps.previewCommandRisk(existing);
        if (risk && !deps.approvalAlwaysAllowed("preview-command-run", { previewId: existing.id, command: existing.command ?? "", cwd: existing.cwd ?? "", targetHost: existing.targetHost, port: existing.port, scopeType: existing.scopeType, scopeId: existing.scopeId })) {
          const approval = deps.createPreviewApproval(existing, risk);
          return c.json({ error: "approval_required", approval: deps.publicApproval(approval), preview: deps.publicPreview(existing) }, 409);
        }
        try {
          const started = await deps.startPreviewProcess(existing);
          return c.json(deps.publicPreview(started));
        } catch {
          existing.status = "error";
          deps.updatePreview(existing);
          return c.json({ error: "preview_start_failed", preview: deps.publicPreview(existing) }, 400);
        }
      }
      return c.json(deps.publicPreview(existing));
    }
    const conflict = deps.previewUsingPort({ id: "", targetHost, port });
    if (conflict) return c.json({ error: "preview_port_in_use", preview: deps.publicPreview(conflict) }, 409);
    const now = new Date().toISOString();
    const preview: PreviewRecord = {
      id: randomUUID(),
      scopeType: body.scopeType,
      scopeId: body.scopeId,
      label: body.label?.trim() || `${body.scopeType}:${body.scopeId}:${port}`,
      targetHost,
      port,
      command: requestedCommand,
      cwd: requestedCwd,
      status: "registered",
      access: requestedAccess,
      proxyPaths: requestedProxyPaths,
      token: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    deps.insertPreview(preview);
    if (body.autoStart && preview.command) {
      const detected = await deps.markPreviewRunningIfReachable(preview);
      if (detected) return c.json(deps.publicPreview(detected), 201);
      const risk = deps.previewCommandRisk(preview);
      if (risk && !deps.approvalAlwaysAllowed("preview-command-run", { previewId: preview.id, command: preview.command ?? "", cwd: preview.cwd ?? "", targetHost: preview.targetHost, port: preview.port, scopeType: preview.scopeType, scopeId: preview.scopeId })) {
        const approval = deps.createPreviewApproval(preview, risk);
        return c.json({ error: "approval_required", approval: deps.publicApproval(approval), preview: deps.publicPreview(preview) }, 409);
      }
      try {
        const started = await deps.startPreviewProcess(preview);
        return c.json(deps.publicPreview(started), 201);
      } catch (error) {
        preview.status = "error";
        deps.updatePreview(preview);
        return c.json({ error: error instanceof Error ? error.message : "preview_start_failed", preview: deps.publicPreview(preview) }, 400);
      }
    }
    return c.json(deps.publicPreview(preview), 201);
  });

  app.post("/api/previews/:id/start", async (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    const detected = await deps.markPreviewRunningIfReachable(preview);
    if (detected) return c.json(deps.publicPreview(detected));
    const risk = deps.previewCommandRisk(preview);
    if (risk && !deps.approvalAlwaysAllowed("preview-command-run", { previewId: preview.id, command: preview.command ?? "", cwd: preview.cwd ?? "", targetHost: preview.targetHost, port: preview.port, scopeType: preview.scopeType, scopeId: preview.scopeId })) {
      const approval = deps.createPreviewApproval(preview, risk);
      return c.json({ error: "approval_required", approval: deps.publicApproval(approval), preview: deps.publicPreview(preview) }, 409);
    }
    try {
      const started = await deps.startPreviewProcess(preview);
      return c.json(deps.publicPreview(started));
    } catch (error) {
      preview.status = "error";
      deps.updatePreview(preview);
      return c.json({ error: error instanceof Error ? error.message : "preview_start_failed", preview: deps.publicPreview(preview) }, 400);
    }
  });

  app.get("/api/previews/:id/share", (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    return c.json(deps.getPreviewShare(preview.id) ?? { previewId: preview.id, status: "stopped" });
  });

  app.post("/api/previews/:id/share/start", async (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    const detected = await deps.markPreviewRunningIfReachable(preview);
    const current = detected ?? preview;
    if (current.status !== "running") return c.json({ error: "preview_not_running" }, 409);
    const share = await deps.startPreviewShare(current);
    return c.json(share, share.status === "error" ? 500 : 200);
  });

  app.post("/api/previews/:id/share/stop", (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    return c.json(deps.stopPreviewShare(preview.id) ?? { previewId: preview.id, status: "stopped" });
  });

  app.post("/api/previews/:id/share/grant", async (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    const body = await c.req.json<{ returnTo?: string }>().catch(() => null);
    try {
      return c.json({ url: deps.createPreviewShareGrantUrl(preview, body?.returnTo) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "preview_share_grant_failed" }, 409);
    }
  });

  app.post("/api/previews/:id/access", (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    if (preview.access === "private") c.header("set-cookie", deps.previewAccessCookie(preview));
    return c.json({ url: deps.previewUrl(preview), preview: deps.publicPreview(preview) });
  });

  app.put("/api/previews/:id/access", async (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    const body = await c.req.json<{ access?: PreviewAccess }>().catch(() => null);
    preview.access = deps.previewAccess(body?.access);
    deps.updatePreview(preview);
    return c.json(deps.publicPreview(preview));
  });

  app.patch("/api/previews/:id", async (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    const body = await c.req.json<UpdatePreviewRequest>().catch(() => null);
    const label = String(body?.label ?? "").trim();
    if (label) preview.label = label;
    if (body?.proxyPaths !== undefined) preview.proxyPaths = deps.normalizePreviewProxyPaths(body.proxyPaths);
    deps.updatePreview(preview);
    return c.json(deps.publicPreview(preview));
  });

  app.get("/api/previews/:id/logs", (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    return c.json({ previewId: preview.id, logs: deps.previewLogs.get(preview.id) ?? "" });
  });

  app.post("/api/previews/:id/stop", (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    deps.stopPreviewShare(preview.id);
    deps.stopPreviewProcess(preview.id);
    preview.status = "stopped";
    deps.updatePreview(preview);
    return c.json(deps.publicPreview(preview));
  });

  app.delete("/api/previews/:id", (c) => {
    const preview = deps.previews.get(c.req.param("id"));
    if (!preview) return c.json({ error: "preview_not_found" }, 404);
    deps.stopPreviewShare(preview.id);
    deps.deletePreview(preview.id);
    return c.json({ ok: true });
  });
}
