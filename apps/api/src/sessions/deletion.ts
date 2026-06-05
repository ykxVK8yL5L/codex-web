import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionSummary } from "@codex-web/protocol";

type SessionDeletionServiceDeps = {
  dataDir: string;
  deleteFileMountsForRoot: (rootPath: string) => void;
  legacyTaskLogPath: (sessionId: string) => string;
  legacyTaskMetaPath: (sessionId: string) => string;
  pathWithinRoot: (path: string, root: string) => boolean;
  roomWorkspaceDataPath: (roomId: string) => string;
  sessionContextPath: (sessionId: string) => string;
  sessionDataPath: (sessionId: string) => string;
  sessionWorkspaceRoot: string;
  taskLogPath: (sessionId: string) => string;
  taskMetaPath: (sessionId: string) => string;
};

export function createSessionDeletionService(deps: SessionDeletionServiceDeps) {
  const {
    dataDir,
    deleteFileMountsForRoot,
    legacyTaskLogPath,
    legacyTaskMetaPath,
    pathWithinRoot,
    roomWorkspaceDataPath,
    sessionContextPath,
    sessionDataPath,
    sessionWorkspaceRoot,
    taskLogPath,
    taskMetaPath,
  } = deps;

  function deleteSessionData(session: SessionSummary, deleteWorkspace: boolean, deleteLogs: boolean) {
    const managedWorkspaceRoots = [sessionWorkspaceRoot, join(dataDir, "rooms")];
    const resolvedWorkspace = session.workspacePath ? resolve(session.workspacePath) : "";
    if (resolvedWorkspace && managedWorkspaceRoots.some((root) => pathWithinRoot(resolvedWorkspace, root))) {
      deleteFileMountsForRoot(resolvedWorkspace);
    }
    rmSync(sessionContextPath(session.id), { recursive: true, force: true });
    if (deleteLogs) {
      rmSync(taskLogPath(session.id), { force: true });
      rmSync(taskMetaPath(session.id), { force: true });
      rmSync(legacyTaskLogPath(session.id), { force: true });
      rmSync(legacyTaskMetaPath(session.id), { force: true });
    }
    if (!deleteWorkspace) return;
    const candidates = new Set<string>([sessionDataPath(session.id)]);
    if (session.workspacePath) candidates.add(resolve(session.workspacePath));
    if (session.roomId) candidates.add(roomWorkspaceDataPath(session.roomId));
    for (const candidate of candidates) {
      if (!managedWorkspaceRoots.some((root) => pathWithinRoot(candidate, root))) continue;
      rmSync(candidate, { recursive: true, force: true });
    }
  }

  return { deleteSessionData };
}
