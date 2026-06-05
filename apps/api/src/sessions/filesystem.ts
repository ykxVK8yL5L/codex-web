import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentSummary, ProjectSummary, SessionSummary, TerminalCommandResponse, UploadAttachmentInput } from "@codex-web/protocol";

type RoomRunWorkspace = {
  root: string;
  shared: string;
  agentWorkspace: string;
  projectPath?: string;
};

type SessionFilesystemDeps = {
  appData: { projects: ProjectSummary[]; sessions: SessionSummary[] };
  dataDir: string;
  db: Database.Database;
  ensureGitRepositorySync: (workspacePath: string) => TerminalCommandResponse | void;
  resolveTerminalCwd: (inputPath?: string) => string;
  runGitSync: (cwd: string, args: string[]) => { exitCode: number | null; stdout: string; stderr: string };
  sessionWorkspaceRoot: string;
  upsertSession: (session: SessionSummary) => void;
};

export function createSessionFilesystem(deps: SessionFilesystemDeps) {
  const { appData, dataDir, db, ensureGitRepositorySync, resolveTerminalCwd, runGitSync, sessionWorkspaceRoot, upsertSession } = deps;

function topLevelSessionDataPath(sessionId: string) {
  return resolve(sessionWorkspaceRoot, sessionId);
}

function roomParentSessionId(roomId: string) {
  const row = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  return row?.session_id ?? null;
}

function sessionDataPath(sessionId: string) {
  const row = db.prepare("select conversation_type, room_id from sessions where id = ?").get(sessionId) as { conversation_type?: string | null; room_id?: string | null } | undefined;
  if (row?.conversation_type === "agent" && row.room_id) {
    const parentSessionId = roomParentSessionId(row.room_id);
    if (parentSessionId && parentSessionId !== sessionId) return resolve(topLevelSessionDataPath(parentSessionId), "room", "agent-sessions", sessionId);
  }
  return topLevelSessionDataPath(sessionId);
}

function sessionLogsPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "logs");
}

function sessionCodexMetadataPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), ".codex-web.json");
}

function sessionContextPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "context");
}

function sessionMemoryPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "memory");
}

function sessionAttachmentsPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "attachments");
}

type SavedSessionAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  relativePath: string;
  textPreview?: string;
};

const maxAttachmentFiles = 8;
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxAttachmentTextPreviewChars = 16_000;

function safeAttachmentName(name: string) {
  const base = basename(name || "attachment").replace(/[^\w.\- ()[\]\u4e00-\u9fff]/g, "_").slice(0, 120);
  return base && base !== "." && base !== ".." ? base : "attachment";
}

function readableAttachmentBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentTextPreview(buffer: Buffer, type: string, name: string) {
  const lowerName = name.toLowerCase();
  const looksText = type.startsWith("text/")
    || /(?:\.txt|\.md|\.json|\.csv|\.tsv|\.log|\.xml|\.html|\.css|\.js|\.jsx|\.ts|\.tsx|\.py|\.go|\.rs|\.java|\.c|\.cpp|\.h|\.hpp|\.sh|\.yml|\.yaml|\.toml|\.ini|\.env)$/i.test(lowerName);
  if (!looksText) return "";
  const text = buffer.toString("utf8").replace(/\u0000/g, "");
  return text.length > maxAttachmentTextPreviewChars ? `${text.slice(0, maxAttachmentTextPreviewChars)}\n... [truncated]` : text;
}

