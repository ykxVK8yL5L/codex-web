import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { PreviewAccess, PreviewAccessSettings, PreviewSummary, SessionSummary } from "@codex-web/protocol";

type PreviewRecord = Omit<PreviewSummary, "url"> & { token: string };

type PreviewAccessRequest = {
  id: string;
  previewId: string;
  secret: string;
  status: "pending" | "approved" | "denied";
  approvedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PreviewRuntimeDeps = {
  db: Database.Database;
  appendMessageCard: (sessionId: string, type: "service", title: string, payload: unknown, messageId?: string | null) => unknown;
  appendPreviewLog: (previewId: string, value: string) => void;
  getPreviewAccessSettings: () => PreviewAccessSettings;
  isMessageCardDismissed: (sessionId: string, keys: string[]) => boolean;
  latestExecutionContextForSession: (sessionId: string) => { resolvedPermissions: { canCreatePreview: boolean } } | null | undefined;
  previewAccess: (value: unknown, fallback: PreviewAccess) => PreviewAccess;
  publishPreviewLogEvent: (previewId: string, event: { type: "status"; preview: PreviewSummary }) => void;
  resolveApproval: (approvalId: string, decision: "approved" | "denied") => unknown;
  stopPreviewProcess: (previewId: string) => void;
};

export function createPreviewRuntime(deps: PreviewRuntimeDeps) {
  const { db, appendMessageCard, appendPreviewLog, getPreviewAccessSettings, isMessageCardDismissed, latestExecutionContextForSession, previewAccess, publishPreviewLogEvent, resolveApproval, stopPreviewProcess } = deps;
  const previews = new Map<string, PreviewRecord>();
  const previewLogs = new Map<string, string>();
  const previewAccessRequests = new Map<string, PreviewAccessRequest>();

function previewFromRow(row: Record<string, unknown>): PreviewRecord {
  return {
    id: String(row.id),
    scopeType: row.scope_type === "session" || row.scope_type === "folder" ? row.scope_type : "project",
    scopeId: String(row.scope_id),
    label: String(row.label),
    targetHost: String(row.target_host),
    port: Number(row.port),
    command: row.command ? String(row.command) : undefined,
    cwd: row.cwd ? String(row.cwd) : undefined,
    status: row.status === "starting" || row.status === "running" || row.status === "stopped" || row.status === "error" ? row.status : "registered",
    access: previewAccess(row.access, "public"),
    proxyPaths: normalizePreviewProxyPaths(row.proxy_paths_json),
    token: String(row.token),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : String(row.created_at),
  };
}

function previewUrl(preview: PreviewRecord) {
  return `/preview/${encodeURIComponent(preview.id)}/${encodeURIComponent(preview.token)}/`;
}

function publicPreview(preview: PreviewRecord): PreviewSummary {
  return {
    id: preview.id,
    scopeType: preview.scopeType,
    scopeId: preview.scopeId,
    label: preview.label,
    targetHost: preview.targetHost,
    port: preview.port,
    command: preview.command,
    cwd: preview.cwd,
    status: preview.status,
    access: preview.access,
    proxyPaths: preview.proxyPaths,
    url: previewUrl(preview),
    createdAt: preview.createdAt,
    updatedAt: preview.updatedAt,
  };
}

function loadPreviews() {
  const rows = db.prepare("select * from previews order by created_at desc").all() as Array<Record<string, unknown>>;
  for (const row of rows) previews.set(String(row.id), previewFromRow(row));
}

function loadPreviewLogs() {
  const rows = db.prepare("select preview_id, logs, label from preview_logs").all() as Array<Record<string, unknown>>;
  for (const row of rows) previewLogs.set(String(row.preview_id), String(row.logs));
}

function previewAccessRequestFromRow(row: Record<string, unknown>): PreviewAccessRequest {
  const status = row.status === "approved" || row.status === "denied" ? row.status : "pending";
  return {
    id: String(row.id),
    previewId: String(row.preview_id),
    secret: String(row.secret),
    status,
    approvedUntil: row.approved_until ? String(row.approved_until) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function loadPreviewAccessRequests() {
  const rows = db.prepare("select * from preview_access_requests").all() as Array<Record<string, unknown>>;
  for (const row of rows) previewAccessRequests.set(String(row.id), previewAccessRequestFromRow(row));
}

function upsertPreviewAccessRequest(request: PreviewAccessRequest) {
  db.prepare(`
    insert into preview_access_requests (id, preview_id, secret, status, approved_until, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      preview_id = excluded.preview_id,
      secret = excluded.secret,
      status = excluded.status,
      approved_until = excluded.approved_until,
      updated_at = excluded.updated_at
  `).run(request.id, request.previewId, request.secret, request.status, request.approvedUntil ?? null, request.createdAt, request.updatedAt);
  previewAccessRequests.set(request.id, request);
}

function expirePreviewAccessRequests() {
  const cutoff = Date.now() - getPreviewAccessSettings().requestTtlMinutes * 60 * 1000;
  const expired = Array.from(previewAccessRequests.values()).filter((request) =>
    request.status === "pending" && new Date(request.createdAt).getTime() < cutoff
  );
  for (const request of expired) {
    request.status = "denied";
    request.updatedAt = new Date().toISOString();
    upsertPreviewAccessRequest(request);
    const rows = db.prepare("select id, payload from approvals where action_type = 'preview-access' and status = 'pending'").all() as Array<{ id: string; payload: string }>;
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as { requestId?: unknown };
        if (String(payload.requestId ?? "") === request.id) resolveApproval(row.id, "denied");
      } catch {
        continue;
      }
    }
  }
}

function insertPreview(preview: PreviewRecord) {
  db.prepare(`
    insert into previews (id, scope_type, scope_id, label, target_host, port, token, command, cwd, status, access, proxy_paths_json, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(preview.id, preview.scopeType, preview.scopeId, preview.label, preview.targetHost, preview.port, preview.token, preview.command ?? null, preview.cwd ?? null, preview.status, preview.access, JSON.stringify(preview.proxyPaths ?? []), preview.createdAt, preview.updatedAt);
  previews.set(preview.id, preview);
}

function updatePreview(preview: PreviewRecord) {
  preview.updatedAt = new Date().toISOString();
  db.prepare(`
    update previews
    set label = ?, target_host = ?, port = ?, command = ?, cwd = ?, status = ?, access = ?, proxy_paths_json = ?, updated_at = ?
    where id = ?
  `).run(preview.label, preview.targetHost, preview.port, preview.command ?? null, preview.cwd ?? null, preview.status, preview.access, JSON.stringify(preview.proxyPaths ?? []), preview.updatedAt, preview.id);
  previews.set(preview.id, preview);
  publishPreviewLogEvent(preview.id, { type: "status", preview: publicPreview(preview) });
}

async function markPreviewRunningIfReachable(preview: PreviewRecord) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`http://${preview.targetHost}:${preview.port}/`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    const current = previews.get(preview.id);
    if (!current || !response) return;
    current.status = "running";
    updatePreview(current);
    appendPreviewLog(current.id, `[discover] upstream responded with ${response.status}\n`);
  } catch {
    // Keep discovered previews registered when the upstream is not ready yet.
  }
}

function normalizeMessageUrl(value: string) {
  let url = value.trim();
  while (/[),.;:!?]+$/.test(url)) url = url.slice(0, -1);
  return url;
}

function discoverPreviewUrls(session: SessionSummary, value: string) {
  const context = latestExecutionContextForSession(session.id);
  if (context && !context.resolvedPermissions.canCreatePreview) return;
  const matches = value.matchAll(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(?:\/[^\s"'`)]*)?/g);
  for (const match of matches) {
    if (shouldIgnoreDiscoveredPreviewUrl(match[0])) continue;
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (isMessageCardDismissed(session.id, [`preview-port:${port}`, `url:${normalizeMessageUrl(match[0])}`])) continue;
    const existing = Array.from(previews.values()).find((preview) =>
      preview.scopeType === "session"
      && preview.scopeId === session.id
      && preview.targetHost === "127.0.0.1"
      && preview.port === port
    );
    if (existing) continue;
    const now = new Date().toISOString();
    const preview: PreviewRecord = {
      id: `preview-${randomUUID()}`,
      scopeType: "session",
      scopeId: session.id,
      label: `${session.title || "Session"} :${port}`,
      targetHost: "127.0.0.1",
      port,
      token: randomUUID(),
      command: undefined,
      cwd: session.workspacePath,
      status: "registered",
      access: "private",
      proxyPaths: [],
      createdAt: now,
      updatedAt: now,
    };
    insertPreview(preview);
    appendPreviewLog(preview.id, `[discover] detected ${match[0]} from Codex output\n`);
    appendMessageCard(session.id, "service", `Detected service on :${port}`, { previewId: preview.id, url: publicPreview(preview).url, port, source: match[0] });
    void markPreviewRunningIfReachable(preview);
  }
}

function normalizePreviewProxyPaths(value: unknown): string[] {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = text.split(/\r?\n|,/);
    }
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map((item) => normalizePreviewProxyPath(String(item ?? "")))
    .filter((item): item is string => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizePreviewProxyPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return "";
  const path = `/${trimmed.replace(/^\/+/, "")}`.replace(/\/+$/g, "") || "/";
  return path.length > 1 ? path : "";
}

function shouldIgnoreDiscoveredPreviewUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.startsWith("/provider-proxy")
      || parsed.pathname.startsWith("/api/")
      || parsed.pathname.startsWith("/preview/")
      || parsed.pathname === "/health";
  } catch {
    return false;
  }
}

function deletePreview(previewId: string) {
  stopPreviewProcess(previewId);
  db.prepare("delete from previews where id = ?").run(previewId);
  db.prepare("delete from preview_logs where preview_id = ?").run(previewId);
  previews.delete(previewId);
  previewLogs.delete(previewId);
}

function deletePreviewsForScope(scopeType: PreviewRecord["scopeType"], scopeId: string) {
  let deleted = 0;
  for (const preview of Array.from(previews.values())) {
    if (preview.scopeType === scopeType && preview.scopeId === scopeId) {
      deletePreview(preview.id);
      deleted += 1;
    }
  }
  return deleted;
}



  return {
    deletePreview,
    deletePreviewsForScope,
    discoverPreviewUrls,
    expirePreviewAccessRequests,
    insertPreview,
    loadPreviewAccessRequests,
    loadPreviewLogs,
    loadPreviews,
    previewAccessRequestFromRow,
    previewAccessRequests,
    previewFromRow,
    previewLogs,
    previews,
    previewUrl,
    publicPreview,
    shouldIgnoreDiscoveredPreviewUrl,
    updatePreview,
    normalizePreviewProxyPaths,
    upsertPreviewAccessRequest,
  };
}
