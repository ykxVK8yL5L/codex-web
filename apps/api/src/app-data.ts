import type {
  AutomationSummary,
  ProjectCheckRunSummary,
  ProjectGitOperationSummary,
  ProjectSummary,
  GoalSummary,
  ProviderCapabilities,
  ProviderHealthCheck,
  ProviderSummary,
  SessionSummary,
} from "@codex-web/protocol";

type ProviderRecord = ProviderSummary & { apiKey?: string };
type AppData = {
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  providers: ProviderRecord[];
  automations: AutomationSummary[];
};

type AppDataStoreDeps = {
  db: any;
  activeGoalForSession: (session: SessionSummary) => GoalSummary | null | undefined;
  automationFromRow: (row: Record<string, unknown>, includeRuntime?: boolean) => AutomationSummary;
  conversationType: (value: unknown) => SessionSummary["conversationType"];
  ensureScratchSessionWorkspace: (sessionId: string) => string;
  jsonArray: (value: unknown) => string[];
  resolveTerminalCwd: (cwd: string) => string;
  scratchSessionWorkspacePath: (sessionId: string) => string;
  upsertAutomation: (automation: AutomationSummary) => void;
  upsertProject: (project: ProjectSummary) => void;
  upsertProvider: (provider: ProviderRecord) => void;
  upsertSession: (session: SessionSummary) => void;
};

export function createAppDataStore(deps: AppDataStoreDeps) {
  const { db, activeGoalForSession, automationFromRow, conversationType, ensureScratchSessionWorkspace, jsonArray, resolveTerminalCwd, scratchSessionWorkspacePath, upsertAutomation, upsertProject, upsertProvider, upsertSession } = deps;

function loadAppData(): AppData {
  const projects = (db.prepare("select * from projects order by name asc").all() as Array<Record<string, unknown>>).map(projectFromRow);
  const automationSessionIds = new Set([
    ...(db.prepare("select distinct session_id from automation_runs").all() as Array<{ session_id?: string }>).map((row) => String(row.session_id)).filter(Boolean),
    ...(db.prepare("select session_id from automations where session_id is not null and session_id != ''").all() as Array<{ session_id?: string }>).map((row) => String(row.session_id)).filter(Boolean),
  ]);
  const sessions = (db.prepare("select * from sessions order by updated_at desc").all() as Array<Record<string, unknown>>)
    .map((row) => sessionFromRow(row, projects, false));
  for (const session of sessions) {
    if (automationSessionIds.has(session.id)) session.conversationType = "automation";
    const project = session.projectId ? projects.find((item) => item.id === session.projectId) : null;
    if (session.conversationType === "agent" && session.roomId) {
      const roomRun = db.prepare("select workspace_path from agent_runs where session_id = ? and workspace_path is not null and workspace_path != '' order by started_at desc limit 1").get(session.id) as { workspace_path?: string | null } | undefined;
      session.workspacePath = roomRun?.workspace_path ? resolveTerminalCwd(String(roomRun.workspace_path)) : session.workspacePath || ensureScratchSessionWorkspace(session.id);
      if (!project) session.projectId = null;
      session.kind = project ? "project" : "scratch";
    } else if (project) {
      session.workspacePath = resolveTerminalCwd(project.workspacePath);
    } else {
      session.projectId = null;
      session.kind = "scratch";
      session.workspacePath = ensureScratchSessionWorkspace(session.id);
    }
    upsertSession(session);
  }
  const providers = (db.prepare("select * from providers order by name asc").all() as Array<Record<string, unknown>>).map(providerFromRow);
  const automations = (db.prepare("select * from automations order by updated_at desc").all() as Array<Record<string, unknown>>).map((row) => automationFromRow(row, false));
  return { sessions, projects, providers, automations };
}

function saveAppData(appData: AppData) {
  const save = db.transaction(() => {
    for (const provider of appData.providers) upsertProvider(provider);
    for (const project of appData.projects) upsertProject(project);
    for (const session of appData.sessions) upsertSession(session);
    for (const automation of appData.automations) upsertAutomation(automation);
  });
  save();
}

function sessionFromRow(row: Record<string, unknown>, projects: ProjectSummary[] = [], includeGoal = true): SessionSummary {
  const projectId = row.project_id ? String(row.project_id) : null;
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const storedWorkspacePath = row.workspace_path ? String(row.workspace_path) : "";
  const directAgent = db.prepare("select agent_id from agent_sessions where session_id = ?").get(String(row.id)) as { agent_id?: string } | undefined;
  const session = {
    id: String(row.id),
    kind: row.kind as SessionSummary["kind"],
    conversationType: conversationType(row.conversation_type),
    roomId: row.room_id ? String(row.room_id) : null,
    directAgentId: directAgent?.agent_id ?? null,
    title: String(row.title),
    projectId,
    workspacePath: storedWorkspacePath || project?.workspacePath || scratchSessionWorkspacePath(String(row.id)),
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    codexSessionId: row.codex_session_id ? String(row.codex_session_id) : null,
    notificationsEnabled: row.notifications_enabled === undefined ? true : Boolean(row.notifications_enabled),
    showMessageUsage: row.show_message_usage === undefined || row.show_message_usage === null ? null : Boolean(row.show_message_usage),
    status: row.status as SessionSummary["status"],
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: String(row.updated_at),
  };
  return includeGoal ? { ...session, goal: activeGoalForSession(session) } : { ...session, goal: null };
}

function projectFromRow(row: Record<string, unknown>): ProjectSummary {
  const checkCommand = row.check_command ? String(row.check_command) : undefined;
  return {
    id: String(row.id),
    name: String(row.name),
    workspacePath: String(row.workspace_path),
    runner: row.runner as ProjectSummary["runner"],
    changedFiles: Number(row.changed_files ?? 0),
    stagedFiles: 0,
    modifiedFiles: Number(row.changed_files ?? 0),
    untrackedFiles: 0,
    gitStatus: Number(row.changed_files ?? 0) > 0 ? "dirty" : "clean",
    checkCommand,
    checkCommands: splitProjectCheckCommands(checkCommand),
  };
}

function splitProjectCheckCommands(value?: string | null) {
  return (value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function projectCheckRunFromRow(row: Record<string, unknown>): ProjectCheckRunSummary {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    command: String(row.command),
    cwd: String(row.cwd),
    status: ["done", "failed", "timed_out"].includes(String(row.status)) ? String(row.status) as ProjectCheckRunSummary["status"] : "running",
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    durationMs: Number(row.duration_ms ?? 0),
    stdout: String(row.stdout ?? ""),
    stderr: String(row.stderr ?? ""),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
  };
}

function projectGitOperationFromRow(row: Record<string, unknown>): ProjectGitOperationSummary {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    operation: String(row.operation) as ProjectGitOperationSummary["operation"],
    args: jsonArray(row.args),
    status: String(row.status) as ProjectGitOperationSummary["status"],
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    stdout: String(row.stdout ?? ""),
    stderr: String(row.stderr ?? ""),
    createdAt: String(row.created_at),
  };
}

function defaultProviderCapabilities(kind: ProviderSummary["kind"]): ProviderCapabilities {
  return {
    responsesApi: kind === "openai-responses",
    chatCompletions: kind === "openai-compatible-chat" || kind === "local",
    tools: kind !== "local",
    jsonMode: kind !== "local",
    vision: false,
    streaming: true,
  };
}

function parseProviderCapabilities(value: unknown, kind: ProviderSummary["kind"]): ProviderCapabilities {
  const defaults = defaultProviderCapabilities(kind);
  if (typeof value !== "string" || !value.trim()) return defaults;
  try {
    const parsed = JSON.parse(value) as Partial<Record<keyof ProviderCapabilities, unknown>>;
    return {
      responsesApi: typeof parsed.responsesApi === "boolean" ? parsed.responsesApi : defaults.responsesApi,
      chatCompletions: typeof parsed.chatCompletions === "boolean" ? parsed.chatCompletions : defaults.chatCompletions,
      tools: typeof parsed.tools === "boolean" ? parsed.tools : defaults.tools,
      jsonMode: typeof parsed.jsonMode === "boolean" ? parsed.jsonMode : defaults.jsonMode,
      vision: typeof parsed.vision === "boolean" ? parsed.vision : defaults.vision,
      streaming: typeof parsed.streaming === "boolean" ? parsed.streaming : defaults.streaming,
    };
  } catch {
    return defaults;
  }
}

function mergeProviderCapabilities(kind: ProviderSummary["kind"], value?: Partial<ProviderCapabilities>): ProviderCapabilities {
  return { ...defaultProviderCapabilities(kind), ...(value ?? {}) };
}

function sanitizeProviderRpmLimit(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100_000) : null;
}