function saveSessionAttachments(sessionId: string, inputs?: UploadAttachmentInput[] | null) {
  const items = (inputs ?? []).filter((item) => item?.dataBase64 && item.name).slice(0, maxAttachmentFiles);
  if (!items.length) return [] as SavedSessionAttachment[];
  const root = sessionAttachmentsPath(sessionId);
  mkdirSync(root, { recursive: true });
  return items.map((item) => {
    const name = safeAttachmentName(item.name);
    const type = item.type?.trim() || "application/octet-stream";
    const buffer = Buffer.from(item.dataBase64, "base64");
    if (buffer.length > maxAttachmentBytes) throw new Error("attachment_too_large");
    const id = `attachment-${randomUUID()}`;
    const filename = `${id}-${name}`;
    const target = resolve(root, filename);
    if (!target.startsWith(`${root}/`)) throw new Error("invalid_attachment_path");
    writeFileSync(target, buffer);
    const relativePath = `attachments/${filename}`;
    const textPreview = attachmentTextPreview(buffer, type, name);
    return {
      id,
      name,
      type,
      size: buffer.length,
      path: target,
      relativePath,
      textPreview: textPreview || undefined,
    };
  });
}

function attachmentMarkdown(attachments: SavedSessionAttachment[], options: { includePreview: boolean }) {
  if (!attachments.length) return "";
  return [
    "## Attachments",
    ...attachments.flatMap((attachment, index) => [
      `${index + 1}. ${attachment.name}`,
      `   - path: ${attachment.path}`,
      `   - session path: ${attachment.relativePath}`,
      `   - type: ${attachment.type}`,
      `   - size: ${readableAttachmentBytes(attachment.size)}`,
      options.includePreview && attachment.textPreview ? "   - text preview:" : "",
      options.includePreview && attachment.textPreview ? attachment.textPreview.split("\n").map((line) => `     ${line}`).join("\n") : "",
    ]),
  ].filter((line) => line !== "").join("\n");
}

function promptWithAttachments(prompt: string, attachments: SavedSessionAttachment[]) {
  const attachmentBlock = attachmentMarkdown(attachments, { includePreview: true });
  return attachmentBlock ? `${prompt.trim()}\n\n${attachmentBlock}` : prompt.trim();
}

function messageWithAttachments(prompt: string, attachments: SavedSessionAttachment[]) {
  const attachmentBlock = attachmentMarkdown(attachments, { includePreview: false });
  return attachmentBlock ? `${prompt.trim()}\n\n${attachmentBlock}` : prompt.trim();
}

function writeSessionContextFile(sessionId: string, name: string, content: string) {
  const root = sessionContextPath(sessionId);
  mkdirSync(root, { recursive: true });
  const target = resolve(root, name);
  writeFileSync(target, content, "utf8");
  return target;
}

function resetSessionContextFiles(sessionId: string) {
  const root = sessionContextPath(sessionId);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

function writeSessionMetadata(session: SessionSummary) {
  try {
    mkdirSync(sessionDataPath(session.id), { recursive: true });
    const project = session.projectId ? appData.projects.find((item) => item.id === session.projectId) : null;
    const payload = JSON.stringify({
      id: session.id,
      title: session.title,
      kind: session.kind,
      sessionType: session.conversationType ?? null,
      projectId: session.projectId ?? null,
      projectName: project?.name ?? null,
      updatedAt: new Date().toISOString(),
    }, null, 2);
    writeFileSync(sessionCodexMetadataPath(session.id), payload, "utf8");
  } catch {
    return;
  }
}

function migrateLegacyScratchSessionWorkspace(sessionId: string) {
  const root = sessionDataPath(sessionId);
  const workspace = resolve(root, "workspace");
  if (!existsSync(root) || existsSync(workspace)) return;
  const entries = readdirSync(root).filter((name) => !["logs", "artifacts", ".codex-web.json", "workspace"].includes(name));
  if (!entries.length) return;
  mkdirSync(workspace, { recursive: true });
  for (const name of entries) {
    try {
      renameSync(resolve(root, name), resolve(workspace, name));
    } catch {
      return;
    }
  }
}

function scratchSessionWorkspacePath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "workspace");
}

function ensureScratchSessionWorkspace(sessionId: string) {
  migrateLegacyScratchSessionWorkspace(sessionId);
  const workspacePath = scratchSessionWorkspacePath(sessionId);
  mkdirSync(workspacePath, { recursive: true });
  ensureGitRepositorySync(workspacePath);
  return workspacePath;
}

