import type Database from "better-sqlite3";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type {
  AutomationRunSummary,
  AutomationSummary,
  CreateAutomationRequest,
  ProjectSummary,
  ProviderSummary,
  SessionSummary,
  UpdateAutomationRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows, parsePageLimit } from "../pagination.js";
import {
  automationCommandTimeoutSeconds,
  automationRunFromRow,
  automationWithRuntimeFields,
  isValidAutomationSchedule,
  sanitizeAutomationOverlapPolicy,
  sanitizeAutomationRetryDelayMinutes,
  sanitizeAutomationRetryMax,
} from "./index.js";
import { latestRunningTaskRun, markTaskRunStopRequested } from "../tasks/runs.js";

type AutomationRunStartResult = {
  session: SessionSummary;
  runStatus: AutomationRunSummary["status"];
};

type AutomationRoutesDeps = {
  appendCodexErrorOutput: (session: SessionSummary, chunk: string) => void;
  appendSessionMessage: (sessionId: string, role: "system" | "assistant", content: string) => void;
  appData: {
    automations: AutomationSummary[];
    projects: ProjectSummary[];
    providers: ProviderSummary[];
    sessions: SessionSummary[];
  };
  clearCodexTaskRuntime: (sessionId: string, stopProcess?: boolean) => void;
  codexTaskProcesses: Map<string, ChildProcess>;
  codexTaskStopRequested: Set<string>;
  db: Database.Database;
  deleteSessionData: (session: SessionSummary, deleteWorkspace: boolean, deleteLogs: boolean) => void;
  deleteSessionDatabaseRows: (sessionId: string) => void;
  finishAutomationRun: (sessionId: string, exitCode: number | null, stopped: boolean) => void;
  isProcessAlive: (pid: number | null) => boolean;
  latestAutomationSession: (automationId: string) => SessionSummary | null;
  runAutomationNow: (automation: AutomationSummary) => AutomationRunStartResult;
  saveAppData: () => void;
  shellTaskProcesses: Map<string, ChildProcess>;
  shellTaskStopRequested: Set<string>;
  upsertAutomation: (automation: AutomationSummary) => void;
  upsertSession: (session: SessionSummary) => void;
};

