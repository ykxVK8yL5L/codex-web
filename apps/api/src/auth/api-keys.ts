import type Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  ApiKeyDetailResponse,
  ApiKeyPermission,
  ApiKeyPermissionGroup,
  ApiKeyPermissionsResponse,
  ApiKeyPreset,
  ApiKeySummary,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
} from "@codex-web/protocol";

export type ApiKeyRecord = {
  id: string;
  name: string;
  keyHash: string;
  keyPreview: string;
  permissions: ApiKeyPermission[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthPrincipal =
  | { type: "session"; userId: string }
  | { type: "api_key"; key: ApiKeyRecord };

type ApiKeyStoreDeps = {
  db: Database.Database;
  hashToken: (token: string) => string;
  verifySessionToken: (token: string | null) => boolean;
};

let deps: ApiKeyStoreDeps | null = null;
const apiKeyLastUsedWrites = new Map<string, number>();

export const apiKeyPermissionGroups: ApiKeyPermissionGroup[] = [
  { id: "sessions", label: "Sessions", permissions: [{ id: "sessions.read", label: "Read" }, { id: "sessions.manage", label: "Manage" }, { id: "sessions.run", label: "Run" }] },
  { id: "rooms", label: "Rooms", permissions: [{ id: "rooms.read", label: "Read" }, { id: "rooms.manage", label: "Manage" }, { id: "rooms.run", label: "Run" }] },
  { id: "agents", label: "Agents", permissions: [{ id: "agents.read", label: "Read" }, { id: "agents.manage", label: "Manage" }] },
  { id: "automations", label: "Automations", permissions: [{ id: "automations.read", label: "Read" }, { id: "automations.manage", label: "Manage" }, { id: "automations.run", label: "Run" }] },
  { id: "goals", label: "Goals", permissions: [{ id: "goals.read", label: "Read" }, { id: "goals.manage", label: "Manage" }, { id: "goals.run", label: "Run" }] },
  { id: "projects", label: "Projects", permissions: [{ id: "projects.read", label: "Read" }, { id: "projects.manage", label: "Manage" }, { id: "projects.git", label: "Git actions" }] },
  { id: "previews", label: "Previews", permissions: [{ id: "previews.read", label: "Read" }, { id: "previews.manage", label: "Manage" }] },
  { id: "files", label: "Files", permissions: [{ id: "files.read", label: "Read" }, { id: "files.write", label: "Write" }] },
  { id: "terminal", label: "Terminal", permissions: [{ id: "terminal.exec", label: "Execute" }] },
  { id: "providers", label: "Providers", permissions: [{ id: "providers.read", label: "Read" }, { id: "providers.manage", label: "Manage" }] },
  { id: "extensions", label: "Extensions", permissions: [{ id: "extensions.read", label: "Read" }, { id: "extensions.manage", label: "Manage" }, { id: "extensions.install", label: "Install" }] },
  { id: "environment", label: "Environment", permissions: [{ id: "environment.read", label: "Read" }, { id: "environment.manage", label: "Manage" }, { id: "environment.restore", label: "Restore" }] },
  { id: "notifications", label: "Notifications", permissions: [{ id: "notifications.read", label: "Read" }, { id: "notifications.manage", label: "Manage" }] },
  { id: "approvals", label: "Approvals", permissions: [{ id: "approvals.read", label: "Read" }, { id: "approvals.decide", label: "Decide" }] },
  { id: "settings", label: "Settings", permissions: [{ id: "settings.read", label: "Read" }, { id: "settings.manage", label: "Manage" }] },
  { id: "storage", label: "Storage", permissions: [{ id: "storage.read", label: "Read" }, { id: "storage.manage", label: "Manage" }] },
  { id: "backup", label: "Backup", permissions: [{ id: "backup.read", label: "Read" }, { id: "backup.restore", label: "Restore" }] },
];

export const apiKeyPresets: ApiKeyPreset[] = [
  { id: "read-only", label: "Read only", permissions: apiKeyPermissionGroups.flatMap((group) => group.permissions.map((item) => item.id)).filter((id) => id.endsWith(".read")) },
  { id: "automation-runner", label: "Automation runner", permissions: ["automations.read", "automations.run", "sessions.read", "sessions.run", "rooms.read", "rooms.run", "goals.read", "goals.run", "projects.read", "previews.read"] },
  { id: "environment-restore", label: "Environment restore", permissions: ["environment.read", "environment.restore", "settings.read"] },
  { id: "project-ops", label: "Project ops", permissions: ["projects.read", "projects.manage", "projects.git", "files.read", "files.write", "previews.read", "previews.manage", "terminal.exec"] },
  { id: "full-access", label: "Full access", permissions: apiKeyPermissionGroups.flatMap((group) => group.permissions.map((item) => item.id)) },
];

const apiKeyPermissionSet = new Set<ApiKeyPermission>(apiKeyPermissionGroups.flatMap((group) => group.permissions.map((item) => item.id)));

function getDeps() {
  if (!deps) throw new Error("api_key_store_not_initialized");
  return deps;
}

export function setApiKeyStoreDeps(nextDeps: ApiKeyStoreDeps) {
  deps = nextDeps;
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function apiKeyPermissionsResponse(): ApiKeyPermissionsResponse {
  return { groups: apiKeyPermissionGroups, presets: apiKeyPresets };
}

export function apiKeyFromRow(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    keyHash: String(row.key_hash),
    keyPreview: String(row.key_preview),
    permissions: parseJsonValue<ApiKeyPermission[]>(row.permissions, []).filter((item): item is ApiKeyPermission => apiKeyPermissionSet.has(item)),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function publicApiKey(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    permissions: record.permissions,
    keyPreview: record.keyPreview,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

export function listApiKeys() {
  const { db } = getDeps();
  return db.prepare("select * from api_keys order by created_at desc").all().map((row) => publicApiKey(apiKeyFromRow(row as Record<string, unknown>)));
}

export function createApiKey(body: CreateApiKeyRequest): ApiKeyDetailResponse {
  const { db, hashToken } = getDeps();
  const name = body.name.trim();
  const permissions = Array.from(new Set((body.permissions ?? []).filter((item): item is ApiKeyPermission => apiKeyPermissionSet.has(item))));
  if (!name || !permissions.length) throw new Error("invalid_api_key");
  const id = `key-${randomUUID()}`;
  const secret = `cwk_${randomBytes(24).toString("base64url")}`;
  const now = new Date().toISOString();
  const preview = `${secret.slice(0, 10)}...${secret.slice(-4)}`;
  db.prepare(`
    insert into api_keys (id, name, key_hash, key_preview, permissions, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, hashToken(secret), preview, JSON.stringify(permissions), now, now);
  const record = apiKeyFromRow(db.prepare("select * from api_keys where id = ?").get(id) as Record<string, unknown>);
  return { ...publicApiKey(record), key: secret };
}

export function updateApiKey(id: string, body: UpdateApiKeyRequest) {
  const { db } = getDeps();
  const name = body.name.trim();
  const permissions = Array.from(new Set((body.permissions ?? []).filter((item): item is ApiKeyPermission => apiKeyPermissionSet.has(item))));
  if (!name || !permissions.length) throw new Error("invalid_api_key");
  const now = new Date().toISOString();
  const result = db.prepare(`
    update api_keys
    set name = ?, permissions = ?, updated_at = ?
    where id = ?
  `).run(name, JSON.stringify(permissions), now, id);
  if (!result.changes) throw new Error("api_key_not_found");
  const row = db.prepare("select * from api_keys where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("api_key_not_found");
  return publicApiKey(apiKeyFromRow(row));
}

export function revokeApiKey(id: string) {
  const { db } = getDeps();
  const now = new Date().toISOString();
  db.prepare("update api_keys set revoked_at = ?, updated_at = ? where id = ? and revoked_at is null").run(now, now, id);
  const row = db.prepare("select * from api_keys where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("api_key_not_found");
  return publicApiKey(apiKeyFromRow(row));
}

export function deleteRevokedApiKey(id: string) {
  const { db } = getDeps();
  const row = db.prepare("select * from api_keys where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("api_key_not_found");
  const record = apiKeyFromRow(row);
  if (!record.revokedAt) throw new Error("api_key_not_revoked");
  db.prepare("delete from api_keys where id = ?").run(id);
  return publicApiKey(record);
}

export function findApiKeyByToken(token: string): ApiKeyRecord | null {
  const { db, hashToken } = getDeps();
  const row = db.prepare("select * from api_keys where key_hash = ? and revoked_at is null").get(hashToken(token)) as Record<string, unknown> | undefined;
  return row ? apiKeyFromRow(row) : null;
}

export function touchApiKeyLastUsed(id: string) {
  const { db } = getDeps();
  const nowMs = Date.now();
  if (nowMs - (apiKeyLastUsedWrites.get(id) ?? 0) < 60_000) return;
  apiKeyLastUsedWrites.set(id, nowMs);
  db.prepare("update api_keys set last_used_at = ?, updated_at = ? where id = ?").run(new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), id);
}

export function resolveAuthPrincipalFromBearer(token: string | null): AuthPrincipal | null {
  const { verifySessionToken } = getDeps();
  if (!token) return null;
  if (verifySessionToken(token)) return { type: "session", userId: "local-admin" };
  const key = findApiKeyByToken(token);
  if (!key) return null;
  touchApiKeyLastUsed(key.id);
  return { type: "api_key", key };
}

export function requireSessionPrincipal(c: unknown) {
  const principal = (c as { get: (name: string) => AuthPrincipal | undefined }).get("authPrincipal");
  if (!principal || principal.type !== "session") throw new Error("session_auth_required");
  return principal;
}

export function hasApiKeyPermission(principal: AuthPrincipal, permission: ApiKeyPermission) {
  return principal.type === "session" || principal.key.permissions.includes(permission);
}

export function routePermissionForRequest(method: string, path: string): ApiKeyPermission | null {
  if (path.startsWith("/api/auth/api-key-permissions")) return "auth.read";
  if (path.startsWith("/api/auth/api-keys")) return "auth.manage";
  if (path.startsWith("/api/providers")) return method === "GET" ? "providers.read" : "providers.manage";
  if (path.startsWith("/api/sessions") || path.startsWith("/api/codex/tasks") || path.startsWith("/api/task-runs") || path.startsWith("/api/execution-contexts")) {
    if (method === "GET") return "sessions.read";
    return path.includes("/messages") || path.includes("/queue") || path.includes("/stop") || path.includes("/recover") || path.includes("/compact") ? "sessions.run" : "sessions.manage";
  }
  if (path.startsWith("/api/rooms")) {
    if (method === "GET") return "rooms.read";
    return path.includes("/messages") || path.includes("/runs/") || path.includes("/tasks") || path.includes("/retry-failed") ? "rooms.run" : "rooms.manage";
  }
  if (path.startsWith("/api/agents") || path.startsWith("/api/agent-roles") || path.startsWith("/api/agent-role-templates") || path.startsWith("/api/agent-groups") || path.startsWith("/api/agent-circles") || path.startsWith("/api/permission-profiles")) return method === "GET" ? "agents.read" : "agents.manage";
  if (path.startsWith("/api/goals")) return method === "GET" ? "goals.read" : path.includes("/plan") || path.includes("/orchestrate") ? "goals.run" : "goals.manage";
  if (path.startsWith("/api/files") || path.startsWith("/api/file-mounts")) return method === "GET" ? "files.read" : "files.write";
  if (path.startsWith("/api/terminal")) return "terminal.exec";
  if (path.startsWith("/api/settings/environment/restore")) return "environment.restore";
  if (path.startsWith("/api/settings/environment")) return method === "GET" ? "environment.read" : "environment.manage";
  if (path.startsWith("/api/notifications")) return method === "GET" ? "notifications.read" : "notifications.manage";
  if (path.startsWith("/api/settings/storage")) return method === "GET" ? "storage.read" : "storage.manage";
  if (path.startsWith("/api/settings/backup")) return method === "GET" ? "backup.read" : "backup.restore";
  if (path.startsWith("/api/settings")) return method === "GET" ? "settings.read" : "settings.manage";
  if (path.startsWith("/api/app-notifications")) return method === "GET" ? "notifications.read" : "notifications.manage";
  if (path.startsWith("/api/extensions")) return method === "GET" ? "extensions.read" : "extensions.manage";
  return null;
}
