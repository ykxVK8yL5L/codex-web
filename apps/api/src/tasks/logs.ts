import type Database from "better-sqlite3";
import { join } from "node:path";
import type { SessionSummary } from "@codex-web/protocol";

type TaskLogRuntimeDeps = {
  db: Database.Database;
  readTaskLogContent: (sessionId: string) => string;
  sessionLogsPath: (sessionId: string) => string;
  taskLogDir: string;
};

export function createTaskLogRuntime(deps: TaskLogRuntimeDeps) {
  const { db, readTaskLogContent, sessionLogsPath, taskLogDir } = deps;

function taskLogPath(sessionId: string) {
  return join(sessionLogsPath(sessionId), "codex.log");
}

function taskMetaPath(sessionId: string) {
  return join(sessionLogsPath(sessionId), "codex.json");
}

function legacyTaskLogPath(sessionId: string) {
  return join(taskLogDir, `${sessionId}.log`);
}

function legacyTaskMetaPath(sessionId: string) {
  return join(taskLogDir, `${sessionId}.json`);
}

function roomAgentRunLogSources(session: SessionSummary) {
  if (session.conversationType !== "room" || !session.roomId) return [];
  return db.prepare(`
    select agent_runs.id, agent_runs.session_id, agents.name as agent_name, room_tasks.title as task_title, agent_runs.started_at
    from agent_runs
    left join agents on agents.id = agent_runs.agent_id
    left join room_tasks on room_tasks.id = agent_runs.task_id
    where agent_runs.room_id = ? and agent_runs.session_id is not null
    order by agent_runs.started_at desc, agent_runs.id desc
    limit 20
  `).all(session.roomId) as Array<{ id: string; session_id?: string | null; agent_name?: string | null; task_title?: string | null; started_at?: string | null }>;
}

function readRoomTaskLogContent(session: SessionSummary, maxBytes: number) {
  const sections: string[] = [];
  const parent = readTaskLogContent(session.id).trim();
  if (parent) sections.push(["===== Room Session =====", parent].join("\n"));
  const sources = roomAgentRunLogSources(session);
  for (const row of sources.reverse()) {
    const childSessionId = row.session_id ? String(row.session_id) : "";
    if (!childSessionId) continue;
    const content = readTaskLogContent(childSessionId);
    if (!content.trim()) continue;
    const header = [
      `===== ${row.agent_name || "Agent"} / ${row.task_title || row.id} =====`,
      `run: ${row.id}`,
      `session: ${childSessionId}`,
      row.started_at ? `started: ${row.started_at}` : "",
    ].filter(Boolean).join("\n");
    const budget = Math.max(4000, Math.floor(maxBytes / Math.max(1, sources.length)));
    sections.push(`${header}\n${content.length > budget ? content.slice(content.length - budget) : content}`);
  }
  const log = sections.join("\n\n");
  return log.length > maxBytes ? log.slice(log.length - maxBytes) : log;
}



  return {
    legacyTaskLogPath,
    legacyTaskMetaPath,
    readRoomTaskLogContent,
    roomAgentRunLogSources,
    taskLogPath,
    taskMetaPath,
  };
}
