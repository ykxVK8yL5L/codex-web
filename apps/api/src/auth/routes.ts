import type { Hono } from "hono";
import { generateSecret, generateURI } from "otplib";
import type {
  ConfirmOtpResetRequest,
  CreateApiKeyRequest,
  LoginRequest,
  LoginResponse,
  ResetOtpResponse,
  SetupCompleteRequest,
  SetupStartResponse,
  UpdateAccessTokenRequest,
  UpdateApiKeyRequest,
} from "@codex-web/protocol";
import type { AuthConfig } from "./index.js";
import {
  apiKeyPermissionsResponse as apiKeyPermissionsResponseStore,
  createApiKey as createApiKeyStore,
  deleteRevokedApiKey as deleteRevokedApiKeyStore,
  hasApiKeyPermission as hasApiKeyPermissionStore,
  listApiKeys as listApiKeysStore,
  requireSessionPrincipal as requireSessionPrincipalStore,
  resolveAuthPrincipalFromBearer as resolveAuthPrincipalFromBearerStore,
  routePermissionForRequest as routePermissionForRequestStore,
  revokeApiKey as revokeApiKeyStore,
  updateApiKey as updateApiKeyStore,
  type AuthPrincipal,
} from "./api-keys.js";

type ExternalNotificationInput = {
  eventType: "auth_login";
  severity: "success";
  title: string;
  message: string;
  sourceType: "auth";
  sourceId: string;
  metadata: Record<string, unknown>;
};

type AuthRoutesDeps = {
  anonymousState: () => LoginResponse["auth"];
  authenticatedAuthState: () => LoginResponse["auth"];
  clearSessionCookie: () => string;
  emitExternalNotification: (input: ExternalNotificationInput) => void;
  getAuthConfig: () => AuthConfig | null;
  getBearerToken: (value: string | undefined) => string | null;
  getPendingOtpSecret: () => string;
  getPendingResetOtpSecret: () => string | null;
  hashToken: (token: string) => string;
  saveAuthConfig: (config: AuthConfig) => void;
  sessionCookie: (token: string) => string;
  setAuthConfig: (config: AuthConfig) => void;
  setPendingResetOtpSecret: (secret: string | null) => void;
  signSessionToken: () => string;
  verifyOtp: (secret: string, otp: string) => Promise<boolean>;
  verifySessionToken: (token: string | null) => boolean;
};