function providerFromRow(row: Record<string, unknown>): ProviderRecord {
  const kind = row.kind as ProviderRecord["kind"];
  return {
    id: String(row.id),
    name: String(row.name),
    kind,
    defaultModel: String(row.default_model),
    baseUrl: row.base_url ? String(row.base_url) : undefined,
    apiKey: row.api_key ? String(row.api_key) : undefined,
    capabilities: parseProviderCapabilities(row.capabilities, kind),
    rpmLimit: sanitizeProviderRpmLimit(row.rpm_limit),
    rpmLimitEnabled: Boolean(row.rpm_limit_enabled),
    useProxy: Boolean(row.use_proxy),
  };
}

function providerHealthCheckFromRow(row: Record<string, unknown>): ProviderHealthCheck {
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    kind: row.kind === "models" ? "models" : "test",
    ok: Boolean(row.ok),
    status: row.status === null || row.status === undefined ? null : Number(row.status),
    durationMs: Number(row.duration_ms),
    error: row.error ? String(row.error) : undefined,
    checkedAt: String(row.checked_at),
  };
}


  return {
    defaultProviderCapabilities,
    loadAppData,
    mergeProviderCapabilities,
    projectCheckRunFromRow,
    projectFromRow,
    projectGitOperationFromRow,
    providerFromRow,
    providerHealthCheckFromRow,
    saveAppData,
    sanitizeProviderRpmLimit,
    sessionFromRow,
    splitProjectCheckCommands,
  };
}

export type { AppData, ProviderRecord };