function migrateRoomAgentSessionDataRoots() {
  const rows = db.prepare(`
    select id
    from sessions
    where conversation_type = 'agent'
      and room_id is not null
  `).all() as Array<{ id: string }>;
  for (const row of rows) {
    const source = topLevelSessionDataPath(row.id);
    const target = sessionDataPath(row.id);
    if (resolve(source) === resolve(target) || !existsSync(source)) continue;
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) {
      try {
        renameSync(source, target);
        continue;
      } catch {
        // Fall through to best-effort merge below.
      }
    }
    try {
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(source)) {
        const from = resolve(source, name);
        const to = resolve(target, name);
        if (existsSync(to)) continue;
        renameSync(from, to);
      }
      rmSync(source, { recursive: true, force: true });
    } catch {
      // Leave the original directory in place if migration cannot safely finish.
    }
  }
}

function roomWorkspaceDataPath(roomId: string) {
  const parentSessionId = roomParentSessionId(roomId);
  return parentSessionId ? resolve(topLevelSessionDataPath(parentSessionId), "room") : resolve(dataDir, "rooms", roomId);
}

function migrateRoomWorkspaceRoots() {
  const rows = db.prepare("select id, session_id from rooms").all() as Array<{ id: string; session_id?: string | null }>;
  for (const room of rows) {
    if (!room.session_id) continue;
    const source = resolve(dataDir, "rooms", room.id);
    const target = roomWorkspaceDataPath(room.id);
    if (resolve(source) === resolve(target) || !existsSync(source)) continue;
    mkdirSync(target, { recursive: true });
    let fullyMoved = true;
    for (const name of readdirSync(source)) {
      const from = resolve(source, name);
      const to = resolve(target, name);
      if (existsSync(to)) {
        fullyMoved = false;
        continue;
      }
      try {
        renameSync(from, to);
      } catch {
        fullyMoved = false;
      }
    }
    if (fullyMoved) rmSync(source, { recursive: true, force: true });
    const oldPrefix = `${source}/`;
    const newPrefix = `${target}/`;
    for (const run of db.prepare("select id, workspace_path from agent_runs where room_id = ? and workspace_path is not null and workspace_path != ''").all(room.id) as Array<{ id: string; workspace_path: string }>) {
      if (resolve(run.workspace_path) === source || run.workspace_path.startsWith(oldPrefix)) {
        const nextPath = resolve(run.workspace_path) === source ? target : `${newPrefix}${run.workspace_path.slice(oldPrefix.length)}`;
        db.prepare("update agent_runs set workspace_path = ? where id = ?").run(nextPath, run.id);
      }
    }
    for (const thread of db.prepare("select room_id, agent_id, workspace_path from room_agent_threads where room_id = ? and workspace_path is not null and workspace_path != ''").all(room.id) as Array<{ room_id: string; agent_id: string; workspace_path: string }>) {
      if (resolve(thread.workspace_path) === source || thread.workspace_path.startsWith(oldPrefix)) {
        const nextPath = resolve(thread.workspace_path) === source ? target : `${newPrefix}${thread.workspace_path.slice(oldPrefix.length)}`;
        db.prepare("update room_agent_threads set workspace_path = ?, updated_at = ? where room_id = ? and agent_id = ?").run(nextPath, new Date().toISOString(), thread.room_id, thread.agent_id);
      }
    }
    for (const session of appData.sessions) {
      if (!session.workspacePath || !(resolve(session.workspacePath) === source || session.workspacePath.startsWith(oldPrefix))) continue;
      session.workspacePath = resolve(session.workspacePath) === source ? target : `${newPrefix}${session.workspacePath.slice(oldPrefix.length)}`;
      upsertSession(session);
    }
  }
}

type RoomRunWorkspace = {
  root: string;
  shared: string;
  agentWorkspace: string;
  projectPath?: string;
};

