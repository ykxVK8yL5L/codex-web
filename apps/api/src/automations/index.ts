import type Database from "better-sqlite3";
import type {
  AutomationRunSummary,
  AutomationSummary,
  SessionSummary,
} from "@codex-web/protocol";

export type AutomationStoreDeps = {
  db: Database.Database;
};

let automationStoreDeps: AutomationStoreDeps | null = null;

export function setAutomationStoreDeps(nextDeps: AutomationStoreDeps) {
  automationStoreDeps = nextDeps;
}

function deps() {
  if (!automationStoreDeps) throw new Error("automation_store_not_initialized");
  return automationStoreDeps;
}

export function sanitizeAutomationRetryMax(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 10) : 0;
}

export function sanitizeAutomationRetryDelayMinutes(value: unknown) {
  const parsed = Number(value ?? 5);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 24 * 60) : 5;
}

export function sanitizeAutomationOverlapPolicy(value: unknown): NonNullable<AutomationSummary["overlapPolicy"]> {
  return value === "skip" ? "skip" : "queue";
}

export function automationRuntimeFields(automation: AutomationSummary): Pick<AutomationSummary, "runningRuns" | "queuedRuns" | "lastRunStatus" | "lastRunAt" | "nextRunAt"> {
  const { db } = deps();
  const counts = db.prepare(`
    select
      sum(case when status = 'running' then 1 else 0 end) as running,
      sum(case when status = 'queued' then 1 else 0 end) as queued
    from automation_runs
    where automation_id = ?
  `).get(automation.id) as { running?: number | null; queued?: number | null } | undefined;
  const lastRun = db.prepare(`
    select status, started_at, finished_at
    from automation_runs
    where automation_id = ?
    order by started_at desc, id desc
    limit 1
  `).get(automation.id) as { status?: string; started_at?: string; finished_at?: string | null } | undefined;
  return {
    runningRuns: Number(counts?.running ?? 0),
    queuedRuns: Number(counts?.queued ?? 0),
    lastRunStatus: lastRun?.status === "queued" || lastRun?.status === "running" || lastRun?.status === "done" || lastRun?.status === "failed" || lastRun?.status === "stopped" || lastRun?.status === "skipped" || lastRun?.status === "canceled" ? lastRun.status : null,
    lastRunAt: lastRun?.finished_at || lastRun?.started_at || null,
    nextRunAt: nextAutomationRunAt(automation),
  };
}

export function automationWithRuntimeFields(automation: AutomationSummary): AutomationSummary {
  return { ...automation, ...automationRuntimeFields(automation) };
}

export function automationFromRow(row: Record<string, unknown>, includeRuntime = true): AutomationSummary {
  const automation: AutomationSummary = {
    id: String(row.id),
    name: String(row.name),
    projectId: row.project_id ? String(row.project_id) : null,
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    actionType: row.action_type === "command" ? "command" : "agent",
    prompt: String(row.prompt),
    command: row.command ? String(row.command) : null,
    cwd: row.cwd ? String(row.cwd) : null,
    commandTimeoutSeconds: row.command_timeout_seconds === null || row.command_timeout_seconds === undefined ? null : Number(row.command_timeout_seconds),
    retryMax: sanitizeAutomationRetryMax(row.retry_max),
    retryDelayMinutes: sanitizeAutomationRetryDelayMinutes(row.retry_delay_minutes),
    overlapPolicy: sanitizeAutomationOverlapPolicy(row.overlap_policy),
    sessionId: row.session_id ? String(row.session_id) : null,
    schedule: String(row.schedule),
    status: row.status === "paused" ? "paused" : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  return includeRuntime ? automationWithRuntimeFields(automation) : automation;
}

export function automationRunFromRow(row: Record<string, unknown>): AutomationRunSummary {
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    sessionId: String(row.session_id),
    status: row.status === "queued" || row.status === "done" || row.status === "failed" || row.status === "stopped" || row.status === "skipped" || row.status === "canceled" ? row.status : "running",
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
  };
}

export function automationCommandTimeoutSeconds(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(Math.round(parsed), 24 * 60 * 60));
}

export function automationRanInMinute(automationId: string, minuteKey: string) {
  const { db } = deps();
  const row = db.prepare(`
    select id from automation_runs
    where automation_id = ? and substr(started_at, 1, 16) = ?
    limit 1
  `).get(automationId, minuteKey) as Record<string, unknown> | undefined;
  return Boolean(row);
}

export function automationHasRunningRun(automationId: string) {
  const { db } = deps();
  const row = db.prepare("select id from automation_runs where automation_id = ? and status = 'running' limit 1").get(automationId) as Record<string, unknown> | undefined;
  return Boolean(row);
}

export function cronFieldMatches(field: string, value: number, min: number, max: number) {
  return field.split(",").some((part) => {
    const item = part.trim();
    if (!item) return false;
    if (item === "*") return true;
    const stepMatch = item.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      return step > 0 && (value - min) % step === 0;
    }
    const rangeMatch = item.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      return start <= value && value <= end;
    }
    const exact = Number(item);
    return Number.isInteger(exact) && exact >= min && exact <= max && exact === value;
  });
}

export function cronMatches(expression: string, now: Date) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return cronFieldMatches(minute, now.getMinutes(), 0, 59)
    && cronFieldMatches(hour, now.getHours(), 0, 23)
    && cronFieldMatches(dayOfMonth, now.getDate(), 1, 31)
    && cronFieldMatches(month, now.getMonth() + 1, 1, 12)
    && cronFieldMatches(dayOfWeek, now.getDay(), 0, 7);
}

