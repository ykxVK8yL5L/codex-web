import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

type TaskStorageDeps = {
  sessionLogsPath: (sessionId: string) => string;
  taskLogPath: (sessionId: string) => string;
  legacyTaskLogPath: (sessionId: string) => string;
  taskMetaPath: (sessionId: string) => string;
  legacyTaskMetaPath: (sessionId: string) => string;
};

export function createTaskStorage(deps: TaskStorageDeps) {
  function readTaskLogContent(sessionId: string) {
    const path = deps.taskLogPath(sessionId);
    if (existsSync(path)) return readFileSync(path, "utf8");
    const legacyPath = deps.legacyTaskLogPath(sessionId);
    return existsSync(legacyPath) ? readFileSync(legacyPath, "utf8") : "";
  }

  function appendCodexOutput(sessionId: string, value: string) {
    mkdirSync(deps.sessionLogsPath(sessionId), { recursive: true });
    appendFileSync(deps.taskLogPath(sessionId), value, "utf8");
  }

  function readTaskExitCode(sessionId: string) {
    const path = deps.taskMetaPath(sessionId);
    const metaPath = existsSync(path) ? path : deps.legacyTaskMetaPath(sessionId);
    if (!existsSync(metaPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as { exitCode?: number | null };
      return typeof parsed.exitCode === "number" ? parsed.exitCode : null;
    } catch {
      return null;
    }
  }

  function readTaskMeta(sessionId: string) {
    const path = deps.taskMetaPath(sessionId);
    const metaPath = existsSync(path) ? path : deps.legacyTaskMetaPath(sessionId);
    if (!existsSync(metaPath)) return null;
    try {
      return JSON.parse(readFileSync(metaPath, "utf8")) as { exitCode?: number | null; running?: boolean; error?: string | null; runnerPid?: number | null; childPid?: number | null };
    } catch {
      return null;
    }
  }

  function writeTaskExitCode(sessionId: string, exitCode: number | null) {
    mkdirSync(deps.sessionLogsPath(sessionId), { recursive: true });
    const previous = readTaskMeta(sessionId) ?? {};
    writeFileSync(deps.taskMetaPath(sessionId), JSON.stringify({ ...previous, running: false, exitCode, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  }

  function taskLogBytes(sessionId: string) {
    const path = deps.taskLogPath(sessionId);
    return existsSync(path) ? readFileSync(path).byteLength : 0;
  }

  return { readTaskLogContent, appendCodexOutput, readTaskExitCode, readTaskMeta, writeTaskExitCode, taskLogBytes };
}