export function registerAutomationRoutes(app: Hono, deps: AutomationRoutesDeps) {
  app.get("/api/automations", (c) => {
    const limitQuery = c.req.query("limit");
    if (!limitQuery && !c.req.query("cursor") && !c.req.query("q") && !c.req.query("status") && !c.req.query("projectId") && !c.req.query("actionType")) {
      return c.json(deps.appData.automations.map(automationWithRuntimeFields));
    }
    const limit = parsePageLimit(limitQuery, 20);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const status = c.req.query("status");
    const projectId = c.req.query("projectId");
    const actionType = c.req.query("actionType");
    const filtered = deps.appData.automations
      .map(automationWithRuntimeFields)
      .filter((automation) => !q || automation.name.toLowerCase().includes(q) || automation.prompt.toLowerCase().includes(q) || (automation.command ?? "").toLowerCase().includes(q) || automation.id.toLowerCase().includes(q))
      .filter((automation) => !status || automation.status === status)
      .filter((automation) => !projectId || (projectId === "global" ? !automation.projectId : automation.projectId === projectId))
      .filter((automation) => !actionType || automation.actionType === actionType)
      .filter((automation) => !cursor || automation.updatedAt < cursor.sortValue || (automation.updatedAt === cursor.sortValue && automation.id < cursor.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
  });

  app.post("/api/automations", async (c) => {
    const body = await c.req.json<CreateAutomationRequest>().catch(() => null);
    const actionType = body?.actionType === "command" ? "command" : "agent";
    if (!body?.name?.trim() || !body.schedule?.trim()) return c.json({ error: "invalid_automation" }, 400);
    if (actionType === "agent" && !body.prompt?.trim()) return c.json({ error: "invalid_automation_prompt" }, 400);
    if (actionType === "command" && !body.command?.trim()) return c.json({ error: "invalid_automation_command" }, 400);
    if (!isValidAutomationSchedule(body.schedule)) return c.json({ error: "invalid_automation_schedule" }, 400);
    const project = body.projectId ? deps.appData.projects.find((item) => item.id === body.projectId) : null;
    const provider = body.providerId ? deps.appData.providers.find((item) => item.id === body.providerId) : null;
    const now = new Date().toISOString();
    const automation: AutomationSummary = {
      id: `automation-${randomUUID()}`,
      name: body.name.trim(),
      projectId: project?.id ?? null,
      providerId: provider?.id ?? null,
      model: body.model?.trim() || null,
      actionType,
      prompt: body.prompt?.trim() || body.command?.trim() || "",
      command: body.command?.trim() || null,
      cwd: body.cwd?.trim() || null,
      commandTimeoutSeconds: actionType === "command" ? automationCommandTimeoutSeconds(body.commandTimeoutSeconds) : null,
      retryMax: sanitizeAutomationRetryMax(body.retryMax),
      retryDelayMinutes: sanitizeAutomationRetryDelayMinutes(body.retryDelayMinutes),
      overlapPolicy: sanitizeAutomationOverlapPolicy(body.overlapPolicy),
      schedule: body.schedule.trim(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    deps.appData.automations.unshift(automation);
    deps.upsertAutomation(automation);
    return c.json(automationWithRuntimeFields(automation), 201);
  });

  app.patch("/api/automations/:id", async (c) => {
    const automation = deps.appData.automations.find((item) => item.id === c.req.param("id"));
    if (!automation) return c.json({ error: "automation_not_found" }, 404);
    const body = await c.req.json<UpdateAutomationRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_automation_update" }, 400);
    if (body.name !== undefined) automation.name = body.name.trim() || automation.name;
    if (body.projectId !== undefined) automation.projectId = deps.appData.projects.find((item) => item.id === body.projectId)?.id ?? null;
    if (body.providerId !== undefined) automation.providerId = deps.appData.providers.find((item) => item.id === body.providerId)?.id ?? null;
    if (body.model !== undefined) automation.model = body.model?.trim() || null;
    if (body.actionType !== undefined) automation.actionType = body.actionType === "command" ? "command" : "agent";
    if (body.prompt !== undefined) automation.prompt = body.prompt.trim() || automation.prompt;
    if (body.command !== undefined) automation.command = body.command?.trim() || null;
    if (body.cwd !== undefined) automation.cwd = body.cwd?.trim() || null;
    if (body.commandTimeoutSeconds !== undefined) automation.commandTimeoutSeconds = automation.actionType === "command" ? automationCommandTimeoutSeconds(body.commandTimeoutSeconds) : null;
    if (body.retryMax !== undefined) automation.retryMax = sanitizeAutomationRetryMax(body.retryMax);
    if (body.retryDelayMinutes !== undefined) automation.retryDelayMinutes = sanitizeAutomationRetryDelayMinutes(body.retryDelayMinutes);
    if (body.overlapPolicy !== undefined) automation.overlapPolicy = sanitizeAutomationOverlapPolicy(body.overlapPolicy);
    if ((automation.actionType ?? "agent") === "agent" && !automation.prompt.trim()) return c.json({ error: "invalid_automation_prompt" }, 400);
    if (automation.actionType === "command" && !automation.command?.trim()) return c.json({ error: "invalid_automation_command" }, 400);
    if (body.schedule !== undefined) {
      if (!isValidAutomationSchedule(body.schedule)) return c.json({ error: "invalid_automation_schedule" }, 400);
      automation.schedule = body.schedule.trim() || automation.schedule;
    }
    if (body.status !== undefined) automation.status = body.status;
    automation.updatedAt = new Date().toISOString();
    deps.upsertAutomation(automation);
    return c.json(automationWithRuntimeFields(automation));
  });

  app.delete("/api/automations/:id", (c) => {
    const index = deps.appData.automations.findIndex((item) => item.id === c.req.param("id"));
    if (index === -1) return c.json({ error: "automation_not_found" }, 404);
    const [automation] = deps.appData.automations.splice(index, 1);
    const session = deps.latestAutomationSession(automation.id);
    const deleteSession = c.req.query("deleteSession") !== "false";
    deps.db.prepare("delete from automations where id = ?").run(automation.id);
    deps.db.prepare("delete from automation_runs where automation_id = ?").run(automation.id);
    deps.db.prepare("delete from notification_ephemeral_rules where scope_type = 'automation' and scope_id = ?").run(automation.id);
    if (deleteSession && session) {
      deps.clearCodexTaskRuntime(session.id, true);
      deps.appData.sessions = deps.appData.sessions.filter((item) => item.id !== session.id);
      deps.deleteSessionDatabaseRows(session.id);
      deps.deleteSessionData(session, true, true);
    }
    return c.json({ ok: true, id: automation.id });
  });

  app.get("/api/automations/:id/runs", (c) => {
    const automation = deps.appData.automations.find((item) => item.id === c.req.param("id"));
    if (!automation) return c.json({ error: "automation_not_found" }, 404);
    const limit = parsePageLimit(c.req.query("limit"), 20);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const status = c.req.query("status");
    const statusFilter = status === "queued" || status === "running" || status === "done" || status === "failed" || status === "stopped" || status === "skipped" || status === "canceled" ? status : null;
    const rows = deps.db.prepare(`
      select id, automation_id, session_id, status, exit_code, started_at, finished_at
      from automation_runs
      where automation_id = @automationId
        ${statusFilter ? "and status = @status" : ""}
        ${cursor ? "and (started_at < @cursorSort or (started_at = @cursorSort and id < @cursorId))" : ""}
      order by started_at desc, id desc
      limit @limit
    `).all({ automationId: automation.id, status: statusFilter, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
    return c.json(pageFromRows(rows.map(automationRunFromRow), limit, (item) => item.startedAt));
  });

  app.delete("/api/automations/:id/runs", (c) => {
    const automation = deps.appData.automations.find((item) => item.id === c.req.param("id"));
    if (!automation) return c.json({ error: "automation_not_found" }, 404);
    const result = deps.db.prepare("delete from automation_runs where automation_id = ? and status in ('done', 'failed', 'stopped', 'skipped', 'canceled')").run(automation.id);
    return c.json({ ok: true, cleared: result.changes });
  });

  app.post("/api/automations/:id/runs/cancel-queued", (c) => {
    const automation = deps.appData.automations.find((item) => item.id === c.req.param("id"));
    if (!automation) return c.json({ error: "automation_not_found" }, 404);
    const now = new Date().toISOString();
    const result = deps.db.prepare(`
      update automation_runs
      set status = 'canceled', finished_at = ?
      where automation_id = ? and status = 'queued'
    `).run(now, automation.id);
    const session = deps.latestAutomationSession(automation.id);
    if (session && result.changes > 0) {
      deps.appendSessionMessage(session.id, "system", `Automation queued runs canceled: ${automation.name} (${now})`);
      deps.saveAppData();
    }
    return c.json({ ok: true, canceled: result.changes, automation: automationWithRuntimeFields(automation) });
  });

  app.post("/api/automations/:id/runs/stop-running", (c) => {
    const automation = deps.appData.automations.find((item) => item.id === c.req.param("id"));
    if (!automation) return c.json({ error: "automation_not_found" }, 404);
    const runningRun = deps.db.prepare(`
      select session_id
      from automation_runs
      where automation_id = ? and status = 'running'
      order by started_at desc, id desc
      limit 1
    `).get(automation.id) as { session_id?: string | null } | undefined;
    const sessionId = runningRun?.session_id ? String(runningRun.session_id) : "";
    const session = sessionId ? deps.appData.sessions.find((item) => item.id === sessionId) : null;
    if (!session) return c.json({ error: "automation_run_not_found" }, 404);
    const runningTaskRun = latestRunningTaskRun(session.id);
    const runnerPid = typeof runningTaskRun?.pid === "number" ? runningTaskRun.pid : null;
    const shellChild = deps.shellTaskProcesses.get(session.id);
    const codexChild = deps.codexTaskProcesses.get(session.id);
    if (!shellChild && !codexChild && !deps.isProcessAlive(runnerPid)) {
      session.status = session.status === "running" ? "paused" : session.status;
      session.updatedAt = new Date().toISOString();
      deps.upsertSession(session);
      deps.finishAutomationRun(session.id, null, true);
      return c.json({ ok: true, stopped: false, session, automation: automationWithRuntimeFields(automation) });
    }
    deps.shellTaskStopRequested.add(session.id);
    deps.codexTaskStopRequested.add(session.id);
    markTaskRunStopRequested(session.id);
    try {
      if (shellChild) shellChild.kill("SIGTERM");
      else if (codexChild) codexChild.kill("SIGTERM");
      else if (runnerPid) process.kill(runnerPid, "SIGTERM");
    } catch {
      deps.finishAutomationRun(session.id, null, true);
    }
    session.status = "paused";
    session.updatedAt = new Date().toISOString();
    deps.upsertSession(session);
    deps.appendCodexErrorOutput(session, "\n[automation run stop requested]\n");
    deps.appendSessionMessage(session.id, "assistant", `用户主动停止自动化运行。停止时间：${new Date().toISOString()}。`);
    return c.json({ ok: true, stopped: true, session, automation: automationWithRuntimeFields(automation) });
  });

  app.post("/api/automations/:id/run", (c) => {
    const automation = deps.appData.automations.find((item) => item.id === c.req.param("id"));
    if (!automation) return c.json({ error: "automation_not_found" }, 404);
    try {
      const result = deps.runAutomationNow(automation);
      return c.json({ ...result.session, automationRunStatus: result.runStatus }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "automation_run_failed" }, 400);
    }
  });
}
