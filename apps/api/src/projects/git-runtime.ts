import type Database from "better-sqlite3";
import { spawn as spawnProcess, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { ProjectGitOperationRequest, ProjectSummary, SessionSummary, TerminalCommandResponse, WorkspaceChangeFile, WorkspaceChanges } from "@codex-web/protocol";

type ProjectGitRuntimeDeps = {
  appData: { projects: ProjectSummary[]; sessions: SessionSummary[] };
  db: Database.Database;
  deletePreviewsForScope: (scopeType: "session" | "project" | "folder", scopeId: string) => number;
  ensureScratchSessionWorkspace: (sessionId: string) => string;
  managedChildEnv: () => NodeJS.ProcessEnv;
  resolveSessionCwd: (session: SessionSummary) => string;
  resolveTerminalCwd: (inputPath?: string) => string;
  saveAppData: () => void;
  terminalRoot: string;
  upsertProject: (project: ProjectSummary) => void;
  upsertSession: (session: SessionSummary) => void;
  writeProjectWorkspaceMetadata: (project: ProjectSummary, updatedAt: string) => void;
};

export function createProjectGitRuntime(deps: ProjectGitRuntimeDeps) {
  const { appData, db, deletePreviewsForScope, ensureScratchSessionWorkspace, managedChildEnv, resolveSessionCwd, resolveTerminalCwd, saveAppData, terminalRoot, upsertProject, upsertSession, writeProjectWorkspaceMetadata } = deps;

function runGitCommand(cwd: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolveResult) => {
    const child = spawnProcess("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-120 * 1024);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-32 * 1024);
    });
    child.on("error", (error) => resolveResult({ stdout, stderr: error.message, exitCode: null }));
    child.on("close", (exitCode) => resolveResult({ stdout, stderr, exitCode }));
  });
}

function hasGitCommand() {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function ensureGitRepositorySync(workspacePath: string) {
  if (!hasGitCommand()) return;
  try {
    const cwd = resolveTerminalCwd(workspacePath);
    if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) return;
    const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (probe.status === 0 && resolve(probe.stdout.trim()) === cwd) return;
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  } catch {
    return;
  }
}

async function ensureGitRepositoryForProject(workspacePath: string) {
  if (!hasGitCommand()) return;
  let cwd = "";
  try {
    cwd = resolveTerminalCwd(workspacePath);
    if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) return;
  } catch {
    return;
  }
  const probe = await runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
  if (probe.exitCode === 0 && resolve(probe.stdout.trim()) === cwd) return;
  await runGitCommand(cwd, ["init"]);
}

async function refreshProjectGitStatus(project: ProjectSummary) {
  try {
    const cwd = resolveTerminalCwd(project.workspacePath);
      const status = await runGitCommand(cwd, ["status", "--short", "--", "."]);
    if (status.exitCode !== 0) {
      project.changedFiles = 0;
      project.stagedFiles = 0;
      project.modifiedFiles = 0;
      project.untrackedFiles = 0;
      project.gitStatus = "not-git";
      project.gitBranch = undefined;
      project.gitRemoteStatus = undefined;
    } else {
      const branch = await runGitCommand(cwd, ["branch", "--show-current"]);
      const statusBranch = await runGitCommand(cwd, ["status", "-sb"]);
      const lines = status.stdout.split(/\r?\n/).filter((line) => line.trim());
      project.changedFiles = lines.length;
      project.stagedFiles = lines.filter((line) => line[0] && line[0] !== " " && line[0] !== "?").length;
      project.modifiedFiles = lines.filter((line) => line[1] && line[1] !== " ").length;
      project.untrackedFiles = lines.filter((line) => line.startsWith("??")).length;
      project.gitStatus = project.changedFiles > 0 ? "dirty" : "clean";
      project.gitBranch = branch.stdout.trim() || "detached";
      project.gitRemoteStatus = readGitRemoteStatus(statusBranch.stdout);
    }
    upsertProject(project);
  } catch {
    project.changedFiles = 0;
    project.stagedFiles = 0;
    project.modifiedFiles = 0;
    project.untrackedFiles = 0;
    project.gitStatus = "error";
  }
  return project;
}

