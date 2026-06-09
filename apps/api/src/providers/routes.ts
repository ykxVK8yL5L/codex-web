import type Database from "better-sqlite3";
import type { Hono } from "hono";
import type {
  CreateProviderRequest,
  ProviderCapabilities,
  ProviderDetectionResponse,
  ProviderHealthCheck,
  ProviderModelsResponse,
  ProviderSummary,
  ProviderTestResponse,
  UpdateProviderRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows, parsePageLimit } from "../pagination.js";

type ProviderRecord = ProviderSummary & { apiKey?: string };

type ProviderRoutesDeps = {
  appData: { providers: ProviderRecord[] };
  clearProviderModelCache: (providerId: string) => void;
  db: Database.Database;
  detectProviderInterface: (provider: ProviderRecord) => Promise<ProviderDetectionResponse>;
  discoverProviderModels: (provider: ProviderRecord) => Promise<ProviderModelsResponse>;
  emitExternalNotification: (event: {
    eventType: "provider_check_failed";
    severity: "warning" | "error";
    title: string;
    message: string;
    sourceType: "provider";
    sourceId: string;
    metadata: Record<string, unknown>;
  }) => void;
  mergeProviderCapabilities: (kind: ProviderSummary["kind"], value?: Partial<ProviderCapabilities>) => ProviderCapabilities;
  providerHealthCheckFromRow: (row: Record<string, unknown>) => ProviderHealthCheck;
  publicProvider: (provider: ProviderRecord) => ProviderSummary;
  readProviderModelCache: (provider: ProviderRecord) => (ProviderModelsResponse & { cachedAt: string }) | null;
  recordProviderHealthCheck: (providerId: string, kind: ProviderHealthCheck["kind"], result: ProviderTestResponse | ProviderModelsResponse) => void;
  sanitizeProviderRpmLimit: (value: unknown) => number | null;
  saveAppData: () => void;
  saveProviderModelCache: (provider: ProviderRecord, result: ProviderModelsResponse) => void;
  slugify: (value: string) => string;
  testProvider: (provider: ProviderRecord) => Promise<ProviderTestResponse>;
};