function ensureRoomWorkspace(roomId: string, agentId: string): RoomRunWorkspace {
  const root = roomWorkspaceDataPath(roomId);
  const shared = resolve(root, "shared");
  const agentWorkspace = resolve(root, "agents", agentId);
  mkdirSync(shared, { recursive: true });
  mkdirSync(agentWorkspace, { recursive: true });
  ensureGitRepositorySync(agentWorkspace);
  return { root, shared, agentWorkspace };
}

function ensureRoomRunWorkspace(roomRow: Record<string, unknown>, agent: AgentSummary, taskId: string): RoomRunWorkspace {
  const base = ensureRoomWorkspace(String(roomRow.id), agent.id);
  const project = roomRow.project_id ? appData.projects.find((item) => item.id === String(roomRow.project_id)) : null;
  if (!project) return base;
  const projectPath = resolveTerminalCwd(project.workspacePath);
  const projectRoot = runGitSync(projectPath, ["rev-parse", "--show-toplevel"]);
  if (projectRoot.exitCode !== 0 || resolve(projectRoot.stdout.trim()) !== projectPath) return base;
  const useProjectWorktree = agent.workspaceMode !== "shared-write" && agent.workspaceMode !== "merge-workspace";
  if (!useProjectWorktree) return { ...base, projectPath };
  const worktree = resolve(base.root, "worktrees", `${agent.id}-${taskId}`);
  if (!existsSync(worktree)) {
    mkdirSync(dirname(worktree), { recursive: true });
    const branch = `codex-room/${String(roomRow.id).slice(0, 12)}/${agent.id.slice(0, 18)}/${taskId.slice(-8)}`;
    const result = runGitSync(projectPath, ["worktree", "add", "-B", branch, worktree, "HEAD"]);
    if (result.exitCode !== 0) return { ...base, projectPath };
  }
  return { ...base, agentWorkspace: worktree, projectPath };
}

function resolveSessionWorkspace(session: SessionSummary) {
  const project = session.projectId ? appData.projects.find((item) => item.id === session.projectId) : null;
  const roomAgentRun = session.conversationType === "agent" && session.roomId
    ? db.prepare("select workspace_path from agent_runs where session_id = ? and workspace_path is not null and workspace_path != '' order by started_at desc limit 1").get(session.id) as { workspace_path?: string | null } | undefined
    : null;
  const workspacePath = project?.workspacePath
    ? resolveTerminalCwd(project.workspacePath)
    : roomAgentRun?.workspace_path
      ? resolveTerminalCwd(String(roomAgentRun.workspace_path))
      : session.workspacePath
        ? resolveTerminalCwd(session.workspacePath)
        : ensureScratchSessionWorkspace(session.id);
  if (!project && !roomAgentRun?.workspace_path && workspacePath === scratchSessionWorkspacePath(session.id)) ensureGitRepositorySync(workspacePath);
  if (session.workspacePath !== workspacePath || (project && session.kind !== "project") || (!project && !roomAgentRun?.workspace_path && session.kind !== "scratch")) {
    session.workspacePath = workspacePath;
    if (project) {
      session.kind = "project";
    } else if (!roomAgentRun?.workspace_path) {
      session.projectId = null;
      session.kind = "scratch";
    }
    session.updatedAt = new Date().toISOString();
    upsertSession(session);
  }
  return workspacePath;
}



  return {
    attachmentMarkdown,
    ensureRoomRunWorkspace,
    ensureRoomWorkspace,
    ensureScratchSessionWorkspace,
    messageWithAttachments,
    migrateLegacyScratchSessionWorkspace,
    migrateRoomAgentSessionDataRoots,
    migrateRoomWorkspaceRoots,
    promptWithAttachments,
    resetSessionContextFiles,
    resolveSessionWorkspace,
    roomParentSessionId,
    roomWorkspaceDataPath,
    saveSessionAttachments,
    scratchSessionWorkspacePath,
    sessionAttachmentsPath,
    sessionCodexMetadataPath,
    sessionContextPath,
    sessionDataPath,
    sessionLogsPath,
    sessionMemoryPath,
    topLevelSessionDataPath,
    writeSessionContextFile,
    writeSessionMetadata,
  };
}
