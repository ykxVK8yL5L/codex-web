import type { Hono } from "hono";
import type { QueuedMessage, SessionMessage, SessionSummary } from "@codex-web/protocol";

type TaskEvent =
  | { type: "started"; session: SessionSummary }
  | { type: "output"; bytes: number; at: string }
  | { type: "activity"; id?: string; kind: "command" | "file" | "tool"; label: string; detail?: string; status?: string; at: string }
  | { type: "workspace"; session: SessionSummary; reason: "activity" | "done" | "revert"; at: string }
  | { type: "message"; message: SessionMessage; session: SessionSummary }
  | { type: "queue"; queue: QueuedMessage[]; session: SessionSummary }
  | { type: "done"; session: SessionSummary; exitCode: number | null }
  | { type: "error"; session: SessionSummary; error: string };

type RoomStreamEvent =
  | { type: "snapshot"; [key: string]: unknown }
  | { type: "activity"; [key: string]: unknown }
  | { type: "ping" };

type ServerRoutesDeps = {
  allSessionMessages: (sessionId: string) => SessionMessage[];
  appData: { providers: any[]; sessions: SessionSummary[] };
  appNotificationRouteDeps: unknown;
  authRouteDeps: unknown;
  createPreviewAccessRequest: (preview: any, sourceUrl: URL) => Record<string, unknown>;
  decrementProviderProxyConcurrency: (providerId: string) => void;
  expirePreviewAccessRequests: () => void;
  getBearerToken: (authorization?: string) => string | null;
  getPreviews: () => Map<string, any>;
  getPreviewAccessRequest: (preview: any, requestId: string, secret: string | null) => any;
  getPreviewRouteDeps: () => unknown;
  getProviderProxyConcurrency: (providerId: string) => number;
  getRateLimitSettings: () => { enabled: boolean; providerProxyMaxConcurrent: number };
  getSubscribeTaskEvents: () => (sessionId: string, send: (event: TaskEvent | { type: "snapshot"; session: SessionSummary; messages: SessionMessage[]; queue: QueuedMessage[]; exitCode: number | null }) => void) => () => void;
  incrementProviderProxyConcurrency: (providerId: string) => void;
  listQueuedMessages: (sessionId: string) => QueuedMessage[];
  previewAccessCookie: (preview: any, ttlMs: number) => string;
  previewFromReferer: (referer?: string) => any;
  previewUpstreamPathFromUrl: (sourceUrl: URL, preview: any) => string;
  previewUrl: (preview: any) => string;
  privatePreviewAccessResponse: (preview: any, sourceUrl: URL) => Response;
  proxyPreviewHttpRequest: (preview: any, upstreamPath: string, sourceUrl: URL, request: Request) => Promise<Response>;
  proxyResponsesToChatCompletions: (provider: any, body: Record<string, unknown>) => Promise<Response>;
  proxyResponsesToResponses: (provider: any, body: Record<string, unknown>) => Promise<Response>;
  readCodexOutput: (sessionId: string) => { exitCode: number | null };
  registerAppNotificationStreamRoute: (app: Hono, deps: any) => void;
  registerPreviewLogStreamRoute: (app: Hono, deps: any) => void;
  registerPublicAuthRoutes: (app: Hono, deps: any) => void;
  requestHasPreviewAccess: (preview: any, request: Request) => boolean;
  roomActivitySnapshot: (roomId: string) => Record<string, unknown> | null;
  subscribeRoomEvents: (roomId: string, send: (event: RoomStreamEvent) => void) => () => void;
  verifyProviderProxyToken: (provider: any, token: string) => boolean;
  verifySessionToken: (token: string | null) => boolean;
};

