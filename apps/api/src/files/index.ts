import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { ConversationType, FileEntry, FileMount, SessionKind, StorageItemSummary, StorageScanResponse, SessionSummary, ProjectSummary } from "@codex-web/protocol";

type FileStoreDeps = {
  db: Database.Database;
  appData: { sessions: SessionSummary[]; projects: ProjectSummary[] };
  previews: Map<string, { label?: string | null }>;
  previewLogs: Map<string, string>;
  fileMounts: Map<string, FileMount>;
  workspaceRoot: string;
  dataDir: string;
  internalProjectWorkspaceRoot: string;
  sessionWorkspaceRoot: string;
  taskLogDir: string;
  projectWorkspaceMetadataFile: string;
  resolveTerminalCwd: (path: string) => string;
  legacyTaskLogPath: (sessionId: string) => string;
  legacyTaskMetaPath: (sessionId: string) => string;
  deleteSessionDatabaseRows: (sessionId: string) => void;
};

let fileStoreDeps: FileStoreDeps | null = null;

export function setFileStoreDeps(nextDeps: FileStoreDeps) {
  fileStoreDeps = nextDeps;
}

function deps() {
  if (!fileStoreDeps) throw new Error("file_store_not_initialized");
  return fileStoreDeps;
}

export function loadFileMounts() {
  const { db, fileMounts, workspaceRoot } = deps();
  const rows = db.prepare(`
    select id, name, root_path, created_at, updated_at
    from file_mounts
    order by created_at asc
  `).all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const mount: FileMount = {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
    if (mount.id === "default" && (!existsSync(mount.rootPath) || !statSync(mount.rootPath).isDirectory())) {
      mount.rootPath = workspaceRoot;
      mount.updatedAt = new Date().toISOString();
      db.prepare("update file_mounts set root_path = ?, updated_at = ? where id = ?").run(mount.rootPath, mount.updatedAt, mount.id);
    }
    fileMounts.set(mount.id, mount);
  }
}

export function normalizeMountPath(value: string) {
  return resolve(value.trim() || ".");
}

export function pathWithinRoot(targetPath: string, rootPath: string) {
  const target = resolve(targetPath);
  const root = resolve(rootPath);
  return target === root || target.startsWith(`${root}/`);
}

export function resolveInsideRoot(root: string, inputPath?: string) {
  const requestedPath = inputPath && inputPath !== "." ? inputPath : ".";
  const expandedPath = requestedPath === "~" || requestedPath.startsWith("~/")
    ? join(process.env.HOME ?? root, requestedPath.slice(2))
    : requestedPath;
  const absolutePath = resolve(root, expandedPath);
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_root");
  return absolutePath;
}

function getMount(mountId?: string | null) {
  const { fileMounts } = deps();
  if (mountId && fileMounts.has(mountId)) return fileMounts.get(mountId) ?? null;
  return fileMounts.get("default") ?? Array.from(fileMounts.values())[0] ?? null;
}

export function upsertFileMount(mount: FileMount) {
  const { db, fileMounts } = deps();
  db.prepare(`
    insert into file_mounts (id, name, root_path, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      root_path = excluded.root_path,
      updated_at = excluded.updated_at
  `).run(mount.id, mount.name, mount.rootPath, mount.createdAt, mount.updatedAt);
  fileMounts.set(mount.id, mount);
}

export function deleteFileMount(id: string) {
  const { db, fileMounts } = deps();
  db.prepare("delete from file_mounts where id = ?").run(id);
  fileMounts.delete(id);
}

export function deleteFileMountsForRoot(rootPath: string) {
  const { db, fileMounts } = deps();
  const normalizedRoot = normalizeMountPath(rootPath);
  for (const mount of Array.from(fileMounts.values())) {
    if (normalizeMountPath(mount.rootPath) !== normalizedRoot) continue;
    if (mount.id === "default" && fileMounts.size <= 1) continue;
    db.prepare("delete from file_mounts where id = ?").run(mount.id);
    fileMounts.delete(mount.id);
  }
}

export function resolveInsideMount(mount: FileMount, inputPath?: string) {
  return resolveInsideRoot(mount.rootPath, inputPath);
}

export function resolveMountWorkspace(mountId?: string | null) {
  const mount = getMount(mountId);
  if (!mount) throw new Error("mount_not_found");
  return mount;
}