function readGitRemoteStatus(statusBranch: string) {
  const firstLine = statusBranch.split(/\r?\n/)[0] ?? "";
  const remotePart = firstLine.replace(/^##\s*/, "").split("...")[1];
  if (!remotePart) return "no upstream";
  const match = remotePart.match(/^([^\s]+)(?:\s+\[(.+)\])?$/);
  if (!match) return remotePart;
  return match[2] ? `${match[1]} · ${match[2]}` : match[1];
}

function parseShortStatusLine(line: string) {
  const status = line.slice(0, 2).trim() || line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
  return { status, path: renamedPath.replace(/^"|"$/g, "") };
}

function parseNumstat(stat: string) {
  const items = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const line of stat.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [added, deleted, rawPath] = line.split(/\t/);
    if (!rawPath) continue;
    const binary = added === "-" || deleted === "-";
    const previous = items.get(rawPath) ?? { additions: 0, deletions: 0, binary: false };
    items.set(rawPath, {
      additions: previous.additions + (binary ? 0 : Number(added) || 0),
      deletions: previous.deletions + (binary ? 0 : Number(deleted) || 0),
      binary: previous.binary || binary,
    });
  }
  return items;
}

async function readTextFileIfSmall(cwd: string, filePath: string) {
  const absolutePath = resolve(cwd, filePath);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) return { binary: false, content: "" };
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > 512 * 1024) return { binary: stat.isFile(), content: "" };
    const content = readFileSync(absolutePath, "utf8");
    if (content.includes("\u0000")) return { binary: true, content: "" };
    return { binary: false, content };
  } catch {
    return { binary: false, content: "" };
  }
}