export function registerProviderRoutes(app: Hono, deps: ProviderRoutesDeps) {
  app.get("/api/providers", (c) => c.json(deps.appData.providers.map(deps.publicProvider)));

  app.post("/api/providers/detect", async (c) => {
    const body = await c.req.json<CreateProviderRequest>().catch(() => null);
    if (!body?.defaultModel || !body.kind) return c.json({ error: "invalid_provider_draft" }, 400);
    const provider: ProviderRecord = {
      id: "draft",
      name: body.name?.trim() || "Draft Provider",
      kind: body.kind,
      defaultModel: body.defaultModel.trim(),
      baseUrl: body.baseUrl?.trim() || undefined,
      apiKey: body.apiKey?.trim() || undefined,
      capabilities: deps.mergeProviderCapabilities(body.kind, body.capabilities),
      rpmLimit: deps.sanitizeProviderRpmLimit(body.rpmLimit),
      rpmLimitEnabled: body.rpmLimitEnabled === true,
      useProxy: body.kind === "openai-responses" && body.useProxy === true,
    };
    return c.json(await deps.detectProviderInterface(provider));
  });

  app.post("/api/providers/models", async (c) => {
    const body = await c.req.json<CreateProviderRequest>().catch(() => null);
    if (!body?.kind) return c.json({ error: "invalid_provider_draft" }, 400);
    const provider: ProviderRecord = {
      id: "draft",
      name: body.name || "Draft Provider",
      kind: body.kind,
      defaultModel: body.defaultModel || "",
      baseUrl: body.baseUrl?.trim() || undefined,
      apiKey: body.apiKey?.trim() || undefined,
      rpmLimit: deps.sanitizeProviderRpmLimit(body.rpmLimit),
      rpmLimitEnabled: body.rpmLimitEnabled === true,
      useProxy: body.kind === "openai-responses" && body.useProxy === true,
    };
    return c.json(await deps.discoverProviderModels(provider));
  });

  app.post("/api/providers", async (c) => {
    const body = await c.req.json<CreateProviderRequest>().catch(() => null);
    if (!body?.name || !body.defaultModel || !body.kind) return c.json({ error: "invalid_provider" }, 400);
    if (body.kind === "openai-compatible-chat" && !body.baseUrl?.trim()) return c.json({ error: "base_url_required" }, 400);
    if (body.kind !== "local" && !body.apiKey?.trim()) return c.json({ error: "api_key_required" }, 400);
    const provider: ProviderRecord = {
      id: deps.slugify(body.name),
      name: body.name,
      kind: body.kind,
      defaultModel: body.defaultModel,
      baseUrl: body.baseUrl?.trim() || undefined,
      apiKey: body.apiKey?.trim() || undefined,
      capabilities: deps.mergeProviderCapabilities(body.kind, body.capabilities),
      rpmLimit: deps.sanitizeProviderRpmLimit(body.rpmLimit),
      rpmLimitEnabled: body.rpmLimitEnabled === true,
      useProxy: body.kind === "openai-responses" && body.useProxy === true,
    };
    deps.appData.providers.unshift(provider);
    deps.saveAppData();
    try {
      const models = await deps.discoverProviderModels(provider);
      deps.recordProviderHealthCheck(provider.id, "models", models);
      deps.saveProviderModelCache(provider, models);
    } catch {
      // Model discovery is a best-effort cache warm-up; provider creation must still succeed.
    }
    return c.json(deps.publicProvider(provider), 201);
  });

  app.post("/api/providers/:id/test", async (c) => {
    const provider = deps.appData.providers.find((item) => item.id === c.req.param("id"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    const result = await deps.testProvider(provider);
    deps.recordProviderHealthCheck(provider.id, "test", result);
    if (!result.ok) {
      deps.emitExternalNotification({
        eventType: "provider_check_failed",
        severity: result.status === 429 ? "warning" : "error",
        title: `Provider 测试失败：${provider.name}`,
        message: [result.status ? `HTTP ${result.status}` : null, result.error].filter(Boolean).join(" · ") || "Provider 连接测试失败。",
        sourceType: "provider",
        sourceId: provider.id,
        metadata: { status: result.status, error: result.error, durationMs: result.durationMs },
      });
    }
    return c.json(result);
  });

  app.post("/api/providers/:id/detect", async (c) => {
    const provider = deps.appData.providers.find((item) => item.id === c.req.param("id"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    const applyDetection = c.req.query("apply") === "1" || c.req.query("apply") === "true";
    const result = await deps.detectProviderInterface(provider);
    deps.recordProviderHealthCheck(provider.id, "test", {
      ok: result.ok,
      providerId: provider.id,
      status: result.checks.responses.ok ? result.checks.responses.status : result.checks.chatCompletions.status,
      durationMs: result.durationMs,
      error: result.error,
    });
    if (result.ok && applyDetection) {
      provider.kind = result.kind;
      provider.capabilities = result.capabilities;
      deps.clearProviderModelCache(provider.id);
      deps.saveAppData();
    }
    return c.json({ provider: deps.publicProvider(provider), detection: result });
  });

  app.get("/api/providers/:id/models", async (c) => {
    const provider = deps.appData.providers.find((item) => item.id === c.req.param("id"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    const forceRefresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
    const cached = forceRefresh ? null : deps.readProviderModelCache(provider);
    if (cached) return c.json(cached);
    const result = await deps.discoverProviderModels(provider);
    deps.recordProviderHealthCheck(provider.id, "models", result);
    deps.saveProviderModelCache(provider, result);
    return c.json(result);
  });

  app.get("/api/providers/:id/health", (c) => {
    const provider = deps.appData.providers.find((item) => item.id === c.req.param("id"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    const limit = parsePageLimit(c.req.query("limit"), 20);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const rows = deps.db.prepare(`
      select id, provider_id, kind, ok, status, duration_ms, error, checked_at
      from provider_health_checks
      where provider_id = @providerId
        ${cursor ? "and (checked_at < @cursorSort or (checked_at = @cursorSort and id < @cursorId))" : ""}
      order by checked_at desc, id desc
      limit @limit
    `).all({ providerId: provider.id, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
    return c.json(pageFromRows(rows.map(deps.providerHealthCheckFromRow), limit, (item) => item.checkedAt));
  });

  app.delete("/api/providers/:id/health", (c) => {
    const provider = deps.appData.providers.find((item) => item.id === c.req.param("id"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    const deleted = deps.db.prepare("delete from provider_health_checks where provider_id = ?").run(provider.id).changes;
    return c.json({ ok: true, id: provider.id, deleted });
  });

  app.patch("/api/providers/:id", async (c) => {
    const provider = deps.appData.providers.find((item) => item.id === c.req.param("id"));
    if (!provider) return c.json({ error: "provider_not_found" }, 404);
    const body = await c.req.json<UpdateProviderRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_provider_update" }, 400);
    if (body.name !== undefined) provider.name = body.name;
    if (body.kind !== undefined) provider.kind = body.kind;
    if (body.defaultModel !== undefined) provider.defaultModel = body.defaultModel;
    if (body.baseUrl !== undefined) provider.baseUrl = body.baseUrl.trim() || undefined;
    if (body.apiKey !== undefined) provider.apiKey = body.apiKey.trim() || undefined;
    if (body.capabilities !== undefined || body.kind !== undefined) provider.capabilities = deps.mergeProviderCapabilities(provider.kind, body.capabilities ?? provider.capabilities);
    if (body.rpmLimit !== undefined) provider.rpmLimit = deps.sanitizeProviderRpmLimit(body.rpmLimit);
    if (body.rpmLimitEnabled !== undefined) provider.rpmLimitEnabled = body.rpmLimitEnabled === true;
    if (body.useProxy !== undefined || body.kind !== undefined) provider.useProxy = provider.kind === "openai-responses" && body.useProxy === true;
    if (body.kind !== undefined || body.defaultModel !== undefined || body.baseUrl !== undefined || body.apiKey !== undefined) deps.clearProviderModelCache(provider.id);
    deps.saveAppData();
    return c.json(deps.publicProvider(provider));
  });

  app.delete("/api/providers/:id", (c) => {
    const index = deps.appData.providers.findIndex((item) => item.id === c.req.param("id"));
    if (index === -1) return c.json({ error: "provider_not_found" }, 404);
    const [provider] = deps.appData.providers.splice(index, 1);
    deps.db.prepare("delete from providers where id = ?").run(provider.id);
    deps.db.prepare("delete from provider_health_checks where provider_id = ?").run(provider.id);
    deps.clearProviderModelCache(provider.id);
    return c.json({ ok: true, id: provider.id });
  });
}
