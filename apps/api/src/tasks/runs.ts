import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  SessionSummary,
  PageResponse,
  TaskActivitySummary,
  TaskHealthResponse,
  TaskRunSummary,
} from "@codex-web/protocol";

type CursorValue = string | null | undefined;

type TaskRunStoreDeps = {
  db: Database.Database;
  findSessionById: (sessionId: string) => SessionSummary | undefined;
  isProcessAlive: (pid?: number | null) => boolean;
  parsePageLimit: (value: string) => number;
  decodePageCursor: (value?: CursorValue) => { sortValue: string; id: string } | null;
  pageFromRows: <T extends { id: string }>(rows: T[], limit: number, getSortValue: (item: T) => string) => PageResponse<T>;
  readTaskMeta: (sessionId: string) => { running?: boolean; exitCode?: number | null; error?: string | null; childPid?: number | null } | null;
  taskLogBytes: (sessionId: string) => number;
};

let taskRunStoreDeps: TaskRunStoreDeps | null = null;

export function setTaskRunStoreDeps(nextDeps: TaskRunStoreDeps) {
  taskRunStoreDeps = nextDeps;
}

function deps() {
  if (!taskRunStoreDeps) throw new Error("task_run_store_not_initialized");
  return taskRunStoreDeps;
}

export function taskRunFromRow(row: Record<string, unknown>): TaskRunSummary {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: String(row.status) as TaskRunSummary["status"],
    pid: row.pid === null || row.pid === undefined ? null : Number(row.pid),
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    stopRequested: Boolean(row.stop_requested),
    interruptedReason: row.interrupted_reason ? String(row.interrupted_reason) : null,
    promptChars: row.prompt_chars === null || row.prompt_chars === undefined ? null : Number(row.prompt_chars),
    promptHash: row.prompt_hash ? String(row.prompt_hash) : null,
    contextPath: row.context_path ? String(row.context_path) : null,
  };
}

export function taskActivityFromRow(row: Record<string, unknown>): TaskActivitySummary {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    activityId: row.activity_id ? String(row.activity_id) : null,
    kind: String(row.kind) as TaskActivitySummary["kind"],
    label: String(row.label),
    detail: row.detail ? String(row.detail) : null,
    status: row.status ? String(row.status) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createTaskRun(sessionId: string, pid?: number, metadata?: { promptChars?: number; promptHash?: string; contextPath?: string; messageId?: string | null }) {
  const { db } = deps();
  const id = `task-run-${randomUUID()}`;
  db.prepare(`
    insert into task_runs (id, session_id, status, pid, started_at, stop_requested, prompt_chars, prompt_hash, context_path, message_id)
    values (?, ?, 'running', ?, ?, 0, ?, ?, ?, ?)
  `).run(id, sessionId, pid ?? null, new Date().toISOString(), metadata?.promptChars ?? null, metadata?.promptHash ?? null, metadata?.contextPath ?? null, metadata?.messageId ?? null);
  return id;
}

export function updateTaskRunPid(runId: string, pid?: number | null) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return;
  const { db } = deps();
  db.prepare("update task_runs set pid = ? where id = ? and status = 'running'").run(pid, runId);
}