async function collectWorkspaceChangesForCwd(cwd: string): Promise<WorkspaceChanges> {
  const repo = await runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
  if (repo.exitCode !== 0) {
    return {
      ok: false,
      cwd,
      isGitRepo: false,
      summary: { filesChanged: 0, additions: 0, deletions: 0 },
      files: [],
      raw: { status: "", stat: "", diff: "" },
      error: repo.stderr || "not_a_git_repository",
    };
  }
  const status = await runGitCommand(cwd, ["status", "--short", "--", "."]);
  const numstat = await runGitCommand(cwd, ["diff", "--relative", "--numstat", "--", "."]);
  const cachedNumstat = await runGitCommand(cwd, ["diff", "--relative", "--cached", "--numstat", "--", "."]);
  const diff = await runGitCommand(cwd, ["diff", "--", "."]);
  const cachedDiff = await runGitCommand(cwd, ["diff", "--cached", "--", "."]);
  const untracked = await runGitCommand(cwd, ["ls-files", "--others", "--exclude-standard", "--", "."]);
  const stats = parseNumstat(`${numstat.stdout}\n${cachedNumstat.stdout}`);
  const statusItems = status.stdout.split(/\r?\n/).filter(Boolean).map(parseShortStatusLine);
  for (const path of untracked.stdout.split(/\r?\n/).filter(Boolean)) {
    if (!statusItems.some((item) => item.path === path)) statusItems.push({ status: "??", path });
  }
  const files: WorkspaceChangeFile[] = [];
  for (const item of statusItems) {
    let stat = stats.get(item.path) ?? { additions: 0, deletions: 0, binary: false };
    let patch = "";
    let newContent: string | undefined;
    let binary = stat.binary;
    if (item.status === "??") {
      const file = await readTextFileIfSmall(cwd, item.path);
      binary = file.binary;
      newContent = file.content || undefined;
      if (file.content) {
        const lines = file.content.split(/\r?\n/);
        stat = { additions: lines.length, deletions: 0, binary: false };
        patch = [`--- /dev/null`, `+++ b/${item.path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
      }
    } else {
      const fileDiff = await runGitCommand(cwd, ["diff", "--", item.path]);
      const cachedFileDiff = await runGitCommand(cwd, ["diff", "--cached", "--", item.path]);
      patch = [cachedFileDiff.stdout, fileDiff.stdout].filter(Boolean).join("\n");
    }
    files.push({ path: item.path, status: item.status, additions: stat.additions, deletions: stat.deletions, patch, newContent, binary });
  }
  const summary = files.reduce(
    (total, file) => ({
      filesChanged: total.filesChanged + 1,
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { filesChanged: 0, additions: 0, deletions: 0 },
  );
  return {
    ok: status.exitCode === 0,
    cwd,
    isGitRepo: true,
    summary,
    files,
    raw: { status: status.stdout, stat: `${numstat.stdout}\n${cachedNumstat.stdout}`.trim(), diff: [cachedDiff.stdout, diff.stdout].filter(Boolean).join("\n") },
    error: status.exitCode === 0 ? undefined : status.stderr || "git_status_failed",
  };
}

async function collectRoomWorkspaceChanges(session: SessionSummary): Promise<WorkspaceChanges> {
  const parent = await collectWorkspaceChangesForCwd(resolveSessionCwd(session));
  if (!session.roomId) return parent;
  const parentCwd = resolve(parent.cwd);
  const rows = db.prepare(`
    select agent_runs.id, agent_runs.workspace_path, agents.name as agent_name
    from agent_runs
    left join agents on agents.id = agent_runs.agent_id
    where agent_runs.room_id = ? and agent_runs.workspace_path is not null and agent_runs.workspace_path != ''
    order by agent_runs.started_at desc, agent_runs.id desc
    limit 20
  `).all(session.roomId) as Array<{ id: string; workspace_path?: string | null; agent_name?: string | null }>;
  const files: WorkspaceChangeFile[] = [...parent.files];
  const rawStatus = [parent.raw.status].filter(Boolean);
  const rawStat = [parent.raw.stat].filter(Boolean);
  const rawDiff = [parent.raw.diff].filter(Boolean);
  let sawGitRepo = parent.isGitRepo;
  const seenWorkspaces = new Set([parentCwd]);
  for (const row of rows) {
    const cwd = row.workspace_path ? resolveTerminalCwd(String(row.workspace_path)) : "";
    if (!cwd || seenWorkspaces.has(resolve(cwd)) || !existsSync(cwd)) continue;
    seenWorkspaces.add(resolve(cwd));
    const changes = await collectWorkspaceChangesForCwd(cwd);
    sawGitRepo = sawGitRepo || changes.isGitRepo;
    if (!changes.files.length) continue;
    const label = row.agent_name ? String(row.agent_name) : String(row.id);
    files.push(...changes.files.map((file) => ({
      ...file,
      path: `${label}/${file.path}`,
      sourcePath: file.path,
      sourceCwd: cwd,
      sourceLabel: label,
      sourceRunId: String(row.id),
    })));
    if (changes.raw.status) rawStatus.push(`# ${label} (${cwd})\n${changes.raw.status}`);
    if (changes.raw.stat) rawStat.push(`# ${label} (${cwd})\n${changes.raw.stat}`);
    if (changes.raw.diff) rawDiff.push(`# ${label} (${cwd})\n${changes.raw.diff}`);
  }
  const summary = files.reduce(
    (total, file) => ({
      filesChanged: total.filesChanged + 1,
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { filesChanged: 0, additions: 0, deletions: 0 },
  );
  return {
    ok: parent.ok || sawGitRepo,
    cwd: parent.cwd,
    isGitRepo: sawGitRepo,
    summary,
    files,
    raw: { status: rawStatus.join("\n\n"), stat: rawStat.join("\n\n"), diff: rawDiff.join("\n\n") },
    error: sawGitRepo ? undefined : parent.error,
  };
}

async function collectWorkspaceChanges(session: SessionSummary): Promise<WorkspaceChanges> {
  if (session.conversationType === "room") return collectRoomWorkspaceChanges(session);
  return collectWorkspaceChangesForCwd(resolveSessionCwd(session));
}

function deleteProjectRecord(projectId: string, deleteFiles: boolean) {
  const index = appData.projects.findIndex((item) => item.id === projectId);
  if (index === -1) throw new Error("project_not_found");

  const project = appData.projects[index];
  if (deleteFiles) {
    const absolutePath = resolveTerminalCwd(project.workspacePath);
    const protectedPaths = new Set([resolve("/"), resolve(process.env.HOME ?? "/"), terminalRoot]);
    if (protectedPaths.has(absolutePath)) throw new Error("refuse_delete_protected_path");
    if (existsSync(absolutePath)) rmSync(absolutePath, { recursive: true, force: true });
  } else {
    writeProjectWorkspaceMetadata(project, new Date().toISOString());
  }

  const [removedProject] = appData.projects.splice(index, 1);
  for (const session of appData.sessions) {
    if (session.projectId !== removedProject.id) continue;
    deletePreviewsForScope("session", session.id);
    session.projectId = null;
    session.kind = "scratch";
    session.workspacePath = ensureScratchSessionWorkspace(session.id);
    session.updatedAt = new Date().toISOString();
    upsertSession(session);
  }
  deletePreviewsForScope("project", removedProject.id);
  db.prepare("delete from project_check_runs where project_id = ?").run(removedProject.id);
  db.prepare("delete from project_git_operations where project_id = ?").run(removedProject.id);
  db.prepare("delete from projects where id = ?").run(removedProject.id);
  return { ok: true, id: removedProject.id, deletedFiles: deleteFiles };
}

function assertWorkspaceChangePath(changes: WorkspaceChanges, filePath: string) {
  const change = changes.files.find((item) => item.path === filePath);
  if (!change) throw new Error("change_not_found");
  const absolutePath = resolve(changes.cwd, filePath);
  const relativePath = relative(changes.cwd, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_workspace");
  return { change, absolutePath };
}

function resolveWorkspaceChangeActionCwd(session: SessionSummary, cwd?: string | null) {
  if (!cwd) return resolveSessionCwd(session);
  const resolved = resolveTerminalCwd(cwd);
  if (session.conversationType !== "room" || !session.roomId) throw new Error("path_outside_workspace");
  const row = db.prepare("select workspace_path from agent_runs where room_id = ? and workspace_path = ? limit 1").get(session.roomId, resolved) as { workspace_path?: string } | undefined;
  if (!row) throw new Error("path_outside_workspace");
  return resolved;
}

async function applyWorkspaceGitFileAction(cwd: string, filePath: string, action: "stage" | "unstage") {
  const changes = await collectWorkspaceChangesForCwd(cwd);
  assertWorkspaceChangePath(changes, filePath);
  const args = action === "stage" ? ["add", "--", filePath] : ["restore", "--staged", "--", filePath];
  const result = await runGitCommand(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr || `git_${action}_failed`);
  return collectWorkspaceChangesForCwd(cwd);
}



  return {
    applyWorkspaceGitFileAction,
    assertWorkspaceChangePath,
    collectRoomWorkspaceChanges,
    collectWorkspaceChanges,
    collectWorkspaceChangesForCwd,
    deleteProjectRecord,
    ensureGitRepositoryForProject,
    ensureGitRepositorySync,
    hasGitCommand,
    parseNumstat,
    parseShortStatusLine,
    readGitRemoteStatus,
    readTextFileIfSmall,
    refreshProjectGitStatus,
    resolveWorkspaceChangeActionCwd,
    runGitCommand,
  };
}
