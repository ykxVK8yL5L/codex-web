import type Database from "better-sqlite3";
import type { MiddlewareHandler } from "hono";
import type { RateLimitSettings } from "@codex-web/protocol";

type RateBucket = { count: number; resetAt: number };

const rateLimitBuckets = new Map<string, RateBucket>();
const providerProxyConcurrency = new Map<string, number>();

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function defaultRateLimitSettings(): RateLimitSettings {
  return {
    enabled: envBoolean("CODEX_WEB_RATE_LIMIT_ENABLED", true),
    globalPerMinute: envNumber("CODEX_WEB_RATE_LIMIT_GLOBAL_PER_MINUTE", 300),
    authPerMinute: envNumber("CODEX_WEB_RATE_LIMIT_AUTH_PER_MINUTE", 20),
    previewAccessPerMinute: envNumber("CODEX_WEB_RATE_LIMIT_PREVIEW_ACCESS_PER_MINUTE", 10),
    expensivePerFiveMinutes: envNumber("CODEX_WEB_RATE_LIMIT_EXPENSIVE_PER_5_MINUTES", 30),
    providerProxyPerMinute: envNumber("CODEX_WEB_RATE_LIMIT_PROVIDER_PROXY_PER_MINUTE", 60),
    providerProxyPerHour: envNumber("CODEX_WEB_RATE_LIMIT_PROVIDER_PROXY_PER_HOUR", 600),
    providerProxyMaxConcurrent: envNumber("CODEX_WEB_PROVIDER_PROXY_MAX_CONCURRENT", 5),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeRateLimitSettings(value?: Partial<RateLimitSettings>): RateLimitSettings {
  const defaults = defaultRateLimitSettings();
  const numberValue = (input: unknown, fallback: number, min = 1, max = 100_000) => {
    const parsed = Number(input ?? fallback);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
  };
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.enabled,
    globalPerMinute: numberValue(value?.globalPerMinute, defaults.globalPerMinute),
    authPerMinute: numberValue(value?.authPerMinute, defaults.authPerMinute),
    previewAccessPerMinute: numberValue(value?.previewAccessPerMinute, defaults.previewAccessPerMinute),
    expensivePerFiveMinutes: numberValue(value?.expensivePerFiveMinutes, defaults.expensivePerFiveMinutes),
    providerProxyPerMinute: numberValue(value?.providerProxyPerMinute, defaults.providerProxyPerMinute),
    providerProxyPerHour: numberValue(value?.providerProxyPerHour, defaults.providerProxyPerHour),
    providerProxyMaxConcurrent: numberValue(value?.providerProxyMaxConcurrent, defaults.providerProxyMaxConcurrent, 1, 1000),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
  };
}

export function createRateLimitStore(db: Database.Database) {
  return {
    load() {
      const row = db.prepare("select value from app_settings where key = 'rate_limit'").get() as { value: string } | undefined;
      if (!row) return defaultRateLimitSettings();
      try {
        return sanitizeRateLimitSettings(JSON.parse(row.value) as Partial<RateLimitSettings>);
      } catch {
        return defaultRateLimitSettings();
      }
    },
    save(settings: RateLimitSettings) {
      db.prepare(`
        insert into app_settings (key, value, updated_at)
        values ('rate_limit', ?, ?)
        on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), settings.updatedAt);
    },
    sanitize: sanitizeRateLimitSettings,
  };
}

function requestIp(c: Parameters<MiddlewareHandler>[0]) {
  return (c.req.header("x-forwarded-for")?.split(",")[0] || c.req.header("x-real-ip") || "unknown").trim();
}

function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

function cleanupRateLimitBuckets() {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function rateLimitResponse(retryAfter: number) {
  return new Response(JSON.stringify({ error: "rate_limited", retryAfter }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(retryAfter),
    },
  });
}

function expensiveRateLimitPath(path: string, method: string) {
  if (method !== "POST" && method !== "PATCH") return false;
  return path === "/api/codex/tasks"
    || /^\/api\/codex\/tasks\/[^/]+\/(messages|recover)$/.test(path)
    || path === "/api/previews"
    || /^\/api\/previews\/[^/]+\/start$/.test(path)
    || /^\/api\/providers(\/[^/]+)?\/(detect|test|models)$/.test(path)
    || path === "/api/providers/detect"
    || path === "/api/providers/models"
    || path === "/api/files/archive"
    || path === "/api/files/archive/preview";
}

function providerProxyIdFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[1] ? decodeURIComponent(parts[1]) : "unknown";
}

function providerProxyRateKey(path: string, ip: string) {
  return `${ip}:${providerProxyIdFromPath(path)}`;
}

type ProviderRateLimit = { enabled?: boolean; rpmLimit?: number | null };

export function createRateLimitMiddleware(getSettings: () => RateLimitSettings, getProviderRateLimit?: (providerId: string) => ProviderRateLimit | null | undefined): MiddlewareHandler {
  return async (c, next) => {
    const settings = getSettings();
    cleanupRateLimitBuckets();
    const url = new URL(c.req.url);
    const path = url.pathname;
    const method = c.req.method;
    const ip = requestIp(c);
    const checks: Array<{ key: string; limit: number; windowMs: number }> = [];
    if (settings.enabled) checks.push({ key: `global:${ip}`, limit: settings.globalPerMinute, windowMs: 60_000 });
    if (settings.enabled && path.startsWith("/api/auth/")) {
      checks.push({ key: `auth:${ip}`, limit: settings.authPerMinute, windowMs: 60_000 });
    }
    if (settings.enabled && path.startsWith("/preview/") && path.includes("/access-requests")) {
      const parts = path.split("/").filter(Boolean);
      const previewId = parts[1] ? decodeURIComponent(parts[1]) : "unknown";
      checks.push({ key: `preview-access:${ip}:${previewId}`, limit: settings.previewAccessPerMinute, windowMs: 60_000 });
    }
    if (path.startsWith("/provider-proxy/")) {
      const key = providerProxyRateKey(path, ip);
      const providerId = providerProxyIdFromPath(path);
      const providerRateLimit = getProviderRateLimit?.(providerId);
      const providerRpmLimit = providerRateLimit?.rpmLimit;
      const rpmLimit = Number.isFinite(Number(providerRpmLimit)) && Number(providerRpmLimit) > 0 ? Math.floor(Number(providerRpmLimit)) : settings.providerProxyPerMinute;
      if (providerRateLimit?.enabled && Number.isFinite(Number(providerRpmLimit)) && Number(providerRpmLimit) > 0) {
        checks.push({ key: `provider-proxy-minute:${key}`, limit: rpmLimit, windowMs: 60_000 });
      } else if (settings.enabled) {
        checks.push({ key: `provider-proxy-minute:${key}`, limit: settings.providerProxyPerMinute, windowMs: 60_000 });
      }
      if (settings.enabled) checks.push({ key: `provider-proxy-hour:${key}`, limit: settings.providerProxyPerHour, windowMs: 60 * 60_000 });
    }
    if (settings.enabled && expensiveRateLimitPath(path, method)) {
      checks.push({ key: `expensive:${ip}`, limit: settings.expensivePerFiveMinutes, windowMs: 5 * 60_000 });
    }
    for (const check of checks) {
      const result = checkRateLimit(check.key, check.limit, check.windowMs);
      if (!result.ok) return rateLimitResponse(result.retryAfter);
    }
    return next();
  };
}

export function getProviderProxyConcurrency(providerId: string) {
  return providerProxyConcurrency.get(providerId) ?? 0;
}

export function incrementProviderProxyConcurrency(providerId: string) {
  providerProxyConcurrency.set(providerId, getProviderProxyConcurrency(providerId) + 1);
}

export function decrementProviderProxyConcurrency(providerId: string) {
  providerProxyConcurrency.set(providerId, Math.max(0, getProviderProxyConcurrency(providerId) - 1));
}