export function registerPublicAuthRoutes(app: Hono, deps: AuthRoutesDeps) {
  app.get("/api/auth/state", (c) => {
    const token = deps.getBearerToken(c.req.header("authorization"));
    if (token && deps.verifySessionToken(token)) {
      c.header("set-cookie", deps.sessionCookie(token));
      return c.json(deps.authenticatedAuthState());
    }
    return c.json(deps.anonymousState());
  });

  app.post("/api/auth/setup/start", (c) => {
    if (deps.getAuthConfig()) {
      const response: SetupStartResponse = { setupRequired: false, otpSecret: null, otpauthUrl: null };
      return c.json(response);
    }
    const pendingOtpSecret = deps.getPendingOtpSecret();
    const response: SetupStartResponse = {
      setupRequired: true,
      otpSecret: pendingOtpSecret,
      otpauthUrl: generateURI({ issuer: "Codex Web", label: "local-admin", secret: pendingOtpSecret, algorithm: "sha1", digits: 6, period: 30 }),
    };
    return c.json(response);
  });

  app.post("/api/auth/setup/complete", async (c) => {
    if (deps.getAuthConfig()) return c.json({ error: "already_configured" }, 409);
    const pendingOtpSecret = deps.getPendingOtpSecret();
    const body = await c.req.json<SetupCompleteRequest>().catch(() => null);
    if (!body?.accessToken || !body.otp || !(await deps.verifyOtp(pendingOtpSecret, body.otp))) {
      return c.json({ error: "invalid_setup_token_or_otp" }, 401);
    }
    const authConfig = { accessTokenHash: deps.hashToken(body.accessToken), otpSecret: pendingOtpSecret };
    deps.setAuthConfig(authConfig);
    deps.saveAuthConfig(authConfig);
    const sessionToken = deps.signSessionToken();
    c.header("set-cookie", deps.sessionCookie(sessionToken));
    const response: LoginResponse = { ok: true, sessionToken, auth: deps.authenticatedAuthState() };
    deps.emitExternalNotification({
      eventType: "auth_login",
      severity: "success",
      title: "Codex Web 登录成功",
      message: "本地管理员完成首次设置并登录。",
      sourceType: "auth",
      sourceId: "local-admin",
      metadata: { action: "setup_complete", userAgent: c.req.header("user-agent") ?? null, ip: c.req.header("x-forwarded-for") ?? null },
    });
    return c.json(response);
  });

  app.post("/api/auth/login", async (c) => {
    const authConfig = deps.getAuthConfig();
    if (!authConfig) {
      const response: LoginResponse = { ok: false, sessionToken: null, auth: deps.anonymousState(), error: "setup_required" };
      return c.json(response, 409);
    }
    const body = await c.req.json<LoginRequest>().catch(() => null);
    if (!body?.accessToken || !body.otp || deps.hashToken(body.accessToken) !== authConfig.accessTokenHash || !(await deps.verifyOtp(authConfig.otpSecret, body.otp))) {
      const response: LoginResponse = { ok: false, sessionToken: null, auth: deps.anonymousState(), error: "invalid_token_or_otp" };
      return c.json(response, 401);
    }
    const sessionToken = deps.signSessionToken();
    c.header("set-cookie", deps.sessionCookie(sessionToken));
    const response: LoginResponse = { ok: true, sessionToken, auth: deps.authenticatedAuthState() };
    deps.emitExternalNotification({
      eventType: "auth_login",
      severity: "success",
      title: "Codex Web 登录成功",
      message: "本地管理员已登录。",
      sourceType: "auth",
      sourceId: "local-admin",
      metadata: { action: "login", userAgent: c.req.header("user-agent") ?? null, ip: c.req.header("x-forwarded-for") ?? null },
    });
    return c.json(response);
  });

  app.post("/api/auth/logout", (c) => {
    c.header("set-cookie", deps.clearSessionCookie());
    return c.json({ ok: true });
  });
}

export function registerApiAuthMiddleware(app: Hono, deps: AuthRoutesDeps) {
  app.use("/api/*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/webhook/")) return next();
    const principal = resolveAuthPrincipalFromBearerStore(deps.getBearerToken(c.req.header("authorization")));
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    (c as unknown as { set: (name: string, value: AuthPrincipal) => void }).set("authPrincipal", principal);
    if (principal.type === "api_key") {
      const permission = routePermissionForRequestStore(c.req.method, pathname);
      if (!permission || !hasApiKeyPermissionStore(principal, permission)) return c.json({ error: "forbidden" }, 403);
    }
    return next();
  });
}

