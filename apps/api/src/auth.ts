import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { verify } from "otplib";
import type { AuthState } from "@codex-web/protocol";

export type AuthConfig = { accessTokenHash: string; otpSecret: string };
type PreviewAccessTarget = { id: string; token: string };
type ProviderProxyTarget = { id: string; baseUrl?: string | null; apiKey?: string | null };

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAuthHelpers(getAuthConfig: () => AuthConfig | null, sessionTtlMs = 7 * 24 * 60 * 60 * 1000) {
  function sessionSecret() {
    const authConfig = getAuthConfig();
    return authConfig ? createHash("sha256").update(`${authConfig.accessTokenHash}:${authConfig.otpSecret}`).digest() : null;
  }

  function anonymousState(): AuthState {
    return {
      authenticated: false,
      setupRequired: !getAuthConfig(),
      needsOtp: true,
      user: null,
    };
  }

  function authenticatedAuthState(): AuthState {
    return {
      authenticated: true,
      setupRequired: false,
      needsOtp: false,
      user: { id: "local-admin", email: "admin@local" },
    };
  }

  function getBearerToken(value: string | undefined) {
    return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
  }

  function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  function signSessionToken() {
    const secret = sessionSecret();
    if (!secret) throw new Error("auth_not_configured");
    const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
    const now = Date.now();
    const payload = base64UrlJson({ sub: "local-admin", iat: now, exp: now + sessionTtlMs, nonce: randomUUID() });
    const signingInput = `${header}.${payload}`;
    const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
    return `${signingInput}.${signature}`;
  }

  function verifySessionToken(token: string | null) {
    const secret = sessionSecret();
    if (!secret || !token) return false;
    const [header, payload, signature, ...rest] = token.split(".");
    if (!header || !payload || !signature || rest.length) return false;
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    if (!safeEqual(signature, expected)) return false;
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number; sub?: string };
      return parsed.sub === "local-admin" && typeof parsed.exp === "number" && parsed.exp > Date.now();
    } catch {
      return false;
    }
  }

  function parseCookieHeader(value?: string) {
    const cookies = new Map<string, string>();
    for (const part of (value ?? "").split(";")) {
      const index = part.indexOf("=");
      if (index <= 0) continue;
      cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    }
    return cookies;
  }

  function signPreviewAccessToken(preview: PreviewAccessTarget, ttlMs: number) {
    const secret = sessionSecret();
    if (!secret) throw new Error("auth_not_configured");
    const payload = base64UrlJson({ previewId: preview.id, token: preview.token, exp: Date.now() + ttlMs });
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  function verifyPreviewAccessToken(preview: PreviewAccessTarget, value?: string | null) {
    const secret = sessionSecret();
    if (!secret || !value) return false;
    const [payload, signature, ...rest] = value.split(".");
    if (!payload || !signature || rest.length) return false;
    const expected = createHmac("sha256", secret).update(payload).digest("base64url");
    if (!safeEqual(signature, expected)) return false;
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { previewId?: string; token?: string; exp?: number };
      return parsed.previewId === preview.id && parsed.token === preview.token && typeof parsed.exp === "number" && parsed.exp > Date.now();
    } catch {
      return false;
    }
  }

  function providerProxyToken(provider: ProviderProxyTarget) {
    const secret = sessionSecret() ?? createHash("sha256").update("codex-web-provider-proxy-fallback").digest();
    return createHmac("sha256", secret)
      .update(`${provider.id}:${provider.baseUrl ?? ""}:${provider.apiKey ?? ""}`)
      .digest("base64url");
  }

  function verifyProviderProxyToken(provider: ProviderProxyTarget, token: string) {
    return safeEqual(token, providerProxyToken(provider));
  }

  async function verifyOtp(secret: string, otp: string) {
    const result = await verify({ secret, token: otp.trim(), epochTolerance: [60, 60] });
    return result.valid;
  }

  const requireAuth: MiddlewareHandler = async (c, next) => {
    const token = getBearerToken(c.req.header("authorization"));
    if (!verifySessionToken(token)) return c.json({ error: "unauthorized" }, 401);
    return next();
  };

  return {
    anonymousState,
    authenticatedAuthState,
    getBearerToken,
    hashToken,
    signSessionToken,
    verifySessionToken,
    parseCookieHeader,
    signPreviewAccessToken,
    verifyPreviewAccessToken,
    providerProxyToken,
    verifyProviderProxyToken,
    verifyOtp,
    requireAuth,
  };
}
