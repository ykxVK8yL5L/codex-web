import { randomUUID } from "node:crypto";
import type { AutomationRunSummary, AutomationSummary, SessionSummary } from "@codex-web/protocol";

type AutomationRuntimeDeps = Record<string, any>;
const processStartupKey = `process:${process.pid}:${new Date().toISOString()}`;

export function createAutomationRuntime(deps: AutomationRuntimeDeps) {
  const {
    appData,
    appendSessionMessage,
    automationCommandTimeoutSeconds,
    automationHasRunningRun,
    buildAutomationNotificationMessage,
    createAutomationRun,
    db,
    emitExternalNotification,
    ensureScratchSessionWorkspace,
    finishAutomationRun,
    formatShellCommandOutput,
    publishTaskEvent,
    resolveTerminalCwd,
    roomEvent,
    runLoggedShellCommand,
    sanitizeAutomationOverlapPolicy,
    sanitizeAutomationRetryDelayMinutes,
    sanitizeAutomationRetryMax,
    saveAppData,
    shouldRunAutomationNow,
    startCodexTask,
    startRoomTaskRun,
    upsertSession,
  } = deps;

function latestAutomationSession(automationId: string) {
  const linked = db.prepare("select session_id from automations where id = ?").get(automationId) as { session_id?: string | null } | undefined;
  if (linked?.session_id) {
    const session = appData.sessions.find((item: SessionSummary) => item.id === linked.session_id);
    if (session) return session;
    db.prepare("update automations set session_id = null where id = ?").run(automationId);
  }
  const existingRun = db.prepare(`
    select session_id from automation_runs
    where automation_id = ?
    order by started_at desc, id desc
    limit 1
  `).get(automationId) as { session_id?: string | null } | undefined;
  if (!existingRun?.session_id) return null;
  const session = appData.sessions.find((item: SessionSummary) => item.id === existingRun.session_id) ?? null;
  if (session) linkAutomationSession(automationId, session.id);
  return session;
}

function linkAutomationSession(automationId: string, sessionId: string) {
  db.prepare("update automations set session_id = ? where id = ?").run(sessionId, automationId);
}

function automationIdForSession(sessionId: string) {
  const row = db.prepare("select id from automations where session_id = ?").get(sessionId) as { id?: string } | undefined;
  return row?.id ?? null;
}

function sessionHasExistingAutomationOwner(sessionId: string) {
  if (appData.automations.some((automation: AutomationSummary) => automation.sessionId === sessionId)) return true;
  const row = db.prepare(`
    select automation_runs.automation_id
    from automation_runs
    inner join automations on automations.id = automation_runs.automation_id
    where automation_runs.session_id = ?
    limit 1
  `).get(sessionId) as { automation_id?: string } | undefined;
  return Boolean(row?.automation_id);
}

function sessionVisibleInChatTools(session: SessionSummary) {
  if (session.conversationType === "agent" && session.roomId) return false;
  if (session.conversationType === "automation" && sessionHasExistingAutomationOwner(session.id)) return false;
  return true;
}

function ensureAutomationSession(automation: AutomationSummary) {
  const project = automation.projectId ? appData.projects.find((item: { id: string; workspacePath: string }) => item.id === automation.projectId) : null;
  const provider = automation.providerId
    ? appData.providers.find((item: { id: string; defaultModel?: string | null }) => item.id === automation.providerId) ?? appData.providers[0]
    : appData.providers[0];
  const selectedModel = automation.model ?? provider?.defaultModel ?? null;
  const existingSession = latestAutomationSession(automation.id);
  const id = existingSession?.id ?? `task-${randomUUID()}`;
  const workspacePath = automation.cwd?.trim()
    ? resolveTerminalCwd(automation.cwd)
    : project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id);
  const now = new Date().toISOString();
  const session: SessionSummary = existingSession ? {
    ...existingSession,
    kind: project ? "project" : "scratch",
    conversationType: "automation",
    title: automation.name,
    projectId: project?.id ?? null,
    workspacePath,
    providerId: provider?.id ?? existingSession.providerId ?? null,
    model: selectedModel ?? existingSession.model ?? null,
    updatedAt: now,
  } : {
    id,
    kind: project ? "project" : "scratch",
    conversationType: "automation",
    title: automation.name,
    projectId: project?.id ?? null,
    workspacePath,
    providerId: provider?.id ?? null,
    model: selectedModel,
    status: "paused",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions = [session, ...appData.sessions.filter((item: SessionSummary) => item.id !== session.id)];
  linkAutomationSession(automation.id, session.id);
  return { session, project, provider, selectedModel, workspacePath };
}

type AutomationRunStartResult = {
  session: SessionSummary;
  runStatus: AutomationRunSummary["status"];
};

function queueAutomationRun(automation: AutomationSummary) {
  const { session } = ensureAutomationSession(automation);
  appendSessionMessage(session.id, "system", `Automation run queued: ${automation.name} (${new Date().toISOString()})`);
  createAutomationRun(automation.id, session.id, "queued");
  saveAppData();
  return { session, runStatus: "queued" as const };
}

function skipAutomationRun(automation: AutomationSummary) {
  const { session } = ensureAutomationSession(automation);
  const now = new Date().toISOString();
  appendSessionMessage(session.id, "system", `Automation run skipped because a previous run is still active: ${automation.name} (${now})`);
  createAutomationRun(automation.id, session.id, "skipped", now, now);
  saveAppData();
  return { session, runStatus: "skipped" as const };
}

function automationForSession(sessionId: string) {
  const automationId = automationIdForSession(sessionId);
  return automationId ? appData.automations.find((item: AutomationSummary) => item.id === automationId) ?? null : null;
}

function consecutiveAutomationFailures(automationId: string) {
  const rows = db.prepare(`
    select status
    from automation_runs
    where automation_id = ?
    order by started_at desc, id desc
    limit 20
  `).all(automationId) as Array<{ status?: string }>;
  let count = 0;
  for (const row of rows) {
    if (row.status !== "failed") break;
    count += 1;
  }
  return count;
}

function scheduleAutomationRetry(automationId: string, sessionId: string) {
  const automation = appData.automations.find((item: AutomationSummary) => item.id === automationId);
  if (!automation || automation.status !== "active") return;
  const retryMax = sanitizeAutomationRetryMax(automation.retryMax);
  if (!retryMax) return;
  const failures = consecutiveAutomationFailures(automationId);
  if (failures > retryMax) return;
  const retryAt = new Date(Date.now() + sanitizeAutomationRetryDelayMinutes(automation.retryDelayMinutes) * 60_000).toISOString();
  createAutomationRun(automationId, sessionId, "queued", retryAt);
  appendSessionMessage(sessionId, "system", `Automation retry queued: ${automation.name} (${retryAt})`);
  saveAppData();
}

function startNextQueuedAutomationRun(automationId: string) {
  if (automationHasRunningRun(automationId)) return;
  const queued = db.prepare(`
    select id from automation_runs
    where automation_id = ? and status = 'queued' and started_at <= ?
    order by started_at asc, id asc
    limit 1
  `).get(automationId, new Date().toISOString()) as { id?: string } | undefined;
  if (!queued?.id) return;
  const automation = appData.automations.find((item: AutomationSummary) => item.id === automationId);
  if (!automation || automation.status !== "active") return;
  runAutomationNow(automation, queued.id);
}

function startDueQueuedAutomationRuns() {
  const rows = db.prepare(`
    select distinct automation_id
    from automation_runs
    where status = 'queued' and started_at <= ?
  `).all(new Date().toISOString()) as Array<{ automation_id?: string }>;
  for (const row of rows) {
    if (row.automation_id) startNextQueuedAutomationRun(String(row.automation_id));
  }
}

function runAutomationNow(automation: AutomationSummary, queuedRunId?: string): AutomationRunStartResult {
  if (!queuedRunId && automationHasRunningRun(automation.id)) {
    return sanitizeAutomationOverlapPolicy(automation.overlapPolicy) === "skip" ? skipAutomationRun(automation) : queueAutomationRun(automation);
  }
  const { session, provider, selectedModel, workspacePath } = ensureAutomationSession(automation);
  const now = new Date().toISOString();
  session.status = "running";
  session.updatedAt = now;
  appData.sessions = [session, ...appData.sessions.filter((item: SessionSummary) => item.id !== session.id)];
  const isCommand = automation.actionType === "command";
  const command = automation.command?.trim() ?? "";
  const content = isCommand ? command : automation.prompt;
  appendSessionMessage(session.id, "system", `Automation run started: ${automation.name} (${now})`);
  const userMessage = appendSessionMessage(session.id, "user", content);
  if (queuedRunId) {
    db.prepare("update automation_runs set status = 'running', session_id = ?, started_at = ?, finished_at = null, exit_code = null where id = ?").run(session.id, now, queuedRunId);
  } else {
    createAutomationRun(automation.id, session.id);
  }
  saveAppData();
  if (isCommand) {
    const timeoutSeconds = automationCommandTimeoutSeconds(automation.commandTimeoutSeconds);
    void runLoggedShellCommand(session, command, workspacePath, { timeoutMs: timeoutSeconds === null ? null : timeoutSeconds * 1000, source: "automation" }).then((result: any) => {
      appendSessionMessage(session.id, "assistant", formatShellCommandOutput(result, timeoutSeconds));
      session.status = result.exitCode === 0 && !result.timedOut && !result.stopped ? "done" : "interrupted";
      session.updatedAt = new Date().toISOString();
      upsertSession(session);
      finishAutomationRun(session.id, result.exitCode, Boolean(result.stopped));
      emitAutomationCommandNotification(automation, session, result);
      publishTaskEvent(session.id, { type: "done", session, exitCode: result.exitCode });
    }).catch((error: unknown) => {
      appendSessionMessage(session.id, "assistant", error instanceof Error ? error.message : "Command automation failed");
      session.status = "interrupted";
      session.updatedAt = new Date().toISOString();
      upsertSession(session);
      finishAutomationRun(session.id, 1, false);
      emitAutomationCommandNotification(automation, session, { exitCode: 1, command, cwd: workspacePath });
      publishTaskEvent(session.id, { type: "done", session, exitCode: 1 });
    });
  } else {
    startCodexTask(session, automation.prompt, workspacePath, provider, selectedModel, !session.codexSessionId, [], { currentMessageId: userMessage.id, sourceType: "automation" });
  }
  return { session, runStatus: "running" };
}

function checkScheduledAutomations() {
  startDueQueuedAutomationRuns();
  const now = new Date();
  for (const automation of appData.automations) {
    if (!shouldRunAutomationNow(automation, now)) continue;
    try {
      runAutomationNow(automation);
    } catch (error) {
      console.error("automation schedule failed", automation.id, error);
    }
  }
}

function runStartupAutomations() {
  for (const automation of appData.automations) {
    if (automation.status !== "active" || automation.schedule.trim().toLowerCase() !== "startup") continue;
    if (automationHasActiveRun(automation.id)) continue;
    if (!claimStartupAutomationRun(automation.id, processStartupKey)) continue;
    try {
      runAutomationNow(automation);
    } catch (error) {
      console.error("automation startup failed", automation.id, error);
    }
  }
}

function automationHasActiveRun(automationId: string) {
  const row = db.prepare("select 1 from automation_runs where automation_id = ? and status in ('queued', 'running') limit 1").get(automationId) as Record<string, unknown> | undefined;
  return Boolean(row);
}

function claimStartupAutomationRun(automationId: string, startupKey: string) {
  db.prepare(`
    create table if not exists automation_startup_claims (
      automation_id text not null,
      startup_key text not null,
      claimed_at text not null,
      primary key (automation_id, startup_key)
    )
  `).run();
  const result = db.prepare(`
    insert or ignore into automation_startup_claims (automation_id, startup_key, claimed_at)
    values (?, ?, ?)
  `).run(automationId, startupKey, new Date().toISOString());
  return result.changes > 0;
}

function emitAutomationCommandNotification(automation: AutomationSummary, session: SessionSummary, result: { exitCode: number | null; timedOut?: boolean; stopped?: boolean; command?: string; cwd?: string; stdout?: string; stderr?: string; durationMs?: number }) {
  const stopped = Boolean(result.stopped);
  const success = result.exitCode === 0 && !result.timedOut && !stopped;
  const message = buildAutomationNotificationMessage({
    automation,
    session,
    exitCode: result.exitCode,
    stopped,
    timedOut: Boolean(result.timedOut),
    durationMs: result.durationMs,
    command: result.command ?? automation.command ?? null,
    cwd: result.cwd ?? session.workspacePath ?? null,
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? null,
  });
  emitExternalNotification({
    eventType: stopped ? "task_interrupted" : success ? "task_completed" : "task_failed",
    severity: stopped ? "warning" : success ? "success" : "error",
    title: success ? `自动化完成：${automation.name}` : `自动化异常：${automation.name}`,
    message,
    sourceType: "session",
    sourceId: session.id,
      metadata: {
        automationId: automation.id,
        automationName: automation.name,
        actionType: automation.actionType ?? "agent",
        command: result.command ?? automation.command ?? null,
      cwd: result.cwd ?? session.workspacePath ?? null,
      exitCode: result.exitCode,
      timedOut: Boolean(result.timedOut),
        stopped,
        workspacePath: session.workspacePath,
        notificationScopes: [
          { scopeType: "session", scopeId: session.id },
          { scopeType: "automation", scopeId: automation.id },
        ],
      },
    });
}

function checkDueRoomSchedules() {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const schedules = db.prepare(`
    select * from room_schedules
    where status = 'active'
      and schedule_type = 'once'
      and run_at is not null
    order by run_at asc, id asc
    limit 20
  `).all() as Array<Record<string, unknown>>;
  for (const schedule of schedules) {
    const dueAt = new Date(String(schedule.run_at));
    if (Number.isNaN(dueAt.getTime()) || dueAt > nowDate) continue;
    const roomId = String(schedule.room_id);
    const agentId = String(schedule.agent_id);
    const scheduleId = String(schedule.id);
    const taskPrompt = String(schedule.task_prompt);
    const taskId = `room-task-${randomUUID()}`;
    const taskTitle = taskPrompt.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80) || "Scheduled room task";
    try {
      db.prepare(`
        insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
        values (?, ?, ?, ?, 'queued', ?, 0, null, ?, '{}', ?, ?)
      `).run(taskId, roomId, taskTitle, taskPrompt, agentId, schedule.run_at ?? null, now, now);
      db.prepare("update room_schedules set status = 'done', updated_at = ? where id = ?").run(now, scheduleId);
      roomEvent(roomId, "schedule.triggered", { scheduleId, taskId }, agentId);
      startRoomTaskRun(roomId, taskId);
    } catch (error) {
      roomEvent(roomId, "schedule.failed", { scheduleId, taskId, error: error instanceof Error ? error.message : "room_schedule_failed" }, agentId);
      console.error("room schedule failed", scheduleId, error);
    }
  }
}

function checkScheduledWork() {
  checkScheduledAutomations();
  checkDueRoomSchedules();
}


  return {
    automationForSession,
    automationIdForSession,
    checkDueRoomSchedules,
    checkScheduledAutomations,
    checkScheduledWork,
    consecutiveAutomationFailures,
    emitAutomationCommandNotification,
    ensureAutomationSession,
    latestAutomationSession,
    linkAutomationSession,
    queueAutomationRun,
    runAutomationNow,
    runStartupAutomations,
    scheduleAutomationRetry,
    sessionHasExistingAutomationOwner,
    sessionVisibleInChatTools,
    skipAutomationRun,
    startDueQueuedAutomationRuns,
    startNextQueuedAutomationRun,
  };
}
