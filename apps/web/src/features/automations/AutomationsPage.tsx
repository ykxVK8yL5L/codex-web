import React, { useEffect, useState } from "react";
import { Bell, History, MessageSquare, Pause, Pencil, Play, Plus, RefreshCw, Save, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutomationNotifyRuleDialog } from "@/components/automations";
import { useAppDialog } from "@/components/AppDialog";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { formatShortDate, newestTaskRunsFirst, projectDisplayName } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import type { AutomationRunSummary, AutomationSummary, CreateAutomationRequest, PageResponse, ProjectSummary, ProviderModelsResponse, ProviderSummary, SessionSummary, TaskLogResponse, UpdateAutomationRequest } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";

export function AutomationsPage({
  sessionToken,
  automations,
  projects,
  providers,
  onChange,
  onOpenSession,
  title,
  t,
  notify,
  onOpenMainNav,
}: {
  sessionToken: string;
  automations: AutomationSummary[];
  projects: ProjectSummary[];
  providers: ProviderSummary[];
  onChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  title: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog(t);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("global");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [actionType, setActionType] = useState<AutomationSummary["actionType"]>("agent");
  const [automationModels, setAutomationModels] = useState<string[]>([]);
  const [automationCustomModel, setAutomationCustomModel] = useState(false);
  const [discoveringAutomationModels, setDiscoveringAutomationModels] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"manual" | "startup" | "hourly" | "daily" | "weekly" | "cron">("manual");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyDay, setWeeklyDay] = useState("1");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("");
  const [commandCwd, setCommandCwd] = useState("");
  const [commandTimeoutSeconds, setCommandTimeoutSeconds] = useState("0");
  const [retryMax, setRetryMax] = useState("0");
  const [retryDelayMinutes, setRetryDelayMinutes] = useState("5");
  const [overlapPolicy, setOverlapPolicy] = useState<NonNullable<AutomationSummary["overlapPolicy"]>>("queue");
  const [message, setMessage] = useState("");
  const [automationItems, setAutomationItems] = useState<AutomationSummary[]>(automations);
  const [automationCursor, setAutomationCursor] = useState<string | null>(null);
  const [automationHasMore, setAutomationHasMore] = useState(false);
  const [automationSearch, setAutomationSearch] = useState("");
  const [automationStatusFilter, setAutomationStatusFilter] = useState<"all" | AutomationSummary["status"]>("all");
  const [automationActionFilter, setAutomationActionFilter] = useState<"all" | NonNullable<AutomationSummary["actionType"]>>("all");
  const [automationProjectFilter, setAutomationProjectFilter] = useState("all");
  const [automationRunStatusFilter, setAutomationRunStatusFilter] = useState<"all" | AutomationRunSummary["status"]>("all");
  const [runsPanel, setRunsPanel] = useState<{ automation: AutomationSummary; runs: AutomationRunSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [runDetailPanel, setRunDetailPanel] = useState<{ automation: AutomationSummary; run: AutomationRunSummary; log?: string | null } | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<AutomationSummary | null>(null);
  const [notifyAutomation, setNotifyAutomation] = useState<AutomationSummary | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    actionType: "agent" as NonNullable<AutomationSummary["actionType"]>,
    projectId: "global",
    providerId: "",
    model: "",
    schedule: "manual",
    status: "active" as AutomationSummary["status"],
    prompt: "",
    command: "",
    cwd: "",
    commandTimeoutSeconds: "0",
    retryMax: "0",
    retryDelayMinutes: "5",
    overlapPolicy: "queue" as NonNullable<AutomationSummary["overlapPolicy"]>,
  });

  function showError(value: string) {
    setMessage(value);
    notify(value, "error");
  }

  function automationScheduleValue() {
    if (scheduleMode === "startup") return "startup";
    if (scheduleMode === "hourly") return "hourly";
    if (scheduleMode === "daily") return `daily ${dailyTime}`;
    if (scheduleMode === "weekly") return `weekly ${weeklyDay} ${dailyTime}`;
    if (scheduleMode === "cron") return `cron ${cronExpression.trim()}`;
    return "manual";
  }

  function parseAutomationSchedule(schedule: string): { mode: typeof scheduleMode; time: string; weekday: string; cron: string } {
    const value = schedule.trim();
    const dailyMatch = value.match(/^daily\s+([0-2]\d:[0-5]\d)$/i);
    const weeklyMatch = value.match(/^weekly\s+([0-7])\s+([0-2]\d:[0-5]\d)$/i);
    if (value === "startup") return { mode: "startup", time: "09:00", weekday: "1", cron: "0 9 * * *" };
    if (value === "hourly") return { mode: "hourly", time: "09:00", weekday: "1", cron: "0 9 * * *" };
    if (dailyMatch?.[1]) return { mode: "daily", time: dailyMatch[1], weekday: "1", cron: "0 9 * * *" };
    if (weeklyMatch?.[1] && weeklyMatch[2]) return { mode: "weekly", time: weeklyMatch[2], weekday: weeklyMatch[1] === "7" ? "0" : weeklyMatch[1], cron: "0 9 * * *" };
    if (value.startsWith("cron ")) return { mode: "cron", time: "09:00", weekday: "1", cron: value.slice(5).trim() || "0 9 * * *" };
    return { mode: "manual", time: "09:00", weekday: "1", cron: "0 9 * * *" };
  }

  function buildAutomationSchedule(mode: typeof scheduleMode, time = "09:00", weekday = "1", cron = "0 9 * * *") {
    if (mode === "startup") return "startup";
    if (mode === "hourly") return "hourly";
    if (mode === "daily") return `daily ${time || "09:00"}`;
    if (mode === "weekly") return `weekly ${weekday || "1"} ${time || "09:00"}`;
    if (mode === "cron") return `cron ${(cron || "0 9 * * *").trim()}`;
    return "manual";
  }

  useEffect(() => {
    setAutomationItems(automations);
  }, [automations]);

  useEffect(() => {
    void loadAutomations(true);
  }, [sessionToken]);

  async function discoverAutomationModels(nextProviderId = providerId, refresh = false) {
    const provider = providers.find((item) => item.id === nextProviderId);
    if (!provider) {
      setAutomationModels(model ? [model] : []);
      return;
    }
    if (!refresh) {
      const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
      setAutomationModels(models);
      setAutomationCustomModel(Boolean(model && !models.includes(model)));
      if (!model && models[0]) setModel(models[0]);
      return;
    }
    setDiscoveringAutomationModels(true);
    try {
      const response = await fetch(`/api/providers/${provider.id}/models?refresh=1`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = response.ok ? ((await response.json()) as ProviderModelsResponse) : null;
      const models = result?.models?.length ? result.models : provider.defaultModel ? [provider.defaultModel] : [];
      setAutomationModels(models);
      setAutomationCustomModel(Boolean(model && !models.includes(model)));
      if (!model && models[0]) setModel(models[0]);
    } finally {
      setDiscoveringAutomationModels(false);
    }
  }

  useEffect(() => {
    if (providerId) void discoverAutomationModels(providerId);
  }, [providerId, providers]);

  async function loadAutomations(reset = false, search = automationSearch) {
    const params = new URLSearchParams({ limit: "20" });
    if (!reset && automationCursor) params.set("cursor", automationCursor);
    if (search.trim()) params.set("q", search.trim());
    if (automationStatusFilter !== "all") params.set("status", automationStatusFilter);
    if (automationActionFilter !== "all") params.set("actionType", automationActionFilter);
    if (automationProjectFilter !== "all") params.set("projectId", automationProjectFilter);
    const response = await fetch(`/api/automations?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.loadFailed"));
      return;
    }
    const page = (await response.json()) as PageResponse<AutomationSummary>;
    setAutomationItems((items) => reset ? page.items : [...items, ...page.items.filter((automation) => !items.some((item) => item.id === automation.id))]);
    setAutomationCursor(page.nextCursor);
    setAutomationHasMore(page.hasMore);
  }

  useEffect(() => {
    void loadAutomations(true);
  }, [automationStatusFilter, automationActionFilter, automationProjectFilter]);

  async function createAutomation(event: React.FormEvent) {
    event.preventDefault();
    const schedule = automationScheduleValue();
    if (!validAutomationSchedule(schedule)) {
      showError(t("automation.scheduleInvalid"));
      return;
    }
    const body: CreateAutomationRequest = {
      name,
      projectId: projectId === "global" ? null : projectId,
      providerId: providerId || null,
      model: model.trim() || null,
      actionType,
      prompt,
      command,
      cwd: commandCwd.trim() || null,
      commandTimeoutSeconds: actionType === "command" ? Number(commandTimeoutSeconds) : null,
      retryMax: Number(retryMax),
      retryDelayMinutes: Number(retryDelayMinutes),
      overlapPolicy,
      schedule,
    };
    const response = await fetch("/api/automations", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("automation.createFailed"));
      return;
    }
    setName("");
    setProjectId("global");
    setProviderId("");
    setModel("");
    setActionType("agent");
    setAutomationModels([]);
    setAutomationCustomModel(false);
    setScheduleMode("manual");
    setDailyTime("09:00");
    setWeeklyDay("1");
    setCronExpression("0 9 * * *");
    setPrompt("");
    setCommand("");
    setCommandCwd("");
    setCommandTimeoutSeconds("0");
    setRetryMax("0");
    setRetryDelayMinutes("5");
    setOverlapPolicy("queue");
    setCreatePanelOpen(false);
    await onChange();
    await loadAutomations(true);
    notify(t("automation.created"), "success");
  }

  function validAutomationSchedule(schedule: string) {
    return /^(manual|startup|hourly|daily\s+[0-2]\d:[0-5]\d|weekly\s+[0-7]\s+[0-2]\d:[0-5]\d|cron\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+)$/i.test(schedule.trim());
  }

  async function updateAutomation(automation: AutomationSummary, input: UpdateAutomationRequest) {
    const response = await fetch(`/api/automations/${automation.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      showError(t("automation.updateFailed"));
      return false;
    }
    await onChange();
    await loadAutomations(true);
    notify(t("automation.updated"), "success");
    return true;
  }

  function editAutomation(automation: AutomationSummary) {
    setEditingAutomation(automation);
    setEditForm({
      name: automation.name,
      actionType: automation.actionType === "command" ? "command" : "agent",
      projectId: automation.projectId ?? "global",
      providerId: automation.providerId ?? "",
      model: automation.model ?? "",
      schedule: automation.schedule,
      status: automation.status,
      prompt: automation.prompt,
      command: automation.command ?? "",
      cwd: automation.cwd ?? "",
      commandTimeoutSeconds: String(automation.commandTimeoutSeconds ?? 0),
      retryMax: String(automation.retryMax ?? 0),
      retryDelayMinutes: String(automation.retryDelayMinutes ?? 5),
      overlapPolicy: automation.overlapPolicy === "skip" ? "skip" : "queue",
    });
  }

  async function submitEditAutomation(event: React.FormEvent) {
    event.preventDefault();
    if (!editingAutomation) return;
    if (!editForm.name.trim()) {
      showError(t("form.automationName"));
      return;
    }
    if (!validAutomationSchedule(editForm.schedule)) {
      showError(t("automation.scheduleInvalid"));
      return;
    }
    if (editForm.actionType === "agent" && !editForm.prompt.trim()) {
      showError(t("form.automationPrompt"));
      return;
    }
    if (editForm.actionType === "command" && !editForm.command.trim()) {
      showError(t("automation.commandPlaceholder"));
      return;
    }
    const updated = await updateAutomation(editingAutomation, {
      name: editForm.name.trim(),
      actionType: editForm.actionType,
      projectId: editForm.projectId === "global" ? null : editForm.projectId,
      providerId: editForm.actionType === "agent" ? editForm.providerId || null : null,
      model: editForm.actionType === "agent" ? editForm.model.trim() || null : null,
      schedule: editForm.schedule.trim(),
      status: editForm.status,
      prompt: editForm.prompt.trim() || editForm.command.trim(),
      command: editForm.actionType === "command" ? editForm.command.trim() : null,
      cwd: editForm.actionType === "command" ? editForm.cwd.trim() || null : null,
      commandTimeoutSeconds: editForm.actionType === "command" ? Number(editForm.commandTimeoutSeconds) : null,
      retryMax: Number(editForm.retryMax),
      retryDelayMinutes: Number(editForm.retryDelayMinutes),
      overlapPolicy: editForm.overlapPolicy,
    });
    if (updated) setEditingAutomation(null);
  }

  async function deleteAutomation(automation: AutomationSummary) {
    const decision = await dialog.confirmWithCheckbox({
      title: t("automation.deleteAutomation"),
      message: automation.name,
      confirmLabel: t("action.delete"),
      checkboxLabel: t("automation.deleteSession"),
      checkboxDefaultChecked: true,
      danger: true,
    });
    if (!decision.confirmed) return;
    const response = await fetch(`/api/automations/${automation.id}?${new URLSearchParams({ deleteSession: String(decision.checked) })}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.deleteFailed"));
      return;
    }
    await onChange();
    await loadAutomations(true);
    notify(t("automation.deleted"), "success");
  }

  function openAutomationNotifyDialog(automation: AutomationSummary) {
    setNotifyAutomation(automation);
  }

  async function runAutomation(automation: AutomationSummary, openSession = false) {
    const response = await fetch(`/api/automations/${automation.id}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.runFailed"));
      return;
    }
    const session = (await response.json()) as SessionSummary & { automationRunStatus?: AutomationRunSummary["status"] };
    await onChange();
    const runTone = session.automationRunStatus === "queued" || session.automationRunStatus === "skipped" ? "info" : "success";
    const runMessageKey = session.automationRunStatus === "queued"
      ? "automation.runQueued"
      : session.automationRunStatus === "skipped"
        ? "automation.runSkipped"
        : "automation.runStarted";
    notify(t(runMessageKey), runTone);
    await loadAutomations(true);
    if (runsPanel?.automation.id === automation.id) await openRuns(automation);
    if (openSession) onOpenSession(session.id);
  }

  async function openRuns(automation: AutomationSummary, older = false) {
    if (!older) setRunsPanel({ automation, runs: null });
    const cursor = older && runsPanel?.automation.id === automation.id ? runsPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    if (automationRunStatusFilter !== "all") params.set("status", automationRunStatusFilter);
    const response = await fetch(`/api/automations/${automation.id}/runs?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.runsReadFailed"));
      return;
    }
    const page = (await response.json()) as PageResponse<AutomationRunSummary>;
    setRunsPanel((current) => ({
      automation,
      runs: older && current?.automation.id === automation.id ? [...(current.runs ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function openAutomationRunDetail(automation: AutomationSummary, run: AutomationRunSummary) {
    setRunDetailPanel({ automation, run, log: null });
    const response = await fetch(`/api/codex/tasks/${run.sessionId}/log?maxBytes=120000`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setRunDetailPanel((current) => current?.run.id === run.id ? { ...current, log: t("session.noTaskLog") } : current);
      return;
    }
    const result = (await response.json()) as TaskLogResponse;
    setRunDetailPanel((current) => current?.run.id === run.id ? { ...current, log: result.log ? newestTaskRunsFirst(result.log) : t("session.noTaskLog") } : current);
  }

  useEffect(() => {
    if (runsPanel?.automation) void openRuns(runsPanel.automation);
  }, [automationRunStatusFilter]);

  async function clearAutomationRuns(automation: AutomationSummary) {
    const confirmed = await dialog.confirm({
      title: t("automation.clearRuns"),
      message: automation.name,
      confirmLabel: t("automation.clearRuns"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/automations/${automation.id}/runs`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.clearRunsFailed"));
      return;
    }
    notify(t("automation.runsCleared"), "success");
    await onChange();
    await loadAutomations(true);
    await openRuns(automation);
  }

  async function cancelQueuedAutomationRuns(automation: AutomationSummary) {
    const confirmed = await dialog.confirm({
      title: t("automation.cancelQueuedRuns"),
      message: automation.name,
      confirmLabel: t("automation.cancelQueuedRuns"),
    });
    if (!confirmed) return;
    const response = await fetch(`/api/automations/${automation.id}/runs/cancel-queued`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.cancelQueuedRunsFailed"));
      return;
    }
    notify(t("automation.queuedRunsCanceled"), "success");
    await onChange();
    await loadAutomations(true);
    await openRuns(automation);
  }

  async function stopRunningAutomationRuns(automation: AutomationSummary) {
    const confirmed = await dialog.confirm({
      title: t("automation.stopRunningRuns"),
      message: automation.name,
      confirmLabel: t("automation.stopRunningRuns"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/automations/${automation.id}/runs/stop-running`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("automation.stopRunningRunsFailed"));
      return;
    }
    notify(t("automation.runningRunsStopped"), "success");
    await onChange();
    await loadAutomations(true);
    if (runsPanel?.automation.id === automation.id) await openRuns(automation);
  }

  function automationRunStatusLabel(status: AutomationRunSummary["status"]) {
    if (status === "queued") return t("automation.runStatusQueued");
    if (status === "running") return t("automation.runStatusRunning");
    if (status === "done") return t("automation.runStatusDone");
    if (status === "failed") return t("automation.runStatusFailed");
    if (status === "stopped") return t("automation.runStatusStopped");
    if (status === "canceled") return t("automation.runStatusCanceled");
    return t("automation.runStatusSkipped");
  }

  function automationStatusLabel(status: AutomationSummary["status"]) {
    return status === "paused" ? t("automation.statusPaused") : t("automation.statusActive");
  }

  function automationWeekdayLabel(weekday: string) {
    if (weekday === "0") return t("automation.weekday0");
    if (weekday === "2") return t("automation.weekday2");
    if (weekday === "3") return t("automation.weekday3");
    if (weekday === "4") return t("automation.weekday4");
    if (weekday === "5") return t("automation.weekday5");
    if (weekday === "6") return t("automation.weekday6");
    return t("automation.weekday1");
  }

  function automationScheduleLabel(schedule: string) {
    const parsed = parseAutomationSchedule(schedule);
    if (parsed.mode === "manual") return t("automation.scheduleManual");
    if (parsed.mode === "startup") return t("automation.scheduleStartup");
    if (parsed.mode === "hourly") return t("automation.scheduleHourly");
    if (parsed.mode === "daily") return t("automation.scheduleDailyAt").replace("{time}", parsed.time);
    if (parsed.mode === "weekly") return t("automation.scheduleWeeklyAt").replace("{weekday}", automationWeekdayLabel(parsed.weekday)).replace("{time}", parsed.time);
    return t("automation.scheduleCronLabel").replace("{cron}", parsed.cron);
  }

  function cronFieldMatchesPreview(field: string, value: number) {
    return field.split(",").some((part) => {
      const item = part.trim();
      if (!item) return false;
      if (item === "*") return true;
      const stepMatch = item.match(/^\*\/(\d+)$/);
      if (stepMatch?.[1]) {
        const step = Number(stepMatch[1]);
        return Number.isFinite(step) && step > 0 && value % step === 0;
      }
      const parsed = Number(item);
      return Number.isFinite(parsed) && parsed === value;
    });
  }

  function cronMatchesPreview(expression: string, date: Date) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
    if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return false;
    return cronFieldMatchesPreview(minute, date.getMinutes())
      && cronFieldMatchesPreview(hour, date.getHours())
      && cronFieldMatchesPreview(dayOfMonth, date.getDate())
      && cronFieldMatchesPreview(month, date.getMonth() + 1)
      && cronFieldMatchesPreview(dayOfWeek, date.getDay());
  }

  function nextAutomationSchedulePreview(schedule: string, status: AutomationSummary["status"] = "active") {
    if (status !== "active") return t("automation.schedulePreviewPaused");
    const value = schedule.trim().toLowerCase();
    if (!validAutomationSchedule(value)) return t("automation.schedulePreviewInvalid");
    if (value === "manual") return t("automation.schedulePreviewManual");
    if (value === "startup") return t("automation.schedulePreviewStartup");
    const from = new Date();
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    if (value === "hourly") {
      next.setMinutes(0, 0, 0);
      if (next <= from) next.setHours(next.getHours() + 1);
      return t("automation.schedulePreviewNext").replace("{time}", formatShortDate(next.toISOString()));
    }
    const daily = value.match(/^daily\s+([0-2]\d):([0-5]\d)$/);
    if (daily?.[1] && daily[2]) {
      next.setHours(Number(daily[1]), Number(daily[2]), 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return t("automation.schedulePreviewNext").replace("{time}", formatShortDate(next.toISOString()));
    }
    const weekly = value.match(/^weekly\s+([0-7])\s+([0-2]\d):([0-5]\d)$/);
    if (weekly?.[1] && weekly[2] && weekly[3]) {
      const targetDay = Number(weekly[1]) % 7;
      next.setHours(Number(weekly[2]), Number(weekly[3]), 0, 0);
      next.setDate(next.getDate() + ((targetDay - next.getDay() + 7) % 7));
      if (next <= from) next.setDate(next.getDate() + 7);
      return t("automation.schedulePreviewNext").replace("{time}", formatShortDate(next.toISOString()));
    }
    if (value.startsWith("cron ")) {
      const expression = value.slice(5);
      const probe = new Date(next);
      for (let i = 0; i < 366 * 24 * 60; i += 1) {
        if (cronMatchesPreview(expression, probe)) return t("automation.schedulePreviewNext").replace("{time}", formatShortDate(probe.toISOString()));
        probe.setMinutes(probe.getMinutes() + 1);
      }
    }
    return t("automation.schedulePreviewInvalid");
  }

  function automationContentText(automation: AutomationSummary) {
    return (automation.actionType === "command" ? automation.command : automation.prompt) ?? "";
  }

  function automationContentPreview(automation: AutomationSummary) {
    const text = automationContentText(automation).replace(/\s+/g, " ").trim();
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  }

  function formatAutomationDuration(ms: number) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function automationRunTimingLabel(run: AutomationRunSummary) {
    const startedAt = Date.parse(run.startedAt);
    if (!Number.isFinite(startedAt)) return "";
    const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
    if (!Number.isFinite(finishedAt)) return "";
    const duration = formatAutomationDuration(finishedAt - startedAt);
    if (run.status === "queued") return t("automation.queuedFor").replace("{duration}", duration);
    if (run.status === "running") return t("automation.runningFor").replace("{duration}", duration);
    return t("automation.duration").replace("{duration}", duration);
  }

  function editAutomationScheduleFields() {
    const parsed = parseAutomationSchedule(editForm.schedule);
    return (
      <>
        <select name="edit-automation-schedule-mode" value={parsed.mode} onChange={(event) => {
          const mode = event.target.value as typeof scheduleMode;
          setEditForm((current) => {
            const currentParsed = parseAutomationSchedule(current.schedule);
            return { ...current, schedule: buildAutomationSchedule(mode, currentParsed.time, currentParsed.weekday, currentParsed.cron) };
          });
        }}>
          <option value="manual">{t("automation.scheduleManual")}</option>
          <option value="startup">{t("automation.scheduleStartup")}</option>
          <option value="hourly">{t("automation.scheduleHourly")}</option>
          <option value="daily">{t("automation.scheduleDaily")}</option>
          <option value="weekly">{t("automation.scheduleWeekly")}</option>
          <option value="cron">{t("automation.scheduleCron")}</option>
        </select>
        {(parsed.mode === "daily" || parsed.mode === "weekly") && <input name="edit-automation-schedule-time" type="time" value={parsed.time} onChange={(event) => {
          const nextTime = event.target.value || "09:00";
          setEditForm((current) => {
            const currentParsed = parseAutomationSchedule(current.schedule);
            return { ...current, schedule: buildAutomationSchedule(currentParsed.mode, nextTime, currentParsed.weekday, currentParsed.cron) };
          });
        }} />}
        {parsed.mode === "weekly" && (
          <select name="edit-automation-schedule-weekday" value={parsed.weekday} onChange={(event) => {
            const nextWeekday = event.target.value;
            setEditForm((current) => {
              const currentParsed = parseAutomationSchedule(current.schedule);
              return { ...current, schedule: buildAutomationSchedule(currentParsed.mode, currentParsed.time, nextWeekday, currentParsed.cron) };
            });
          }}>
            <option value="1">{t("automation.weekday1")}</option>
            <option value="2">{t("automation.weekday2")}</option>
            <option value="3">{t("automation.weekday3")}</option>
            <option value="4">{t("automation.weekday4")}</option>
            <option value="5">{t("automation.weekday5")}</option>
            <option value="6">{t("automation.weekday6")}</option>
            <option value="0">{t("automation.weekday0")}</option>
          </select>
        )}
        {parsed.mode === "cron" && <input name="edit-automation-schedule-cron" value={parsed.cron} onChange={(event) => {
          setEditForm((current) => ({ ...current, schedule: buildAutomationSchedule("cron", "09:00", "1", event.target.value) }));
        }} placeholder="0 9 * * *" />}
        <code>{editForm.schedule}</code>
        <span className="subtle">{nextAutomationSchedulePreview(editForm.schedule, editForm.status)}</span>
      </>
    );
  }

  function automationModelField(namePrefix = "") {
    return (
      <>
        <div className="inline-field-with-action">
          <select name={`${namePrefix}automationmodel`} value={automationCustomModel || !automationModels.includes(model) ? "__custom" : model} onChange={(event) => {
            if (event.target.value === "__custom") {
              setAutomationCustomModel(true);
              return;
            }
            setAutomationCustomModel(false);
            setModel(event.target.value);
          }}>
            {automationModels.map((item) => <option key={item} value={item}>{item}</option>)}
            <option value="__custom">{t("contacts.customModel")}</option>
          </select>
          <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!providerId || discoveringAutomationModels} onClick={() => void discoverAutomationModels(providerId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
        </div>
        {(automationCustomModel || !automationModels.length || !automationModels.includes(model)) && <input name={`${namePrefix}model`} value={model} onChange={(event) => setModel(event.target.value)} placeholder={t("form.defaultModel")} />}
      </>
    );
  }

  return (
    <main className="management-page automation-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.automations")}`} title={title} action={t("action.refresh")} onAction={() => void loadAutomations(true)} onOpenMainNav={onOpenMainNav} menuLabel={title} />
      <section className="management-layout">
        <form className="management-form" onSubmit={createAutomation}>
          <strong>{t("automation.createTitle")}</strong>
          <input name="name-3" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.automationName")} required />
          <select name="automation-action-type" value={actionType ?? "agent"} onChange={(event) => setActionType(event.target.value === "command" ? "command" : "agent")}>
            <option value="agent">{t("automation.actionAgent")}</option>
            <option value="command">{t("automation.actionCommand")}</option>
          </select>
          <select name="projectid" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="global">{t("automation.global")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
          </select>
          {actionType !== "command" && (
            <>
              <select name="providerid" value={providerId} onChange={(event) => {
                const nextProviderId = event.target.value;
                const provider = providers.find((item) => item.id === nextProviderId);
                const models = provider?.models?.length ? provider.models : provider?.defaultModel ? [provider.defaultModel] : [];
                setProviderId(nextProviderId);
                setAutomationModels(models);
                setAutomationCustomModel(false);
                setModel(models[0] ?? provider?.defaultModel ?? "");
              }}>
                <option value="">{t("automation.defaultProvider")}</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
              {automationModelField()}
            </>
          )}
          <select name="schedule-mode" value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as typeof scheduleMode)}>
            <option value="manual">{t("automation.scheduleManual")}</option>
            <option value="startup">{t("automation.scheduleStartup")}</option>
            <option value="hourly">{t("automation.scheduleHourly")}</option>
            <option value="daily">{t("automation.scheduleDaily")}</option>
            <option value="weekly">{t("automation.scheduleWeekly")}</option>
            <option value="cron">{t("automation.scheduleCron")}</option>
          </select>
          {(scheduleMode === "daily" || scheduleMode === "weekly") && <input name="schedule-time" type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} />}
          {scheduleMode === "weekly" && (
            <select name="schedule-weekday" value={weeklyDay} onChange={(event) => setWeeklyDay(event.target.value)}>
              <option value="1">{t("automation.weekday1")}</option>
              <option value="2">{t("automation.weekday2")}</option>
              <option value="3">{t("automation.weekday3")}</option>
              <option value="4">{t("automation.weekday4")}</option>
              <option value="5">{t("automation.weekday5")}</option>
              <option value="6">{t("automation.weekday6")}</option>
              <option value="0">{t("automation.weekday0")}</option>
            </select>
          )}
          {scheduleMode === "cron" && <input name="schedule-cron" value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} placeholder="0 9 * * *" />}
          <code>{automationScheduleValue()}</code>
          <span className="subtle">{nextAutomationSchedulePreview(automationScheduleValue())}</span>
          {actionType === "command" ? (
            <>
              <input name="automation-cwd" value={commandCwd} onChange={(event) => setCommandCwd(event.target.value)} placeholder={t("automation.commandCwdPlaceholder")} />
              <input name="automation-command-timeout" type="number" min="0" max="86400" value={commandTimeoutSeconds} onChange={(event) => setCommandTimeoutSeconds(event.target.value)} placeholder={t("automation.commandTimeoutPlaceholder")} />
              <textarea name="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t("automation.commandPlaceholder")} required />
            </>
          ) : (
            <textarea name="prompt-2" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("form.automationPrompt")} required />
          )}
          <div className="inline-field-grid">
            <label>
              <span>{t("automation.retryMaxLabel")}</span>
              <input name="automation-retry-max" type="number" min="0" max="10" value={retryMax} onChange={(event) => setRetryMax(event.target.value)} placeholder={t("automation.retryMaxPlaceholder")} />
            </label>
            <label>
              <span>{t("automation.retryDelayLabel")}</span>
              <input name="automation-retry-delay" type="number" min="1" max="1440" value={retryDelayMinutes} onChange={(event) => setRetryDelayMinutes(event.target.value)} placeholder={t("automation.retryDelayPlaceholder")} />
            </label>
          </div>
          <select name="automation-overlap-policy" value={overlapPolicy} onChange={(event) => setOverlapPolicy(event.target.value === "skip" ? "skip" : "queue")}>
            <option value="queue">{t("automation.overlapQueue")}</option>
            <option value="skip">{t("automation.overlapSkip")}</option>
          </select>
          {message && <span className="form-error">{message}</span>}
          <Button>{t("automation.create")}</Button>
        </form>
        <section className="project-list-pane">
          <div className="project-list-head">
            <strong>{t("automation.listTitle")}</strong>
            <div className="project-list-head-actions">
              <span>{automationItems.length} {t("automation.countUnit")}</span>
              <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("automation.create")} aria-label={t("automation.create")} onClick={() => setCreatePanelOpen(true)}><Plus size={16} /></Button>
            </div>
          </div>
          <FilterToolbar className="automation-filter-toolbar">
            <FilterSearchInput value={automationSearch} onChange={(event) => setAutomationSearch(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") void loadAutomations(true, automationSearch);
            }} placeholder={t("automation.searchAutomations")} />
            <select name="automation-status-filter" value={automationStatusFilter} onChange={(event) => setAutomationStatusFilter(event.target.value === "active" || event.target.value === "paused" ? event.target.value : "all")}>
              <option value="all">{t("automation.allStatuses")}</option>
              <option value="active">{t("automation.statusActive")}</option>
              <option value="paused">{t("automation.statusPaused")}</option>
            </select>
            <select name="automation-action-filter" value={automationActionFilter} onChange={(event) => setAutomationActionFilter(event.target.value === "command" ? "command" : event.target.value === "agent" ? "agent" : "all")}>
              <option value="all">{t("automation.allActions")}</option>
              <option value="agent">{t("automation.actionAgent")}</option>
              <option value="command">{t("automation.actionCommand")}</option>
            </select>
            <select name="automation-project-filter" value={automationProjectFilter} onChange={(event) => setAutomationProjectFilter(event.target.value)}>
              <option value="all">{t("automation.allProjects")}</option>
              <option value="global">{t("automation.global")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadAutomations(true, automationSearch)}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
          </FilterToolbar>
          <div className="project-list">
            {automationItems.map((automation) => (
              <article className="project-list-card" key={automation.id}>
                <div className="project-list-title">
                  <strong>{automation.name}</strong>
                  <span className={`pill ${automation.status === "paused" ? "warm" : ""}`}>{automationStatusLabel(automation.status)}</span>
                </div>
                <code className="project-list-code-preview" title={automationContentText(automation)}>{automationContentPreview(automation)}</code>
                <div className="project-list-meta">
                  <span>{automation.actionType === "command" ? t("automation.actionCommand") : t("automation.actionAgent")}</span>
                  <span title={automation.schedule}>{automationScheduleLabel(automation.schedule)}</span>
                  <span>{projectDisplayName(projects.find((project) => project.id === automation.projectId), projects) || t("automation.global")}</span>
                  {automation.actionType === "command"
                    ? <span>{automation.cwd ?? t("automation.defaultCwd")}</span>
                    : <span>{providers.find((provider) => provider.id === automation.providerId)?.name ?? t("automation.defaultProvider")} / {automation.model ?? t("session.noModel")}</span>}
                  {automation.actionType === "command" && <span>{automation.commandTimeoutSeconds ? t("automation.commandTimeoutLabel").replace("{seconds}", String(automation.commandTimeoutSeconds)) : t("automation.commandTimeoutNone")}</span>}
                  <span>{t("automation.runSummary").replace("{running}", String(automation.runningRuns ?? 0)).replace("{queued}", String(automation.queuedRuns ?? 0))}</span>
                  {automation.lastRunStatus && <span>{t("automation.lastRunSummary").replace("{status}", automationRunStatusLabel(automation.lastRunStatus)).replace("{time}", automation.lastRunAt ? formatShortDate(automation.lastRunAt) : "-")}</span>}
                  <span>{automation.nextRunAt ? t("automation.nextRunSummary").replace("{time}", formatShortDate(automation.nextRunAt)) : t("automation.noNextRun")}</span>
                  <span>{automation.overlapPolicy === "skip" ? t("automation.overlapSkipShort") : t("automation.overlapQueueShort")}</span>
                  {Boolean(automation.retryMax) && <span>{t("automation.retrySummary").replace("{count}", String(automation.retryMax)).replace("{minutes}", String(automation.retryDelayMinutes ?? 5))}</span>}
                  <span>{formatShortDate(automation.updatedAt)}</span>
                </div>
                <div className="project-list-actions">
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={t("automation.runNow")} aria-label={t("automation.runNow")} onClick={() => void runAutomation(automation)}><IconText icon={Play}>{t("automation.runNow")}</IconText></Button>
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={t("automation.runAndOpen")} aria-label={t("automation.runAndOpen")} onClick={() => void runAutomation(automation, true)}><IconText icon={MessageSquare}>{t("automation.runAndOpen")}</IconText></Button>
                  {Boolean(automation.runningRuns) && <Button className="icon-only" variant="outline" size="sm" type="button" title={t("automation.stopRunningRuns")} aria-label={t("automation.stopRunningRuns")} onClick={() => void stopRunningAutomationRuns(automation)}><IconText icon={Square}>{t("automation.stopRunningRuns")}</IconText></Button>}
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={t("automation.runs")} aria-label={t("automation.runs")} onClick={() => void openRuns(automation)}><IconText icon={History}>{t("automation.runs")}</IconText></Button>
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={t("automation.notify")} aria-label={t("automation.notify")} onClick={() => openAutomationNotifyDialog(automation)}><IconText icon={Bell}>{t("automation.notify")}</IconText></Button>
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={t("automation.editTitle")} aria-label={t("automation.editTitle")} onClick={() => editAutomation(automation)}><IconText icon={Pencil}>{t("automation.editTitle")}</IconText></Button>
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={automation.status === "active" ? t("automation.pause") : t("automation.resume")} aria-label={automation.status === "active" ? t("automation.pause") : t("automation.resume")} onClick={() => void updateAutomation(automation, { status: automation.status === "active" ? "paused" : "active" })}><IconText icon={automation.status === "active" ? Pause : Play}>{automation.status === "active" ? t("automation.pause") : t("automation.resume")}</IconText></Button>
                  <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteAutomation(automation)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>
                </div>
              </article>
            ))}
            {automationHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadAutomations(false)}>{t("session.loadMore")}</button>}
            {!automationItems.length && <div className="empty-state">{t("automation.noAutomations")}</div>}
          </div>
        </section>
      </section>
      {runsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("automation.runsTitle")}</strong>
              <span>{runsPanel.automation.name}</span>
            </div>
            <div className="dialog-head-actions">
              <select name="automation-run-status-filter" value={automationRunStatusFilter} onChange={(event) => {
                const value = event.target.value;
                setAutomationRunStatusFilter(value === "queued" || value === "running" || value === "done" || value === "failed" || value === "stopped" || value === "skipped" || value === "canceled" ? value : "all");
              }}>
                <option value="all">{t("automation.allRunStatuses")}</option>
                <option value="queued">{t("automation.runStatusQueued")}</option>
                <option value="running">{t("automation.runStatusRunning")}</option>
                <option value="done">{t("automation.runStatusDone")}</option>
                <option value="failed">{t("automation.runStatusFailed")}</option>
                <option value="stopped">{t("automation.runStatusStopped")}</option>
                <option value="skipped">{t("automation.runStatusSkipped")}</option>
                <option value="canceled">{t("automation.runStatusCanceled")}</option>
              </select>
              {runsPanel.runs?.some((run) => run.status === "running") && <button className="ghost-button danger-button" type="button" onClick={() => void stopRunningAutomationRuns(runsPanel.automation)}>{t("automation.stopRunningRuns")}</button>}
              {runsPanel.runs?.some((run) => run.status === "queued") && <button className="ghost-button" type="button" onClick={() => void cancelQueuedAutomationRuns(runsPanel.automation)}>{t("automation.cancelQueuedRuns")}</button>}
              <button className="ghost-button danger-button" type="button" onClick={() => void clearAutomationRuns(runsPanel.automation)}>{t("automation.clearRuns")}</button>
              <button className="ghost-button" type="button" onClick={() => setRunsPanel(null)}>{t("action.close")}</button>
            </div>
          </div>
          <div className="extension-detail">
            {!runsPanel.runs && <div className="subtle">{t("automation.runsLoading")}</div>}
            {runsPanel.runs?.map((run) => (
              <button className="file-list-item" key={run.id} type="button" onClick={() => void openAutomationRunDetail(runsPanel.automation, run)}>
                <span>{automationRunStatusLabel(run.status)}{run.exitCode !== null ? ` · exit ${run.exitCode}` : ""} · {automationRunTimingLabel(run)}</span>
                <em>{formatShortDate(run.finishedAt ?? run.startedAt)}</em>
              </button>
            ))}
            {runsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openRuns(runsPanel.automation, true)}>{t("session.loadMore")}</button>}
            {runsPanel.runs && !runsPanel.runs.length && <div className="empty-state">{t("automation.noRuns")}</div>}
          </div>
        </div>
      )}
      {runDetailPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("automation.runDetailTitle")}</strong>
              <span>{runDetailPanel.automation.name}</span>
            </div>
            <div className="dialog-head-actions">
              <button className="ghost-button" type="button" onClick={() => {
                onOpenSession(runDetailPanel.run.sessionId);
                setRunDetailPanel(null);
              }}>{t("automation.openRunSession")}</button>
              <button className="ghost-button" type="button" onClick={() => setRunDetailPanel(null)}>{t("action.close")}</button>
            </div>
          </div>
          <div className="extension-detail">
            <div className="settings-feature-grid">
              <div className="settings-feature-panel">
                <strong>{t("automation.runDetailStatus")}</strong>
                <span>{automationRunStatusLabel(runDetailPanel.run.status)}{runDetailPanel.run.exitCode !== null ? ` · exit ${runDetailPanel.run.exitCode}` : ""}</span>
              </div>
              <div className="settings-feature-panel">
                <strong>{t("automation.runDetailTiming")}</strong>
                <span>{formatShortDate(runDetailPanel.run.startedAt)} → {runDetailPanel.run.finishedAt ? formatShortDate(runDetailPanel.run.finishedAt) : t("session.statusRunning")}</span>
                <span>{automationRunTimingLabel(runDetailPanel.run)}</span>
              </div>
              <div className="settings-feature-panel">
                <strong>{t("automation.runDetailContext")}</strong>
                <span>{runDetailPanel.automation.actionType === "command" ? t("automation.actionCommand") : t("automation.actionAgent")}</span>
                <span title={runDetailPanel.automation.schedule}>{automationScheduleLabel(runDetailPanel.automation.schedule)}</span>
                <span>{projectDisplayName(projects.find((project) => project.id === runDetailPanel.automation.projectId), projects) || t("automation.global")}</span>
              </div>
              <div className="settings-feature-panel">
                <strong>{runDetailPanel.automation.actionType === "command" ? t("automation.commandLabel") : t("automation.promptLabel")}</strong>
                <code title={automationContentText(runDetailPanel.automation)}>{automationContentPreview(runDetailPanel.automation)}</code>
              </div>
            </div>
            {runDetailPanel.automation.actionType === "command" && (
              <div className="automation-run-log-panel">
                <strong>{t("automation.commandOutput")}</strong>
                <pre>{runDetailPanel.log === null ? t("automation.runsLoading") : runDetailPanel.log}</pre>
              </div>
            )}
          </div>
        </div>
      )}
      {editingAutomation && (
        <div className="workspace-modal compact-modal automation-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("automation.editTitle")}</strong>
              <span>{editingAutomation.name}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setEditingAutomation(null)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={submitEditAutomation}>
            <input name="edit-automation-name" value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("form.automationName")} required />
            <select name="edit-automation-action-type" value={editForm.actionType} onChange={(event) => setEditForm((current) => ({ ...current, actionType: event.target.value === "command" ? "command" : "agent" }))}>
              <option value="agent">{t("automation.actionAgent")}</option>
              <option value="command">{t("automation.actionCommand")}</option>
            </select>
            <select name="edit-automation-project" value={editForm.projectId} onChange={(event) => setEditForm((current) => ({ ...current, projectId: event.target.value }))}>
              <option value="global">{t("automation.global")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            {editForm.actionType === "agent" && (
              <>
                <select name="edit-automation-provider" value={editForm.providerId} onChange={(event) => setEditForm((current) => ({ ...current, providerId: event.target.value }))}>
                  <option value="">{t("automation.defaultProvider")}</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
                <input name="edit-automation-model" value={editForm.model} onChange={(event) => setEditForm((current) => ({ ...current, model: event.target.value }))} placeholder={t("form.defaultModel")} />
              </>
            )}
            {editAutomationScheduleFields()}
            <select name="edit-automation-status" value={editForm.status} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value === "paused" ? "paused" : "active" }))}>
              <option value="active">{t("automation.resume")}</option>
              <option value="paused">{t("automation.pause")}</option>
            </select>
            {editForm.actionType === "command" ? (
              <>
                <input name="edit-automation-cwd" value={editForm.cwd} onChange={(event) => setEditForm((current) => ({ ...current, cwd: event.target.value }))} placeholder={t("automation.commandCwdPlaceholder")} />
                <input name="edit-automation-command-timeout" type="number" min="0" max="86400" value={editForm.commandTimeoutSeconds} onChange={(event) => setEditForm((current) => ({ ...current, commandTimeoutSeconds: event.target.value }))} placeholder={t("automation.commandTimeoutPlaceholder")} />
                <textarea name="edit-automation-command" value={editForm.command} onChange={(event) => setEditForm((current) => ({ ...current, command: event.target.value }))} placeholder={t("automation.commandPlaceholder")} required />
              </>
            ) : (
              <textarea name="edit-automation-prompt" value={editForm.prompt} onChange={(event) => setEditForm((current) => ({ ...current, prompt: event.target.value }))} placeholder={t("form.automationPrompt")} required />
            )}
            <div className="inline-field-grid">
              <label>
                <span>{t("automation.retryMaxLabel")}</span>
                <input name="edit-automation-retry-max" type="number" min="0" max="10" value={editForm.retryMax} onChange={(event) => setEditForm((current) => ({ ...current, retryMax: event.target.value }))} placeholder={t("automation.retryMaxPlaceholder")} />
              </label>
              <label>
                <span>{t("automation.retryDelayLabel")}</span>
                <input name="edit-automation-retry-delay" type="number" min="1" max="1440" value={editForm.retryDelayMinutes} onChange={(event) => setEditForm((current) => ({ ...current, retryDelayMinutes: event.target.value }))} placeholder={t("automation.retryDelayPlaceholder")} />
              </label>
            </div>
            <select name="edit-automation-overlap-policy" value={editForm.overlapPolicy} onChange={(event) => setEditForm((current) => ({ ...current, overlapPolicy: event.target.value === "skip" ? "skip" : "queue" }))}>
              <option value="queue">{t("automation.overlapQueue")}</option>
              <option value="skip">{t("automation.overlapSkip")}</option>
            </select>
            {message && <span className="form-error">{message}</span>}
            <button className="dark-button" type="submit"><IconText icon={Save}>{t("action.save")}</IconText></button>
          </form>
        </div>
      )}
      {createPanelOpen && (
        <div className="workspace-modal compact-modal automation-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("automation.createTitle")}</strong>
              <span>{t("automation.listTitle")}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setCreatePanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={createAutomation}>
            <input name="mobile-name-3" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.automationName")} required />
            <select name="mobile-automation-action-type" value={actionType ?? "agent"} onChange={(event) => setActionType(event.target.value === "command" ? "command" : "agent")}>
              <option value="agent">{t("automation.actionAgent")}</option>
              <option value="command">{t("automation.actionCommand")}</option>
            </select>
            <select name="mobile-projectid" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="global">{t("automation.global")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            {actionType !== "command" && (
              <>
                <select name="mobile-providerid" value={providerId} onChange={(event) => {
                  const nextProviderId = event.target.value;
                  const provider = providers.find((item) => item.id === nextProviderId);
                  const models = provider?.models?.length ? provider.models : provider?.defaultModel ? [provider.defaultModel] : [];
                  setProviderId(nextProviderId);
                  setAutomationModels(models);
                  setAutomationCustomModel(false);
                  setModel(models[0] ?? provider?.defaultModel ?? "");
                }}>
                  <option value="">{t("automation.defaultProvider")}</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
                {automationModelField("mobile-")}
              </>
            )}
            <select name="mobile-schedule-mode" value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as typeof scheduleMode)}>
              <option value="manual">{t("automation.scheduleManual")}</option>
              <option value="startup">{t("automation.scheduleStartup")}</option>
              <option value="hourly">{t("automation.scheduleHourly")}</option>
              <option value="daily">{t("automation.scheduleDaily")}</option>
              <option value="weekly">{t("automation.scheduleWeekly")}</option>
              <option value="cron">{t("automation.scheduleCron")}</option>
            </select>
            {(scheduleMode === "daily" || scheduleMode === "weekly") && <input name="mobile-schedule-time" type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} />}
            {scheduleMode === "weekly" && <select name="mobile-schedule-weekday" value={weeklyDay} onChange={(event) => setWeeklyDay(event.target.value)}><option value="1">{t("automation.weekday1")}</option><option value="2">{t("automation.weekday2")}</option><option value="3">{t("automation.weekday3")}</option><option value="4">{t("automation.weekday4")}</option><option value="5">{t("automation.weekday5")}</option><option value="6">{t("automation.weekday6")}</option><option value="0">{t("automation.weekday0")}</option></select>}
            {scheduleMode === "cron" && <input name="mobile-schedule-cron" value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} placeholder="0 9 * * *" />}
            <code>{automationScheduleValue()}</code>
            <span className="subtle">{nextAutomationSchedulePreview(automationScheduleValue())}</span>
            {actionType === "command" ? (
              <>
                <input name="mobile-automation-cwd" value={commandCwd} onChange={(event) => setCommandCwd(event.target.value)} placeholder={t("automation.commandCwdPlaceholder")} />
                <input name="mobile-automation-command-timeout" type="number" min="0" max="86400" value={commandTimeoutSeconds} onChange={(event) => setCommandTimeoutSeconds(event.target.value)} placeholder={t("automation.commandTimeoutPlaceholder")} />
                <textarea name="mobile-command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t("automation.commandPlaceholder")} required />
              </>
            ) : (
              <textarea name="mobile-prompt-2" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("form.automationPrompt")} required />
            )}
            <div className="inline-field-grid">
              <label>
                <span>{t("automation.retryMaxLabel")}</span>
                <input name="mobile-automation-retry-max" type="number" min="0" max="10" value={retryMax} onChange={(event) => setRetryMax(event.target.value)} placeholder={t("automation.retryMaxPlaceholder")} />
              </label>
              <label>
                <span>{t("automation.retryDelayLabel")}</span>
                <input name="mobile-automation-retry-delay" type="number" min="1" max="1440" value={retryDelayMinutes} onChange={(event) => setRetryDelayMinutes(event.target.value)} placeholder={t("automation.retryDelayPlaceholder")} />
              </label>
            </div>
            <select name="mobile-automation-overlap-policy" value={overlapPolicy} onChange={(event) => setOverlapPolicy(event.target.value === "skip" ? "skip" : "queue")}>
              <option value="queue">{t("automation.overlapQueue")}</option>
              <option value="skip">{t("automation.overlapSkip")}</option>
            </select>
            {message && <span className="form-error">{message}</span>}
            <Button>{t("automation.create")}</Button>
          </form>
        </div>
      )}
      <AutomationNotifyRuleDialog
        automation={notifyAutomation}
        open={Boolean(notifyAutomation)}
        sessionToken={sessionToken}
        t={t}
        notify={notify}
        onClose={() => setNotifyAutomation(null)}
      />
    </main>
  );
}
