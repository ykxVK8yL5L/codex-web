import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ProjectCheckRunSummary,
  ProjectGitOperationRequest,
  ProjectGitOperationSummary,
  ProjectGitOperationType,
  ProjectSummary,
  TerminalCommandResponse,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows } from "../pagination.js";

type ProjectHistoryDeps = {
  db: Database.Database;
  projectCheckRunFromRow: (row: Record<string, unknown>) => ProjectCheckRunSummary;
  projectGitOperationFromRow: (row: Record<string, unknown>) => ProjectGitOperationSummary;
  resolveTerminalCwd: (inputPath?: string) => string;
  runGitSync: (cwd: string, args: string[]) => { exitCode: number | null; stdout: string; stderr: string };
};

export function createProjectHistoryService(deps: ProjectHistoryDeps) {
  const { db, projectCheckRunFromRow, projectGitOperationFromRow, resolveTerminalCwd, runGitSync } = deps;

  function saveProjectCheckRun(projectId: string, result: TerminalCommandResponse, startedAt: string): ProjectCheckRunSummary {
    const run: ProjectCheckRunSummary = {
      id: `project-check-${randomUUID()}`,
      projectId,
      command: result.command,
      cwd: result.cwd,
      status: result.timedOut ? "timed_out" : result.exitCode === 0 ? "done" : "failed",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    db.prepare(`
      insert into project_check_runs (id, project_id, command, cwd, status, exit_code, duration_ms, stdout, stderr, started_at, finished_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(run.id, run.projectId, run.command, run.cwd, run.status, run.exitCode, run.durationMs, run.stdout, run.stderr, run.startedAt, run.finishedAt ?? null);
    return run;
  }

  function saveProjectGitOperation(projectId: string, operation: ProjectGitOperationType, args: string[], result: { exitCode: number | null; stdout: string; stderr: string }, status?: ProjectGitOperationSummary["status"]) {
    const record: ProjectGitOperationSummary = {
      id: `project-git-${randomUUID()}`,
      projectId,
      operation,
      args,
      status: status ?? (result.exitCode === 0 ? "done" : "failed"),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      createdAt: new Date().toISOString(),
    };
    db.prepare(`
      insert into project_git_operations (id, project_id, operation, args, status, exit_code, stdout, stderr, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.projectId, record.operation, JSON.stringify(record.args), record.status, record.exitCode, record.stdout, record.stderr, record.createdAt);
    return record;
  }

  function listProjectGitOperations(projectId: string, limit = 20, cursorValue?: string | null) {
    const cursor = decodePageCursor(cursorValue);
    const rows = db.prepare(`
      select * from project_git_operations
      where project_id = @projectId
        ${cursor ? "and (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
      order by created_at desc, id desc
      limit @limit
    `).all({ projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
    return pageFromRows(rows.map(projectGitOperationFromRow), limit, (item) => item.createdAt);
  }

  function projectGitArgs(input: ProjectGitOperationRequest) {
    const branch = input.branch?.trim();
    const message = input.message?.trim();
    if (input.operation === "pull") return ["pull", "--ff-only"];
    if (input.operation === "commit") {
      if (!message) throw new Error("commit_message_required");
      return ["commit", "-m", message];
    }
    if (input.operation === "branch-create") {
      if (!branch) throw new Error("branch_required");
      return ["checkout", "-b", branch];
    }
    if (input.operation === "branch-checkout") {
      if (!branch) throw new Error("branch_required");
      return ["checkout", branch];
    }
    if (input.operation === "push") return ["push"];
    throw new Error("unsupported_git_operation");
  }

  function runProjectGitOperation(project: ProjectSummary, operation: ProjectGitOperationType, args: string[]) {
    const result = runGitSync(resolveTerminalCwd(project.workspacePath), args);
    return saveProjectGitOperation(project.id, operation, args, result);
  }

  function listProjectCheckRuns(projectId: string, limit = 20, cursorValue?: string | null) {
    const cursor = decodePageCursor(cursorValue);
    const rows = db.prepare(`
      select * from project_check_runs
      where project_id = @projectId
        ${cursor ? "and (started_at < @cursorSort or (started_at = @cursorSort and id < @cursorId))" : ""}
      order by started_at desc, id desc
      limit @limit
    `).all({ projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
    return pageFromRows(rows.map(projectCheckRunFromRow), limit, (item) => item.startedAt);
  }

  return {
    listProjectCheckRuns,
    listProjectGitOperations,
    projectGitArgs,
    runProjectGitOperation,
    saveProjectCheckRun,
    saveProjectGitOperation,
  };
}