export function resolveFileRequestMount(mountId?: string | null, rootPath?: string | null): FileMount {
  if (rootPath?.trim()) {
    const transientRoot = normalizeMountPath(rootPath);
    if (!existsSync(transientRoot) || !statSync(transientRoot).isDirectory()) throw new Error("mount_root_invalid");
    return {
      id: "__workspace",
      name: "Workspace",
      rootPath: transientRoot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return resolveMountWorkspace(mountId);
}

export function toRelativePath(absolutePath: string, root = deps().workspaceRoot) {
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath === ".") return ".";
  return relativePath.split(/[\\/]+/).filter(Boolean).join("/");
}

export function toFileEntry(absolutePath: string, root = deps().workspaceRoot): FileEntry {
  const stat = statSync(absolutePath);
  return {
    name: absolutePath.split(/[\\/]/).at(-1) ?? absolutePath,
    path: toRelativePath(absolutePath, root),
    kind: stat.isDirectory() ? "directory" : "file",
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function pathStats(targetPath: string, options: { excludeNames?: Set<string> } = {}) {
  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      return { bytes: stat.size, updatedAt: stat.mtime.toISOString() };
    }
    if (stat.isDirectory()) {
      let bytes = 0;
      for (const child of readdirSync(targetPath)) {
        if (options.excludeNames?.has(child)) continue;
        bytes += pathStats(join(targetPath, child), options).bytes;
      }
      return { bytes, updatedAt: stat.mtime.toISOString() };
    }
    return { bytes: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { bytes: 0, updatedAt: new Date(0).toISOString() };
  }
}

function readProjectWorkspaceMetadata(itemPath: string) {
  try {
    const { projectWorkspaceMetadataFile } = deps();
    const metadataPath = join(itemPath, projectWorkspaceMetadataFile);
    if (!existsSync(metadataPath)) return null;
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as { id?: unknown; name?: unknown; workspacePath?: unknown; orphanedAt?: unknown };
    return {
      id: typeof parsed.id === "string" ? parsed.id : null,
      name: typeof parsed.name === "string" ? parsed.name : null,
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
      orphanedAt: typeof parsed.orphanedAt === "string" ? parsed.orphanedAt : null,
    };
  } catch {
    return null;
  }
}

function readSessionStorageMetadata(itemPath: string) {
  try {
    const metadataPath = existsSync(join(itemPath, ".codex-web.json"))
      ? join(itemPath, ".codex-web.json")
      : join(itemPath, "metadata.json");
    if (!existsSync(metadataPath)) return null;
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      id?: unknown;
      title?: unknown;
      kind?: unknown;
      projectId?: unknown;
      projectName?: unknown;
      sessionType?: unknown;
      conversationType?: unknown;
      session?: { id?: unknown; kind?: unknown; projectId?: unknown; title?: unknown; conversationType?: unknown };
    };
    const sessionType = typeof parsed.sessionType === "string"
      ? parsed.sessionType
      : typeof parsed.conversationType === "string"
        ? parsed.conversationType
        : typeof parsed.session?.conversationType === "string"
          ? parsed.session.conversationType
          : null;
    return {
      id: typeof parsed.id === "string"
        ? parsed.id
        : typeof parsed.session?.id === "string"
          ? parsed.session.id
          : null,
      kind: parsed.kind === "project" || parsed.kind === "scratch"
        ? parsed.kind
        : parsed.session?.kind === "project" || parsed.session?.kind === "scratch"
          ? parsed.session.kind
          : null,
      projectId: typeof parsed.projectId === "string"
        ? parsed.projectId
        : typeof parsed.session?.projectId === "string"
          ? parsed.session.projectId
          : null,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName : null,
      title: typeof parsed.title === "string"
        ? parsed.title
        : typeof parsed.session?.title === "string"
          ? parsed.session.title
          : null,
      sessionType: sessionType === "codex" || sessionType === "agent" || sessionType === "room" || sessionType === "automation" ? sessionType : null,
    };
  } catch {
    return null;
  }
}

function storageItem(
  type: StorageItemSummary["type"],
  status: StorageItemSummary["status"],
  label: string,
  itemPath: string,
  relatedId?: string | null,
  relatedName?: string | null,
  relatedType?: StorageItemSummary["relatedType"],
  statsOptions?: { excludeNames?: Set<string> },
  sessionType?: ConversationType | null,
  sessionKind?: SessionKind | null,
): StorageItemSummary {
  const stats = pathStats(itemPath, statsOptions);
  return {
    id: createHash("sha1").update(`${type}:${itemPath}`).digest("hex"),
    type,
    status,
    label,
    path: itemPath,
    bytes: stats.bytes,
    updatedAt: stats.updatedAt,
    sessionType: sessionType ?? null,
    sessionKind: sessionKind ?? null,
    relatedId: relatedId ?? null,
    relatedName: relatedName ?? null,
    relatedType: relatedType ?? null,
  };
}

export function listStorageItems(): StorageScanResponse {
  const { appData, db, previews, previewLogs, internalProjectWorkspaceRoot, sessionWorkspaceRoot, dataDir, resolveTerminalCwd } = deps();
  const items: StorageItemSummary[] = [];
  const sessionIds = new Set(appData.sessions.map((session) => session.id));
  const sessionById = new Map(appData.sessions.map((session) => [session.id, session]));
  const projectByWorkspacePath = new Map(appData.projects.map((project) => [resolveTerminalCwd(project.workspacePath), project]));
  const roomRows = db.prepare("select id, session_id, name from rooms").all() as Array<{ id: string; session_id?: string | null; name: string }>;
  const roomById = new Map(roomRows.map((room) => [room.id, room]));
  const activeRoomIds = new Set(roomRows
    .filter((row) => row.session_id && sessionIds.has(row.session_id))
    .map((row) => row.id));
  const activeSessionIds = new Set(appData.sessions
    .filter((session) => !(session.conversationType === "agent" && session.roomId && !activeRoomIds.has(session.roomId)))
    .map((session) => session.id));
  const runWorkspaceRows = db.prepare(`
    select agent_runs.id, agent_runs.status as run_status, agent_runs.workspace_path, room_run_merges.status as merge_status
    from agent_runs
    left join room_run_merges on room_run_merges.run_id = agent_runs.id
    where agent_runs.workspace_path is not null and agent_runs.workspace_path != ''
  `).all() as Array<{ id: string; run_status: string; workspace_path: string; merge_status?: string | null }>;
  const runWorkspaces = new Map(runWorkspaceRows.map((row) => [resolve(row.workspace_path), row]));
  const previewIds = new Set(Array.from(previews.keys()));

  if (existsSync(internalProjectWorkspaceRoot)) {
    for (const name of readdirSync(internalProjectWorkspaceRoot)) {
      const itemPath = join(internalProjectWorkspaceRoot, name);
      if (!lstatSync(itemPath).isDirectory()) continue;
      const project = projectByWorkspacePath.get(resolve(itemPath));
      const metadata = project ? null : readProjectWorkspaceMetadata(itemPath);
      items.push(storageItem("project-workspace", project ? "active" : "orphan", name, itemPath, project?.id ?? metadata?.id ?? name, project?.name ?? metadata?.name, "project"));
    }
  }

  if (existsSync(sessionWorkspaceRoot)) {
    for (const name of readdirSync(sessionWorkspaceRoot)) {
      const itemPath = join(sessionWorkspaceRoot, name);
      if (!lstatSync(itemPath).isDirectory()) continue;
      const active = activeSessionIds.has(name);
      const session = sessionById.get(name);
      const metadata = session ? null : readSessionStorageMetadata(itemPath);
      const sessionType = (session?.conversationType ?? metadata?.sessionType ?? "codex") as ConversationType;
      const sessionKind = (session?.kind ?? metadata?.kind ?? null) as SessionKind | null;
      const relatedId = session?.projectId ?? metadata?.projectId ?? metadata?.id ?? name;
      const relatedName = session?.title ?? metadata?.projectName ?? metadata?.title;
      const relatedType = metadata?.projectId || session?.projectId ? "project" : "session";
      items.push(storageItem("session-data", active ? "active" : "orphan", name, itemPath, relatedId, relatedName, relatedType, undefined, sessionType, sessionKind));
    }
  }

  const roomsRoot = join(dataDir, "rooms");
  if (existsSync(roomsRoot)) {
    for (const name of readdirSync(roomsRoot)) {
      const itemPath = join(roomsRoot, name);
      if (!lstatSync(itemPath).isDirectory()) continue;
      const active = activeRoomIds.has(name);
      const room = roomById.get(name);
      items.push(storageItem("room-workspace", active ? "active" : "orphan", name, itemPath, name, room?.name, "room"));
      const worktreesRoot = join(itemPath, "worktrees");
      if (!existsSync(worktreesRoot)) continue;
      for (const worktreeName of readdirSync(worktreesRoot)) {
        const worktreePath = join(worktreesRoot, worktreeName);
        if (!lstatSync(worktreePath).isDirectory()) continue;
        const run = runWorkspaces.get(resolve(worktreePath));
        const mergeStatus = run?.merge_status ?? "none";
        const isActive = activeRoomIds.has(name) && Boolean(run && (run.run_status === "running" || mergeStatus === "pending" || mergeStatus === "conflict"));
        items.push(storageItem("room-worktree", isActive ? "active" : "orphan", `${name}/${worktreeName}`, worktreePath, run?.id ?? name, room?.name, run ? "run" : "room"));
      }
    }
  }

  for (const row of db.prepare("select preview_id, updated_at, label from preview_logs").all() as Array<{ preview_id: string; updated_at: string; label?: string | null }>) {
    const logs = previewLogs.get(row.preview_id) ?? "";
    const preview = previews.get(row.preview_id);
    items.push({
      id: createHash("sha1").update(`preview-log:${row.preview_id}`).digest("hex"),
      type: "preview-log",
      status: previewIds.has(row.preview_id) ? "active" : "orphan",
      label: row.preview_id,
      path: `sqlite:preview_logs/${row.preview_id}`,
      bytes: Buffer.byteLength(logs, "utf8"),
      updatedAt: row.updated_at,
      relatedId: row.preview_id,
      relatedName: row.label ?? preview?.label ?? null,
      relatedType: "preview",
    });
  }

  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items, totalBytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

export function deleteStorageItem(type: string, itemPath: string, force = false) {
  const { db, appData, previewLogs, internalProjectWorkspaceRoot, sessionWorkspaceRoot, taskLogDir, legacyTaskLogPath, legacyTaskMetaPath, deleteSessionDatabaseRows } = deps();
  const item = listStorageItems().items.find((entry) => entry.type === type && entry.path === itemPath);
  if (item?.status === "active" && !force) throw new Error("storage_item_active");
  if (type === "preview-log") {
    const previewId = itemPath.replace(/^sqlite:preview_logs\//, "");
    previewLogs.delete(previewId);
    db.prepare("delete from preview_logs where preview_id = ?").run(previewId);
    return;
  }
  const resolvedPath = resolve(itemPath);
  const allowedRoots = [internalProjectWorkspaceRoot, sessionWorkspaceRoot, join(deps().dataDir, "rooms"), taskLogDir].map((root) => resolve(root));
  if (!allowedRoots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`))) {
    throw new Error("storage_path_not_allowed");
  }
  if (type === "session-data") {
    const sessionId = basename(resolvedPath);
    const session = appData.sessions.find((entry) => entry.id === sessionId);
    const orphanRoomAgent = Boolean(session?.conversationType === "agent" && session.roomId && !db.prepare("select id from rooms where id = ?").get(session.roomId));
    if (orphanRoomAgent) {
      appData.sessions = appData.sessions.filter((entry) => entry.id !== sessionId);
      deleteSessionDatabaseRows(sessionId);
    }
    rmSync(legacyTaskLogPath(sessionId), { force: true });
    rmSync(legacyTaskMetaPath(sessionId), { force: true });
  }
  rmSync(resolvedPath, { recursive: true, force: true });
}

export function writeProjectWorkspaceMetadata(project: ProjectSummary, orphanedAt?: string | null) {
  const { internalProjectWorkspaceRoot, projectWorkspaceMetadataFile, resolveTerminalCwd } = deps();
  const workspacePath = resolveTerminalCwd(project.workspacePath);
  if (!pathWithinRoot(workspacePath, internalProjectWorkspaceRoot)) return;
  if (!existsSync(workspacePath)) mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(workspacePath, projectWorkspaceMetadataFile), `${JSON.stringify({
    id: project.id,
    name: project.name,
    orphanedAt: orphanedAt ?? null,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}
