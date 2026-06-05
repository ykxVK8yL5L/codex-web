import type Database from "better-sqlite3";
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { PreviewSummary, ProjectSummary, SessionSummary } from "@codex-web/protocol";

type PreviewRecord = Omit<PreviewSummary, "url"> & { token: string };

type PreviewProcessRuntimeDeps = {
  apiPort: number;
  appData: { projects: ProjectSummary[]; sessions: SessionSummary[] };
  db: Database.Database;
  host: string;
  managedChildEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  previewLogs: Map<string, string>;
  previews: Map<string, PreviewRecord>;
  previewUrl: (preview: PreviewRecord) => string;
  publishPreviewLogEvent: (previewId: string, event: { type: "log"; previewId: string; chunk: string; at: string }) => void;
  toTerminalPath: (absolutePath: string) => string;
  updatePreview: (preview: PreviewRecord) => void;
};

export function createPreviewProcessRuntime(deps: PreviewProcessRuntimeDeps) {
  const { apiPort, appData, db, host, managedChildEnv, previewLogs, previews, previewUrl, publishPreviewLogEvent, toTerminalPath, updatePreview } = deps;
  const previewProcesses = new Map<string, ChildProcess>();
  const previewProcessGroups = new Map<string, number>();

function validPreviewHost(value: string) {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

function rewritePreviewHtml(value: string, basePath: string) {
  return value
    .replace(/\b(src|href|action)=(["'])\/(?!\/|preview\/|api\/)/g, `$1=$2${basePath}`)
    .replace(/\bsrcset=(["'])([^"']*)\1/g, (_match, quote: string, srcset: string) => {
      const rewritten = srcset.split(",").map((item) => {
        const trimmed = item.trim();
        const [url = "", ...rest] = trimmed.split(/\s+/);
        if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/preview/") || url.startsWith("/api/")) return trimmed;
        return [`${basePath}${url.slice(1)}`, ...rest].join(" ");
      }).join(", ");
      return `srcset=${quote}${rewritten}${quote}`;
    });
}

function rewritePreviewCss(value: string, basePath: string) {
  return value.replace(/url\((["']?)\/(?!\/|preview\/|api\/)/g, `url($1${basePath}`);
}

function rewritePreviewText(value: string, basePath: string, contentType: string) {
  if (contentType.includes("text/html")) return rewritePreviewCss(rewritePreviewHtml(value, basePath), basePath);
  if (contentType.includes("text/css")) return rewritePreviewCss(value, basePath);
  return value;
}

function rewritePreviewLocation(value: string | null, upstreamUrl: URL, basePath: string) {
  if (!value) return value;
  try {
    const target = new URL(value, upstreamUrl);
    if (target.origin !== upstreamUrl.origin) return value;
    return `${basePath}${target.pathname.replace(/^\/+/, "")}${target.search}${target.hash}`;
  } catch {
    return value;
  }
}

function previewFromReferer(value?: string | null) {
  if (!value) return null;
  try {
    const refererUrl = new URL(value, `http://${host}:${apiPort}`);
    const parts = refererUrl.pathname.split("/").filter(Boolean);
    if (parts[0] !== "preview") return null;
    const previewId = parts[1] ? decodeURIComponent(parts[1]) : "";
    const token = parts[2] ? decodeURIComponent(parts[2]) : "";
    const preview = previews.get(previewId);
    return preview && preview.token === token ? preview : null;
  } catch {
    return null;
  }
}

function previewUpstreamPathFromUrl(sourceUrl: URL, preview: PreviewRecord) {
  const previewId = encodeURIComponent(preview.id);
  const token = encodeURIComponent(preview.token);
  let parts = sourceUrl.pathname.split("/").filter(Boolean).slice(3);
  while (parts[0] === "preview" && parts[1] === previewId && parts[2] === token) {
    parts = parts.slice(3);
  }
  return parts.join("/");
}

function previewScopeWorkspace(scopeType: PreviewRecord["scopeType"], scopeId: string) {
  if (scopeType === "project") return appData.projects.find((project) => project.id === scopeId)?.workspacePath ?? null;
  if (scopeType === "folder") {
    const folderPath = resolve(scopeId);
    return existsSync(folderPath) && statSync(folderPath).isDirectory() ? folderPath : null;
  }
  return appData.sessions.find((session) => session.id === scopeId)?.workspacePath ?? null;
}

function resolvePreviewCwd(preview: PreviewRecord, requestedCwd?: string) {
  const workspace = previewScopeWorkspace(preview.scopeType, preview.scopeId);
  if (!workspace) return null;
  const absoluteWorkspace = resolve(workspace);
  const absoluteCwd = resolve(absoluteWorkspace, requestedCwd?.trim() || ".");
  const relativePath = relative(absoluteWorkspace, absoluteCwd);
  if (relativePath.startsWith("..") || relativePath === ".." || relativePath.startsWith("/") || relativePath.startsWith("\\")) return null;
  return absoluteCwd;
}

function stopPreviewProcess(previewId: string) {
  const child = previewProcesses.get(previewId);
  const processGroupId = child?.pid ?? previewProcessGroups.get(previewId);
  if (processGroupId && process.platform !== "win32") {
    try {
      process.kill(-processGroupId, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-processGroupId, "SIGKILL");
        } catch {
          // Process group already exited.
        }
      }, 2500).unref();
    } catch {
      child?.kill("SIGTERM");
    }
  } else {
    child?.kill("SIGTERM");
  }
  previewProcesses.delete(previewId);
  previewProcessGroups.delete(previewId);
}

function previewUsingPort(preview: Pick<PreviewRecord, "id" | "targetHost" | "port">) {
  return Array.from(previews.values()).find((item) =>
    item.id !== preview.id
    && item.targetHost === preview.targetHost
    && item.port === preview.port
    && (item.status === "running" || item.status === "starting")
  ) ?? null;
}

function appendPreviewLog(previewId: string, value: string) {
  const current = previewLogs.get(previewId) ?? "";
  const logs = (current + value).slice(-128 * 1024);
  const label = previews.get(previewId)?.label ?? null;
  previewLogs.set(previewId, logs);
  db.prepare(`
    insert into preview_logs (preview_id, label, logs, updated_at)
    values (?, ?, ?, ?)
    on conflict(preview_id) do update set
      label = coalesce(excluded.label, preview_logs.label),
      logs = excluded.logs,
      updated_at = excluded.updated_at
  `).run(previewId, label, logs, new Date().toISOString());
  publishPreviewLogEvent(previewId, { type: "log", previewId, chunk: value, at: new Date().toISOString() });
}

async function isPreviewReachable(preview: PreviewRecord) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`http://${preview.targetHost}:${preview.port}/`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    return response;
  } catch {
    return null;
  }
}

async function waitForPreviewReady(preview: PreviewRecord) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const current = previews.get(preview.id);
    if (!current || current.status !== "starting") return;
    const response = await isPreviewReachable(preview);
    if (response) {
      current.status = "running";
      updatePreview(current);
      appendPreviewLog(preview.id, `[ready] upstream responded with ${response.status}\n`);
      return;
    }
  }
  const current = previews.get(preview.id);
  if (!current || current.status !== "starting") return;
  current.status = "error";
  updatePreview(current);
  appendPreviewLog(preview.id, "[error] upstream did not become ready within 12s\n");
}

async function settlePreviewProcessExit(previewId: string, exitCode: number | null) {
  previewProcesses.delete(previewId);
  const current = previews.get(previewId);
  if (!current || (current.status !== "running" && current.status !== "starting")) return;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  const response = await isPreviewReachable(current);
  if (response && exitCode === 0) {
    current.status = "running";
    updatePreview(current);
    appendPreviewLog(previewId, `\n[exit] shell exited with ${exitCode}, upstream still responds with ${response.status}\n`);
    return;
  }
  previewProcessGroups.delete(previewId);
  current.status = exitCode === 0 ? "stopped" : "error";
  updatePreview(current);
  appendPreviewLog(previewId, `\n[exit] ${exitCode}\n`);
}

function startPreviewProcess(preview: PreviewRecord) {
  if (!preview.command?.trim()) throw new Error("preview_command_required");
  const cwd = resolvePreviewCwd(preview, preview.cwd);
  if (!cwd) throw new Error("invalid_preview_cwd");
  const conflict = previewUsingPort(preview);
  if (conflict) {
    appendPreviewLog(preview.id, `[error] port ${preview.targetHost}:${preview.port} is already used by ${conflict.label}\n`);
    throw new Error("preview_port_in_use");
  }
  stopPreviewProcess(preview.id);
  preview.cwd = cwd;
  preview.status = "starting";
  updatePreview(preview);
  appendPreviewLog(preview.id, `\n[start] ${new Date().toISOString()}\n$ ${preview.command}\ncwd: ${toTerminalPath(cwd)}\n`);
  const child = spawnProcess(preview.command, {
    cwd,
    shell: true,
    detached: process.platform !== "win32",
    env: managedChildEnv({
      HOST: "0.0.0.0",
      PORT: String(preview.port),
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  previewProcesses.set(preview.id, child);
  if (child.pid) previewProcessGroups.set(preview.id, child.pid);
  child.stdout?.on("data", (data) => appendPreviewLog(preview.id, data.toString()));
  child.stderr?.on("data", (data) => appendPreviewLog(preview.id, data.toString()));
  child.once("exit", (exitCode) => {
    void settlePreviewProcessExit(preview.id, exitCode);
  });
  void waitForPreviewReady(preview);
}



  return {
    appendPreviewLog,
    isPreviewReachable,
    previewFromReferer,
    previewProcessGroups,
    previewProcesses,
    previewScopeWorkspace,
    previewUpstreamPathFromUrl,
    previewUsingPort,
    resolvePreviewCwd,
    rewritePreviewCss,
    rewritePreviewHtml,
    rewritePreviewLocation,
    rewritePreviewText,
    settlePreviewProcessExit,
    startPreviewProcess,
    stopPreviewProcess,
    validPreviewHost,
    waitForPreviewReady,
  };
}