export function nextAutomationRunAt(automation: AutomationSummary, from = new Date()) {
  if (automation.status !== "active") return null;
  const schedule = automation.schedule.trim().toLowerCase();
  if (schedule === "manual") return null;
  if (schedule === "startup") return null;
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  if (schedule === "hourly") {
    next.setMinutes(0, 0, 0);
    if (next <= from) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  const daily = schedule.match(/^daily\s+([0-2]\d):([0-5]\d)$/);
  if (daily) {
    next.setHours(Number(daily[1]), Number(daily[2]), 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const weekly = schedule.match(/^weekly\s+([0-7])\s+([0-2]\d):([0-5]\d)$/);
  if (weekly) {
    const targetDay = Number(weekly[1]) % 7;
    next.setHours(Number(weekly[2]), Number(weekly[3]), 0, 0);
    const delta = (targetDay - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
    if (next <= from) next.setDate(next.getDate() + 7);
    return next.toISOString();
  }
  if (schedule.startsWith("cron ")) {
    const expression = schedule.slice(5);
    const probe = new Date(next);
    for (let i = 0; i < 366 * 24 * 60; i++) {
      if (cronMatches(expression, probe)) return probe.toISOString();
      probe.setMinutes(probe.getMinutes() + 1);
    }
  }
  return null;
}

export function shouldRunAutomationNow(automation: AutomationSummary, now = new Date()) {
  if (automation.status !== "active") return false;
  const schedule = automation.schedule.trim().toLowerCase();
  if (!schedule || schedule === "manual" || schedule === "startup") return false;
  const minuteKey = now.toISOString().slice(0, 16);
  if (automationRanInMinute(automation.id, minuteKey)) return false;
  if (schedule === "hourly") return now.getMinutes() === 0;
  const daily = schedule.match(/^daily\s+([0-2]\d):([0-5]\d)$/);
  if (daily) return now.getHours() === Number(daily[1]) && now.getMinutes() === Number(daily[2]);
  const weekly = schedule.match(/^weekly\s+([0-7])\s+([0-2]\d):([0-5]\d)$/);
  if (weekly) {
    const day = Number(weekly[1]) % 7;
    return now.getDay() === day && now.getHours() === Number(weekly[2]) && now.getMinutes() === Number(weekly[3]);
  }
  if (schedule.startsWith("cron ")) return cronMatches(schedule.slice(5), now);
  return false;
}

export function isValidAutomationSchedule(schedule: string) {
  const value = schedule.trim().toLowerCase();
  return value === "manual"
    || value === "startup"
    || value === "hourly"
    || /^daily\s+[0-2]\d:[0-5]\d$/.test(value)
    || /^weekly\s+[0-7]\s+[0-2]\d:[0-5]\d$/.test(value)
    || (value.startsWith("cron ") && value.slice(5).trim().split(/\s+/).length === 5);
}

export function notificationSnippet(value: string, maxLength = 1800) {
  const cleaned = value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.floor(maxLength / 2)).trimEnd()}\n...\n${cleaned.slice(-Math.floor(maxLength / 2)).trimStart()}`;
}

export function notificationDurationLabel(durationMs?: number | null) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function automationStatusLabel(input: { exitCode: number | null; stopped?: boolean; timedOut?: boolean }) {
  if (input.stopped) return "已停止";
  if (input.timedOut) return "超时";
  return input.exitCode === 0 ? "成功" : "失败";
}

export function buildAutomationNotificationMessage(input: {
  automation: AutomationSummary;
  session: SessionSummary;
  exitCode: number | null;
  stopped?: boolean;
  timedOut?: boolean;
  durationMs?: number | null;
  command?: string | null;
  cwd?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  assistantResult?: string | null;
  errorSummary?: string | null;
}) {
  const duration = notificationDurationLabel(input.durationMs);
  const lines = [
    `自动化：${input.automation.name}`,
    `类型：${input.automation.actionType === "command" ? "系统命令" : "Agent"}`,
    `状态：${automationStatusLabel(input)}`,
    `退出码：${input.exitCode ?? "null"}`,
    duration ? `耗时：${duration}` : "",
    input.cwd || input.session.workspacePath ? `工作目录：${input.cwd ?? input.session.workspacePath}` : "",
    `会话：${input.session.title}`,
    `会话 ID：${input.session.id}`,
  ].filter(Boolean);

  if (input.command) {
    lines.push("", "命令：", notificationSnippet(input.command, 800));
  }

  const stdout = notificationSnippet(input.stdout ?? "", 1600);
  const stderr = notificationSnippet(input.stderr ?? "", 1600);
  const assistantResult = notificationSnippet(input.assistantResult ?? "", 2200);
  const errorSummary = notificationSnippet(input.errorSummary ?? "", 1800);

  if (assistantResult) lines.push("", "执行结果：", assistantResult);
  if (stdout) lines.push("", "stdout：", stdout);
  if (stderr) lines.push("", "stderr：", stderr);
  if (!assistantResult && !stdout && !stderr && errorSummary) lines.push("", "错误摘要：", errorSummary);
  if (!assistantResult && !stdout && !stderr && !errorSummary) lines.push("", "执行结果：", "没有捕获到可展示的输出。");
  return lines.join("\n");
}