export function registerServerRoutes(app: Hono, deps: ServerRoutesDeps) {
  const {
    allSessionMessages,
    appData,
    appNotificationRouteDeps,
    authRouteDeps,
    createPreviewAccessRequest,
    decrementProviderProxyConcurrency,
    expirePreviewAccessRequests,
    getBearerToken,
    getPreviewAccessRequest,
    getProviderProxyConcurrency,
    incrementProviderProxyConcurrency,
    listQueuedMessages,
    previewAccessCookie,
    previewFromReferer,
    previewUpstreamPathFromUrl,
    previewUrl,
    privatePreviewAccessResponse,
    proxyPreviewHttpRequest,
    proxyResponsesToChatCompletions,
    proxyResponsesToResponses,
    readCodexOutput,
    registerAppNotificationStreamRoute,
    registerPreviewLogStreamRoute,
    registerPublicAuthRoutes,
    requestHasPreviewAccess,
    roomActivitySnapshot,
    subscribeRoomEvents,
    verifyProviderProxyToken,
    verifySessionToken,
  } = deps;
  const previews = deps.getPreviews();
  const previewRouteDeps = deps.getPreviewRouteDeps();
  const rateLimitSettings = deps.getRateLimitSettings();
  const subscribeTaskEvents = deps.getSubscribeTaskEvents();
  app.post("/preview/:id/:token/access-requests", (c) => {
    const preview = previews.get(c.req.param("id"));
    if (!preview || c.req.param("token") !== preview.token) return c.json({ error: "preview_not_found" }, 404);
    if (preview.access !== "private") return c.json({ error: "preview_is_public" }, 400);
    const request = createPreviewAccessRequest(preview, new URL(c.req.url));
    return c.json({ status: "pending", ...request }, 202);
  });
  
  app.get("/preview/:id/:token/access-requests/:requestId", (c) => {
    expirePreviewAccessRequests();
    const preview = previews.get(c.req.param("id"));
    if (!preview || c.req.param("token") !== preview.token) return c.json({ error: "preview_not_found" }, 404);
    const request = getPreviewAccessRequest(preview, c.req.param("requestId"), c.req.query("secret") ?? null);
    if (!request) return c.json({ error: "access_request_not_found" }, 404);
    if (request.status === "approved") {
      const approvedUntil = request.approvedUntil ? new Date(request.approvedUntil).getTime() : Date.now() + 15 * 60 * 1000;
      const ttlMs = Math.max(1, approvedUntil - Date.now());
      c.header("set-cookie", previewAccessCookie(preview, ttlMs));
    }
    return c.json({ status: request.status, approvedUntil: request.approvedUntil ?? null, url: previewUrl(preview) });
  });
  
  app.get("/preview/:id/:token/*", async (c) => {
    const preview = previews.get(c.req.param("id"));
    if (!preview || c.req.param("token") !== preview.token) return c.text("preview not found", 404);
    const sourceUrl = new URL(c.req.url);
    if (!requestHasPreviewAccess(preview, c.req.raw)) return privatePreviewAccessResponse(preview, sourceUrl);
    const upstreamPath = previewUpstreamPathFromUrl(sourceUrl, preview);
    return proxyPreviewHttpRequest(preview, upstreamPath, sourceUrl, c.req.raw);
  });
  
  app.all("*", async (c, next) => {
    const sourceUrl = new URL(c.req.url);
    const path = sourceUrl.pathname;
    if (path === "/health" || path.startsWith("/preview/")) return next();
    const preview = previewFromReferer(c.req.header("referer"));
    if (!preview) return next();
    if (!requestHasPreviewAccess(preview, c.req.raw)) return c.req.method === "GET" || c.req.method === "HEAD"
      ? privatePreviewAccessResponse(preview, sourceUrl)
      : c.text("private preview requires Codex Web access", 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return proxyPreviewHttpRequest(preview, path.replace(/^\/+/, ""), sourceUrl, c.req.raw);
    }
    return c.redirect(`${previewUrl(preview)}${path.replace(/^\/+/, "")}${sourceUrl.search}`, 307);
  });
  
  app.get("/health", (c) => c.json({ ok: true }));
  registerPublicAuthRoutes(app, authRouteDeps);
  app.post("/provider-proxy/:providerId/:proxyToken/v1/responses", async (c) => {
    const provider = appData.providers.find((item) => item.id === c.req.param("providerId"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    if (provider.kind !== "openai-compatible-chat" && !(provider.kind === "openai-responses" && provider.useProxy)) return c.json({ error: "provider_proxy_not_enabled" }, 400);
    if (!verifyProviderProxyToken(provider, c.req.param("proxyToken"))) return c.json({ error: "unauthorized" }, 401);
    const concurrent = getProviderProxyConcurrency(provider.id);
    if (rateLimitSettings.enabled && concurrent >= rateLimitSettings.providerProxyMaxConcurrent) return c.json({ error: "provider_proxy_busy", retryAfter: 5 }, 429, { "retry-after": "5" });
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "invalid_responses_request" }, 400);
    incrementProviderProxyConcurrency(provider.id);
    try {
      return await (provider.kind === "openai-compatible-chat"
        ? proxyResponsesToChatCompletions(provider, body)
        : proxyResponsesToResponses(provider, body));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "provider_proxy_failed" }, 502);
    } finally {
      decrementProviderProxyConcurrency(provider.id);
    }
  });
  app.get("/api/codex/tasks/:id/events", (c) => {
    const token = c.req.query("token") ?? getBearerToken(c.req.header("authorization"));
    if (!verifySessionToken(token)) return c.text("unauthorized", 401);
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.text("task_not_found", 404);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: TaskEvent | { type: "snapshot"; session: SessionSummary; messages: SessionMessage[]; queue: QueuedMessage[]; exitCode: number | null }) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        const output = readCodexOutput(session.id);
        send({ type: "snapshot", session, messages: allSessionMessages(session.id), queue: listQueuedMessages(session.id), exitCode: output.exitCode });
        const unsubscribe = subscribeTaskEvents(session.id, send);
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
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
  
  registerPreviewLogStreamRoute(app, previewRouteDeps);
  
  app.get("/api/rooms/:id/events/stream", (c) => {
    const token = c.req.query("token") ?? getBearerToken(c.req.header("authorization"));
    if (!verifySessionToken(token)) return c.text("unauthorized", 401);
    const roomId = c.req.param("id");
    const snapshot = roomActivitySnapshot(roomId);
    if (!snapshot) return c.text("room_not_found", 404);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: RoomStreamEvent) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        send({ type: "snapshot", ...snapshot });
        const unsubscribe = subscribeRoomEvents(roomId, send);
        const heartbeat = setInterval(() => {
          try {
            send({ type: "ping" });
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
  
  registerAppNotificationStreamRoute(app, appNotificationRouteDeps);
}