export function latestRunningTaskRun(sessionId: string) {
  const { db } = deps();
  return db.prepare(`
    select * from task_runs
    where session_id = ? and status = 'running'
    order by started_at desc, id desc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
}

export function finishTaskRun(sessionId: string, status: TaskRunSummary["status"], exitCode: number | null, reason?: string) {
  const { db } = deps();
  db.prepare(`
    update task_runs
    set status = ?, ended_at = ?, exit_code = ?, interrupted_reason = coalesce(?, interrupted_reason)
    where session_id = ? and status = 'running'
  `).run(status, new Date().toISOString(), exitCode, reason ?? null, sessionId);
}

export function finishTaskRunById(runId: string, status: TaskRunSummary["status"], exitCode: number | null, reason?: string) {
  const { db } = deps();
  db.prepare(`
    update task_runs
    set status = ?, ended_at = ?, exit_code = ?, interrupted_reason = coalesce(?, interrupted_reason)
    where id = ?
  `).run(status, new Date().toISOString(), exitCode, reason ?? null, runId);
}

export function markTaskRunStopRequested(sessionId: string) {
  const { db } = deps();
  db.prepare("update task_runs set stop_requested = 1 where session_id = ? and status = 'running'").run(sessionId);
}

export function listTaskRuns(status?: string, limit = 50, cursorValue?: CursorValue) {
  const { db, decodePageCursor, pageFromRows } = deps();
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(status ? ["status = @status"] : []),
    ...(cursor ? ["(started_at < @cursorSort or (started_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from task_runs
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by started_at desc, id desc
    limit @limit
  `).all({ status, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 });
  return pageFromRows((rows as Array<Record<string, unknown>>).map(taskRunFromRow), limit, (item) => item.startedAt);
}

export function listTaskRunsForSession(sessionId: string, limit = 30, cursorValue?: CursorValue) {
  const { db, decodePageCursor, pageFromRows, findSessionById } = deps();
  const session = findSessionById(sessionId);
  const cursor = decodePageCursor(cursorValue);
  if (session?.conversationType === "room" && session.roomId) {
    const rows = db.prepare(`
      select task_runs.*
      from task_runs
      inner join agent_runs on agent_runs.session_id = task_runs.session_id
      where agent_runs.room_id = @roomId
        ${cursor ? "and (task_runs.started_at < @cursorSort or (task_runs.started_at = @cursorSort and task_runs.id < @cursorId))" : ""}
      order by task_runs.started_at desc, task_runs.id desc
      limit @limit
    `).all({ roomId: session.roomId, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
    return pageFromRows(rows.map(taskRunFromRow), limit, (item) => item.startedAt);
  }
  const rows = db.prepare(`
    select * from task_runs
    where session_id = @sessionId
      ${cursor ? "and (started_at < @cursorSort or (started_at = @cursorSort and id < @cursorId))" : ""}
    order by started_at desc, id desc
    limit @limit
  `).all({ sessionId, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(taskRunFromRow), limit, (item) => item.startedAt);
}

export function listTaskHealth(): TaskHealthResponse {
  const { db, findSessionById, readTaskMeta, taskLogBytes, isProcessAlive } = deps();
  const rows = db.prepare(`
    select *
    from task_runs
    where status = 'running'
    order by started_at desc, id desc
    limit 100
  `).all() as Array<Record<string, unknown>>;
  const items = rows.map((row) => {
    const run = taskRunFromRow(row);
    const session = findSessionById(run.sessionId);
    const meta = readTaskMeta(run.sessionId);
    const pidAlive = isProcessAlive(run.pid);
    const childPid = typeof meta?.childPid === "number" ? meta.childPid : null;
    const childPidAlive = childPid ? isProcessAlive(childPid) : null;
    let issue: string | null = null;
    if (!session) issue = "session_missing";
    else if (session.status !== "running") issue = "session_not_running";
    else if (meta?.running === false) issue = "runner_finished";
    else if (!pidAlive) issue = "runner_pid_missing";
    return {
      sessionId: run.sessionId,
      title: session?.title ?? run.sessionId,
      sessionStatus: session?.status ?? "interrupted",
      runId: run.id,
      runStatus: run.status,
      pid: run.pid,
      pidAlive,
      runnerRunning: typeof meta?.running === "boolean" ? meta.running : null,
      runnerExitCode: typeof meta?.exitCode === "number" ? meta.exitCode : null,
      childPid,
      childPidAlive,
      logBytes: taskLogBytes(run.sessionId),
      updatedAt: session?.updatedAt ?? run.startedAt,
      issue,
    };
  });
  return { ok: items.every((item) => !item.issue), checkedAt: new Date().toISOString(), items };
}