export function registerProtectedAuthRoutes(app: Hono, deps: AuthRoutesDeps) {
  app.post("/api/auth/access-token", async (c) => {
    requireSessionPrincipalStore(c);
    const authConfig = deps.getAuthConfig();
    if (!authConfig) return c.json({ error: "setup_required" }, 409);
    const body = await c.req.json<UpdateAccessTokenRequest>().catch(() => null);
    if (!body?.currentAccessToken?.trim() || !body.accessToken?.trim()) return c.json({ error: "access_token_required" }, 400);
    if (deps.hashToken(body.currentAccessToken) !== authConfig.accessTokenHash) return c.json({ error: "invalid_current_access_token" }, 401);
    const nextAuthConfig = { ...authConfig, accessTokenHash: deps.hashToken(body.accessToken) };
    deps.setAuthConfig(nextAuthConfig);
    deps.saveAuthConfig(nextAuthConfig);
    const sessionToken = deps.signSessionToken();
    c.header("set-cookie", deps.sessionCookie(sessionToken));
    const response: LoginResponse = { ok: true, sessionToken, auth: deps.authenticatedAuthState() };
    return c.json(response);
  });

  app.post("/api/auth/otp/reset", (c) => {
    requireSessionPrincipalStore(c);
    if (!deps.getAuthConfig()) return c.json({ error: "setup_required" }, 409);
    const pendingResetOtpSecret = generateSecret();
    deps.setPendingResetOtpSecret(pendingResetOtpSecret);
    const response: ResetOtpResponse = {
      otpSecret: pendingResetOtpSecret,
      otpauthUrl: generateURI({ issuer: "Codex Web", label: "local-admin", secret: pendingResetOtpSecret, algorithm: "sha1", digits: 6, period: 30 }),
    };
    return c.json(response);
  });

  app.post("/api/auth/otp/reset/confirm", async (c) => {
    requireSessionPrincipalStore(c);
    const authConfig = deps.getAuthConfig();
    if (!authConfig) return c.json({ error: "setup_required" }, 409);
    const pendingResetOtpSecret = deps.getPendingResetOtpSecret();
    if (!pendingResetOtpSecret) return c.json({ error: "otp_reset_not_started" }, 400);
    const body = await c.req.json<ConfirmOtpResetRequest>().catch(() => null);
    if (!body?.currentAccessToken?.trim() || deps.hashToken(body.currentAccessToken) !== authConfig.accessTokenHash) {
      return c.json({ error: "invalid_current_access_token" }, 401);
    }
    if (!body?.otp || !(await deps.verifyOtp(pendingResetOtpSecret, body.otp))) {
      return c.json({ error: "invalid_otp" }, 401);
    }
    const nextAuthConfig = { ...authConfig, otpSecret: pendingResetOtpSecret };
    deps.setAuthConfig(nextAuthConfig);
    deps.setPendingResetOtpSecret(null);
    deps.saveAuthConfig(nextAuthConfig);
    const sessionToken = deps.signSessionToken();
    c.header("set-cookie", deps.sessionCookie(sessionToken));
    const response: LoginResponse = { ok: true, sessionToken, auth: deps.authenticatedAuthState() };
    return c.json(response);
  });

  app.get("/api/auth/api-key-permissions", (c) => {
    requireSessionPrincipalStore(c);
    return c.json(apiKeyPermissionsResponseStore());
  });

  app.get("/api/auth/api-keys", (c) => {
    requireSessionPrincipalStore(c);
    return c.json(listApiKeysStore());
  });

  app.post("/api/auth/api-keys", async (c) => {
    requireSessionPrincipalStore(c);
    const body = await c.req.json<CreateApiKeyRequest>().catch(() => null);
    if (!body?.name?.trim() || !Array.isArray(body.permissions) || !body.permissions.length) return c.json({ error: "invalid_api_key" }, 400);
    try {
      return c.json(createApiKeyStore(body), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "api_key_create_failed" }, 400);
    }
  });

  app.patch("/api/auth/api-keys/:id", async (c) => {
    requireSessionPrincipalStore(c);
    const body = await c.req.json<UpdateApiKeyRequest>().catch(() => null);
    if (!body?.name?.trim() || !Array.isArray(body.permissions) || !body.permissions.length) return c.json({ error: "invalid_api_key" }, 400);
    try {
      return c.json(updateApiKeyStore(c.req.param("id"), body));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "api_key_update_failed";
      return c.json({ error: reason }, reason === "api_key_not_found" ? 404 : 400);
    }
  });

  app.delete("/api/auth/api-keys/:id", (c) => {
    requireSessionPrincipalStore(c);
    try {
      return c.json(revokeApiKeyStore(c.req.param("id")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "api_key_not_found" }, 404);
    }
  });

  app.delete("/api/auth/api-keys/:id/record", (c) => {
    requireSessionPrincipalStore(c);
    try {
      return c.json(deleteRevokedApiKeyStore(c.req.param("id")));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "api_key_delete_failed";
      return c.json({ error: reason }, reason === "api_key_not_revoked" ? 409 : 404);
    }
  });
}
