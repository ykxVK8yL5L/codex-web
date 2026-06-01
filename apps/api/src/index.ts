import Database from "better-sqlite3";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fork, spawn as spawnProcess, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty } from "node-pty";
import { generateSecret, generateURI } from "otplib";
import nodemailer from "nodemailer";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ApprovalActionType,
  ApprovalDecisionResponse,
  ApprovalGrantSummary,
  ApprovalRisk,
  ApprovalStatus,
  ApprovalSummary,
  AgentCircleSummary,
  AgentGroupSummary,
  AgentListenMode,
  AgentPermissionSettings,
  AgentProjectAccessMode,
  AgentRoleSummary,
  AgentRoleSourceType,
  AgentRoleTemplateSummary,
  AgentRunSummary,
  AgentSummary,
  AgentWorkspaceMode,
  AppNotificationSummary,
  AppNotificationStreamEvent,
  AppNotificationsResponse,
  ArchiveIgnoreTemplate,
  AuthState,
  AutomationRunSummary,
  AutomationSummary,
  CodexApprovalPolicy,
  CodexRuntimeSettings,
  CodexSandboxMode,
  CodexTaskDetail,
  CodexTaskDiff,
  ContinueCodexTaskRequest,
  ConversationType,
  CreateCodexTaskRequest,
  CreateAutomationRequest,
  CreateAgentGroupRequest,
  CreateAgentCircleRequest,
  CreateAgentRequest,
  CreateAgentSessionRequest,
  CreateAgentRoleFromTemplateRequest,
  CreateAgentRoleRequest,
  CreateRoomArtifactRequest,
  CreateRoomDecisionRequest,
  CreateRoomHandoffRequest,
  CreateRoomScheduleRequest,
  CreateRoomTaskRequest,
  CreateFileRequest,
  CreateProjectRequest,
  CreateFileMountRequest,
  CreateProviderRequest,
  UpdateProjectRequest,
  CreateRoomRequest,
  CreateRoomMessageRequest,
  CreateSessionRequest,
  CreateSessionCompactionRequest,
  UpdateSessionRequest,
  CreateTerminalSessionRequest,
  ExecutionContextSummary,
  EnvironmentOverview,
  EnvironmentPackageDetailResponse,
  EnvironmentPackageManagerOption,
  EnvironmentPackageRecord,
  EnvironmentBulkActionRequest,
  EnvironmentProjectUsage,
  EnvironmentReconcileItem,
  EnvironmentRestoreRun,
  EnvironmentRestorePreviewItem,
  EnvironmentToolRecord,
  EnvironmentToolRegistryItem,
  EnvironmentToolProbe,
  EnvironmentToolVersionItem,
  ExtensionDetail,
  ExtensionSummary,
  FileArchivePreviewResponse,
  FileContentResponse,
  FileArchiveRequest,
  FileEntry,
  FileListResponse,
  LoginRequest,
  LoginResponse,
  MaintenanceCleanupResponse,
  MessageCardSummary,
  NotificationAccountSummary,
  NotificationChannelAdapter,
  NotificationChannelAuthType,
  NotificationChannelDefinition,
  NotificationChannelKind,
  NotificationDeliveryStatus,
  NotificationDeliverySummary,
  NotificationEphemeralRuleSummary,
  NotificationEventType,
  NotificationPermissionPolicy,
  NotificationRecipientSummary,
  NotificationRuleSummary,
  NotificationRuleTarget,
  NotificationSeverity,
  TestNotificationAccountRequest,
  PageResponse,
  PermissionProfileId,
  CreatePreviewRequest,
  ProjectCheckRunSummary,
  ProjectGitOperationRequest,
  ProjectGitOperationSummary,
  ProjectGitOperationType,
  ProjectStatsSummary,
  ProjectSummary,
  PreviewAccess,
  PreviewAccessSettings,
  PreviewSummary,
  ProviderCapabilities,
  ProviderDetectionResponse,
  ProviderHealthCheck,
  ProviderModelsResponse,
  ProviderSummary,
  ProviderTestResponse,
  QueuedMessage,
  QueueMessageRequest,
  RateLimitSettings,
  RecoverCodexTaskRequest,
  RenameFileRequest,
  InstallEnvironmentPackageRequest,
  RegisterEnvironmentToolRequest,
  ReorderQueuedMessagesRequest,
  RevertWorkspaceFileRequest,
  RoomEventSummary,
  RoomArtifactSummary,
  RoomDecisionSummary,
  RoomHandoffSummary,
  RoomOrchestrationSettings,
  RoomRunDiffResponse,
  RoomRunMergeResponse,
  RoomScheduleSummary,
  RoomStatus,
  RoomTaskSummary,
  RoomSummary,
  SaveFileRequest,
  SessionMessage,
  SessionCompactionListResponse,
  SessionCompactionResponse,
  SessionCompactionSettings,
  SessionCompactionSummary,
  SessionMessagesPage,
  SessionSummary,
  SetupCompleteRequest,
  SetupStartResponse,
  StorageItemSummary,
  StorageScanResponse,
  SystemBackupManifest,
  SystemBackupPreviewResponse,
  SystemBackupProjectReference,
  SystemBackupSettings,
  SystemRestoreResponse,
  InstallEnvironmentToolRequest,
  UpdateAccessTokenRequest,
  UpdateCodexRuntimeSettingsRequest,
  UpsertNotificationAccountRequest,
  UpsertNotificationChannelRequest,
  UpsertNotificationRecipientRequest,
  UpsertNotificationRuleRequest,
  UpdateSessionCompactionSettingsRequest,
  UpdateSystemBackupSettingsRequest,
  UpdateRoomDecisionRequest,
  UpdateRoomHandoffRequest,
  TerminalCommandRequest,
  TerminalCommandResponse,
  TaskActivityResponse,
  TaskActivitySummary,
  TaskContextFileResponse,
  TaskContextResponse,
  TaskHealthResponse,
  TaskHealthRepairResponse,
  TerminalDefaultsResponse,
  TaskLogResponse,
  TaskRunSummary,
  TerminalSessionSummary,
  UploadAttachmentInput,
  UpdateQueuedMessageRequest,
  UpdateAgentGroupRequest,
  UpdateAgentCircleRequest,
  UpdateAgentRequest,
  UpdateAgentRoleRequest,
  UpdateFileMountRequest,
  UpdateProviderRequest,
  UpdateRoomRequest,
  UpdateRoomTaskRequest,
  UpdateSessionCompactionRequest,
  UpdateTerminalSessionRequest,
  UpdateAutomationRequest,
  UninstallEnvironmentPackageRequest,
  WorkspaceChangeFile,
  WorkspaceChanges,
  WorkspaceGitFileRequest,
  FileMount,
  CreateGoalFocusRequest,
  CreateGoalItemRequest,
  CreateGoalRequest,
  GoalDetailResponse,
  GoalEventSummary,
  GoalFocusStatus,
  GoalFocusSummary,
  GoalItemStatus,
  GoalItemSummary,
  GoalMode,
  GoalOwnerType,
  GoalProposalKind,
  GoalProposalStatus,
  GoalProposalSummary,
  GoalStatus,
  GoalSummary,
  ResetOtpResponse,
  ConfirmOtpResetRequest,
  UpdateGoalFocusRequest,
  UpdateGoalItemRequest,
  UpdateGoalRequest,
} from "@codex-web/protocol";
import { createAuthHelpers, type AuthConfig } from "./auth.js";
import { archiveExcluder, createZipArchive, createZipArchiveWithEntries, listArchiveIgnoreTemplates, parseStoredZipArchive, previewZipArchive } from "./archive.js";
import {
  createRateLimitMiddleware,
  createRateLimitStore,
  decrementProviderProxyConcurrency,
  getProviderProxyConcurrency,
  incrementProviderProxyConcurrency,
} from "./rate-limit.js";
import { createRuntimeSettingsStore } from "./runtime-settings.js";
import { decodeOffsetCursor, decodePageCursor, offsetPageFromRows, pageFromRows, parsePageLimit } from "./pagination.js";
import {
  createEnvironmentPackageRegistry,
  packageInstallCommandArgs,
  packageUninstallCommandArgs,
  packageUninstallCommandText,
} from "./environment-packages.js";

type ProviderRecord = ProviderSummary & { apiKey?: string };
type ApprovalRecord = ApprovalSummary & { payload: unknown };
type AppData = {
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  providers: ProviderRecord[];
  automations: AutomationSummary[];
};
type PreviewRecord = Omit<PreviewSummary, "url"> & { token: string };
type FileMountRecord = FileMount;
type TerminalAdapter = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitCode: number | null) => void): void;
};
type TerminalRuntime = TerminalSessionSummary & {
  absoluteCwd: string;
  adapter: TerminalAdapter;
  buffer: string;
  clients: Set<WebSocket>;
  ephemeral: boolean;
};
type CreateTerminalSessionInput = CreateTerminalSessionRequest & { ephemeral?: boolean };
type TaskEvent =
  | { type: "started"; session: SessionSummary }
  | { type: "output"; bytes: number; at: string }
  | { type: "activity"; id?: string; kind: "command" | "file" | "tool"; label: string; detail?: string; status?: string; at: string }
  | { type: "workspace"; session: SessionSummary; reason: "activity" | "done" | "revert"; at: string }
  | { type: "message"; message: SessionMessage; session: SessionSummary }
  | { type: "queue"; queue: QueuedMessage[]; session: SessionSummary }
  | { type: "done"; session: SessionSummary; exitCode: number | null }
  | { type: "error"; session: SessionSummary; error: string };
type RoomStreamEvent =
  | { type: "snapshot"; room: RoomSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; events: RoomEventSummary[]; messages: SessionMessage[] }
  | { type: "activity"; roomId: string; event?: RoomEventSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; events: RoomEventSummary[]; messages: SessionMessage[] }
  | { type: "ping" };

const app = new Hono();
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../data");
const codexRunnerPath = join(dirname(fileURLToPath(import.meta.url)), "codex-runner.mjs");
const sqlitePath = join(dataDir, "codex-web.sqlite");
const taskLogDir = join(dataDir, "task-logs");
const archiveIgnoreTemplateDir = resolve(process.env.CODEX_WEB_IGNORE_TEMPLATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../templates/gitignore"));
const agentRoleTemplateDir = resolve(process.env.CODEX_WEB_ROLE_TEMPLATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../role-templates"));
const sessionWorkspaceRoot = resolve(process.env.CODEX_WEB_SESSION_ROOT ?? join(dataDir, "sessions"));
const projectWorkspaceRoot = resolve(process.env.CODEX_WEB_PROJECT_ROOT ?? join(dataDir, "projects"));
const internalProjectWorkspaceRoot = resolve(join(dataDir, "projects"));
const projectWorkspaceMetadataFile = ".codex-web-project.json";
const codexHome = resolve(process.env.CODEX_HOME ?? join(process.env.HOME ?? ".", ".codex"));
const workspaceRoot = resolve(process.env.CODEX_WEB_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const terminalRoot = resolve(process.env.CODEX_WEB_TERMINAL_ROOT ?? "/");
const terminalDefaultCwd = process.env.CODEX_WEB_TERMINAL_CWD ?? "~";
const codexSandboxMode = process.env.CODEX_WEB_CODEX_SANDBOX ?? "workspace-write";
const codexApprovalPolicy = process.env.CODEX_WEB_CODEX_APPROVAL ?? "never";
const codexBypassSandbox = ["1", "true", "yes", "on"].includes(String(process.env.CODEX_WEB_CODEX_BYPASS_SANDBOX ?? "").toLowerCase());
const providerTimeoutMs = Number(process.env.CODEX_WEB_PROVIDER_TIMEOUT_MS ?? 15_000);
const providerModelsCacheTtlMs = Number(process.env.CODEX_WEB_PROVIDER_MODELS_CACHE_TTL_MS ?? 12 * 60 * 60 * 1000);
const host = process.env.HOST ?? "0.0.0.0";
const apiPort = Number(process.env.PORT ?? 8787);
const localApiBaseUrl = process.env.CODEX_WEB_LOCAL_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;

const db = openDatabase();
seedMultiAgentDefaults();
const rateLimitStore = createRateLimitStore(db);
const runtimeSettingsStore = createRuntimeSettingsStore(db, { codexSandboxMode, codexApprovalPolicy, codexBypassSandbox });
let authConfig = loadAuthConfig();
const {
  anonymousState,
  authenticatedAuthState,
  getBearerToken,
  hashToken,
  parseCookieHeader,
  providerProxyToken,
  requireAuth,
  signPreviewAccessToken,
  signSessionToken,
  verifyOtp,
  verifyPreviewAccessToken,
  verifyProviderProxyToken,
  verifySessionToken,
} = createAuthHelpers(() => authConfig, sessionTtlMs);
let pendingOtpSecret = generateSecret();
let pendingResetOtpSecret: string | null = null;
let codexRuntimeSettings = runtimeSettingsStore.codexRuntime.load();
let previewAccessSettings = runtimeSettingsStore.previewAccess.load();
let sessionCompactionSettings = runtimeSettingsStore.sessionCompaction.load();
let rateLimitSettings = rateLimitStore.load();
let systemBackupSettings = loadSystemBackupSettings();
let environmentOverview = buildEnvironmentOverview();
const appData = loadAppData();
migrateRoomAgentSessionDataRoots();
migrateRoomWorkspaceRoots();
const fileMounts = new Map<string, FileMountRecord>();
loadFileMounts();
const previews = new Map<string, PreviewRecord>();
const previewLogs = new Map<string, string>();
loadPreviews();
loadPreviewLogs();
const previewProcesses = new Map<string, ChildProcess>();
const previewProcessGroups = new Map<string, number>();
type PreviewLogEvent =
  | { type: "snapshot"; preview: PreviewSummary; logs: string }
  | { type: "log"; previewId: string; chunk: string; at: string }
  | { type: "status"; preview: PreviewSummary };
const previewLogSubscribers = new Map<string, Set<(event: PreviewLogEvent) => void>>();
type PreviewAccessRequest = {
  id: string;
  previewId: string;
  secret: string;
  status: "pending" | "approved" | "denied";
  approvedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
};
const previewAccessRequests = new Map<string, PreviewAccessRequest>();
loadPreviewAccessRequests();

const terminalSessions = new Map<string, TerminalRuntime>();
const deletedTerminalSessionIds = new Set<string>();
const codexTaskOutputs = new Map<string, { output: string; exitCode: number | null }>();
const codexTaskProcesses = new Map<string, ChildProcess>();
const codexTaskStopRequested = new Set<string>();
const codexTaskStdoutBuffers = new Map<string, string>();
const codexTaskLogOffsets = new Map<string, number>();
const codexTaskTailers = new Map<string, NodeJS.Timeout>();
const finalizedRecoveredTasks = new Set<string>();
const codexTaskSubscribers = new Map<string, Set<(event: TaskEvent) => void>>();
const roomEventSubscribers = new Map<string, Set<(event: RoomStreamEvent) => void>>();
const appNotificationSubscribers = new Set<(event: AppNotificationStreamEvent) => void>();
const telegramPollingOffsets = new Map<string, number>();
const telegramPollingBusy = new Set<string>();
const telegramPendingSends = new Map<string, { message: string; sessionIds: string[]; createdAt: number }>();
const telegramPendingSelections = new Map<string, { ids: string[]; createdAt: number }>();
const telegramPendingFileRoots = new Map<string, { roots: Array<{ label: string; root: string }>; createdAt: number }>();
const telegramPendingFiles = new Map<string, { root: string; relPath: string; dirNames: string[]; createdAt: number }>();
const telegramPendingTerminal = new Map<string, { command: string; roots: Array<{ label: string; root: string }>; createdAt: number }>();
const telegramPendingInputs = new Map<string, { kind: "send" | "terminal"; createdAt: number }>();
pauseStaleRunningSessions();
recoverInterruptedRoomAgentRunsFromLogs();
closePersistedRunningTerminals();

function openDatabase() {
  mkdirSync(dataDir, { recursive: true });
  const database = new Database(sqlitePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    create table if not exists auth_config (
      id text primary key,
      access_token_hash text not null,
      otp_secret text not null,
      updated_at text not null
    );
    create table if not exists app_settings (
      key text primary key,
      value text not null,
      updated_at text not null
    );
    create table if not exists providers (
      id text primary key,
      name text not null,
      kind text not null,
      default_model text not null,
      base_url text,
      api_key text,
      capabilities text,
      rpm_limit integer,
      rpm_limit_enabled integer not null default 0,
      use_proxy integer not null default 0
    );
    create table if not exists projects (
      id text primary key,
      name text not null,
      workspace_path text not null,
      runner text not null,
      check_command text,
      changed_files integer not null default 0
    );
    create table if not exists sessions (
      id text primary key,
      kind text not null,
      conversation_type text not null default 'codex',
      room_id text,
      title text not null,
      project_id text,
      workspace_path text,
      provider_id text,
      model text,
      codex_session_id text,
      notifications_enabled integer not null default 1,
      status text not null,
      created_at text,
      updated_at text not null
    );
    create index if not exists sessions_project_updated_idx on sessions(project_id, updated_at desc, id desc);
    create index if not exists sessions_status_updated_idx on sessions(status, updated_at desc, id desc);
    create table if not exists messages (
      id text primary key,
      session_id text not null,
      role text not null,
      content text not null,
      created_at text not null
    );
    create table if not exists file_mounts (
      id text primary key,
      name text not null,
      root_path text not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists messages_session_created_idx on messages(session_id, created_at desc, id desc);
    create table if not exists message_queue (
      id text primary key,
      session_id text not null,
      prompt text not null,
      provider_id text,
      model text,
      order_index integer not null default 0,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists message_queue_session_created_idx on message_queue(session_id, created_at asc);
    create table if not exists terminal_sessions (
      id text primary key,
      name text not null,
      cwd text not null,
      mode text not null,
      status text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists previews (
      id text primary key,
      scope_type text not null,
      scope_id text not null,
      label text not null,
      target_host text not null,
      port integer not null,
      token text not null,
      command text,
      cwd text,
      status text not null default 'registered',
      access text not null default 'public',
      created_at text not null,
      updated_at text not null
    );
    create index if not exists previews_scope_updated_idx on previews(scope_type, scope_id, updated_at desc, id desc);
    create table if not exists preview_logs (
      preview_id text primary key,
      label text,
      logs text not null,
      updated_at text not null
    );
    create table if not exists preview_access_requests (
      id text primary key,
      preview_id text not null,
      secret text not null,
      status text not null,
      approved_until text,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists preview_access_requests_preview_status_idx on preview_access_requests(preview_id, status, created_at desc);
    create table if not exists automations (
      id text primary key,
      name text not null,
      project_id text,
      provider_id text,
      model text,
      prompt text not null,
      schedule text not null,
      status text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists automation_runs (
      id text primary key,
      automation_id text not null,
      session_id text not null,
      status text not null,
      exit_code integer,
      started_at text not null,
      finished_at text
    );
    create index if not exists automation_runs_automation_started_idx on automation_runs(automation_id, started_at desc, id desc);
    create table if not exists provider_health_checks (
      id text primary key,
      provider_id text not null,
      kind text not null,
      ok integer not null,
      status integer,
      duration_ms integer not null,
      error text,
      checked_at text not null
    );
    create index if not exists provider_health_provider_checked_idx on provider_health_checks(provider_id, checked_at desc, id desc);
    create table if not exists notification_accounts (
      id text primary key,
      name text not null,
      channel_id text,
      channel_kind text not null,
      enabled integer not null,
      config text not null,
      permissions text not null default '{}',
      last_test_status text,
      last_error text,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists notification_accounts_kind_enabled_idx on notification_accounts(channel_kind, enabled, updated_at desc);
    create table if not exists notification_channels (
      id text primary key,
      name text not null,
      kind text not null,
      adapter text not null default 'webhook',
      auth_type text not null default 'none',
      description text not null,
      method text not null,
      url_template text not null,
      headers_template text not null,
      body_template text not null,
      account_fields text not null,
      builtin integer not null default 0,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists notification_channels_updated_idx on notification_channels(updated_at desc, id desc);
    create table if not exists notification_recipients (
      id text primary key,
      name text not null,
      kind text not null,
      enabled integer not null,
      sender_account_id text,
      channel_id text,
      config text not null,
      permissions text not null default '{}',
      created_at text not null,
      updated_at text not null
    );
    create index if not exists notification_recipients_kind_enabled_idx on notification_recipients(kind, enabled, updated_at desc);
    create table if not exists notification_rules (
      id text primary key,
      name text not null,
      enabled integer not null,
      event_types text not null,
      min_severity text not null,
      targets text not null,
      dedupe_minutes integer not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists notification_rules_enabled_updated_idx on notification_rules(enabled, updated_at desc);
    create table if not exists notification_deliveries (
      id text primary key,
      rule_id text,
      account_id text,
      event_type text not null,
      severity text not null,
      title text not null,
      message text not null,
      status text not null,
      attempts integer not null,
      response_status integer,
      last_error text,
      metadata text,
      created_at text not null,
      sent_at text
    );
    create index if not exists notification_deliveries_created_idx on notification_deliveries(created_at desc, id desc);
    create index if not exists notification_deliveries_dedupe_idx on notification_deliveries(rule_id, account_id, event_type, created_at desc);
    create table if not exists notification_ephemeral_rules (
      id text primary key,
      scope_type text not null,
      scope_id text not null,
      event_types text not null,
      targets text not null,
      enabled integer not null,
      expire_mode text not null,
      created_at text not null,
      expires_at text,
      triggered_at text
    );
    create index if not exists notification_ephemeral_scope_idx on notification_ephemeral_rules(scope_type, scope_id, enabled, created_at desc);
    create table if not exists telegram_chat_routes (
      account_id text not null,
      chat_id text not null,
      session_id text not null,
      updated_at text not null,
      primary key (account_id, chat_id)
    );
    create table if not exists app_notifications (
      id text primary key,
      event_type text not null,
      severity text not null,
      title text not null,
      message text not null,
      source_type text,
      source_id text,
      metadata text,
      read_at text,
      created_at text not null
    );
    create index if not exists app_notifications_created_idx on app_notifications(created_at desc, id desc);
    create index if not exists app_notifications_read_idx on app_notifications(read_at, created_at desc);
    create table if not exists provider_model_cache (
      provider_id text primary key,
      cache_key text not null,
      models text not null,
      cached_at text not null
    );
    create table if not exists task_runs (
      id text primary key,
      session_id text not null,
      status text not null,
      pid integer,
      started_at text not null,
      ended_at text,
      exit_code integer,
      stop_requested integer not null default 0,
      interrupted_reason text,
      prompt_chars integer,
      prompt_hash text,
      context_path text
    );
    create index if not exists task_runs_session_started_idx on task_runs(session_id, started_at desc, id desc);
    create index if not exists task_runs_status_started_idx on task_runs(status, started_at desc, id desc);
    create table if not exists session_compactions (
      id text primary key,
      session_id text not null,
      provider_id text,
      model text,
      source_message_start_id text,
      source_message_end_id text,
      source_message_count integer not null,
      source_chars integer not null,
      prompt_hash text not null,
      file_path text not null,
      supersedes_id text,
      created_at text not null
    );
    create index if not exists session_compactions_session_created_idx on session_compactions(session_id, created_at desc, id desc);
    create table if not exists task_activities (
      id text primary key,
      session_id text not null,
      activity_id text,
      kind text not null,
      label text not null,
      detail text,
      status text,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists task_activities_session_updated_idx on task_activities(session_id, updated_at desc);
    create unique index if not exists task_activities_session_activity_idx on task_activities(session_id, kind, activity_id) where activity_id is not null;
    create table if not exists project_check_runs (
      id text primary key,
      project_id text not null,
      command text not null,
      cwd text not null,
      status text not null,
      exit_code integer,
      duration_ms integer not null,
      stdout text not null,
      stderr text not null,
      started_at text not null,
      finished_at text
    );
    create index if not exists project_check_runs_project_started_idx on project_check_runs(project_id, started_at desc, id desc);
    create table if not exists project_git_operations (
      id text primary key,
      project_id text not null,
      operation text not null,
      args text not null,
      status text not null,
      exit_code integer,
      stdout text not null,
      stderr text not null,
      created_at text not null
    );
    create index if not exists project_git_operations_project_created_idx on project_git_operations(project_id, created_at desc, id desc);
    create table if not exists approvals (
      id text primary key,
      action_type text not null,
      risk text not null,
      status text not null,
      title text not null,
      description text not null,
      details text not null,
      payload text not null,
      created_at text not null,
      resolved_at text,
      archived_at text
    );
    create index if not exists approvals_status_created_idx on approvals(status, created_at desc, id desc);
    create table if not exists approval_grants (
      id text primary key,
      action_type text not null,
      grant_key text not null,
      title text not null,
      details text not null,
      expires_at text,
      created_at text not null,
      unique(action_type, grant_key)
    );
    create table if not exists agent_roles (
      id text primary key,
      name text not null,
      description text not null,
      source_type text not null default 'custom-markdown',
      source_path text,
      source_url text,
      markdown_content text not null default '',
      system_prompt text not null,
      capabilities text not null,
      default_listen_mode text not null,
      default_listen_events text not null,
      default_workspace_mode text not null,
      default_sandbox_mode text,
      default_approval_policy text,
      output_contract text,
      safety_notes text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists agents (
      id text primary key,
      name text not null,
      role_id text not null,
      description text,
      extra_prompt text,
      provider_id text,
      model text,
      listen_mode text not null,
      listen_events text not null,
      workspace_mode text not null,
      default_project_id text,
      favorite_project_ids text not null default '[]',
      project_access_mode text not null default 'all',
      allowed_project_ids text not null default '[]',
      permission_profile_id text,
      permissions text not null default '{}',
      max_concurrent_runs integer not null,
      enabled integer not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists agents_role_updated_idx on agents(role_id, updated_at desc);
    create table if not exists agent_sessions (
      session_id text primary key,
      agent_id text not null,
      created_at text not null
    );
    create table if not exists agent_groups (
      id text primary key,
      name text not null,
      description text,
      collaboration_rules text not null,
      event_routing_rules text not null,
      max_concurrent_agents integer not null,
      approval_policy text not null,
      merge_strategy text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists agent_group_members (
      group_id text not null,
      agent_id text not null,
      listen_mode text not null default 'passive',
      primary key (group_id, agent_id)
    );
    create table if not exists agent_circles (
      id text primary key,
      name text not null,
      description text,
      group_template_id text,
      collaboration_rules text not null default '',
      event_routing_rules text not null default '',
      max_concurrent_agents integer not null default 3,
      approval_policy text not null default 'bounded',
      merge_strategy text not null default 'approval-required',
      builtin integer not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists agent_circle_roles (
      circle_id text not null,
      role_id text not null,
      position integer not null default 0,
      primary key (circle_id, role_id)
    );
    create table if not exists rooms (
      id text primary key,
      session_id text,
      name text not null,
      group_id text,
      circle_id text,
      project_id text,
      status text not null,
      shared_context text,
      orchestration_settings text not null default '{}',
      created_at text not null,
      updated_at text not null
    );
    create index if not exists rooms_status_updated_idx on rooms(status, updated_at desc, id desc);
    create table if not exists room_agents (
      room_id text not null,
      agent_id text not null,
      listen_mode text not null default 'passive',
      primary key (room_id, agent_id)
    );
    create table if not exists room_agent_threads (
      room_id text not null,
      agent_id text not null,
      codex_session_id text not null,
      workspace_path text,
      created_at text not null,
      updated_at text not null,
      primary key (room_id, agent_id)
    );
    create table if not exists room_events (
      id text primary key,
      room_id text not null,
      type text not null,
      source_agent_id text,
      target_agent_id text,
      payload text not null,
      created_at text not null
    );
    create index if not exists room_events_room_created_idx on room_events(room_id, created_at desc, id desc);
    create table if not exists room_tasks (
      id text primary key,
      room_id text not null,
      goal_item_id text,
      title text not null,
      prompt text not null default '',
      status text not null,
      assigned_agent_id text,
      priority integer not null default 0,
      depends_on_task_id text,
      scheduled_at text,
      started_at text,
      finished_at text,
      payload text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists goals (
      id text primary key,
      owner_type text not null,
      owner_id text not null,
      text text not null,
      mode text not null,
      status text not null,
      manager_agent_id text,
      coordinator_agent_id text,
      progress_summary text,
      created_at text not null,
      updated_at text not null,
      completed_at text,
      cancelled_at text
    );
    create index if not exists goals_owner_updated_idx on goals(owner_type, owner_id, updated_at desc, id desc);
    create table if not exists goal_events (
      id text primary key,
      goal_id text not null,
      type text not null,
      actor_type text,
      actor_id text,
      payload text not null,
      created_at text not null
    );
    create index if not exists goal_events_goal_created_idx on goal_events(goal_id, created_at desc, id desc);
    create table if not exists goal_proposals (
      id text primary key,
      goal_id text not null,
      kind text not null,
      status text not null,
      title text not null,
      payload text not null,
      proposed_by_agent_id text,
      created_at text not null,
      resolved_at text
    );
    create index if not exists goal_proposals_goal_status_created_idx on goal_proposals(goal_id, status, created_at desc, id desc);
    create table if not exists goal_focuses (
      id text primary key,
      goal_id text not null,
      text text not null,
      status text not null,
      owner_agent_id text,
      created_at text not null,
      updated_at text not null,
      completed_at text,
      cancelled_at text
    );
    create index if not exists goal_focuses_goal_updated_idx on goal_focuses(goal_id, updated_at desc, id desc);
    create table if not exists goal_items (
      id text primary key,
      goal_id text not null,
      room_task_id text,
      title text not null,
      description text,
      status text not null,
      assigned_agent_id text,
      priority integer not null default 0,
      depends_on_item_id text,
      created_at text not null,
      updated_at text not null,
      completed_at text,
      cancelled_at text
    );
    create index if not exists goal_items_goal_updated_idx on goal_items(goal_id, updated_at desc, id desc);
    create table if not exists room_schedules (
      id text primary key,
      room_id text not null,
      agent_id text not null,
      task_prompt text not null,
      schedule_type text not null,
      run_at text,
      status text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists room_artifacts (
      id text primary key,
      room_id text not null,
      agent_id text,
      kind text not null,
      title text not null,
      payload text not null,
      created_at text not null
    );
    create table if not exists room_handoffs (
      id text primary key,
      room_id text not null,
      from_agent_id text,
      to_agent_id text,
      summary text not null,
      status text not null default 'open',
      payload text not null,
      created_at text not null,
      resolved_at text
    );
    create table if not exists room_decisions (
      id text primary key,
      room_id text not null,
      title text not null,
      status text not null,
      payload text not null,
      created_at text not null,
      resolved_at text
    );
    create table if not exists agent_runs (
      id text primary key,
      room_id text not null,
      agent_id text not null,
      task_id text,
      goal_id text,
      session_id text,
      status text not null,
      provider_id text,
      model text,
      workspace_path text,
      started_at text not null,
      finished_at text,
      exit_code integer
    );
    create index if not exists agent_runs_room_started_idx on agent_runs(room_id, started_at desc, id desc);
    create table if not exists room_run_merges (
      run_id text primary key,
      room_id text not null,
      project_id text,
      workspace_path text not null,
      status text not null,
      summary text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists execution_contexts (
      id text primary key,
      source_type text not null,
      session_id text,
      agent_id text,
      room_id text,
      project_id text,
      workspace_path text not null,
      provider_id text,
      model text,
      permission_profile_id text,
      resolved_permissions text not null,
      sandbox_mode text not null,
      approval_policy text not null,
      created_by text not null,
      created_at text not null
    );
    create index if not exists execution_contexts_session_created_idx on execution_contexts(session_id, created_at desc, id desc);
    create index if not exists execution_contexts_agent_created_idx on execution_contexts(agent_id, created_at desc, id desc);
  `);
  const providerColumns = database.prepare("pragma table_info(providers)").all() as Array<{ name: string }>;
  if (!providerColumns.some((column) => column.name === "capabilities")) database.prepare("alter table providers add column capabilities text").run();
  if (!providerColumns.some((column) => column.name === "rpm_limit")) database.prepare("alter table providers add column rpm_limit integer").run();
  if (!providerColumns.some((column) => column.name === "rpm_limit_enabled")) database.prepare("alter table providers add column rpm_limit_enabled integer not null default 0").run();
  if (!providerColumns.some((column) => column.name === "use_proxy")) database.prepare("alter table providers add column use_proxy integer not null default 0").run();
  const notificationAccountColumns = database.prepare("pragma table_info(notification_accounts)").all() as Array<{ name: string }>;
  if (!notificationAccountColumns.some((column) => column.name === "channel_id")) database.prepare("alter table notification_accounts add column channel_id text").run();
  if (!notificationAccountColumns.some((column) => column.name === "permissions")) database.prepare("alter table notification_accounts add column permissions text not null default '{}'").run();
  const notificationRecipientColumns = database.prepare("pragma table_info(notification_recipients)").all() as Array<{ name: string }>;
  if (!notificationRecipientColumns.some((column) => column.name === "permissions")) database.prepare("alter table notification_recipients add column permissions text not null default '{}'").run();
  const notificationChannelColumns = database.prepare("pragma table_info(notification_channels)").all() as Array<{ name: string }>;
  if (!notificationChannelColumns.some((column) => column.name === "adapter")) database.prepare("alter table notification_channels add column adapter text not null default 'webhook'").run();
  if (!notificationChannelColumns.some((column) => column.name === "auth_type")) database.prepare("alter table notification_channels add column auth_type text not null default 'none'").run();
  const taskRunColumns = database.prepare("pragma table_info(task_runs)").all() as Array<{ name: string }>;
  if (!taskRunColumns.some((column) => column.name === "prompt_chars")) database.prepare("alter table task_runs add column prompt_chars integer").run();
  if (!taskRunColumns.some((column) => column.name === "prompt_hash")) database.prepare("alter table task_runs add column prompt_hash text").run();
  if (!taskRunColumns.some((column) => column.name === "context_path")) database.prepare("alter table task_runs add column context_path text").run();
  const approvalColumns = database.prepare("pragma table_info(approvals)").all() as Array<{ name: string }>;
  if (!approvalColumns.some((column) => column.name === "archived_at")) database.prepare("alter table approvals add column archived_at text").run();
  const approvalGrantColumns = database.prepare("pragma table_info(approval_grants)").all() as Array<{ name: string }>;
  if (!approvalGrantColumns.some((column) => column.name === "expires_at")) database.prepare("alter table approval_grants add column expires_at text").run();
  const sessionColumns = database.prepare("pragma table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === "workspace_path")) {
    database.prepare("alter table sessions add column workspace_path text").run();
  }
  if (!sessionColumns.some((column) => column.name === "conversation_type")) {
    database.prepare("alter table sessions add column conversation_type text not null default 'codex'").run();
  }
  if (!sessionColumns.some((column) => column.name === "room_id")) {
    database.prepare("alter table sessions add column room_id text").run();
  }
  if (!sessionColumns.some((column) => column.name === "notifications_enabled")) {
    database.prepare("alter table sessions add column notifications_enabled integer not null default 1").run();
  }
  const roomColumns = database.prepare("pragma table_info(rooms)").all() as Array<{ name: string }>;
  if (!roomColumns.some((column) => column.name === "session_id")) {
    database.prepare("alter table rooms add column session_id text").run();
  }
  if (!roomColumns.some((column) => column.name === "orchestration_settings")) {
    database.prepare("alter table rooms add column orchestration_settings text not null default '{}'").run();
  }
  const roomAgentThreadColumns = database.prepare("pragma table_info(room_agent_threads)").all() as Array<{ name: string }>;
  if (!roomAgentThreadColumns.some((column) => column.name === "workspace_path")) {
    database.prepare("alter table room_agent_threads add column workspace_path text").run();
  }
  const agentCircleColumns = database.prepare("pragma table_info(agent_circles)").all() as Array<{ name: string }>;
  if (!agentCircleColumns.some((column) => column.name === "collaboration_rules")) database.prepare("alter table agent_circles add column collaboration_rules text not null default ''").run();
  if (!agentCircleColumns.some((column) => column.name === "event_routing_rules")) database.prepare("alter table agent_circles add column event_routing_rules text not null default ''").run();
  if (!agentCircleColumns.some((column) => column.name === "max_concurrent_agents")) database.prepare("alter table agent_circles add column max_concurrent_agents integer not null default 3").run();
  if (!agentCircleColumns.some((column) => column.name === "approval_policy")) database.prepare("alter table agent_circles add column approval_policy text not null default 'bounded'").run();
  if (!agentCircleColumns.some((column) => column.name === "merge_strategy")) database.prepare("alter table agent_circles add column merge_strategy text not null default 'approval-required'").run();
  const agentRoleColumns = database.prepare("pragma table_info(agent_roles)").all() as Array<{ name: string }>;
  if (!agentRoleColumns.some((column) => column.name === "source_type")) database.prepare("alter table agent_roles add column source_type text not null default 'custom-markdown'").run();
  if (!agentRoleColumns.some((column) => column.name === "source_path")) database.prepare("alter table agent_roles add column source_path text").run();
  if (!agentRoleColumns.some((column) => column.name === "source_url")) database.prepare("alter table agent_roles add column source_url text").run();
  if (!agentRoleColumns.some((column) => column.name === "markdown_content")) database.prepare("alter table agent_roles add column markdown_content text not null default ''").run();
  const agentColumns = database.prepare("pragma table_info(agents)").all() as Array<{ name: string }>;
  if (!agentColumns.some((column) => column.name === "permissions")) database.prepare("alter table agents add column permissions text not null default '{}'").run();
  if (!agentColumns.some((column) => column.name === "default_project_id")) database.prepare("alter table agents add column default_project_id text").run();
  if (!agentColumns.some((column) => column.name === "favorite_project_ids")) database.prepare("alter table agents add column favorite_project_ids text not null default '[]'").run();
  if (!agentColumns.some((column) => column.name === "project_access_mode")) database.prepare("alter table agents add column project_access_mode text not null default 'all'").run();
  if (!agentColumns.some((column) => column.name === "allowed_project_ids")) database.prepare("alter table agents add column allowed_project_ids text not null default '[]'").run();
  if (!agentColumns.some((column) => column.name === "permission_profile_id")) database.prepare("alter table agents add column permission_profile_id text").run();
  const agentRunColumns = database.prepare("pragma table_info(agent_runs)").all() as Array<{ name: string }>;
  if (!agentRunColumns.some((column) => column.name === "task_id")) database.prepare("alter table agent_runs add column task_id text").run();
  if (!agentRunColumns.some((column) => column.name === "goal_id")) database.prepare("alter table agent_runs add column goal_id text").run();
  const agentGroupMemberColumns = database.prepare("pragma table_info(agent_group_members)").all() as Array<{ name: string }>;
  if (!agentGroupMemberColumns.some((column) => column.name === "listen_mode")) database.prepare("alter table agent_group_members add column listen_mode text not null default 'passive'").run();
  const roomAgentColumns = database.prepare("pragma table_info(room_agents)").all() as Array<{ name: string }>;
  if (!roomAgentColumns.some((column) => column.name === "listen_mode")) database.prepare("alter table room_agents add column listen_mode text not null default 'passive'").run();
  const roomTaskColumns = database.prepare("pragma table_info(room_tasks)").all() as Array<{ name: string }>;
  if (!roomTaskColumns.some((column) => column.name === "goal_item_id")) database.prepare("alter table room_tasks add column goal_item_id text").run();
  if (!roomTaskColumns.some((column) => column.name === "prompt")) database.prepare("alter table room_tasks add column prompt text not null default ''").run();
  if (!roomTaskColumns.some((column) => column.name === "priority")) database.prepare("alter table room_tasks add column priority integer not null default 0").run();
  if (!roomTaskColumns.some((column) => column.name === "depends_on_task_id")) database.prepare("alter table room_tasks add column depends_on_task_id text").run();
  if (!roomTaskColumns.some((column) => column.name === "scheduled_at")) database.prepare("alter table room_tasks add column scheduled_at text").run();
  if (!roomTaskColumns.some((column) => column.name === "started_at")) database.prepare("alter table room_tasks add column started_at text").run();
  if (!roomTaskColumns.some((column) => column.name === "finished_at")) database.prepare("alter table room_tasks add column finished_at text").run();
  const roomHandoffColumns = database.prepare("pragma table_info(room_handoffs)").all() as Array<{ name: string }>;
  if (!roomHandoffColumns.some((column) => column.name === "status")) database.prepare("alter table room_handoffs add column status text not null default 'open'").run();
  if (!roomHandoffColumns.some((column) => column.name === "resolved_at")) database.prepare("alter table room_handoffs add column resolved_at text").run();
  const projectColumns = database.prepare("pragma table_info(projects)").all() as Array<{ name: string }>;
  if (!projectColumns.some((column) => column.name === "check_command")) {
    database.prepare("alter table projects add column check_command text").run();
  }
  const previewColumns = database.prepare("pragma table_info(previews)").all() as Array<{ name: string }>;
  if (!previewColumns.some((column) => column.name === "command")) database.prepare("alter table previews add column command text").run();
  if (!previewColumns.some((column) => column.name === "cwd")) database.prepare("alter table previews add column cwd text").run();
  if (!previewColumns.some((column) => column.name === "status")) database.prepare("alter table previews add column status text not null default 'registered'").run();
  if (!previewColumns.some((column) => column.name === "access")) database.prepare("alter table previews add column access text not null default 'public'").run();
  if (!previewColumns.some((column) => column.name === "updated_at")) database.prepare("alter table previews add column updated_at text").run();
  const previewLogColumns = database.prepare("pragma table_info(preview_logs)").all() as Array<{ name: string }>;
  if (!previewLogColumns.some((column) => column.name === "label")) database.prepare("alter table preview_logs add column label text").run();
  database.prepare("update previews set updated_at = created_at where updated_at is null").run();
  const automationColumns = database.prepare("pragma table_info(automations)").all() as Array<{ name: string }>;
  if (!automationColumns.some((column) => column.name === "provider_id")) database.prepare("alter table automations add column provider_id text").run();
  if (!automationColumns.some((column) => column.name === "model")) database.prepare("alter table automations add column model text").run();
  const messageColumns = database.prepare("pragma table_info(messages)").all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === "reply_to_message_id")) database.prepare("alter table messages add column reply_to_message_id text").run();
  const queueColumns = database.prepare("pragma table_info(message_queue)").all() as Array<{ name: string }>;
  if (!queueColumns.some((column) => column.name === "reply_to_message_id")) database.prepare("alter table message_queue add column reply_to_message_id text").run();
  if (!queueColumns.some((column) => column.name === "order_index")) {
    database.prepare("alter table message_queue add column order_index integer not null default 0").run();
    const rows = database.prepare("select id, session_id from message_queue order by session_id asc, created_at asc, id asc").all() as Array<{ id: string; session_id: string }>;
    const updateOrder = database.prepare("update message_queue set order_index = ? where id = ?");
    const sessionCounts = new Map<string, number>();
    for (const row of rows) {
      const next = (sessionCounts.get(row.session_id) ?? 0) + 1;
      sessionCounts.set(row.session_id, next);
      updateOrder.run(next * 1000, row.id);
    }
  }
  database.exec(`
    create table if not exists message_cards (
      id text primary key,
      session_id text not null,
      message_id text,
      type text not null,
      title text not null,
      payload text not null,
      created_at text not null
    );
    create index if not exists message_cards_session_created_idx on message_cards(session_id, created_at desc, id desc);
    create table if not exists message_card_dismissals (
      session_id text not null,
      suppression_key text not null,
      dismissed_at text not null,
      primary key (session_id, suppression_key)
    );
  `);
  return database;
}

function seedMultiAgentDefaults() {
  const now = new Date().toISOString();
  const storyToMovieRules = [
    "This circle turns a user's short idea, prompt, or story seed into a complete movie production package.",
    "The current system does not export a final video file by default, but the room must still design the full movie package: story, screenplay, scene list, shot list, storyboard images, character visuals, voiceover, dialogue, music, sound effects, editing plan, image prompts, video prompts, and an HTML preview page.",
    "The Film Producer is the orchestrator. It owns the canonical version, assigns work, prevents conflicting rewrites, and merges final deliverables.",
    "The Screenwriter develops the story, characters, structure, scenes, dialogue, and voiceover.",
    "The Storyboard Director converts scenes into shots and storyboard panels.",
    "The Visual Development Director and Character Concept Artist define a stable visual language and consistent character appearances before storyboard generation.",
    "The Storyboard Image Prompt Engineer creates reusable prompts for character concept images and storyboard panels, preserving character identity and style.",
    "The Voice Music Sound Director designs narration, performance notes, music direction, ambient sound, and sound effects.",
    "The Editing Director plans pacing, shot duration, transitions, and trailer structure.",
    "The Production Quality Reviewer checks continuity, missing deliverables, prompt consistency, and audio/editing alignment.",
    "Default files should be organized under a movie package folder with numbered Markdown documents, a storyboard image folder, and index.html.",
  ].join("\n");
  const developmentRules = [
    "This circle turns product ideas, bug reports, refactor requests, and technical goals into working software changes.",
    "The Software Architect is the orchestrator. It clarifies scope, chooses the implementation strategy, splits work, protects boundaries, and owns the final integration plan.",
    "The Product Manager sharpens requirements, success criteria, user impact, edge cases, and release scope before implementation expands.",
    "The Frontend Developer owns UI, client state, accessibility, responsive behavior, and frontend performance.",
    "The Backend Architect owns APIs, services, data flow, persistence boundaries, and server-side reliability.",
    "The Database Optimizer owns schema design, migrations, indexing, query performance, and data integrity.",
    "The DevOps Automator owns local/dev/prod scripts, CI, deployment, environment variables, runtime checks, and preview commands.",
    "The API Tester owns endpoint validation, contract tests, integration coverage, and regression evidence.",
    "The Code Reviewer checks correctness, maintainability, regressions, and missing tests before handoff.",
    "The Security Engineer checks auth, permissions, secrets, injection risks, unsafe file access, and deployment-sensitive behavior.",
    "The Technical Writer updates developer-facing docs, runbooks, API notes, and migration notes when behavior changes.",
    "Default handoff should include changed files, verification commands, risks, and next actions. Prefer focused implementation over speculative rewrites.",
  ].join("\n");
  const circles: Array<Pick<AgentCircleSummary, "id" | "name" | "description"> & Partial<Pick<AgentCircleSummary, "collaborationRules" | "eventRoutingRules" | "maxConcurrentAgents" | "approvalPolicy" | "mergeStrategy">>> = [
    {
      id: "circle-story-to-movie-studio",
      name: "故事到电影工作室",
      description: "把一句话或故事设定扩展为完整电影制作包，包括剧本、分镜、角色形象、故事板图片、配音、配乐、音效、剪辑方案和预览页面。",
      collaborationRules: storyToMovieRules,
      eventRoutingRules: "User ideas should first route to the Film Producer. Story, screenplay, and dialogue route to the Screenwriter. Shot planning routes to the Storyboard Director. Character and visual consistency route to the Visual Development Director and Character Concept Artist. Image/storyboard prompts route to the Storyboard Image Prompt Engineer. Voice, music, and sound route to the Voice Music Sound Director. Pacing and assembly route to the Editing Director. Final checks route to the Production Quality Reviewer.",
      maxConcurrentAgents: 4,
      approvalPolicy: "bounded",
      mergeStrategy: "approval-required",
    },
    {
      id: "circle-software-development-studio",
      name: "软件开发工作室",
      description: "面向前后端、API、数据库、测试、部署、安全和文档的通用程序开发协作圈子。",
      collaborationRules: developmentRules,
      eventRoutingRules: "New work should first route to the Software Architect. Ambiguous product scope routes to the Product Manager. UI and interaction work routes to the Frontend Developer. API, service, and persistence work route to the Backend Architect and Database Optimizer. Build, deployment, preview, and environment work routes to the DevOps Automator. Endpoint validation routes to the API Tester. Final correctness and maintainability review routes to the Code Reviewer. Auth, permission, secret, and unsafe filesystem/network concerns route to the Security Engineer. Documentation or handoff gaps route to the Technical Writer.",
      maxConcurrentAgents: 4,
      approvalPolicy: "bounded",
      mergeStrategy: "approval-required",
    },
  ];
  const seededCircleIds = circles.map((circle) => circle.id);
  const circlePlaceholders = seededCircleIds.map(() => "?").join(",");
  db.prepare(`delete from agent_circle_roles where circle_id in (select id from agent_circles where builtin = 1 and id not in (${circlePlaceholders}))`).run(...seededCircleIds);
  db.prepare(`delete from agent_circles where builtin = 1 and id not in (${circlePlaceholders})`).run(...seededCircleIds);
  db.prepare(`delete from agent_circle_roles where circle_id in (${circlePlaceholders})`).run(...seededCircleIds);
  const insert = db.prepare(`
    insert into agent_circles (id, name, description, group_template_id, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, builtin, created_at, updated_at)
    values (?, ?, ?, null, ?, ?, ?, ?, ?, 1, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      collaboration_rules = excluded.collaboration_rules,
      event_routing_rules = excluded.event_routing_rules,
      max_concurrent_agents = excluded.max_concurrent_agents,
      approval_policy = excluded.approval_policy,
      merge_strategy = excluded.merge_strategy,
      builtin = 1,
      updated_at = excluded.updated_at
  `);
  for (const circle of circles) {
    insert.run(
      circle.id,
      circle.name,
      circle.description ?? null,
      circle.collaborationRules ?? "",
      circle.eventRoutingRules ?? "",
      circle.maxConcurrentAgents ?? 3,
      circle.approvalPolicy ?? "bounded",
      circle.mergeStrategy ?? "approval-required",
      now,
      now,
    );
  }

  const storyToMovieRoles = [
    { id: "role-story-to-movie-film-producer", path: "story-to-movie/film-producer.md", listenMode: "orchestrator" },
    { id: "role-story-to-movie-screenwriter", path: "story-to-movie/screenwriter.md", listenMode: "active" },
    { id: "role-story-to-movie-storyboard-director", path: "story-to-movie/storyboard-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-visual-development-director", path: "story-to-movie/visual-development-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-character-concept-artist", path: "story-to-movie/character-concept-artist.md", listenMode: "passive" },
    { id: "role-story-to-movie-image-prompt-engineer", path: "story-to-movie/storyboard-image-prompt-engineer.md", listenMode: "passive" },
    { id: "role-story-to-movie-voice-music-sound-director", path: "story-to-movie/voice-music-sound-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-editing-director", path: "story-to-movie/editing-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-production-quality-reviewer", path: "story-to-movie/production-quality-reviewer.md", listenMode: "passive" },
  ] satisfies Array<{ id: string; path: string; listenMode: AgentListenMode }>;
  const developmentRoles = [
    { id: "role-dev-software-architect", path: "agency-agents/engineering/engineering-software-architect.md", listenMode: "orchestrator" },
    { id: "role-dev-product-manager", path: "agency-agents/product/product-manager.md", listenMode: "active" },
    { id: "role-dev-frontend-developer", path: "agency-agents/engineering/engineering-frontend-developer.md", listenMode: "active" },
    { id: "role-dev-backend-architect", path: "agency-agents/engineering/engineering-backend-architect.md", listenMode: "active" },
    { id: "role-dev-database-optimizer", path: "agency-agents/engineering/engineering-database-optimizer.md", listenMode: "passive" },
    { id: "role-dev-devops-automator", path: "agency-agents/engineering/engineering-devops-automator.md", listenMode: "passive" },
    { id: "role-dev-api-tester", path: "agency-agents/testing/testing-api-tester.md", listenMode: "passive" },
    { id: "role-dev-code-reviewer", path: "agency-agents/engineering/engineering-code-reviewer.md", listenMode: "passive" },
    { id: "role-dev-security-engineer", path: "agency-agents/engineering/engineering-security-engineer.md", listenMode: "passive" },
    { id: "role-dev-technical-writer", path: "agency-agents/engineering/engineering-technical-writer.md", listenMode: "passive" },
  ] satisfies Array<{ id: string; path: string; listenMode: AgentListenMode }>;
  const insertRole = db.prepare(`
    insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
    values (?, ?, ?, 'builtin-template', ?, null, ?, ?, '[]', ?, '[]', 'isolated-worktree-with-shared-room', null, null, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      source_type = excluded.source_type,
      source_path = excluded.source_path,
      markdown_content = excluded.markdown_content,
      system_prompt = excluded.system_prompt,
      default_listen_mode = excluded.default_listen_mode,
      default_workspace_mode = excluded.default_workspace_mode,
      output_contract = excluded.output_contract,
      safety_notes = excluded.safety_notes,
      updated_at = excluded.updated_at
  `);
  const insertCircleRole = db.prepare("insert or replace into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)");
  function seedCircleRoles(circleId: string, roles: Array<{ id: string; path: string; listenMode: AgentListenMode }>, outputContract: string, safetyNotes: string) {
    for (const [position, role] of roles.entries()) {
      const templatePath = join(agentRoleTemplateDir, role.path);
      if (!existsSync(templatePath)) continue;
      const markdownContent = readFileSync(templatePath, "utf8");
      const metadata = parseMarkdownFrontmatter(markdownContent);
      const name = metadata.name || markdownTitle(markdownContent) || role.id;
      const description = metadata.description || markdownDescription(markdownContent);
      insertRole.run(role.id, name, description, role.path, markdownContent, markdownContent, role.listenMode, outputContract, safetyNotes, now, now);
      insertCircleRole.run(circleId, role.id, position);
    }
  }
  seedCircleRoles(
    "circle-story-to-movie-studio",
    storyToMovieRoles,
    "Return Markdown artifacts suitable for a complete movie production package. When creating files, keep them under the related session or project workspace.",
    "Do not claim that a final video file was generated unless an actual video generation tool is available and used. Avoid copyrighted song requirements; describe musical qualities instead.",
  );
  seedCircleRoles(
    "circle-software-development-studio",
    developmentRoles,
    "Return focused implementation plans, code changes, tests, review notes, and documentation updates suitable for software delivery. When creating files, keep them under the related project or session workspace.",
    "Respect project boundaries, secrets, permissions, and approval settings. Do not run destructive commands or expose credentials. Prefer small verified changes with clear rollback notes.",
  );
}

function loadAuthConfig(): AuthConfig | null {
  const row = db.prepare("select access_token_hash, otp_secret from auth_config where id = 'local-admin'").get() as
    | { access_token_hash: string; otp_secret: string }
    | undefined;
  return row ? { accessTokenHash: row.access_token_hash, otpSecret: row.otp_secret } : null;
}

function saveAuthConfig(config: AuthConfig) {
  db.prepare(`
    insert into auth_config (id, access_token_hash, otp_secret, updated_at)
    values ('local-admin', ?, ?, ?)
    on conflict(id) do update set
      access_token_hash = excluded.access_token_hash,
      otp_secret = excluded.otp_secret,
      updated_at = excluded.updated_at
  `).run(config.accessTokenHash, config.otpSecret, new Date().toISOString());
}

function approvalFromRow(row: Record<string, unknown>): ApprovalRecord {
  let payload: unknown = null;
  try {
    payload = JSON.parse(String(row.payload));
  } catch {
    payload = null;
  }
  return {
    id: String(row.id),
    actionType: String(row.action_type) as ApprovalActionType,
    risk: String(row.risk) as ApprovalRisk,
    status: String(row.status) as ApprovalStatus,
    title: String(row.title),
    description: String(row.description),
    details: String(row.details),
    payload,
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

function publicApproval(approval: ApprovalRecord): ApprovalSummary {
  const { payload, ...summary } = approval;
  return { ...summary, related: payload };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function approvalGrantKey(actionType: ApprovalActionType, payload: unknown) {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (actionType === "preview-command-run") {
    return stableJson({
      command: value.command,
      cwd: value.cwd,
      targetHost: value.targetHost,
      port: value.port,
      scopeType: value.scopeType,
      scopeId: value.scopeId,
    });
  }
  if (actionType === "project-git-operation") return stableJson({ projectId: value.projectId, operation: value.operation });
  if (actionType === "project-delete-files") return stableJson({ projectId: value.projectId, deleteFiles: true });
  if (actionType === "room-run-merge") return stableJson({ roomId: value.roomId });
  if (actionType === "codex-runtime-update") return stableJson(value);
  return stableJson(value);
}

function approvalAlwaysAllowed(actionType: ApprovalActionType, payload: unknown) {
  const grantKey = approvalGrantKey(actionType, payload);
  return Boolean(db.prepare("select id from approval_grants where action_type = ? and grant_key = ? and (expires_at is null or expires_at > ?)").get(actionType, grantKey, new Date().toISOString()));
}

function saveApprovalGrant(approval: ApprovalRecord, expiresAt: string | null = null) {
  const now = new Date().toISOString();
  db.prepare(`
    insert into approval_grants (id, action_type, grant_key, title, details, expires_at, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(action_type, grant_key) do update set
      title = excluded.title,
      details = excluded.details,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `).run(`approval-grant-${randomUUID()}`, approval.actionType, approvalGrantKey(approval.actionType, approval.payload), approval.title, approval.details, expiresAt, now);
}

function approvalGrantFromRow(row: Record<string, unknown>): ApprovalGrantSummary {
  return {
    id: String(row.id),
    actionType: String(row.action_type) as ApprovalActionType,
    title: String(row.title),
    details: String(row.details),
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}

function listApprovalGrants(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from approval_grants
    ${cursor ? "where (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(approvalGrantFromRow), limit, (item) => item.createdAt);
}

function listApprovals(status: string | undefined, archived: boolean, limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(status ? ["status = @status"] : []),
    archived ? "archived_at is not null" : "archived_at is null",
    ...(cursor ? ["(created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from approvals
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ status, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 });
  return pageFromRows((rows as Array<Record<string, unknown>>).map(approvalFromRow), limit, (item) => item.createdAt);
}

function getApproval(id: string) {
  const row = db.prepare("select * from approvals where id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? approvalFromRow(row) : null;
}

function createApproval(input: Omit<ApprovalRecord, "id" | "status" | "createdAt" | "resolvedAt">) {
  const payload = JSON.stringify(input.payload);
  const existing = db.prepare(`
    select * from approvals
    where status = 'pending' and action_type = ? and payload = ?
    order by created_at desc
    limit 1
  `).get(input.actionType, payload) as Record<string, unknown> | undefined;
  if (existing) return approvalFromRow(existing);
  const approval: ApprovalRecord = {
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  db.prepare(`
    insert into approvals (id, action_type, risk, status, title, description, details, payload, created_at, resolved_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    approval.id,
    approval.actionType,
    approval.risk,
    approval.status,
    approval.title,
    approval.description,
    approval.details,
    payload,
    approval.createdAt,
    approval.resolvedAt,
  );
  emitExternalNotification({
    eventType: "needs_approval",
    severity: approval.risk === "critical" || approval.risk === "high" ? "error" : "warning",
    title: approval.title,
    message: approval.description || approval.details,
    sourceType: "approval",
    sourceId: approval.id,
    metadata: { actionType: approval.actionType, risk: approval.risk },
  });
  return approval;
}

function resolveApproval(id: string, status: Extract<ApprovalStatus, "approved" | "denied">) {
  const resolvedAt = new Date().toISOString();
  db.prepare("update approvals set status = ?, resolved_at = ? where id = ?").run(status, resolvedAt, id);
  return getApproval(id);
}

function archiveApproval(id: string) {
  const archivedAt = new Date().toISOString();
  db.prepare("update approvals set archived_at = ? where id = ? and status != 'pending'").run(archivedAt, id);
  return getApproval(id);
}

function restoreApproval(id: string) {
  db.prepare("update approvals set archived_at = null where id = ?").run(id);
  return getApproval(id);
}

function codexRuntimeRisk(current: CodexRuntimeSettings, next: CodexRuntimeSettings): ApprovalRisk | null {
  if (next.bypassSandbox && !current.bypassSandbox) return "critical";
  if (next.sandboxMode === "danger-full-access" && current.sandboxMode !== "danger-full-access") return "high";
  return null;
}

function codexRuntimeDetails(next: CodexRuntimeSettings) {
  return [
    `sandboxMode=${next.sandboxMode}`,
    `approvalPolicy=${next.approvalPolicy}`,
    `bypassSandbox=${String(next.bypassSandbox)}`,
  ].join("\n");
}

function applyCodexRuntimeSettings(settings: CodexRuntimeSettings) {
  codexRuntimeSettings = settings;
  runtimeSettingsStore.codexRuntime.save(settings);
  return settings;
}

function previewCommandRisk(preview: PreviewRecord): ApprovalRisk | null {
  const command = preview.command?.toLowerCase() ?? "";
  if (!command) return null;
  if (preview.port > 0 && preview.port < 1024) return "high";
  if (/\b(sudo|su|launchctl|osascript)\b/.test(command)) return "critical";
  if (/\b(docker|podman|kubectl|systemctl|pm2)\b/.test(command)) return "high";
  if (/\brm\s+-[^&|;]*r[^&|;]*f\b/.test(command)) return "high";
  return null;
}

function previewApprovalDetails(preview: PreviewRecord) {
  return [
    `preview=${preview.label}`,
    `target=${preview.targetHost}:${preview.port}`,
    `cwd=${preview.cwd ?? "(workspace root)"}`,
    `command=${preview.command ?? ""}`,
  ].join("\n");
}

function createPreviewApproval(preview: PreviewRecord, risk: ApprovalRisk) {
  return createApproval({
    actionType: "preview-command-run",
    risk,
    title: "Preview command requires approval",
    description: "Run a preview command that crosses a configured risk boundary.",
    details: previewApprovalDetails(preview),
    payload: { previewId: preview.id, command: preview.command ?? "", cwd: preview.cwd ?? "", targetHost: preview.targetHost, port: preview.port, scopeType: preview.scopeType, scopeId: preview.scopeId },
  });
}

function projectDeleteApprovalDetails(project: ProjectSummary) {
  return [
    `project=${project.name}`,
    `id=${project.id}`,
    `workspacePath=${project.workspacePath}`,
  ].join("\n");
}

function createProjectDeleteApproval(project: ProjectSummary) {
  return createApproval({
    actionType: "project-delete-files",
    risk: "high",
    title: "Project file deletion requires approval",
    description: "Delete a project record and recursively remove its workspace directory.",
    details: projectDeleteApprovalDetails(project),
    payload: { projectId: project.id, deleteFiles: true },
  });
}

function createRoomRunMergeApproval(roomId: string, runId: string, risk: ApprovalRisk, reason: string) {
  return createApproval({
    actionType: "room-run-merge",
    risk,
    title: "Room run merge requires approval",
    description: "Apply an Agent run patch back into the project workspace.",
    details: [`room=${roomId}`, `run=${runId}`, `reason=${reason}`].join("\n"),
    payload: { roomId, runId },
  });
}

function createProjectGitApproval(project: ProjectSummary, operation: ProjectGitOperationType, args: string[], reason: string) {
  return createApproval({
    actionType: "project-git-operation",
    risk: operation === "push" ? "high" : "medium",
    title: "Project Git operation requires approval",
    description: `Run git ${operation} for project ${project.name}.`,
    details: [`project=${project.name}`, `id=${project.id}`, `workspacePath=${project.workspacePath}`, `operation=${operation}`, `args=${args.join(" ")}`, `reason=${reason}`].join("\n"),
    payload: { projectId: project.id, operation, args },
  });
}

function loadAppData(): AppData {
  const projects = (db.prepare("select * from projects order by name asc").all() as Array<Record<string, unknown>>).map(projectFromRow);
  const sessions = (db.prepare("select * from sessions order by updated_at desc").all() as Array<Record<string, unknown>>)
    .map((row) => sessionFromRow(row, projects));
  for (const session of sessions) {
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
  const automations = (db.prepare("select * from automations order by updated_at desc").all() as Array<Record<string, unknown>>).map(automationFromRow);
  return { sessions, projects, providers, automations };
}

function loadFileMounts() {
  const rows = db.prepare(`
    select id, name, root_path, created_at, updated_at
    from file_mounts
    order by created_at asc
  `).all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const mount: FileMountRecord = {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
    fileMounts.set(mount.id, mount);
  }
  if (!fileMounts.size) {
    const mount: FileMountRecord = {
      id: "default",
      name: "Project Root",
      rootPath: workspaceRoot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fileMounts.set(mount.id, mount);
    db.prepare(`
      insert into file_mounts (id, name, root_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set
        name = excluded.name,
        root_path = excluded.root_path,
        updated_at = excluded.updated_at
    `).run(mount.id, mount.name, mount.rootPath, mount.createdAt, mount.updatedAt);
  }
}

function saveAppData() {
  const save = db.transaction(() => {
    for (const provider of appData.providers) upsertProvider(provider);
    for (const project of appData.projects) upsertProject(project);
    for (const session of appData.sessions) upsertSession(session);
    for (const automation of appData.automations) upsertAutomation(automation);
  });
  save();
}

function sessionFromRow(row: Record<string, unknown>, projects: ProjectSummary[] = []): SessionSummary {
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
    status: row.status as SessionSummary["status"],
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: String(row.updated_at),
  };
  return { ...session, goal: activeGoalForSession(session) };
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

function automationFromRow(row: Record<string, unknown>): AutomationSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    projectId: row.project_id ? String(row.project_id) : null,
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    prompt: String(row.prompt),
    schedule: String(row.schedule),
    status: row.status === "paused" ? "paused" : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function automationRunFromRow(row: Record<string, unknown>): AutomationRunSummary {
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    sessionId: String(row.session_id),
    status: row.status === "done" || row.status === "failed" || row.status === "stopped" ? row.status : "running",
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
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

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readSkillDescription(path: string) {
  try {
    const content = readFileSync(path, "utf8");
    const frontMatterDescription = content.match(/^---[\s\S]*?\ndescription:\s*["']?([^"'\n]+)["']?/m)?.[1];
    if (frontMatterDescription) return frontMatterDescription.trim();
    return content.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("---") && !line.startsWith("#"))?.trim();
  } catch {
    return undefined;
  }
}

function findSkillFiles(root: string, depth = 3): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const entryPath = join(root, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") results.push(entryPath);
    if (entry.isDirectory()) results.push(...findSkillFiles(entryPath, depth - 1));
  }
  return results;
}

function listSkills(): ExtensionSummary[] {
  const roots = [join(codexHome, "skills"), join(codexHome, "plugins", "cache")];
  const seen = new Set<string>();
  return roots.flatMap((root) => findSkillFiles(root)).flatMap((skillPath) => {
    const folder = dirname(skillPath);
    if (seen.has(folder)) return [];
    seen.add(folder);
    const name = basename(folder);
    return [{
      id: `skill:${folder}`,
      type: "skill" as const,
      name,
      description: readSkillDescription(skillPath),
      path: folder,
      source: folder.includes("/plugins/cache/") ? "plugin cache" : "codex home",
      enabled: true,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function findPluginManifests(root: string, depth = 4): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const entryPath = join(root, entry.name);
    if (entry.isFile() && entry.name === "plugin.json" && basename(dirname(entryPath)) === ".codex-plugin") results.push(entryPath);
    if (entry.isDirectory()) results.push(...findPluginManifests(entryPath, depth - 1));
  }
  return results;
}

function listPlugins(): ExtensionSummary[] {
  const roots = [join(codexHome, "plugins"), join(codexHome, "plugins", "cache")];
  const seen = new Set<string>();
  return roots.flatMap((root) => findPluginManifests(root)).flatMap((manifestPath) => {
    const pluginRoot = dirname(dirname(manifestPath));
    if (seen.has(pluginRoot)) return [];
    seen.add(pluginRoot);
    const manifest = readJsonFile(manifestPath);
    return [{
      id: `plugin:${pluginRoot}`,
      type: "plugin" as const,
      name: String(manifest?.name ?? basename(pluginRoot)),
      description: manifest?.description ? String(manifest.description) : undefined,
      path: pluginRoot,
      source: pluginRoot.includes("/plugins/cache/") ? "plugin cache" : "codex home",
      enabled: true,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function listMcpServers(): ExtensionSummary[] {
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return [];
  const content = readFileSync(configPath, "utf8");
  const matches = Array.from(content.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm));
  return matches.map((match) => ({
    id: `mcp:${match[1]}`,
    type: "mcp" as const,
    name: match[1],
    path: configPath,
    source: "config.toml",
    enabled: true,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function pageExtensions(items: ExtensionSummary[], limit = 20, cursorValue?: string | null, q = "") {
  const cursor = decodePageCursor(cursorValue);
  const query = q.trim().toLowerCase();
  const filtered = items
    .filter((item) => !query || [item.name, item.description, item.path, item.source, item.type].some((value) => value?.toLowerCase().includes(query)))
    .filter((item) => !cursor || item.name > cursor.sortValue || (item.name === cursor.sortValue && item.id > cursor.id))
    .slice(0, limit + 1);
  return pageFromRows(filtered, limit, (item) => item.name);
}

function assertInsideCodexHome(path: string) {
  const absolutePath = resolve(path);
  const relativePath = relative(codexHome, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_codex_home");
  return absolutePath;
}

function readMcpConfigSection(name: string) {
  const configPath = join(codexHome, "config.toml");
  const content = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\[mcp_servers\\.${escapedName}\\][\\s\\S]*?(?=^\\[|\\s*$)`, "m"));
  return match?.[0]?.trim() || "";
}

function readExtensionDetail(type: ExtensionSummary["type"], name: string, path?: string): ExtensionDetail {
  if (type === "mcp") {
    const item: ExtensionSummary = {
      id: `mcp:${name}`,
      type,
      name,
      path: join(codexHome, "config.toml"),
      source: "config.toml",
      enabled: true,
    };
    return { item, format: "toml", content: readMcpConfigSection(name) };
  }
  if (!path) throw new Error("path_required");
  const rootPath = assertInsideCodexHome(path);
  if (type === "skill") {
    const skillPath = join(rootPath, "SKILL.md");
    const item: ExtensionSummary = {
      id: `skill:${rootPath}`,
      type,
      name: name || basename(rootPath),
      description: readSkillDescription(skillPath),
      path: rootPath,
      source: rootPath.includes("/plugins/cache/") ? "plugin cache" : "codex home",
      enabled: true,
    };
    return { item, format: "markdown", content: readFileSync(skillPath, "utf8") };
  }
  const manifestPath = join(rootPath, ".codex-plugin", "plugin.json");
  const manifest = readJsonFile(manifestPath);
  const item: ExtensionSummary = {
    id: `plugin:${rootPath}`,
    type,
    name: String(manifest?.name ?? name ?? basename(rootPath)),
    description: manifest?.description ? String(manifest.description) : undefined,
    path: rootPath,
    source: rootPath.includes("/plugins/cache/") ? "plugin cache" : "codex home",
    enabled: true,
  };
  return { item, format: "json", content: readFileSync(manifestPath, "utf8") };
}

function upsertSession(session: SessionSummary) {
  db.prepare(`
    insert into sessions (id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      kind = excluded.kind,
      conversation_type = excluded.conversation_type,
      room_id = excluded.room_id,
      title = excluded.title,
      project_id = excluded.project_id,
      workspace_path = excluded.workspace_path,
      provider_id = excluded.provider_id,
      model = excluded.model,
      codex_session_id = excluded.codex_session_id,
      notifications_enabled = excluded.notifications_enabled,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(
    session.id,
    session.kind,
    session.conversationType ?? "codex",
    session.roomId ?? null,
    session.title,
    session.projectId,
    session.workspacePath,
    session.providerId ?? null,
    session.model ?? null,
    session.codexSessionId ?? null,
    session.notificationsEnabled === false ? 0 : 1,
    session.status,
    session.createdAt ?? null,
    session.updatedAt,
  );
  writeSessionMetadata(session);
}

function upsertProject(project: ProjectSummary) {
  db.prepare(`
    insert into projects (id, name, workspace_path, runner, check_command, changed_files)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      workspace_path = excluded.workspace_path,
      runner = excluded.runner,
      check_command = excluded.check_command,
      changed_files = excluded.changed_files
  `).run(project.id, project.name, project.workspacePath, project.runner, project.checkCommand ?? null, project.changedFiles);
}

function upsertProvider(provider: ProviderRecord) {
  db.prepare(`
    insert into providers (id, name, kind, default_model, base_url, api_key, capabilities, rpm_limit, rpm_limit_enabled, use_proxy)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      kind = excluded.kind,
      default_model = excluded.default_model,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      capabilities = excluded.capabilities,
      rpm_limit = excluded.rpm_limit,
      rpm_limit_enabled = excluded.rpm_limit_enabled,
      use_proxy = excluded.use_proxy
  `).run(provider.id, provider.name, provider.kind, provider.defaultModel, provider.baseUrl ?? null, provider.apiKey ?? null, JSON.stringify(provider.capabilities ?? defaultProviderCapabilities(provider.kind)), sanitizeProviderRpmLimit(provider.rpmLimit), provider.rpmLimitEnabled ? 1 : 0, provider.useProxy ? 1 : 0);
}

function upsertAutomation(automation: AutomationSummary) {
  db.prepare(`
    insert into automations (id, name, project_id, provider_id, model, prompt, schedule, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      project_id = excluded.project_id,
      provider_id = excluded.provider_id,
      model = excluded.model,
      prompt = excluded.prompt,
      schedule = excluded.schedule,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    automation.id,
    automation.name,
    automation.projectId,
    automation.providerId ?? null,
    automation.model ?? null,
    automation.prompt,
    automation.schedule,
    automation.status,
    automation.createdAt,
    automation.updatedAt,
  );
}

function createAutomationRun(automationId: string, sessionId: string) {
  const run: AutomationRunSummary = {
    id: `automation-run-${randomUUID()}`,
    automationId,
    sessionId,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
  };
  db.prepare(`
    insert into automation_runs (id, automation_id, session_id, status, exit_code, started_at, finished_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(run.id, run.automationId, run.sessionId, run.status, run.exitCode, run.startedAt, run.finishedAt ?? null);
  return run;
}

function finishAutomationRun(sessionId: string, exitCode: number | null, stopped: boolean) {
  const status: AutomationRunSummary["status"] = stopped ? "stopped" : exitCode === 0 ? "done" : "failed";
  db.prepare(`
    update automation_runs
    set status = ?, exit_code = ?, finished_at = ?
    where session_id = ? and status = 'running'
  `).run(status, exitCode, new Date().toISOString(), sessionId);
}

function setRoomParentSessionStatus(roomId: string, status: SessionSummary["status"], updatedAt = new Date().toISOString()) {
  const room = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  if (!room?.session_id) return;
  const parentSession = appData.sessions.find((item) => item.id === room.session_id);
  if (!parentSession || parentSession.status === status) return;
  parentSession.status = status;
  parentSession.updatedAt = updatedAt;
  upsertSession(parentSession);
  publishTaskEvent(parentSession.id, status === "running" ? { type: "started", session: parentSession } : { type: "done", session: parentSession, exitCode: null });
}

function mentionsRoomUser(value: string) {
  return /(^|\s)@user\b/i.test(value);
}

function roomTaskShouldNotifyUser(roomId?: string | null, taskId?: string | null, assistantContent = "") {
  if (!roomId || !taskId) return false;
  if (mentionsRoomUser(assistantContent)) return true;
  const task = db.prepare("select prompt, payload from room_tasks where room_id = ? and id = ?").get(roomId, taskId) as { prompt?: string; payload?: string | null } | undefined;
  const payload = jsonPayload(task?.payload) as { mentionsUser?: boolean };
  if (payload.mentionsUser === true || mentionsRoomUser(task?.prompt ?? "")) return true;
  const rows = db.prepare("select payload from room_events where room_id = ? order by created_at desc, id desc limit 80").all(roomId) as Array<{ payload?: string | null }>;
  return rows.some((row) => {
    const eventPayload = jsonPayload(row.payload) as { mentionsUser?: boolean; taskIds?: unknown[]; taskId?: unknown };
    if (eventPayload.mentionsUser !== true) return false;
    if (String(eventPayload.taskId ?? "") === taskId) return true;
    return Array.isArray(eventPayload.taskIds) && eventPayload.taskIds.map(String).includes(taskId);
  });
}

function finishAgentRun(sessionId: string, exitCode: number | null, stopped: boolean) {
  const status = stopped ? "stopped" : exitCode === 0 ? "done" : "failed";
  const now = new Date().toISOString();
  const run = db.prepare("select * from agent_runs where session_id = ? and status = 'running'").get(sessionId) as Record<string, unknown> | undefined;
  db.prepare(`
    update agent_runs
    set status = ?, exit_code = ?, finished_at = ?
    where session_id = ? and status = 'running'
  `).run(status, exitCode, now, sessionId);
  if (run?.task_id) {
    const taskStatus = status === "done" ? "done" : status === "stopped" ? "cancelled" : "failed";
    db.prepare("update room_tasks set status = ?, finished_at = ?, updated_at = ? where id = ?").run(taskStatus, now, now, String(run.task_id));
    const goalTask = db.prepare("select goal_item_id from room_tasks where id = ?").get(String(run.task_id)) as { goal_item_id?: string | null } | undefined;
    if (goalTask?.goal_item_id) {
      const goalItemStatusValue: GoalItemStatus = taskStatus === "done" ? "completed" : taskStatus === "cancelled" ? "cancelled" : "failed";
      const item = db.prepare("select goal_id from goal_items where id = ?").get(String(goalTask.goal_item_id)) as { goal_id?: string } | undefined;
      if (item?.goal_id) updateGoalItem(String(item.goal_id), String(goalTask.goal_item_id), { status: goalItemStatusValue }, "system");
    }
    const roomSession = db.prepare("select session_id from rooms where id = ?").get(String(run.room_id)) as { session_id?: string | null } | undefined;
    const agent = db.prepare("select name from agents where id = ?").get(String(run.agent_id)) as { name?: string } | undefined;
    const task = db.prepare("select payload from room_tasks where id = ?").get(String(run.task_id)) as { payload?: string | null } | undefined;
    let taskPayload: Record<string, unknown> = {};
    try {
      taskPayload = task?.payload ? JSON.parse(task.payload) as Record<string, unknown> : {};
    } catch {
      taskPayload = {};
    }
    const latestAssistant = db.prepare("select content from messages where session_id = ? and role = 'assistant' order by created_at desc, id desc limit 1").get(sessionId) as { content?: string } | undefined;
    if (status === "done" && roomSession?.session_id) {
      const agentName = agent?.name || String(run.agent_id);
      const content = latestAssistant?.content?.trim()
        ? `${agentName}:\n${latestAssistant.content.trim()}`
        : taskPayload.kind === "listen"
          ? `${agentName}:\n已收到，我会继续关注。`
          : "";
      if (content) {
        const message = appendSessionMessage(roomSession.session_id, "assistant", content);
        roomEvent(String(run.room_id), "agent.message", { runId: run.id, taskId: run.task_id, sessionId, messageId: message.id, content, agentId: run.agent_id }, String(run.agent_id));
        const parentSession = appData.sessions.find((item) => item.id === roomSession.session_id);
        if (parentSession) {
          parentSession.updatedAt = message.createdAt;
          upsertSession(parentSession);
          publishTaskEvent(parentSession.id, { type: "message", message, session: parentSession });
          scheduleSessionAutoCompaction(parentSession, "room-agent-message");
        }
      }
    }
    if (status === "done") createRoomRunMergeCandidate(run);
    const eventType = status === "done" ? "agent.completed" : status === "stopped" ? "agent.stopped" : "agent.failed";
    roomEvent(String(run.room_id), eventType, { runId: run.id, taskId: run.task_id, exitCode }, null, String(run.agent_id));
    const activeRuns = db.prepare("select count(*) as count from agent_runs where room_id = ? and status = 'running'").get(String(run.room_id)) as { count?: number } | undefined;
    if (!activeRuns?.count) setRoomParentSessionStatus(String(run.room_id), "paused", now);
    orchestrateRoom(String(run.room_id), eventType);
  }
}

function stopOrphanRoomAgentRun(sessionId: string) {
  codexTaskStopRequested.add(sessionId);
  markTaskRunStopRequested(sessionId);
  finishTaskRun(sessionId, "stopped", null, "user_stopped");
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session) {
    session.status = session.status === "running" ? "paused" : session.status;
    session.updatedAt = new Date().toISOString();
    appendCodexOutput(session.id, "\n[room task stopped]\n");
    saveAppData();
    publishTaskEvent(session.id, { type: "done", session, exitCode: null });
  }
  finishAgentRun(sessionId, null, true);
  codexTaskStopRequested.delete(sessionId);
}

function runGitSync(cwd: string, args: string[], input?: string) {
  const result = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function roomProject(roomId: string) {
  const row = db.prepare("select project_id from rooms where id = ?").get(roomId) as { project_id?: string } | undefined;
  return row?.project_id ? appData.projects.find((project) => project.id === row.project_id) ?? null : null;
}

function createRoomRunMergeCandidate(run: Record<string, unknown>) {
  const roomId = String(run.room_id);
  const project = roomProject(roomId);
  const workspacePath = run.workspace_path ? String(run.workspace_path) : "";
  if (!project || !workspacePath || !existsSync(workspacePath)) return;
  const diff = runGitSync(workspacePath, ["diff", "--"]);
  const status = runGitSync(workspacePath, ["status", "--short"]);
  if (!diff.stdout.trim() && !status.stdout.trim()) {
    db.prepare(`
      insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
      values (?, ?, ?, ?, 'merged', 'No workspace changes', ?, ?)
      on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at
    `).run(String(run.id), roomId, project.id, workspacePath, new Date().toISOString(), new Date().toISOString());
    return;
  }
  const check = diff.stdout.trim() ? runGitSync(resolveTerminalCwd(project.workspacePath), ["apply", "--check", "-"], diff.stdout) : { exitCode: 0, stdout: "", stderr: "" };
  const mergeStatus = check.exitCode === 0 ? "pending" : "conflict";
  const summary = runGitSync(workspacePath, ["diff", "--stat"]).stdout.trim() || status.stdout.trim();
  db.prepare(`
    insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at
  `).run(String(run.id), roomId, project.id, workspacePath, mergeStatus, summary, new Date().toISOString(), new Date().toISOString());
  const payload = { runId: String(run.id), taskId: run.task_id ? String(run.task_id) : null, status: mergeStatus, summary, workspacePath, projectId: project.id };
  createRoomArtifact(roomId, {
    agentId: run.agent_id ? String(run.agent_id) : null,
    kind: "file-change",
    title: mergeStatus === "pending" ? "Agent changes ready for review" : "Agent changes need conflict review",
    payload,
  });
  if (run.session_id) appendMessageCard(String(run.session_id), "file-change", mergeStatus === "pending" ? "Changes ready for review" : "Changes need conflict review", payload);
}

function latestExecutionContextForSession(sessionId: string) {
  const row = db.prepare(`
    select * from execution_contexts
    where session_id = ?
    order by created_at desc, id desc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
  return row ? executionContextFromRow(row) : null;
}

function agentPermissionsForRun(run: Record<string, unknown>) {
  const agentRow = db.prepare("select * from agents where id = ?").get(String(run.agent_id)) as Record<string, unknown> | undefined;
  return agentRow ? resolvedAgentPermissions(agentFromRow(agentRow)) : defaultAgentPermissions;
}

function roomGroupForRoom(roomId: string) {
  const row = db.prepare(`
    select agent_groups.*
    from rooms
    join agent_groups on agent_groups.id = rooms.group_id
    where rooms.id = ?
  `).get(roomId) as Record<string, unknown> | undefined;
  return row ? agentGroupFromRow(row) : null;
}

function applyRoomRunMerge(roomId: string, runId: string): RoomRunMergeResponse {
  const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(runId, roomId) as Record<string, unknown> | undefined;
  if (!run) throw new Error("agent_run_not_found");
  const project = roomProject(roomId);
  if (!project) throw new Error("room_project_not_found");
  const workspacePath = run.workspace_path ? String(run.workspace_path) : "";
  const diff = workspacePath ? runGitSync(workspacePath, ["diff", "--"]) : { exitCode: 1, stdout: "", stderr: "workspace_not_found" };
  if (diff.exitCode !== 0 || !diff.stdout.trim()) throw new Error(diff.stderr || "empty_diff");
  const projectPath = resolveTerminalCwd(project.workspacePath);
  const check = runGitSync(projectPath, ["apply", "--check", "-"], diff.stdout);
  if (check.exitCode !== 0) {
    db.prepare("update room_run_merges set status = 'conflict', summary = ?, updated_at = ? where run_id = ?").run(check.stderr || "merge conflict", new Date().toISOString(), runId);
    roomEvent(roomId, "audit.operation", { action: "merge-conflict", runId, error: check.stderr || "merge_conflict" }, run.agent_id ? String(run.agent_id) : null);
    return { run: agentRunFromRow(run), ok: false, message: check.stderr || "merge_conflict" };
  }
  const gateCommands = splitProjectCheckCommands(project.checkCommand);
  for (const gateCommand of gateCommands) {
    const startedAt = new Date().toISOString();
    const gate = spawnSync("/bin/zsh", ["-lc", gateCommand], { cwd: projectPath, env: process.env, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024 });
    const result = {
      command: gateCommand,
      cwd: toTerminalPath(projectPath),
      exitCode: gate.status,
      stdout: gate.stdout ?? "",
      stderr: gate.stderr ?? gate.error?.message ?? "",
      durationMs: 0,
      timedOut: gate.error?.message?.includes("ETIMEDOUT") ?? false,
    };
    const saved = saveProjectCheckRun(project.id, result, startedAt);
    if (saved.status !== "done") {
      createRoomDecision(roomId, {
        title: "Merge blocked by failed project check",
        status: "open",
        payload: { runId, projectId: project.id, checkRunId: saved.id, command: gateCommand, status: saved.status },
      });
      roomEvent(roomId, "audit.operation", { action: "merge-blocked-by-check", runId, checkRunId: saved.id, status: saved.status }, run.agent_id ? String(run.agent_id) : null);
      return { run: agentRunFromRow(run), ok: false, message: "project_check_failed_before_merge" };
    }
  }
  const apply = runGitSync(projectPath, ["apply", "-"], diff.stdout);
  const status = apply.exitCode === 0 ? "merged" : "error";
  db.prepare(`
    insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at
  `).run(runId, roomId, project.id, workspacePath, status, apply.stderr || "Applied patch to project workspace", new Date().toISOString(), new Date().toISOString());
  roomEvent(roomId, "audit.operation", { action: apply.exitCode === 0 ? "merge-applied" : "merge-failed", runId, status, error: apply.stderr || null }, run.agent_id ? String(run.agent_id) : null);
  createRoomDecision(roomId, {
    title: apply.exitCode === 0 ? "Merge applied" : "Merge failed",
    status: apply.exitCode === 0 ? "approved" : "open",
    payload: { runId, status, message: apply.stderr || null },
    resolvedAt: apply.exitCode === 0 ? new Date().toISOString() : null,
  });
  return { run: agentRunFromRow(run), ok: apply.exitCode === 0, message: apply.stderr || undefined };
}

function startRoomTaskRun(roomId: string, taskId: string) {
  const room = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!room) throw new Error("room_not_found");
  const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(taskId, roomId) as Record<string, unknown> | undefined;
  if (!task) throw new Error("room_task_not_found");
  const taskStatus = String(task.status);
  if (taskStatus === "running" || taskStatus === "done") throw new Error("room_task_not_startable");
  if (task.depends_on_task_id) {
    const dependency = db.prepare("select status from room_tasks where id = ? and room_id = ?").get(String(task.depends_on_task_id), roomId) as { status?: string } | undefined;
    if (dependency?.status !== "done") throw new Error("room_task_dependency_pending");
  }
  const assignedAgentId = task.assigned_agent_id ? String(task.assigned_agent_id) : "";
  if (!assignedAgentId) throw new Error("room_task_unassigned");
  const membership = db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(roomId, assignedAgentId);
  if (!membership) throw new Error("room_agent_not_member");
  const agentRow = db.prepare("select * from agents where id = ?").get(assignedAgentId) as Record<string, unknown> | undefined;
  if (!agentRow) throw new Error("agent_not_found");
  const agent = agentFromRow(agentRow);
  if (!agent.enabled) throw new Error("agent_disabled");
  const group = room.group_id ? db.prepare("select * from agent_groups where id = ?").get(String(room.group_id)) as Record<string, unknown> | undefined : undefined;
  if (group) {
    const runningRoomCount = db.prepare("select count(*) as count from agent_runs where room_id = ? and status = 'running'").get(roomId) as { count: number } | undefined;
    const maxConcurrentAgents = Math.max(1, Number(group.max_concurrent_agents ?? 1) || 1);
    if ((runningRoomCount?.count ?? 0) >= maxConcurrentAgents) throw new Error("room_concurrency_limit");
  }
  const runningCount = db.prepare("select count(*) as count from agent_runs where agent_id = ? and status = 'running'").get(agent.id) as { count: number } | undefined;
  if ((runningCount?.count ?? 0) >= agent.maxConcurrentRuns) throw new Error("agent_concurrency_limit");
  const roleRow = db.prepare("select * from agent_roles where id = ?").get(agent.roleId) as Record<string, unknown> | undefined;
  if (!roleRow) throw new Error("agent_role_not_found");
  const role = agentRoleFromRow(roleRow);
  const provider = agent.providerId ? appData.providers.find((item) => item.id === agent.providerId) : appData.providers[0];
  const selectedModel = agent.model ?? provider?.defaultModel ?? null;
  const workspace = ensureRoomRunWorkspace(room, agent, taskId);
  const workspaceContext = [
    "Room/project workspace map:",
    room.project_id ? `- bound project id: ${String(room.project_id)}` : "- bound project: none. This is a no-project Room.",
    workspace.projectPath ? `- bound project directory: ${workspace.projectPath}` : "",
    `- current agent working directory: ${workspace.agentWorkspace}`,
    workspace.projectPath && resolve(workspace.agentWorkspace) !== resolve(workspace.projectPath)
      ? "- current agent working directory is an isolated git worktree for the bound project. Treat this worktree as the project workspace for code changes."
      : "",
    !room.project_id
      ? "- no real project directory is bound to this Room. Treat the current agent working directory as a scratch workspace, not as the Codex Web source repository."
      : "",
    room.project_id && !workspace.projectPath
      ? "- the bound project could not be mounted as an independent git worktree. Treat the current agent working directory as a fallback scratch workspace."
      : "",
    `- room shared workspace: ${workspace.shared}`,
    "- Use the current agent working directory for files you create or edit. Use the room shared workspace only for shared notes, plans, reports, handoffs, and decisions.",
    "- Do not treat any ancestor directory or parent Git repository as the project unless it is explicitly listed above as the bound project directory.",
  ].filter(Boolean).join("\n");
  const existingThread = readRoomAgentThread(roomId, agent.id);
  const existingThreadId = existingThread && (!existingThread.workspacePath || resolve(existingThread.workspacePath) === resolve(workspace.agentWorkspace)) ? existingThread.codexSessionId : null;
  const skippedThreadReason = existingThread && !existingThreadId ? `Previous Codex thread ${existingThread.codexSessionId} used workspace ${existingThread.workspacePath}; this run uses ${workspace.agentWorkspace}, so a new thread is started to avoid cwd confusion.` : "";
  const now = new Date().toISOString();
  const sessionId = `task-${randomUUID()}`;
  const session: SessionSummary = {
    id: sessionId,
    kind: room.project_id ? "project" : "scratch",
    conversationType: "agent",
    roomId,
    title: `${agent.name}: ${String(task.title)}`.slice(0, 80),
    projectId: room.project_id ? String(room.project_id) : null,
    workspacePath: workspace.agentWorkspace,
    providerId: provider?.id ?? null,
    model: selectedModel,
    codexSessionId: existingThreadId,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions.unshift(session);
  upsertSession(session);
  const runId = `agent-run-${randomUUID()}`;
  const taskGoal = task.goal_item_id
    ? db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined
    : null;
  db.prepare(`
    insert into agent_runs (id, room_id, agent_id, task_id, goal_id, session_id, status, provider_id, model, workspace_path, started_at)
    values (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(runId, roomId, agent.id, taskId, taskGoal?.goal_id ?? null, sessionId, provider?.id ?? null, selectedModel, workspace.agentWorkspace, now);
  db.prepare("update room_tasks set status = 'running', started_at = ?, updated_at = ? where id = ?").run(now, now, taskId);
  setRoomParentSessionStatus(roomId, "running", now);
  roomEvent(roomId, "agent.started", { runId, taskId, sessionId }, null, agent.id);
  const prompt = [
    role.systemPrompt,
    agent.extraPrompt ? `\n\nAgent extra instructions:\n${agent.extraPrompt}` : "",
    groupContextForRoom(room),
    room.shared_context ? `Room shared context:\n${String(room.shared_context)}` : "",
    recentRoomContext(roomId),
    skippedThreadReason,
    `\n\n${workspaceContext}`,
    `\n\nTask:\n${String(task.prompt)}`,
  ].filter(Boolean).join("\n");
  deleteSessionMessages(session.id);
  const userMessage = appendSessionMessage(session.id, "user", String(task.prompt));
  startCodexTask(session, prompt, workspace.agentWorkspace, provider, selectedModel, !existingThreadId, [workspace.shared], {
    sourceType: "room-task",
    agentId: agent.id,
    roomId,
    createdBy: "system",
    permissionProfileId: agent.permissionProfileId ?? null,
    resolvedPermissions: resolvedAgentPermissions(agent),
    currentMessageId: userMessage.id,
  });
  return { run: agentRunFromRow(db.prepare("select * from agent_runs where id = ?").get(runId) as Record<string, unknown>), session };
}

function recordProviderHealthCheck(providerId: string, kind: ProviderHealthCheck["kind"], result: ProviderTestResponse | ProviderModelsResponse) {
  db.prepare(`
    insert into provider_health_checks (id, provider_id, kind, ok, status, duration_ms, error, checked_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `provider-check-${randomUUID()}`,
    providerId,
    kind,
    result.ok ? 1 : 0,
    result.status,
    result.durationMs,
    result.error ?? null,
    new Date().toISOString(),
  );
}

const notificationChannels: NotificationChannelDefinition[] = [
  { id: "webhook", kind: "webhook", adapter: "webhook", authType: "none", name: "Webhook", description: "Send a JSON or templated HTTP request.", builtin: true, method: "POST", accountFields: ["url"] },
  {
    id: "bark",
    kind: "webhook",
    adapter: "webhook",
    authType: "none",
    name: "Bark",
    description: "Send iOS push notifications through a Bark-compatible webhook endpoint.",
    builtin: true,
    method: "POST",
    urlTemplate: "{{serverUrl}}/push",
    bodyTemplate: JSON.stringify({
      device_key: "{{deviceKey}}",
      title: "{{title}}",
      body: "{{message}}",
      group: "{{group}}",
      sound: "{{sound}}",
      icon: "{{icon}}",
      url: "{{url}}",
    }),
    accountFields: ["serverUrl", "deviceKey", "group", "sound", "icon", "url"],
  },
  { id: "email", kind: "email", adapter: "email", authType: "none", name: "Email SMTP", description: "Send email through an SMTP sender account.", builtin: true, accountFields: ["host", "port", "username", "password", "fromEmail"] },
  { id: "telegram", kind: "telegram", adapter: "telegram", authType: "none", name: "Telegram Bot", description: "Send Telegram messages through a bot token.", builtin: true, accountFields: ["botToken", "proxyUrl"] },
];
const notificationSeverityRank: Record<NotificationSeverity, number> = { info: 0, success: 1, warning: 2, error: 3 };
const notificationEventTypes: NotificationEventType[] = ["task_completed", "task_failed", "task_interrupted", "needs_approval", "task_health_issue", "provider_check_failed", "backup_failed", "restore_failed", "auth_login"];

type NotificationAccountRecord = NotificationAccountSummary;
type NotificationEventInput = {
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
};

function notificationChannelFromRow(row: Record<string, unknown>): NotificationChannelDefinition {
  return {
    id: String(row.id),
    kind: String(row.kind) as NotificationChannelKind,
    adapter: String(row.adapter ?? "webhook") as NotificationChannelAdapter,
    authType: String(row.auth_type ?? "none") as NotificationChannelAuthType,
    name: String(row.name),
    description: String(row.description ?? ""),
    builtin: Boolean(row.builtin),
    method: String(row.method ?? "POST"),
    urlTemplate: String(row.url_template ?? ""),
    headersTemplate: String(row.headers_template ?? ""),
    bodyTemplate: String(row.body_template ?? ""),
    accountFields: parseJsonValue<string[]>(row.account_fields, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function listNotificationChannels() {
  const custom = (db.prepare("select * from notification_channels order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map(notificationChannelFromRow);
  return [...notificationChannels, ...custom];
}

function getNotificationChannel(id?: string | null) {
  if (!id) return null;
  return notificationChannels.find((channel) => channel.id === id)
    ?? ((db.prepare("select * from notification_channels where id = ?").get(id) as Record<string, unknown> | undefined) ? notificationChannelFromRow(db.prepare("select * from notification_channels where id = ?").get(id) as Record<string, unknown>) : null);
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function publicNotificationConfig(kind: NotificationAccountSummary["channelKind"], config: Record<string, unknown>) {
  const copy: Record<string, unknown> = { ...config };
  for (const key of ["password", "deviceKey", "token", "secret", "botToken", "corpSecret", "accessToken", "bearerToken"]) {
    if (copy[key]) copy[key] = "********";
  }
  if (kind === "webhook" && copy.headers && typeof copy.headers === "object") {
    copy.headers = Object.fromEntries(Object.entries(copy.headers as Record<string, unknown>).map(([key, value]) => [
      key,
      /authorization|token|secret|key/i.test(key) && value ? "********" : value,
    ]));
  }
  return copy;
}

function sanitizeNotificationPermissions(input?: NotificationPermissionPolicy | Record<string, unknown> | null): NotificationPermissionPolicy {
  const list = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return {
    allowedAgentIds: list(input?.allowedAgentIds),
    allowedRoomIds: list(input?.allowedRoomIds),
    allowedProjectIds: list(input?.allowedProjectIds),
  };
}

function notificationAccountFromRow(row: Record<string, unknown>, exposeSecrets = false): NotificationAccountRecord {
  const channelKind = notificationChannels.some((channel) => channel.kind === row.channel_kind) ? row.channel_kind as NotificationAccountSummary["channelKind"] : "webhook";
  const config = parseJsonValue<Record<string, unknown>>(row.config, {});
  return {
    id: String(row.id),
    name: String(row.name),
    channelId: row.channel_id ? String(row.channel_id) : null,
    channelKind,
    enabled: Boolean(row.enabled),
    config: exposeSecrets ? config : publicNotificationConfig(channelKind, config),
    permissions: sanitizeNotificationPermissions(parseJsonValue<NotificationPermissionPolicy>(row.permissions, {})),
    lastTestStatus: row.last_test_status ? String(row.last_test_status) as NotificationDeliveryStatus : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function notificationRecipientFromRow(row: Record<string, unknown>, exposeSecrets = false): NotificationRecipientSummary {
  const kind = ["email", "webhook", "bark", "telegram"].includes(String(row.kind)) ? String(row.kind) as NotificationRecipientSummary["kind"] : "webhook";
  const config = parseJsonValue<Record<string, unknown>>(row.config, {});
  return {
    id: String(row.id),
    name: String(row.name),
    kind,
    enabled: Boolean(row.enabled),
    senderAccountId: row.sender_account_id ? String(row.sender_account_id) : null,
    channelId: row.channel_id ? String(row.channel_id) : null,
    config: exposeSecrets ? config : publicNotificationConfig(kind === "email" ? "email" : kind === "bark" ? "bark" : kind === "telegram" ? "telegram" : "webhook", config),
    permissions: sanitizeNotificationPermissions(parseJsonValue<NotificationPermissionPolicy>(row.permissions, {})),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function notificationRuleFromRow(row: Record<string, unknown>): NotificationRuleSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    eventTypes: parseJsonValue<NotificationEventType[]>(row.event_types, []).filter((type) => notificationEventTypes.includes(type)),
    minSeverity: notificationSeverityRank[String(row.min_severity) as NotificationSeverity] !== undefined ? String(row.min_severity) as NotificationSeverity : "info",
    targets: sanitizeNotificationTargets(parseJsonValue<NotificationRuleTarget[]>(row.targets, [])),
    dedupeMinutes: Math.max(0, Number(row.dedupe_minutes) || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function notificationDeliveryFromRow(row: Record<string, unknown>): NotificationDeliverySummary {
  return {
    id: String(row.id),
    ruleId: row.rule_id ? String(row.rule_id) : null,
    accountId: row.account_id ? String(row.account_id) : null,
    eventType: String(row.event_type) as NotificationEventType,
    severity: String(row.severity) as NotificationSeverity,
    title: String(row.title),
    message: String(row.message),
    status: String(row.status) as NotificationDeliveryStatus,
    attempts: Number(row.attempts) || 0,
    responseStatus: row.response_status === null || row.response_status === undefined ? null : Number(row.response_status),
    lastError: row.last_error ? String(row.last_error) : null,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata, {}),
    createdAt: String(row.created_at),
    sentAt: row.sent_at ? String(row.sent_at) : null,
  };
}

function notificationEphemeralRuleFromRow(row: Record<string, unknown>): NotificationEphemeralRuleSummary {
  return {
    id: String(row.id),
    scopeType: String(row.scope_type) as NotificationEphemeralRuleSummary["scopeType"],
    scopeId: String(row.scope_id),
    eventTypes: parseJsonValue<NotificationEventType[]>(row.event_types, []).filter((type) => notificationEventTypes.includes(type)),
    targets: sanitizeNotificationTargets(parseJsonValue<NotificationRuleTarget[]>(row.targets, [])),
    enabled: Boolean(row.enabled),
    expireMode: String(row.expire_mode) as NotificationEphemeralRuleSummary["expireMode"],
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    triggeredAt: row.triggered_at ? String(row.triggered_at) : null,
  };
}

function appNotificationFromRow(row: Record<string, unknown>): AppNotificationSummary {
  return {
    id: String(row.id),
    eventType: String(row.event_type) as NotificationEventType,
    severity: String(row.severity) as NotificationSeverity,
    title: String(row.title),
    message: String(row.message),
    sourceType: row.source_type ? String(row.source_type) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata, {}),
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  };
}

function createAppNotification(event: NotificationEventInput) {
  const id = `app-notification-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(`
    insert into app_notifications (id, event_type, severity, title, message, source_type, source_id, metadata, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.eventType,
    event.severity,
    event.title,
    event.message,
    event.sourceType ?? null,
    event.sourceId ?? null,
    JSON.stringify(event.metadata ?? {}),
    createdAt,
  );
  const notification = appNotificationFromRow(db.prepare("select * from app_notifications where id = ?").get(id) as Record<string, unknown>);
  publishAppNotificationEvent({ type: "notification", notification, unreadCount: appNotificationUnreadCount() });
  return notification;
}

function listAppNotifications(limit = 30): AppNotificationsResponse {
  const rows = db.prepare(`
    select * from app_notifications
    order by created_at desc, id desc
    limit ?
  `).all(Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
  const unread = db.prepare("select count(*) as count from app_notifications where read_at is null").get() as { count?: number } | undefined;
  return {
    items: rows.map(appNotificationFromRow),
    unreadCount: unread?.count ?? 0,
  };
}

function appNotificationUnreadCount() {
  const row = db.prepare("select count(*) as count from app_notifications where read_at is null").get() as { count?: number } | undefined;
  return row?.count ?? 0;
}

function publishAppNotificationEvent(event: AppNotificationStreamEvent) {
  for (const subscriber of [...appNotificationSubscribers]) {
    try {
      subscriber(event);
    } catch {
      appNotificationSubscribers.delete(subscriber);
    }
  }
}

function publishAppNotificationsSnapshot() {
  publishAppNotificationEvent({ type: "snapshot", ...listAppNotifications(30) });
}

function subscribeAppNotifications(subscriber: (event: AppNotificationStreamEvent) => void) {
  appNotificationSubscribers.add(subscriber);
  return () => appNotificationSubscribers.delete(subscriber);
}

function listNotificationAccounts(exposeSecrets = false) {
  return (db.prepare("select * from notification_accounts order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map((row) => notificationAccountFromRow(row, exposeSecrets));
}

function listNotificationRecipients(exposeSecrets = false) {
  return (db.prepare("select * from notification_recipients order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map((row) => notificationRecipientFromRow(row, exposeSecrets));
}

function listAllNotificationRules() {
  return (db.prepare("select * from notification_rules order by updated_at desc, id desc").all() as Array<Record<string, unknown>>).map(notificationRuleFromRow);
}

function listNotificationRules(limit = 50, cursorValue?: string | null, filters: { enabled?: boolean } = {}) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(filters.enabled === undefined ? [] : ["enabled = @enabled"]),
    ...(cursor ? ["(updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from notification_rules
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ enabled: filters.enabled === undefined ? undefined : filters.enabled ? 1 : 0, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(notificationRuleFromRow), limit, (item) => item.updatedAt);
}

function listNotificationEphemeralRules(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from notification_ephemeral_rules
    ${cursor ? "where (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(notificationEphemeralRuleFromRow), limit, (item) => item.createdAt);
}

function createNotificationEphemeralRule(input: {
  scopeType?: "session" | "task" | "room_task";
  scopeId?: string;
  eventTypes?: NotificationEventType[];
  targets?: NotificationRuleTarget[];
  expireMode?: "after_trigger" | "session_end" | "manual";
}) {
  const scopeType = input.scopeType === "task" || input.scopeType === "room_task" ? input.scopeType : "session";
  const scopeId = input.scopeId?.trim();
  const eventTypes = (input.eventTypes ?? []).filter((type) => notificationEventTypes.includes(type));
  const targets = sanitizeNotificationTargets(input.targets ?? []);
  const expireMode = input.expireMode === "session_end" || input.expireMode === "manual" ? input.expireMode : "after_trigger";
  if (!scopeId || !eventTypes.length || !targets.length) return null;
  const id = `notification-ephemeral-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    insert into notification_ephemeral_rules (id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at)
    values (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, scopeType, scopeId, JSON.stringify(eventTypes), JSON.stringify(targets), expireMode, now);
  return {
    id,
    scopeType,
    scopeId,
    eventTypes,
    targets,
    enabled: true,
    expireMode,
    createdAt: now,
  } satisfies NotificationEphemeralRuleSummary;
}

function listNotificationDeliveries(limit = 50, cursorValue?: string | null, filters: { eventType?: NotificationEventType; status?: NotificationDeliveryStatus; severity?: NotificationSeverity } = {}) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(filters.eventType ? ["event_type = @eventType"] : []),
    ...(filters.status ? ["status = @status"] : []),
    ...(filters.severity ? ["severity = @severity"] : []),
    ...(cursor ? ["(created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from notification_deliveries
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ eventType: filters.eventType, status: filters.status, severity: filters.severity, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(notificationDeliveryFromRow), limit, (item) => item.createdAt);
}

function sanitizeNotificationConfig(kind: NotificationAccountSummary["channelKind"], input?: Record<string, unknown>, previous?: Record<string, unknown>) {
  const config = input ?? {};
  const list = (value: unknown) => Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (kind === "email") {
    const password = String(config.password ?? "").trim();
    return {
      host: String(config.host ?? previous?.host ?? "").trim(),
      port: Number(config.port ?? previous?.port ?? 587) || 587,
      secure: config.secure === true,
      username: String(config.username ?? previous?.username ?? "").trim(),
      password: password && password !== "********" ? password : String(previous?.password ?? ""),
      fromName: String(config.fromName ?? previous?.fromName ?? "Codex Web").trim(),
      fromEmail: String(config.fromEmail ?? previous?.fromEmail ?? "").trim(),
      testEmailTo: list(config.testEmailTo ?? previous?.testEmailTo),
    };
  }
  if (kind === "telegram") {
    const botToken = String(config.botToken ?? "").trim();
    return {
      botToken: botToken && botToken !== "********" ? botToken : String(previous?.botToken ?? ""),
      proxyUrl: String(config.proxyUrl ?? previous?.proxyUrl ?? "").trim(),
      inboundEnabled: config.inboundEnabled === true,
      allowedChatIds: list(config.allowedChatIds ?? previous?.allowedChatIds),
      allowedUserIds: list(config.allowedUserIds ?? previous?.allowedUserIds),
      defaultSessionId: String(config.defaultSessionId ?? previous?.defaultSessionId ?? "").trim(),
      testChatId: String(config.testChatId ?? previous?.testChatId ?? "").trim(),
    };
  }
  if (kind === "bark") {
    const deviceKey = String(config.deviceKey ?? "").trim();
    return {
      serverUrl: String(config.serverUrl ?? previous?.serverUrl ?? "https://api.day.app").trim(),
      deviceKey: deviceKey && deviceKey !== "********" ? deviceKey : String(previous?.deviceKey ?? ""),
      sound: String(config.sound ?? previous?.sound ?? "").trim(),
      group: String(config.group ?? previous?.group ?? "Codex Web").trim(),
      icon: String(config.icon ?? previous?.icon ?? "").trim(),
      url: String(config.url ?? previous?.url ?? "").trim(),
    };
  }
  return {
    url: String(config.url ?? previous?.url ?? "").trim(),
    method: String(config.method ?? previous?.method ?? "POST").trim().toUpperCase() || "POST",
    headers: typeof config.headers === "object" && config.headers && !Array.isArray(config.headers) ? config.headers : previous?.headers ?? {},
    bodyTemplate: String(config.bodyTemplate ?? previous?.bodyTemplate ?? "").trim(),
  };
}

function sanitizeNotificationTargets(targets?: NotificationRuleTarget[]) {
  return (targets ?? [])
    .map((target) => ({
      accountId: target.accountId ? String(target.accountId).trim() : undefined,
      recipientId: target.recipientId ? String(target.recipientId).trim() : undefined,
      senderAccountId: target.senderAccountId ? String(target.senderAccountId).trim() : undefined,
      chatId: target.chatId ? String(target.chatId).trim() : undefined,
      emailTo: Array.isArray(target.emailTo) ? target.emailTo.map((item) => String(item).trim()).filter(Boolean) : undefined,
    }))
    .filter((target) => target.accountId || target.recipientId);
}

function renderNotificationTemplate(template: string, event: NotificationEventInput, extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    ...extra,
    title: event.title,
    message: event.message,
    severity: event.severity,
    eventType: event.eventType,
    sourceType: event.sourceType ?? "",
    sourceId: event.sourceId ?? "",
    createdAt: new Date().toISOString(),
    metadata: event.metadata ?? {},
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, values);
    return value === undefined || value === null ? "" : String(value);
  });
}

function parseNotificationHeaders(template: string, event: NotificationEventInput, extra: Record<string, unknown>) {
  return Object.fromEntries(String(template ?? "").split("\n").map((line) => {
    const rendered = renderNotificationTemplate(line, event, extra);
    const index = rendered.indexOf(":");
    return index > 0 ? [rendered.slice(0, index).trim(), rendered.slice(index + 1).trim()] : ["", ""];
  }).filter(([key]) => key));
}

function normalizeWebhookConfig(config: Record<string, unknown>) {
  const copy = { ...config };
  if (copy.serverUrl) copy.serverUrl = String(copy.serverUrl).replace(/\/+$/, "");
  if (!copy.serverUrl && copy.deviceKey) copy.serverUrl = "https://api.day.app";
  if (!copy.group) copy.group = "Codex Web";
  return copy;
}

async function sendWebhookNotification(channel: NotificationChannelDefinition | null, config: Record<string, unknown>, event: NotificationEventInput) {
  const webhookConfig = normalizeWebhookConfig(config);
  const method = String(channel?.method ?? webhookConfig.method ?? "POST").toUpperCase();
  const headers = {
    "content-type": "application/json",
    ...(typeof webhookConfig.headers === "object" && webhookConfig.headers ? webhookConfig.headers as Record<string, string> : {}),
    ...parseNotificationHeaders(channel?.headersTemplate ?? "", event, webhookConfig),
  };
  const urlTemplate = channel?.urlTemplate || String(webhookConfig.url ?? "");
  if (!urlTemplate.trim()) throw new Error("webhook_url_required");
  const renderedUrl = new URL(renderNotificationTemplate(urlTemplate, event, webhookConfig));
  if (channel?.authType === "bearer") {
    const token = String(webhookConfig.token ?? webhookConfig.accessToken ?? webhookConfig.bearerToken ?? "").trim();
    if (!token) throw new Error("webhook_bearer_token_required");
    headers.authorization = `Bearer ${token}`;
  }
  if (channel?.authType === "query_token") {
    const token = String(webhookConfig.token ?? webhookConfig.accessToken ?? "").trim();
    if (!token) throw new Error("webhook_query_token_required");
    renderedUrl.searchParams.set(String(webhookConfig.tokenParam ?? "access_token"), token);
  }
  if (channel?.authType === "token_request") {
    throw new Error("webhook_token_request_auth_not_configured");
  }
  const bodyTemplate = channel?.bodyTemplate || String(webhookConfig.bodyTemplate ?? "") || JSON.stringify(event);
  const init: RequestInit = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD") init.body = renderNotificationTemplate(bodyTemplate, event, webhookConfig);
  const response = await fetch(renderedUrl.toString(), init);
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(text.slice(0, 500) || `webhook_http_${response.status}`);
  if (channel?.id === "bark" && text && /"code"\s*:\s*(?!200\b)\d+/i.test(text)) throw new Error(text.slice(0, 500) || `bark_http_${response.status}`);
  return { responseStatus: response.status };
}

async function sendNotificationToAccount(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget) {
  const config = account.config;
  const customChannel = account.channelId ? getNotificationChannel(account.channelId) : null;
  if (account.channelKind === "webhook" && customChannel?.id && customChannel.id !== "webhook") return sendWebhookNotification(customChannel, config, event);
  if (account.channelKind === "email") {
    const to = target?.emailTo?.length ? target.emailTo : [];
    if (!to.length) throw new Error("email_recipients_required");
    if (!config.host || !config.fromEmail) throw new Error("email_smtp_config_required");
    const transporter = nodemailer.createTransport({
      host: String(config.host),
      port: Number(config.port) || 587,
      secure: config.secure === true,
      auth: config.username || config.password ? { user: String(config.username ?? ""), pass: String(config.password ?? "") } : undefined,
    });
    await transporter.sendMail({
      from: config.fromName ? `"${String(config.fromName).replace(/"/g, "'")}" <${String(config.fromEmail)}>` : String(config.fromEmail),
      to,
      subject: event.title,
      text: `${event.message}\n\n事件：${event.eventType}\n等级：${event.severity}`,
    });
    return { responseStatus: null };
  }
  if (account.channelKind === "telegram") {
    if (!config.botToken) throw new Error("telegram_bot_token_required");
    if (!target?.chatId) throw new Error("telegram_chat_id_required");
    const response = await telegramBotApi(account, "sendMessage", {
      chat_id: target.chatId,
      text: `${event.title}\n\n${event.message}`,
      disable_web_page_preview: true,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(text.slice(0, 500) || `telegram_http_${response.status}`);
    return { responseStatus: response.status };
  }
  if (account.channelKind === "bark") return sendWebhookNotification(getNotificationChannel("bark"), config, event);
  return sendWebhookNotification(customChannel, config, event);
}

function telegramApiBase(account: NotificationAccountRecord) {
  const config = account.config as Record<string, unknown>;
  const proxyUrl = String(config.proxyUrl ?? "").trim();
  return (proxyUrl || "https://api.telegram.org").replace(/\/+$/, "");
}

async function telegramBotApi(account: NotificationAccountRecord, method: string, payload: Record<string, unknown>) {
  const config = account.config as Record<string, unknown>;
  if (!config.botToken) throw new Error("telegram_bot_token_required");
  return fetch(`${telegramApiBase(account)}/bot${String(config.botToken)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
  });
}

async function syncTelegramBotCommands(account: NotificationAccountRecord) {
  if (account.channelKind !== "telegram") return;
  const config = account.config as Record<string, unknown>;
  if (!config.botToken || config.botToken === "********") return;
  if (account.enabled && config.inboundEnabled === true) {
    await telegramBotApi(account, "setMyCommands", {
      commands: [
        { command: "start", description: "Show bot help" },
        { command: "sessions", description: "List recent sessions" },
        { command: "agents", description: "List agents" },
        { command: "rooms", description: "List rooms" },
        { command: "files", description: "Browse files" },
        { command: "terminal", description: "Run a terminal command" },
        { command: "bind", description: "Bind this chat to a session" },
        { command: "unbind", description: "Clear the bound session" },
        { command: "send", description: "Send a message to a session" },
        { command: "help", description: "Show help" },
      ],
    });
    await telegramBotApi(account, "setChatMenuButton", {
      menu_button: { type: "commands" },
    });
    return;
  }
  await telegramBotApi(account, "deleteMyCommands", {});
  await telegramBotApi(account, "setChatMenuButton", {
    menu_button: { type: "default" },
  });
}

function notificationDeliveryMetadata(account: NotificationAccountRecord, event: NotificationEventInput, target?: NotificationRuleTarget, recipient?: NotificationRecipientSummary) {
  return {
    eventMetadata: event.metadata ?? {},
    sourceType: event.sourceType ?? null,
    sourceId: event.sourceId ?? null,
    target: target ? {
      accountId: target.accountId ?? null,
      recipientId: target.recipientId ?? null,
      senderAccountId: target.senderAccountId ?? null,
      chatId: target.chatId ?? null,
      emailToCount: target.emailTo?.length ?? 0,
      emailTo: target.emailTo ?? [],
    } : null,
    account: {
      id: account.id,
      name: account.name,
      kind: account.channelKind,
      channelId: account.channelId ?? null,
    },
    recipient: recipient ? {
      id: recipient.id,
      name: recipient.name,
      kind: recipient.kind,
      senderAccountId: recipient.senderAccountId ?? null,
      channelId: recipient.channelId ?? null,
    } : null,
  };
}

async function deliverNotification(account: NotificationAccountRecord, event: NotificationEventInput, ruleId: string | null, target?: NotificationRuleTarget, recipient?: NotificationRecipientSummary) {
  const id = `notification-delivery-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(`
    insert into notification_deliveries (id, rule_id, account_id, event_type, severity, title, message, status, attempts, metadata, created_at)
    values (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(id, ruleId, account.id, event.eventType, event.severity, event.title, event.message, JSON.stringify(notificationDeliveryMetadata(account, event, target, recipient)), createdAt);
  try {
    const result = await sendNotificationToAccount(account, event, target);
    db.prepare("update notification_deliveries set status = 'sent', attempts = 1, response_status = ?, sent_at = ? where id = ?").run(result.responseStatus ?? null, new Date().toISOString(), id);
    return true;
  } catch (error) {
    db.prepare("update notification_deliveries set status = 'failed', attempts = 1, last_error = ? where id = ?").run(error instanceof Error ? error.message : String(error), id);
    return false;
  }
}

function chooseEmailNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const emailSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "email");
  return (target?.senderAccountId ? emailSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? emailSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (emailSenders.length === 1 ? emailSenders[0] : null);
}

function chooseTelegramNotificationSender(recipient: NotificationRecipientSummary, target?: NotificationRuleTarget) {
  const telegramSenders = listNotificationAccounts(true).filter((account) => account.enabled && account.channelKind === "telegram");
  return (target?.senderAccountId ? telegramSenders.find((account) => account.id === target.senderAccountId) : null)
    ?? (recipient.senderAccountId ? telegramSenders.find((account) => account.id === recipient.senderAccountId) : null)
    ?? (telegramSenders.length === 1 ? telegramSenders[0] : null);
}

async function deliverNotificationToRecipient(recipient: NotificationRecipientSummary, event: NotificationEventInput, ruleId: string | null, target?: NotificationRuleTarget) {
  if (recipient.kind === "email") {
    const sender = chooseEmailNotificationSender(recipient, target);
    if (!sender) throw new Error("email_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, emailTo: [String(recipient.config.email ?? "")].filter(Boolean) }, recipient);
  }
  if (recipient.kind === "telegram") {
    const sender = chooseTelegramNotificationSender(recipient, target);
    if (!sender) throw new Error("telegram_sender_required");
    return deliverNotification(sender, event, ruleId, { recipientId: recipient.id, accountId: sender.id, chatId: String(recipient.config.chatId ?? "") }, recipient);
  }
  const account: NotificationAccountRecord = {
    id: recipient.id,
    name: recipient.name,
    channelId: recipient.channelId ?? null,
    channelKind: "webhook",
    enabled: recipient.enabled,
    config: recipient.config,
    createdAt: recipient.createdAt,
    updatedAt: recipient.updatedAt,
  };
  return deliverNotification(account, event, ruleId, { recipientId: recipient.id, accountId: account.id }, recipient);
}

function notificationRecentlyDelivered(ruleId: string, accountId: string, eventType: NotificationEventType, dedupeMinutes: number) {
  if (dedupeMinutes <= 0) return false;
  const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
  return Boolean(db.prepare(`
    select id from notification_deliveries
    where rule_id = ? and account_id = ? and event_type = ? and created_at >= ? and status in ('sent', 'pending')
    limit 1
  `).get(ruleId, accountId, eventType, since));
}

function notificationEventTypesFromPrompt(prompt: string): NotificationEventType[] {
  const text = prompt.toLowerCase();
  if (/审批|批准|确认|approval/.test(text)) return ["needs_approval"];
  if (/失败|报错|错误|fail|error/.test(text)) return ["task_failed"];
  return ["task_completed"];
}

function registerEphemeralNotificationsFromPrompt(session: SessionSummary, prompt: string) {
  const text = prompt.trim();
  if (!/通知|提醒|notify/i.test(text)) return;
  const recipients = listNotificationRecipients(true).filter((recipient) => recipient.enabled);
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  const matched = recipients.filter((recipient) => {
    const name = recipient.name.toLowerCase().replace(/\s+/g, "");
    return name && normalized.includes(name);
  });
  const targets = (matched.length ? matched : recipients.length === 1 ? recipients : [])
    .map((recipient) => ({ recipientId: recipient.id }));
  if (!targets.length) return;
  const now = new Date().toISOString();
  db.prepare(`
    insert into notification_ephemeral_rules (id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at)
    values (?, 'session', ?, ?, ?, 1, 'after_trigger', ?)
  `).run(
    `notification-ephemeral-${randomUUID()}`,
    session.id,
    JSON.stringify(notificationEventTypesFromPrompt(text)),
    JSON.stringify(targets),
    now,
  );
}

function notificationScopesForEvent(event: NotificationEventInput) {
  const scopes: Array<{ scopeType: "session" | "task" | "room_task"; scopeId: string }> = [];
  if (event.sourceType === "session" && event.sourceId) scopes.push({ scopeType: "session", scopeId: event.sourceId });
  const metadataScopes = Array.isArray(event.metadata?.notificationScopes) ? event.metadata.notificationScopes : [];
  for (const item of metadataScopes) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const scopeType = record.scopeType === "session" || record.scopeType === "task" || record.scopeType === "room_task" ? record.scopeType : null;
    const scopeId = typeof record.scopeId === "string" && record.scopeId.trim() ? record.scopeId.trim() : "";
    if (scopeType && scopeId) scopes.push({ scopeType, scopeId });
  }
  return Array.from(new Map(scopes.map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope])).values());
}

function listEphemeralNotificationRulesForEvent(event: NotificationEventInput) {
  const scopes = notificationScopesForEvent(event);
  if (!scopes.length) return [];
  const rows = scopes.flatMap((scope) => db.prepare(`
    select * from notification_ephemeral_rules
    where enabled = 1 and scope_type = ? and scope_id = ?
    order by created_at asc
  `).all(scope.scopeType, scope.scopeId) as Array<Record<string, unknown>>);
  return rows
    .map((row) => ({
      id: String(row.id),
      scopeType: String(row.scope_type),
      scopeId: String(row.scope_id),
      eventTypes: parseJsonValue<NotificationEventType[]>(row.event_types, []).filter((type) => notificationEventTypes.includes(type)),
      targets: sanitizeNotificationTargets(parseJsonValue<NotificationRuleTarget[]>(row.targets, [])),
      expireMode: String(row.expire_mode),
    }))
    .filter((rule) => rule.eventTypes.includes(event.eventType) && rule.targets.length);
}

async function createExternalNotification(event: NotificationEventInput) {
  const accounts = new Map(listNotificationAccounts(true).filter((account) => account.enabled).map((account) => [account.id, account]));
  const recipients = new Map(listNotificationRecipients(true).filter((recipient) => recipient.enabled).map((recipient) => [recipient.id, recipient]));
  const rules = listAllNotificationRules().filter((rule) =>
    rule.enabled
    && rule.eventTypes.includes(event.eventType)
    && notificationSeverityRank[event.severity] >= notificationSeverityRank[rule.minSeverity]
  );
  for (const rule of rules) {
    for (const target of rule.targets) {
      if (target.recipientId) {
        const recipient = recipients.get(target.recipientId);
        if (!recipient || notificationRecentlyDelivered(rule.id, recipient.id, event.eventType, rule.dedupeMinutes)) continue;
        void deliverNotificationToRecipient(recipient, event, rule.id, target).catch((error) => console.error("recipient notification failed", error));
        continue;
      }
      if (!target.accountId) continue;
      const account = accounts.get(target.accountId);
      if (!account || notificationRecentlyDelivered(rule.id, account.id, event.eventType, rule.dedupeMinutes)) continue;
      void deliverNotification(account, event, rule.id, target);
    }
  }
  for (const rule of listEphemeralNotificationRulesForEvent(event)) {
    for (const target of rule.targets) {
      if (!target.recipientId) continue;
      const recipient = recipients.get(target.recipientId);
      if (!recipient) continue;
      void deliverNotificationToRecipient(recipient, event, rule.id, target).catch((error) => console.error("ephemeral recipient notification failed", error));
    }
    if (rule.expireMode === "after_trigger") {
      db.prepare("update notification_ephemeral_rules set enabled = 0, triggered_at = ? where id = ?").run(new Date().toISOString(), rule.id);
    }
  }
}

function sessionNotificationsEnabled(session?: SessionSummary | null) {
  return session?.notificationsEnabled !== false;
}

function roomSessionForRoomId(roomId?: string | null) {
  if (!roomId) return null;
  const room = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  return room?.session_id ? appData.sessions.find((session) => session.id === room.session_id) ?? null : null;
}

function notificationsEnabledForEvent(event: NotificationEventInput) {
  const sourceSession = event.sourceType === "session" && event.sourceId
    ? appData.sessions.find((session) => session.id === event.sourceId)
    : null;
  if (sourceSession && !sessionNotificationsEnabled(sourceSession)) return false;
  const metadataRoomId = typeof event.metadata?.roomId === "string" ? event.metadata.roomId : null;
  const roomSession = roomSessionForRoomId(metadataRoomId ?? sourceSession?.roomId ?? null);
  if (roomSession && !sessionNotificationsEnabled(roomSession)) return false;
  return true;
}

function emitExternalNotification(event: NotificationEventInput) {
  if (!notificationsEnabledForEvent(event)) return;
  createAppNotification(event);
  void createExternalNotification(event).catch((error) => console.error("notification dispatch failed", error));
}

function automationRanInMinute(automationId: string, minuteKey: string) {
  const row = db.prepare(`
    select id from automation_runs
    where automation_id = ? and substr(started_at, 1, 16) = ?
    limit 1
  `).get(automationId, minuteKey) as Record<string, unknown> | undefined;
  return Boolean(row);
}

function shouldRunAutomationNow(automation: AutomationSummary, now = new Date()) {
  if (automation.status !== "active") return false;
  const schedule = automation.schedule.trim().toLowerCase();
  if (!schedule || schedule === "manual") return false;
  const minuteKey = now.toISOString().slice(0, 16);
  if (automationRanInMinute(automation.id, minuteKey)) return false;
  if (schedule === "hourly") return now.getMinutes() === 0;
  const daily = schedule.match(/^daily\s+([0-2]\d):([0-5]\d)$/);
  if (daily) return now.getHours() === Number(daily[1]) && now.getMinutes() === Number(daily[2]);
  return false;
}

function isValidAutomationSchedule(schedule: string) {
  const value = schedule.trim().toLowerCase();
  return value === "manual" || value === "hourly" || /^daily\s+[0-2]\d:[0-5]\d$/.test(value);
}

function runAutomationNow(automation: AutomationSummary) {
  const project = automation.projectId ? appData.projects.find((item) => item.id === automation.projectId) : null;
  const provider = automation.providerId
    ? appData.providers.find((item) => item.id === automation.providerId) ?? appData.providers[0]
    : appData.providers[0];
  const selectedModel = automation.model ?? provider?.defaultModel ?? null;
  const id = `task-${randomUUID()}`;
  const workspacePath = project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id);
  const session: SessionSummary = {
    id,
    kind: project ? "project" : "scratch",
    title: automation.name,
    projectId: project?.id ?? null,
    workspacePath,
    providerId: provider?.id ?? null,
    model: selectedModel,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  appData.sessions.unshift(session);
  const userMessage = appendSessionMessage(session.id, "user", automation.prompt);
  createAutomationRun(automation.id, session.id);
  saveAppData();
  startCodexTask(session, automation.prompt, workspacePath, provider, selectedModel, true, [], { currentMessageId: userMessage.id });
  return session;
}

function checkScheduledAutomations() {
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

function messageFromRow(row: Record<string, unknown>): SessionMessage {
  const replyToMessageId = row.reply_to_message_id ? String(row.reply_to_message_id) : null;
  const message: SessionMessage = {
    id: String(row.id),
    role: row.role as SessionMessage["role"],
    content: String(row.content),
    replyToMessageId,
    createdAt: String(row.created_at),
  };
  if (row.reply_id) {
    message.replyTo = {
      id: String(row.reply_id),
      role: row.reply_role as SessionMessage["role"],
      content: String(row.reply_content),
    };
  }
  return message;
}

function syncRoomMessagesToSession(session: SessionSummary) {
  if (session.conversationType !== "room" || !session.roomId) return;
  const rows = db.prepare(`
    select id, type, payload, created_at
    from room_events
    where room_id = ? and type in ('user.message', 'agent.message')
    order by created_at asc, id asc
  `).all(session.roomId) as Array<{ id: string; type: string; payload: string; created_at: string }>;
  const insert = db.prepare("insert or ignore into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, ?, ?, ?, ?)");
  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    if (!content) continue;
    const messageId = typeof payload.messageId === "string" && payload.messageId ? payload.messageId : `room-message-${row.id}`;
    const replyToMessageId = typeof payload.replyToMessageId === "string" ? payload.replyToMessageId : null;
    const result = insert.run(messageId, session.id, row.type === "agent.message" ? "assistant" : "user", content, replyToMessageId, row.created_at);
    if (row.type === "agent.message" && result.changes > 0) appendUrlCardsForMessage(session, messageId, content);
  }
}

function appendSessionMessage(sessionId: string, role: SessionMessage["role"], content: string, replyToMessageId?: string | null) {
  const message: SessionMessage = {
    id: randomUUID(),
    role,
    content,
    replyToMessageId: replyToMessageId ?? null,
    createdAt: new Date().toISOString(),
  };
  db.prepare("insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, ?, ?, ?, ?)").run(
    message.id,
    sessionId,
    role,
    content,
    message.replyToMessageId,
    message.createdAt,
  );
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session && role === "assistant") appendUrlCardsForMessage(session, message.id, content);
  return message;
}

function getSessionMessage(sessionId: string, messageId?: string | null) {
  if (!messageId) return null;
  const row = db.prepare(`
    select id, role, content, reply_to_message_id, created_at
    from messages
    where session_id = ? and id = ?
  `).get(sessionId, messageId) as Record<string, unknown> | undefined;
  return row ? messageFromRow(row) : null;
}

function promptWithReplyContext(sessionId: string, prompt: string, replyToMessageId?: string | null) {
  const replyTo = getSessionMessage(sessionId, replyToMessageId);
  if (!replyTo) return prompt;
  return [
    "The user is replying to this earlier message:",
    `Role: ${replyTo.role}`,
    `Message: ${replyTo.content}`,
    "",
    "User reply:",
    prompt,
  ].join("\n");
}

const fallbackContextMessageChars = 1200;
const managedContextPromptChars = 60_000;
const sessionTranscriptFileChars = 300_000;

function truncateContextText(value: string, limit = fallbackContextMessageChars) {
  const text = value.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

function recentSessionContextMarkdown(sessionId: string, currentMessageId?: string | null, limit = 20) {
  const rows = db.prepare(`
    select id, role, content, reply_to_message_id, created_at
    from messages
    where session_id = ? and (? is null or id != ?)
    order by created_at desc, id desc
    limit ?
  `).all(sessionId, currentMessageId ?? null, currentMessageId ?? null, limit) as Array<Record<string, unknown>>;
  const messages = rows.map(messageFromRow).reverse();
  if (!messages.length) return "No prior session messages.";
  return messages.map((message) => [
    `## ${message.role} ${message.createdAt}`,
    truncateContextText(message.content, 2400),
  ].join("\n\n")).join("\n\n");
}

function sessionTranscriptMarkdown(sessionId: string, currentMessageId?: string | null) {
  const rows = db.prepare(`
    select id, role, content, reply_to_message_id, created_at
    from messages
    where session_id = ? and (? is null or id != ?)
    order by created_at asc, id asc
  `).all(sessionId, currentMessageId ?? null, currentMessageId ?? null) as Array<Record<string, unknown>>;
  const messages = rows.map(messageFromRow);
  if (!messages.length) return "# Conversation Transcript\n\nNo prior session messages.";
  const transcript = [
    "# Conversation Transcript",
    ...messages.map((message) => [
      `## ${message.role} ${message.createdAt}`,
      `- id: ${message.id}`,
      message.replyToMessageId ? `- replyTo: ${message.replyToMessageId}` : "",
      "",
      truncateContextText(message.content, 8000),
    ].filter((line) => line !== "").join("\n")),
  ].join("\n\n");
  if (transcript.length <= sessionTranscriptFileChars) return transcript;
  return [
    "# Conversation Transcript",
    `[transcript truncated: omitted ${transcript.length - sessionTranscriptFileChars} older characters]`,
    "",
    transcript.slice(transcript.length - sessionTranscriptFileChars),
  ].join("\n");
}

function compactPayload(value: unknown, limit = 360) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return truncateContextText(text, limit).replace(/\s+/g, " ").trim();
}

function goalContextMarkdown(goal?: GoalSummary | null) {
  if (!goal) return "";
  const items = (db.prepare("select * from goal_items where goal_id = ? order by priority desc, updated_at desc, id desc limit 16").all(goal.id) as Array<Record<string, unknown>>).map(goalItemFromRow);
  return [
    "# Current Goal",
    `- id: ${goal.id}`,
    `- owner: ${goal.ownerType}/${goal.ownerId}`,
    `- mode: ${goal.mode}`,
    `- status: ${goal.status}`,
    goal.managerAgentId ? `- manager agent: ${goal.managerAgentId}` : "",
    goal.coordinatorAgentId ? `- coordinator agent: ${goal.coordinatorAgentId}` : "",
    `- goal: ${truncateContextText(goal.text, 1800)}`,
    goal.currentFocus ? `- current focus: ${truncateContextText(goal.currentFocus.text, 1000)}` : "",
    "",
    "Goal rules:",
    "- Goals are optional guidance. The user's latest instruction has priority.",
    "- Do not cancel, rewrite, or mark the whole goal complete unless the user clearly asks or the evidence is strong.",
    "- In managed mode, help maintain the plan, focus, status, and progress.",
    "- In orchestrated Room mode, use Goal items and Room tasks for planning, assignment, execution, and progress tracking.",
    "- Agents should propose high-impact changes to the main Goal for user/manager approval instead of silently replacing it.",
    "- Agents may update their assigned Goal items and report status, but main Goal changes should flow through Goal proposals.",
    "- When an agent calls Goal APIs directly, include x-codex-agent-id with the agent id so the server can enforce Goal permissions.",
    "",
    "## Goal Items",
    ...(items.length ? items.map((item) => `- [${item.status}] ${item.title}${item.assignedAgentId ? ` -> ${item.assignedAgentId}` : ""}${item.roomTaskId ? ` task=${item.roomTaskId}` : ""}: ${truncateContextText(item.description ?? "", 360)}`) : ["- none"]),
  ].filter((line) => line !== "").join("\n");
}

function fitManagedContextForPrompt(value: string, limit = managedContextPromptChars) {
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.62);
  const tail = limit - head;
  return [
    value.slice(0, head),
    "",
    `[context truncated: omitted ${value.length - limit} characters from the middle]`,
    "",
    value.slice(value.length - tail),
  ].join("\n");
}

function workspaceStateMarkdown(cwd: string) {
  const inside = runGitSync(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0) return [`# Workspace State`, `- cwd: ${cwd}`, "- git: not a git worktree"].join("\n");
  const branch = runGitSync(cwd, ["branch", "--show-current"]);
  const status = runGitSync(cwd, ["status", "--short"]);
  const stat = runGitSync(cwd, ["diff", "--stat"]);
  return [
    "# Workspace State",
    `- cwd: ${cwd}`,
    `- git branch: ${branch.stdout.trim() || "detached"}`,
    "",
    "## Git Status",
    status.stdout.trim() ? truncateContextText(status.stdout, 2400) : "clean",
    "",
    "## Diff Stat",
    stat.stdout.trim() ? truncateContextText(stat.stdout, 2400) : "no unstaged diff",
  ].join("\n");
}

function roomBlackboardContext(roomId: string, agentId?: string | null) {
  const room = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!room) return "";
  const project = room.project_id ? appData.projects.find((item) => item.id === String(room.project_id)) : null;
  const tasks = db.prepare(`
    select * from room_tasks
    where room_id = ?
    order by
      case status when 'running' then 0 when 'assigned' then 1 when 'queued' then 2 when 'failed' then 3 else 4 end,
      priority desc,
      updated_at desc
    limit 12
  `).all(roomId) as Array<Record<string, unknown>>;
  const decisions = db.prepare("select * from room_decisions where room_id = ? and status in ('open', 'approved') order by created_at desc, id desc limit 8").all(roomId) as Array<Record<string, unknown>>;
  const artifacts = db.prepare("select * from room_artifacts where room_id = ? order by created_at desc, id desc limit 8").all(roomId) as Array<Record<string, unknown>>;
  const handoffs = db.prepare("select * from room_handoffs where room_id = ? and status in ('open', 'accepted', 'returned') order by created_at desc, id desc limit 8").all(roomId) as Array<Record<string, unknown>>;
  const thread = agentId ? readRoomAgentThreadId(roomId, agentId) : null;
  const goalContext = goalContextMarkdown(activeGoalForOwner("room", roomId));
  const lines = [
    "# Room Blackboard",
    `- room: ${String(room.name)}`,
    `- room id: ${roomId}`,
    room.project_id ? `- project id: ${String(room.project_id)}` : "",
    project ? `- project name: ${project.name}` : "",
    project ? `- project directory: ${resolveTerminalCwd(project.workspacePath)}` : "",
    agentId ? `- current agent id: ${agentId}` : "",
    thread ? `- current agent codex thread: ${thread}` : "",
    room.shared_context ? `- shared context: ${truncateContextText(String(room.shared_context), 1600)}` : "",
    "",
    goalContext,
    goalContext ? "" : "",
    "## Active And Recent Tasks",
    ...(tasks.length ? tasks.map((row) => {
      const task = roomTaskFromRow(row);
      return `- [${task.status}] ${task.title} (${task.id})${task.assignedAgentId ? ` -> ${task.assignedAgentId}` : ""}: ${truncateContextText(task.prompt, 420)}`;
    }) : ["- none"]),
    "",
    "## Decisions",
    ...(decisions.length ? decisions.map((row) => {
      const decision = roomDecisionFromRow(row);
      return `- [${decision.status}] ${decision.title}: ${compactPayload(decision.payload)}`;
    }) : ["- none"]),
    "",
    "## Recent Artifacts",
    ...(artifacts.length ? artifacts.map((row) => {
      const artifact = roomArtifactFromRow(row);
      return `- ${artifact.kind}: ${artifact.title}${artifact.agentId ? ` by ${artifact.agentId}` : ""}: ${compactPayload(artifact.payload)}`;
    }) : ["- none"]),
    "",
    "## Recent Handoffs",
    ...(handoffs.length ? handoffs.map((row) => {
      const handoff = roomHandoffFromRow(row);
      return `- [${handoff.status}] ${handoff.fromAgentId ?? "system"} -> ${handoff.toAgentId ?? "room"}: ${truncateContextText(handoff.summary, 420)}`;
    }) : ["- none"]),
    "",
    recentRoomContext(roomId),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function roomDecisionsMarkdown(roomId: string) {
  const decisions = db.prepare("select * from room_decisions where room_id = ? and status in ('open', 'approved') order by created_at desc, id desc limit 24").all(roomId) as Array<Record<string, unknown>>;
  if (!decisions.length) return "# Room Decisions\n\nNo active decisions recorded.";
  return [
    "# Room Decisions",
    ...decisions.map((row) => {
      const decision = roomDecisionFromRow(row);
      return [
        `## ${decision.title}`,
        `- status: ${decision.status}`,
        `- created: ${decision.createdAt}`,
        decision.resolvedAt ? `- resolved: ${decision.resolvedAt}` : "",
        "",
        compactPayload(decision.payload, 1200),
      ].filter(Boolean).join("\n");
    }),
  ].join("\n\n");
}

function roomAgentOutputContract() {
  return [
    "Room collaboration output contract:",
    "- Write the normal assistant answer first.",
    "- When useful, also include a fenced JSON block named `codex-web-room-update`.",
    "- Use only valid JSON in that block.",
    "- Supported keys: summary, completed, risks, questions, handoff, artifacts, decisions, suggestedTasks.",
    "- Keep suggestedTasks concrete and assignable.",
    "- Suggested development tasks are queued automatically; do not ask the user to confirm normal Git-trackable coding work.",
    "- Treat user approval as reserved for non-Git-tracked, external, privileged, or irreversible actions.",
    "",
    "Example:",
    "```codex-web-room-update",
    JSON.stringify({
      summary: "What changed or what was learned.",
      completed: ["Finished item"],
      risks: ["Risk or blocker"],
      questions: ["Question for user or another agent"],
      handoff: "Short handoff for the next agent.",
      artifacts: [{ kind: "report", title: "Artifact title", payload: { notes: "..." } }],
      decisions: [{ title: "Decision title", status: "open", payload: { rationale: "..." } }],
      suggestedTasks: [{ title: "Next task", prompt: "Concrete task prompt", assignedAgentId: null, priority: 0 }],
    }, null, 2),
    "```",
  ].join("\n");
}

function notificationPermissionContext(session: SessionSummary) {
  const run = db.prepare("select * from agent_runs where session_id = ? order by started_at desc, id desc limit 1").get(session.id) as Record<string, unknown> | undefined;
  const directAgent = directAgentForSession(session.id)?.agent ?? null;
  return {
    agentId: run?.agent_id ? String(run.agent_id) : directAgent?.id ?? null,
    roomId: run?.room_id ? String(run.room_id) : session.roomId ?? null,
    projectId: session.projectId ?? null,
    run,
  };
}

function notificationPermissionAllows(policy: NotificationPermissionPolicy | undefined, context: ReturnType<typeof notificationPermissionContext>) {
  const allowedAgentIds = policy?.allowedAgentIds ?? [];
  const allowedRoomIds = policy?.allowedRoomIds ?? [];
  const allowedProjectIds = policy?.allowedProjectIds ?? [];
  if (allowedAgentIds.length && (!context.agentId || !allowedAgentIds.includes(context.agentId))) return false;
  if (allowedRoomIds.length && (!context.roomId || !allowedRoomIds.includes(context.roomId))) return false;
  if (allowedProjectIds.length && (!context.projectId || !allowedProjectIds.includes(context.projectId))) return false;
  return true;
}

function notificationSkillContext(session: SessionSummary) {
  const permissionContext = notificationPermissionContext(session);
  const recipients = listNotificationRecipients()
    .filter((recipient) => recipient.enabled)
    .filter((recipient) => notificationPermissionAllows(recipient.permissions, permissionContext))
    .map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      kind: recipient.kind,
      senderAccountId: recipient.senderAccountId ?? null,
    }));
  const senders = listNotificationAccounts()
    .filter((account) => account.enabled)
    .filter((account) => notificationPermissionAllows(account.permissions, permissionContext))
    .map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.channelKind,
    }));
  const run = permissionContext.run;
  const scopes = [
    `- session: current session (${session.id})`,
    "- current_task: the currently running Codex task for this session",
    run?.task_id ? `- current_room_task: current Room task (${String(run.task_id)})` : "",
  ].filter(Boolean);
  if (!recipients.length) return "";
  return [
    "## Notification Skill",
    "You may request a scoped one-time notification.",
    "Use this only when the user explicitly asks to be notified or when an existing notification instruction is part of the task.",
    "Do not create persistent/global notification rules.",
    "Allowed scopes:",
    ...scopes,
    "Allowed recipients:",
    ...recipients.map((recipient) => `- ${recipient.name} (${recipient.id}) kind=${recipient.kind}`),
    senders.length ? "Available senders:" : "",
    ...senders.map((sender) => `- ${sender.name} (${sender.id}) kind=${sender.kind}`),
    "",
    "To create a one-time notification rule, include a fenced JSON block named `codex-web-notification` in your answer.",
    "Supported eventTypes: task_completed, task_failed, task_interrupted, needs_approval.",
    "Use recipientIds from the allowed list. You may also include senderAccountId for an override.",
    "Use scopeType=session, current_task, or current_room_task. Prefer current_room_task inside Room Agent task runs, otherwise use current_task for this run or session for the whole session.",
    "Example:",
    "```codex-web-notification",
    JSON.stringify({
      action: "createOneTimeRule",
      scopeType: run?.task_id ? "current_room_task" : "current_task",
      eventTypes: ["task_completed"],
      recipientIds: recipients.slice(0, 1).map((recipient) => recipient.id),
      senderAccountId: null,
      expireMode: "after_trigger",
      reason: "Notify the user when this task completes.",
    }, null, 2),
    "```",
  ].filter((line) => line !== "").join("\n");
}

function compactSessionLine(session: SessionSummary) {
  const project = session.projectId ? appData.projects.find((item) => item.id === session.projectId) : null;
  return `- ${session.title} (${session.id}) status=${session.status} type=${session.conversationType ?? "codex"} project=${project?.name ?? session.projectId ?? "scratch"} updated=${session.updatedAt}`;
}

function crossSessionSkillContext(session: SessionSummary) {
  const recentSessions = appData.sessions
    .filter((item) => item.id !== session.id)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20);
  if (!recentSessions.length) return "";
  return [
    "## Cross-Session Skill",
    "You may request controlled access to other Codex Web sessions when the user explicitly asks you to check another session, compare progress, or send a message to another session.",
    "Prefer exact session ids. If the user names a session, use targetTitle and the backend will choose the best recent title match.",
    "Do not use this for unrelated browsing of history.",
    "",
    "Recent accessible sessions:",
    ...recentSessions.map(compactSessionLine),
    "",
    "To use this capability, include a fenced JSON block named `codex-web-cross-session` in your answer.",
    "Supported actions:",
    "- listSessions: records the recent accessible session list.",
    "- readSession: reads target status, latest run, memory summary, and recent messages.",
    "- sendMessage: sends a structured message to the target session; if the target is running it is queued, otherwise it starts a new turn.",
    "",
    "Examples:",
    "```codex-web-cross-session",
    JSON.stringify([
      { action: "readSession", targetSessionId: recentSessions[0]?.id ?? "task-..." },
      { action: "sendMessage", targetSessionId: recentSessions[0]?.id ?? "task-...", message: "Please report your current progress." },
    ], null, 2),
    "```",
  ].join("\n");
}

type CodexTaskContextInput = Partial<Pick<ExecutionContextSummary, "sourceType" | "agentId" | "roomId" | "createdBy" | "permissionProfileId" | "resolvedPermissions">> & {
  currentMessageId?: string | null;
  replyToMessageId?: string | null;
};

function writeExecutionContextPack(
  session: SessionSummary,
  prompt: string,
  cwd: string,
  contextInput?: CodexTaskContextInput,
) {
  const roomId = contextInput?.roomId ?? session.roomId ?? null;
  const agentId = contextInput?.agentId ?? directAgentForSession(session.id)?.agent.id ?? null;
  const sessionContext = recentSessionContextMarkdown(session.id, contextInput?.currentMessageId);
  const transcript = sessionTranscriptMarkdown(session.id, contextInput?.currentMessageId);
  const replyTo = getSessionMessage(session.id, contextInput?.replyToMessageId);
  const roomContext = roomId ? roomBlackboardContext(roomId, agentId) : "";
  const notificationContext = notificationSkillContext(session);
  const crossSessionContext = crossSessionSkillContext(session);
  const goalContext = goalContextMarkdown(activeGoalForSession(session));
  const persistentMemory = latestSessionMemoryMarkdown(session.id);
  const workspaceState = workspaceStateMarkdown(cwd);
  const currentRequest = ["# Current Request", prompt.trim()].join("\n\n");
  const replyContext = replyTo ? [
    "# Reply Target",
    `- id: ${replyTo.id}`,
    `- role: ${replyTo.role}`,
    `- created: ${replyTo.createdAt}`,
    "",
    truncateContextText(replyTo.content, 8000),
  ].join("\n") : "";
  const summary = [
    "# Context Summary",
    `- session: ${session.id}`,
    `- title: ${session.title}`,
    `- type: ${session.conversationType ?? "codex"}`,
    roomId ? `- room: ${roomId}` : "",
    agentId ? `- agent: ${agentId}` : "",
    `- workspace: ${cwd}`,
    session.codexSessionId ? `- codex thread: ${session.codexSessionId}` : "- codex thread: not available yet",
    "",
    "## Current Prompt",
    truncateContextText(prompt, 2400),
    "",
    "## Context Files",
    "- context-pack.md: prompt-facing managed context",
    "- conversation-transcript.md: longer prior conversation transcript",
    "- current-request.md: exact request sent to Codex for this run",
    replyContext ? "- reply-target.md: message being replied to" : "",
    goalContext ? "- goal.md: current Goal, current focus, and Goal items" : "",
  ].filter((line) => line !== "").join("\n");
  const pack = [
    "# Codex Web Context Pack",
    `- generated at: ${new Date().toISOString()}`,
    `- session id: ${session.id}`,
    `- session type: ${session.conversationType ?? "codex"}`,
    `- title: ${session.title}`,
    `- workspace: ${cwd}`,
    session.projectId ? `- project id: ${session.projectId}` : "",
    session.codexSessionId ? `- codex thread: ${session.codexSessionId}` : "- codex thread: not available yet",
    roomId ? `- room id: ${roomId}` : "",
    agentId ? `- agent id: ${agentId}` : "",
    contextInput?.sourceType ? `- source type: ${contextInput.sourceType}` : "",
    "",
    "## Available Context Files",
    "- context-pack.md",
    "- summary.md",
    "- recent-messages.md",
    "- conversation-transcript.md",
    persistentMemory ? "- persistent-memory.md" : "",
    "- workspace-state.md",
    "- current-request.md",
    replyContext ? "- reply-target.md" : "",
    goalContext ? "- goal.md" : "",
    roomContext ? "- room-blackboard.md" : "",
    roomId ? "- decisions.md" : "",
    notificationContext ? "- notification-skill.md" : "",
    crossSessionContext ? "- cross-session-skill.md" : "",
    "",
    persistentMemory,
    persistentMemory ? "" : "",
    "## Recent Session Messages",
    sessionContext,
    "",
    workspaceState,
    "",
    notificationContext,
    "",
    crossSessionContext,
    "",
    goalContext,
    "",
    roomContext,
    "",
    roomId ? "## Room Agent Protocol" : "",
    roomId ? roomAgentOutputContract() : "",
    "",
    "## Current Prompt",
    prompt.trim(),
  ].filter((line) => line !== "").join("\n");
  resetSessionContextFiles(session.id);
  const contextPackPath = writeSessionContextFile(session.id, "context-pack.md", pack);
  writeSessionContextFile(session.id, "summary.md", summary);
  writeSessionContextFile(session.id, "recent-messages.md", sessionContext);
  writeSessionContextFile(session.id, "conversation-transcript.md", transcript);
  if (persistentMemory) writeSessionContextFile(session.id, "persistent-memory.md", persistentMemory);
  writeSessionContextFile(session.id, "current-request.md", currentRequest);
  if (replyContext) writeSessionContextFile(session.id, "reply-target.md", replyContext);
  writeSessionContextFile(session.id, "workspace-state.md", workspaceState);
  if (goalContext) writeSessionContextFile(session.id, "goal.md", goalContext);
  if (notificationContext) writeSessionContextFile(session.id, "notification-skill.md", notificationContext);
  if (crossSessionContext) writeSessionContextFile(session.id, "cross-session-skill.md", crossSessionContext);
  if (roomContext) writeSessionContextFile(session.id, "room-blackboard.md", roomContext);
  if (roomId) writeSessionContextFile(session.id, "decisions.md", roomDecisionsMarkdown(roomId));
  return { contextPackPath, pack };
}

function promptWithManagedContext(
  session: SessionSummary,
  prompt: string,
  cwd: string,
  contextInput?: CodexTaskContextInput,
) {
  const { contextPackPath, pack } = writeExecutionContextPack(session, prompt, cwd, contextInput);
  return [
    "Use this Codex Web managed context as authoritative project/session context.",
    `A copy has been written to: ${contextPackPath}`,
    "Do not assume unavailable chat history beyond this pack and any Codex resume state.",
    "",
    fitManagedContextForPrompt(pack),
    "",
    "Now complete the current prompt.",
  ].join("\n");
}

function publishTaskEvent(sessionId: string, event: TaskEvent) {
  if (event.type === "activity") recordTaskActivity(sessionId, event);
  for (const subscriber of codexTaskSubscribers.get(sessionId) ?? []) subscriber(event);
}

function subscribeTaskEvents(sessionId: string, subscriber: (event: TaskEvent) => void) {
  const subscribers = codexTaskSubscribers.get(sessionId) ?? new Set<(event: TaskEvent) => void>();
  subscribers.add(subscriber);
  codexTaskSubscribers.set(sessionId, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) codexTaskSubscribers.delete(sessionId);
  };
}

function roomActivitySnapshot(roomId: string) {
  const roomRow = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!roomRow) return null;
  const room = roomFromRow(roomRow);
  const tasks = (db.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit 30").all(roomId) as Array<Record<string, unknown>>).map(roomTaskFromRow);
  const runs = (db.prepare("select * from agent_runs where room_id = ? order by started_at desc, id desc limit 30").all(roomId) as Array<Record<string, unknown>>).map(agentRunFromRow);
  const events = (db.prepare("select * from room_events where room_id = ? order by created_at desc, id desc limit 10").all(roomId) as Array<Record<string, unknown>>).map(roomEventFromRow);
  const messages = room.sessionId ? allSessionMessages(room.sessionId) : [];
  return { room, tasks, runs, events, messages };
}

function publishRoomEvent(roomId: string, event?: RoomEventSummary) {
  const snapshot = roomActivitySnapshot(roomId);
  if (!snapshot) return;
  const payload: RoomStreamEvent = { type: "activity", roomId, event, tasks: snapshot.tasks, runs: snapshot.runs, events: snapshot.events, messages: snapshot.messages };
  const subscribers = roomEventSubscribers.get(roomId);
  if (!subscribers) return;
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(payload);
    } catch {
      subscribers.delete(subscriber);
    }
  }
  if (!subscribers.size) roomEventSubscribers.delete(roomId);
}

function subscribeRoomEvents(roomId: string, subscriber: (event: RoomStreamEvent) => void) {
  const subscribers = roomEventSubscribers.get(roomId) ?? new Set<(event: RoomStreamEvent) => void>();
  subscribers.add(subscriber);
  roomEventSubscribers.set(roomId, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) roomEventSubscribers.delete(roomId);
  };
}

function publishPreviewLogEvent(previewId: string, event: PreviewLogEvent) {
  for (const subscriber of previewLogSubscribers.get(previewId) ?? []) subscriber(event);
}

function subscribePreviewLogEvents(previewId: string, subscriber: (event: PreviewLogEvent) => void) {
  const subscribers = previewLogSubscribers.get(previewId) ?? new Set<(event: PreviewLogEvent) => void>();
  subscribers.add(subscriber);
  previewLogSubscribers.set(previewId, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) previewLogSubscribers.delete(previewId);
  };
}

function listSessionMessages(sessionId: string, limit = 20, before?: string): SessionMessagesPage {
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session) syncRoomMessagesToSession(session);
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const cursor = before
    ? db.prepare("select created_at, id from messages where id = ? and session_id = ?").get(before, sessionId) as
        | { created_at: string; id: string }
        | undefined
    : undefined;
  const rows = cursor
    ? db.prepare(`
      select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
        reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
      from messages
      left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
      where messages.session_id = ? and (messages.created_at < ? or (messages.created_at = ? and messages.id < ?))
      order by messages.created_at desc, messages.id desc
      limit ?
    `).all(sessionId, cursor.created_at, cursor.created_at, cursor.id, pageSize + 1) as Array<Record<string, unknown>>
    : db.prepare(`
      select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
        reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
      from messages
      left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
      where messages.session_id = ?
      order by messages.created_at desc, messages.id desc
      limit ?
    `).all(sessionId, pageSize + 1) as Array<Record<string, unknown>>;
  const hasMore = rows.length > pageSize;
  return {
    items: rows.slice(0, pageSize).reverse().map(messageFromRow),
    nextCursor: hasMore ? String(rows[pageSize - 1].id) : null,
    hasMore,
  };
}

function allSessionMessages(sessionId: string) {
  return (db.prepare(`
    select messages.id, messages.role, messages.content, messages.reply_to_message_id, messages.created_at,
      reply.id as reply_id, reply.role as reply_role, reply.content as reply_content
    from messages
    left join messages reply on reply.id = messages.reply_to_message_id and reply.session_id = messages.session_id
    where messages.session_id = @sessionId
    order by messages.created_at asc, messages.id asc
  `).all({ sessionId }) as Array<Record<string, unknown>>).map(messageFromRow);
}

function sessionCompactionFromRow(row: Record<string, unknown>): SessionCompactionSummary {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    sourceMessageStartId: row.source_message_start_id ? String(row.source_message_start_id) : null,
    sourceMessageEndId: row.source_message_end_id ? String(row.source_message_end_id) : null,
    sourceMessageCount: Number(row.source_message_count ?? 0),
    sourceChars: Number(row.source_chars ?? 0),
    promptHash: String(row.prompt_hash),
    filePath: String(row.file_path),
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
    createdAt: String(row.created_at),
  };
}

function latestSessionCompaction(sessionId: string) {
  const row = db.prepare(`
    select *
    from session_compactions
    where session_id = ?
    order by created_at desc, id desc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
  return row ? sessionCompactionFromRow(row) : null;
}

function listSessionCompactions(sessionId: string, limit = 20): SessionCompactionListResponse {
  const rows = db.prepare(`
    select *
    from session_compactions
    where session_id = ?
    order by created_at desc, id desc
    limit ?
  `).all(sessionId, Math.max(1, Math.min(limit, 100))) as Array<Record<string, unknown>>;
  return { sessionId, items: rows.map(sessionCompactionFromRow) };
}

function latestSessionMemoryMarkdown(sessionId: string) {
  const latest = latestSessionCompaction(sessionId);
  if (!latest) return "";
  const fileContent = existsSync(latest.filePath) ? readFileSync(latest.filePath, "utf8") : "";
  const summary = fileContent.trim();
  if (!summary) return "";
  return [
    "# Persistent Session Memory",
    `- compaction id: ${latest.id}`,
    `- created: ${latest.createdAt}`,
    `- source messages: ${latest.sourceMessageCount}`,
    latest.providerId ? `- provider: ${latest.providerId}` : "",
    latest.model ? `- model: ${latest.model}` : "",
    "",
    summary,
  ].filter((line) => line !== "").join("\n");
}

function messagesAfterCompaction(messages: SessionMessage[], compaction: SessionCompactionSummary | null) {
  if (!compaction?.sourceMessageEndId) return messages;
  const index = messages.findIndex((message) => message.id === compaction.sourceMessageEndId);
  return index >= 0 ? messages.slice(index + 1) : messages;
}

function sessionCompactionPrompt(session: SessionSummary, messages: SessionMessage[], previousSummary = "") {
  const transcript = messages.map((message) => [
    `## ${message.role} ${message.createdAt}`,
    `- id: ${message.id}`,
    message.replyToMessageId ? `- replyTo: ${message.replyToMessageId}` : "",
    "",
    truncateContextText(message.content, 4000),
  ].filter((line) => line !== "").join("\n")).join("\n\n");
  return [
    "Create a durable session memory summary for Codex Web.",
    "Return Markdown only. Be concise but preserve information needed for future turns.",
    "",
    "Required sections:",
    "## Stable User Preferences",
    "## Decisions",
    "## Current Task State",
    "## Open Questions",
    "## Important Files And References",
    "## Risks Or Constraints",
    "",
    "Rules:",
    "- Preserve concrete decisions, user preferences, task state, blockers, and key file paths.",
    "- Do not include generic greetings or low-value chatter.",
    "- Do not invent facts not present in the transcript.",
    "- Keep the summary bounded; prefer bullets.",
    previousSummary ? "- Update the previous summary with the new transcript. Return a complete replacement summary, not a delta." : "",
    "",
    `Session: ${session.title} (${session.id})`,
    `Type: ${session.conversationType ?? "codex"}`,
    "",
    previousSummary ? "# Previous Persistent Summary" : "",
    previousSummary ? truncateContextText(previousSummary, 20_000) : "",
    previousSummary ? "" : "",
    "# Transcript",
    truncateContextText(transcript, 80_000),
  ].join("\n");
}

function responseOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.map((item) => {
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return textFromResponseContent(record.content);
  }).filter(Boolean).join("\n").trim();
}

async function generateSessionCompactionSummary(session: SessionSummary, provider: ProviderRecord, model: string, prompt: string) {
  if (provider.kind === "local") throw new Error("provider_compaction_unsupported");
  if (!provider.apiKey) throw new Error("api_key_missing");
  if (provider.kind === "openai-compatible-chat") {
    if (!provider.baseUrl) throw new Error("base_url_required");
    const response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You summarize software-development conversations into durable session memory." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
      }),
    });
    if (!response.ok) throw new Error(await response.text() || `http_${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined;
    const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!content) throw new Error("empty_compaction_summary");
    return content;
  }
  const response = await fetch(joinUrl(provider.baseUrl || "https://api.openai.com/v1", "/responses"), {
    method: "POST",
    headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 1600,
    }),
  });
  if (!response.ok) throw new Error(await response.text() || `http_${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const content = responseOutputText(payload);
  if (!content) throw new Error("empty_compaction_summary");
  return content;
}

async function createSessionCompaction(session: SessionSummary, body?: CreateSessionCompactionRequest | null, options: { incremental?: boolean } = {}): Promise<SessionCompactionResponse> {
  const allMessages = allSessionMessages(session.id).filter((message) => message.role !== "system");
  const previous = latestSessionCompaction(session.id);
  const previousSummary = options.incremental && previous ? latestSessionMemoryMarkdown(session.id) : "";
  const messages = options.incremental ? messagesAfterCompaction(allMessages, previous) : allMessages;
  if (!messages.length) throw new Error("no_messages_to_compact");
  const provider = appData.providers.find((item) => item.id === body?.providerId)
    ?? (session.providerId ? appData.providers.find((item) => item.id === session.providerId) : undefined)
    ?? appData.providers.find((item) => item.kind !== "local" && item.apiKey);
  if (!provider) throw new Error("provider_required");
  const model = body?.model?.trim() || session.model || provider.defaultModel;
  if (!model) throw new Error("model_required");
  const prompt = sessionCompactionPrompt(session, messages, previousSummary);
  const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
  const summary = await generateSessionCompactionSummary(session, provider, model, prompt);
  const id = `compaction-${randomUUID()}`;
  const now = new Date().toISOString();
  const memoryRoot = sessionMemoryPath(session.id);
  mkdirSync(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, `${id}.md`);
  const latestPath = join(memoryRoot, "latest-summary.md");
  writeFileSync(filePath, summary, "utf8");
  writeFileSync(latestPath, summary, "utf8");
  const sourceChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  db.prepare(`
    insert into session_compactions (
      id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
      source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    session.id,
    provider.id,
    model,
    messages[0]?.id ?? null,
    messages.at(-1)?.id ?? null,
    messages.length,
    sourceChars,
    promptHash,
    filePath,
    previous?.id ?? null,
    now,
  );
  return { compaction: latestSessionCompaction(session.id)!, summary };
}

function updateLatestSessionCompaction(session: SessionSummary, summary: string): SessionCompactionResponse {
  const previous = latestSessionCompaction(session.id);
  if (!previous) throw new Error("session_compaction_not_found");
  const trimmed = summary.trim();
  if (!trimmed) throw new Error("summary_required");
  const id = `compaction-${randomUUID()}`;
  const now = new Date().toISOString();
  const memoryRoot = sessionMemoryPath(session.id);
  mkdirSync(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, `${id}.md`);
  writeFileSync(filePath, trimmed, "utf8");
  writeFileSync(join(memoryRoot, "latest-summary.md"), trimmed, "utf8");
  const promptHash = createHash("sha256").update(`manual-edit:${trimmed}`).digest("hex").slice(0, 16);
  db.prepare(`
    insert into session_compactions (
      id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
      source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    session.id,
    null,
    "manual-edit",
    previous.sourceMessageStartId ?? null,
    previous.sourceMessageEndId ?? null,
    previous.sourceMessageCount,
    previous.sourceChars,
    promptHash,
    filePath,
    previous.id,
    now,
  );
  return { compaction: latestSessionCompaction(session.id)!, summary: trimmed };
}

function restoreSessionCompaction(session: SessionSummary, compactionId: string): SessionCompactionResponse {
  const target = db.prepare("select * from session_compactions where session_id = ? and id = ?").get(session.id, compactionId) as Record<string, unknown> | undefined;
  if (!target) throw new Error("session_compaction_not_found");
  const targetCompaction = sessionCompactionFromRow(target);
  const summary = existsSync(targetCompaction.filePath) ? readFileSync(targetCompaction.filePath, "utf8").trim() : "";
  if (!summary) throw new Error("summary_missing");
  const previous = latestSessionCompaction(session.id);
  const id = `compaction-${randomUUID()}`;
  const now = new Date().toISOString();
  const memoryRoot = sessionMemoryPath(session.id);
  mkdirSync(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, `${id}.md`);
  writeFileSync(filePath, summary, "utf8");
  writeFileSync(join(memoryRoot, "latest-summary.md"), summary, "utf8");
  const promptHash = createHash("sha256").update(`manual-restore:${targetCompaction.id}:${summary}`).digest("hex").slice(0, 16);
  db.prepare(`
    insert into session_compactions (
      id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
      source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    session.id,
    null,
    "manual-restore",
    targetCompaction.sourceMessageStartId ?? null,
    targetCompaction.sourceMessageEndId ?? null,
    targetCompaction.sourceMessageCount,
    targetCompaction.sourceChars,
    promptHash,
    filePath,
    previous?.id ?? null,
    now,
  );
  return { compaction: latestSessionCompaction(session.id)!, summary };
}

const runningAutoCompactions = new Set<string>();

function shouldAutoCompactSession(session: SessionSummary) {
  if (!sessionCompactionSettings.enabled) return false;
  if (runningAutoCompactions.has(session.id)) return false;
  const messages = allSessionMessages(session.id).filter((message) => message.role !== "system");
  if (!messages.length) return false;
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (messages.length < sessionCompactionSettings.autoCompactMessages && totalChars < sessionCompactionSettings.autoCompactChars) return false;
  const latest = latestSessionCompaction(session.id);
  const newMessages = messagesAfterCompaction(messages, latest);
  if (!newMessages.length) return false;
  const newChars = newMessages.reduce((sum, message) => sum + message.content.length, 0);
  if (!latest) return true;
  return newMessages.length >= sessionCompactionSettings.minNewMessages || newChars >= sessionCompactionSettings.minNewChars;
}

function scheduleSessionAutoCompaction(session: SessionSummary, reason: string) {
  if (!shouldAutoCompactSession(session)) return;
  runningAutoCompactions.add(session.id);
  void createSessionCompaction(session, null, { incremental: true })
    .then((result) => {
      const activity: Extract<TaskEvent, { type: "activity" }> = {
        type: "activity",
        kind: "tool",
        label: "会话记忆已自动压缩",
        detail: `${reason}; ${result.compaction.sourceMessageCount} new messages`,
        status: "completed",
        at: result.compaction.createdAt,
      };
      recordTaskActivity(session.id, activity);
      publishTaskEvent(session.id, activity);
    })
    .catch((error) => {
      appendCodexErrorOutput(session, `\n[session compaction failed] ${error instanceof Error ? error.message : String(error)}\n`);
      recordTaskActivity(session.id, {
        type: "activity",
        kind: "tool",
        label: "会话记忆自动压缩失败",
        detail: error instanceof Error ? error.message : String(error),
        status: "failed",
        at: new Date().toISOString(),
      });
    })
    .finally(() => {
      runningAutoCompactions.delete(session.id);
    });
}

function deleteSessionMessages(sessionId: string) {
  db.prepare("delete from messages where session_id = ?").run(sessionId);
  db.prepare("delete from message_cards where session_id = ?").run(sessionId);
}

function deleteGoalsForOwner(ownerType: GoalOwnerType, ownerId: string) {
  const rows = db.prepare("select id from goals where owner_type = ? and owner_id = ?").all(ownerType, ownerId) as Array<{ id: string }>;
  let deleted = 0;
  for (const row of rows) {
    deleted += db.prepare("delete from goal_events where goal_id = ?").run(row.id).changes;
    deleted += db.prepare("delete from goal_proposals where goal_id = ?").run(row.id).changes;
    deleted += db.prepare("delete from goal_focuses where goal_id = ?").run(row.id).changes;
    deleted += db.prepare("delete from goal_items where goal_id = ?").run(row.id).changes;
    deleted += db.prepare("delete from goals where id = ?").run(row.id).changes;
  }
  return deleted;
}

function deleteSessionDatabaseRows(sessionId: string) {
  deletePreviewsForScope("session", sessionId);
  deleteSessionMessages(sessionId);
  deleteGoalsForOwner("session", sessionId);
  deleteGoalsForOwner("agent_session", sessionId);
  db.prepare("delete from message_queue where session_id = ?").run(sessionId);
  db.prepare("delete from task_activities where session_id = ?").run(sessionId);
  db.prepare("delete from execution_contexts where session_id = ?").run(sessionId);
  db.prepare("delete from session_compactions where session_id = ?").run(sessionId);
  db.prepare("delete from agent_sessions where session_id = ?").run(sessionId);
  db.prepare("delete from agent_runs where session_id = ?").run(sessionId);
  db.prepare("delete from sessions where id = ?").run(sessionId);
}

function messageCardFromRow(row: Record<string, unknown>): MessageCardSummary {
  let payload: unknown = {};
  try {
    payload = JSON.parse(String(row.payload));
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    messageId: row.message_id ? String(row.message_id) : null,
    type: row.type as MessageCardSummary["type"],
    title: String(row.title),
    payload,
    createdAt: String(row.created_at),
  };
}

function appendMessageCard(sessionId: string, type: MessageCardSummary["type"], title: string, payload: unknown, messageId?: string | null) {
  const card: MessageCardSummary = {
    id: `card-${randomUUID()}`,
    sessionId,
    messageId: messageId ?? null,
    type,
    title,
    payload,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    insert into message_cards (id, session_id, message_id, type, title, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(card.id, card.sessionId, card.messageId ?? null, card.type, card.title, JSON.stringify(card.payload ?? {}), card.createdAt);
  return card;
}

function normalizeMessageUrl(value: string) {
  let url = value.trim();
  while (/[),.;:!?]+$/.test(url)) url = url.slice(0, -1);
  return url;
}

function messageUrls(value: string) {
  const urls = new Set<string>();
  for (const match of value.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/g)) {
    const url = normalizeMessageUrl(match[0]);
    if (url) urls.add(url);
  }
  return [...urls];
}

function linkTitle(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return path ? `${parsed.host}${path}` : parsed.host;
  } catch {
    return url;
  }
}

function cardPayloadUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  return typeof record.url === "string" ? record.url : typeof record.source === "string" ? record.source : null;
}

function cardPayloadPort(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.port === "number" && Number.isInteger(record.port)) return record.port;
  if (typeof record.port === "string" && /^\d+$/.test(record.port)) return Number(record.port);
  for (const key of ["source", "url"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    try {
      const parsed = new URL(value);
      const port = Number(parsed.port);
      if (Number.isInteger(port)) return port;
    } catch {
      // Ignore non-URL payload fields.
    }
  }
  return null;
}

function cardSuppressionKeys(type: MessageCardSummary["type"], payload: unknown) {
  const keys = new Set<string>();
  const url = cardPayloadUrl(payload);
  if (url) keys.add(`url:${normalizeMessageUrl(url)}`);
  if (type === "preview" || type === "service") {
    const port = cardPayloadPort(payload);
    if (port !== null) keys.add(`preview-port:${port}`);
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const previewId = typeof record.previewId === "string" ? record.previewId : typeof record.id === "string" ? record.id : "";
      if (previewId) keys.add(`preview:${previewId}`);
    }
  }
  return [...keys].filter(Boolean);
}

function isMessageCardDismissed(sessionId: string, keys: string[]) {
  if (!keys.length) return false;
  const read = db.prepare("select 1 from message_card_dismissals where session_id = ? and suppression_key = ? limit 1");
  return keys.some((key) => Boolean(read.get(sessionId, key)));
}

function dismissMessageCard(sessionId: string, type: MessageCardSummary["type"], payload: unknown) {
  const keys = cardSuppressionKeys(type, payload);
  if (!keys.length) return;
  const insert = db.prepare("insert or ignore into message_card_dismissals (session_id, suppression_key, dismissed_at) values (?, ?, ?)");
  const now = new Date().toISOString();
  for (const key of keys) insert.run(sessionId, key, now);
}

function isLocalPreviewUrl(url: string) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/|$)/.test(url);
}

function appendUrlCardsForMessage(session: SessionSummary, messageId: string, content: string) {
  const urls = messageUrls(content);
  if (!urls.length) return;
  discoverPreviewUrls(session, content);
  const existing = (db.prepare(`
    select payload
    from message_cards
    where session_id = ? and type in ('link', 'service', 'preview')
  `).all(session.id) as Array<{ payload: string }>).map((row) => {
    try {
      return cardPayloadUrl(JSON.parse(row.payload));
    } catch {
      return null;
    }
  }).filter(Boolean);
  for (const url of urls) {
    if (isLocalPreviewUrl(url)) continue;
    if (existing.includes(url)) continue;
    if (isMessageCardDismissed(session.id, [`url:${url}`])) continue;
    let payload: Record<string, unknown> = { url };
    try {
      const parsed = new URL(url);
      payload = { url, host: parsed.host, path: parsed.pathname, protocol: parsed.protocol.replace(":", "") };
    } catch {
      payload = { url };
    }
    appendMessageCard(session.id, "link", linkTitle(url), payload, messageId);
    existing.push(url);
  }
}

function ensureSessionUrlCards(session: SessionSummary) {
  const rows = db.prepare(`
    select id, content
    from messages
    where session_id = ? and role = 'assistant'
    order by created_at asc, id asc
  `).all(session.id) as Array<{ id: string; content: string }>;
  for (const row of rows) appendUrlCardsForMessage(session, row.id, row.content);
}

function listSessionCards(sessionId: string): MessageCardSummary[] {
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session) ensureSessionUrlCards(session);
  const previewCards = Array.from(previews.values())
    .filter((preview) => preview.scopeType === "session" && preview.scopeId === sessionId)
    .map((preview) => ({
      id: `preview:${preview.id}`,
      sessionId,
      messageId: null,
      type: "preview" as const,
      title: preview.label,
      payload: publicPreview(preview),
      createdAt: preview.createdAt,
    }));
  const previewIds = new Set(previewCards.map((card) => (card.payload as PreviewSummary).id));
  const stored = (db.prepare(`
    select id, session_id, message_id, type, title, payload, created_at
    from message_cards
    where session_id = ?
    order by created_at desc, id desc
  `).all(sessionId) as Array<Record<string, unknown>>)
    .map(messageCardFromRow)
    .filter((card) => {
      if (card.type !== "service" || !card.payload || typeof card.payload !== "object") return true;
      const previewId = (card.payload as Record<string, unknown>).previewId;
      return typeof previewId !== "string" || !previewIds.has(previewId);
    })
    .filter((card) => {
      return !isMessageCardDismissed(sessionId, cardSuppressionKeys(card.type, card.payload));
    });
  const seen = new Set<string>();
  return [...previewCards, ...stored]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .filter((card) => {
      if (isMessageCardDismissed(sessionId, cardSuppressionKeys(card.type, card.payload))) return false;
      const payload = card.payload && typeof card.payload === "object" ? card.payload as Record<string, unknown> : {};
      const key = typeof payload.previewId === "string"
        ? `preview:${payload.previewId}`
        : typeof payload.url === "string"
          ? `url:${payload.url}`
          : `${card.type}:${card.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function queuedMessageFromRow(row: Record<string, unknown>): QueuedMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    prompt: String(row.prompt),
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    replyToMessageId: row.reply_to_message_id ? String(row.reply_to_message_id) : null,
    orderIndex: Number(row.order_index ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function listQueuedMessages(sessionId: string) {
  return (db.prepare(`
    select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at
    from message_queue
    where session_id = ?
    order by order_index asc, created_at asc, id asc
  `).all(sessionId) as Array<Record<string, unknown>>).map(queuedMessageFromRow);
}

function getQueuedMessage(sessionId: string, queueId: string) {
  const row = db.prepare(`
    select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at
    from message_queue
    where session_id = ? and id = ?
  `).get(sessionId, queueId) as Record<string, unknown> | undefined;
  return row ? queuedMessageFromRow(row) : null;
}

function enqueueMessage(session: SessionSummary, input: QueueMessageRequest) {
  const now = new Date().toISOString();
  const orderIndex = Number((db.prepare("select coalesce(max(order_index), 0) as max_order from message_queue where session_id = ?").get(session.id) as { max_order?: number } | undefined)?.max_order ?? 0) + 1000;
  const item: QueuedMessage = {
    id: randomUUID(),
    sessionId: session.id,
    prompt: input.prompt.trim(),
    providerId: input.providerId ?? session.providerId ?? null,
    model: input.model ?? session.model ?? null,
    replyToMessageId: input.replyToMessageId ?? null,
    orderIndex,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(`
    insert into message_queue (id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.sessionId, item.prompt, item.providerId ?? null, item.model ?? null, item.replyToMessageId ?? null, item.orderIndex, item.createdAt, item.updatedAt);
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
  return item;
}

function updateQueuedMessage(session: SessionSummary, queueId: string, input: UpdateQueuedMessageRequest) {
  const current = getQueuedMessage(session.id, queueId);
  if (!current) return null;
  const updated: QueuedMessage = {
    ...current,
    prompt: input.prompt.trim(),
    providerId: input.providerId ?? current.providerId ?? session.providerId ?? null,
    model: input.model ?? current.model ?? session.model ?? null,
    replyToMessageId: input.replyToMessageId ?? current.replyToMessageId ?? null,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(`
    update message_queue
    set prompt = ?, provider_id = ?, model = ?, reply_to_message_id = ?, updated_at = ?
    where session_id = ? and id = ?
  `).run(updated.prompt, updated.providerId ?? null, updated.model ?? null, updated.replyToMessageId ?? null, updated.updatedAt, session.id, queueId);
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
  return updated;
}

function deleteQueuedMessage(session: SessionSummary, queueId: string) {
  db.prepare("delete from message_queue where session_id = ? and id = ?").run(session.id, queueId);
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
}

function reorderQueuedMessages(session: SessionSummary, orderedIds: string[]) {
  const currentIds = new Set(listQueuedMessages(session.id).map((item) => item.id));
  const nextIds = orderedIds.filter((id) => currentIds.has(id));
  if (nextIds.length !== currentIds.size) return null;
  const updatedAt = new Date().toISOString();
  const updateOrder = db.prepare("update message_queue set order_index = ?, updated_at = ? where session_id = ? and id = ?");
  db.transaction(() => {
    nextIds.forEach((id, index) => updateOrder.run((index + 1) * 1000, updatedAt, session.id, id));
  })();
  const queue = listQueuedMessages(session.id);
  publishTaskEvent(session.id, { type: "queue", queue, session });
  return queue;
}

function popNextQueuedMessage(sessionId: string) {
  const row = db.prepare(`
    select id, session_id, prompt, provider_id, model, reply_to_message_id, order_index, created_at, updated_at
    from message_queue
    where session_id = ?
    order by order_index asc, created_at asc, id asc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const item = queuedMessageFromRow(row);
  db.prepare("delete from message_queue where id = ?").run(item.id);
  return item;
}

function terminalSessionFromRow(row: Record<string, unknown>): TerminalSessionSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    cwd: String(row.cwd),
    mode: row.mode === "pipe" ? "pipe" : "pty",
    status: row.status === "running" ? "running" : "closed",
    createdAt: String(row.created_at),
  };
}

function listTerminalSessionSummaries() {
  const persisted = (db.prepare(`
    select id, name, cwd, mode, status, created_at
    from terminal_sessions
    order by updated_at desc, created_at desc
  `).all() as Array<Record<string, unknown>>).map(terminalSessionFromRow);
  const runtimeIds = new Set(terminalSessions.keys());
  const runtimeSessions = Array.from(terminalSessions.values()).filter((session) => !session.ephemeral).map(terminalSummary);
  return [
    ...runtimeSessions,
    ...persisted.filter((session) => !runtimeIds.has(session.id)),
  ];
}

function upsertTerminalSession(session: TerminalSessionSummary) {
  db.prepare(`
    insert into terminal_sessions (id, name, cwd, mode, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      cwd = excluded.cwd,
      mode = excluded.mode,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(session.id, session.name, session.cwd, session.mode, session.status, session.createdAt, new Date().toISOString());
}

function markTerminalClosed(sessionId: string) {
  db.prepare("update terminal_sessions set status = 'closed', updated_at = ? where id = ?").run(new Date().toISOString(), sessionId);
}

function deleteTerminalSessionRecord(sessionId: string) {
  db.prepare("delete from terminal_sessions where id = ?").run(sessionId);
}

function closePersistedRunningTerminals() {
  db.prepare("update terminal_sessions set status = 'closed', updated_at = ? where status = 'running'").run(new Date().toISOString());
}

function previewFromRow(row: Record<string, unknown>): PreviewRecord {
  return {
    id: String(row.id),
    scopeType: row.scope_type === "session" || row.scope_type === "folder" ? row.scope_type : "project",
    scopeId: String(row.scope_id),
    label: String(row.label),
    targetHost: String(row.target_host),
    port: Number(row.port),
    command: row.command ? String(row.command) : undefined,
    cwd: row.cwd ? String(row.cwd) : undefined,
    status: row.status === "starting" || row.status === "running" || row.status === "stopped" || row.status === "error" ? row.status : "registered",
    access: previewAccess(row.access, "public"),
    token: String(row.token),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : String(row.created_at),
  };
}

function previewUrl(preview: PreviewRecord) {
  return `/preview/${encodeURIComponent(preview.id)}/${encodeURIComponent(preview.token)}/`;
}

function publicPreview(preview: PreviewRecord): PreviewSummary {
  return {
    id: preview.id,
    scopeType: preview.scopeType,
    scopeId: preview.scopeId,
    label: preview.label,
    targetHost: preview.targetHost,
    port: preview.port,
    command: preview.command,
    cwd: preview.cwd,
    status: preview.status,
    access: preview.access,
    url: previewUrl(preview),
    createdAt: preview.createdAt,
    updatedAt: preview.updatedAt,
  };
}

function loadPreviews() {
  const rows = db.prepare("select * from previews order by created_at desc").all() as Array<Record<string, unknown>>;
  for (const row of rows) previews.set(String(row.id), previewFromRow(row));
}

function loadPreviewLogs() {
  const rows = db.prepare("select preview_id, logs, label from preview_logs").all() as Array<Record<string, unknown>>;
  for (const row of rows) previewLogs.set(String(row.preview_id), String(row.logs));
}

function previewAccessRequestFromRow(row: Record<string, unknown>): PreviewAccessRequest {
  const status = row.status === "approved" || row.status === "denied" ? row.status : "pending";
  return {
    id: String(row.id),
    previewId: String(row.preview_id),
    secret: String(row.secret),
    status,
    approvedUntil: row.approved_until ? String(row.approved_until) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function loadPreviewAccessRequests() {
  const rows = db.prepare("select * from preview_access_requests").all() as Array<Record<string, unknown>>;
  for (const row of rows) previewAccessRequests.set(String(row.id), previewAccessRequestFromRow(row));
}

function upsertPreviewAccessRequest(request: PreviewAccessRequest) {
  db.prepare(`
    insert into preview_access_requests (id, preview_id, secret, status, approved_until, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      preview_id = excluded.preview_id,
      secret = excluded.secret,
      status = excluded.status,
      approved_until = excluded.approved_until,
      updated_at = excluded.updated_at
  `).run(request.id, request.previewId, request.secret, request.status, request.approvedUntil ?? null, request.createdAt, request.updatedAt);
  previewAccessRequests.set(request.id, request);
}

function expirePreviewAccessRequests() {
  const cutoff = Date.now() - previewAccessSettings.requestTtlMinutes * 60 * 1000;
  const expired = Array.from(previewAccessRequests.values()).filter((request) =>
    request.status === "pending" && new Date(request.createdAt).getTime() < cutoff
  );
  for (const request of expired) {
    request.status = "denied";
    request.updatedAt = new Date().toISOString();
    upsertPreviewAccessRequest(request);
    const rows = db.prepare("select id, payload from approvals where action_type = 'preview-access' and status = 'pending'").all() as Array<{ id: string; payload: string }>;
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as { requestId?: unknown };
        if (String(payload.requestId ?? "") === request.id) resolveApproval(row.id, "denied");
      } catch {
        continue;
      }
    }
  }
}

function insertPreview(preview: PreviewRecord) {
  db.prepare(`
    insert into previews (id, scope_type, scope_id, label, target_host, port, token, command, cwd, status, access, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(preview.id, preview.scopeType, preview.scopeId, preview.label, preview.targetHost, preview.port, preview.token, preview.command ?? null, preview.cwd ?? null, preview.status, preview.access, preview.createdAt, preview.updatedAt);
  previews.set(preview.id, preview);
}

function updatePreview(preview: PreviewRecord) {
  preview.updatedAt = new Date().toISOString();
  db.prepare(`
    update previews
    set label = ?, target_host = ?, port = ?, command = ?, cwd = ?, status = ?, access = ?, updated_at = ?
    where id = ?
  `).run(preview.label, preview.targetHost, preview.port, preview.command ?? null, preview.cwd ?? null, preview.status, preview.access, preview.updatedAt, preview.id);
  previews.set(preview.id, preview);
  publishPreviewLogEvent(preview.id, { type: "status", preview: publicPreview(preview) });
}

async function markPreviewRunningIfReachable(preview: PreviewRecord) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`http://${preview.targetHost}:${preview.port}/`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    const current = previews.get(preview.id);
    if (!current || !response) return;
    current.status = "running";
    updatePreview(current);
    appendPreviewLog(current.id, `[discover] upstream responded with ${response.status}\n`);
  } catch {
    // Keep discovered previews registered when the upstream is not ready yet.
  }
}

function discoverPreviewUrls(session: SessionSummary, value: string) {
  const context = latestExecutionContextForSession(session.id);
  if (context && !context.resolvedPermissions.canCreatePreview) return;
  const matches = value.matchAll(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(?:\/[^\s"'`)]*)?/g);
  for (const match of matches) {
    if (shouldIgnoreDiscoveredPreviewUrl(match[0])) continue;
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (isMessageCardDismissed(session.id, [`preview-port:${port}`, `url:${normalizeMessageUrl(match[0])}`])) continue;
    const existing = Array.from(previews.values()).find((preview) =>
      preview.scopeType === "session"
      && preview.scopeId === session.id
      && preview.targetHost === "127.0.0.1"
      && preview.port === port
    );
    if (existing) continue;
    const now = new Date().toISOString();
    const preview: PreviewRecord = {
      id: `preview-${randomUUID()}`,
      scopeType: "session",
      scopeId: session.id,
      label: `${session.title || "Session"} :${port}`,
      targetHost: "127.0.0.1",
      port,
      token: randomUUID(),
      command: undefined,
      cwd: session.workspacePath,
      status: "registered",
      access: "private",
      createdAt: now,
      updatedAt: now,
    };
    insertPreview(preview);
    appendPreviewLog(preview.id, `[discover] detected ${match[0]} from Codex output\n`);
    appendMessageCard(session.id, "service", `Detected service on :${port}`, { previewId: preview.id, url: publicPreview(preview).url, port, source: match[0] });
    void markPreviewRunningIfReachable(preview);
  }
}

function shouldIgnoreDiscoveredPreviewUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.startsWith("/provider-proxy")
      || parsed.pathname.startsWith("/api/")
      || parsed.pathname.startsWith("/preview/")
      || parsed.pathname === "/health";
  } catch {
    return false;
  }
}

function deletePreview(previewId: string) {
  stopPreviewProcess(previewId);
  db.prepare("delete from previews where id = ?").run(previewId);
  db.prepare("delete from preview_logs where preview_id = ?").run(previewId);
  previews.delete(previewId);
  previewLogs.delete(previewId);
}

function deletePreviewsForScope(scopeType: PreviewRecord["scopeType"], scopeId: string) {
  let deleted = 0;
  for (const preview of Array.from(previews.values())) {
    if (preview.scopeType === scopeType && preview.scopeId === scopeId) {
      deletePreview(preview.id);
      deleted += 1;
    }
  }
  return deleted;
}

function deleteRoomDatabaseRows(roomId: string) {
  let deleted = 0;
  deleted += deleteGoalsForOwner("room", roomId);
  for (const table of [
    "room_agents",
    "room_events",
    "room_tasks",
    "room_artifacts",
    "room_handoffs",
    "room_decisions",
    "room_schedules",
    "room_run_merges",
    "room_agent_threads",
    "agent_runs",
  ]) {
    deleted += db.prepare(`delete from ${table} where room_id = ?`).run(roomId).changes;
  }
  deleted += db.prepare("delete from execution_contexts where room_id = ?").run(roomId).changes;
  deleted += db.prepare("delete from rooms where id = ?").run(roomId).changes;
  return deleted;
}

function cleanupDatabaseRedundancy(options: { deleteArchivedApprovals?: boolean; archivedApprovalRetentionDays?: number; deleteApprovalAuditLog?: boolean } = {}): MaintenanceCleanupResponse {
  const sessionIds = new Set(appData.sessions.map((session) => session.id));
  const projectIds = new Set(appData.projects.map((project) => project.id));
  const providerIds = new Set(appData.providers.map((provider) => provider.id));
  let detachedSessions = 0;
  let deletedPreviews = 0;

  for (const session of appData.sessions) {
    if (!session.projectId || projectIds.has(session.projectId)) continue;
    deletedPreviews += deletePreviewsForScope("session", session.id);
    session.projectId = null;
    session.kind = "scratch";
    session.workspacePath = ensureScratchSessionWorkspace(session.id);
    session.updatedAt = new Date().toISOString();
    upsertSession(session);
    detachedSessions += 1;
  }

  for (const preview of Array.from(previews.values())) {
    const hasScope = preview.scopeType === "project"
      ? projectIds.has(preview.scopeId)
      : preview.scopeType === "folder"
        ? existsSync(preview.scopeId) && statSync(preview.scopeId).isDirectory()
        : sessionIds.has(preview.scopeId);
    if (!hasScope) {
      deletePreview(preview.id);
      deletedPreviews += 1;
    }
  }

  const messages = db.prepare(`
    delete from messages
    where not exists (select 1 from sessions where sessions.id = messages.session_id)
  `).run().changes;
  const previewLogRows = db.prepare(`
    delete from preview_logs
    where not exists (select 1 from previews where previews.id = preview_logs.preview_id)
  `).run().changes;
  const queuedMessages = db.prepare(`
    delete from message_queue
    where not exists (select 1 from sessions where sessions.id = message_queue.session_id)
  `).run().changes;
  const taskActivities = db.prepare(`
    delete from task_activities
    where not exists (select 1 from sessions where sessions.id = task_activities.session_id)
  `).run().changes;
  const projectCheckRuns = db.prepare(`
    delete from project_check_runs
    where not exists (select 1 from projects where projects.id = project_check_runs.project_id)
  `).run().changes;
  const automationRuns = db.prepare(`
    delete from automation_runs
    where not exists (select 1 from automations where automations.id = automation_runs.automation_id)
      or not exists (select 1 from sessions where sessions.id = automation_runs.session_id)
  `).run().changes;
  let providerHealthChecks = 0;
  for (const providerId of (db.prepare("select distinct provider_id from provider_health_checks").all() as Array<{ provider_id: string }>).map((row) => row.provider_id)) {
    if (providerIds.has(providerId)) continue;
    providerHealthChecks += db.prepare("delete from provider_health_checks where provider_id = ?").run(providerId).changes;
  }

  let closedTerminalSessions = 0;
  const closedTerminalRows = db.prepare("select id from terminal_sessions where status = 'closed'").all() as Array<{ id: string }>;
  for (const row of closedTerminalRows) {
    if (terminalSessions.has(row.id)) continue;
    closedTerminalSessions += db.prepare("delete from terminal_sessions where id = ?").run(row.id).changes;
  }
  const orphanAgentRows = db.prepare(`
    select *
    from sessions
    where conversation_type = 'agent'
      and room_id is not null
      and not exists (select 1 from rooms where rooms.id = sessions.room_id)
  `).all() as Array<Record<string, unknown>>;
  let orphanAgentSessions = 0;
  for (const row of orphanAgentRows) {
    const session = sessionFromRow(row, appData.projects);
    clearCodexTaskRuntime(session.id, true);
    appData.sessions = appData.sessions.filter((item) => item.id !== session.id);
    deleteSessionDatabaseRows(session.id);
    orphanAgentSessions += 1;
  }
  const orphanRoomRows = db.prepare(`
    select id
    from rooms
    where session_id is null
      or not exists (select 1 from sessions where sessions.id = rooms.session_id)
  `).all() as Array<{ id: string }>;
  for (const row of orphanRoomRows) {
    const childSessions = appData.sessions.filter((session) => session.conversationType === "agent" && session.roomId === row.id);
    for (const childSession of childSessions) {
      clearCodexTaskRuntime(childSession.id, true);
      deleteSessionDatabaseRows(childSession.id);
      deleteSessionData(childSession, false, true);
    }
    appData.sessions = appData.sessions.filter((session) => !(session.conversationType === "agent" && session.roomId === row.id));
  }
  const orphanRoomRecords = [
    "room_agents",
    "room_events",
    "room_tasks",
    "room_artifacts",
    "room_handoffs",
    "room_decisions",
    "room_schedules",
    "room_run_merges",
    "room_agent_threads",
    "agent_runs",
  ].reduce((total, table) => {
    return total + db.prepare(`
      delete from ${table}
      where not exists (select 1 from rooms where rooms.id = ${table}.room_id)
    `).run().changes;
  }, orphanRoomRows.reduce((total, row) => total + deleteRoomDatabaseRows(row.id), 0)) + db.prepare(`
    delete from execution_contexts
    where room_id is not null
      and not exists (select 1 from rooms where rooms.id = execution_contexts.room_id)
  `).run().changes;
  const retentionDays = Math.max(0, Math.min(Number(options.archivedApprovalRetentionDays ?? 30), 3650));
  const archivedApprovals = options.deleteArchivedApprovals === false ? 0 : db.prepare("delete from approvals where archived_at is not null and archived_at < ?").run(new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()).changes;
  const approvalAuditLog = options.deleteApprovalAuditLog ? db.prepare("delete from approvals where status != 'pending'").run().changes : 0;

  saveAppData();
  return {
    ok: true,
    deleted: {
      previews: deletedPreviews,
      previewLogs: previewLogRows,
      messages,
      queuedMessages,
      taskActivities,
      projectCheckRuns,
      automationRuns,
      providerHealthChecks,
      closedTerminalSessions,
      archivedApprovals,
      approvalAuditLog,
      orphanAgentSessions,
      orphanRoomRecords,
    },
    updated: { detachedSessions },
  };
}

function pathStats(targetPath: string, options: { excludeNames?: Set<string> } = {}) {
  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      return { bytes: stat.size, updatedAt: stat.mtime.toISOString() };
    }
    if (stat.isDirectory()) {
      let bytes = 0;
      for (const child of readdirSync(targetPath)) {
        if (options.excludeNames?.has(child)) continue;
        bytes += pathStats(join(targetPath, child), options).bytes;
      }
      return { bytes, updatedAt: stat.mtime.toISOString() };
    }
    return { bytes: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { bytes: 0, updatedAt: new Date(0).toISOString() };
  }
}

function storageItem(
  type: StorageItemSummary["type"],
  status: StorageItemSummary["status"],
  label: string,
  itemPath: string,
  relatedId?: string | null,
  relatedName?: string | null,
  relatedType?: StorageItemSummary["relatedType"],
  statsOptions?: { excludeNames?: Set<string> },
): StorageItemSummary {
  const stats = pathStats(itemPath, statsOptions);
  return {
    id: createHash("sha1").update(`${type}:${itemPath}`).digest("hex"),
    type,
    status,
    label,
    path: itemPath,
    bytes: stats.bytes,
    updatedAt: stats.updatedAt,
    relatedId: relatedId ?? null,
    relatedName: relatedName ?? null,
    relatedType: relatedType ?? null,
  };
}

function listStorageItems(): StorageScanResponse {
  const items: StorageItemSummary[] = [];
  const sessionIds = new Set(appData.sessions.map((session) => session.id));
  const sessionById = new Map(appData.sessions.map((session) => [session.id, session]));
  const projectByWorkspacePath = new Map(appData.projects.map((project) => [resolveTerminalCwd(project.workspacePath), project]));
  const roomRows = db.prepare("select id, session_id, name from rooms").all() as Array<{ id: string; session_id?: string | null; name: string }>;
  const roomById = new Map(roomRows.map((room) => [room.id, room]));
  const activeRoomIds = new Set(roomRows
    .filter((row) => row.session_id && sessionIds.has(row.session_id))
    .map((row) => row.id));
  const activeSessionIds = new Set(appData.sessions
    .filter((session) => !(session.conversationType === "agent" && session.roomId && !activeRoomIds.has(session.roomId)))
    .map((session) => session.id));
  const runWorkspaceRows = db.prepare(`
    select agent_runs.id, agent_runs.status as run_status, agent_runs.workspace_path, room_run_merges.status as merge_status
    from agent_runs
    left join room_run_merges on room_run_merges.run_id = agent_runs.id
    where agent_runs.workspace_path is not null and agent_runs.workspace_path != ''
  `).all() as Array<{ id: string; run_status: string; workspace_path: string; merge_status?: string | null }>;
  const runWorkspaces = new Map(runWorkspaceRows.map((row) => [resolve(row.workspace_path), row]));
  const previewIds = new Set(Array.from(previews.keys()));

  if (existsSync(internalProjectWorkspaceRoot)) {
    for (const name of readdirSync(internalProjectWorkspaceRoot)) {
      const itemPath = join(internalProjectWorkspaceRoot, name);
      if (!lstatSync(itemPath).isDirectory()) continue;
      const project = projectByWorkspacePath.get(resolve(itemPath));
      const metadata = project ? null : readProjectWorkspaceMetadata(itemPath);
      items.push(storageItem("project-workspace", project ? "active" : "orphan", name, itemPath, project?.id ?? metadata?.id ?? name, project?.name ?? metadata?.name, "project"));
    }
  }

  if (existsSync(sessionWorkspaceRoot)) {
    for (const name of readdirSync(sessionWorkspaceRoot)) {
      const itemPath = join(sessionWorkspaceRoot, name);
      if (!lstatSync(itemPath).isDirectory()) continue;
      const active = activeSessionIds.has(name);
      const session = sessionById.get(name);
      const metadata = session ? null : readSessionStorageMetadata(itemPath);
      items.push(storageItem("session-data", active ? "active" : "orphan", name, itemPath, metadata?.id ?? name, session?.title ?? metadata?.title, "session"));
    }
  }

  const roomsRoot = join(dataDir, "rooms");
  if (existsSync(roomsRoot)) {
    for (const name of readdirSync(roomsRoot)) {
      const itemPath = join(roomsRoot, name);
      if (!lstatSync(itemPath).isDirectory()) continue;
      const active = activeRoomIds.has(name);
      const room = roomById.get(name);
      items.push(storageItem("room-workspace", active ? "active" : "orphan", name, itemPath, name, room?.name, "room"));
      const worktreesRoot = join(itemPath, "worktrees");
      if (!existsSync(worktreesRoot)) continue;
      for (const worktreeName of readdirSync(worktreesRoot)) {
        const worktreePath = join(worktreesRoot, worktreeName);
        if (!lstatSync(worktreePath).isDirectory()) continue;
        const run = runWorkspaces.get(resolve(worktreePath));
        const mergeStatus = run?.merge_status ?? "none";
        const isActive = activeRoomIds.has(name) && Boolean(run && (run.run_status === "running" || mergeStatus === "pending" || mergeStatus === "conflict"));
        items.push(storageItem("room-worktree", isActive ? "active" : "orphan", `${name}/${worktreeName}`, worktreePath, run?.id ?? name, room?.name, run ? "run" : "room"));
      }
    }
  }

  for (const row of db.prepare("select preview_id, updated_at, label from preview_logs").all() as Array<{ preview_id: string; updated_at: string; label?: string | null }>) {
    const logs = previewLogs.get(row.preview_id) ?? "";
    const preview = previews.get(row.preview_id);
    items.push({
      id: createHash("sha1").update(`preview-log:${row.preview_id}`).digest("hex"),
      type: "preview-log",
      status: previewIds.has(row.preview_id) ? "active" : "orphan",
      label: row.preview_id,
      path: `sqlite:preview_logs/${row.preview_id}`,
      bytes: Buffer.byteLength(logs, "utf8"),
      updatedAt: row.updated_at,
      relatedId: row.preview_id,
      relatedName: row.label ?? preview?.label ?? null,
      relatedType: "preview",
    });
  }

  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items, totalBytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

function deleteStorageItem(type: string, itemPath: string, force = false) {
  const item = listStorageItems().items.find((entry) => entry.type === type && entry.path === itemPath);
  if (item?.status === "active" && !force) throw new Error("storage_item_active");
  if (type === "preview-log") {
    const previewId = itemPath.replace(/^sqlite:preview_logs\//, "");
    previewLogs.delete(previewId);
    db.prepare("delete from preview_logs where preview_id = ?").run(previewId);
    return;
  }
  const resolvedPath = resolve(itemPath);
  const allowedRoots = [internalProjectWorkspaceRoot, sessionWorkspaceRoot, join(dataDir, "rooms"), taskLogDir].map((root) => resolve(root));
  if (!allowedRoots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`))) {
    throw new Error("storage_path_not_allowed");
  }
  if (type === "session-data") {
    const sessionId = basename(resolvedPath);
    const session = appData.sessions.find((entry) => entry.id === sessionId);
    const orphanRoomAgent = Boolean(session?.conversationType === "agent" && session.roomId && !db.prepare("select id from rooms where id = ?").get(session.roomId));
    if (orphanRoomAgent) {
      appData.sessions = appData.sessions.filter((entry) => entry.id !== sessionId);
      deleteSessionDatabaseRows(sessionId);
    }
    rmSync(legacyTaskLogPath(sessionId), { force: true });
    rmSync(legacyTaskMetaPath(sessionId), { force: true });
  }
  rmSync(resolvedPath, { recursive: true, force: true });
}

function pathWithinRoot(targetPath: string, rootPath: string) {
  const target = resolve(targetPath);
  const root = resolve(rootPath);
  return target === root || target.startsWith(`${root}/`);
}

function readProjectWorkspaceMetadata(itemPath: string) {
  try {
    const metadataPath = join(itemPath, projectWorkspaceMetadataFile);
    if (!existsSync(metadataPath)) return null;
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as { id?: unknown; name?: unknown; workspacePath?: unknown; orphanedAt?: unknown };
    return {
      id: typeof parsed.id === "string" ? parsed.id : null,
      name: typeof parsed.name === "string" ? parsed.name : null,
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
      orphanedAt: typeof parsed.orphanedAt === "string" ? parsed.orphanedAt : null,
    };
  } catch {
    return null;
  }
}

function readSessionStorageMetadata(itemPath: string) {
  try {
    const metadataPath = join(itemPath, "metadata.json");
    if (!existsSync(metadataPath)) return null;
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as { session?: { id?: unknown; title?: unknown } };
    return {
      id: typeof parsed.session?.id === "string" ? parsed.session.id : null,
      title: typeof parsed.session?.title === "string" ? parsed.session.title : null,
    };
  } catch {
    return null;
  }
}

function writeProjectWorkspaceMetadata(project: ProjectSummary, orphanedAt?: string | null) {
  const workspacePath = resolveTerminalCwd(project.workspacePath);
  if (!pathWithinRoot(workspacePath, internalProjectWorkspaceRoot)) return;
  if (!existsSync(workspacePath)) mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(workspacePath, projectWorkspaceMetadataFile), `${JSON.stringify({
    id: project.id,
    name: project.name,
    workspacePath,
    orphanedAt: orphanedAt ?? null,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeBackupEntryName(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) throw new Error("invalid_backup_entry");
  if (normalized.split("/").some((part) => part === "..")) throw new Error("invalid_backup_entry");
  return normalized;
}

function defaultSystemBackupSettings(): SystemBackupSettings {
  return {
    ignorePatterns: [
      "# 备份忽略规则，语法类似 .gitignore",
      "node_modules/",
      ".DS_Store",
    ],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeSystemBackupSettings(input?: { ignorePatterns?: string[] | string; updatedAt?: string } | null): SystemBackupSettings {
  const rawPatterns = Array.isArray(input?.ignorePatterns)
    ? input!.ignorePatterns
    : typeof input?.ignorePatterns === "string"
      ? input.ignorePatterns.split(/\r?\n/)
      : defaultSystemBackupSettings().ignorePatterns;
  const ignorePatterns = rawPatterns
    .map((line: string) => String(line).replace(/\r/g, "").slice(0, 500))
    .slice(0, 500);
  return {
    ignorePatterns,
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

function loadSystemBackupSettings(): SystemBackupSettings {
  const row = db.prepare("select value from app_settings where key = 'system_backup'").get() as { value: string } | undefined;
  if (!row) return defaultSystemBackupSettings();
  try {
    return sanitizeSystemBackupSettings(JSON.parse(row.value) as Partial<SystemBackupSettings>);
  } catch {
    return defaultSystemBackupSettings();
  }
}

function saveSystemBackupSettings(settings: SystemBackupSettings) {
  db.prepare(`
    insert into app_settings (key, value, updated_at)
    values ('system_backup', ?, ?)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(settings), settings.updatedAt);
}

function loadJsonSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("select value from app_settings where key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function saveJsonSetting(key: string, value: unknown) {
  const updatedAt = new Date().toISOString();
  db.prepare(`
    insert into app_settings (key, value, updated_at)
    values (?, ?, ?)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), updatedAt);
}

function commandVersion(command: string, args: string[]) {
  try {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) return null;
    return [result.stdout, result.stderr].join("\n").trim().split(/\r?\n/)[0] || "installed";
  } catch {
    return null;
  }
}

function detectToolVersion(tool: string) {
  const key = tool.trim().toLowerCase();
  if (!key) return null;
  if (key === "node") return commandVersion("node", ["-v"]);
  if (key === "pnpm") return commandVersion("pnpm", ["-v"]);
  if (key === "python" || key === "python3") return commandVersion("python3", ["--version"]) ?? commandVersion("python", ["--version"]);
  if (key === "git") return commandVersion("git", ["--version"]);
  if (key === "uv") return commandVersion("uv", ["--version"]);
  if (key === "ffmpeg") return commandVersion("ffmpeg", ["-version"]);
  if (key === "go") return commandVersion("go", ["version"]);
  if (key === "bun") return commandVersion("bun", ["--version"]);
  if (key === "mise") return commandVersion("mise", ["--version"]);
  return commandVersion(key, ["--version"]) ?? commandVersion(key, ["version"]);
}

function probeEnvironmentTool(tool: string): EnvironmentToolProbe {
  const detectedVersion = detectToolVersion(tool);
  return {
    tool,
    detectedVersion,
    installed: Boolean(detectedVersion),
  };
}

function detectMiseStatus() {
  try {
    const result = spawnSync("mise", ["--version"], { encoding: "utf8" });
    const output = [result.stdout, result.stderr].join("\n");
    const versionLine = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("[WARN]") && !line.startsWith("mise WARN")) ?? null;
    const warningLine = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("[WARN]") || line.startsWith("mise WARN")) ?? null;
    return {
      installed: result.status === 0,
      version: versionLine,
      warning: warningLine,
    };
  } catch {
    return {
      installed: false,
      version: null,
      warning: "mise_not_installed",
    };
  }
}

function parseRegistryLines(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("[WARN]") && !line.startsWith("mise WARN"))
    .map((line) => {
      const match = line.match(/^(\S+)\s+(.*)$/);
      if (!match) return null;
      const name = match[1]?.trim();
      const rest = match[2]?.trim() ?? "";
      if (!name) return null;
      const backend = rest.split(/\s+/)[0]?.trim() || null;
      return {
        name,
        description: rest || null,
        backend,
      };
    })
    .filter((item): item is EnvironmentToolRegistryItem => Boolean(item));
}

function listEnvironmentToolRegistry(query?: string) {
  const trimmed = query?.trim();
  const args = trimmed ? ["search", trimmed] : ["registry"];
  try {
    const result = spawnSync("mise", args, { encoding: "utf8" });
    if (result.status !== 0) return [];
    const items = parseRegistryLines([result.stdout, result.stderr].join("\n"));
    return items.slice(0, trimmed ? 100 : 400);
  } catch {
    return [];
  }
}

function listEnvironmentToolVersions(tool: string) {
  const trimmed = tool.trim();
  if (!trimmed) return { items: [] as EnvironmentToolVersionItem[], error: "tool_required" as string | null };
  try {
    const result = spawnSync("mise", ["ls-remote", trimmed], { encoding: "utf8" });
    if (result.status !== 0) {
      return {
        items: [] as EnvironmentToolVersionItem[],
        error: [result.stderr, result.stdout].join("\n").trim() || "environment_versions_failed",
      };
    }
    const items = [result.stdout, result.stderr]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("[WARN]") && !line.startsWith("mise WARN"))
      .map((line) => {
        const version = line.split(/\s+/)[0]?.trim();
        return version ? ({ version } satisfies EnvironmentToolVersionItem) : null;
      })
      .filter((item): item is EnvironmentToolVersionItem => Boolean(item))
      .sort((a, b) => compareSemverDesc(a.version, b.version));
    const recommended = recommendEnvironmentToolVersions(trimmed, items);
    const historical = items.filter((item) => !recommended.some((entry) => entry.version === item.version)).slice(0, 80);
    return { items: recommended, history: historical, error: null };
  } catch (error) {
    return {
      items: [] as EnvironmentToolVersionItem[],
      history: [] as EnvironmentToolVersionItem[],
      error: error instanceof Error ? error.message : "environment_versions_failed",
    };
  }
}

function compareSemverDesc(a: string, b: string) {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part.replace(/\D.*$/g, ""), 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

function recommendEnvironmentToolVersions(tool: string, items: EnvironmentToolVersionItem[]) {
  const normalized = tool.trim().toLowerCase();
  if (!items.length) return [];
  if (normalized === "node" || normalized === "python" || normalized === "bun") {
    const latestByMajor = new Map<number, EnvironmentToolVersionItem>();
    for (const item of items) {
      const major = Number.parseInt(item.version.split(".")[0] ?? "", 10);
      if (!Number.isFinite(major)) continue;
      if (!latestByMajor.has(major)) latestByMajor.set(major, item);
    }
    return Array.from(latestByMajor.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, 6)
      .map(([, item], index) => ({ ...item, recommended: index < 3 }));
  }
  return items.slice(0, 12).map((item, index) => ({ ...item, recommended: index < 6 }));
}

function buildEnvironmentOverview(): EnvironmentOverview {
  const raw = loadJsonSetting<EnvironmentOverview>("environment_overview", {
    tools: [],
    packageRecords: [],
    restoreRuns: [],
    reconcile: [],
    projectUsage: [],
    mise: {
      installed: false,
      version: null,
      warning: null,
    },
    updatedAt: new Date().toISOString(),
  });
  const tools = Array.isArray(raw.tools) ? raw.tools : [];
  const packageRecords = Array.isArray(raw.packageRecords) ? raw.packageRecords : [];
  const restoreRuns = Array.isArray(raw.restoreRuns) ? raw.restoreRuns : [];
  const mise = detectMiseStatus();
  const currentOutput = (() => {
    try {
      const result = spawnSync("mise", ["current"], { encoding: "utf8" });
      return result.status === 0 ? [result.stdout, result.stderr].join("\n") : "";
    } catch {
      return "";
    }
  })();
  const normalizedTools = tools.map((tool) => {
    const detectedVersion = detectToolVersion(tool.tool);
    const status: EnvironmentToolRecord["status"] = detectedVersion
      ? (tool.requestedVersion && !detectedVersion.includes(tool.requestedVersion) ? "version_mismatch" : "installed")
      : "missing";
    const isGlobalDefault = currentOutput.split(/\r?\n/).some((line) => {
      const normalized = line.trim().toLowerCase();
      return normalized.startsWith(`${tool.tool.toLowerCase()} `) && normalized.includes(tool.requestedVersion.toLowerCase());
    });
    return {
      ...tool,
      detectedVersion,
      isGlobalDefault,
      status,
      updatedAt: new Date().toISOString(),
    };
  });
  const normalizedPackageRecords = packageRecords.map((pkg) => {
    const toolRecord = normalizedTools.find((tool) => tool.id === pkg.toolRecordId) ?? null;
    const runtimeMissing = toolRecord?.status === "missing";
    const runtimeMismatch = toolRecord?.status === "version_mismatch";
    const pkgStatus = runtimeMissing
      ? "missing"
      : runtimeMismatch
        ? "failed"
        : pkg.status ?? "installed";
    return {
      ...pkg,
      status: pkgStatus,
      updatedAt: new Date().toISOString(),
    };
  });
  const reconcile: EnvironmentReconcileItem[] = [];
  for (const tool of normalizedTools) {
    if (tool.status === "missing") {
      reconcile.push({
        id: `reconcile-tool-missing-${tool.id}`,
        kind: "tool",
        status: "missing_runtime",
        title: `${tool.tool}@${tool.requestedVersion}`,
        detail: "Recorded runtime is missing locally.",
        toolRecordId: tool.id,
      });
    } else if (tool.status === "version_mismatch") {
      reconcile.push({
        id: `reconcile-tool-version-${tool.id}`,
        kind: "tool",
        status: "runtime_version_mismatch",
        title: `${tool.tool}@${tool.requestedVersion}`,
        detail: `Detected ${tool.detectedVersion ?? "unknown"} locally.`,
        toolRecordId: tool.id,
      });
    }
  }
  for (const pkg of normalizedPackageRecords) {
    if (pkg.status === "missing") {
      reconcile.push({
        id: `reconcile-pkg-missing-${pkg.id}`,
        kind: "package",
        status: "missing_package",
        title: `${pkg.packageName} · ${pkg.manager}`,
        detail: `Missing from ${pkg.targetLabel}.`,
        toolRecordId: pkg.toolRecordId ?? null,
        packageRecordId: pkg.id,
      });
    } else if (pkg.versionSpec && pkg.installedVersion && pkg.versionSpec !== pkg.installedVersion) {
      reconcile.push({
        id: `reconcile-pkg-version-${pkg.id}`,
        kind: "package",
        status: "package_version_mismatch",
        title: `${pkg.packageName} · ${pkg.manager}`,
        detail: `Recorded ${pkg.versionSpec}, detected ${pkg.installedVersion}.`,
        toolRecordId: pkg.toolRecordId ?? null,
        packageRecordId: pkg.id,
      });
    }
  }
  const projectUsage: EnvironmentProjectUsage[] = appData.projects.map((project) => {
    const detectedFiles: string[] = [];
    const matchedTools = new Set<string>();
    try {
      const root = resolveTerminalCwd(project.workspacePath);
      const probes: Array<{ file: string; tool: string }> = [
        { file: "package.json", tool: "node" },
        { file: "pnpm-lock.yaml", tool: "node" },
        { file: "requirements.txt", tool: "python" },
        { file: "pyproject.toml", tool: "python" },
        { file: "go.mod", tool: "go" },
        { file: "Cargo.toml", tool: "rust" },
        { file: "Gemfile", tool: "ruby" },
        { file: "composer.json", tool: "php" },
        { file: "deno.json", tool: "deno" },
        { file: "pubspec.yaml", tool: "dart" },
      ];
      for (const probe of probes) {
        if (existsSync(join(root, probe.file))) {
          detectedFiles.push(probe.file);
          matchedTools.add(probe.tool);
        }
      }
    } catch {}
    return {
      projectId: project.id,
      projectName: project.name,
      workspacePath: project.workspacePath,
      matchedTools: [...matchedTools],
      detectedFiles,
    };
  }).filter((item) => item.matchedTools.length || item.detectedFiles.length);
  return {
    tools: normalizedTools,
    packageRecords: normalizedPackageRecords,
    restoreRuns,
    reconcile,
    projectUsage,
    mise: {
      installed: Boolean(mise.installed),
      version: mise.version ?? null,
      warning: mise.warning ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

function saveEnvironmentOverview(overview: EnvironmentOverview) {
  saveJsonSetting("environment_overview", overview);
}

function listPackagesForToolRecord(toolRecord: EnvironmentToolRecord) {
  return environmentOverview.packageRecords
    .filter((item) => item.toolRecordId === toolRecord.id)
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
}

const environmentPackageRegistry = createEnvironmentPackageRegistry(commandVersion);

function environmentPackageManualCleanup(manager: string) {
  return manager === "go-install" || manager === "shards";
}

function buildEnvironmentRestorePreview(toolRecord: EnvironmentToolRecord, packages: EnvironmentPackageRecord[]): EnvironmentRestorePreviewItem[] {
  const items: EnvironmentRestorePreviewItem[] = [];
  items.push({
    id: `preview-tool-${toolRecord.id}`,
    kind: "tool",
    action: toolRecord.status === "missing" ? "install" : toolRecord.status === "version_mismatch" ? "manual" : "record",
    title: `${toolRecord.tool}@${toolRecord.requestedVersion}`,
    detail: toolRecord.status === "missing"
      ? "Runtime needs installation."
      : toolRecord.status === "version_mismatch"
        ? `Detected ${toolRecord.detectedVersion ?? "unknown"} locally.`
        : "Runtime already available locally.",
    command: toolRecord.source === "mise" ? `mise use -g ${toolRecord.tool}@${toolRecord.requestedVersion}` : null,
    toolRecordId: toolRecord.id,
  });
  for (const pkg of packages) {
    items.push({
      id: `preview-package-${pkg.id}`,
      kind: "package",
      action: environmentPackageManualCleanup(pkg.manager)
        ? "manual"
        : pkg.persisted
          ? "record"
          : pkg.status === "missing"
            ? "install"
            : "record",
      title: `${pkg.packageName} · ${pkg.manager}`,
      detail: environmentPackageManualCleanup(pkg.manager)
        ? "Requires manual cleanup or manual install review."
        : pkg.status === "missing"
          ? `Will install into ${pkg.targetLabel}.`
          : `Will record or keep existing install for ${pkg.targetLabel}.`,
      command: pkg.status === "missing" ? pkg.installCommand : null,
      toolRecordId: pkg.toolRecordId ?? null,
      packageRecordId: pkg.id,
    });
  }
  return items;
}

function dataBackupEntries(rootName: string) {
  const entries: Array<{ name: string; data: Buffer; modifiedAt?: Date }> = [];
  const rootPath = resolve(dataDir);
  const shouldExclude = archiveExcluder(systemBackupSettings.ignorePatterns);

  function walk(absolutePath: string, relativePath: string) {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    if (relativePath && shouldExclude(relativePath, stat.isDirectory())) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolutePath)) walk(join(absolutePath, name), relativePath ? `${relativePath}/${name}` : name);
      return;
    }
    if (!stat.isFile()) return;
    const archivePath = safeBackupEntryName(`${rootName}/app-data/${relativePath}`);
    entries.push({ name: archivePath, data: readFileSync(absolutePath), modifiedAt: stat.mtime });
  }

  if (existsSync(rootPath)) walk(rootPath, "");
  return entries;
}

function gitValue(cwd: string, args: string[]) {
  const result = runGitSync(cwd, args);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

function projectBackupReferences(): SystemBackupProjectReference[] {
  return appData.projects.map((project) => {
    let workspacePath = project.workspacePath;
    let exists = false;
    try {
      workspacePath = resolveTerminalCwd(project.workspacePath);
      exists = existsSync(workspacePath);
    } catch {
      workspacePath = project.workspacePath;
    }
    const gitRemote = exists ? gitValue(workspacePath, ["config", "--get", "remote.origin.url"]) : null;
    const gitBranch = exists ? gitValue(workspacePath, ["branch", "--show-current"]) : null;
    const gitCommit = exists ? gitValue(workspacePath, ["rev-parse", "HEAD"]) : null;
    const dirtyOutput = exists ? gitValue(workspacePath, ["status", "--short"]) : null;
    const gitDirty = exists ? Boolean(dirtyOutput) : null;
    return {
      id: project.id,
      name: project.name,
      workspacePath,
      exists,
      gitRemote,
      gitBranch,
      gitCommit,
      gitDirty,
      included: false,
      note: "真实项目源码目录不会随系统备份打包；这里只记录路径和 Git 参考信息。",
    };
  });
}

function buildSystemBackupManifest(warnings: string[] = []): SystemBackupManifest {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    app: "codex-web",
    dataDir,
    ignorePatterns: systemBackupSettings.ignorePatterns,
    included: [
      "apps/api/data/**",
      "备份清单 manifest.json",
      "已绑定项目的路径与 Git 参考信息",
    ],
    excluded: [
      "apps/api/data 之外的真实项目源码目录",
      "构建产物和外部挂载目录",
      "用户配置的备份忽略规则匹配到的 apps/api/data 内文件",
    ],
    projects: projectBackupReferences(),
    warnings: [
      "真实项目目录不会随系统备份打包；还原后如果路径不存在，需要重新绑定项目目录。",
      "Provider API Key 等应用状态会随 apps/api/data 一起备份。请妥善保管备份文件。",
      ...warnings,
    ],
  };
}

function createSystemBackupArchive() {
  const warnings: string[] = [];
  try {
    db.pragma("wal_checkpoint(FULL)");
  } catch {
    warnings.push("SQLite WAL checkpoint 失败，备份仍会继续，但正在写入的数据可能需要重启后再备份一次。");
  }
  const rootName = `codex-web-system-backup-${backupTimestamp()}`;
  const manifest = buildSystemBackupManifest(warnings);
  const entries = [
    { name: `${rootName}/manifest.json`, data: `${JSON.stringify(manifest, null, 2)}\n`, modifiedAt: new Date(manifest.createdAt) },
    ...dataBackupEntries(rootName),
  ];
  const buffer = createZipArchiveWithEntries(entries);
  return { manifest, buffer, entries: entries.length, bytes: buffer.length };
}

function readSystemBackupArchive(buffer: Buffer) {
  const entries = parseStoredZipArchive(buffer);
  const manifestEntry = entries.find((entry) => entry.name.endsWith("/manifest.json") || entry.name === "manifest.json");
  if (!manifestEntry) throw new Error("backup_manifest_missing");
  const rootName = manifestEntry.name.includes("/") ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf("/")) : "";
  const manifest = JSON.parse(manifestEntry.data.toString("utf8")) as SystemBackupManifest;
  if (manifest.app !== "codex-web" || manifest.schemaVersion !== 1) throw new Error("backup_manifest_unsupported");
  const prefix = rootName ? `${rootName}/app-data/` : "app-data/";
  const appDataEntries = entries
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry) => {
      const relativePath = safeBackupEntryName(entry.name.slice(prefix.length));
      if (!relativePath) throw new Error("invalid_backup_entry");
      return { relativePath, data: entry.data };
    });
  return { manifest, entries: appDataEntries, bytes: buffer.length };
}

function systemBackupPreviewFromArchive(buffer: Buffer): SystemBackupPreviewResponse {
  const parsed = readSystemBackupArchive(buffer);
  return {
    ok: true,
    manifest: parsed.manifest,
    entries: parsed.entries.length,
    bytes: parsed.bytes,
    restartRequired: true,
  };
}

async function readBackupUpload(c: { req: { formData: () => Promise<FormData> } }) {
  const form = await c.req.formData();
  const file = form.get("backup");
  if (!file || typeof file === "string" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    throw new Error("backup_file_required");
  }
  return Buffer.from(await (file as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
}

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
  const allowedRoots = managedWorkspaceRoots;
  const candidates = new Set<string>([sessionDataPath(session.id)]);
  if (session.workspacePath) candidates.add(resolve(session.workspacePath));
  if (session.roomId) candidates.add(roomWorkspaceDataPath(session.roomId));
  for (const candidate of candidates) {
    if (!allowedRoots.some((root) => pathWithinRoot(candidate, root))) continue;
    rmSync(candidate, { recursive: true, force: true });
  }
}

function validPreviewHost(value: string) {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

function rewritePreviewHtml(value: string, basePath: string) {
  return value
    .replace(/\b(src|href|action)=(["'])\/(?!\/|preview\/|api\/)/g, `$1=$2${basePath}`)
    .replace(/\bsrcset=(["'])([^"']*)\1/g, (_match, quote: string, srcset: string) => {
      const rewritten = srcset.split(",").map((item) => {
        const trimmed = item.trim();
        const [url = "", ...rest] = trimmed.split(/\s+/);
        if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/preview/") || url.startsWith("/api/")) return trimmed;
        return [`${basePath}${url.slice(1)}`, ...rest].join(" ");
      }).join(", ");
      return `srcset=${quote}${rewritten}${quote}`;
    });
}

function rewritePreviewCss(value: string, basePath: string) {
  return value.replace(/url\((["']?)\/(?!\/|preview\/|api\/)/g, `url($1${basePath}`);
}

function rewritePreviewText(value: string, basePath: string, contentType: string) {
  if (contentType.includes("text/html")) return rewritePreviewCss(rewritePreviewHtml(value, basePath), basePath);
  if (contentType.includes("text/css")) return rewritePreviewCss(value, basePath);
  return value;
}

function rewritePreviewLocation(value: string | null, upstreamUrl: URL, basePath: string) {
  if (!value) return value;
  try {
    const target = new URL(value, upstreamUrl);
    if (target.origin !== upstreamUrl.origin) return value;
    return `${basePath}${target.pathname.replace(/^\/+/, "")}${target.search}${target.hash}`;
  } catch {
    return value;
  }
}

function previewFromReferer(value?: string | null) {
  if (!value) return null;
  try {
    const refererUrl = new URL(value, `http://${host}:${apiPort}`);
    const parts = refererUrl.pathname.split("/").filter(Boolean);
    if (parts[0] !== "preview") return null;
    const previewId = parts[1] ? decodeURIComponent(parts[1]) : "";
    const token = parts[2] ? decodeURIComponent(parts[2]) : "";
    const preview = previews.get(previewId);
    return preview && preview.token === token ? preview : null;
  } catch {
    return null;
  }
}

function previewUpstreamPathFromUrl(sourceUrl: URL, preview: PreviewRecord) {
  const previewId = encodeURIComponent(preview.id);
  const token = encodeURIComponent(preview.token);
  let parts = sourceUrl.pathname.split("/").filter(Boolean).slice(3);
  while (parts[0] === "preview" && parts[1] === previewId && parts[2] === token) {
    parts = parts.slice(3);
  }
  return parts.join("/");
}

function previewScopeWorkspace(scopeType: PreviewRecord["scopeType"], scopeId: string) {
  if (scopeType === "project") return appData.projects.find((project) => project.id === scopeId)?.workspacePath ?? null;
  if (scopeType === "folder") {
    const folderPath = resolve(scopeId);
    return existsSync(folderPath) && statSync(folderPath).isDirectory() ? folderPath : null;
  }
  return appData.sessions.find((session) => session.id === scopeId)?.workspacePath ?? null;
}

function resolvePreviewCwd(preview: PreviewRecord, requestedCwd?: string) {
  const workspace = previewScopeWorkspace(preview.scopeType, preview.scopeId);
  if (!workspace) return null;
  const absoluteWorkspace = resolve(workspace);
  const absoluteCwd = resolve(absoluteWorkspace, requestedCwd?.trim() || ".");
  const relativePath = relative(absoluteWorkspace, absoluteCwd);
  if (relativePath.startsWith("..") || relativePath === ".." || relativePath.startsWith("/") || relativePath.startsWith("\\")) return null;
  return absoluteCwd;
}

function stopPreviewProcess(previewId: string) {
  const child = previewProcesses.get(previewId);
  const processGroupId = child?.pid ?? previewProcessGroups.get(previewId);
  if (processGroupId && process.platform !== "win32") {
    try {
      process.kill(-processGroupId, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-processGroupId, "SIGKILL");
        } catch {
          // Process group already exited.
        }
      }, 2500).unref();
    } catch {
      child?.kill("SIGTERM");
    }
  } else {
    child?.kill("SIGTERM");
  }
  previewProcesses.delete(previewId);
  previewProcessGroups.delete(previewId);
}

function previewUsingPort(preview: Pick<PreviewRecord, "id" | "targetHost" | "port">) {
  return Array.from(previews.values()).find((item) =>
    item.id !== preview.id
    && item.targetHost === preview.targetHost
    && item.port === preview.port
    && (item.status === "running" || item.status === "starting")
  ) ?? null;
}

function appendPreviewLog(previewId: string, value: string) {
  const current = previewLogs.get(previewId) ?? "";
  const logs = (current + value).slice(-128 * 1024);
  const label = previews.get(previewId)?.label ?? null;
  previewLogs.set(previewId, logs);
  db.prepare(`
    insert into preview_logs (preview_id, label, logs, updated_at)
    values (?, ?, ?, ?)
    on conflict(preview_id) do update set
      label = coalesce(excluded.label, preview_logs.label),
      logs = excluded.logs,
      updated_at = excluded.updated_at
  `).run(previewId, label, logs, new Date().toISOString());
  publishPreviewLogEvent(previewId, { type: "log", previewId, chunk: value, at: new Date().toISOString() });
}

async function isPreviewReachable(preview: PreviewRecord) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`http://${preview.targetHost}:${preview.port}/`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    return response;
  } catch {
    return null;
  }
}

async function waitForPreviewReady(preview: PreviewRecord) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const current = previews.get(preview.id);
    if (!current || current.status !== "starting") return;
    const response = await isPreviewReachable(preview);
    if (response) {
      current.status = "running";
      updatePreview(current);
      appendPreviewLog(preview.id, `[ready] upstream responded with ${response.status}\n`);
      return;
    }
  }
  const current = previews.get(preview.id);
  if (!current || current.status !== "starting") return;
  current.status = "error";
  updatePreview(current);
  appendPreviewLog(preview.id, "[error] upstream did not become ready within 12s\n");
}

async function settlePreviewProcessExit(previewId: string, exitCode: number | null) {
  previewProcesses.delete(previewId);
  const current = previews.get(previewId);
  if (!current || (current.status !== "running" && current.status !== "starting")) return;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  const response = await isPreviewReachable(current);
  if (response && exitCode === 0) {
    current.status = "running";
    updatePreview(current);
    appendPreviewLog(previewId, `\n[exit] shell exited with ${exitCode}, upstream still responds with ${response.status}\n`);
    return;
  }
  previewProcessGroups.delete(previewId);
  current.status = exitCode === 0 ? "stopped" : "error";
  updatePreview(current);
  appendPreviewLog(previewId, `\n[exit] ${exitCode}\n`);
}

function startPreviewProcess(preview: PreviewRecord) {
  if (!preview.command?.trim()) throw new Error("preview_command_required");
  const cwd = resolvePreviewCwd(preview, preview.cwd);
  if (!cwd) throw new Error("invalid_preview_cwd");
  const conflict = previewUsingPort(preview);
  if (conflict) {
    appendPreviewLog(preview.id, `[error] port ${preview.targetHost}:${preview.port} is already used by ${conflict.label}\n`);
    throw new Error("preview_port_in_use");
  }
  stopPreviewProcess(preview.id);
  preview.cwd = cwd;
  preview.status = "starting";
  updatePreview(preview);
  appendPreviewLog(preview.id, `\n[start] ${new Date().toISOString()}\n$ ${preview.command}\ncwd: ${toTerminalPath(cwd)}\n`);
  const child = spawnProcess(preview.command, {
    cwd,
    shell: true,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      HOST: "0.0.0.0",
      PORT: String(preview.port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  previewProcesses.set(preview.id, child);
  if (child.pid) previewProcessGroups.set(preview.id, child.pid);
  child.stdout?.on("data", (data) => appendPreviewLog(preview.id, data.toString()));
  child.stderr?.on("data", (data) => appendPreviewLog(preview.id, data.toString()));
  child.once("exit", (exitCode) => {
    void settlePreviewProcessExit(preview.id, exitCode);
  });
  void waitForPreviewReady(preview);
}

function pauseStaleRunningSessions() {
  let changed = false;
  for (const session of appData.sessions) {
    if (session.status === "running") {
      const runningTaskRun = latestRunningTaskRun(session.id);
      const pid = typeof runningTaskRun?.pid === "number" ? runningTaskRun.pid : null;
      const meta = readTaskMeta(session.id);
      if (meta && meta.running === false && (typeof meta.exitCode === "number" || meta.exitCode === null || meta.error)) {
        backfillSessionFromTaskLog(session);
        codexTaskOutputs.set(session.id, readCodexOutput(session.id));
        finalizeCodexRunnerTask(session, typeof meta.exitCode === "number" ? meta.exitCode : null, meta.error ?? "api_recovered_finished_runner");
        changed = true;
        continue;
      }
      if (isProcessAlive(pid)) {
        backfillSessionFromTaskLog(session);
        codexTaskOutputs.set(session.id, readCodexOutput(session.id));
        startCodexTaskTailer(session, { finalizeOnExit: true });
        session.updatedAt = new Date().toISOString();
        recordTaskActivity(session.id, {
          type: "activity",
          kind: "tool",
          label: "任务流已恢复",
          detail: `runner pid ${pid}`,
          status: "in_progress",
          at: session.updatedAt,
        });
        changed = true;
        continue;
      }
      if (recoverRoomAgentRunFromLog(session)) {
        changed = true;
        continue;
      }
      session.status = "interrupted";
      session.updatedAt = new Date().toISOString();
      finishTaskRun(session.id, "interrupted", null, pid ? "api_restarted_process_missing" : "api_restarted_no_process");
      appendSessionMessage(session.id, "system", `API restarted at ${session.updatedAt}; the previous Codex process was marked interrupted.`);
      recordTaskActivity(session.id, {
        type: "activity",
        kind: "tool",
        label: "任务已标记为中断",
        detail: pid ? `api_restarted_process_missing pid ${pid}` : "api_restarted_no_process",
        status: "failed",
        at: session.updatedAt,
      });
      changed = true;
    }
  }
  if (changed) saveAppData();
}

function latestAssistantTextFromTaskLog(sessionId: string) {
  let latest = "";
  for (const line of readTaskLogContent(sessionId).split(/\r?\n/)) {
    const text = readAssistantText(line);
    if (text?.trim()) latest = text.trim();
  }
  return latest;
}

function recoverRoomAgentRunFromLog(session: SessionSummary) {
  if (session.conversationType !== "agent" || !session.roomId) return false;
  const run = db.prepare("select * from agent_runs where session_id = ? and status = 'running'").get(session.id) as Record<string, unknown> | undefined;
  if (!run) return false;
  const assistantText = latestAssistantTextFromTaskLog(session.id);
  if (!assistantText) return false;
  const existing = db.prepare("select id from messages where session_id = ? and role = 'assistant' and content = ? limit 1").get(session.id, assistantText);
  if (!existing) appendSessionMessage(session.id, "assistant", assistantText);
  session.status = "done";
  session.updatedAt = new Date().toISOString();
  upsertSession(session);
  finishTaskRun(session.id, "done", 0, "api_recovered_from_log");
  finishAgentRun(session.id, 0, false);
  return true;
}

function recoverInterruptedRoomAgentRunsFromLogs() {
  let changed = false;
  for (const session of appData.sessions) {
    if (session.status !== "interrupted") continue;
    if (recoverRoomAgentRunFromLog(session)) changed = true;
  }
  if (changed) saveAppData();
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function jsonPayload(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

function goalMode(value: unknown, fallback: GoalMode = "reference"): GoalMode {
  return value === "tracked" || value === "managed" || value === "orchestrated" || value === "reference" ? value : fallback;
}

function goalStatus(value: unknown, fallback: GoalStatus = "active"): GoalStatus {
  return value === "paused" || value === "completed" || value === "cancelled" || value === "archived" || value === "active" ? value : fallback;
}

function goalFocusStatus(value: unknown, fallback: GoalFocusStatus = "active"): GoalFocusStatus {
  return value === "completed" || value === "cancelled" || value === "paused" || value === "active" ? value : fallback;
}

function goalItemStatus(value: unknown, fallback: GoalItemStatus = "planned"): GoalItemStatus {
  return value === "active" || value === "blocked" || value === "completed" || value === "failed" || value === "cancelled" || value === "planned" ? value : fallback;
}

function goalOwnerType(value: unknown): GoalOwnerType | null {
  return value === "session" || value === "agent_session" || value === "room" ? value : null;
}

function goalFocusFromRow(row: Record<string, unknown>): GoalFocusSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    text: String(row.text),
    status: goalFocusStatus(row.status),
    ownerAgentId: row.owner_agent_id ? String(row.owner_agent_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

function goalItemFromRow(row: Record<string, unknown>): GoalItemSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    roomTaskId: row.room_task_id ? String(row.room_task_id) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    status: goalItemStatus(row.status),
    assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    priority: Number(row.priority) || 0,
    dependsOnItemId: row.depends_on_item_id ? String(row.depends_on_item_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

function goalEventFromRow(row: Record<string, unknown>): GoalEventSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    type: String(row.type),
    actorType: row.actor_type ? String(row.actor_type) : null,
    actorId: row.actor_id ? String(row.actor_id) : null,
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
  };
}

function goalProposalKind(value: unknown): GoalProposalKind {
  return value === "focus" || value === "item" || value === "plan" || value === "goal_update" ? value : "goal_update";
}

function goalProposalStatus(value: unknown): GoalProposalStatus {
  return value === "approved" || value === "rejected" || value === "pending" ? value : "pending";
}

function goalProposalFromRow(row: Record<string, unknown>): GoalProposalSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    kind: goalProposalKind(row.kind),
    status: goalProposalStatus(row.status),
    title: String(row.title),
    payload: jsonPayload(row.payload),
    proposedByAgentId: row.proposed_by_agent_id ? String(row.proposed_by_agent_id) : null,
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function goalProgress(goalId: string, progressSummary?: string | null): GoalSummary["progress"] {
  const rows = db.prepare("select status, updated_at from goal_items where goal_id = ?").all(goalId) as Array<{ status?: string; updated_at?: string }>;
  const activeStatuses = new Set(["planned", "active"]);
  return {
    totalItems: rows.length,
    activeItems: rows.filter((item) => activeStatuses.has(String(item.status))).length,
    completedItems: rows.filter((item) => item.status === "completed").length,
    failedItems: rows.filter((item) => item.status === "failed").length,
    blockedItems: rows.filter((item) => item.status === "blocked").length,
    latestSummary: progressSummary ?? null,
    updatedAt: rows.map((item) => item.updated_at ? String(item.updated_at) : "").filter(Boolean).sort().pop() ?? null,
  };
}

function currentGoalFocus(goalId: string) {
  const row = db.prepare(`
    select * from goal_focuses
    where goal_id = ? and status in ('active', 'paused')
    order by updated_at desc, id desc
    limit 1
  `).get(goalId) as Record<string, unknown> | undefined;
  return row ? goalFocusFromRow(row) : null;
}

function goalFromRow(row: Record<string, unknown>): GoalSummary {
  return {
    id: String(row.id),
    ownerType: goalOwnerType(row.owner_type) ?? "session",
    ownerId: String(row.owner_id),
    text: String(row.text),
    mode: goalMode(row.mode),
    status: goalStatus(row.status),
    managerAgentId: row.manager_agent_id ? String(row.manager_agent_id) : null,
    coordinatorAgentId: row.coordinator_agent_id ? String(row.coordinator_agent_id) : null,
    currentFocus: currentGoalFocus(String(row.id)),
    progress: goalProgress(String(row.id), row.progress_summary ? String(row.progress_summary) : null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

function activeGoalForOwner(ownerType: GoalOwnerType, ownerId?: string | null) {
  if (!ownerId) return null;
  const row = db.prepare(`
    select * from goals
    where owner_type = ? and owner_id = ? and status in ('active', 'paused')
    order by updated_at desc, id desc
    limit 1
  `).get(ownerType, ownerId) as Record<string, unknown> | undefined;
  return row ? goalFromRow(row) : null;
}

function activeGoalForSession(session: Pick<SessionSummary, "id" | "conversationType" | "roomId" | "directAgentId">) {
  if (session.roomId) return activeGoalForOwner("room", session.roomId);
  if (session.conversationType === "agent" || session.directAgentId) return activeGoalForOwner("agent_session", session.id);
  return activeGoalForOwner("session", session.id);
}

function assertGoalOwner(ownerType: GoalOwnerType, ownerId: string) {
  if (ownerType === "room") {
    if (!db.prepare("select id from rooms where id = ?").get(ownerId)) throw new Error("room_not_found");
    return;
  }
  if (!appData.sessions.some((session) => session.id === ownerId)) throw new Error("session_not_found");
}

type GoalActor = { type: "user"; agentId: null } | { type: "agent"; agentId: string };

function goalActorFromRequest(c: { req: { header: (name: string) => string | undefined } }, body?: Record<string, unknown> | null): GoalActor {
  const agentId = c.req.header("x-codex-agent-id")?.trim()
    || c.req.header("x-agent-id")?.trim()
    || (typeof body?.actorAgentId === "string" ? body.actorAgentId.trim() : "")
    || (typeof body?.proposedByAgentId === "string" ? body.proposedByAgentId.trim() : "");
  if (!agentId) return { type: "user", agentId: null };
  if (!db.prepare("select id from agents where id = ?").get(agentId)) throw new Error("agent_actor_not_found");
  return { type: "agent", agentId };
}

function canAgentManageGoal(goal: GoalSummary, agentId: string) {
  if (goal.managerAgentId === agentId || goal.coordinatorAgentId === agentId) return true;
  if (goal.ownerType !== "room") return false;
  const membership = db.prepare("select listen_mode from room_agents where room_id = ? and agent_id = ?").get(goal.ownerId, agentId) as { listen_mode?: string } | undefined;
  if (!membership) return false;
  if (membership.listen_mode === "orchestrator") return true;
  const agent = db.prepare("select name, role_id from agents where id = ?").get(agentId) as { name?: string; role_id?: string } | undefined;
  const roleId = agent?.role_id?.toLowerCase() ?? "";
  const name = agent?.name?.toLowerCase() ?? "";
  return roleId.includes("product") || roleId.includes("manager") || name.includes("pm") || name.includes("product");
}

function assertCanManageGoal(goal: GoalSummary, actor: GoalActor) {
  if (actor.type === "user") return;
  if (canAgentManageGoal(goal, actor.agentId)) return;
  throw new Error("goal_agent_must_propose");
}

function assertCanUpdateGoalItem(goalId: string, itemId: string, actor: GoalActor) {
  if (actor.type === "user") return;
  const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown>);
  if (canAgentManageGoal(goal, actor.agentId)) return;
  const item = db.prepare("select assigned_agent_id from goal_items where id = ? and goal_id = ?").get(itemId, goalId) as { assigned_agent_id?: string | null } | undefined;
  if (item?.assigned_agent_id === actor.agentId) return;
  throw new Error("goal_item_agent_not_assigned");
}

function recordGoalEvent(goalId: string, type: string, payload: unknown = {}, actorType?: string | null, actorId?: string | null) {
  const now = new Date().toISOString();
  db.prepare(`
    insert into goal_events (id, goal_id, type, actor_type, actor_id, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(`goal-event-${randomUUID()}`, goalId, type, actorType ?? null, actorId ?? null, JSON.stringify(payload ?? {}), now);
}

function ownerDefaultGoalMode(ownerType: GoalOwnerType, requested?: GoalMode): GoalMode {
  if (requested) return requested;
  return ownerType === "room" ? "orchestrated" : "reference";
}

function createGoal(input: CreateGoalRequest, actorType = "user", actorId?: string | null): GoalSummary {
  const ownerType = goalOwnerType(input.ownerType);
  const ownerId = String(input.ownerId ?? "");
  const text = String(input.text ?? "").trim();
  if (!ownerType || !ownerId || !text) throw new Error("invalid_goal");
  assertGoalOwner(ownerType, ownerId);
  const now = new Date().toISOString();
  const existing = activeGoalForOwner(ownerType, ownerId);
  if (existing) {
    db.prepare("update goals set status = 'archived', updated_at = ? where id = ?").run(now, existing.id);
    recordGoalEvent(existing.id, "goal.archived", { reason: "replaced", replacementOwnerType: ownerType, replacementOwnerId: ownerId }, actorType, actorId);
  }
  const id = `goal-${randomUUID()}`;
  db.prepare(`
    insert into goals (id, owner_type, owner_id, text, mode, status, manager_agent_id, coordinator_agent_id, progress_summary, created_at, updated_at, completed_at, cancelled_at)
    values (?, ?, ?, ?, ?, 'active', ?, ?, null, ?, ?, null, null)
  `).run(id, ownerType, ownerId, text, ownerDefaultGoalMode(ownerType, input.mode), input.managerAgentId ?? null, input.coordinatorAgentId ?? null, now, now);
  recordGoalEvent(id, "goal.created", { ownerType, ownerId, text }, actorType, actorId);
  if (input.focusText?.trim()) createGoalFocus(id, { text: input.focusText, ownerAgentId: input.focusOwnerAgentId ?? null }, actorType, actorId);
  return goalFromRow(db.prepare("select * from goals where id = ?").get(id) as Record<string, unknown>);
}

function updateGoal(id: string, input: UpdateGoalRequest, actorType = "user", actorId?: string | null): GoalSummary {
  const current = db.prepare("select * from goals where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) throw new Error("goal_not_found");
  const now = new Date().toISOString();
  const nextStatus = input.status ? goalStatus(input.status, goalStatus(current.status)) : goalStatus(current.status);
  const completedAt = nextStatus === "completed" ? String(current.completed_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.completed_at ?? null);
  const cancelledAt = nextStatus === "cancelled" ? String(current.cancelled_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.cancelled_at ?? null);
  db.prepare(`
    update goals
    set text = ?, mode = ?, status = ?, manager_agent_id = ?, coordinator_agent_id = ?, progress_summary = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
    where id = ?
  `).run(
    input.text !== undefined ? String(input.text).trim() || String(current.text) : String(current.text),
    input.mode ? goalMode(input.mode, goalMode(current.mode)) : goalMode(current.mode),
    nextStatus,
    input.managerAgentId !== undefined ? input.managerAgentId : current.manager_agent_id ?? null,
    input.coordinatorAgentId !== undefined ? input.coordinatorAgentId : current.coordinator_agent_id ?? null,
    input.progressSummary !== undefined ? input.progressSummary?.trim() || null : current.progress_summary ?? null,
    completedAt,
    cancelledAt,
    now,
    id,
  );
  recordGoalEvent(id, "goal.updated", input, actorType, actorId);
  return goalFromRow(db.prepare("select * from goals where id = ?").get(id) as Record<string, unknown>);
}

function createGoalFocus(goalId: string, input: CreateGoalFocusRequest, actorType = "user", actorId?: string | null): GoalFocusSummary {
  const goal = db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown> | undefined;
  if (!goal) throw new Error("goal_not_found");
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("invalid_goal_focus");
  const now = new Date().toISOString();
  db.prepare("update goal_focuses set status = 'completed', completed_at = coalesce(completed_at, ?), updated_at = ? where goal_id = ? and status in ('active', 'paused')").run(now, now, goalId);
  const id = `goal-focus-${randomUUID()}`;
  db.prepare(`
    insert into goal_focuses (id, goal_id, text, status, owner_agent_id, created_at, updated_at, completed_at, cancelled_at)
    values (?, ?, ?, 'active', ?, ?, ?, null, null)
  `).run(id, goalId, text, input.ownerAgentId ?? null, now, now);
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  recordGoalEvent(goalId, "focus.created", { focusId: id, text, ownerAgentId: input.ownerAgentId ?? null }, actorType, actorId);
  return goalFocusFromRow(db.prepare("select * from goal_focuses where id = ?").get(id) as Record<string, unknown>);
}

function updateGoalFocus(goalId: string, focusId: string, input: UpdateGoalFocusRequest, actorType = "user", actorId?: string | null): GoalFocusSummary {
  const current = db.prepare("select * from goal_focuses where id = ? and goal_id = ?").get(focusId, goalId) as Record<string, unknown> | undefined;
  if (!current) throw new Error("goal_focus_not_found");
  const now = new Date().toISOString();
  const nextStatus = input.status ? goalFocusStatus(input.status, goalFocusStatus(current.status)) : goalFocusStatus(current.status);
  db.prepare(`
    update goal_focuses
    set text = ?, status = ?, owner_agent_id = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
    where id = ? and goal_id = ?
  `).run(
    input.text !== undefined ? String(input.text).trim() || String(current.text) : String(current.text),
    nextStatus,
    input.ownerAgentId !== undefined ? input.ownerAgentId : current.owner_agent_id ?? null,
    nextStatus === "completed" ? String(current.completed_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.completed_at ?? null),
    nextStatus === "cancelled" ? String(current.cancelled_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.cancelled_at ?? null),
    now,
    focusId,
    goalId,
  );
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  recordGoalEvent(goalId, "focus.updated", { focusId, ...input }, actorType, actorId);
  return goalFocusFromRow(db.prepare("select * from goal_focuses where id = ?").get(focusId) as Record<string, unknown>);
}

function createGoalItem(goalId: string, input: CreateGoalItemRequest, actorType = "user", actorId?: string | null): GoalItemSummary {
  if (!db.prepare("select id from goals where id = ?").get(goalId)) throw new Error("goal_not_found");
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("invalid_goal_item");
  const now = new Date().toISOString();
  const id = `goal-item-${randomUUID()}`;
  db.prepare(`
    insert into goal_items (id, goal_id, room_task_id, title, description, status, assigned_agent_id, priority, depends_on_item_id, created_at, updated_at, completed_at, cancelled_at)
    values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, null, null)
  `).run(id, goalId, title, input.description?.trim() || null, goalItemStatus(input.status), input.assignedAgentId ?? null, Number(input.priority ?? 0) || 0, input.dependsOnItemId ?? null, now, now);
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  recordGoalEvent(goalId, "item.created", { itemId: id, title }, actorType, actorId);
  return goalItemFromRow(db.prepare("select * from goal_items where id = ?").get(id) as Record<string, unknown>);
}

function updateGoalItem(goalId: string, itemId: string, input: UpdateGoalItemRequest, actorType = "user", actorId?: string | null): GoalItemSummary {
  const current = db.prepare("select * from goal_items where id = ? and goal_id = ?").get(itemId, goalId) as Record<string, unknown> | undefined;
  if (!current) throw new Error("goal_item_not_found");
  const now = new Date().toISOString();
  const nextStatus = input.status ? goalItemStatus(input.status, goalItemStatus(current.status)) : goalItemStatus(current.status);
  db.prepare(`
    update goal_items
    set room_task_id = ?, title = ?, description = ?, status = ?, assigned_agent_id = ?, priority = ?, depends_on_item_id = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
    where id = ? and goal_id = ?
  `).run(
    input.roomTaskId !== undefined ? input.roomTaskId : current.room_task_id ?? null,
    input.title !== undefined ? String(input.title).trim() || String(current.title) : String(current.title),
    input.description !== undefined ? input.description?.trim() || null : current.description ?? null,
    nextStatus,
    input.assignedAgentId !== undefined ? input.assignedAgentId : current.assigned_agent_id ?? null,
    input.priority !== undefined ? Number(input.priority) || 0 : Number(current.priority ?? 0) || 0,
    input.dependsOnItemId !== undefined ? input.dependsOnItemId : current.depends_on_item_id ?? null,
    nextStatus === "completed" ? String(current.completed_at ?? now) : (nextStatus === "planned" || nextStatus === "active" || nextStatus === "blocked" ? null : current.completed_at ?? null),
    nextStatus === "cancelled" ? String(current.cancelled_at ?? now) : (nextStatus === "planned" || nextStatus === "active" || nextStatus === "blocked" ? null : current.cancelled_at ?? null),
    now,
    itemId,
    goalId,
  );
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  if (input.roomTaskId !== undefined) db.prepare("update room_tasks set goal_item_id = ? where id = ?").run(itemId, input.roomTaskId);
  recordGoalEvent(goalId, "item.updated", { itemId, ...input }, actorType, actorId);
  if ((nextStatus === "blocked" || nextStatus === "failed") && String(current.status) !== nextStatus) {
    createReplanProposal(goalId, itemId, nextStatus, actorType, actorId);
  }
  return goalItemFromRow(db.prepare("select * from goal_items where id = ?").get(itemId) as Record<string, unknown>);
}

function listGoalProposals(goalId: string) {
  return (db.prepare("select * from goal_proposals where goal_id = ? order by status asc, created_at desc, id desc").all(goalId) as Array<Record<string, unknown>>).map(goalProposalFromRow);
}

function createGoalProposal(goalId: string, input: { kind?: unknown; title?: unknown; payload?: unknown; proposedByAgentId?: unknown }, actorType = "agent", actorId?: string | null) {
  if (!db.prepare("select id from goals where id = ?").get(goalId)) throw new Error("goal_not_found");
  const kind = goalProposalKind(input.kind);
  const title = String(input.title ?? "").trim() || kind;
  const id = `goal-proposal-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    insert into goal_proposals (id, goal_id, kind, status, title, payload, proposed_by_agent_id, created_at, resolved_at)
    values (?, ?, ?, 'pending', ?, ?, ?, ?, null)
  `).run(id, goalId, kind, title, JSON.stringify(input.payload ?? {}), input.proposedByAgentId ? String(input.proposedByAgentId) : actorId ?? null, now);
  recordGoalEvent(goalId, "proposal.created", { proposalId: id, kind, title }, actorType, actorId);
  return goalProposalFromRow(db.prepare("select * from goal_proposals where id = ?").get(id) as Record<string, unknown>);
}

function applyGoalProposal(goalId: string, proposalId: string, actorType = "user", actorId?: string | null) {
  const row = db.prepare("select * from goal_proposals where id = ? and goal_id = ?").get(proposalId, goalId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("goal_proposal_not_found");
  const proposal = goalProposalFromRow(row);
  if (proposal.status !== "pending") return proposal;
  const payload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload as Record<string, unknown> : {};
  if (proposal.kind === "goal_update") {
    updateGoal(goalId, {
      text: typeof payload.text === "string" ? payload.text : undefined,
      mode: payload.mode === "reference" || payload.mode === "tracked" || payload.mode === "managed" || payload.mode === "orchestrated" ? payload.mode : undefined,
      progressSummary: typeof payload.progressSummary === "string" ? payload.progressSummary : undefined,
    }, actorType, actorId);
  } else if (proposal.kind === "focus") {
    createGoalFocus(goalId, { text: String(payload.text ?? proposal.title), ownerAgentId: typeof payload.ownerAgentId === "string" ? payload.ownerAgentId : null }, actorType, actorId);
  } else if (proposal.kind === "item") {
    createGoalItem(goalId, {
      title: String(payload.title ?? proposal.title),
      description: typeof payload.description === "string" ? payload.description : null,
      assignedAgentId: typeof payload.assignedAgentId === "string" ? payload.assignedAgentId : null,
      priority: Number(payload.priority ?? 0) || 0,
    }, actorType, actorId);
  } else if (proposal.kind === "plan") {
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    for (const rawItem of rawItems.slice(0, 20)) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const title = String(item.title ?? "").trim();
      if (!title) continue;
      createGoalItem(goalId, {
        title,
        description: typeof item.description === "string" ? item.description : null,
        assignedAgentId: typeof item.assignedAgentId === "string" ? item.assignedAgentId : null,
        priority: Number(item.priority ?? 0) || 0,
      }, actorType, actorId);
    }
  }
  const now = new Date().toISOString();
  db.prepare("update goal_proposals set status = 'approved', resolved_at = ? where id = ? and goal_id = ?").run(now, proposalId, goalId);
  recordGoalEvent(goalId, "proposal.approved", { proposalId, kind: proposal.kind }, actorType, actorId);
  return goalProposalFromRow(db.prepare("select * from goal_proposals where id = ?").get(proposalId) as Record<string, unknown>);
}

function rejectGoalProposal(goalId: string, proposalId: string, actorType = "user", actorId?: string | null) {
  const row = db.prepare("select * from goal_proposals where id = ? and goal_id = ?").get(proposalId, goalId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("goal_proposal_not_found");
  const now = new Date().toISOString();
  db.prepare("update goal_proposals set status = 'rejected', resolved_at = ? where id = ? and goal_id = ? and status = 'pending'").run(now, proposalId, goalId);
  recordGoalEvent(goalId, "proposal.rejected", { proposalId }, actorType, actorId);
  return goalProposalFromRow(db.prepare("select * from goal_proposals where id = ?").get(proposalId) as Record<string, unknown>);
}

function createDefaultGoalPlan(goalId: string, actorType = "user", actorId?: string | null) {
  const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown>);
  const existing = (db.prepare("select * from goal_items where goal_id = ? and status not in ('cancelled')").all(goalId) as Array<Record<string, unknown>>).map(goalItemFromRow);
  if (existing.length) return existing;
  const roomAgents = goal.ownerType === "room"
    ? (db.prepare("select agent_id from room_agents where room_id = ? order by joined_at asc").all(goal.ownerId) as Array<{ agent_id: string }>).map((row) => row.agent_id)
    : [];
  const templates = [
    { title: "需求澄清与范围确认", description: goal.text, priority: 50, assignedAgentId: roomAgents[0] ?? null },
    { title: "方案设计与任务拆解", description: goal.currentFocus?.text ?? goal.text, priority: 40, assignedAgentId: roomAgents[1] ?? roomAgents[0] ?? null },
    { title: "实现与验证", description: goal.text, priority: 30, assignedAgentId: roomAgents[2] ?? roomAgents[0] ?? null },
    { title: "审查、修正与交付总结", description: goal.text, priority: 20, assignedAgentId: roomAgents[3] ?? roomAgents[0] ?? null },
  ];
  const items = templates.map((item) => createGoalItem(goalId, { ...item, status: "planned" }, actorType, actorId));
  recordGoalEvent(goalId, "goal.planned", { itemIds: items.map((item) => item.id) }, actorType, actorId);
  return items;
}

function createReplanProposal(goalId: string, itemId: string, status: "blocked" | "failed", actorType = "system", actorId?: string | null) {
  const item = goalItemFromRow(db.prepare("select * from goal_items where id = ? and goal_id = ?").get(itemId, goalId) as Record<string, unknown>);
  const duplicate = (db.prepare(`
    select id from goal_proposals
    where goal_id = ? and status = 'pending' and kind = 'plan' and json_extract(payload, '$.sourceItemId') = ?
    limit 1
  `).get(goalId, itemId) as { id?: string } | undefined);
  if (duplicate) return null;
  const title = status === "blocked" ? `重新规划阻塞项：${item.title}` : `重新规划失败项：${item.title}`;
  const payload = {
    sourceItemId: item.id,
    sourceStatus: status,
    reason: status === "blocked" ? "Goal item was marked blocked" : "Goal item or linked Room task failed",
    items: [
      {
        title: `诊断并解除阻塞：${item.title}`,
        description: item.description || item.title,
        assignedAgentId: item.assignedAgentId ?? null,
        priority: item.priority + 10,
      },
      {
        title: `验证替代方案：${item.title}`,
        description: "确认重新规划后的方案可以继续推进，并更新 Goal item 状态。",
        assignedAgentId: item.assignedAgentId ?? null,
        priority: item.priority + 5,
      },
    ],
  };
  return createGoalProposal(goalId, { kind: "plan", title, payload, proposedByAgentId: actorType === "agent" ? actorId : null }, actorType, actorId);
}

function goalDetail(goalId: string): GoalDetailResponse {
  const row = db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("goal_not_found");
  const focuses = (db.prepare("select * from goal_focuses where goal_id = ? order by updated_at desc, id desc").all(goalId) as Array<Record<string, unknown>>).map(goalFocusFromRow);
  const items = (db.prepare("select * from goal_items where goal_id = ? order by priority desc, updated_at desc, id desc").all(goalId) as Array<Record<string, unknown>>).map(goalItemFromRow);
  const events = (db.prepare("select * from goal_events where goal_id = ? order by created_at desc, id desc limit 80").all(goalId) as Array<Record<string, unknown>>).map(goalEventFromRow);
  const proposals = listGoalProposals(goalId);
  return { goal: goalFromRow(row), focuses, items, events, proposals };
}

const defaultAgentPermissions: AgentPermissionSettings = {
  canWriteFiles: true,
  canRunCommands: true,
  canUseTerminal: true,
  canCreatePreview: true,
  canWriteSharedWorkspace: true,
  canRequestApproval: true,
  canTriggerAgents: false,
  canMergeChanges: false,
};

const permissionProfiles: Record<string, Partial<AgentPermissionSettings>> = {
  "read-only": {
    canWriteFiles: false,
    canRunCommands: false,
    canUseTerminal: false,
    canCreatePreview: false,
    canWriteSharedWorkspace: false,
    canRequestApproval: true,
    canTriggerAgents: false,
    canMergeChanges: false,
  },
  "workspace-write": {
    canWriteFiles: true,
    canRunCommands: false,
    canUseTerminal: false,
    canCreatePreview: false,
    canWriteSharedWorkspace: true,
    canRequestApproval: true,
    canTriggerAgents: false,
    canMergeChanges: false,
  },
  developer: {
    canWriteFiles: true,
    canRunCommands: true,
    canUseTerminal: true,
    canCreatePreview: true,
    canWriteSharedWorkspace: true,
    canRequestApproval: true,
    canTriggerAgents: false,
    canMergeChanges: false,
  },
  maintainer: {
    canWriteFiles: true,
    canRunCommands: true,
    canUseTerminal: true,
    canCreatePreview: true,
    canWriteSharedWorkspace: true,
    canRequestApproval: true,
    canTriggerAgents: true,
    canMergeChanges: true,
  },
  "danger-full-access": defaultAgentPermissions,
};

function permissionProfileId(value: unknown): PermissionProfileId | null {
  return typeof value === "string" && value in permissionProfiles ? value as PermissionProfileId : null;
}

function agentPermissions(value: unknown, override?: Partial<AgentPermissionSettings>): AgentPermissionSettings {
  let parsed: Partial<AgentPermissionSettings> = {};
  if (typeof value === "string" && value.trim()) {
    try {
      parsed = JSON.parse(value) as Partial<AgentPermissionSettings>;
    } catch {
      parsed = {};
    }
  } else if (value && typeof value === "object") {
    parsed = value as Partial<AgentPermissionSettings>;
  }
  return { ...defaultAgentPermissions, ...parsed, ...override };
}

function resolvedAgentPermissions(agent: Pick<AgentSummary, "permissions" | "permissionProfileId">) {
  return agentPermissions(agent.permissions, agent.permissionProfileId ? permissionProfiles[agent.permissionProfileId] : undefined);
}

function projectAccessMode(value: unknown): AgentProjectAccessMode {
  return value === "none" || value === "selected" || value === "all" ? value : "all";
}

function roleSourceType(value: unknown): AgentRoleSourceType {
  return value === "file-import" || value === "builtin-template" ? value : "custom-markdown";
}

function listenMode(value: unknown, fallback: AgentListenMode = "passive"): AgentListenMode {
  return value === "none" || value === "active" || value === "orchestrator" || value === "passive" ? value : fallback;
}

function workspaceMode(value: unknown, fallback: AgentWorkspaceMode = "isolated-worktree-with-shared-room"): AgentWorkspaceMode {
  return value === "shared-readonly"
    || value === "shared-write"
    || value === "merge-workspace"
    || value === "isolated-worktree"
    || value === "isolated-worktree-with-shared-room"
    ? value
    : fallback;
}

function roomStatus(value: unknown, fallback: RoomStatus = "draft"): RoomStatus {
  return value === "running" || value === "paused" || value === "done" || value === "failed" || value === "draft" ? value : fallback;
}

const defaultRoomOrchestration: RoomOrchestrationSettings = {
  autoStartTasks: true,
  autoCreateReviewTasks: true,
  autoListenAfterAgentEvents: true,
  notifyUserOnFailure: true,
  maxAutoRetries: 0,
  maxAutoListenChainDepth: 1,
  maxAutoListenTasksPerEvent: 1,
};

function roomOrchestrationSettings(value: unknown, override?: Partial<RoomOrchestrationSettings>): RoomOrchestrationSettings {
  const parsed = typeof value === "string" ? jsonPayload(value) : value;
  const item = parsed && typeof parsed === "object" ? parsed as Partial<RoomOrchestrationSettings> : {};
  return {
    autoStartTasks: override?.autoStartTasks ?? item.autoStartTasks ?? defaultRoomOrchestration.autoStartTasks,
    autoCreateReviewTasks: override?.autoCreateReviewTasks ?? item.autoCreateReviewTasks ?? defaultRoomOrchestration.autoCreateReviewTasks,
    autoListenAfterAgentEvents: override?.autoListenAfterAgentEvents ?? item.autoListenAfterAgentEvents ?? defaultRoomOrchestration.autoListenAfterAgentEvents,
    notifyUserOnFailure: override?.notifyUserOnFailure ?? item.notifyUserOnFailure ?? defaultRoomOrchestration.notifyUserOnFailure,
    maxAutoRetries: Math.max(0, Math.min(10, Number(override?.maxAutoRetries ?? item.maxAutoRetries ?? defaultRoomOrchestration.maxAutoRetries) || 0)),
    maxAutoListenChainDepth: Math.max(0, Math.min(10, Number(override?.maxAutoListenChainDepth ?? item.maxAutoListenChainDepth ?? defaultRoomOrchestration.maxAutoListenChainDepth) || 0)),
    maxAutoListenTasksPerEvent: Math.max(1, Math.min(20, Number(override?.maxAutoListenTasksPerEvent ?? item.maxAutoListenTasksPerEvent ?? defaultRoomOrchestration.maxAutoListenTasksPerEvent) || 1)),
  };
}

function conversationType(value: unknown, fallback: ConversationType = "codex"): ConversationType {
  return value === "agent" || value === "room" || value === "codex" ? value : fallback;
}

function previewAccess(value: unknown, fallback: PreviewAccess = "private"): PreviewAccess {
  return value === "public" || value === "private" ? value : fallback;
}

function markdownTitle(value: string) {
  return value.split(/\r?\n/).find((line) => line.trim().startsWith("# "))?.replace(/^#\s+/, "").trim() ?? "";
}

function markdownDescription(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstBodyLine = lines.find((line) => !line.startsWith("#"));
  return firstBodyLine ? firstBodyLine.slice(0, 240) : "";
}

function systemPromptWithRoleDescription(systemPrompt: string, description?: string | null, enabled = false) {
  const cleanDescription = description?.trim();
  if (!enabled || !cleanDescription) return systemPrompt;
  const heading = "## Role Extension Description";
  if (systemPrompt.includes(heading)) return systemPrompt;
  return `${systemPrompt.trim()}\n\n${heading}\n${cleanDescription}`;
}

const previewAccessTtlMs = 12 * 60 * 60 * 1000;

function previewAccessCookieName(previewId: string) {
  return `codex_preview_${previewId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function previewAccessCookie(preview: PreviewRecord, ttlMs = previewAccessTtlMs) {
  return `${previewAccessCookieName(preview.id)}=${encodeURIComponent(signPreviewAccessToken(preview, ttlMs))}; Path=/; Max-Age=${Math.max(1, Math.floor(ttlMs / 1000))}; HttpOnly; SameSite=Lax`;
}

function requestHasPreviewAccess(preview: PreviewRecord, request: Request | IncomingMessage) {
  if (preview.access === "public") return true;
  const cookieHeader = request instanceof Request ? request.headers.get("cookie") ?? undefined : request.headers.cookie;
  return verifyPreviewAccessToken(preview, parseCookieHeader(cookieHeader).get(previewAccessCookieName(preview.id)));
}

function createPreviewAccessRequest(preview: PreviewRecord, sourceUrl: URL) {
  expirePreviewAccessRequests();
  const existing = Array.from(previewAccessRequests.values()).find((request) =>
    request.previewId === preview.id
    && request.status === "pending"
    && Date.now() - new Date(request.createdAt).getTime() < 15 * 60 * 1000
  );
  if (existing) return { id: existing.id, secret: existing.secret, reused: true };
  const id = `preview-access-${randomUUID()}`;
  const secret = randomUUID();
  const now = new Date().toISOString();
  const request: PreviewAccessRequest = {
    id,
    previewId: preview.id,
    secret,
    status: "pending",
    approvedUntil: null,
    createdAt: now,
    updatedAt: now,
  };
  upsertPreviewAccessRequest(request);
  createApproval({
    actionType: "preview-access",
    risk: "low",
    title: "Private preview access request",
    description: `Allow temporary access to private preview ${preview.label}.`,
    details: [
      `preview=${preview.label}`,
      `previewId=${preview.id}`,
      `target=${preview.targetHost}:${preview.port}`,
      `requestId=${id}`,
      `url=${sourceUrl.pathname}`,
    ].join("\n"),
    payload: { requestId: id, previewId: preview.id, url: sourceUrl.pathname },
  });
  return { id, secret };
}

function getPreviewAccessRequest(preview: PreviewRecord, requestId: string, secret: string | null) {
  const request = previewAccessRequests.get(requestId);
  if (!request || request.previewId !== preview.id || request.secret !== (secret ?? "")) return null;
  return request;
}

function privatePreviewAccessResponse(preview: PreviewRecord, sourceUrl: URL) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Private Preview</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f4; color: #172018; }
    main { width: min(460px, calc(100vw - 32px)); border: 1px solid #d9ded6; border-radius: 10px; background: white; padding: 20px; box-shadow: 0 24px 80px rgba(14, 20, 16, .16); }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0 0 14px; color: #586256; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    a, button { display: inline-flex; align-items: center; min-height: 34px; border-radius: 8px; border: 1px solid #cdd5ca; background: #172018; color: white; padding: 0 12px; text-decoration: none; cursor: pointer; }
    a.secondary { background: white; color: #172018; }
    .muted { margin-top: 12px; font-size: 12px; color: #7a8378; }
  </style>
</head>
<body>
  <main>
    <h1>私有预览需要授权</h1>
    <p id="message">这是一个私有预览。你可以发起访问授权请求，等待 Codex Web 管理员批准。</p>
    <div class="actions">
      <button id="request" type="button">请求授权</button>
      <a class="secondary" href="${sourceUrl.origin}/#approvals">打开审批页面</a>
      <a class="secondary" href="${sourceUrl.origin}/#previews">打开预览列表</a>
    </div>
    <p class="muted">Private preview requires an authenticated Codex Web session.</p>
  </main>
  <script>
    (() => {
      const message = document.getElementById("message");
      const button = document.getElementById("request");
      let timer = null;
      async function poll(id, secret) {
        const response = await fetch(${JSON.stringify(`${previewUrl(preview).replace(/\/+$/, "")}/access-requests/`)} + encodeURIComponent(id) + "?secret=" + encodeURIComponent(secret), { cache: "no-store" });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.status === "approved") {
          message.textContent = "授权已批准，正在打开预览...";
          window.location.replace(${JSON.stringify(`${sourceUrl.pathname}${sourceUrl.search}${sourceUrl.hash}`)});
          return;
        }
        if (result?.status === "denied") {
          message.textContent = "授权请求已被拒绝。";
          if (timer) window.clearInterval(timer);
        }
      }
      button.addEventListener("click", async () => {
        button.disabled = true;
        message.textContent = "正在创建授权请求...";
        const response = await fetch(${JSON.stringify(`${previewUrl(preview).replace(/\/+$/, "")}/access-requests`)}, { method: "POST" });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.id || !result?.secret) {
          message.textContent = "授权请求创建失败，请回到 Codex Web 后重试。";
          button.disabled = false;
          return;
        }
        message.textContent = "授权请求已发送，请等待审批通过。";
        timer = window.setInterval(() => void poll(result.id, result.secret), 2000);
        void poll(result.id, result.secret);
      });
    })();
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

app.use("*", createRateLimitMiddleware(
  () => rateLimitSettings,
  (providerId) => {
    const provider = appData.providers.find((item) => item.id === providerId);
    return provider ? { enabled: provider.rpmLimitEnabled, rpmLimit: provider.rpmLimit } : null;
  },
));

function slugify(value: string) {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || randomUUID();
}

function uniqueProjectId(name: string) {
  const base = slugify(name);
  let candidate = base;
  let index = 2;
  while (appData.projects.some((project) => project.id === candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function defaultProjectWorkspacePath(projectId: string) {
  return resolve(projectWorkspaceRoot, projectId);
}

function normalizeMountPath(value: string) {
  return resolve(value.trim() || ".");
}

function resolveInsideRoot(root: string, inputPath?: string) {
  const requestedPath = inputPath && inputPath !== "." ? inputPath : ".";
  const expandedPath = requestedPath === "~" || requestedPath.startsWith("~/")
    ? join(process.env.HOME ?? root, requestedPath.slice(2))
    : requestedPath;
  const absolutePath = resolve(root, expandedPath);
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_root");
  return absolutePath;
}

function getMount(mountId?: string | null) {
  if (mountId && fileMounts.has(mountId)) return fileMounts.get(mountId) ?? null;
  return fileMounts.get("default") ?? Array.from(fileMounts.values())[0] ?? null;
}

function upsertFileMount(mount: FileMountRecord) {
  db.prepare(`
    insert into file_mounts (id, name, root_path, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      root_path = excluded.root_path,
      updated_at = excluded.updated_at
  `).run(mount.id, mount.name, mount.rootPath, mount.createdAt, mount.updatedAt);
  fileMounts.set(mount.id, mount);
}

function deleteFileMount(id: string) {
  if (id === "default" && fileMounts.size <= 1) throw new Error("cannot_delete_last_mount");
  db.prepare("delete from file_mounts where id = ?").run(id);
  fileMounts.delete(id);
}

function deleteFileMountsForRoot(rootPath: string) {
  const normalizedRoot = normalizeMountPath(rootPath);
  for (const mount of Array.from(fileMounts.values())) {
    if (normalizeMountPath(mount.rootPath) !== normalizedRoot) continue;
    if (mount.id === "default" && fileMounts.size <= 1) continue;
    db.prepare("delete from file_mounts where id = ?").run(mount.id);
    fileMounts.delete(mount.id);
  }
}

function resolveInsideMount(mount: FileMountRecord, inputPath?: string) {
  const baseRoot = mount.rootPath;
  const requestedPath = inputPath && inputPath !== "." ? inputPath : ".";
  const expandedPath = requestedPath === "~" || requestedPath.startsWith("~/")
    ? join(process.env.HOME ?? baseRoot, requestedPath.slice(2))
    : requestedPath;
  const absolutePath = resolve(baseRoot, expandedPath);
  const relativePath = relative(baseRoot, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_root");
  return absolutePath;
}

function resolveMountWorkspace(mountId?: string | null) {
  const mount = getMount(mountId);
  if (!mount) throw new Error("mount_not_found");
  return mount;
}

function resolveFileRequestMount(mountId?: string | null, rootPath?: string | null): FileMountRecord {
  if (rootPath?.trim()) {
    const transientRoot = normalizeMountPath(rootPath);
    if (!existsSync(transientRoot) || !statSync(transientRoot).isDirectory()) throw new Error("mount_root_invalid");
    return {
      id: "__workspace",
      name: "Workspace",
      rootPath: transientRoot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return resolveMountWorkspace(mountId);
}

type AgentRoleTemplateRecord = AgentRoleTemplateSummary & { markdownContent: string };

function readJsonFileWithFallback<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function parseMarkdownFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields: Record<string, string> = {};
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) fields[item[1]] = item[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

function listAgentRoleTemplates(): AgentRoleTemplateRecord[] {
  if (!existsSync(agentRoleTemplateDir)) return [];
  const zhNamesPath = join(agentRoleTemplateDir, "agency-agents", "scripts", "i18n", "agent-names-zh.json");
  const zhNames = existsSync(zhNamesPath) ? readJsonFileWithFallback<Record<string, { name?: string; description?: string }>>(zhNamesPath, {}) : {};
  const useLocalizedAllowlist = Object.keys(zhNames).length > 0;
  function walk(dir: string, groupParts: string[] = []): AgentRoleTemplateRecord[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const filePath = join(dir, entry.name);
      if (entry.isDirectory()) return walk(filePath, [...groupParts, entry.name]);
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) return [];
      const markdownContent = readFileSync(filePath, "utf8");
      const metadata = parseMarkdownFrontmatter(markdownContent);
      if (!metadata.name) return [];
      const isAgencyTemplate = groupParts[0] === "agency-agents";
      if (useLocalizedAllowlist && isAgencyTemplate && !zhNames[metadata.name]) return [];
      const filename = entry.name.replace(/\.md$/i, "");
      const group = groupParts.join("/") || "Root";
      const id = [...groupParts, filename].join("-").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
      const localized = zhNames[metadata.name]
        ? {
            "zh-CN": { name: zhNames[metadata.name].name || metadata.name, description: zhNames[metadata.name].description },
            zh: { name: zhNames[metadata.name].name || metadata.name, description: zhNames[metadata.name].description },
          }
        : undefined;
      return [{
        id,
        name: metadata.name || markdownTitle(markdownContent) || filename.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
        group,
        description: metadata.description || markdownDescription(markdownContent),
        localizedNames: localized,
        sourcePath: relative(agentRoleTemplateDir, filePath),
        sourceUrl: isAgencyTemplate ? `https://github.com/msitarzewski/agency-agents/blob/main/${relative(join(agentRoleTemplateDir, "agency-agents"), filePath)}` : undefined,
        markdownContent,
      }];
    });
  }
  return walk(agentRoleTemplateDir)
    .sort((a, b) => a.group === b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group));
}

function publicAgentRoleTemplate(template: AgentRoleTemplateRecord): AgentRoleTemplateSummary {
  const { markdownContent, ...summary } = template;
  return summary;
}

function publicProvider(provider: ProviderRecord): ProviderSummary {
  const cachedModels = readProviderModelCache(provider);
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    defaultModel: provider.defaultModel,
    baseUrl: provider.baseUrl,
    apiKeyConfigured: Boolean(provider.apiKey),
    capabilities: provider.capabilities ?? defaultProviderCapabilities(provider.kind),
    models: cachedModels?.models,
    modelsCachedAt: cachedModels?.cachedAt ?? null,
    rpmLimit: provider.rpmLimit ?? null,
    rpmLimitEnabled: provider.rpmLimitEnabled ?? false,
    useProxy: provider.useProxy ?? false,
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

function textFromResponseContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return stringifyReadable(value);
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return typeof record.text === "string"
      ? record.text
      : typeof record.input_text === "string"
        ? record.input_text
        : typeof record.output_text === "string"
          ? record.output_text
          : "";
  }).filter(Boolean).join("\n");
}

function responseInputToChatMessages(input: unknown, instructions?: unknown): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (typeof instructions === "string" && instructions.trim()) messages.push({ role: "system", content: instructions });
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }
  if (!Array.isArray(input)) {
    messages.push({ role: "user", content: stringifyReadable(input) });
    return messages;
  }
  for (const item of input) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
      continue;
    }
    if (!item || typeof item !== "object") {
      messages.push({ role: "user", content: stringifyReadable(item) });
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.type === "message") {
      const role = record.role === "assistant" || record.role === "system" || record.role === "tool" ? record.role : "user";
      messages.push({ role, content: textFromResponseContent(record.content) });
      continue;
    }
    if (typeof record.role === "string" && (record.role === "assistant" || record.role === "system" || record.role === "tool" || record.role === "user")) {
      messages.push({ role: record.role, content: textFromResponseContent(record.content) });
      continue;
    }
    if (record.type === "function_call") {
      const callId = typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : `call-${randomUUID()}`;
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: typeof record.name === "string" ? record.name : "",
            arguments: typeof record.arguments === "string" ? record.arguments : "{}",
          },
        }],
      });
      continue;
    }
    if (record.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : undefined, content: textFromResponseContent(record.output) });
      continue;
    }
    messages.push({ role: "user", content: textFromResponseContent(record.content ?? record.text ?? record) });
  }
  return messages.length ? messages : [{ role: "user", content: "" }];
}

function responseToolsToChatTools(tools: unknown) {
  if (!Array.isArray(tools)) return undefined;
  const converted = tools.map((tool) => {
    if (!tool || typeof tool !== "object") return null;
    const record = tool as Record<string, unknown>;
    if (record.type === "function" && record.name) {
      return {
        type: "function",
        function: {
          name: record.name,
          description: record.description,
          parameters: record.parameters ?? {},
        },
      };
    }
    if (record.type === "function" && record.function) return record;
    return null;
  }).filter(Boolean);
  return converted.length ? converted : undefined;
}

function chatMessageToResponseOutput(message: Record<string, unknown>, responseId: string) {
  const content = typeof message.content === "string" ? message.content : textFromResponseContent(message.content);
  const output: Array<Record<string, unknown>> = [];
  if (content) {
    output.push({
      id: `msg-${responseId}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const record = call as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
    const callId = typeof record.id === "string" ? record.id : `call-${randomUUID()}`;
    output.push({
      id: callId,
      type: "function_call",
      call_id: callId,
      name: typeof fn.name === "string" ? fn.name : "",
      arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
      status: "completed",
    });
  }
  return output.length ? output : [{
    id: `msg-${responseId}`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text: "", annotations: [] }],
  }];
}

function chatCompletionToResponse(payload: Record<string, unknown>, fallbackModel: string) {
  const responseId = typeof payload.id === "string" ? payload.id.replace(/^chatcmpl-/, "resp_") : `resp_${randomUUID()}`;
  const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
  const output = chatMessageToResponseOutput(message, responseId);
  const text = output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? String((item as Record<string, unknown>).text) : "")
    .join("");
  return {
    id: responseId,
    object: "response",
    created_at: typeof payload.created === "number" ? payload.created : Math.floor(Date.now() / 1000),
    status: "completed",
    model: typeof payload.model === "string" ? payload.model : fallbackModel,
    output,
    output_text: text,
    usage: payload.usage ?? null,
  };
}

function responsesRequestToChatCompletion(body: Record<string, unknown>, provider: ProviderRecord) {
  const request: Record<string, unknown> = {
    model: typeof body.model === "string" ? body.model : provider.defaultModel,
    messages: responseInputToChatMessages(body.input, body.instructions),
  };
  if (body.max_output_tokens !== undefined) request.max_tokens = body.max_output_tokens;
  if (body.temperature !== undefined) request.temperature = body.temperature;
  if (body.top_p !== undefined) request.top_p = body.top_p;
  if (body.stream !== undefined) request.stream = body.stream;
  const tools = responseToolsToChatTools(body.tools);
  if (tools) request.tools = tools;
  if (body.tool_choice !== undefined) request.tool_choice = body.tool_choice;
  return request;
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function streamChatCompletionAsResponses(upstream: Response, model: string) {
  const responseId = `resp_${randomUUID()}`;
  const itemId = `msg-${responseId}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let textOutput = "";
  let itemStarted = false;
  let textOutputIndex = 0;
  let nextOutputIndex = 0;
  const functionCalls = new Map<number, { id: string; callId: string; name: string; arguments: string; outputIndex: number }>();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEvent("response.created", { id: responseId, type: "response.created", response: { id: responseId, status: "in_progress", model } })));
      const startTextItem = () => {
        if (itemStarted) return;
        itemStarted = true;
        const outputIndex = nextOutputIndex++;
        textOutputIndex = outputIndex;
        controller.enqueue(encoder.encode(sseEvent("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
        })));
        controller.enqueue(encoder.encode(sseEvent("response.content_part.added", {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        })));
      };
      const finishTextItem = () => {
        if (!itemStarted) return null;
        const part = { type: "output_text", text: textOutput, annotations: [] };
        const outputIndex = textOutputIndex;
        const item = { id: itemId, type: "message", status: "completed", role: "assistant", content: [part] };
        controller.enqueue(encoder.encode(sseEvent("response.output_text.done", {
          type: "response.output_text.done",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          text: textOutput,
        })));
        controller.enqueue(encoder.encode(sseEvent("response.content_part.done", {
          type: "response.content_part.done",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part,
        })));
        controller.enqueue(encoder.encode(sseEvent("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outputIndex,
          item,
        })));
        return item;
      };
      const startFunctionCall = (index: number, deltaCall: Record<string, unknown>) => {
        const existing = functionCalls.get(index);
        const fn = deltaCall.function && typeof deltaCall.function === "object" ? deltaCall.function as Record<string, unknown> : {};
        if (existing) {
          if (!existing.name && typeof fn.name === "string") existing.name = fn.name;
          return existing;
        }
        const callId = typeof deltaCall.id === "string" ? deltaCall.id : `call-${randomUUID()}`;
        const call = {
          id: `fc_${callId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          callId,
          name: typeof fn.name === "string" ? fn.name : "",
          arguments: "",
          outputIndex: nextOutputIndex++,
        };
        functionCalls.set(index, call);
        controller.enqueue(encoder.encode(sseEvent("response.output_item.added", {
          type: "response.output_item.added",
          output_index: call.outputIndex,
          item: { id: call.id, type: "function_call", status: "in_progress", call_id: call.callId, name: call.name, arguments: "" },
        })));
        return call;
      };
      const finishFunctionCalls = () => {
        const items: Array<Record<string, unknown>> = [];
        for (const call of [...functionCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
          const item = { id: call.id, type: "function_call", status: "completed", call_id: call.callId, name: call.name, arguments: call.arguments };
          controller.enqueue(encoder.encode(sseEvent("response.function_call_arguments.done", {
            type: "response.function_call_arguments.done",
            item_id: call.id,
            output_index: call.outputIndex,
            arguments: call.arguments,
          })));
          controller.enqueue(encoder.encode(sseEvent("response.output_item.done", {
            type: "response.output_item.done",
            output_index: call.outputIndex,
            item,
          })));
          items.push(item);
        }
        return items;
      };
      const reader = upstream.body?.getReader();
      if (!reader) {
        const item = finishTextItem() ?? { id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] };
        controller.enqueue(encoder.encode(sseEvent("response.completed", { type: "response.completed", response: { id: responseId, status: "completed", model, output: [item] } })));
        controller.close();
        return;
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split(/\r?\n/).find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const data = dataLine.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as Record<string, unknown>;
            const choice = Array.isArray(chunk.choices) ? chunk.choices[0] as Record<string, unknown> | undefined : undefined;
            const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
            const text = typeof delta.content === "string" ? delta.content : "";
            if (text) {
              startTextItem();
              textOutput += text;
              controller.enqueue(encoder.encode(sseEvent("response.output_text.delta", { type: "response.output_text.delta", item_id: itemId, output_index: textOutputIndex, content_index: 0, delta: text })));
            }
            const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
            for (const toolCall of toolCalls) {
              if (!toolCall || typeof toolCall !== "object") continue;
              const record = toolCall as Record<string, unknown>;
              const index = typeof record.index === "number" ? record.index : functionCalls.size;
              const call = startFunctionCall(index, record);
              const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
              const argumentsDelta = typeof fn.arguments === "string" ? fn.arguments : "";
              if (argumentsDelta) {
                call.arguments += argumentsDelta;
                controller.enqueue(encoder.encode(sseEvent("response.function_call_arguments.delta", {
                  type: "response.function_call_arguments.delta",
                  item_id: call.id,
                  output_index: call.outputIndex,
                  delta: argumentsDelta,
                })));
              }
            }
          } catch {
            // Ignore malformed upstream SSE chunks and continue streaming.
          }
        }
      }
      const output = [finishTextItem(), ...finishFunctionCalls()].filter(Boolean);
      if (!output.length) output.push({ id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] });
      controller.enqueue(encoder.encode(sseEvent("response.completed", { type: "response.completed", response: { id: responseId, status: "completed", model, output } })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function proxyResponsesToChatCompletions(provider: ProviderRecord, body: Record<string, unknown>) {
  if (!provider.baseUrl) return new Response(JSON.stringify({ error: "base_url_required" }), { status: 400, headers: { "content-type": "application/json" } });
  const chatRequest = responsesRequestToChatCompletion(body, provider);
  const upstream = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(chatRequest),
  });
  if (!upstream.ok) {
    return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" } });
  }
  if (body.stream === true) return streamChatCompletionAsResponses(upstream, String(chatRequest.model ?? provider.defaultModel));
  const payload = await upstream.json() as Record<string, unknown>;
  return new Response(JSON.stringify(chatCompletionToResponse(payload, String(chatRequest.model ?? provider.defaultModel))), { headers: { "content-type": "application/json" } });
}

async function proxyResponsesToResponses(provider: ProviderRecord, body: Record<string, unknown>) {
  if (!provider.baseUrl) return new Response(JSON.stringify({ error: "base_url_required" }), { status: 400, headers: { "content-type": "application/json" } });
  const upstream = await fetch(joinUrl(provider.baseUrl, "/responses"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? (body.stream === true ? "text/event-stream; charset=utf-8" : "application/json"));
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function probeProviderInterface(provider: ProviderRecord, kind: "responses" | "chatCompletions") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  const startedAt = Date.now();
  try {
    if (provider.kind !== "local" && !provider.apiKey) return { ok: false, status: null, durationMs: 0, error: "api_key_missing" };
    if (kind === "responses") {
      const baseUrl = provider.baseUrl || "https://api.openai.com/v1";
      const response = await fetch(joinUrl(baseUrl, "/responses"), {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: provider.defaultModel, input: "ping", max_output_tokens: 1 }),
      });
      return { ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, error: response.ok ? undefined : (await response.text()).slice(0, 240) };
    }
    if (!provider.baseUrl) return { ok: false, status: null, durationMs: 0, error: "base_url_required" };
    const response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: provider.defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    });
    return { ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, error: response.ok ? undefined : (await response.text()).slice(0, 240) };
  } catch (error) {
    return { ok: false, status: null, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "provider_probe_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function detectProviderInterface(provider: ProviderRecord): Promise<ProviderDetectionResponse> {
  const startedAt = Date.now();
  if (!provider.defaultModel?.trim()) {
    return {
      ok: false,
      providerId: provider.id,
      kind: provider.kind,
      capabilities: provider.capabilities ?? defaultProviderCapabilities(provider.kind),
      durationMs: 0,
      checks: {
        responses: { ok: false, status: null, error: "default_model_required" },
        chatCompletions: { ok: false, status: null, error: "default_model_required" },
      },
      error: "default_model_required",
    };
  }
  const [responses, chatCompletions] = await Promise.all([
    probeProviderInterface(provider, "responses"),
    probeProviderInterface(provider, "chatCompletions"),
  ]);
  const detectedKind: ProviderSummary["kind"] = responses.ok ? "openai-responses" : chatCompletions.ok ? "openai-compatible-chat" : provider.kind;
  const capabilities = mergeProviderCapabilities(detectedKind, {
    responsesApi: responses.ok,
    chatCompletions: chatCompletions.ok,
    tools: detectedKind !== "local",
    jsonMode: detectedKind !== "local",
    streaming: true,
  });
  return {
    ok: responses.ok || chatCompletions.ok,
    providerId: provider.id,
    kind: detectedKind,
    capabilities,
    durationMs: Date.now() - startedAt,
    checks: {
      responses: { ok: responses.ok, status: responses.status, error: responses.error },
      chatCompletions: { ok: chatCompletions.ok, status: chatCompletions.status, error: chatCompletions.error },
    },
    error: responses.ok || chatCompletions.ok ? undefined : responses.error ?? chatCompletions.error ?? "provider_detection_failed",
  };
}

async function testProvider(provider: ProviderRecord): Promise<ProviderTestResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    if (provider.kind !== "local" && !provider.apiKey) {
      return { ok: false, providerId: provider.id, status: null, durationMs: Date.now() - startedAt, error: "api_key_missing" };
    }
    let response: Response;
    if (provider.kind === "openai-responses") {
      response = await fetch(joinUrl(provider.baseUrl || "https://api.openai.com/v1", "/responses"), {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: provider.defaultModel, input: "ping", max_output_tokens: 16 }),
        signal: controller.signal,
      });
    } else if (provider.kind === "openai-compatible-chat") {
      if (!provider.baseUrl) throw new Error("base_url_required");
      response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: provider.defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 16 }),
        signal: controller.signal,
      });
    } else {
      if (!provider.baseUrl) throw new Error("base_url_required");
      response = await fetch(joinUrl(provider.baseUrl, "/health"), { signal: controller.signal });
    }
    return {
      ok: response.ok,
      providerId: provider.id,
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: response.ok ? undefined : await response.text() || `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      providerId: provider.id,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "provider_test_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverProviderModels(provider: ProviderRecord): Promise<ProviderModelsResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    if (provider.kind !== "local" && !provider.apiKey) {
      return { ok: false, providerId: provider.id, models: [], status: null, durationMs: Date.now() - startedAt, error: "api_key_missing" };
    }
    const baseUrl = provider.baseUrl || (provider.kind === "openai-responses" ? "https://api.openai.com/v1" : "");
    if (!baseUrl) throw new Error("base_url_required");
    const response = await fetch(joinUrl(baseUrl, "/models"), {
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }>; models?: string[] };
    const models = Array.isArray(payload.data)
      ? payload.data.map((item) => item.id).filter((id): id is string => Boolean(id))
      : Array.isArray(payload.models) ? payload.models : [];
    return {
      ok: response.ok,
      providerId: provider.id,
      models: models.sort(),
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      providerId: provider.id,
      models: [],
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "provider_models_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function providerModelCacheKey(provider: ProviderRecord) {
  return stableJson({
    kind: provider.kind,
    baseUrl: provider.baseUrl ?? "",
    defaultModel: provider.defaultModel ?? "",
    apiKeyHash: provider.apiKey ? createHash("sha256").update(provider.apiKey).digest("hex") : "",
  });
}

function readProviderModelCache(provider: ProviderRecord): (ProviderModelsResponse & { cachedAt: string }) | null {
  const row = db.prepare("select cache_key, models, cached_at from provider_model_cache where provider_id = ?").get(provider.id) as
    | { cache_key: string; models: string; cached_at: string }
    | undefined;
  if (!row || row.cache_key !== providerModelCacheKey(provider)) return null;
  const age = Date.now() - new Date(row.cached_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > providerModelsCacheTtlMs) return null;
  try {
    const models = JSON.parse(row.models) as unknown;
    if (!Array.isArray(models) || !models.every((item) => typeof item === "string")) return null;
    return { ok: true, providerId: provider.id, models, status: null, durationMs: 0, cachedAt: row.cached_at };
  } catch {
    return null;
  }
}

function saveProviderModelCache(provider: ProviderRecord, result: ProviderModelsResponse) {
  if (!result.ok || !result.models.length) return;
  db.prepare(`
    insert into provider_model_cache (provider_id, cache_key, models, cached_at)
    values (?, ?, ?, ?)
    on conflict(provider_id) do update set
      cache_key = excluded.cache_key,
      models = excluded.models,
      cached_at = excluded.cached_at
  `).run(provider.id, providerModelCacheKey(provider), JSON.stringify(result.models), new Date().toISOString());
}

function clearProviderModelCache(providerId: string) {
  db.prepare("delete from provider_model_cache where provider_id = ?").run(providerId);
}

function toRelativePath(absolutePath: string, root = workspaceRoot) {
  if (root === resolve("/")) return absolutePath;
  const nextPath = relative(root, absolutePath).replaceAll("\\", "/");
  return nextPath === "" ? "." : nextPath;
}

function resolveWorkspacePath(inputPath?: string, mountId?: string | null) {
  return resolveInsideMount(resolveMountWorkspace(mountId), inputPath);
}

function resolveTerminalCwd(inputPath?: string) {
  const requestedPath = inputPath?.trim() || terminalDefaultCwd;
  try {
    return resolveInsideRoot(terminalRoot, requestedPath);
  } catch {
    if (inputPath?.trim() && inputPath.trim() !== terminalDefaultCwd) throw new Error("terminal_cwd_outside_workspace");
    return terminalRoot;
  }
}

function toTerminalPath(absolutePath: string) {
  return toRelativePath(absolutePath, terminalRoot);
}

function topLevelSessionDataPath(sessionId: string) {
  return resolve(sessionWorkspaceRoot, sessionId);
}

function roomParentSessionId(roomId: string) {
  const row = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  return row?.session_id ?? null;
}

function sessionDataPath(sessionId: string) {
  const row = db.prepare("select conversation_type, room_id from sessions where id = ?").get(sessionId) as { conversation_type?: string | null; room_id?: string | null } | undefined;
  if (row?.conversation_type === "agent" && row.room_id) {
    const parentSessionId = roomParentSessionId(row.room_id);
    if (parentSessionId && parentSessionId !== sessionId) return resolve(topLevelSessionDataPath(parentSessionId), "room", "agent-sessions", sessionId);
  }
  return topLevelSessionDataPath(sessionId);
}

function sessionLogsPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "logs");
}

function sessionMetadataPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "metadata.json");
}

function sessionContextPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "context");
}

function sessionMemoryPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "memory");
}

function sessionAttachmentsPath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "attachments");
}

type SavedSessionAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  relativePath: string;
  textPreview?: string;
};

const maxAttachmentFiles = 8;
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxAttachmentTextPreviewChars = 16_000;

function safeAttachmentName(name: string) {
  const base = basename(name || "attachment").replace(/[^\w.\- ()[\]\u4e00-\u9fff]/g, "_").slice(0, 120);
  return base && base !== "." && base !== ".." ? base : "attachment";
}

function readableAttachmentBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentTextPreview(buffer: Buffer, type: string, name: string) {
  const lowerName = name.toLowerCase();
  const looksText = type.startsWith("text/")
    || /(?:\.txt|\.md|\.json|\.csv|\.tsv|\.log|\.xml|\.html|\.css|\.js|\.jsx|\.ts|\.tsx|\.py|\.go|\.rs|\.java|\.c|\.cpp|\.h|\.hpp|\.sh|\.yml|\.yaml|\.toml|\.ini|\.env)$/i.test(lowerName);
  if (!looksText) return "";
  const text = buffer.toString("utf8").replace(/\u0000/g, "");
  return text.length > maxAttachmentTextPreviewChars ? `${text.slice(0, maxAttachmentTextPreviewChars)}\n... [truncated]` : text;
}

function saveSessionAttachments(sessionId: string, inputs?: UploadAttachmentInput[] | null) {
  const items = (inputs ?? []).filter((item) => item?.dataBase64 && item.name).slice(0, maxAttachmentFiles);
  if (!items.length) return [] as SavedSessionAttachment[];
  const root = sessionAttachmentsPath(sessionId);
  mkdirSync(root, { recursive: true });
  return items.map((item) => {
    const name = safeAttachmentName(item.name);
    const type = item.type?.trim() || "application/octet-stream";
    const buffer = Buffer.from(item.dataBase64, "base64");
    if (buffer.length > maxAttachmentBytes) throw new Error("attachment_too_large");
    const id = `attachment-${randomUUID()}`;
    const filename = `${id}-${name}`;
    const target = resolve(root, filename);
    if (!target.startsWith(`${root}/`)) throw new Error("invalid_attachment_path");
    writeFileSync(target, buffer);
    const relativePath = `attachments/${filename}`;
    const textPreview = attachmentTextPreview(buffer, type, name);
    return {
      id,
      name,
      type,
      size: buffer.length,
      path: target,
      relativePath,
      textPreview: textPreview || undefined,
    };
  });
}

function attachmentMarkdown(attachments: SavedSessionAttachment[], options: { includePreview: boolean }) {
  if (!attachments.length) return "";
  return [
    "## Attachments",
    ...attachments.flatMap((attachment, index) => [
      `${index + 1}. ${attachment.name}`,
      `   - path: ${attachment.path}`,
      `   - session path: ${attachment.relativePath}`,
      `   - type: ${attachment.type}`,
      `   - size: ${readableAttachmentBytes(attachment.size)}`,
      options.includePreview && attachment.textPreview ? "   - text preview:" : "",
      options.includePreview && attachment.textPreview ? attachment.textPreview.split("\n").map((line) => `     ${line}`).join("\n") : "",
    ]),
  ].filter((line) => line !== "").join("\n");
}

function promptWithAttachments(prompt: string, attachments: SavedSessionAttachment[]) {
  const attachmentBlock = attachmentMarkdown(attachments, { includePreview: true });
  return attachmentBlock ? `${prompt.trim()}\n\n${attachmentBlock}` : prompt.trim();
}

function messageWithAttachments(prompt: string, attachments: SavedSessionAttachment[]) {
  const attachmentBlock = attachmentMarkdown(attachments, { includePreview: false });
  return attachmentBlock ? `${prompt.trim()}\n\n${attachmentBlock}` : prompt.trim();
}

function writeSessionContextFile(sessionId: string, name: string, content: string) {
  const root = sessionContextPath(sessionId);
  mkdirSync(root, { recursive: true });
  const target = resolve(root, name);
  writeFileSync(target, content, "utf8");
  return target;
}

function resetSessionContextFiles(sessionId: string) {
  const root = sessionContextPath(sessionId);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

function writeSessionMetadata(session: SessionSummary) {
  try {
    mkdirSync(sessionDataPath(session.id), { recursive: true });
    writeFileSync(sessionMetadataPath(session.id), JSON.stringify({ session, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch {
    return;
  }
}

function migrateLegacyScratchSessionWorkspace(sessionId: string) {
  const root = sessionDataPath(sessionId);
  const workspace = resolve(root, "workspace");
  if (!existsSync(root) || existsSync(workspace)) return;
  const entries = readdirSync(root).filter((name) => !["logs", "artifacts", "metadata.json", "workspace"].includes(name));
  if (!entries.length) return;
  mkdirSync(workspace, { recursive: true });
  for (const name of entries) {
    try {
      renameSync(resolve(root, name), resolve(workspace, name));
    } catch {
      return;
    }
  }
}

function scratchSessionWorkspacePath(sessionId: string) {
  return resolve(sessionDataPath(sessionId), "workspace");
}

function ensureScratchSessionWorkspace(sessionId: string) {
  migrateLegacyScratchSessionWorkspace(sessionId);
  const workspacePath = scratchSessionWorkspacePath(sessionId);
  mkdirSync(workspacePath, { recursive: true });
  ensureGitRepositorySync(workspacePath);
  return workspacePath;
}

function migrateRoomAgentSessionDataRoots() {
  const rows = db.prepare(`
    select id
    from sessions
    where conversation_type = 'agent'
      and room_id is not null
  `).all() as Array<{ id: string }>;
  for (const row of rows) {
    const source = topLevelSessionDataPath(row.id);
    const target = sessionDataPath(row.id);
    if (resolve(source) === resolve(target) || !existsSync(source)) continue;
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) {
      try {
        renameSync(source, target);
        continue;
      } catch {
        // Fall through to best-effort merge below.
      }
    }
    try {
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(source)) {
        const from = resolve(source, name);
        const to = resolve(target, name);
        if (existsSync(to)) continue;
        renameSync(from, to);
      }
      rmSync(source, { recursive: true, force: true });
    } catch {
      // Leave the original directory in place if migration cannot safely finish.
    }
  }
}

function roomWorkspaceDataPath(roomId: string) {
  const parentSessionId = roomParentSessionId(roomId);
  return parentSessionId ? resolve(topLevelSessionDataPath(parentSessionId), "room") : resolve(dataDir, "rooms", roomId);
}

function migrateRoomWorkspaceRoots() {
  const rows = db.prepare("select id, session_id from rooms").all() as Array<{ id: string; session_id?: string | null }>;
  for (const room of rows) {
    if (!room.session_id) continue;
    const source = resolve(dataDir, "rooms", room.id);
    const target = roomWorkspaceDataPath(room.id);
    if (resolve(source) === resolve(target) || !existsSync(source)) continue;
    mkdirSync(target, { recursive: true });
    let fullyMoved = true;
    for (const name of readdirSync(source)) {
      const from = resolve(source, name);
      const to = resolve(target, name);
      if (existsSync(to)) {
        fullyMoved = false;
        continue;
      }
      try {
        renameSync(from, to);
      } catch {
        fullyMoved = false;
      }
    }
    if (fullyMoved) rmSync(source, { recursive: true, force: true });
    const oldPrefix = `${source}/`;
    const newPrefix = `${target}/`;
    for (const run of db.prepare("select id, workspace_path from agent_runs where room_id = ? and workspace_path is not null and workspace_path != ''").all(room.id) as Array<{ id: string; workspace_path: string }>) {
      if (resolve(run.workspace_path) === source || run.workspace_path.startsWith(oldPrefix)) {
        const nextPath = resolve(run.workspace_path) === source ? target : `${newPrefix}${run.workspace_path.slice(oldPrefix.length)}`;
        db.prepare("update agent_runs set workspace_path = ? where id = ?").run(nextPath, run.id);
      }
    }
    for (const thread of db.prepare("select room_id, agent_id, workspace_path from room_agent_threads where room_id = ? and workspace_path is not null and workspace_path != ''").all(room.id) as Array<{ room_id: string; agent_id: string; workspace_path: string }>) {
      if (resolve(thread.workspace_path) === source || thread.workspace_path.startsWith(oldPrefix)) {
        const nextPath = resolve(thread.workspace_path) === source ? target : `${newPrefix}${thread.workspace_path.slice(oldPrefix.length)}`;
        db.prepare("update room_agent_threads set workspace_path = ?, updated_at = ? where room_id = ? and agent_id = ?").run(nextPath, new Date().toISOString(), thread.room_id, thread.agent_id);
      }
    }
    for (const session of appData.sessions) {
      if (!session.workspacePath || !(resolve(session.workspacePath) === source || session.workspacePath.startsWith(oldPrefix))) continue;
      session.workspacePath = resolve(session.workspacePath) === source ? target : `${newPrefix}${session.workspacePath.slice(oldPrefix.length)}`;
      upsertSession(session);
    }
  }
}

type RoomRunWorkspace = {
  root: string;
  shared: string;
  agentWorkspace: string;
  projectPath?: string;
};

function ensureRoomWorkspace(roomId: string, agentId: string): RoomRunWorkspace {
  const root = roomWorkspaceDataPath(roomId);
  const shared = resolve(root, "shared");
  const agentWorkspace = resolve(root, "agents", agentId);
  mkdirSync(shared, { recursive: true });
  mkdirSync(agentWorkspace, { recursive: true });
  ensureGitRepositorySync(agentWorkspace);
  return { root, shared, agentWorkspace };
}

function ensureRoomRunWorkspace(roomRow: Record<string, unknown>, agent: AgentSummary, taskId: string): RoomRunWorkspace {
  const base = ensureRoomWorkspace(String(roomRow.id), agent.id);
  const project = roomRow.project_id ? appData.projects.find((item) => item.id === String(roomRow.project_id)) : null;
  if (!project) return base;
  const projectPath = resolveTerminalCwd(project.workspacePath);
  const projectRoot = runGitSync(projectPath, ["rev-parse", "--show-toplevel"]);
  if (projectRoot.exitCode !== 0 || resolve(projectRoot.stdout.trim()) !== projectPath) return base;
  const useProjectWorktree = agent.workspaceMode !== "shared-write" && agent.workspaceMode !== "merge-workspace";
  if (!useProjectWorktree) return { ...base, projectPath };
  const worktree = resolve(base.root, "worktrees", `${agent.id}-${taskId}`);
  if (!existsSync(worktree)) {
    mkdirSync(dirname(worktree), { recursive: true });
    const branch = `codex-room/${String(roomRow.id).slice(0, 12)}/${agent.id.slice(0, 18)}/${taskId.slice(-8)}`;
    const result = runGitSync(projectPath, ["worktree", "add", "-B", branch, worktree, "HEAD"]);
    if (result.exitCode !== 0) return { ...base, projectPath };
  }
  return { ...base, agentWorkspace: worktree, projectPath };
}

function resolveSessionWorkspace(session: SessionSummary) {
  const project = session.projectId ? appData.projects.find((item) => item.id === session.projectId) : null;
  const roomAgentRun = session.conversationType === "agent" && session.roomId
    ? db.prepare("select workspace_path from agent_runs where session_id = ? and workspace_path is not null and workspace_path != '' order by started_at desc limit 1").get(session.id) as { workspace_path?: string | null } | undefined
    : null;
  const workspacePath = project?.workspacePath
    ? resolveTerminalCwd(project.workspacePath)
    : roomAgentRun?.workspace_path
      ? resolveTerminalCwd(String(roomAgentRun.workspace_path))
      : session.workspacePath
        ? resolveTerminalCwd(session.workspacePath)
        : ensureScratchSessionWorkspace(session.id);
  if (!project && !roomAgentRun?.workspace_path && workspacePath === scratchSessionWorkspacePath(session.id)) ensureGitRepositorySync(workspacePath);
  if (session.workspacePath !== workspacePath || (project && session.kind !== "project") || (!project && !roomAgentRun?.workspace_path && session.kind !== "scratch")) {
    session.workspacePath = workspacePath;
    if (project) {
      session.kind = "project";
    } else if (!roomAgentRun?.workspace_path) {
      session.projectId = null;
      session.kind = "scratch";
    }
    session.updatedAt = new Date().toISOString();
    upsertSession(session);
  }
  return workspacePath;
}

function resolveChildPath(parentPath: string, name: string, mountId?: string | null) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
  return resolveWorkspacePath(join(parentPath, cleanName), mountId);
}

function toFileEntry(absolutePath: string, root = workspaceRoot): FileEntry {
  const stat = statSync(absolutePath);
  return {
    name: absolutePath.split(/[\\/]/).at(-1) ?? absolutePath,
    path: toRelativePath(absolutePath, root),
    kind: stat.isDirectory() ? "directory" : "file",
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function runShellCommand(command: string, cwd: string): Promise<TerminalCommandResponse> {
  const startedAt = Date.now();
  return new Promise((resolveCommand) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawnProcess("/bin/zsh", ["-lc", command], { cwd, env: process.env });
    const trimOutput = (value: string) => value.slice(-64 * 1024);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = trimOutput(stdout + chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = trimOutput(stderr + chunk.toString("utf8"));
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 30_000);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolveCommand({ command, cwd: toTerminalPath(cwd), exitCode, stdout, stderr, durationMs: Date.now() - startedAt, timedOut });
    });
  });
}

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

function agentRoleFromRow(row: Record<string, unknown>): AgentRoleSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    sourceType: roleSourceType(row.source_type),
    sourcePath: row.source_path ? String(row.source_path) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    markdownContent: String(row.markdown_content ?? row.system_prompt ?? ""),
    systemPrompt: String(row.system_prompt ?? ""),
    capabilities: jsonArray(row.capabilities),
    defaultListenMode: listenMode(row.default_listen_mode),
    defaultListenEvents: jsonArray(row.default_listen_events),
    defaultWorkspaceMode: workspaceMode(row.default_workspace_mode),
    defaultSandboxMode: row.default_sandbox_mode ? String(row.default_sandbox_mode) as AgentRoleSummary["defaultSandboxMode"] : null,
    defaultApprovalPolicy: row.default_approval_policy ? String(row.default_approval_policy) as AgentRoleSummary["defaultApprovalPolicy"] : null,
    outputContract: row.output_contract ? String(row.output_contract) : null,
    safetyNotes: row.safety_notes ? String(row.safety_notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function agentFromRow(row: Record<string, unknown>): AgentSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    roleId: String(row.role_id),
    description: row.description ? String(row.description) : null,
    extraPrompt: row.extra_prompt ? String(row.extra_prompt) : null,
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    workspaceMode: workspaceMode(row.workspace_mode),
    defaultProjectId: row.default_project_id ? String(row.default_project_id) : null,
    favoriteProjectIds: jsonArray(row.favorite_project_ids),
    projectAccessMode: projectAccessMode(row.project_access_mode),
    allowedProjectIds: jsonArray(row.allowed_project_ids),
    permissionProfileId: permissionProfileId(row.permission_profile_id),
    permissions: agentPermissions(row.permissions),
    maxConcurrentRuns: Number(row.max_concurrent_runs) || 1,
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeProjectIds(ids?: string[] | null) {
  const valid = new Set(appData.projects.map((project) => project.id));
  return Array.from(new Set((ids ?? []).map(String).filter((id) => valid.has(id))));
}

function agentCanAccessProject(agent: AgentSummary, projectId?: string | null) {
  if (!projectId) return true;
  if (agent.projectAccessMode === "none") return false;
  if (agent.projectAccessMode === "all") return appData.projects.some((project) => project.id === projectId);
  return agent.allowedProjectIds.includes(projectId);
}

function resolveAgentProject(agent: AgentSummary, requestedProjectId?: string | null) {
  const projectId = requestedProjectId !== undefined ? requestedProjectId : agent.defaultProjectId;
  if (!projectId) return null;
  if (!agentCanAccessProject(agent, projectId)) throw new Error("agent_project_access_denied");
  return appData.projects.find((project) => project.id === projectId) ?? null;
}

function executionContextFromRow(row: Record<string, unknown>): ExecutionContextSummary {
  return {
    id: String(row.id),
    sourceType: row.source_type as ExecutionContextSummary["sourceType"],
    sessionId: row.session_id ? String(row.session_id) : null,
    agentId: row.agent_id ? String(row.agent_id) : null,
    roomId: row.room_id ? String(row.room_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    workspacePath: String(row.workspace_path),
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    permissionProfileId: permissionProfileId(row.permission_profile_id),
    resolvedPermissions: agentPermissions(row.resolved_permissions),
    sandboxMode: row.sandbox_mode as CodexSandboxMode,
    approvalPolicy: row.approval_policy as CodexApprovalPolicy,
    createdBy: row.created_by as ExecutionContextSummary["createdBy"],
    createdAt: String(row.created_at),
  };
}

function recordExecutionContext(input: Omit<ExecutionContextSummary, "id" | "createdAt">) {
  const context: ExecutionContextSummary = {
    ...input,
    id: `ctx-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    insert into execution_contexts (id, source_type, session_id, agent_id, room_id, project_id, workspace_path, provider_id, model, permission_profile_id, resolved_permissions, sandbox_mode, approval_policy, created_by, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.id,
    context.sourceType,
    context.sessionId ?? null,
    context.agentId ?? null,
    context.roomId ?? null,
    context.projectId ?? null,
    context.workspacePath,
    context.providerId ?? null,
    context.model ?? null,
    context.permissionProfileId ?? null,
    JSON.stringify(context.resolvedPermissions),
    context.sandboxMode,
    context.approvalPolicy,
    context.createdBy,
    context.createdAt,
  );
  return context;
}

function directAgentForSession(sessionId: string) {
  const link = db.prepare("select agent_id from agent_sessions where session_id = ?").get(sessionId) as { agent_id?: string } | undefined;
  if (!link?.agent_id) return null;
  const agentRow = db.prepare("select * from agents where id = ?").get(link.agent_id) as Record<string, unknown> | undefined;
  if (!agentRow) return null;
  const agent = agentFromRow(agentRow);
  const roleRow = db.prepare("select * from agent_roles where id = ?").get(agent.roleId) as Record<string, unknown> | undefined;
  if (!roleRow) return null;
  return { agent, role: agentRoleFromRow(roleRow) };
}

function promptForDirectAgentSession(session: SessionSummary, prompt: string) {
  if (session.conversationType !== "agent" || session.roomId || session.codexSessionId) return prompt;
  const directAgent = directAgentForSession(session.id);
  if (!directAgent) return prompt;
  return [
    directAgent.role.systemPrompt,
    directAgent.agent.extraPrompt ? `\n\nAgent extra instructions:\n${directAgent.agent.extraPrompt}` : "",
    `\n\nUser message:\n${prompt}`,
  ].join("");
}

function groupContextForRoom(roomRow: Record<string, unknown>) {
  const groupId = roomRow.group_id ? String(roomRow.group_id) : "";
  if (!groupId) return "";
  const groupRow = db.prepare("select * from agent_groups where id = ?").get(groupId) as Record<string, unknown> | undefined;
  if (!groupRow) return "";
  const group = agentGroupFromRow(groupRow);
  const memberModes = Object.entries(group.memberListenModes ?? {})
    .map(([agentId, mode]) => {
      const agent = db.prepare("select name from agents where id = ?").get(agentId) as { name?: string } | undefined;
      return `${agent?.name ?? agentId}: ${mode}`;
    })
    .join(", ");
  return [
    "Group context:",
    `- group: ${group.name}`,
    group.description ? `- description: ${group.description}` : "",
    memberModes ? `- member listen modes: ${memberModes}` : "",
    group.collaborationRules ? `- collaboration rules: ${group.collaborationRules}` : "",
    group.eventRoutingRules ? `- event routing rules: ${group.eventRoutingRules}` : "",
    `- approval policy: ${group.approvalPolicy}`,
    `- merge strategy: ${group.mergeStrategy}`,
  ].filter(Boolean).join("\n");
}

function recentRoomContext(roomId: string) {
  const rows = db.prepare(`
    select * from room_events
    where room_id = ?
    order by created_at desc, id desc
    limit 8
  `).all(roomId) as Array<Record<string, unknown>>;
  const lines = rows.reverse().map((row) => {
    const event = roomEventFromRow(row);
    const payload = event.payload as { content?: string; title?: string; taskId?: string } | null;
    return `- ${event.type}: ${payload?.content ?? payload?.title ?? payload?.taskId ?? event.createdAt}`;
  });
  return lines.length ? ["Recent room events:", ...lines].join("\n") : "";
}

function agentGroupFromRow(row: Record<string, unknown>): AgentGroupSummary {
  const members = db.prepare("select agent_id, listen_mode from agent_group_members where group_id = ? order by agent_id asc").all(String(row.id)) as Array<{ agent_id: string; listen_mode?: string }>;
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    agentIds: members.map((member) => member.agent_id),
    memberListenModes: Object.fromEntries(members.map((member) => [member.agent_id, listenMode(member.listen_mode)])),
    collaborationRules: String(row.collaboration_rules ?? ""),
    eventRoutingRules: String(row.event_routing_rules ?? ""),
    maxConcurrentAgents: Number(row.max_concurrent_agents) || 1,
    approvalPolicy: String(row.approval_policy ?? "bounded"),
    mergeStrategy: String(row.merge_strategy ?? "approval-required"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function agentCircleFromRow(row: Record<string, unknown>): AgentCircleSummary {
  const roleRows = db.prepare("select role_id from agent_circle_roles where circle_id = ? order by position asc, role_id asc").all(String(row.id)) as Array<Record<string, unknown>>;
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    roleIds: roleRows.map((item) => String(item.role_id)),
    collaborationRules: String(row.collaboration_rules ?? ""),
    eventRoutingRules: String(row.event_routing_rules ?? ""),
    maxConcurrentAgents: Number(row.max_concurrent_agents) || 3,
    approvalPolicy: String(row.approval_policy ?? "bounded"),
    mergeStrategy: String(row.merge_strategy ?? "approval-required"),
    groupTemplateId: row.group_template_id ? String(row.group_template_id) : null,
    builtin: Number(row.builtin) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function roomFromRow(row: Record<string, unknown>): RoomSummary {
  return {
    id: String(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    name: String(row.name),
    groupId: row.group_id ? String(row.group_id) : null,
    circleId: row.circle_id ? String(row.circle_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    status: roomStatus(row.status),
    sharedContext: row.shared_context ? String(row.shared_context) : null,
    goal: activeGoalForOwner("room", String(row.id)),
    orchestration: roomOrchestrationSettings(row.orchestration_settings),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function roomEventFromRow(row: Record<string, unknown>): RoomEventSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    type: String(row.type),
    sourceAgentId: row.source_agent_id ? String(row.source_agent_id) : null,
    targetAgentId: row.target_agent_id ? String(row.target_agent_id) : null,
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
  };
}

function roomArtifactFromRow(row: Record<string, unknown>): RoomArtifactSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    agentId: row.agent_id ? String(row.agent_id) : null,
    kind: String(row.kind) as RoomArtifactSummary["kind"],
    title: String(row.title),
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
  };
}

function createRoomArtifact(roomId: string, input: Omit<RoomArtifactSummary, "id" | "roomId" | "createdAt">) {
  const artifact: RoomArtifactSummary = {
    ...input,
    id: `artifact-${randomUUID()}`,
    roomId,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    insert into room_artifacts (id, room_id, agent_id, kind, title, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(artifact.id, artifact.roomId, artifact.agentId ?? null, artifact.kind, artifact.title, JSON.stringify(artifact.payload ?? {}), artifact.createdAt);
  roomEvent(roomId, "artifact.created", { artifactId: artifact.id, kind: artifact.kind, title: artifact.title }, artifact.agentId ?? null);
  return artifact;
}

function roomDecisionFromRow(row: Record<string, unknown>): RoomDecisionSummary {
  const status = ["open", "approved", "rejected", "resolved"].includes(String(row.status)) ? String(row.status) as RoomDecisionSummary["status"] : "open";
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    title: String(row.title),
    status,
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function createRoomDecision(roomId: string, input: Omit<RoomDecisionSummary, "id" | "roomId" | "createdAt" | "resolvedAt"> & { resolvedAt?: string | null }) {
  const decision: RoomDecisionSummary = {
    ...input,
    id: `decision-${randomUUID()}`,
    roomId,
    createdAt: new Date().toISOString(),
    resolvedAt: input.resolvedAt ?? null,
  };
  db.prepare(`
    insert into room_decisions (id, room_id, title, status, payload, created_at, resolved_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(decision.id, decision.roomId, decision.title, decision.status, JSON.stringify(decision.payload ?? {}), decision.createdAt, decision.resolvedAt ?? null);
  roomEvent(roomId, "decision.created", { decisionId: decision.id, title: decision.title, status: decision.status });
  return decision;
}

function roomHandoffStatus(value: unknown): RoomHandoffSummary["status"] {
  return value === "accepted" || value === "returned" || value === "resolved" || value === "cancelled" ? value : "open";
}

function roomHandoffFromRow(row: Record<string, unknown>): RoomHandoffSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    fromAgentId: row.from_agent_id ? String(row.from_agent_id) : null,
    toAgentId: row.to_agent_id ? String(row.to_agent_id) : null,
    summary: String(row.summary),
    status: roomHandoffStatus(row.status),
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function createRoomHandoff(roomId: string, input: Omit<RoomHandoffSummary, "id" | "roomId" | "createdAt" | "resolvedAt" | "status"> & { status?: RoomHandoffSummary["status"]; resolvedAt?: string | null }) {
  const handoff: RoomHandoffSummary = {
    ...input,
    status: roomHandoffStatus(input.status),
    id: `handoff-${randomUUID()}`,
    roomId,
    createdAt: new Date().toISOString(),
    resolvedAt: input.resolvedAt ?? null,
  };
  db.prepare(`
    insert into room_handoffs (id, room_id, from_agent_id, to_agent_id, summary, status, payload, created_at, resolved_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(handoff.id, handoff.roomId, handoff.fromAgentId ?? null, handoff.toAgentId ?? null, handoff.summary, handoff.status, JSON.stringify(handoff.payload ?? {}), handoff.createdAt, handoff.resolvedAt ?? null);
  roomEvent(roomId, "handoff.created", { handoffId: handoff.id, summary: handoff.summary, status: handoff.status, toAgentId: handoff.toAgentId }, handoff.toAgentId ?? null, handoff.fromAgentId ?? null);
  return handoff;
}

function createSuggestedRoomTask(roomId: string, input: { title: string; prompt: string; assignedAgentId?: string | null; priority?: number | null; sourceAgentId?: string | null }) {
  const title = input.title.trim().slice(0, 180);
  const prompt = input.prompt.trim();
  if (!title || !prompt) return null;
  const assignedAgentId = input.assignedAgentId && db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(roomId, input.assignedAgentId)
    ? input.assignedAgentId
    : null;
  const now = new Date().toISOString();
  const id = `room-task-${randomUUID()}`;
  db.prepare(`
    insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?)
  `).run(
    id,
    roomId,
    title,
    prompt,
    assignedAgentId ? "assigned" : "queued",
    assignedAgentId,
    Number(input.priority ?? 0) || 0,
    JSON.stringify({ source: "agent-suggested", sourceAgentId: input.sourceAgentId ?? null }),
    now,
    now,
  );
  roomEvent(roomId, "task.created", { taskId: id, title, source: "agent-suggested" }, assignedAgentId, input.sourceAgentId ?? null);
  return roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(id) as Record<string, unknown>);
}

function roomTaskFromRow(row: Record<string, unknown>): RoomTaskSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    goalItemId: row.goal_item_id ? String(row.goal_item_id) : null,
    title: String(row.title),
    prompt: String(row.prompt ?? ""),
    assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    status: String(row.status) as RoomTaskSummary["status"],
    priority: Number(row.priority) || 0,
    dependsOnTaskId: row.depends_on_task_id ? String(row.depends_on_task_id) : null,
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function roomScheduleFromRow(row: Record<string, unknown>): RoomScheduleSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    agentId: String(row.agent_id),
    taskPrompt: String(row.task_prompt),
    scheduleType: row.schedule_type === "hourly" || row.schedule_type === "daily" ? row.schedule_type : "once",
    runAt: row.run_at ? String(row.run_at) : null,
    status: row.status === "paused" || row.status === "done" ? row.status : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function agentRunFromRow(row: Record<string, unknown>): AgentRunSummary {
  const merge = db.prepare("select status, summary from room_run_merges where run_id = ?").get(String(row.id)) as { status?: string; summary?: string } | undefined;
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    agentId: String(row.agent_id),
    taskId: row.task_id ? String(row.task_id) : null,
    goalId: row.goal_id ? String(row.goal_id) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
    status: String(row.status) as AgentRunSummary["status"],
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    workspacePath: row.workspace_path ? String(row.workspace_path) : null,
    mergeStatus: merge?.status ? merge.status as AgentRunSummary["mergeStatus"] : "none",
    mergeSummary: merge?.summary ?? null,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
  };
}

function mentionedRoomAgents(content: string, agents: AgentSummary[]) {
  const normalized = content.toLowerCase();
  return agents.filter((agent) => [agent.name, agent.id].some((name) => {
    const value = name.toLowerCase();
    return normalized.includes(`@${value}`) || normalized.includes(`@"${value}"`);
  }));
}

function roomAgentsWithListenModes(roomId: string) {
  const room = db.prepare("select group_id from rooms where id = ?").get(roomId) as { group_id?: string | null } | undefined;
  const rows = db.prepare(`
    select agents.*, coalesce(room_agents.listen_mode, agent_group_members.listen_mode, 'passive') as member_listen_mode
    from agents
    inner join room_agents on room_agents.agent_id = agents.id
    left join agent_group_members on agent_group_members.agent_id = agents.id and agent_group_members.group_id = ?
    where room_agents.room_id = ?
    order by agents.name asc
  `).all(room?.group_id ?? "", roomId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ agent: agentFromRow(row), listenMode: listenMode(row.member_listen_mode) }));
}

function autoListenAgentsForRoomMessage(roomId: string, limit = 20) {
  const members = roomAgentsWithListenModes(roomId).filter((member) => member.agent.enabled && member.listenMode !== "none" && member.listenMode !== "passive");
  const orchestrators = members.filter((member) => member.listenMode === "orchestrator");
  return (orchestrators.length ? orchestrators : members.filter((member) => member.listenMode === "active")).slice(0, limit).map((member) => member.agent);
}

function createListenTasksForRoomEvent(roomId: string, reason: string, content: string, options: { excludeAgentId?: string | null; sourceTaskId?: string | null; limit?: number } = {}) {
  const members = roomAgentsWithListenModes(roomId).filter((member) => member.agent.enabled && member.listenMode !== "none" && member.listenMode !== "passive" && member.agent.id !== options.excludeAgentId);
  const orchestrators = members.filter((member) => member.listenMode === "orchestrator");
  const targets = (orchestrators.length ? orchestrators : members.filter((member) => member.listenMode === "active")).slice(0, Math.max(1, options.limit ?? 20));
  return targets.map((member) => insertRoomTask(
    roomId,
    member.listenMode === "orchestrator" ? `Orchestrate: ${reason}` : `Listen: ${reason}`,
    [
      `Room event: ${reason}`,
      options.sourceTaskId ? `Source task id: ${options.sourceTaskId}` : "",
      "",
      content,
      "",
      member.listenMode === "orchestrator"
        ? "As the orchestrator, decide the next useful action for the room. Create or recommend follow-up work only when it is necessary."
        : "You are an active listener in this room. Reply to the room in one concise message. If no action is needed, acknowledge briefly and say you will keep listening.",
    ].filter(Boolean).join("\n"),
    member.agent.id,
    member.listenMode === "orchestrator" ? 2 : 1,
    null,
    { kind: "listen", reason, sourceTaskId: options.sourceTaskId ?? null },
  ));
}

function insertRoomTask(roomId: string, title: string, prompt: string, assignedAgentId?: string | null, priority = 0, scheduledAt?: string | null, payload: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const id = `room-task-${randomUUID()}`;
  db.prepare(`
    insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?)
  `).run(
    id,
    roomId,
    title.trim(),
    prompt.trim(),
    assignedAgentId ? "assigned" : "queued",
    assignedAgentId ?? null,
    Number(priority) || 0,
    scheduledAt ?? null,
    JSON.stringify(payload),
    now,
    now,
  );
  return roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(id) as Record<string, unknown>);
}

function roomTaskAutoListenDepth(roomId: string, taskId?: string | null) {
  if (!taskId) return 0;
  let depth = 0;
  let currentId: string | null = taskId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const row = db.prepare("select payload from room_tasks where room_id = ? and id = ?").get(roomId, currentId) as { payload?: string | null } | undefined;
    if (!row) break;
    const payload = jsonPayload(row.payload) as { kind?: string; sourceTaskId?: string | null };
    if (payload.kind !== "listen") break;
    depth += 1;
    currentId = payload.sourceTaskId ?? null;
  }
  return depth;
}

function roomEvent(roomId: string, type: string, payload: unknown, targetAgentId?: string | null, sourceAgentId?: string | null) {
  const now = new Date().toISOString();
  const id = `room-event-${randomUUID()}`;
  db.prepare(`
    insert into room_events (id, room_id, type, source_agent_id, target_agent_id, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(id, roomId, type, sourceAgentId ?? null, targetAgentId ?? null, JSON.stringify(payload), now);
  const event = roomEventFromRow(db.prepare("select * from room_events where id = ?").get(id) as Record<string, unknown>);
  publishRoomEvent(roomId, event);
  return event;
}

function findRoomReviewer(roomId: string, excludedAgentId?: string | null) {
  const rows = db.prepare(`
    select agents.*, agent_roles.name as role_name, agent_roles.description as role_description
    from agents
    inner join room_agents on room_agents.agent_id = agents.id
    left join agent_roles on agent_roles.id = agents.role_id
    where room_agents.room_id = ?
  `).all(roomId) as Array<Record<string, unknown>>;
  const reviewer = rows.find((row) => {
    const id = String(row.id);
    if (excludedAgentId && id === excludedAgentId) return false;
    const haystack = `${row.name ?? ""} ${row.role_name ?? ""} ${row.role_description ?? ""}`.toLowerCase();
    return haystack.includes("review") || haystack.includes("审查") || haystack.includes("质量") || haystack.includes("qa");
  });
  return reviewer ? agentFromRow(reviewer) : null;
}

function hasReviewTask(roomId: string, sourceTaskId: string) {
  const rows = db.prepare("select payload, depends_on_task_id, title from room_tasks where room_id = ?").all(roomId) as Array<Record<string, unknown>>;
  return rows.some((row) => {
    if (row.depends_on_task_id && String(row.depends_on_task_id) === sourceTaskId && /review|审查|复核/i.test(String(row.title))) return true;
    const payload = jsonPayload(row.payload) as { sourceTaskId?: string; kind?: string };
    return payload.sourceTaskId === sourceTaskId && payload.kind === "auto-review";
  });
}

function createAutoReviewTask(roomId: string, completedTask: Record<string, unknown>, sourceAgentId?: string | null) {
  const title = String(completedTask.title);
  const payload = jsonPayload(completedTask.payload) as { kind?: string };
  if (payload.kind === "listen" || payload.kind === "auto-review") return null;
  if (/review|审查|复核/i.test(title) || hasReviewTask(roomId, String(completedTask.id))) return null;
  const reviewer = findRoomReviewer(roomId, sourceAgentId);
  if (!reviewer) return null;
  const now = new Date().toISOString();
  const id = `room-task-${randomUUID()}`;
  const prompt = [
    `Review the completed room task: ${title}`,
    `Source task id: ${completedTask.id}`,
    "",
    "Focus on correctness, regressions, missing tests, and actionable follow-up.",
    "If changes are needed, summarize them clearly for the user and the responsible Agent.",
  ].join("\n");
  db.prepare(`
    insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
    values (?, ?, ?, ?, 'assigned', ?, ?, ?, null, ?, ?, ?)
  `).run(
    id,
    roomId,
    `Review: ${title}`.slice(0, 120),
    prompt,
    reviewer.id,
    Number(completedTask.priority ?? 0),
    String(completedTask.id),
    JSON.stringify({ kind: "auto-review", sourceTaskId: String(completedTask.id) }),
    now,
    now,
  );
  roomEvent(roomId, "orchestrator.decision", { action: "create-review-task", taskId: id, sourceTaskId: completedTask.id, reviewerId: reviewer.id }, reviewer.id);
  return roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(id) as Record<string, unknown>);
}

function startEligibleRoomTasks(roomId: string) {
  const room = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!room) return [];
  if (!roomOrchestrationSettings(room.orchestration_settings).autoStartTasks) return [];
  const group = room.group_id ? db.prepare("select * from agent_groups where id = ?").get(String(room.group_id)) as Record<string, unknown> | undefined : undefined;
  const maxConcurrentAgents = group ? Math.max(1, Number(group.max_concurrent_agents ?? 1) || 1) : 1;
  const started = [];
  let runningRoomCount = (db.prepare("select count(*) as count from agent_runs where room_id = ? and status = 'running'").get(roomId) as { count: number } | undefined)?.count ?? 0;
  const tasks = db.prepare(`
    select * from room_tasks
    where room_id = ?
      and status in ('assigned', 'queued', 'failed')
      and assigned_agent_id is not null
    order by priority desc, created_at asc, id asc
    limit 20
  `).all(roomId) as Array<Record<string, unknown>>;
  for (const task of tasks) {
    if (runningRoomCount >= maxConcurrentAgents) break;
    if (task.depends_on_task_id) {
      const dependency = db.prepare("select status from room_tasks where id = ? and room_id = ?").get(String(task.depends_on_task_id), roomId) as { status?: string } | undefined;
      if (dependency?.status !== "done") continue;
    }
    try {
      const result = startRoomTaskRun(roomId, String(task.id));
      started.push(result.run);
      runningRoomCount += 1;
      roomEvent(roomId, "orchestrator.decision", { action: "start-task", taskId: task.id, runId: result.run.id }, String(task.assigned_agent_id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "room_task_start_failed";
      if (message !== "room_concurrency_limit" && message !== "agent_concurrency_limit" && message !== "room_task_dependency_pending") {
        roomEvent(roomId, "orchestrator.decision", { action: "start-task-failed", taskId: task.id, error: message }, String(task.assigned_agent_id));
      }
    }
  }
  return started;
}

function orchestrateRoom(roomId: string, reason: string) {
  const room = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!room) return { tasks: [], runs: [] };
  const settings = roomOrchestrationSettings(room.orchestration_settings);
  const createdTasks = [];
  const latestCompleted = db.prepare(`
    select room_tasks.*, agent_runs.agent_id
    from room_tasks
    left join agent_runs on agent_runs.task_id = room_tasks.id
    where room_tasks.room_id = ? and room_tasks.status in ('done', 'failed')
    order by room_tasks.finished_at desc, room_tasks.updated_at desc
    limit 1
  `).get(roomId) as Record<string, unknown> | undefined;
  if (settings.autoCreateReviewTasks && reason === "agent.completed" && latestCompleted && String(latestCompleted.status) === "done") {
    const task = createAutoReviewTask(roomId, latestCompleted, latestCompleted.agent_id ? String(latestCompleted.agent_id) : null);
    if (task) createdTasks.push(task);
  }
  if (settings.autoListenAfterAgentEvents && (reason === "agent.completed" || reason === "agent.failed") && latestCompleted) {
    const payload = jsonPayload(latestCompleted.payload) as { kind?: string };
    const depth = roomTaskAutoListenDepth(roomId, String(latestCompleted.id));
    if (payload.kind !== "listen" || depth < settings.maxAutoListenChainDepth) {
      createdTasks.push(...createListenTasksForRoomEvent(
        roomId,
        reason,
        `Agent task "${latestCompleted.title}" finished with status ${latestCompleted.status}.`,
        { excludeAgentId: latestCompleted.agent_id ? String(latestCompleted.agent_id) : null, sourceTaskId: String(latestCompleted.id), limit: settings.maxAutoListenTasksPerEvent },
      ));
    } else {
      roomEvent(roomId, "orchestrator.decision", { action: "skip-auto-listen", reason, taskId: latestCompleted.id, depth, maxDepth: settings.maxAutoListenChainDepth });
    }
  }
  if (reason === "task.created") {
    const latestTask = db.prepare(`
      select * from room_tasks
      where room_id = ?
      order by created_at desc, id desc
      limit 1
    `).get(roomId) as Record<string, unknown> | undefined;
    const payload = latestTask ? jsonPayload(latestTask.payload) as { kind?: string } : {};
    if (latestTask && !latestTask.assigned_agent_id && payload.kind !== "listen") {
      createdTasks.push(...createListenTasksForRoomEvent(roomId, reason, `A new unassigned room task was created: ${latestTask.title}.`, { sourceTaskId: String(latestTask.id), limit: settings.maxAutoListenTasksPerEvent }));
    }
  }
  if (settings.notifyUserOnFailure && reason === "agent.failed") {
    roomEvent(roomId, "user.attention", { reason: "agent_failed", message: "A Room Agent task failed and needs review." });
  }
  const runs = startEligibleRoomTasks(roomId);
  return { tasks: createdTasks, runs };
}

function replaceGroupMembers(groupId: string, agentIds: string[], memberListenModes: Record<string, AgentListenMode> = {}) {
  db.prepare("delete from agent_group_members where group_id = ?").run(groupId);
  const insert = db.prepare("insert or ignore into agent_group_members (group_id, agent_id, listen_mode) values (?, ?, ?)");
  for (const agentId of agentIds.filter((id) => db.prepare("select id from agents where id = ?").get(id))) insert.run(groupId, agentId, listenMode(memberListenModes[agentId]));
}

function ensureAgentForRole(role: AgentRoleSummary, now = new Date().toISOString()) {
  const existing = db.prepare("select * from agents where role_id = ? order by created_at asc limit 1").get(role.id) as Record<string, unknown> | undefined;
  if (existing) return agentFromRow(existing);
  const agentId = `agent-${randomUUID()}`;
  db.prepare(`
    insert into agents (id, name, role_id, description, extra_prompt, provider_id, model, listen_mode, listen_events, workspace_mode, default_project_id, favorite_project_ids, project_access_mode, allowed_project_ids, permission_profile_id, permissions, max_concurrent_runs, enabled, created_at, updated_at)
    values (?, ?, ?, ?, null, null, null, ?, ?, ?, null, '[]', 'all', '[]', ?, ?, 1, 1, ?, ?)
  `).run(
    agentId,
    role.name,
    role.id,
    role.description ?? null,
    role.defaultListenMode,
    JSON.stringify(role.defaultListenEvents),
    role.defaultWorkspaceMode,
    "developer",
    JSON.stringify(defaultAgentPermissions),
    now,
    now,
  );
  return agentFromRow(db.prepare("select * from agents where id = ?").get(agentId) as Record<string, unknown>);
}

function createAgentGroupFromCircle(circle: AgentCircleSummary, now = new Date().toISOString()) {
  if (!circle.roleIds.length) throw new Error("agent_circle_has_no_roles");
  const roleRows = circle.roleIds
    .map((roleId) => db.prepare("select * from agent_roles where id = ?").get(roleId) as Record<string, unknown> | undefined)
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (!roleRows.length) throw new Error("agent_circle_has_no_roles");
  const roles = roleRows.map(agentRoleFromRow);
  const agents = roles.map((role) => ensureAgentForRole(role, now));
  const groupId = `agent-group-${randomUUID()}`;
  db.prepare(`
    insert into agent_groups (id, name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(groupId, circle.name, circle.description ?? null, circle.collaborationRules, circle.eventRoutingRules, circle.maxConcurrentAgents, circle.approvalPolicy, circle.mergeStrategy, now, now);
  const insertMember = db.prepare("insert or ignore into agent_group_members (group_id, agent_id, listen_mode) values (?, ?, ?)");
  agents.forEach((agent, index) => {
    const role = roles[index];
    insertMember.run(groupId, agent.id, index === 0 ? "orchestrator" : listenMode(role.defaultListenMode));
  });
  return agentGroupFromRow(db.prepare("select * from agent_groups where id = ?").get(groupId) as Record<string, unknown>);
}

function listAgentRoles(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from agent_roles
    ${cursor ? "where (updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))" : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(agentRoleFromRow), limit, (item) => item.updatedAt);
}

function listAgents(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from agents
    ${cursor ? "where (updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))" : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(agentFromRow), limit, (item) => item.updatedAt);
}

function listAgentGroups(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from agent_groups
    ${cursor ? "where (updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))" : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(agentGroupFromRow), limit, (item) => item.updatedAt);
}

function listAgentCircles(limit = 50, cursorValue?: string | null) {
  const offset = decodeOffsetCursor(cursorValue);
  const rows = db.prepare(`
    select * from agent_circles
    order by builtin desc, name asc, id desc
    limit @limit offset @offset
  `).all({ limit: limit + 1, offset }) as Array<Record<string, unknown>>;
  return offsetPageFromRows(rows.map(agentCircleFromRow), limit, offset);
}

function listRooms(status?: string, limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(status ? ["status = @status"] : []),
    ...(cursor ? ["(updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from rooms
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ status, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(roomFromRow), limit, (item) => item.updatedAt);
}

function createTerminalAdapter(cwd: string): { adapter: TerminalAdapter; mode: "pty" | "pipe"; warning: string | null } {
  const shellPath = resolveShellPath();
  try {
    const shell = spawnPty(shellPath, ["-l"], { name: "xterm-256color", cols: 100, rows: 30, cwd, env: process.env });
    return {
      mode: "pty",
      warning: null,
      adapter: {
        write: (data) => shell.write(data),
        resize: (cols, rows) => shell.resize(cols, rows),
        kill: () => shell.kill(),
        onData: (callback) => shell.onData(callback),
        onExit: (callback) => shell.onExit(({ exitCode }) => callback(exitCode)),
      },
    };
  } catch (error) {
    const child = spawnProcess(shellPath, ["-i"], { cwd, env: process.env });
    return {
      mode: "pipe",
      warning: error instanceof Error ? `PTY fallback: ${error.message}` : "PTY fallback active",
      adapter: {
        write: (data) => child.stdin?.write(data.replaceAll("\r", "\n")),
        resize: () => undefined,
        kill: () => child.kill(),
        onData: (callback) => {
          child.stdout?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
          child.stderr?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
        },
        onExit: (callback) => {
          child.on("error", () => callback(1));
          child.on("close", (exitCode) => callback(exitCode));
        },
      },
    };
  }
}

function resolveShellPath() {
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/usr/bin/zsh",
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/sh",
    "/usr/bin/sh",
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("shell_not_found");
}

function terminalSummary(session: TerminalRuntime): TerminalSessionSummary {
  return {
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    mode: session.mode,
    status: session.status,
    createdAt: session.createdAt,
  };
}

function uniqueTerminalSessionName(preferredName?: string) {
  const existingNames = new Set(listTerminalSessionSummaries().map((session) => session.name));
  const preferred = preferredName?.trim();
  if (preferred && !existingNames.has(preferred)) return preferred;
  if (!preferred || /^shell(?: \d+)?$/.test(preferred)) {
    let shellIndex = 1;
    while (existingNames.has(`shell ${shellIndex}`)) shellIndex += 1;
    return `shell ${shellIndex}`;
  }
  const baseName = preferred;
  let index = 2;
  while (existingNames.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function createTerminalSession(input: CreateTerminalSessionInput = {}) {
  const absoluteCwd = resolveTerminalCwd(input.cwd);
  if (!statSync(absoluteCwd).isDirectory()) throw new Error("cwd_not_directory");
  const { adapter, mode, warning } = createTerminalAdapter(absoluteCwd);
  const session: TerminalRuntime = {
    id: randomUUID(),
    name: uniqueTerminalSessionName(input.name),
    cwd: toTerminalPath(absoluteCwd),
    absoluteCwd,
    mode,
    status: "running",
    createdAt: new Date().toISOString(),
    adapter,
    buffer: "",
    clients: new Set(),
    ephemeral: Boolean(input.ephemeral),
  };
  terminalSessions.set(session.id, session);
  if (!session.ephemeral) upsertTerminalSession(terminalSummary(session));
  const append = (data: string) => {
    session.buffer = (session.buffer + data).slice(-120 * 1024);
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "output", data }));
    }
  };
  if (warning) append(`[warning: ${warning}]\r\n`);
  adapter.onData(append);
  adapter.onExit((exitCode) => {
    session.status = "closed";
    if (!session.ephemeral && !deletedTerminalSessionIds.has(session.id)) upsertTerminalSession(terminalSummary(session));
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "exit", exitCode }));
    }
    terminalSessions.delete(session.id);
  });
  return session;
}

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

function readTaskLogContent(sessionId: string) {
  const path = taskLogPath(sessionId);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const legacyPath = legacyTaskLogPath(sessionId);
  return existsSync(legacyPath) ? readFileSync(legacyPath, "utf8") : "";
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

function appendCodexOutput(sessionId: string, value: string) {
  const item = codexTaskOutputs.get(sessionId);
  if (item) item.output = (item.output + value).slice(-256 * 1024);
  mkdirSync(sessionLogsPath(sessionId), { recursive: true });
  appendFileSync(taskLogPath(sessionId), value, "utf8");
}

function processCodexLogChunk(session: SessionSummary, value: string) {
  const item = codexTaskOutputs.get(session.id);
  if (item) item.output = (item.output + value).slice(-256 * 1024);
  discoverPreviewUrls(session, value);
  publishTaskEvent(session.id, { type: "output", bytes: Buffer.byteLength(value), at: new Date().toISOString() });
  const nextBuffer = (codexTaskStdoutBuffers.get(session.id) ?? "") + value;
  const lines = nextBuffer.split(/\r?\n/);
  codexTaskStdoutBuffers.set(session.id, lines.pop() ?? "");
  for (const line of lines) {
    rememberCodexSessionId(session, line);
    const activity = line.trim() ? readActivityEvent(line) : null;
    if (activity && activity.type === "activity") {
      publishTaskEvent(session.id, activity);
      if ((activity.kind === "file" || activity.kind === "command") && (activity.status === "completed" || activity.status === "failed")) {
        publishTaskEvent(session.id, { type: "workspace", session, reason: "activity", at: new Date().toISOString() });
      }
    }
    const assistantText = readAssistantText(line);
    if (assistantText) {
      const message = appendSessionMessage(session.id, "assistant", assistantText);
      ingestAssistantArtifacts(session, message, assistantText);
      publishTaskEvent(session.id, { type: "message", message, session });
    }
  }
}

function appendCodexErrorOutput(session: SessionSummary, value: string) {
  appendCodexOutput(session.id, value);
  processCodexLogChunk(session, value);
}

function readTaskExitCode(sessionId: string) {
  const path = taskMetaPath(sessionId);
  const metaPath = existsSync(path) ? path : legacyTaskMetaPath(sessionId);
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as { exitCode?: number | null };
    return typeof parsed.exitCode === "number" ? parsed.exitCode : null;
  } catch {
    return null;
  }
}

function readTaskMeta(sessionId: string) {
  const path = taskMetaPath(sessionId);
  const metaPath = existsSync(path) ? path : legacyTaskMetaPath(sessionId);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as { exitCode?: number | null; running?: boolean; error?: string | null; runnerPid?: number | null; childPid?: number | null };
  } catch {
    return null;
  }
}

function writeTaskExitCode(sessionId: string, exitCode: number | null) {
  mkdirSync(sessionLogsPath(sessionId), { recursive: true });
  const previous = readTaskMeta(sessionId) ?? {};
  writeFileSync(taskMetaPath(sessionId), JSON.stringify({ ...previous, running: false, exitCode, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

function taskRunFromRow(row: Record<string, unknown>): TaskRunSummary {
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

function taskActivityFromRow(row: Record<string, unknown>): TaskActivitySummary {
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

function insertTaskActivity(sessionId: string, activity: Extract<TaskEvent, { type: "activity" }>, now: string, activityId = activity.id ?? null) {
  if (activityId) {
    db.prepare(`
      insert into task_activities (id, session_id, activity_id, kind, label, detail, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(session_id, kind, activity_id) where activity_id is not null do update set
        label = excluded.label,
        detail = excluded.detail,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      `task-activity-${randomUUID()}`,
      sessionId,
      activityId,
      activity.kind,
      activity.label,
      activity.detail ?? null,
      activity.status ?? null,
      now,
      now,
    );
    return;
  }
  db.prepare(`
    insert into task_activities (id, session_id, activity_id, kind, label, detail, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `task-activity-${randomUUID()}`,
    sessionId,
    null,
    activity.kind,
    activity.label,
    activity.detail ?? null,
    activity.status ?? null,
    now,
    now,
  );
}

function recordRoomParentActivity(sessionId: string, activity: Extract<TaskEvent, { type: "activity" }>, now: string) {
  const session = appData.sessions.find((item) => item.id === sessionId);
  if (session?.conversationType !== "agent" || !session.roomId) return;
  const room = db.prepare("select session_id from rooms where id = ?").get(session.roomId) as { session_id?: string | null } | undefined;
  const parentSessionId = room?.session_id ? String(room.session_id) : null;
  if (!parentSessionId || parentSessionId === sessionId) return;
  const run = db.prepare("select agent_id from agent_runs where session_id = ? order by started_at desc limit 1").get(sessionId) as { agent_id?: string | null } | undefined;
  const agent = run?.agent_id ? db.prepare("select name from agents where id = ?").get(String(run.agent_id)) as { name?: string } | undefined : undefined;
  const label = agent?.name ? `${agent.name}: ${activity.label}` : activity.label;
  insertTaskActivity(parentSessionId, { ...activity, label }, now, activity.id ? `${sessionId}:${activity.id}` : null);
  publishRoomEvent(session.roomId);
}

function recordTaskActivity(sessionId: string, activity: Extract<TaskEvent, { type: "activity" }>) {
  const now = activity.at || new Date().toISOString();
  insertTaskActivity(sessionId, activity, now);
  recordRoomParentActivity(sessionId, activity, now);
}

function listTaskActivities(sessionId: string, limit = 30, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from task_activities
    where session_id = @sessionId
      ${cursor ? "and (updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))" : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ sessionId, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: parsePageLimit(String(limit)) + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(taskActivityFromRow), parsePageLimit(String(limit)), (item) => item.updatedAt);
}

function backfillTaskActivitiesFromLog(sessionId: string) {
  const content = readTaskLogContent(sessionId).slice(-512 * 1024);
  if (!content) return;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    const activity = readActivityEvent(line);
    if (activity?.type === "activity") recordTaskActivity(sessionId, activity);
  }
}

function backfillSessionFromTaskLog(session: SessionSummary) {
  const content = readTaskLogContent(session.id);
  if (!content) return;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    rememberCodexSessionId(session, line);
    const activity = readActivityEvent(line);
    if (activity?.type === "activity") recordTaskActivity(session.id, activity);
    const assistantText = readAssistantText(line);
    if (!assistantText) continue;
    const existing = db.prepare("select id from messages where session_id = ? and role = 'assistant' and content = ? limit 1").get(session.id, assistantText);
    if (existing) continue;
    const message = appendSessionMessage(session.id, "assistant", assistantText);
    ingestAssistantArtifacts(session, message, assistantText);
  }
}

function backfillRoomActivitiesFromAgentLogs(session: SessionSummary) {
  if (session.conversationType !== "room" || !session.roomId) return;
  const rows = db.prepare(`
    select session_id
    from agent_runs
    where room_id = ? and session_id is not null
    order by started_at desc
    limit 20
  `).all(session.roomId) as Array<{ session_id?: string | null }>;
  for (const row of rows) {
    const childSessionId = row.session_id ? String(row.session_id) : "";
    if (!childSessionId) continue;
    const content = readTaskLogContent(childSessionId).slice(-256 * 1024);
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim().startsWith("{")) continue;
      const activity = readActivityEvent(line);
      if (activity?.type === "activity") recordRoomParentActivity(childSessionId, activity, activity.at || new Date().toISOString());
    }
  }
}

function createTaskRun(sessionId: string, pid?: number, metadata?: { promptChars?: number; promptHash?: string; contextPath?: string }) {
  const id = `task-run-${randomUUID()}`;
  db.prepare(`
    insert into task_runs (id, session_id, status, pid, started_at, stop_requested, prompt_chars, prompt_hash, context_path)
    values (?, ?, 'running', ?, ?, 0, ?, ?, ?)
  `).run(id, sessionId, pid ?? null, new Date().toISOString(), metadata?.promptChars ?? null, metadata?.promptHash ?? null, metadata?.contextPath ?? null);
  return id;
}

function isProcessAlive(pid?: number | null) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function latestRunningTaskRun(sessionId: string) {
  return db.prepare(`
    select * from task_runs
    where session_id = ? and status = 'running'
    order by started_at desc, id desc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
}

function finishTaskRun(sessionId: string, status: TaskRunSummary["status"], exitCode: number | null, reason?: string) {
  db.prepare(`
    update task_runs
    set status = ?, ended_at = ?, exit_code = ?, interrupted_reason = coalesce(?, interrupted_reason)
    where session_id = ? and status = 'running'
  `).run(status, new Date().toISOString(), exitCode, reason ?? null, sessionId);
}

function markTaskRunStopRequested(sessionId: string) {
  db.prepare("update task_runs set stop_requested = 1 where session_id = ? and status = 'running'").run(sessionId);
}

function listTaskRuns(status?: string, limit = 50, cursorValue?: string | null) {
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

function listTaskRunsForSession(sessionId: string, limit = 30, cursorValue?: string | null) {
  const session = appData.sessions.find((item) => item.id === sessionId);
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

function taskLogBytes(sessionId: string) {
  const path = taskLogPath(sessionId);
  if (existsSync(path)) return statSync(path).size;
  const legacyPath = legacyTaskLogPath(sessionId);
  return existsSync(legacyPath) ? statSync(legacyPath).size : 0;
}

function listTaskHealth(): TaskHealthResponse {
  const rows = db.prepare(`
    select *
    from task_runs
    where status = 'running'
    order by started_at desc, id desc
    limit 100
  `).all() as Array<Record<string, unknown>>;
  const items = rows.map((row) => {
    const run = taskRunFromRow(row);
    const session = appData.sessions.find((item) => item.id === run.sessionId);
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

function repairTaskHealth(): TaskHealthRepairResponse {
  const repaired: TaskHealthRepairResponse["repaired"] = [];
  const before = listTaskHealth();
  for (const item of before.items) {
    if (!item.issue) continue;
    const session = appData.sessions.find((entry) => entry.id === item.sessionId);
    if (item.issue === "runner_finished" && session) {
      const meta = readTaskMeta(item.sessionId);
      backfillSessionFromTaskLog(session);
      finalizeCodexRunnerTask(session, typeof meta?.exitCode === "number" ? meta.exitCode : null, meta?.error ?? "task_health_repair_runner_finished");
      repaired.push({ sessionId: item.sessionId, issue: item.issue, action: "finalized_from_runner_meta" });
      continue;
    }
    if (item.issue === "runner_pid_missing" && session) {
      session.status = "interrupted";
      session.updatedAt = new Date().toISOString();
      finishTaskRun(session.id, "interrupted", null, "task_health_repair_runner_pid_missing");
      writeTaskExitCode(session.id, null);
      recordTaskActivity(session.id, {
        type: "activity",
        kind: "tool",
        label: "任务状态已修复",
        detail: "runner_pid_missing",
        status: "failed",
        at: session.updatedAt,
      });
      appendSessionMessage(session.id, "system", `Task health repair at ${session.updatedAt}; runner process was missing and the task was marked interrupted.`);
      upsertSession(session);
      repaired.push({ sessionId: item.sessionId, issue: item.issue, action: "marked_interrupted" });
      continue;
    }
    if (item.issue === "session_not_running") {
      finishTaskRun(item.sessionId, "interrupted", null, "task_health_repair_session_not_running");
      repaired.push({ sessionId: item.sessionId, issue: item.issue, action: "closed_running_task_run" });
    }
  }
  if (repaired.length) saveAppData();
  return { ok: true, repaired, health: listTaskHealth() };
}

function readCodexSessionId(line: string) {
  try {
    const event = JSON.parse(line) as { type?: string; thread_id?: string; payload?: { id?: string; thread_id?: string } };
    if (event.type === "session_meta" && event.payload?.id) return event.payload.id;
    if (event.type === "thread.started" && event.thread_id) return event.thread_id;
    if (event.type === "event_msg" && event.payload?.thread_id) return event.payload.thread_id;
  } catch {
    return "";
  }
  return "";
}

function rememberCodexSessionId(session: SessionSummary, line: string) {
  if (session.codexSessionId) return;
  const codexSessionId = readCodexSessionId(line);
  if (!codexSessionId) return;
  session.codexSessionId = codexSessionId;
  session.updatedAt = new Date().toISOString();
  saveAppData();
  rememberRoomAgentThread(session);
}

function restoreCodexSessionIdFromLog(session: SessionSummary) {
  if (session.codexSessionId) return;
  for (const line of readTaskLogContent(session.id).split(/\r?\n/)) {
    const codexSessionId = readCodexSessionId(line);
    if (!codexSessionId) continue;
    session.codexSessionId = codexSessionId;
    session.updatedAt = new Date().toISOString();
    saveAppData();
    rememberRoomAgentThread(session);
    return;
  }
}

function readRoomAgentThread(roomId: string, agentId: string) {
  const row = db.prepare("select codex_session_id, workspace_path from room_agent_threads where room_id = ? and agent_id = ?").get(roomId, agentId) as { codex_session_id?: string; workspace_path?: string | null } | undefined;
  if (!row?.codex_session_id) return null;
  return { codexSessionId: row.codex_session_id, workspacePath: row.workspace_path ?? null };
}

function readRoomAgentThreadId(roomId: string, agentId: string) {
  return readRoomAgentThread(roomId, agentId)?.codexSessionId ?? null;
}

function rememberRoomAgentThread(session: SessionSummary) {
  if (session.conversationType !== "agent" || !session.roomId || !session.codexSessionId) return;
  const run = db.prepare("select agent_id from agent_runs where session_id = ? order by started_at desc, id desc limit 1").get(session.id) as { agent_id?: string } | undefined;
  if (!run?.agent_id) return;
  const now = new Date().toISOString();
  db.prepare(`
    insert into room_agent_threads (room_id, agent_id, codex_session_id, workspace_path, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(room_id, agent_id) do update set
      codex_session_id = excluded.codex_session_id,
      workspace_path = excluded.workspace_path,
      updated_at = excluded.updated_at
  `).run(session.roomId, run.agent_id, session.codexSessionId, session.workspacePath, now, now);
}

function stringifyReadable(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(stringifyReadable).filter(Boolean).join("\n").trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text.trim();
    if (typeof record.content === "string") return record.content.trim();
    if (typeof record.message === "string") return record.message.trim();
  }
  return "";
}

function readAssistantText(line: string) {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    const item = event.item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.type === "agent_message") {
        return stringifyReadable(record.text ?? record.content ?? record.message);
      }
    }
    if (event.type === "agent_message") {
      return stringifyReadable(event.text ?? event.content ?? event.message);
    }
  } catch {
    return "";
  }
  return "";
}

function readTextField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function shortenActivityDetail(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function readActivityId(item: Record<string, unknown>, event: Record<string, unknown>) {
  return readTextField(item, ["id", "call_id"]) || readTextField(event, ["id", "item_id"]);
}

function readActivityStatus(item: Record<string, unknown>, event: Record<string, unknown>) {
  const explicitStatus = readTextField(item, ["status"]) || readTextField(event, ["status"]);
  if (explicitStatus) return explicitStatus;
  const eventType = String(event.type ?? "");
  if (eventType.endsWith(".started")) return "in_progress";
  if (eventType.endsWith(".completed")) return "completed";
  return "";
}

function activityLabel(kind: "command" | "file" | "tool", status: string) {
  const done = status === "completed";
  const failed = status === "failed";
  if (kind === "command") return failed ? "命令运行失败" : done ? "运行命令完成" : "正在运行命令";
  if (kind === "file") return failed ? "文件操作失败" : done ? "文件操作完成" : "正在编辑文件";
  return failed ? "工具调用失败" : done ? "工具调用完成" : "正在调用工具";
}

function readFileActivityPath(item: Record<string, unknown>) {
  const direct = readTextField(item, ["path", "file", "file_path", "filename", "target_file"]);
  if (direct) return direct;
  const changes = item.changes;
  if (!Array.isArray(changes)) return "";
  const first = changes.find((change) => change && typeof change === "object") as Record<string, unknown> | undefined;
  return first ? readTextField(first, ["path", "file", "file_path", "filename", "target_file"]) : "";
}

function readActivityEvent(line: string): TaskEvent | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    if (line.includes("patch rejected") || line.includes("writing is blocked")) {
      return {
        type: "activity",
        kind: "file",
        label: "文件写入被沙箱拦截",
        detail: shortenActivityDetail(line),
        status: "failed",
        at: new Date().toISOString(),
      };
    }
    return null;
  }
  const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : event;
  const itemType = String(item.type ?? event.type ?? "");
  const status = readActivityStatus(item, event);
  const id = readActivityId(item, event);
  if (itemType === "command_execution") {
    const command = readTextField(item, ["command"]);
    if (!command) return null;
    return {
      type: "activity",
      id,
      kind: "command",
      label: activityLabel("command", status),
      detail: shortenActivityDetail(command),
      status,
      at: new Date().toISOString(),
    };
  }
  const filePath = readFileActivityPath(item);
  if (filePath || ["file_change", "file_operation", "apply_patch", "patch"].includes(itemType)) {
    return {
      type: "activity",
      id,
      kind: "file",
      label: activityLabel("file", status),
      detail: shortenActivityDetail(filePath || itemType),
      status,
      at: new Date().toISOString(),
    };
  }
  const toolName = readTextField(item, ["tool", "name", "tool_name"]);
  if (toolName || itemType.includes("tool")) {
    return {
      type: "activity",
      id,
      kind: "tool",
      label: activityLabel("tool", status),
      detail: shortenActivityDetail(toolName || itemType),
      status,
      at: new Date().toISOString(),
    };
  }
  return null;
}

function parseAssistantArtifactBlocks(text: string) {
  const blocks = Array.from(text.matchAll(/```(?:codex-web-artifact|artifact)\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean);
  return blocks.flatMap((block) => {
    try {
      const parsed = JSON.parse(block) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.flatMap((item) => item && typeof item === "object" ? [item as Record<string, unknown>] : []);
    } catch {
      return [];
    }
  });
}

function parseRoomUpdateBlocks(text: string) {
  const blocks = Array.from(text.matchAll(/```codex-web-room-update\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean);
  return blocks.flatMap((block) => {
    try {
      const parsed = JSON.parse(block) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.flatMap((item) => item && typeof item === "object" ? [item as Record<string, unknown>] : []);
    } catch {
      return [];
    }
  });
}

function parseNotificationSkillBlocks(text: string) {
  const blocks = Array.from(text.matchAll(/```codex-web-notification\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean);
  return blocks.flatMap((block) => {
    try {
      const parsed = JSON.parse(block) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.flatMap((item) => item && typeof item === "object" ? [item as Record<string, unknown>] : []);
    } catch {
      return [];
    }
  });
}

function parseCrossSessionSkillBlocks(text: string) {
  const blocks = Array.from(text.matchAll(/```codex-web-cross-session\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean);
  return blocks.flatMap((block) => {
    try {
      const parsed = JSON.parse(block) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.flatMap((item) => item && typeof item === "object" ? [item as Record<string, unknown>] : []);
    } catch {
      return [];
    }
  });
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean) : [];
}

function roomDecisionStatus(value: unknown): RoomDecisionSummary["status"] {
  return value === "approved" || value === "rejected" || value === "resolved" ? value : "open";
}

function resolveNotificationRecipientIds(input: Record<string, unknown>, context: ReturnType<typeof notificationPermissionContext>) {
  const recipients = listNotificationRecipients()
    .filter((recipient) => recipient.enabled)
    .filter((recipient) => notificationPermissionAllows(recipient.permissions, context));
  const byId = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  const byName = new Map(recipients.map((recipient) => [recipient.name.toLowerCase(), recipient]));
  const raw = [
    ...stringArray(input.recipientIds),
    ...stringArray(input.recipients),
    ...stringArray(input.recipientNames),
  ];
  return Array.from(new Set(raw.flatMap((value) => {
    const item = byId.get(value) ?? byName.get(value.toLowerCase());
    return item ? [item.id] : [];
  })));
}

function notificationEventTypesFromSkill(value: unknown): NotificationEventType[] {
  const allowed: NotificationEventType[] = ["task_completed", "task_failed", "task_interrupted", "needs_approval"];
  const selected = stringArray(value).filter((type): type is NotificationEventType => allowed.includes(type as NotificationEventType));
  return selected.length ? selected : ["task_completed"];
}

function notificationExpireModeFromSkill(value: unknown) {
  return value === "session_end" || value === "manual" ? value : "after_trigger";
}

function resolveCrossSessionTarget(sourceSession: SessionSummary, input: Record<string, unknown>) {
  const targetSessionId = typeof input.targetSessionId === "string" ? input.targetSessionId.trim() : typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (targetSessionId) {
    const exact = appData.sessions.find((item) => item.id === targetSessionId);
    if (exact) return exact;
  }
  const targetTitle = typeof input.targetTitle === "string" ? input.targetTitle.trim().toLowerCase() : typeof input.title === "string" ? input.title.trim().toLowerCase() : "";
  if (!targetTitle) return null;
  const candidates = appData.sessions
    .filter((item) => item.id !== sourceSession.id)
    .filter((item) => item.title.toLowerCase() === targetTitle || item.title.toLowerCase().includes(targetTitle))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return candidates[0] ?? null;
}

function crossSessionProgressMarkdown(target: SessionSummary) {
  const latestRun = listTaskRunsForSession(target.id, 1).items[0] ?? null;
  const messages = allSessionMessages(target.id).filter((message) => message.role !== "system").slice(-8);
  const memory = latestSessionMemoryMarkdown(target.id);
  return [
    "# Cross-Session Progress",
    `- session: ${target.id}`,
    `- title: ${target.title}`,
    `- type: ${target.conversationType ?? "codex"}`,
    `- status: ${target.status}`,
    `- project: ${target.projectId ?? "scratch"}`,
    `- updated: ${target.updatedAt}`,
    latestRun ? `- latest run: ${latestRun.status} started=${latestRun.startedAt} ended=${latestRun.endedAt ?? "running"} exit=${latestRun.exitCode ?? "null"}` : "- latest run: none",
    "",
    memory ? "## Persistent Summary" : "",
    memory ? truncateContextText(memory, 6000) : "",
    "",
    "## Recent Messages",
    messages.length ? messages.map((message) => [
      `### ${message.role} ${message.createdAt}`,
      truncateContextText(message.content, 1600),
    ].join("\n")).join("\n\n") : "No recent messages.",
  ].filter((line) => line !== "").join("\n");
}

function dispatchMessageToSession(target: SessionSummary, content: string) {
  restoreCodexSessionIdFromLog(target);
  if (codexTaskProcesses.has(target.id) || target.status === "running") {
    const queued = enqueueMessage(target, {
      prompt: content,
      providerId: target.providerId ?? null,
      model: target.model ?? null,
    });
    return { mode: "queued", queuedId: queued.id };
  }
  const providerId = target.providerId ?? null;
  const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
  const selectedModel = target.model ?? provider?.defaultModel ?? null;
  const cwd = resolveSessionCwd(target);
  target.providerId = provider?.id ?? null;
  target.model = selectedModel;
  target.status = "running";
  target.updatedAt = new Date().toISOString();
  const userMessage = appendSessionMessage(target.id, "user", content);
  saveAppData();
  startCodexTask(target, promptForDirectAgentSession(target, content), cwd, provider, selectedModel, !target.codexSessionId, [], {
    currentMessageId: userMessage.id,
  });
  return { mode: "started", messageId: userMessage.id };
}

function sendCrossSessionMessage(sourceSession: SessionSummary, target: SessionSummary, message: string) {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("cross_session_message_required");
  const content = [
    `Cross-session message from "${sourceSession.title}" (${sourceSession.id}):`,
    "",
    trimmed,
  ].join("\n");
  return dispatchMessageToSession(target, content);
}

function enqueueCrossSessionFollowup(session: SessionSummary, result: string) {
  if (!codexTaskProcesses.has(session.id) && session.status !== "running") return;
  enqueueMessage(session, {
    prompt: [
      "A controlled cross-session capability returned the following result.",
      "Use it to answer the user's original request directly.",
      "Do not emit another codex-web-cross-session block unless the user asks for another target or the result is insufficient.",
      "",
      result,
    ].join("\n"),
    providerId: session.providerId ?? null,
    model: session.model ?? null,
  });
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string; title?: string; username?: string; type?: string };
    from?: { id?: number | string; username?: string; first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id?: number;
      chat?: { id?: number | string; title?: string; username?: string; type?: string };
    };
    from?: { id?: number | string; username?: string; first_name?: string };
  };
};

function telegramConfigList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function telegramUpdateChatId(update: TelegramUpdate) {
  const id = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  return id === undefined ? "" : String(id);
}

function telegramUpdateUserId(update: TelegramUpdate) {
  const id = update.message?.from?.id ?? update.callback_query?.from?.id;
  return id === undefined ? "" : String(id);
}

function telegramInboundAllowed(account: NotificationAccountRecord, update: TelegramUpdate) {
  const config = account.config as Record<string, unknown>;
  const chatId = telegramUpdateChatId(update);
  const userId = telegramUpdateUserId(update);
  const allowedChatIds = telegramConfigList(config.allowedChatIds);
  const allowedUserIds = telegramConfigList(config.allowedUserIds);
  if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return false;
  if (allowedUserIds.length && !allowedUserIds.includes(userId)) return false;
  return Boolean(chatId);
}

function telegramRouteSession(account: NotificationAccountRecord, chatId: string) {
  const accountId = account.id;
  const row = db.prepare("select session_id from telegram_chat_routes where account_id = ? and chat_id = ?").get(accountId, chatId) as { session_id?: string } | undefined;
  const sessionId = row?.session_id ?? String((account.config as Record<string, unknown>).defaultSessionId ?? "");
  return sessionId ? appData.sessions.find((session) => session.id === sessionId) ?? null : null;
}

function telegramSessionChoices(limit = 8) {
  return appData.sessions
    .slice()
    .filter((session) => !(session.conversationType === "agent" && session.roomId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function telegramSessionLabel(session: SessionSummary, index?: number) {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = session.id.length > 12 ? `${session.id.slice(0, 12)}...` : session.id;
  return `${prefix}${session.title} (${shortId})`;
}

function telegramAgentChoices(limit = 8) {
  const rows = db.prepare("select * from agents where enabled = 1 order by updated_at desc, id desc limit ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map(agentFromRow);
}

function telegramAgentLabel(agent: AgentSummary, index?: number) {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = agent.id.length > 12 ? `${agent.id.slice(0, 12)}...` : agent.id;
  return `${prefix}${agent.name} (${shortId})`;
}

function telegramRoomChoices(limit = 8) {
  const rows = db.prepare("select * from rooms order by updated_at desc, id desc limit ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map(roomFromRow);
}

function telegramRoomLabel(room: RoomSummary, index?: number) {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const shortId = room.id.length > 12 ? `${room.id.slice(0, 12)}...` : room.id;
  return `${prefix}${room.name} (${shortId})`;
}

function telegramPendingKey(accountId: string, chatId: string) {
  return `${accountId}:${chatId}`;
}

function telegramSelectionKey(accountId: string, chatId: string, kind: "agent" | "room") {
  return `${accountId}:${chatId}:${kind}`;
}

function createTelegramAgentSession(agent: AgentSummary) {
  if (!agent.enabled) throw new Error("agent_disabled");
  const project = resolveAgentProject(agent);
  const provider = agent.providerId ? appData.providers.find((item) => item.id === agent.providerId) : appData.providers[0];
  const now = new Date().toISOString();
  const id = `task-${randomUUID()}`;
  const session: SessionSummary = {
    id,
    kind: project ? "project" : "scratch",
    conversationType: "agent",
    roomId: null,
    directAgentId: agent.id,
    title: agent.name,
    projectId: project?.id ?? null,
    workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id),
    providerId: provider?.id ?? null,
    model: agent.model ?? provider?.defaultModel ?? null,
    status: "paused",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions.unshift(session);
  upsertSession(session);
  db.prepare("insert into agent_sessions (session_id, agent_id, created_at) values (?, ?, ?)").run(session.id, agent.id, now);
  return session;
}

function telegramRootChoices(chatSession?: SessionSummary | null) {
  const roots: Array<{ label: string; root: string }> = [];
  if (chatSession?.workspacePath) roots.push({ label: telegramSessionLabel(chatSession), root: chatSession.workspacePath });
  if (!chatSession) roots.push({ label: "System workspace", root: workspaceRoot });
  for (const session of telegramSessionChoices(8)) {
    if (chatSession?.id === session.id || !session.workspacePath) continue;
    roots.push({ label: telegramSessionLabel(session), root: session.workspacePath });
  }
  const seen = new Set<string>();
  return roots.filter((item) => {
    const root = resolve(item.root);
    if (seen.has(root) || !existsSync(root) || !statSync(root).isDirectory()) return false;
    seen.add(root);
    item.root = root;
    return true;
  }).slice(0, 9);
}

function telegramSafeRelativePath(input = "") {
  return input.split("/").map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..").join("/");
}

function telegramDangerousCommand(command: string) {
  return /\b(rm\s+-[^\n]*r|shutdown|reboot|halt|mkfs|dd\s+if=|:\(\)\s*\{)\b/i.test(command);
}

function setTelegramRouteSession(accountId: string, chatId: string, sessionId: string) {
  db.prepare(`
    insert into telegram_chat_routes (account_id, chat_id, session_id, updated_at)
    values (?, ?, ?, ?)
    on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at
  `).run(accountId, chatId, sessionId, new Date().toISOString());
}

function clearTelegramRouteSession(accountId: string, chatId: string) {
  db.prepare("delete from telegram_chat_routes where account_id = ? and chat_id = ?").run(accountId, chatId);
}

async function sendTelegramText(account: NotificationAccountRecord, chatId: string, text: string) {
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function sendTelegramSessionPicker(account: NotificationAccountRecord, chatId: string, message: string) {
  const choices = telegramSessionChoices();
  if (!choices.length) {
    await sendTelegramText(account, chatId, "No sessions are available. Create a session first.");
    return;
  }
  telegramPendingSends.set(telegramPendingKey(account.id, chatId), {
    message,
    sessionIds: choices.map((session) => session.id),
    createdAt: Date.now(),
  });
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text: "Select a session to send this message:",
    reply_markup: {
      inline_keyboard: [
        ...choices.map((session, index) => ([{
        text: telegramSessionLabel(session, index).slice(0, 64),
        callback_data: `send:${index}`,
        }])),
        [{ text: "Cancel", callback_data: "cancel" }],
      ],
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function sendTelegramAgents(account: NotificationAccountRecord, chatId: string) {
  const choices = telegramAgentChoices();
  if (!choices.length) {
    await sendTelegramText(account, chatId, "No enabled agents are available.");
    return;
  }
  telegramPendingSelections.set(telegramSelectionKey(account.id, chatId, "agent"), {
    ids: choices.map((agent) => agent.id),
    createdAt: Date.now(),
  });
  const text = [
    "Agents:",
    "",
    ...choices.map((agent, index) => `${telegramAgentLabel(agent, index)}\n${agent.description ?? "No description"}`),
    "",
    "Tap an agent to create and bind a new session.",
  ].join("\n\n");
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 3900),
    reply_markup: {
      inline_keyboard: [
        ...choices.map((agent, index) => ([{
        text: telegramAgentLabel(agent, index).slice(0, 64),
        callback_data: `agent:${index}`,
        }])),
        [{ text: "Cancel", callback_data: "cancel" }],
      ],
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function sendTelegramRooms(account: NotificationAccountRecord, chatId: string) {
  const choices = telegramRoomChoices();
  if (!choices.length) {
    await sendTelegramText(account, chatId, "No rooms are available.");
    return;
  }
  telegramPendingSelections.set(telegramSelectionKey(account.id, chatId, "room"), {
    ids: choices.map((room) => room.id),
    createdAt: Date.now(),
  });
  const text = [
    "Rooms:",
    "",
    ...choices.map((room, index) => `${telegramRoomLabel(room, index)}\n${room.status}${room.sessionId ? ` · ${room.sessionId}` : ""}`),
    "",
    "Tap a room to bind this chat to its session.",
  ].join("\n\n");
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 3900),
    reply_markup: {
      inline_keyboard: [
        ...choices.map((room, index) => ([{
        text: telegramRoomLabel(room, index).slice(0, 64),
        callback_data: `room:${index}`,
        }])),
        [{ text: "Cancel", callback_data: "cancel" }],
      ],
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function sendTelegramFileRootPicker(account: NotificationAccountRecord, chatId: string) {
  const roots = telegramRootChoices(null);
  if (!roots.length) {
    await sendTelegramText(account, chatId, "No file roots are available.");
    return;
  }
  telegramPendingFileRoots.set(telegramPendingKey(account.id, chatId), { roots, createdAt: Date.now() });
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text: "Select a file root:",
    reply_markup: {
      inline_keyboard: [
        ...roots.map((root, index) => ([{ text: root.label.slice(0, 64), callback_data: `filectx:${index}` }])),
        [{ text: "Cancel", callback_data: "cancel" }],
      ],
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function sendTelegramFiles(account: NotificationAccountRecord, chatId: string, root: string, relPath = "") {
  const safeRel = telegramSafeRelativePath(relPath);
  const target = resolve(root, safeRel);
  if (!pathWithinRoot(target, root) || !existsSync(target) || !statSync(target).isDirectory()) {
    await sendTelegramText(account, chatId, "Directory is not available.");
    return;
  }
  const entries = readdirSync(target, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => {
      const fullPath = join(target, entry.name);
      const stat = statSync(fullPath);
      return { name: entry.name, directory: entry.isDirectory(), size: stat.size, updatedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    .slice(0, 40);
  const dirs = entries.filter((entry) => entry.directory).slice(0, 20);
  telegramPendingFiles.set(telegramPendingKey(account.id, chatId), {
    root,
    relPath: safeRel,
    dirNames: dirs.map((entry) => entry.name),
    createdAt: Date.now(),
  });
  const text = [
    `Files: /${safeRel}`,
    "",
    ...entries.map((entry) => `${entry.directory ? "[dir]" : "[file]"} ${entry.name}${entry.directory ? "" : ` · ${entry.size} bytes`}`),
  ].join("\n").slice(0, 3900);
  const keyboard = [
    ...dirs.map((entry, index) => ([{ text: `[dir] ${entry.name}`.slice(0, 64), callback_data: `file:${index}` }])),
    ...(safeRel ? [[{ text: "..", callback_data: "fileup" }]] : []),
    [{ text: "Cancel", callback_data: "cancel" }],
  ];
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: keyboard },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function sendTelegramTerminalRootPicker(account: NotificationAccountRecord, chatId: string, command: string) {
  const roots = telegramRootChoices(null);
  if (!roots.length) {
    await sendTelegramText(account, chatId, "No terminal roots are available.");
    return;
  }
  telegramPendingTerminal.set(telegramPendingKey(account.id, chatId), { command, roots, createdAt: Date.now() });
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text: `Select where to run:\n${command}`,
    reply_markup: {
      inline_keyboard: [
        ...roots.map((root, index) => ([{ text: root.label.slice(0, 64), callback_data: `term:${index}` }])),
        [{ text: "Cancel", callback_data: "cancel" }],
      ],
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function runTelegramTerminal(account: NotificationAccountRecord, chatId: string, cwd: string, command: string) {
  if (!command.trim()) {
    await sendTelegramText(account, chatId, "Usage: /terminal <command>");
    return;
  }
  if (telegramDangerousCommand(command)) {
    await sendTelegramText(account, chatId, "Command blocked by safety guard.");
    return;
  }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    await sendTelegramText(account, chatId, "Terminal directory is not available.");
    return;
  }
  await sendTelegramText(account, chatId, `Running in ${cwd}:\n${command}`);
  const shell = resolveShellPath();
  const output = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolveRun) => {
    const child = spawnProcess(shell, ["-lc", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolveRun({ code: null, stdout, stderr, timedOut: true });
    }, 20_000);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk).slice(0, 20_000); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk).slice(0, 20_000); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr, timedOut: false });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: null, stdout, stderr: error.message, timedOut: false });
    });
  });
  await sendTelegramText(account, chatId, [
    output.timedOut ? "Timed out." : `Exit code: ${output.code ?? "unknown"}`,
    `\nstdout:\n${output.stdout || "(empty)"}`,
    output.stderr ? `\nstderr:\n${output.stderr}` : "",
  ].join("\n").slice(0, 3900));
}

async function answerTelegramCallback(account: NotificationAccountRecord, callbackQueryId: string, text: string) {
  await telegramBotApi(account, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 180),
  });
}

async function sendTelegramInputPrompt(account: NotificationAccountRecord, chatId: string, kind: "send" | "terminal") {
  telegramPendingInputs.set(telegramPendingKey(account.id, chatId), { kind, createdAt: Date.now() });
  const text = kind === "send"
    ? "Send the message content in your next reply."
    : "Send the terminal command in your next reply.";
  const response = await telegramBotApi(account, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "cancel" }]] },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.slice(0, 500) || `telegram_http_${response.status}`);
  }
}

async function routeTelegramSendMessage(account: NotificationAccountRecord, chatId: string, message: string) {
  const target = telegramRouteSession(account, chatId);
  if (!target) {
    await sendTelegramSessionPicker(account, chatId, message);
    return;
  }
  const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${message}`);
  await sendTelegramText(account, chatId, `Sent to ${target.title}: ${result.mode}`);
}

function telegramRecentSessionsText() {
  const rows = telegramSessionChoices(12)
    .map((session, index) => `${telegramSessionLabel(session, index)}\n${session.status} · ${session.updatedAt}\n${session.id}`);
  return rows.length ? rows.join("\n\n") : "No sessions yet.";
}

function resolveTelegramTargetSession(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const choices = telegramSessionChoices(12);
  const numericIndex = Number(value);
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && choices[numericIndex - 1]) return choices[numericIndex - 1];
  return appData.sessions.find((session) => session.id === value)
    ?? choices
      .find((session) => session.title.toLowerCase().includes(value.toLowerCase()))
    ?? appData.sessions.find((session) => `${session.title} ${session.id}`.toLowerCase().includes(value.toLowerCase()))
    ?? null;
}

async function handleTelegramUpdate(account: NotificationAccountRecord, update: TelegramUpdate) {
  if (!telegramInboundAllowed(account, update)) return;
  if (update.callback_query) {
    const chatId = telegramUpdateChatId(update);
    const data = update.callback_query.data ?? "";
    if (!chatId) return;
    if (data === "cancel") {
      telegramPendingSends.delete(telegramPendingKey(account.id, chatId));
      telegramPendingSelections.delete(telegramSelectionKey(account.id, chatId, "agent"));
      telegramPendingSelections.delete(telegramSelectionKey(account.id, chatId, "room"));
      telegramPendingFileRoots.delete(telegramPendingKey(account.id, chatId));
      telegramPendingFiles.delete(telegramPendingKey(account.id, chatId));
      telegramPendingTerminal.delete(telegramPendingKey(account.id, chatId));
      telegramPendingInputs.delete(telegramPendingKey(account.id, chatId));
      await answerTelegramCallback(account, update.callback_query.id, "Canceled.");
      await sendTelegramText(account, chatId, "Canceled.");
      return;
    }
    if (data.startsWith("send:")) {
      const pendingKey = telegramPendingKey(account.id, chatId);
      const pending = telegramPendingSends.get(pendingKey);
      if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
        telegramPendingSends.delete(pendingKey);
        await answerTelegramCallback(account, update.callback_query.id, "This pending message expired.");
        return;
      }
      const index = Number(data.slice("send:".length));
      const sessionId = Number.isInteger(index) ? pending.sessionIds[index] : "";
      const target = sessionId ? appData.sessions.find((session) => session.id === sessionId) ?? null : null;
      if (!target) {
        await answerTelegramCallback(account, update.callback_query.id, "Session is no longer available.");
        return;
      }
      telegramPendingSends.delete(pendingKey);
      const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${pending.message}`);
      await answerTelegramCallback(account, update.callback_query.id, `Sent to ${target.title}`);
      await sendTelegramText(account, chatId, `Sent to ${target.title}: ${result.mode}`);
      return;
    }
    if (data.startsWith("agent:")) {
      const selectionKey = telegramSelectionKey(account.id, chatId, "agent");
      const selection = telegramPendingSelections.get(selectionKey);
      if (!selection || Date.now() - selection.createdAt > 10 * 60 * 1000) {
        telegramPendingSelections.delete(selectionKey);
        await answerTelegramCallback(account, update.callback_query.id, "This agent list expired.");
        return;
      }
      const index = Number(data.slice("agent:".length));
      const agentId = Number.isInteger(index) ? selection.ids[index] : "";
      const row = agentId ? db.prepare("select * from agents where id = ?").get(agentId) as Record<string, unknown> | undefined : undefined;
      if (!row) {
        await answerTelegramCallback(account, update.callback_query.id, "Agent is no longer available.");
        return;
      }
      const session = createTelegramAgentSession(agentFromRow(row));
      setTelegramRouteSession(account.id, chatId, session.id);
      await answerTelegramCallback(account, update.callback_query.id, `Created ${session.title}`);
      await sendTelegramText(account, chatId, `Created and bound session:\n${telegramSessionLabel(session)}\n${session.id}`);
      return;
    }
    if (data.startsWith("room:")) {
      const selectionKey = telegramSelectionKey(account.id, chatId, "room");
      const selection = telegramPendingSelections.get(selectionKey);
      if (!selection || Date.now() - selection.createdAt > 10 * 60 * 1000) {
        telegramPendingSelections.delete(selectionKey);
        await answerTelegramCallback(account, update.callback_query.id, "This room list expired.");
        return;
      }
      const index = Number(data.slice("room:".length));
      const roomId = Number.isInteger(index) ? selection.ids[index] : "";
      const row = roomId ? db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined : undefined;
      const room = row ? roomFromRow(row) : null;
      if (!room?.sessionId) {
        await answerTelegramCallback(account, update.callback_query.id, "Room session is no longer available.");
        return;
      }
      setTelegramRouteSession(account.id, chatId, room.sessionId);
      await answerTelegramCallback(account, update.callback_query.id, `Bound ${room.name}`);
      await sendTelegramText(account, chatId, `Bound room session:\n${telegramRoomLabel(room)}\n${room.sessionId}`);
      return;
    }
    if (data.startsWith("filectx:")) {
      const rootKey = telegramPendingKey(account.id, chatId);
      const pending = telegramPendingFileRoots.get(rootKey);
      if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
        telegramPendingFileRoots.delete(rootKey);
        await answerTelegramCallback(account, update.callback_query.id, "This file list expired.");
        return;
      }
      const index = Number(data.slice("filectx:".length));
      const root = Number.isInteger(index) ? pending.roots[index]?.root : "";
      if (!root) {
        await answerTelegramCallback(account, update.callback_query.id, "File root is no longer available.");
        return;
      }
      telegramPendingFileRoots.delete(rootKey);
      await answerTelegramCallback(account, update.callback_query.id, "Opened.");
      await sendTelegramFiles(account, chatId, root);
      return;
    }
    if (data.startsWith("file:") || data === "fileup") {
      const pendingKey = telegramPendingKey(account.id, chatId);
      const pending = telegramPendingFiles.get(pendingKey);
      if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
        telegramPendingFiles.delete(pendingKey);
        await answerTelegramCallback(account, update.callback_query.id, "This file list expired.");
        return;
      }
      const nextRel = data === "fileup"
        ? dirname(pending.relPath) === "." ? "" : dirname(pending.relPath)
        : join(pending.relPath, pending.dirNames[Number(data.slice("file:".length))] ?? "");
      await answerTelegramCallback(account, update.callback_query.id, "Opened.");
      await sendTelegramFiles(account, chatId, pending.root, nextRel);
      return;
    }
    if (data.startsWith("term:")) {
      const terminalKey = telegramPendingKey(account.id, chatId);
      const pending = telegramPendingTerminal.get(terminalKey);
      if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
        telegramPendingTerminal.delete(terminalKey);
        await answerTelegramCallback(account, update.callback_query.id, "This terminal command expired.");
        return;
      }
      const index = Number(data.slice("term:".length));
      const root = Number.isInteger(index) ? pending.roots[index]?.root : "";
      if (!root) {
        await answerTelegramCallback(account, update.callback_query.id, "Terminal root is no longer available.");
        return;
      }
      telegramPendingTerminal.delete(terminalKey);
      await answerTelegramCallback(account, update.callback_query.id, "Running.");
      await runTelegramTerminal(account, chatId, root, pending.command);
      return;
    }
  }
  const text = update.message?.text?.trim() ?? "";
  const chatId = String(update.message?.chat?.id ?? "");
  if (!text || !chatId) return;
  const pendingInputKey = telegramPendingKey(account.id, chatId);
  const pendingInput = telegramPendingInputs.get(pendingInputKey);
  if (pendingInput) {
    if (text === "/cancel" || Date.now() - pendingInput.createdAt > 10 * 60 * 1000) {
      telegramPendingInputs.delete(pendingInputKey);
      await sendTelegramText(account, chatId, text === "/cancel" ? "Canceled." : "Pending input expired.");
      return;
    }
    telegramPendingInputs.delete(pendingInputKey);
    if (pendingInput.kind === "send") {
      await routeTelegramSendMessage(account, chatId, text);
    } else {
      const target = telegramRouteSession(account, chatId);
      if (target?.workspacePath) {
        await runTelegramTerminal(account, chatId, target.workspacePath, text);
      } else {
        await sendTelegramTerminalRootPicker(account, chatId, text);
      }
    }
    return;
  }
  const [rawCommand, ...restParts] = text.split(/\s+/);
  const command = rawCommand.replace(/@[^@\s]+$/, "");
  const rest = restParts.join(" ").trim();
  if (command === "/start" || command === "/help") {
    await sendTelegramText(account, chatId, [
      "Codex Web Telegram Bot",
      "",
      "/sessions - list recent sessions",
      "/agents - list agents and create a bound agent session",
      "/rooms - list rooms and bind a room session",
      "/files - browse bound or system files",
      "/terminal <command> - run in bound or selected workspace",
      "/bind <index, title, or sessionId> - bind this chat to a session",
      "/unbind - clear the bound session",
      "/send <index, title, or sessionId> | <message> - send to a session",
      "/send <message> - choose a session when no session is bound",
      "Plain text is sent to the bound/default session, or asks you to choose one.",
    ].join("\n"));
    return;
  }
  if (command === "/sessions") {
    await sendTelegramText(account, chatId, telegramRecentSessionsText());
    return;
  }
  if (command === "/agents") {
    await sendTelegramAgents(account, chatId);
    return;
  }
  if (command === "/rooms") {
    await sendTelegramRooms(account, chatId);
    return;
  }
  if (command === "/files") {
    const target = telegramRouteSession(account, chatId);
    if (target?.workspacePath) {
      await sendTelegramFiles(account, chatId, target.workspacePath, rest);
    } else {
      await sendTelegramFileRootPicker(account, chatId);
    }
    return;
  }
  if (command === "/terminal") {
    if (!rest) {
      await sendTelegramInputPrompt(account, chatId, "terminal");
      return;
    }
    const target = telegramRouteSession(account, chatId);
    if (target?.workspacePath) {
      await runTelegramTerminal(account, chatId, target.workspacePath, rest);
    } else {
      await sendTelegramTerminalRootPicker(account, chatId, rest);
    }
    return;
  }
  if (command === "/bind") {
    const target = resolveTelegramTargetSession(rest);
    if (!target) {
      await sendTelegramText(account, chatId, "Session not found. Use /sessions to view recent sessions.");
      return;
    }
    setTelegramRouteSession(account.id, chatId, target.id);
    await sendTelegramText(account, chatId, `Bound to: ${target.title}\n${target.id}`);
    return;
  }
  if (command === "/unbind") {
    clearTelegramRouteSession(account.id, chatId);
    await sendTelegramText(account, chatId, "Bound session cleared.");
    return;
  }
  if (command === "/send") {
    if (!rest) {
      await sendTelegramInputPrompt(account, chatId, "send");
      return;
    }
    const separator = rest.indexOf("|");
    const targetText = separator >= 0 ? rest.slice(0, separator).trim() : "";
    const message = separator >= 0 ? rest.slice(separator + 1).trim() : rest;
    if (!message) {
      await sendTelegramText(account, chatId, "Message is empty. Use /send <sessionId or title> | <message>.");
      return;
    }
    const target = targetText ? resolveTelegramTargetSession(targetText) : telegramRouteSession(account, chatId);
    if (!target) {
      if (targetText) {
        await sendTelegramText(account, chatId, "Session not found. Use /sessions to view recent sessions.");
      } else {
        await sendTelegramSessionPicker(account, chatId, message);
      }
      return;
    }
    const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${message}`);
    await sendTelegramText(account, chatId, `Sent to ${target.title}: ${result.mode}`);
    return;
  }
  const target = telegramRouteSession(account, chatId);
  if (!target) {
    await sendTelegramSessionPicker(account, chatId, text);
    return;
  }
  const result = dispatchMessageToSession(target, `Telegram message from chat ${chatId}:\n\n${text}`);
  await sendTelegramText(account, chatId, `Sent to ${target.title}: ${result.mode}`);
}

async function pollTelegramAccount(account: NotificationAccountRecord) {
  if (telegramPollingBusy.has(account.id)) return;
  telegramPollingBusy.add(account.id);
  try {
    const offset = telegramPollingOffsets.get(account.id) ?? 0;
    const response = await telegramBotApi(account, "getUpdates", {
      offset: offset ? offset + 1 : undefined,
      timeout: 0,
      limit: 20,
      allowed_updates: ["message", "callback_query"],
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: TelegramUpdate[] } | null;
    if (!response.ok || !body?.ok || !Array.isArray(body.result)) return;
    for (const update of body.result) {
      telegramPollingOffsets.set(account.id, Math.max(telegramPollingOffsets.get(account.id) ?? 0, update.update_id));
      await handleTelegramUpdate(account, update).catch((error) => {
        console.error("telegram inbound update failed", account.id, error);
      });
    }
  } catch (error) {
    console.warn("telegram inbound poll failed", account.id, error instanceof Error ? error.message : error);
  } finally {
    telegramPollingBusy.delete(account.id);
  }
}

function pollTelegramInboundBots() {
  try {
    const accounts = listNotificationAccounts(true)
      .filter((account) => account.enabled && account.channelKind === "telegram" && (account.config as Record<string, unknown>).inboundEnabled === true);
    for (const account of accounts) void pollTelegramAccount(account);
  } catch (error) {
    console.warn("telegram inbound poll scheduler failed", error instanceof Error ? error.message : error);
  }
}

function ingestCrossSessionSkillBlocks(session: SessionSummary, message: SessionMessage, text: string) {
  for (const request of parseCrossSessionSkillBlocks(text)) {
    const action = String(request.action ?? request.type ?? "").trim() || "readSession";
    if (action === "listSessions") {
      const sessions = appData.sessions
        .filter((item) => item.id !== session.id)
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 30)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          type: item.conversationType ?? "codex",
          projectId: item.projectId ?? null,
          updatedAt: item.updatedAt,
        }));
      appendMessageCard(session.id, "service", "Cross-session sessions listed", { action, sessions, messageId: message.id }, message.id);
      enqueueCrossSessionFollowup(session, [
        "# Cross-Session Sessions",
        ...sessions.map((item) => `- ${item.title} (${item.id}) status=${item.status} type=${item.type} updated=${item.updatedAt}`),
      ].join("\n"));
      continue;
    }
    const target = resolveCrossSessionTarget(session, request);
    if (!target) {
      appendMessageCard(session.id, "service", "Cross-session target not found", { action, request, messageId: message.id }, message.id);
      continue;
    }
    if (action === "readSession" || action === "readProgress" || action === "getProgress") {
      const result = crossSessionProgressMarkdown(target);
      appendMessageCard(session.id, "service", `Cross-session read: ${target.title}`, { action, targetSessionId: target.id, result, messageId: message.id }, message.id);
      appendSessionMessage(session.id, "system", `Cross-session read result for ${target.title} (${target.id}):\n\n${result}`);
      enqueueCrossSessionFollowup(session, result);
      continue;
    }
    if (action === "sendMessage" || action === "messageSession") {
      const outgoing = typeof request.message === "string" ? request.message : typeof request.content === "string" ? request.content : "";
      try {
        const result = sendCrossSessionMessage(session, target, outgoing);
        appendMessageCard(session.id, "service", `Cross-session message sent: ${target.title}`, { action, targetSessionId: target.id, result, message: outgoing.slice(0, 2000), messageId: message.id }, message.id);
      } catch (error) {
        appendMessageCard(session.id, "service", "Cross-session message failed", { action, targetSessionId: target.id, error: error instanceof Error ? error.message : String(error), messageId: message.id }, message.id);
      }
    }
  }
}

function notificationScopeFromSkill(session: SessionSummary, input: Record<string, unknown>): { scopeType: "session" | "task" | "room_task"; scopeId: string } | null {
  const scopeType = String(input.scopeType ?? input.scope ?? "session").trim();
  const explicitScopeId = typeof input.scopeId === "string" && input.scopeId.trim() ? input.scopeId.trim() : "";
  if (scopeType === "session" || scopeType === "current_session") {
    if (explicitScopeId && explicitScopeId !== session.id) return null;
    return { scopeType: "session", scopeId: session.id };
  }
  if (scopeType === "task" || scopeType === "current_task") {
    const taskRun = latestRunningTaskRun(session.id);
    if (!taskRun?.id) return { scopeType: "session", scopeId: session.id };
    const taskRunId = String(taskRun.id);
    if (explicitScopeId && explicitScopeId !== taskRunId) return null;
    return { scopeType: "task", scopeId: taskRunId };
  }
  if (scopeType === "room_task" || scopeType === "current_room_task") {
    const run = db.prepare("select * from agent_runs where session_id = ? order by started_at desc, id desc limit 1").get(session.id) as Record<string, unknown> | undefined;
    const roomTaskId = run?.task_id ? String(run.task_id) : "";
    if (!roomTaskId) return { scopeType: "session", scopeId: session.id };
    if (explicitScopeId && explicitScopeId !== roomTaskId) return null;
    return { scopeType: "room_task", scopeId: roomTaskId };
  }
  return null;
}

function ingestNotificationSkillBlocks(session: SessionSummary, message: SessionMessage, text: string) {
  const permissionContext = notificationPermissionContext(session);
  for (const request of parseNotificationSkillBlocks(text)) {
    const action = String(request.action ?? request.type ?? "").trim();
    if (action && action !== "createOneTimeRule") continue;
    const recipientIds = resolveNotificationRecipientIds(request, permissionContext);
    if (!recipientIds.length) continue;
    const requestedSenderAccountId = typeof request.senderAccountId === "string" && request.senderAccountId.trim() ? request.senderAccountId.trim() : undefined;
    const senderAccount = requestedSenderAccountId ? listNotificationAccounts().find((account) => account.id === requestedSenderAccountId && account.enabled) : null;
    if (requestedSenderAccountId && (!senderAccount || !notificationPermissionAllows(senderAccount.permissions, permissionContext))) continue;
    const senderAccountId = requestedSenderAccountId;
    const targets = recipientIds.map((recipientId) => ({ recipientId, senderAccountId }));
    const eventTypes = notificationEventTypesFromSkill(request.eventTypes);
    const expireMode = notificationExpireModeFromSkill(request.expireMode);
    const scope = notificationScopeFromSkill(session, request);
    if (!scope) continue;
    const existing = db.prepare(`
      select id from notification_ephemeral_rules
      where scope_type = ? and scope_id = ? and event_types = ? and targets = ? and enabled = 1
      limit 1
    `).get(scope.scopeType, scope.scopeId, JSON.stringify(eventTypes), JSON.stringify(sanitizeNotificationTargets(targets))) as Record<string, unknown> | undefined;
    if (existing) continue;
    const rule = createNotificationEphemeralRule({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      eventTypes,
      targets,
      expireMode,
    });
    if (!rule) continue;
    appendMessageCard(session.id, "service", "Notification rule created", {
      notificationEphemeralRuleId: rule.id,
      messageId: message.id,
      scope,
      eventTypes,
      recipientIds,
      reason: typeof request.reason === "string" ? request.reason.slice(0, 500) : "",
    }, message.id);
  }
}

function ingestRoomUpdateBlocks(session: SessionSummary, message: SessionMessage, text: string, sourceAgentId?: string | null) {
  if (!session.roomId) return;
  for (const update of parseRoomUpdateBlocks(text)) {
    const summary = typeof update.summary === "string" ? update.summary.trim() : "";
    const completed = stringArray(update.completed);
    const risks = stringArray(update.risks);
    const questions = stringArray(update.questions);
    if (summary || completed.length || risks.length || questions.length) {
      const artifact = createRoomArtifact(session.roomId, {
        agentId: sourceAgentId ?? null,
        kind: "report",
        title: summary ? `Agent update: ${summary.slice(0, 80)}` : "Agent structured update",
        payload: { summary, completed, risks, questions, messageId: message.id },
      });
      appendMessageCard(session.id, "artifact", artifact.title, { artifactId: artifact.id, roomId: session.roomId, kind: artifact.kind, payload: artifact.payload }, message.id);
    }
    const artifacts = Array.isArray(update.artifacts) ? update.artifacts : [];
    for (const item of artifacts) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 160) : "Agent artifact";
      const kind = ["report", "file-change", "preview", "link", "approval", "task", "decision", "handoff"].includes(String(record.kind ?? record.type))
        ? String(record.kind ?? record.type) as RoomArtifactSummary["kind"]
        : "report";
      const artifact = createRoomArtifact(session.roomId, {
        agentId: sourceAgentId ?? null,
        kind,
        title,
        payload: record.payload ?? record.data ?? record,
      });
      appendMessageCard(session.id, "artifact", title, { artifactId: artifact.id, roomId: session.roomId, kind, payload: artifact.payload }, message.id);
    }
    const decisions = Array.isArray(update.decisions) ? update.decisions : [];
    for (const item of decisions) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 180) : "";
      if (!title) continue;
      createRoomDecision(session.roomId, {
        title,
        status: roomDecisionStatus(record.status),
        payload: record.payload ?? record,
      });
    }
    if (typeof update.handoff === "string" && update.handoff.trim()) {
      createRoomHandoff(session.roomId, {
        fromAgentId: sourceAgentId ?? null,
        toAgentId: typeof update.toAgentId === "string" ? update.toAgentId : null,
        summary: update.handoff.trim().slice(0, 2000),
        payload: { messageId: message.id },
      });
    }
    const suggestedTasks = Array.isArray(update.suggestedTasks) ? update.suggestedTasks : [];
    for (const item of suggestedTasks) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : "";
      const prompt = typeof record.prompt === "string" ? record.prompt : title;
      createSuggestedRoomTask(session.roomId, {
        title,
        prompt,
        assignedAgentId: typeof record.assignedAgentId === "string" ? record.assignedAgentId : null,
        priority: typeof record.priority === "number" ? record.priority : 0,
        sourceAgentId: sourceAgentId ?? null,
      });
    }
  }
}

function ingestAssistantArtifacts(session: SessionSummary, message: SessionMessage, text: string) {
  ingestNotificationSkillBlocks(session, message, text);
  ingestCrossSessionSkillBlocks(session, message, text);
  if (!session.roomId) return;
  const run = db.prepare("select * from agent_runs where session_id = ? order by started_at desc limit 1").get(session.id) as Record<string, unknown> | undefined;
  const sourceAgentId = run?.agent_id ? String(run.agent_id) : null;
  for (const artifact of parseAssistantArtifactBlocks(text)) {
    const kind = String(artifact.kind ?? artifact.type ?? "report") as RoomArtifactSummary["kind"];
    const title = String(artifact.title ?? artifact.name ?? "Agent artifact").slice(0, 160);
    const payload = artifact.payload ?? artifact.data ?? artifact;
    const record = createRoomArtifact(session.roomId, {
      agentId: sourceAgentId,
      kind,
      title,
      payload,
    });
    appendMessageCard(session.id, "artifact", title, { artifactId: record.id, roomId: session.roomId, kind, payload }, message.id);
  }
  ingestRoomUpdateBlocks(session, message, text, sourceAgentId);
}

function handleCodexStdout(session: SessionSummary, value: string) {
  appendCodexOutput(session.id, value);
  processCodexLogChunk(session, value);
}

function readCodexOutput(sessionId: string) {
  const runtimeOutput = codexTaskOutputs.get(sessionId);
  if (runtimeOutput) return runtimeOutput;
  return {
    output: readTaskLogContent(sessionId).slice(-256 * 1024),
    exitCode: readTaskExitCode(sessionId),
  };
}

function tailCodexTaskLog(session: SessionSummary) {
  const path = taskLogPath(session.id);
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  const offset = codexTaskLogOffsets.get(session.id) ?? 0;
  const start = size < offset ? 0 : Math.min(offset, size);
  if (size <= start) {
    codexTaskLogOffsets.set(session.id, size);
    return;
  }
  const chunk = readFileSync(path, "utf8").slice(start);
  codexTaskLogOffsets.set(session.id, size);
  if (chunk) processCodexLogChunk(session, chunk);
}

function flushCodexTaskLog(session: SessionSummary) {
  tailCodexTaskLog(session);
  if ((codexTaskStdoutBuffers.get(session.id) ?? "").trim()) processCodexLogChunk(session, "\n");
}

function stopCodexTaskTailer(sessionId: string) {
  const timer = codexTaskTailers.get(sessionId);
  if (timer) clearInterval(timer);
  codexTaskTailers.delete(sessionId);
  codexTaskLogOffsets.delete(sessionId);
}

function clearCodexTaskRuntime(sessionId: string, kill = false) {
  const child = codexTaskProcesses.get(sessionId);
  if (kill) child?.kill("SIGTERM");
  codexTaskProcesses.delete(sessionId);
  codexTaskOutputs.delete(sessionId);
  codexTaskStopRequested.delete(sessionId);
  codexTaskStdoutBuffers.delete(sessionId);
  stopCodexTaskTailer(sessionId);
}

function finalizeCodexRunnerTask(session: SessionSummary, exitCode: number | null, reason?: string) {
  if (finalizedRecoveredTasks.has(session.id)) return;
  finalizedRecoveredTasks.add(session.id);
  const running = latestRunningTaskRun(session.id);
  const agentRun = db.prepare("select * from agent_runs where session_id = ? order by started_at desc, id desc limit 1").get(session.id) as Record<string, unknown> | undefined;
  const wasStopped = codexTaskStopRequested.has(session.id) || Boolean((running as { stop_requested?: unknown } | undefined)?.stop_requested);
  flushCodexTaskLog(session);
  backfillSessionFromTaskLog(session);
  codexTaskProcesses.delete(session.id);
  codexTaskStdoutBuffers.delete(session.id);
  stopCodexTaskTailer(session.id);
  const output = codexTaskOutputs.get(session.id);
  if (output) output.exitCode = exitCode;
  session.status = exitCode === 0 && !wasStopped ? "done" : "paused";
  finishTaskRun(session.id, wasStopped ? "stopped" : exitCode === 0 ? "done" : "failed", exitCode, reason ?? (wasStopped ? "user_stopped" : undefined));
  if (exitCode !== 0 && !wasStopped) {
    const summary = readTaskErrorSummary(session.id);
    const content = [`任务运行失败，Codex 退出码为 ${exitCode ?? "null"}。`, summary].filter(Boolean).join("\n\n");
    appendSessionMessage(session.id, "assistant", content);
    publishTaskEvent(session.id, { type: "message", message: allSessionMessages(session.id).at(-1)!, session });
  }
  finishAutomationRun(session.id, exitCode, wasStopped);
  finishAgentRun(session.id, exitCode, wasStopped);
  codexTaskStopRequested.delete(session.id);
  session.updatedAt = new Date().toISOString();
  writeTaskExitCode(session.id, exitCode);
  saveAppData();
  publishTaskEvent(session.id, { type: "workspace", session, reason: "done", at: new Date().toISOString() });
  publishTaskEvent(session.id, { type: "done", session, exitCode });
  const notificationScopes = [
    { scopeType: "session", scopeId: session.id },
    running?.id ? { scopeType: "task", scopeId: String(running.id) } : null,
    agentRun?.task_id ? { scopeType: "room_task", scopeId: String(agentRun.task_id) } : null,
  ].filter((scope): scope is { scopeType: "session" | "task" | "room_task"; scopeId: string } => Boolean(scope));
  const latestAssistant = allSessionMessages(session.id).filter((message) => message.role === "assistant").at(-1)?.content ?? "";
  const isRoomTaskNotification = Boolean(agentRun?.room_id && agentRun?.task_id);
  const shouldEmitTaskNotification = !isRoomTaskNotification || roomTaskShouldNotifyUser(String(agentRun?.room_id ?? ""), String(agentRun?.task_id ?? ""), latestAssistant);
  if (shouldEmitTaskNotification) {
    emitExternalNotification({
      eventType: wasStopped ? "task_interrupted" : exitCode === 0 ? "task_completed" : "task_failed",
      severity: wasStopped ? "warning" : exitCode === 0 ? "success" : "error",
      title: exitCode === 0 && !wasStopped ? `任务完成：${session.title}` : `任务异常：${session.title}`,
      message: wasStopped ? "任务已被停止。" : `Codex 退出码：${exitCode ?? "null"}`,
      sourceType: "session",
      sourceId: session.id,
      metadata: {
        exitCode,
        status: session.status,
        workspacePath: session.workspacePath,
        taskRunId: running?.id ? String(running.id) : null,
        roomId: agentRun?.room_id ? String(agentRun.room_id) : session.roomId ?? null,
        agentId: agentRun?.agent_id ? String(agentRun.agent_id) : null,
        roomTaskId: agentRun?.task_id ? String(agentRun.task_id) : null,
        notificationScopes,
      },
    });
  }
  scheduleSessionAutoCompaction(session, "task-finished");
  if (exitCode === 0 && !wasStopped) runQueuedMessageIfIdle(session);
}

function startCodexTaskTailer(session: SessionSummary, options: { finalizeOnExit: boolean }) {
  stopCodexTaskTailer(session.id);
  const existingSize = existsSync(taskLogPath(session.id)) ? statSync(taskLogPath(session.id)).size : 0;
  codexTaskLogOffsets.set(session.id, existingSize);
  const timer = setInterval(() => {
    tailCodexTaskLog(session);
    if (!options.finalizeOnExit) return;
    const meta = readTaskMeta(session.id);
    if (meta && meta.running === false && (typeof meta.exitCode === "number" || meta.exitCode === null || meta.error)) {
      finalizeCodexRunnerTask(session, typeof meta.exitCode === "number" ? meta.exitCode : null, meta.error ?? undefined);
      return;
    }
    const running = latestRunningTaskRun(session.id);
    const pid = typeof running?.pid === "number" ? running.pid : null;
    if (pid && !isProcessAlive(pid)) finalizeCodexRunnerTask(session, null, "runner_process_missing");
  }, 800);
  codexTaskTailers.set(session.id, timer);
}

function readTaskErrorSummary(sessionId: string) {
  try {
    const content = readTaskLogContent(sessionId);
    const lines = content.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("{\"type\":\"item.completed\",\"item\":{\"id\":") && !line.startsWith("{\"type\":\"turn.completed\""))
      .slice(-16);
    return lines.join("\n").slice(0, 2000);
  } catch {
    return "";
  }
}

function listTaskContextFiles(sessionId: string): TaskContextResponse {
  const root = sessionContextPath(sessionId);
  const files = existsSync(root)
    ? readdirSync(root)
      .filter((name) => !name.includes("/") && !name.includes("\\"))
      .map((name) => {
        const path = join(root, name);
        const stat = statSync(path);
        return stat.isFile() ? { name, bytes: stat.size, updatedAt: stat.mtime.toISOString() } : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return {
    sessionId,
    files,
    activeContextPack: files.some((file) => file.name === "context-pack.md") ? join(root, "context-pack.md") : null,
  };
}

function safeVirtualContextPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "agent";
}

function roomTaskContextCandidates(session: SessionSummary) {
  return roomAgentRunLogSources(session).flatMap((row) => {
    const childSessionId = row.session_id ? String(row.session_id) : "";
    const root = childSessionId ? sessionContextPath(childSessionId) : "";
    if (!root || !existsSync(root)) return [];
    const label = safeVirtualContextPart(`${row.agent_name || "agent"}-${row.id}`);
    return readdirSync(root)
      .filter((name) => !name.includes("/") && !name.includes("\\"))
      .map((name) => {
        const path = join(root, name);
        const stat = statSync(path);
        if (!stat.isFile()) return null;
        return {
          name: `${label}-${name}`,
          sourceName: name,
          sourceSessionId: childSessionId,
          path,
          bytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  });
}

function listRoomTaskContextFiles(session: SessionSummary): TaskContextResponse {
  const own = listTaskContextFiles(session.id);
  const files = [
    ...own.files,
    ...roomTaskContextCandidates(session).map((item) => ({ name: item.name, bytes: item.bytes, updatedAt: item.updatedAt })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return {
    sessionId: session.id,
    files,
    activeContextPack: own.activeContextPack ?? files.find((file) => file.name.endsWith("-context-pack.md"))?.name ?? null,
  };
}

function readTaskContextFile(sessionId: string, name: string): TaskContextFileResponse {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("invalid_context_file");
  const path = join(sessionContextPath(sessionId), name);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("context_file_not_found");
  return {
    sessionId,
    name,
    content: readFileSync(path, "utf8"),
    updatedAt: stat.mtime.toISOString(),
  };
}

function readRoomTaskContextFile(session: SessionSummary, name: string): TaskContextFileResponse {
  try {
    return readTaskContextFile(session.id, name);
  } catch {
    const match = roomTaskContextCandidates(session).find((item) => item.name === name);
    if (!match) throw new Error("context_file_not_found");
    return {
      sessionId: session.id,
      name,
      content: [
        `# ${match.name}`,
        `- source session: ${match.sourceSessionId}`,
        `- source file: ${match.sourceName}`,
        "",
        readFileSync(match.path, "utf8"),
      ].join("\n"),
      updatedAt: match.updatedAt,
    };
  }
}

function resolveSessionCwd(session: SessionSummary) {
  return resolveSessionWorkspace(session);
}

function runQueuedMessageIfIdle(session: SessionSummary) {
  if (codexTaskProcesses.has(session.id)) return false;
  const item = popNextQueuedMessage(session.id);
  if (!item) return false;
  restoreCodexSessionIdFromLog(session);
  const providerId = item.providerId ?? session.providerId ?? null;
  const provider = providerId ? appData.providers.find((providerItem) => providerItem.id === providerId) : appData.providers[0];
  const selectedModel = item.model ?? session.model ?? provider?.defaultModel ?? null;
  const cwd = resolveSessionCwd(session);
  session.providerId = provider?.id ?? null;
  session.model = selectedModel;
  session.status = "running";
  session.updatedAt = new Date().toISOString();
  const userMessage = appendSessionMessage(session.id, "user", item.prompt, item.replyToMessageId);
  saveAppData();
  publishTaskEvent(session.id, { type: "queue", queue: listQueuedMessages(session.id), session });
  const prompt = promptWithReplyContext(session.id, item.prompt, item.replyToMessageId);
  startCodexTask(session, promptForDirectAgentSession(session, prompt), cwd, provider, selectedModel, !session.codexSessionId, [], {
    currentMessageId: userMessage.id,
    replyToMessageId: item.replyToMessageId,
  });
  return true;
}

type EffectiveCodexRuntime = Pick<CodexRuntimeSettings, "sandboxMode" | "approvalPolicy" | "bypassSandbox">;

function effectiveCodexRuntimeForPermissions(permissions: AgentPermissionSettings): EffectiveCodexRuntime {
  const next: EffectiveCodexRuntime = {
    sandboxMode: codexRuntimeSettings.sandboxMode,
    approvalPolicy: codexRuntimeSettings.approvalPolicy,
    bypassSandbox: codexRuntimeSettings.bypassSandbox,
  };
  if (!permissions.canWriteFiles) {
    next.sandboxMode = "read-only";
    next.bypassSandbox = false;
  }
  return next;
}

function permissionBoundaryPrompt(permissions: AgentPermissionSettings) {
  const lines: string[] = [];
  if (!permissions.canRunCommands) lines.push("- Do not run shell commands or start background processes.");
  if (!permissions.canWriteFiles) lines.push("- Do not create, edit, delete, rename, or move files.");
  if (!permissions.canCreatePreview) lines.push("- Do not start preview servers or ask the user to open localhost URLs.");
  if (!permissions.canWriteSharedWorkspace) lines.push("- Do not write to the shared Room workspace.");
  if (!lines.length) return "";
  return ["Permission boundary for this run:", ...lines].join("\n");
}

function codexExecPermissionArgs(command: "exec" | "resume", cwd: string, extraWritableDirs: string[] = [], runtime: EffectiveCodexRuntime = codexRuntimeSettings) {
  const args: string[] = ["--skip-git-repo-check"];
  if (runtime.bypassSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
    if (command === "exec") args.push("-C", cwd);
    return args;
  }
  if (command === "exec") {
    args.push("--sandbox", runtime.sandboxMode, "-C", cwd);
    if (runtime.sandboxMode !== "read-only") args.push("--add-dir", cwd);
    for (const dir of extraWritableDirs) args.push("--add-dir", dir);
  }
  return args;
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function codexProviderConfigArgs(provider?: ProviderRecord) {
  if (!provider?.baseUrl) return [];
  const providerKey = "codexweb";
  const usesLocalProxy = provider.kind === "openai-compatible-chat" || (provider.kind === "openai-responses" && provider.useProxy);
  const baseUrl = usesLocalProxy ? joinUrl(localApiBaseUrl, `/provider-proxy/${encodeURIComponent(provider.id)}/${providerProxyToken(provider)}/v1`) : provider.baseUrl;
  const args = [
    "-c", `model_provider=${tomlString(providerKey)}`,
    "-c", `model_providers.${providerKey}.name=${tomlString(provider.name || "Codex Web Provider")}`,
    "-c", `model_providers.${providerKey}.base_url=${tomlString(baseUrl)}`,
    "-c", `model_providers.${providerKey}.requires_openai_auth=true`,
    "-c", `model_providers.${providerKey}.wire_api=${tomlString("responses")}`,
  ];
  if (usesLocalProxy) {
    args.push("-c", `model_providers.${providerKey}.experimental_bearer_token=${tomlString("codex-web-proxy")}`);
  } else if (provider.apiKey) {
    args.push("-c", `model_providers.${providerKey}.experimental_bearer_token=${tomlString(provider.apiKey)}`);
  }
  return args;
}

function codexPromptHash(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

function redactCodexArgs(args: string[], promptArg?: string) {
  const promptHash = promptArg ? codexPromptHash(promptArg) : null;
  return args
    .map((arg, index) => index === args.length - 1 && promptArg
      ? `[prompt omitted: ${promptArg.length} chars sha256:${promptHash}]`
      : arg)
    .map((arg) => arg.replace(/(\/provider-proxy\/[^/]+\/)[^/]+(\/v1)/, "$1***$2"))
    .map((arg) => arg.replace(/(experimental_bearer_token=)"[^"]*"/, "$1\"***\""));
}

function startCodexTask(
  session: SessionSummary,
  prompt: string,
  cwd: string,
  provider?: ProviderRecord,
  model?: string | null,
  resetOutput = true,
  extraWritableDirs: string[] = [],
  contextInput?: CodexTaskContextInput,
) {
  const directAgent = contextInput?.agentId ? null : directAgentForSession(session.id)?.agent ?? null;
  const agentId = contextInput?.agentId ?? directAgent?.id ?? null;
  const resolvedPermissions = contextInput?.resolvedPermissions ?? (directAgent ? resolvedAgentPermissions(directAgent) : defaultAgentPermissions);
  const effectiveRuntime = effectiveCodexRuntimeForPermissions(resolvedPermissions);
  const effectiveExtraWritableDirs = resolvedPermissions.canWriteFiles && resolvedPermissions.canWriteSharedWorkspace ? extraWritableDirs : [];
  const sourceMessage = contextInput?.currentMessageId ? getSessionMessage(session.id, contextInput.currentMessageId) : null;
  registerEphemeralNotificationsFromPrompt(session, sourceMessage?.content ?? prompt);
  const boundedPrompt = [permissionBoundaryPrompt(resolvedPermissions), prompt].filter(Boolean).join("\n\n");
  const managedPrompt = promptWithManagedContext(session, boundedPrompt, cwd, contextInput);
  const managedPromptHash = codexPromptHash(managedPrompt);
  const contextPackPath = join(sessionContextPath(session.id), "context-pack.md");
  recordExecutionContext({
    sourceType: contextInput?.sourceType ?? (session.conversationType === "agent" ? "agent-chat" : "session"),
    sessionId: session.id,
    agentId,
    roomId: contextInput?.roomId ?? session.roomId ?? null,
    projectId: session.projectId ?? null,
    workspacePath: cwd,
    providerId: provider?.id ?? session.providerId ?? null,
    model: model ?? session.model ?? null,
    permissionProfileId: contextInput?.permissionProfileId ?? directAgent?.permissionProfileId ?? null,
    resolvedPermissions,
    sandboxMode: effectiveRuntime.sandboxMode,
    approvalPolicy: effectiveRuntime.approvalPolicy,
    createdBy: contextInput?.createdBy ?? "user",
  });
  if (resetOutput) codexTaskOutputs.set(session.id, { output: "", exitCode: null });
  else if (!codexTaskOutputs.has(session.id)) codexTaskOutputs.set(session.id, readCodexOutput(session.id));
  codexTaskStdoutBuffers.set(session.id, "");
  finalizedRecoveredTasks.delete(session.id);
  if (resetOutput) {
    mkdirSync(sessionLogsPath(session.id), { recursive: true });
    writeFileSync(taskLogPath(session.id), "", "utf8");
    rmSync(taskMetaPath(session.id), { force: true });
    rmSync(legacyTaskLogPath(session.id), { force: true });
    rmSync(legacyTaskMetaPath(session.id), { force: true });
  } else {
    appendCodexOutput(session.id, "\n\n--- follow-up ---\n");
  }
  const useResume = !resetOutput && Boolean(session.codexSessionId);
  const args = useResume
    ? ["exec", "resume", "--json", ...codexExecPermissionArgs("resume", cwd, effectiveExtraWritableDirs, effectiveRuntime), ...codexProviderConfigArgs(provider)]
    : ["exec", "--json", ...codexExecPermissionArgs("exec", cwd, effectiveExtraWritableDirs, effectiveRuntime), ...codexProviderConfigArgs(provider)];
  const selectedModel = model || provider?.defaultModel;
  if (selectedModel) args.push("-m", selectedModel);
  if (useResume && session.codexSessionId) args.push(session.codexSessionId);
  else args.push("--");
  args.push(managedPrompt);
  const env = { ...process.env };
  if (provider?.apiKey) env.OPENAI_API_KEY = provider.apiKey;
  if (provider?.baseUrl && provider.kind !== "openai-compatible-chat") env.OPENAI_BASE_URL = provider.baseUrl;
  appendCodexErrorOutput(session, [
    "[codex-web]",
    `mode=${useResume ? "resume" : "exec"}`,
    `session=${session.id}`,
    `codexThread=${session.codexSessionId ?? "new"}`,
    `context=${contextPackPath}`,
    `promptChars=${managedPrompt.length}`,
    `promptHash=${managedPromptHash}`,
    `cwd=${cwd}`,
    `source=${contextInput?.sourceType ?? (session.conversationType === "agent" ? "agent-chat" : "session")}`,
    agentId ? `agent=${agentId}` : "",
    (contextInput?.roomId ?? session.roomId) ? `room=${contextInput?.roomId ?? session.roomId}` : "",
  ].filter(Boolean).join(" ") + "\n");
  appendCodexErrorOutput(session, `$ codex ${redactCodexArgs(args, managedPrompt).map((arg) => JSON.stringify(arg)).join(" ")}\n`);
  const runner = fork(codexRunnerPath, [], {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  codexTaskProcesses.set(session.id, runner);
  createTaskRun(session.id, runner.pid, { promptChars: managedPrompt.length, promptHash: managedPromptHash, contextPath: contextPackPath });
  startCodexTaskTailer(session, { finalizeOnExit: true });
  publishTaskEvent(session.id, { type: "started", session });
  runner.send({
    command: "codex",
    args,
    cwd,
    logPath: taskLogPath(session.id),
    metaPath: taskMetaPath(session.id),
  });
  runner.unref();
  runner.on("error", (error) => {
    appendCodexErrorOutput(session, `\n[task spawn error] ${error.message}\n`);
    session.status = "paused";
    session.updatedAt = new Date().toISOString();
    writeTaskExitCode(session.id, null);
    finishTaskRun(session.id, "failed", null, error.message);
    saveAppData();
    publishTaskEvent(session.id, { type: "error", session, error: error.message });
  });
}

function runGitCommand(cwd: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolveResult) => {
    const child = spawnProcess("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-120 * 1024);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-32 * 1024);
    });
    child.on("error", (error) => resolveResult({ stdout, stderr: error.message, exitCode: null }));
    child.on("close", (exitCode) => resolveResult({ stdout, stderr, exitCode }));
  });
}

function hasGitCommand() {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function ensureGitRepositorySync(workspacePath: string) {
  if (!hasGitCommand()) return;
  try {
    const cwd = resolveTerminalCwd(workspacePath);
    if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) return;
    const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (probe.status === 0 && resolve(probe.stdout.trim()) === cwd) return;
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  } catch {
    return;
  }
}

async function ensureGitRepositoryForProject(workspacePath: string) {
  if (!hasGitCommand()) return;
  let cwd = "";
  try {
    cwd = resolveTerminalCwd(workspacePath);
    if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) return;
  } catch {
    return;
  }
  const probe = await runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
  if (probe.exitCode === 0 && resolve(probe.stdout.trim()) === cwd) return;
  await runGitCommand(cwd, ["init"]);
}

async function refreshProjectGitStatus(project: ProjectSummary) {
  try {
    const cwd = resolveTerminalCwd(project.workspacePath);
      const status = await runGitCommand(cwd, ["status", "--short", "--", "."]);
    if (status.exitCode !== 0) {
      project.changedFiles = 0;
      project.stagedFiles = 0;
      project.modifiedFiles = 0;
      project.untrackedFiles = 0;
      project.gitStatus = "not-git";
      project.gitBranch = undefined;
      project.gitRemoteStatus = undefined;
    } else {
      const branch = await runGitCommand(cwd, ["branch", "--show-current"]);
      const statusBranch = await runGitCommand(cwd, ["status", "-sb"]);
      const lines = status.stdout.split(/\r?\n/).filter((line) => line.trim());
      project.changedFiles = lines.length;
      project.stagedFiles = lines.filter((line) => line[0] && line[0] !== " " && line[0] !== "?").length;
      project.modifiedFiles = lines.filter((line) => line[1] && line[1] !== " ").length;
      project.untrackedFiles = lines.filter((line) => line.startsWith("??")).length;
      project.gitStatus = project.changedFiles > 0 ? "dirty" : "clean";
      project.gitBranch = branch.stdout.trim() || "detached";
      project.gitRemoteStatus = readGitRemoteStatus(statusBranch.stdout);
    }
    upsertProject(project);
  } catch {
    project.changedFiles = 0;
    project.stagedFiles = 0;
    project.modifiedFiles = 0;
    project.untrackedFiles = 0;
    project.gitStatus = "error";
  }
  return project;
}

function readGitRemoteStatus(statusBranch: string) {
  const firstLine = statusBranch.split(/\r?\n/)[0] ?? "";
  const remotePart = firstLine.replace(/^##\s*/, "").split("...")[1];
  if (!remotePart) return "no upstream";
  const match = remotePart.match(/^([^\s]+)(?:\s+\[(.+)\])?$/);
  if (!match) return remotePart;
  return match[2] ? `${match[1]} · ${match[2]}` : match[1];
}

function parseShortStatusLine(line: string) {
  const status = line.slice(0, 2).trim() || line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
  return { status, path: renamedPath.replace(/^"|"$/g, "") };
}

function parseNumstat(stat: string) {
  const items = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const line of stat.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [added, deleted, rawPath] = line.split(/\t/);
    if (!rawPath) continue;
    const binary = added === "-" || deleted === "-";
    const previous = items.get(rawPath) ?? { additions: 0, deletions: 0, binary: false };
    items.set(rawPath, {
      additions: previous.additions + (binary ? 0 : Number(added) || 0),
      deletions: previous.deletions + (binary ? 0 : Number(deleted) || 0),
      binary: previous.binary || binary,
    });
  }
  return items;
}

async function readTextFileIfSmall(cwd: string, filePath: string) {
  const absolutePath = resolve(cwd, filePath);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) return { binary: false, content: "" };
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > 512 * 1024) return { binary: stat.isFile(), content: "" };
    const content = readFileSync(absolutePath, "utf8");
    if (content.includes("\u0000")) return { binary: true, content: "" };
    return { binary: false, content };
  } catch {
    return { binary: false, content: "" };
  }
}

async function collectWorkspaceChangesForCwd(cwd: string): Promise<WorkspaceChanges> {
  const repo = await runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
  if (repo.exitCode !== 0) {
    return {
      ok: false,
      cwd,
      isGitRepo: false,
      summary: { filesChanged: 0, additions: 0, deletions: 0 },
      files: [],
      raw: { status: "", stat: "", diff: "" },
      error: repo.stderr || "not_a_git_repository",
    };
  }
  const status = await runGitCommand(cwd, ["status", "--short", "--", "."]);
  const numstat = await runGitCommand(cwd, ["diff", "--relative", "--numstat", "--", "."]);
  const cachedNumstat = await runGitCommand(cwd, ["diff", "--relative", "--cached", "--numstat", "--", "."]);
  const diff = await runGitCommand(cwd, ["diff", "--", "."]);
  const cachedDiff = await runGitCommand(cwd, ["diff", "--cached", "--", "."]);
  const untracked = await runGitCommand(cwd, ["ls-files", "--others", "--exclude-standard", "--", "."]);
  const stats = parseNumstat(`${numstat.stdout}\n${cachedNumstat.stdout}`);
  const statusItems = status.stdout.split(/\r?\n/).filter(Boolean).map(parseShortStatusLine);
  for (const path of untracked.stdout.split(/\r?\n/).filter(Boolean)) {
    if (!statusItems.some((item) => item.path === path)) statusItems.push({ status: "??", path });
  }
  const files: WorkspaceChangeFile[] = [];
  for (const item of statusItems) {
    let stat = stats.get(item.path) ?? { additions: 0, deletions: 0, binary: false };
    let patch = "";
    let newContent: string | undefined;
    let binary = stat.binary;
    if (item.status === "??") {
      const file = await readTextFileIfSmall(cwd, item.path);
      binary = file.binary;
      newContent = file.content || undefined;
      if (file.content) {
        const lines = file.content.split(/\r?\n/);
        stat = { additions: lines.length, deletions: 0, binary: false };
        patch = [`--- /dev/null`, `+++ b/${item.path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
      }
    } else {
      const fileDiff = await runGitCommand(cwd, ["diff", "--", item.path]);
      const cachedFileDiff = await runGitCommand(cwd, ["diff", "--cached", "--", item.path]);
      patch = [cachedFileDiff.stdout, fileDiff.stdout].filter(Boolean).join("\n");
    }
    files.push({ path: item.path, status: item.status, additions: stat.additions, deletions: stat.deletions, patch, newContent, binary });
  }
  const summary = files.reduce(
    (total, file) => ({
      filesChanged: total.filesChanged + 1,
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { filesChanged: 0, additions: 0, deletions: 0 },
  );
  return {
    ok: status.exitCode === 0,
    cwd,
    isGitRepo: true,
    summary,
    files,
    raw: { status: status.stdout, stat: `${numstat.stdout}\n${cachedNumstat.stdout}`.trim(), diff: [cachedDiff.stdout, diff.stdout].filter(Boolean).join("\n") },
    error: status.exitCode === 0 ? undefined : status.stderr || "git_status_failed",
  };
}

async function collectRoomWorkspaceChanges(session: SessionSummary): Promise<WorkspaceChanges> {
  const parent = await collectWorkspaceChangesForCwd(resolveSessionCwd(session));
  if (!session.roomId) return parent;
  const parentCwd = resolve(parent.cwd);
  const rows = db.prepare(`
    select agent_runs.id, agent_runs.workspace_path, agents.name as agent_name
    from agent_runs
    left join agents on agents.id = agent_runs.agent_id
    where agent_runs.room_id = ? and agent_runs.workspace_path is not null and agent_runs.workspace_path != ''
    order by agent_runs.started_at desc, agent_runs.id desc
    limit 20
  `).all(session.roomId) as Array<{ id: string; workspace_path?: string | null; agent_name?: string | null }>;
  const files: WorkspaceChangeFile[] = [...parent.files];
  const rawStatus = [parent.raw.status].filter(Boolean);
  const rawStat = [parent.raw.stat].filter(Boolean);
  const rawDiff = [parent.raw.diff].filter(Boolean);
  let sawGitRepo = parent.isGitRepo;
  const seenWorkspaces = new Set([parentCwd]);
  for (const row of rows) {
    const cwd = row.workspace_path ? resolveTerminalCwd(String(row.workspace_path)) : "";
    if (!cwd || seenWorkspaces.has(resolve(cwd)) || !existsSync(cwd)) continue;
    seenWorkspaces.add(resolve(cwd));
    const changes = await collectWorkspaceChangesForCwd(cwd);
    sawGitRepo = sawGitRepo || changes.isGitRepo;
    if (!changes.files.length) continue;
    const label = row.agent_name ? String(row.agent_name) : String(row.id);
    files.push(...changes.files.map((file) => ({
      ...file,
      path: `${label}/${file.path}`,
      sourcePath: file.path,
      sourceCwd: cwd,
      sourceLabel: label,
      sourceRunId: String(row.id),
    })));
    if (changes.raw.status) rawStatus.push(`# ${label} (${cwd})\n${changes.raw.status}`);
    if (changes.raw.stat) rawStat.push(`# ${label} (${cwd})\n${changes.raw.stat}`);
    if (changes.raw.diff) rawDiff.push(`# ${label} (${cwd})\n${changes.raw.diff}`);
  }
  const summary = files.reduce(
    (total, file) => ({
      filesChanged: total.filesChanged + 1,
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { filesChanged: 0, additions: 0, deletions: 0 },
  );
  return {
    ok: parent.ok || sawGitRepo,
    cwd: parent.cwd,
    isGitRepo: sawGitRepo,
    summary,
    files,
    raw: { status: rawStatus.join("\n\n"), stat: rawStat.join("\n\n"), diff: rawDiff.join("\n\n") },
    error: sawGitRepo ? undefined : parent.error,
  };
}

async function collectWorkspaceChanges(session: SessionSummary): Promise<WorkspaceChanges> {
  if (session.conversationType === "room") return collectRoomWorkspaceChanges(session);
  return collectWorkspaceChangesForCwd(resolveSessionCwd(session));
}

function deleteProjectRecord(projectId: string, deleteFiles: boolean) {
  const index = appData.projects.findIndex((item) => item.id === projectId);
  if (index === -1) throw new Error("project_not_found");

  const project = appData.projects[index];
  if (deleteFiles) {
    const absolutePath = resolveTerminalCwd(project.workspacePath);
    const protectedPaths = new Set([resolve("/"), resolve(process.env.HOME ?? "/"), terminalRoot]);
    if (protectedPaths.has(absolutePath)) throw new Error("refuse_delete_protected_path");
    if (existsSync(absolutePath)) rmSync(absolutePath, { recursive: true, force: true });
  } else {
    writeProjectWorkspaceMetadata(project, new Date().toISOString());
  }

  const [removedProject] = appData.projects.splice(index, 1);
  for (const session of appData.sessions) {
    if (session.projectId !== removedProject.id) continue;
    deletePreviewsForScope("session", session.id);
    session.projectId = null;
    session.kind = "scratch";
    session.workspacePath = ensureScratchSessionWorkspace(session.id);
    session.updatedAt = new Date().toISOString();
    upsertSession(session);
  }
  deletePreviewsForScope("project", removedProject.id);
  db.prepare("delete from project_check_runs where project_id = ?").run(removedProject.id);
  db.prepare("delete from project_git_operations where project_id = ?").run(removedProject.id);
  db.prepare("delete from projects where id = ?").run(removedProject.id);
  return { ok: true, id: removedProject.id, deletedFiles: deleteFiles };
}

function assertWorkspaceChangePath(changes: WorkspaceChanges, filePath: string) {
  const change = changes.files.find((item) => item.path === filePath);
  if (!change) throw new Error("change_not_found");
  const absolutePath = resolve(changes.cwd, filePath);
  const relativePath = relative(changes.cwd, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_workspace");
  return { change, absolutePath };
}

function resolveWorkspaceChangeActionCwd(session: SessionSummary, cwd?: string | null) {
  if (!cwd) return resolveSessionCwd(session);
  const resolved = resolveTerminalCwd(cwd);
  if (session.conversationType !== "room" || !session.roomId) throw new Error("path_outside_workspace");
  const row = db.prepare("select workspace_path from agent_runs where room_id = ? and workspace_path = ? limit 1").get(session.roomId, resolved) as { workspace_path?: string } | undefined;
  if (!row) throw new Error("path_outside_workspace");
  return resolved;
}

async function applyWorkspaceGitFileAction(cwd: string, filePath: string, action: "stage" | "unstage") {
  const changes = await collectWorkspaceChangesForCwd(cwd);
  assertWorkspaceChangePath(changes, filePath);
  const args = action === "stage" ? ["add", "--", filePath] : ["restore", "--staged", "--", filePath];
  const result = await runGitCommand(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr || `git_${action}_failed`);
  return collectWorkspaceChangesForCwd(cwd);
}

function handleTerminalWebSocketConnection(socket: WebSocket, request: IncomingMessage) {
  const url = new URL(request.url ?? "/", `ws://${host}:8788`);
  const token = url.searchParams.get("token");
  if (!verifySessionToken(token)) {
    socket.close(1008, "unauthorized");
    return;
  }
  const requestedSessionId = url.searchParams.get("sessionId") ?? "";
  const ephemeral = url.searchParams.get("ephemeral") === "true";
  let session = terminalSessions.get(requestedSessionId);
  if (!session) {
    if (requestedSessionId || !ephemeral) {
      socket.close(1008, requestedSessionId ? "terminal_session_not_running" : "terminal_session_required");
      return;
    }
    try {
      session = createTerminalSession({
        cwd: url.searchParams.get("cwd") ?? ".",
        ephemeral,
      });
    } catch (error) {
      socket.close(1011, error instanceof Error ? error.message.slice(0, 120) : "terminal_session_create_failed");
      return;
    }
  }
  session.clients.add(socket);
  socket.send(JSON.stringify({ type: "ready", session: terminalSummary(session), cwd: session.cwd, mode: session.mode }));
  if (session.buffer) socket.send(JSON.stringify({ type: "output", data: session.buffer }));
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; data?: string; cols?: number; rows?: number };
      if (message.type === "input" && typeof message.data === "string") session.adapter.write(message.data);
      if (message.type === "resize" && message.cols && message.rows) session.adapter.resize(message.cols, message.rows);
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid_message" }));
    }
  });
  socket.on("close", () => {
    session.clients.delete(socket);
  });
}

function startTerminalWebSocketServer() {
  const wss = new WebSocketServer({ host, port: 8788 });
  wss.on("connection", handleTerminalWebSocketConnection);
  console.log(`Codex Web PTY websocket listening on ws://${host}:8788`);
  return wss;
}

function startTerminalApiWebSocket(server: ReturnType<typeof serve>) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${host}:${apiPort}`);
    if (url.pathname !== "/api/terminal/ws") return;
    wss.handleUpgrade(request, socket, head, (client) => {
      handleTerminalWebSocketConnection(client, request);
    });
  });
  return wss;
}

function startPreviewWebSocketProxy(server: ReturnType<typeof serve>) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${host}:8787`);
    const parts = url.pathname.split("/").filter(Boolean);
    let previewId = "";
    let token = "";
    let upstreamPath = `${url.pathname}${url.search}`;
    if (parts[0] === "preview") {
      previewId = parts[1] ? decodeURIComponent(parts[1]) : "";
      token = parts[2] ? decodeURIComponent(parts[2]) : "";
      upstreamPath = `/${parts.slice(3).map((part) => encodeURIComponent(decodeURIComponent(part))).join("/")}${url.search}`;
    } else {
      const referer = request.headers.referer;
      if (!referer) return;
      const refererUrl = new URL(referer, `http://${host}:8787`);
      const refererParts = refererUrl.pathname.split("/").filter(Boolean);
      if (refererParts[0] !== "preview") return;
      previewId = refererParts[1] ? decodeURIComponent(refererParts[1]) : "";
      token = refererParts[2] ? decodeURIComponent(refererParts[2]) : "";
    }
    const preview = previews.get(previewId);
    if (!preview || preview.token !== token || !requestHasPreviewAccess(preview, request)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(`ws://${preview.targetHost}:${preview.port}${upstreamPath}`);
      const closeBoth = () => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
      };
      upstream.on("open", () => appendPreviewLog(preview.id, `[ws] connected ${upstreamPath}\n`));
      upstream.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      client.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      });
      upstream.on("error", () => {
        appendPreviewLog(preview.id, `[ws] upstream error ${upstreamPath}\n`);
        closeBoth();
      });
      client.on("error", closeBoth);
      upstream.on("close", closeBoth);
      client.on("close", closeBoth);
    });
  });
  return wss;
}

async function proxyPreviewHttpRequest(preview: PreviewRecord, upstreamPath: string, sourceUrl: URL, request: Request) {
  const upstreamUrl = new URL(`http://${preview.targetHost}:${preview.port}/${upstreamPath}`);
  upstreamUrl.search = sourceUrl.search;
  const upstreamHeaders = new Headers(request.headers);
  for (const key of ["host", "connection", "content-length", "accept-encoding"]) upstreamHeaders.delete(key);
  if (!upstreamHeaders.has("user-agent")) upstreamHeaders.set("user-agent", "codex-web-preview");
  let upstream: Response;
  try {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      redirect: "manual",
    });
  } catch {
    return new Response(`preview upstream unavailable: ${preview.targetHost}:${preview.port}`, { status: 502 });
  }
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const basePath = previewUrl(preview);
  const location = rewritePreviewLocation(headers.get("location"), upstreamUrl, basePath);
  if (location) headers.set("location", location);
  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html") || contentType.includes("text/css")) {
    return new Response(rewritePreviewText(await upstream.text(), basePath, contentType), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

app.post("/preview/:id/:token/access-requests", (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview || c.req.param("token") !== preview.token) return c.json({ error: "preview_not_found" }, 404);
  if (preview.access !== "private") return c.json({ error: "preview_is_public" }, 400);
  const request = createPreviewAccessRequest(preview, new URL(c.req.url));
  return c.json({ status: "pending", ...request }, 202);
});

app.get("/preview/:id/:token/access-requests/:requestId", (c) => {
  expirePreviewAccessRequests();
  const preview = previews.get(c.req.param("id"));
  if (!preview || c.req.param("token") !== preview.token) return c.json({ error: "preview_not_found" }, 404);
  const request = getPreviewAccessRequest(preview, c.req.param("requestId"), c.req.query("secret") ?? null);
  if (!request) return c.json({ error: "access_request_not_found" }, 404);
  if (request.status === "approved") {
    const approvedUntil = request.approvedUntil ? new Date(request.approvedUntil).getTime() : Date.now() + 15 * 60 * 1000;
    const ttlMs = Math.max(1, approvedUntil - Date.now());
    c.header("set-cookie", previewAccessCookie(preview, ttlMs));
  }
  return c.json({ status: request.status, approvedUntil: request.approvedUntil ?? null, url: previewUrl(preview) });
});

app.get("/preview/:id/:token/*", async (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview || c.req.param("token") !== preview.token) return c.text("preview not found", 404);
  const sourceUrl = new URL(c.req.url);
  if (!requestHasPreviewAccess(preview, c.req.raw)) return privatePreviewAccessResponse(preview, sourceUrl);
  const upstreamPath = previewUpstreamPathFromUrl(sourceUrl, preview);
  return proxyPreviewHttpRequest(preview, upstreamPath, sourceUrl, c.req.raw);
});

app.all("*", async (c, next) => {
  const sourceUrl = new URL(c.req.url);
  const path = sourceUrl.pathname;
  if (path === "/health" || path.startsWith("/preview/")) return next();
  const preview = previewFromReferer(c.req.header("referer"));
  if (!preview) return next();
  if (!requestHasPreviewAccess(preview, c.req.raw)) return c.req.method === "GET" || c.req.method === "HEAD"
    ? privatePreviewAccessResponse(preview, sourceUrl)
    : c.text("private preview requires Codex Web access", 401);
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return proxyPreviewHttpRequest(preview, path.replace(/^\/+/, ""), sourceUrl, c.req.raw);
  }
  return c.redirect(`${previewUrl(preview)}${path.replace(/^\/+/, "")}${sourceUrl.search}`, 307);
});

app.get("/health", (c) => c.json({ ok: true }));
app.get("/api/auth/state", (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  return c.json(verifySessionToken(token) ? authenticatedAuthState() : anonymousState());
});
app.post("/provider-proxy/:providerId/:proxyToken/v1/responses", async (c) => {
  const provider = appData.providers.find((item) => item.id === c.req.param("providerId"));
  if (!provider) return c.json({ error: "provider_not_found" }, 404);
  if (provider.kind !== "openai-compatible-chat" && !(provider.kind === "openai-responses" && provider.useProxy)) return c.json({ error: "provider_proxy_not_enabled" }, 400);
  if (!verifyProviderProxyToken(provider, c.req.param("proxyToken"))) return c.json({ error: "unauthorized" }, 401);
  const concurrent = getProviderProxyConcurrency(provider.id);
  if (rateLimitSettings.enabled && concurrent >= rateLimitSettings.providerProxyMaxConcurrent) return c.json({ error: "provider_proxy_busy", retryAfter: 5 }, 429, { "retry-after": "5" });
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_responses_request" }, 400);
  incrementProviderProxyConcurrency(provider.id);
  try {
    return await (provider.kind === "openai-compatible-chat"
      ? proxyResponsesToChatCompletions(provider, body)
      : proxyResponsesToResponses(provider, body));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "provider_proxy_failed" }, 502);
  } finally {
    decrementProviderProxyConcurrency(provider.id);
  }
});
app.post("/api/auth/setup/start", (c) => {
  if (authConfig) {
    const response: SetupStartResponse = { setupRequired: false, otpSecret: null, otpauthUrl: null };
    return c.json(response);
  }
  const response: SetupStartResponse = {
    setupRequired: true,
    otpSecret: pendingOtpSecret,
    otpauthUrl: generateURI({ issuer: "Codex Web", label: "local-admin", secret: pendingOtpSecret, algorithm: "sha1", digits: 6, period: 30 }),
  };
  return c.json(response);
});
app.post("/api/auth/setup/complete", async (c) => {
  if (authConfig) return c.json({ error: "already_configured" }, 409);
  const body = await c.req.json<SetupCompleteRequest>().catch(() => null);
  if (!body?.accessToken || !body.otp || !(await verifyOtp(pendingOtpSecret, body.otp))) {
    return c.json({ error: "invalid_setup_token_or_otp" }, 401);
  }
  authConfig = { accessTokenHash: hashToken(body.accessToken), otpSecret: pendingOtpSecret };
  saveAuthConfig(authConfig);
  const response: LoginResponse = { ok: true, sessionToken: signSessionToken(), auth: authenticatedAuthState() };
  emitExternalNotification({
    eventType: "auth_login",
    severity: "success",
    title: "Codex Web 登录成功",
    message: "本地管理员完成首次设置并登录。",
    sourceType: "auth",
    sourceId: "local-admin",
    metadata: { action: "setup_complete", userAgent: c.req.header("user-agent") ?? null, ip: c.req.header("x-forwarded-for") ?? null },
  });
  return c.json(response);
});
app.post("/api/auth/login", async (c) => {
  if (!authConfig) {
    const response: LoginResponse = { ok: false, sessionToken: null, auth: anonymousState(), error: "setup_required" };
    return c.json(response, 409);
  }
  const body = await c.req.json<LoginRequest>().catch(() => null);
  if (!body || hashToken(body.accessToken) !== authConfig.accessTokenHash || !(await verifyOtp(authConfig.otpSecret, body.otp))) {
    const response: LoginResponse = { ok: false, sessionToken: null, auth: anonymousState(), error: "invalid_token_or_otp" };
    return c.json(response, 401);
  }
  const response: LoginResponse = { ok: true, sessionToken: signSessionToken(), auth: authenticatedAuthState() };
  emitExternalNotification({
    eventType: "auth_login",
    severity: "success",
    title: "Codex Web 登录成功",
    message: "本地管理员已登录。",
    sourceType: "auth",
    sourceId: "local-admin",
    metadata: { action: "login", userAgent: c.req.header("user-agent") ?? null, ip: c.req.header("x-forwarded-for") ?? null },
  });
  return c.json(response);
});

app.get("/api/codex/tasks/:id/events", (c) => {
  const token = c.req.query("token") ?? getBearerToken(c.req.header("authorization"));
  if (!verifySessionToken(token)) return c.text("unauthorized", 401);
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.text("task_not_found", 404);
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: TaskEvent | { type: "snapshot"; session: SessionSummary; messages: SessionMessage[]; queue: QueuedMessage[]; exitCode: number | null }) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      const output = readCodexOutput(session.id);
      send({ type: "snapshot", session, messages: allSessionMessages(session.id), queue: listQueuedMessages(session.id), exitCode: output.exitCode });
      const unsubscribe = subscribeTaskEvents(session.id, send);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          return;
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

app.get("/api/previews/:id/logs/events", (c) => {
  const token = c.req.query("token") ?? getBearerToken(c.req.header("authorization"));
  if (!verifySessionToken(token)) return c.text("unauthorized", 401);
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.text("preview_not_found", 404);
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: PreviewLogEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      send({ type: "snapshot", preview: publicPreview(preview), logs: previewLogs.get(preview.id) ?? "" });
      const unsubscribe = subscribePreviewLogEvents(preview.id, send);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          return;
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

app.get("/api/rooms/:id/events/stream", (c) => {
  const token = c.req.query("token") ?? getBearerToken(c.req.header("authorization"));
  if (!verifySessionToken(token)) return c.text("unauthorized", 401);
  const roomId = c.req.param("id");
  const snapshot = roomActivitySnapshot(roomId);
  if (!snapshot) return c.text("room_not_found", 404);
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: RoomStreamEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      send({ type: "snapshot", ...snapshot });
      const unsubscribe = subscribeRoomEvents(roomId, send);
      const heartbeat = setInterval(() => {
        try {
          send({ type: "ping" });
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          return;
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

app.get("/api/app-notifications/events", (c) => {
  const token = c.req.query("token") ?? getBearerToken(c.req.header("authorization"));
  if (!verifySessionToken(token)) return c.text("unauthorized", 401);
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AppNotificationStreamEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      send({ type: "snapshot", ...listAppNotifications(30) });
      const unsubscribe = subscribeAppNotifications(send);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          return;
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

app.use("/api/*", requireAuth);

app.post("/api/auth/access-token", async (c) => {
  if (!authConfig) return c.json({ error: "setup_required" }, 409);
  const body = await c.req.json<UpdateAccessTokenRequest>().catch(() => null);
  if (!body?.currentAccessToken?.trim() || !body.accessToken?.trim()) return c.json({ error: "access_token_required" }, 400);
  if (hashToken(body.currentAccessToken) !== authConfig.accessTokenHash) return c.json({ error: "invalid_current_access_token" }, 401);
  authConfig = { ...authConfig, accessTokenHash: hashToken(body.accessToken) };
  saveAuthConfig(authConfig);
  const response: LoginResponse = { ok: true, sessionToken: signSessionToken(), auth: authenticatedAuthState() };
  return c.json(response);
});

app.post("/api/auth/otp/reset", (c) => {
  if (!authConfig) return c.json({ error: "setup_required" }, 409);
  pendingResetOtpSecret = generateSecret();
  const response: ResetOtpResponse = {
    otpSecret: pendingResetOtpSecret,
    otpauthUrl: generateURI({ issuer: "Codex Web", label: "local-admin", secret: pendingResetOtpSecret, algorithm: "sha1", digits: 6, period: 30 }),
  };
  return c.json(response);
});

app.post("/api/auth/otp/reset/confirm", async (c) => {
  if (!authConfig) return c.json({ error: "setup_required" }, 409);
  if (!pendingResetOtpSecret) return c.json({ error: "otp_reset_not_started" }, 400);
  const body = await c.req.json<ConfirmOtpResetRequest>().catch(() => null);
  if (!body?.currentAccessToken?.trim() || hashToken(body.currentAccessToken) !== authConfig.accessTokenHash) {
    return c.json({ error: "invalid_current_access_token" }, 401);
  }
  if (!body?.otp || !(await verifyOtp(pendingResetOtpSecret, body.otp))) {
    return c.json({ error: "invalid_otp" }, 401);
  }
  authConfig = { ...authConfig, otpSecret: pendingResetOtpSecret };
  pendingResetOtpSecret = null;
  saveAuthConfig(authConfig);
  const response: LoginResponse = { ok: true, sessionToken: signSessionToken(), auth: authenticatedAuthState() };
  return c.json(response);
});

app.post("/api/settings/maintenance/cleanup", async (c) => {
  const body = await c.req.json<{ deleteArchivedApprovals?: boolean; archivedApprovalRetentionDays?: number; deleteApprovalAuditLog?: boolean }>().catch(() => ({}));
  return c.json(cleanupDatabaseRedundancy(body ?? {}));
});

app.get("/api/settings/task-health", (c) => {
  const health = listTaskHealth();
  if (!health.ok) {
    emitExternalNotification({
      eventType: "task_health_issue",
      severity: "error",
      title: "任务健康检查发现异常",
      message: health.items.filter((item) => item.issue).map((item) => `${item.title}: ${item.issue}`).join("\n") || "运行任务状态异常。",
      sourceType: "task-health",
      sourceId: health.checkedAt,
      metadata: { items: health.items.filter((item) => item.issue) },
    });
  }
  return c.json(health);
});

app.post("/api/settings/task-health/repair", (c) => c.json(repairTaskHealth()));

app.post("/api/settings/approvals/reset", (c) => {
  const result = db.prepare("delete from approval_grants").run();
  return c.json({ ok: true, deletedGrants: result.changes });
});

app.get("/api/settings/preview-access", (c) => c.json(previewAccessSettings));

app.patch("/api/settings/preview-access", async (c) => {
  const body = await c.req.json<Partial<PreviewAccessSettings>>().catch(() => null);
  const next = runtimeSettingsStore.previewAccess.sanitize({
    requestTtlMinutes: body?.requestTtlMinutes ?? previewAccessSettings.requestTtlMinutes,
    updatedAt: new Date().toISOString(),
  });
  previewAccessSettings = next;
  runtimeSettingsStore.previewAccess.save(next);
  expirePreviewAccessRequests();
  return c.json(next);
});

app.get("/api/settings/session-compaction", (c) => c.json(sessionCompactionSettings));

app.patch("/api/settings/session-compaction", async (c) => {
  const body = await c.req.json<UpdateSessionCompactionSettingsRequest>().catch(() => null);
  const next = runtimeSettingsStore.sessionCompaction.sanitize({
    ...sessionCompactionSettings,
    ...(body ?? {}),
    updatedAt: new Date().toISOString(),
  });
  sessionCompactionSettings = next;
  runtimeSettingsStore.sessionCompaction.save(next);
  return c.json(next);
});

app.get("/api/settings/rate-limit", (c) => c.json(rateLimitSettings));

app.patch("/api/settings/rate-limit", async (c) => {
  const body = await c.req.json<Partial<RateLimitSettings>>().catch(() => null);
  const next = rateLimitStore.sanitize({
    ...rateLimitSettings,
    ...(body ?? {}),
    updatedAt: new Date().toISOString(),
  });
  rateLimitSettings = next;
  rateLimitStore.save(next);
  return c.json(next);
});

app.get("/api/settings/environment", (c) => {
  environmentOverview = buildEnvironmentOverview();
  saveEnvironmentOverview(environmentOverview);
  return c.json(environmentOverview);
});

app.post("/api/settings/environment/scan", (c) => {
  environmentOverview = buildEnvironmentOverview();
  saveEnvironmentOverview(environmentOverview);
  return c.json(environmentOverview);
});

app.get("/api/settings/environment/tool-registry", (c) => {
  try {
    const items = listEnvironmentToolRegistry(c.req.query("q")).map((item) => ({
      name: String(item.name),
      description: item.description ?? null,
      backend: item.backend ?? null,
    }));
    return c.json({ items, mise: detectMiseStatus() });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "environment_registry_failed", items: [], mise: detectMiseStatus() }, 500);
  }
});

app.get("/api/settings/environment/tool-versions", (c) => {
  try {
    const tool = c.req.query("tool") ?? "";
    const result = listEnvironmentToolVersions(tool);
    return c.json({ ...result, mise: detectMiseStatus() }, result.error ? 200 : 200);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "environment_versions_failed", items: [], mise: detectMiseStatus() }, 500);
  }
});

app.get("/api/settings/environment/tool-probe", (c) => {
  try {
    const tool = c.req.query("tool") ?? "";
    if (!tool.trim()) return c.json({ error: "tool_required" }, 400);
    return c.json({ probe: probeEnvironmentTool(tool), mise: detectMiseStatus() });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "environment_probe_failed" }, 500);
  }
});

app.post("/api/settings/environment/tools/install", async (c) => {
  const body = await c.req.json<InstallEnvironmentToolRequest>().catch(() => null);
  if (!body?.tool?.trim() || !body.version?.trim()) return c.json({ error: "invalid_environment_tool" }, 400);
  const now = new Date().toISOString();
  const requestedTool = body.tool.trim();
  const version = body.version.trim();
  const scope = body.scope ?? "global";
  const note = body.notes?.trim() ?? null;
  const installResult = spawnSync("mise", ["use", "-g", `${requestedTool}@${version}`], { encoding: "utf8" });
  const detectedVersion = detectToolVersion(requestedTool);
  const status: EnvironmentToolRecord["status"] = installResult.status === 0
    ? (detectedVersion && !detectedVersion.includes(version) ? "version_mismatch" : "installed")
    : "missing";
  const record: EnvironmentToolRecord = {
    id: `env-tool-${randomUUID()}`,
    tool: requestedTool,
    requestedVersion: version,
    detectedVersion,
    status,
    source: "mise",
    scope,
    autoRestore: body.autoRestore !== false,
    notes: note,
    createdAt: now,
    updatedAt: now,
  };
  environmentOverview = {
    ...buildEnvironmentOverview(),
    tools: [
      record,
      ...environmentOverview.tools.filter((item) => !(item.tool === record.tool && item.scope === record.scope)),
    ],
    updatedAt: now,
  };
  environmentOverview.restoreRuns = [
    {
      id: `env-restore-${randomUUID()}`,
      status: (installResult.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
      summary: installResult.status === 0
        ? `Installed ${requestedTool}@${version} via mise`
        : [installResult.stderr, installResult.stdout].join("\n").trim() || `Failed to install ${requestedTool}@${version}`,
      createdAt: now,
    },
    ...environmentOverview.restoreRuns,
  ].slice(0, 20);
  saveEnvironmentOverview(environmentOverview);
  if (installResult.status !== 0) return c.json({ error: "environment_tool_install_failed", detail: installResult.stderr || installResult.stdout, overview: environmentOverview }, 400);
  return c.json(environmentOverview, 201);
});

app.post("/api/settings/environment/tools/register", async (c) => {
  const body = await c.req.json<RegisterEnvironmentToolRequest>().catch(() => null);
  if (!body?.tool?.trim() || !body.version?.trim()) return c.json({ error: "invalid_environment_tool" }, 400);
  const now = new Date().toISOString();
  const tool = body.tool.trim();
  const detectedVersion = body.detectedVersion ?? detectToolVersion(tool);
  const record: EnvironmentToolRecord = {
    id: `env-tool-${randomUUID()}`,
    tool,
    requestedVersion: body.version.trim(),
    detectedVersion,
    status: detectedVersion
      ? (body.version.trim() && !detectedVersion.includes(body.version.trim()) ? "version_mismatch" : "installed")
      : "unknown",
    source: body.source ?? "manual",
    scope: body.scope ?? "global",
    autoRestore: body.autoRestore !== false,
    notes: body.notes?.trim() ?? null,
    createdAt: now,
    updatedAt: now,
  };
  environmentOverview = {
    ...buildEnvironmentOverview(),
    tools: [
      record,
      ...environmentOverview.tools.filter((item) => !(item.tool === record.tool && item.scope === record.scope)),
    ],
    updatedAt: now,
  };
  saveEnvironmentOverview(environmentOverview);
  return c.json(environmentOverview, 201);
});

app.delete("/api/settings/environment/tools/:id", (c) => {
  const id = c.req.param("id");
  environmentOverview = {
    ...buildEnvironmentOverview(),
    tools: environmentOverview.tools.filter((item) => item.id !== id),
    updatedAt: new Date().toISOString(),
  };
  saveEnvironmentOverview(environmentOverview);
  return c.json(environmentOverview);
});

app.delete("/api/settings/environment/tools/:id/uninstall", (c) => {
  const id = c.req.param("id");
  const tool = environmentOverview.tools.find((item) => item.id === id) ?? null;
  if (!tool) return c.json({ error: "environment_tool_not_found" }, 404);
  if (tool.source !== "mise") return c.json({ error: "environment_tool_uninstall_not_allowed" }, 400);
  const now = new Date().toISOString();
  const target = `${tool.tool}@${tool.requestedVersion}`;
  const uninstallResult = spawnSync("mise", ["uninstall", target], { encoding: "utf8" });
  const summary = uninstallResult.status === 0
    ? `Uninstalled ${target} via mise`
    : [uninstallResult.stderr, uninstallResult.stdout].join("\n").trim() || `Failed to uninstall ${target}`;
  environmentOverview = {
    ...buildEnvironmentOverview(),
    tools: uninstallResult.status === 0
      ? environmentOverview.tools.filter((item) => item.id !== id)
      : environmentOverview.tools,
    restoreRuns: [
      {
        id: `env-restore-${randomUUID()}`,
        status: (uninstallResult.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary,
        createdAt: now,
      },
      ...environmentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(environmentOverview);
  if (uninstallResult.status !== 0) {
    return c.json({ error: "environment_tool_uninstall_failed", detail: uninstallResult.stderr || uninstallResult.stdout, overview: environmentOverview }, 400);
  }
  return c.json(environmentOverview);
});

app.post("/api/settings/environment/tools/:id/set-default", (c) => {
  const id = c.req.param("id");
  const tool = environmentOverview.tools.find((item) => item.id === id) ?? null;
  if (!tool) return c.json({ error: "environment_tool_not_found" }, 404);
  const target = `${tool.tool}@${tool.requestedVersion}`;
  const result = spawnSync("mise", ["use", "-g", target], { encoding: "utf8" });
  const now = new Date().toISOString();
  environmentOverview = buildEnvironmentOverview();
  environmentOverview.tools = environmentOverview.tools.map((item) => item.tool === tool.tool
    ? { ...item, isGlobalDefault: item.id === id, updatedAt: now }
    : item);
  environmentOverview.restoreRuns = [
    {
      id: `env-restore-${randomUUID()}`,
      status: (result.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
      summary: result.status === 0
        ? `Set ${target} as global default via mise`
        : [result.stderr, result.stdout].join("\n").trim() || `Failed to set ${target} as global default`,
      createdAt: now,
    },
    ...environmentOverview.restoreRuns,
  ].slice(0, 20);
  environmentOverview.updatedAt = now;
  saveEnvironmentOverview(environmentOverview);
  if (result.status !== 0) return c.json({ error: "environment_tool_set_default_failed", detail: result.stderr || result.stdout, overview: environmentOverview }, 400);
  return c.json(environmentOverview);
});

app.get("/api/settings/environment/tools/:id/packages", (c) => {
  const id = c.req.param("id");
  const toolRecord = environmentOverview.tools.find((item) => item.id === id) ?? null;
  if (!toolRecord) return c.json({ error: "environment_tool_not_found" }, 404);
  const recordedPackages = listPackagesForToolRecord(toolRecord);
  const detectedPackages = environmentPackageRegistry.scanEnvironmentPackages(toolRecord)
    .filter((item) => !recordedPackages.some((record) => record.packageName === item.packageName && record.manager === item.manager));
  const response: EnvironmentPackageDetailResponse = {
    toolRecord,
    packages: [...recordedPackages, ...detectedPackages],
    managers: environmentPackageRegistry.listEnvironmentPackageManagers(toolRecord),
    restorePreview: buildEnvironmentRestorePreview(toolRecord, [...recordedPackages, ...detectedPackages]),
  };
  return c.json(response);
});

app.post("/api/settings/environment/bulk", async (c) => {
  const body = await c.req.json<EnvironmentBulkActionRequest>().catch(() => null);
  if (!body?.action) return c.json({ error: "invalid_environment_bulk_action" }, 400);
  const now = new Date().toISOString();
  if (body.action === "cleanup_stale_records") {
    const before = environmentOverview.packageRecords.length;
    const next = buildEnvironmentOverview();
    next.packageRecords = next.packageRecords.filter((pkg) => pkg.status !== "missing");
    next.restoreRuns = [
      {
        id: `env-restore-${randomUUID()}`,
        status: "success" as const,
        summary: `Cleaned up ${before - next.packageRecords.length} stale package records`,
        createdAt: now,
      },
      ...next.restoreRuns,
    ].slice(0, 20);
    next.updatedAt = now;
    environmentOverview = next;
    saveEnvironmentOverview(environmentOverview);
    return c.json(environmentOverview);
  }
  const toolRecord = body.toolRecordId ? environmentOverview.tools.find((item) => item.id === body.toolRecordId) ?? null : null;
  if (!toolRecord) return c.json({ error: "environment_tool_not_found" }, 404);
  if (body.action === "record_detected_packages" && toolRecord) {
    const recordedPackages = listPackagesForToolRecord(toolRecord);
    const detectedPackages = environmentPackageRegistry.scanEnvironmentPackages(toolRecord)
      .filter((item) => !recordedPackages.some((record) => record.packageName === item.packageName && record.manager === item.manager));
    environmentOverview = {
      ...buildEnvironmentOverview(),
      packageRecords: [
        ...detectedPackages.map((pkg) => ({ ...pkg, id: `env-pkg-${randomUUID()}`, persisted: true })),
        ...environmentOverview.packageRecords,
      ],
      restoreRuns: [
        {
          id: `env-restore-${randomUUID()}`,
          status: "success" as const,
          summary: `Recorded ${detectedPackages.length} detected packages for ${toolRecord.tool}@${toolRecord.requestedVersion}`,
          createdAt: now,
        },
        ...environmentOverview.restoreRuns,
      ].slice(0, 20),
      updatedAt: now,
    };
    saveEnvironmentOverview(environmentOverview);
    return c.json(environmentOverview);
  }
  if (body.action === "install_missing_packages" && toolRecord) {
    const packageIds = new Set(body.packageIds ?? []);
    const targets = environmentOverview.packageRecords.filter((pkg) => pkg.toolRecordId === toolRecord.id && pkg.status === "missing" && (!packageIds.size || packageIds.has(pkg.id)));
    let successCount = 0;
    const updatedRecords = [...environmentOverview.packageRecords];
    for (const pkg of targets) {
      const commandArgs = packageInstallCommandArgs(pkg.manager, pkg.packageName, pkg.versionSpec ?? null);
      if (!commandArgs) continue;
      const result = spawnSync("mise", commandArgs, { encoding: "utf8" });
      if (result.status === 0) {
        successCount += 1;
        const index = updatedRecords.findIndex((item) => item.id === pkg.id);
        if (index >= 0) updatedRecords[index] = { ...updatedRecords[index], status: "installed", persisted: true, updatedAt: now };
      }
    }
    const bulkInstallStatus: EnvironmentRestoreRun["status"] = successCount === targets.length ? "success" : successCount > 0 ? "partial" : "failed";
    environmentOverview = {
      ...buildEnvironmentOverview(),
      packageRecords: updatedRecords,
      restoreRuns: [
        {
          id: `env-restore-${randomUUID()}`,
          status: bulkInstallStatus,
          summary: `Installed ${successCount}/${targets.length} missing packages for ${toolRecord.tool}@${toolRecord.requestedVersion}`,
          createdAt: now,
        },
        ...environmentOverview.restoreRuns,
      ].slice(0, 20),
      updatedAt: now,
    };
    saveEnvironmentOverview(environmentOverview);
    return c.json(environmentOverview);
  }
  return c.json({ error: "environment_bulk_action_not_supported" }, 400);
});

app.post("/api/settings/environment/packages/install", async (c) => {
  const body = await c.req.json<InstallEnvironmentPackageRequest>().catch(() => null);
  if (!body?.toolRecordId || !body.packageName?.trim() || !body.manager?.trim()) return c.json({ error: "invalid_environment_package" }, 400);
  const toolRecord = environmentOverview.tools.find((item) => item.id === body.toolRecordId) ?? null;
  if (!toolRecord) return c.json({ error: "environment_tool_not_found" }, 404);
  const manager = body.manager.trim();
  const packageName = body.packageName.trim();
  const versionSpec = body.versionSpec?.trim() || null;
  const spec = versionSpec ? `${packageName}@${versionSpec}` : packageName;
  const probe = environmentPackageRegistry.inspectEnvironmentPackage(manager, packageName);
  const commandArgs = packageInstallCommandArgs(manager, packageName, versionSpec);
  if (!commandArgs) return c.json({ error: "environment_package_manager_not_supported" }, 400);
  const result = probe.installed ? { status: 0, stdout: "already installed", stderr: "" } : spawnSync("mise", commandArgs, { encoding: "utf8" });
  const now = new Date().toISOString();
  const record: EnvironmentPackageRecord = {
    id: `env-pkg-${randomUUID()}`,
    toolRecordId: toolRecord.id,
    tool: toolRecord.tool,
    runtimeVersion: toolRecord.requestedVersion,
    ecosystem: toolRecord.tool.toLowerCase(),
    manager,
    packageName,
    versionSpec,
    installedVersion: probe.version ?? versionSpec,
    installCommand: `mise ${commandArgs.join(" ")}`,
    uninstallCommand: packageUninstallCommandText(manager, packageName),
    targetLabel: `${toolRecord.tool}@${toolRecord.requestedVersion}`,
    scope: "global",
    autoRestore: body.autoRestore !== false,
    persisted: result.status === 0,
    status: result.status === 0 ? "installed" : "failed",
    notes: body.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  environmentOverview = {
    ...buildEnvironmentOverview(),
    packageRecords: [
      record,
      ...environmentOverview.packageRecords.filter((item) => !(item.toolRecordId === toolRecord.id && item.manager === manager && item.packageName === packageName)),
    ],
    restoreRuns: [
      {
        id: `env-restore-${randomUUID()}`,
        status: (result.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary: result.status === 0
          ? (probe.installed
            ? `Recorded existing ${packageName} for ${toolRecord.tool}@${toolRecord.requestedVersion} via ${manager}`
            : `Installed ${spec} for ${toolRecord.tool}@${toolRecord.requestedVersion} via ${manager}`)
          : [result.stderr, result.stdout].join("\n").trim() || `Failed to install ${spec}`,
        createdAt: now,
      },
      ...environmentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(environmentOverview);
  if (result.status !== 0) return c.json({ error: "environment_package_install_failed", detail: result.stderr || result.stdout, overview: environmentOverview }, 400);
  return c.json(environmentOverview, 201);
});

app.delete("/api/settings/environment/packages/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UninstallEnvironmentPackageRequest>().catch(() => null);
  const pkg = environmentOverview.packageRecords.find((item) => item.id === id) ?? null;
  if (!pkg) return c.json({ error: "environment_package_not_found" }, 404);
  const manager = body?.manager?.trim() || pkg.manager;
  const commandArgs = packageUninstallCommandArgs(manager, pkg.packageName);
  if (!commandArgs) return c.json({ error: "environment_package_manager_not_supported" }, 400);
  const result = spawnSync("mise", commandArgs, { encoding: "utf8" });
  const now = new Date().toISOString();
  environmentOverview = {
    ...buildEnvironmentOverview(),
    packageRecords: result.status === 0
      ? environmentOverview.packageRecords.filter((item) => item.id !== id)
      : environmentOverview.packageRecords.map((item) => item.id === id ? { ...item, status: "failed", updatedAt: now } : item),
    restoreRuns: [
      {
        id: `env-restore-${randomUUID()}`,
        status: (result.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary: result.status === 0
          ? `Uninstalled ${pkg.packageName} from ${pkg.targetLabel} via ${manager}`
          : [result.stderr, result.stdout].join("\n").trim() || `Failed to uninstall ${pkg.packageName}`,
        createdAt: now,
      },
      ...environmentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(environmentOverview);
  if (result.status !== 0) return c.json({ error: "environment_package_uninstall_failed", detail: result.stderr || result.stdout, overview: environmentOverview }, 400);
  return c.json(environmentOverview);
});

app.delete("/api/settings/environment/restore-runs/:id", (c) => {
  const id = c.req.param("id");
  environmentOverview = {
    ...buildEnvironmentOverview(),
    restoreRuns: environmentOverview.restoreRuns.filter((item) => item.id !== id),
    updatedAt: new Date().toISOString(),
  };
  saveEnvironmentOverview(environmentOverview);
  return c.json(environmentOverview);
});

app.delete("/api/settings/environment/restore-runs", (c) => {
  environmentOverview = {
    ...buildEnvironmentOverview(),
    restoreRuns: [],
    updatedAt: new Date().toISOString(),
  };
  saveEnvironmentOverview(environmentOverview);
  return c.json(environmentOverview);
});

app.get("/api/notifications", (c) => c.json({
  channels: listNotificationChannels(),
  accounts: listNotificationAccounts(),
  recipients: listNotificationRecipients(),
  rules: listNotificationRules(20).items,
  ephemeralRules: listNotificationEphemeralRules(20).items,
  recentDeliveries: listNotificationDeliveries(20).items,
}));

app.get("/api/app-notifications", (c) => c.json(listAppNotifications(parsePageLimit(c.req.query("limit"), 30))));

app.patch("/api/app-notifications/read", async (c) => {
  const body = await c.req.json<{ ids?: string[]; all?: boolean }>().catch((): { ids?: string[]; all?: boolean } => ({}));
  const now = new Date().toISOString();
  if (body?.all) {
    db.prepare("update app_notifications set read_at = coalesce(read_at, ?) where read_at is null").run(now);
  } else {
    const ids = Array.isArray(body?.ids) ? body.ids.map((id: string) => String(id)).filter(Boolean).slice(0, 100) : [];
    const update = db.prepare("update app_notifications set read_at = coalesce(read_at, ?) where id = ?");
    for (const id of ids) update.run(now, id);
  }
  const next = listAppNotifications(30);
  publishAppNotificationEvent({ type: "snapshot", ...next });
  return c.json(next);
});

app.delete("/api/app-notifications", (c) => {
  const result = db.prepare("delete from app_notifications").run();
  publishAppNotificationsSnapshot();
  return c.json({ ok: true, deleted: result.changes });
});

app.get("/api/notifications/accounts", (c) => c.json(listNotificationAccounts()));

app.get("/api/notifications/channels", (c) => c.json(listNotificationChannels()));

app.post("/api/notifications/channels", async (c) => {
  const body = await c.req.json<UpsertNotificationChannelRequest>().catch(() => null);
  if (!body?.name?.trim() || !body.urlTemplate?.trim()) return c.json({ error: "invalid_notification_channel" }, 400);
  const now = new Date().toISOString();
  const id = `notification-channel-${randomUUID()}`;
  const adapter = body.adapter === "authenticated_webhook" ? "authenticated_webhook" : "webhook";
  const authType = body.authType && ["none", "bearer", "query_token", "token_request"].includes(body.authType) ? body.authType : "none";
  db.prepare(`
    insert into notification_channels (id, name, kind, adapter, auth_type, description, method, url_template, headers_template, body_template, account_fields, builtin, created_at, updated_at)
    values (?, ?, 'webhook', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    body.name.trim(),
    adapter,
    authType,
    body.description?.trim() ?? "",
    body.method?.trim().toUpperCase() || "POST",
    body.urlTemplate.trim(),
    body.headersTemplate ?? "",
    body.bodyTemplate ?? "",
    JSON.stringify((body.accountFields ?? []).map((field) => field.trim()).filter(Boolean)),
    now,
    now,
  );
  return c.json(notificationChannelFromRow(db.prepare("select * from notification_channels where id = ?").get(id) as Record<string, unknown>), 201);
});

app.patch("/api/notifications/channels/:id", async (c) => {
  const current = db.prepare("select * from notification_channels where id = ? and builtin = 0").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "notification_channel_not_found" }, 404);
  const body = await c.req.json<UpsertNotificationChannelRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_notification_channel" }, 400);
  const channel = notificationChannelFromRow(current);
  const adapter = body.adapter === "authenticated_webhook" ? "authenticated_webhook" : channel.adapter ?? "webhook";
  const authType = body.authType && ["none", "bearer", "query_token", "token_request"].includes(body.authType) ? body.authType : channel.authType ?? "none";
  db.prepare(`
    update notification_channels
    set name = ?, adapter = ?, auth_type = ?, description = ?, method = ?, url_template = ?, headers_template = ?, body_template = ?, account_fields = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || channel.name,
    adapter,
    authType,
    body.description?.trim() ?? channel.description,
    body.method?.trim().toUpperCase() || channel.method || "POST",
    body.urlTemplate?.trim() || channel.urlTemplate || "",
    body.headersTemplate ?? channel.headersTemplate ?? "",
    body.bodyTemplate ?? channel.bodyTemplate ?? "",
    JSON.stringify(body.accountFields ? body.accountFields.map((field) => field.trim()).filter(Boolean) : channel.accountFields ?? []),
    new Date().toISOString(),
    c.req.param("id"),
  );
  return c.json(notificationChannelFromRow(db.prepare("select * from notification_channels where id = ?").get(c.req.param("id")) as Record<string, unknown>));
});

app.delete("/api/notifications/channels/:id", (c) => {
  const used = db.prepare("select id from notification_accounts where channel_id = ? limit 1").get(c.req.param("id"))
    ?? db.prepare("select id from notification_recipients where channel_id = ? limit 1").get(c.req.param("id"));
  if (used) return c.json({ error: "notification_channel_in_use" }, 409);
  const result = db.prepare("delete from notification_channels where id = ? and builtin = 0").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "notification_channel_not_found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/notifications/accounts", async (c) => {
  const body = await c.req.json<UpsertNotificationAccountRequest>().catch(() => null);
  const selectedChannel = getNotificationChannel(body?.channelId) ?? (body?.channelKind ? notificationChannels.find((channel) => channel.kind === body.channelKind) : null);
  const channelKind = selectedChannel?.kind ?? null;
  if (!body?.name?.trim() || !channelKind) return c.json({ error: "invalid_notification_account" }, 400);
  const now = new Date().toISOString();
  const id = `notification-account-${randomUUID()}`;
  const config = selectedChannel?.builtin === false ? (body.config ?? {}) : sanitizeNotificationConfig(channelKind, body.config);
  db.prepare(`
    insert into notification_accounts (id, name, channel_id, channel_kind, enabled, config, permissions, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.name.trim(), selectedChannel?.id ?? null, channelKind, body.enabled === false ? 0 : 1, JSON.stringify(config), JSON.stringify(sanitizeNotificationPermissions(body.permissions)), now, now);
  const account = notificationAccountFromRow(db.prepare("select * from notification_accounts where id = ?").get(id) as Record<string, unknown>, true);
  void syncTelegramBotCommands(account).catch((error) => console.warn("telegram command menu sync failed", account.id, error));
  return c.json(notificationAccountFromRow(db.prepare("select * from notification_accounts where id = ?").get(id) as Record<string, unknown>), 201);
});

app.patch("/api/notifications/accounts/:id", async (c) => {
  const current = db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "notification_account_not_found" }, 404);
  const body = await c.req.json<UpsertNotificationAccountRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_notification_account" }, 400);
  const currentKind = String(current.channel_kind) as NotificationAccountSummary["channelKind"];
  const selectedChannel = getNotificationChannel(body.channelId ?? (current.channel_id ? String(current.channel_id) : null)) ?? (body.channelKind ? notificationChannels.find((channel) => channel.kind === body.channelKind) : null);
  const channelKind = selectedChannel?.kind ?? currentKind;
  const previousConfig = parseJsonValue<Record<string, unknown>>(current.config, {});
  db.prepare(`
    update notification_accounts
    set name = ?, channel_id = ?, channel_kind = ?, enabled = ?, config = ?, permissions = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || String(current.name),
    selectedChannel?.id ?? current.channel_id ?? null,
    channelKind,
    body.enabled === undefined ? (Boolean(current.enabled) ? 1 : 0) : body.enabled ? 1 : 0,
    JSON.stringify(selectedChannel?.builtin === false ? { ...previousConfig, ...(body.config ?? {}) } : sanitizeNotificationConfig(channelKind, body.config, previousConfig)),
    JSON.stringify(body.permissions === undefined ? sanitizeNotificationPermissions(parseJsonValue<NotificationPermissionPolicy>(current.permissions, {})) : sanitizeNotificationPermissions(body.permissions)),
    new Date().toISOString(),
    c.req.param("id"),
  );
  const account = notificationAccountFromRow(db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown>, true);
  void syncTelegramBotCommands(account).catch((error) => console.warn("telegram command menu sync failed", account.id, error));
  return c.json(notificationAccountFromRow(db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown>));
});

app.delete("/api/notifications/accounts/:id", (c) => {
  const result = db.prepare("delete from notification_accounts where id = ?").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "notification_account_not_found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/notifications/accounts/:id/test", async (c) => {
  const row = db.prepare("select * from notification_accounts where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: "notification_account_not_found" }, 404);
  const body = await c.req.json<TestNotificationAccountRequest>().catch((): TestNotificationAccountRequest => ({}));
  const account = notificationAccountFromRow(row, true);
  const config = account.config as Record<string, unknown>;
  const emailTo = body?.emailTo?.length
    ? body.emailTo
    : Array.isArray(config.testEmailTo)
      ? config.testEmailTo.map((item) => String(item).trim()).filter(Boolean)
      : String(config.testEmailTo ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const chatId = String(body?.chatId ?? config.testChatId ?? "").trim() || undefined;
  const ok = await deliverNotification(account, {
    eventType: "task_completed",
    severity: "info",
    title: "Codex Web test notification",
    message: "This is a test notification from Codex Web.",
    sourceType: "notification-account",
    sourceId: account.id,
  }, null, { accountId: account.id, emailTo, chatId });
  db.prepare("update notification_accounts set last_test_status = ?, last_error = (select last_error from notification_deliveries where account_id = ? order by created_at desc limit 1), updated_at = ? where id = ?")
    .run(ok ? "sent" : "failed", account.id, new Date().toISOString(), account.id);
  return c.json({ ok, account: notificationAccountFromRow(db.prepare("select * from notification_accounts where id = ?").get(account.id) as Record<string, unknown>) }, ok ? 200 : 400);
});

app.get("/api/notifications/recipients", (c) => c.json(listNotificationRecipients()));

app.post("/api/notifications/recipients", async (c) => {
  const body = await c.req.json<UpsertNotificationRecipientRequest>().catch(() => null);
  const kind = body?.kind && ["email", "webhook", "bark", "telegram"].includes(body.kind) ? body.kind : null;
  if (!body?.name?.trim() || !kind) return c.json({ error: "invalid_notification_recipient" }, 400);
  const now = new Date().toISOString();
  const id = `notification-recipient-${randomUUID()}`;
  db.prepare(`
    insert into notification_recipients (id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.name.trim(), kind, body.enabled === false ? 0 : 1, body.senderAccountId ?? null, body.channelId ?? null, JSON.stringify(body.config ?? {}), JSON.stringify(sanitizeNotificationPermissions(body.permissions)), now, now);
  return c.json(notificationRecipientFromRow(db.prepare("select * from notification_recipients where id = ?").get(id) as Record<string, unknown>), 201);
});

app.patch("/api/notifications/recipients/:id", async (c) => {
  const current = db.prepare("select * from notification_recipients where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "notification_recipient_not_found" }, 404);
  const body = await c.req.json<UpsertNotificationRecipientRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_notification_recipient" }, 400);
  const recipient = notificationRecipientFromRow(current, true);
  db.prepare(`
    update notification_recipients
    set name = ?, kind = ?, enabled = ?, sender_account_id = ?, channel_id = ?, config = ?, permissions = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || recipient.name,
    body.kind ?? recipient.kind,
    body.enabled === undefined ? (recipient.enabled ? 1 : 0) : body.enabled ? 1 : 0,
    body.senderAccountId === undefined ? recipient.senderAccountId : body.senderAccountId,
    body.channelId === undefined ? recipient.channelId : body.channelId,
    JSON.stringify({ ...recipient.config, ...(body.config ?? {}) }),
    JSON.stringify(body.permissions === undefined ? recipient.permissions ?? {} : sanitizeNotificationPermissions(body.permissions)),
    new Date().toISOString(),
    c.req.param("id"),
  );
  return c.json(notificationRecipientFromRow(db.prepare("select * from notification_recipients where id = ?").get(c.req.param("id")) as Record<string, unknown>));
});

app.post("/api/notifications/recipients/:id/test", async (c) => {
  const row = db.prepare("select * from notification_recipients where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: "notification_recipient_not_found" }, 404);
  const recipient = notificationRecipientFromRow(row, true);
  try {
    const ok = await deliverNotificationToRecipient(recipient, {
      eventType: "task_completed",
      severity: "info",
      title: "Codex Web test notification",
      message: "This is a test notification from Codex Web.",
      sourceType: "notification-recipient",
      sourceId: recipient.id,
    }, null, { recipientId: recipient.id });
    return c.json({ ok, recipient: notificationRecipientFromRow(row) }, ok ? 200 : 400);
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : String(error), recipient: notificationRecipientFromRow(row) }, 400);
  }
});

app.post("/api/notifications/ephemeral-rules", async (c) => {
  const body = await c.req.json<{
    scopeType?: "session" | "task" | "room_task";
    scopeId?: string;
    eventTypes?: NotificationEventType[];
    targets?: NotificationRuleTarget[];
    expireMode?: "after_trigger" | "session_end" | "manual";
  }>().catch(() => null);
  const rule = body ? createNotificationEphemeralRule(body) : null;
  if (!rule) return c.json({ error: "invalid_notification_ephemeral_rule" }, 400);
  return c.json(rule, 201);
});

app.delete("/api/notifications/ephemeral-rules/:id", (c) => {
  const result = db.prepare("delete from notification_ephemeral_rules where id = ?").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "notification_ephemeral_rule_not_found" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/notifications/recipients/:id", (c) => {
  const result = db.prepare("delete from notification_recipients where id = ?").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "notification_recipient_not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/notifications/ephemeral-rules", (c) => c.json(listNotificationEphemeralRules(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));

app.get("/api/notifications/rules", (c) => c.json(listNotificationRules(
  parsePageLimit(c.req.query("limit"), 50),
  c.req.query("cursor"),
  { enabled: c.req.query("enabled") === "true" ? true : c.req.query("enabled") === "false" ? false : undefined },
)));

app.delete("/api/notifications/rules", (c) => {
  const rules = db.prepare("delete from notification_rules").run();
  const ephemeral = db.prepare("delete from notification_ephemeral_rules").run();
  return c.json({ ok: true, deleted: rules.changes + ephemeral.changes });
});

app.post("/api/notifications/rules", async (c) => {
  const body = await c.req.json<UpsertNotificationRuleRequest>().catch(() => null);
  if (!body?.name?.trim()) return c.json({ error: "invalid_notification_rule" }, 400);
  const eventTypes = (body.eventTypes ?? []).filter((type) => notificationEventTypes.includes(type));
  const targets = sanitizeNotificationTargets(body.targets);
  if (!eventTypes.length || !targets.length) return c.json({ error: "notification_rule_requires_events_and_targets" }, 400);
  const now = new Date().toISOString();
  const id = `notification-rule-${randomUUID()}`;
  db.prepare(`
    insert into notification_rules (id, name, enabled, event_types, min_severity, targets, dedupe_minutes, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name.trim(),
    body.enabled === false ? 0 : 1,
    JSON.stringify(eventTypes),
    body.minSeverity && notificationSeverityRank[body.minSeverity] !== undefined ? body.minSeverity : "info",
    JSON.stringify(targets),
    Math.max(0, Number(body.dedupeMinutes) || 0),
    now,
    now,
  );
  return c.json(notificationRuleFromRow(db.prepare("select * from notification_rules where id = ?").get(id) as Record<string, unknown>), 201);
});

app.patch("/api/notifications/rules/:id", async (c) => {
  const current = db.prepare("select * from notification_rules where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "notification_rule_not_found" }, 404);
  const body = await c.req.json<UpsertNotificationRuleRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_notification_rule" }, 400);
  const rule = notificationRuleFromRow(current);
  const eventTypes = body.eventTypes ? body.eventTypes.filter((type) => notificationEventTypes.includes(type)) : rule.eventTypes;
  const targets = body.targets ? sanitizeNotificationTargets(body.targets) : rule.targets;
  if (!eventTypes.length || !targets.length) return c.json({ error: "notification_rule_requires_events_and_targets" }, 400);
  db.prepare(`
    update notification_rules
    set name = ?, enabled = ?, event_types = ?, min_severity = ?, targets = ?, dedupe_minutes = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || rule.name,
    body.enabled === undefined ? (rule.enabled ? 1 : 0) : body.enabled ? 1 : 0,
    JSON.stringify(eventTypes),
    body.minSeverity && notificationSeverityRank[body.minSeverity] !== undefined ? body.minSeverity : rule.minSeverity,
    JSON.stringify(targets),
    Math.max(0, Number(body.dedupeMinutes ?? rule.dedupeMinutes) || 0),
    new Date().toISOString(),
    c.req.param("id"),
  );
  return c.json(notificationRuleFromRow(db.prepare("select * from notification_rules where id = ?").get(c.req.param("id")) as Record<string, unknown>));
});

app.delete("/api/notifications/rules/:id", (c) => {
  const result = db.prepare("delete from notification_rules where id = ?").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "notification_rule_not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/notifications/deliveries", (c) => {
  const eventType = c.req.query("eventType") as NotificationEventType | undefined;
  const status = c.req.query("status") as NotificationDeliveryStatus | undefined;
  const severity = c.req.query("severity") as NotificationSeverity | undefined;
  return c.json(listNotificationDeliveries(
    parsePageLimit(c.req.query("limit"), 50),
    c.req.query("cursor"),
    {
      eventType: eventType && notificationEventTypes.includes(eventType) ? eventType : undefined,
      status: status && ["pending", "sent", "failed", "skipped"].includes(status) ? status : undefined,
      severity: severity && notificationSeverityRank[severity] !== undefined ? severity : undefined,
    },
  ));
});

app.delete("/api/notifications/deliveries", (c) => {
  const result = db.prepare("delete from notification_deliveries").run();
  return c.json({ ok: true, deleted: result.changes });
});

app.post("/api/notifications/deliveries/:id/retry", async (c) => {
  const row = db.prepare("select * from notification_deliveries where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: "notification_delivery_not_found" }, 404);
  const delivery = notificationDeliveryFromRow(row);
  const metadata = delivery.metadata ?? {};
  const metadataTarget = metadata.target && typeof metadata.target === "object" ? metadata.target as Record<string, unknown> : {};
  const metadataRecipient = metadata.recipient && typeof metadata.recipient === "object" ? metadata.recipient as Record<string, unknown> : {};
  const target: NotificationRuleTarget = sanitizeNotificationTargets([{
    accountId: metadataTarget.accountId ? String(metadataTarget.accountId) : delivery.accountId ?? undefined,
    recipientId: metadataTarget.recipientId ? String(metadataTarget.recipientId) : metadataRecipient.id ? String(metadataRecipient.id) : undefined,
    senderAccountId: metadataTarget.senderAccountId ? String(metadataTarget.senderAccountId) : undefined,
    chatId: metadataTarget.chatId ? String(metadataTarget.chatId) : undefined,
    emailTo: Array.isArray(metadataTarget.emailTo) ? metadataTarget.emailTo.map((item) => String(item)) : undefined,
  }])[0] ?? {};
  const event: NotificationEventInput = {
    eventType: delivery.eventType,
    severity: delivery.severity,
    title: delivery.title,
    message: delivery.message,
    sourceType: typeof metadata.sourceType === "string" ? metadata.sourceType : undefined,
    sourceId: typeof metadata.sourceId === "string" ? metadata.sourceId : undefined,
    metadata: {
      ...(metadata.eventMetadata && typeof metadata.eventMetadata === "object" ? metadata.eventMetadata as Record<string, unknown> : {}),
      retryOfDeliveryId: delivery.id,
    },
  };
  if (target.recipientId) {
    const recipientRow = db.prepare("select * from notification_recipients where id = ?").get(target.recipientId) as Record<string, unknown> | undefined;
    if (!recipientRow) return c.json({ error: "notification_recipient_not_found" }, 404);
    const ok = await deliverNotificationToRecipient(notificationRecipientFromRow(recipientRow, true), event, delivery.ruleId ?? null, target);
    return c.json({ ok });
  }
  if (!delivery.accountId) return c.json({ error: "notification_delivery_target_missing" }, 400);
  const accountRow = db.prepare("select * from notification_accounts where id = ?").get(delivery.accountId) as Record<string, unknown> | undefined;
  if (!accountRow) {
    const recipientRow = db.prepare("select * from notification_recipients where id = ?").get(delivery.accountId) as Record<string, unknown> | undefined;
    if (recipientRow) {
      const ok = await deliverNotificationToRecipient(notificationRecipientFromRow(recipientRow, true), event, delivery.ruleId ?? null, { ...target, recipientId: delivery.accountId });
      return c.json({ ok });
    }
  }
  if (!accountRow) return c.json({ error: "notification_account_not_found" }, 404);
  const ok = await deliverNotification(notificationAccountFromRow(accountRow, true), event, delivery.ruleId ?? null, { ...target, accountId: delivery.accountId });
  return c.json({ ok });
});

app.delete("/api/notifications/deliveries/:id", (c) => {
  const result = db.prepare("delete from notification_deliveries where id = ?").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "notification_delivery_not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/settings/storage", (c) => c.json(listStorageItems()));

app.post("/api/settings/storage/delete", async (c) => {
  const body = await c.req.json<{ type?: string; path?: string; force?: boolean }>().catch(() => null);
  if (!body?.type || !body.path) return c.json({ error: "invalid_storage_item" }, 400);
  try {
    deleteStorageItem(body.type, body.path, body.force === true);
    return c.json(listStorageItems());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "storage_delete_failed" }, 400);
  }
});

app.post("/api/settings/storage/delete-batch", async (c) => {
  const body = await c.req.json<{ items?: Array<{ type?: string; path?: string }>; force?: boolean }>().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return c.json({ error: "invalid_storage_items" }, 400);
  const currentItems = listStorageItems().items;
  if (body?.force !== true && items.some((item) => currentItems.some((entry) => entry.type === item.type && entry.path === item.path && entry.status === "active"))) {
    return c.json({ error: "storage_item_active", deleted: 0 }, 400);
  }
  let deleted = 0;
  try {
    for (const item of items) {
      if (!item.type || !item.path) continue;
      deleteStorageItem(item.type, item.path, body?.force === true);
      deleted += 1;
    }
    return c.json({ ...listStorageItems(), deleted });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "storage_delete_failed", deleted }, 400);
  }
});

app.get("/api/settings/backup", (c) => c.json(systemBackupSettings));

app.patch("/api/settings/backup", async (c) => {
  const body = await c.req.json<UpdateSystemBackupSettingsRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  systemBackupSettings = sanitizeSystemBackupSettings({ ...body, updatedAt: new Date().toISOString() });
  saveSystemBackupSettings(systemBackupSettings);
  return c.json(systemBackupSettings);
});

app.get("/api/settings/backup/preview", (c) => {
  try {
    const backup = createSystemBackupArchive();
    const response: SystemBackupPreviewResponse = {
      ok: true,
      manifest: backup.manifest,
      entries: backup.entries,
      bytes: backup.bytes,
      restartRequired: false,
    };
    return c.json(response);
  } catch (error) {
    emitExternalNotification({
      eventType: "backup_failed",
      severity: "error",
      title: "备份预览失败",
      message: error instanceof Error ? error.message : "backup_preview_failed",
      sourceType: "backup",
      sourceId: "preview",
    });
    return c.json({ error: error instanceof Error ? error.message : "backup_preview_failed" }, 500);
  }
});

app.get("/api/settings/backup/download", (c) => {
  try {
    const backup = createSystemBackupArchive();
    const filename = `codex-web-system-backup-${backup.manifest.createdAt.replace(/[:.]/g, "-")}.zip`;
    c.header("content-type", "application/zip");
    c.header("content-disposition", `attachment; filename="${filename}"`);
    return c.body(backup.buffer);
  } catch (error) {
    emitExternalNotification({
      eventType: "backup_failed",
      severity: "error",
      title: "备份下载失败",
      message: error instanceof Error ? error.message : "backup_download_failed",
      sourceType: "backup",
      sourceId: "download",
    });
    return c.json({ error: error instanceof Error ? error.message : "backup_download_failed" }, 500);
  }
});

app.post("/api/settings/restore/preview", async (c) => {
  try {
    const buffer = await readBackupUpload(c);
    return c.json(systemBackupPreviewFromArchive(buffer));
  } catch (error) {
    emitExternalNotification({
      eventType: "restore_failed",
      severity: "error",
      title: "恢复预览失败",
      message: error instanceof Error ? error.message : "restore_preview_failed",
      sourceType: "restore",
      sourceId: "preview",
    });
    return c.json({ error: error instanceof Error ? error.message : "restore_preview_failed" }, 400);
  }
});

app.post("/api/settings/restore", async (c) => {
  try {
    const buffer = await readBackupUpload(c);
    const parsed = readSystemBackupArchive(buffer);
    if (!parsed.entries.length) return c.json({ error: "backup_has_no_app_data" }, 400);
    const beforeRestore = createSystemBackupArchive();
    const restoreBackupRoot = join(dirname(dataDir), "restore-backups");
    mkdirSync(restoreBackupRoot, { recursive: true });
    const backupBeforeRestorePath = join(restoreBackupRoot, `pre-restore-${backupTimestamp()}.zip`);
    writeFileSync(backupBeforeRestorePath, beforeRestore.buffer);

    try {
      db.pragma("wal_checkpoint(FULL)");
      db.close();
    } catch {
      // The API service must be restarted after restore, so failure to close cleanly is reported by the restart requirement.
    }

    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    for (const entry of parsed.entries) {
      const targetPath = join(dataDir, entry.relativePath);
      if (!pathWithinRoot(targetPath, dataDir)) throw new Error("invalid_backup_entry");
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, entry.data);
    }

    const response: SystemRestoreResponse = {
      ok: true,
      manifest: parsed.manifest,
      restoredAt: new Date().toISOString(),
      backupBeforeRestorePath,
      restartRequired: true,
      warnings: [
        ...parsed.manifest.warnings,
        "系统数据已还原到 apps/api/data。请通过终端重启 API 服务后再继续使用；无需重启前端或 Docker 容器。",
      ],
    };
    return c.json(response);
  } catch (error) {
    emitExternalNotification({
      eventType: "restore_failed",
      severity: "error",
      title: "系统恢复失败",
      message: error instanceof Error ? error.message : "restore_failed",
      sourceType: "restore",
      sourceId: "apply",
    });
    return c.json({ error: error instanceof Error ? error.message : "restore_failed" }, 400);
  }
});

app.get("/api/settings/codex-runtime", (c) => c.json(codexRuntimeSettings));

app.patch("/api/settings/codex-runtime", async (c) => {
  const body = await c.req.json<UpdateCodexRuntimeSettingsRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const next = runtimeSettingsStore.codexRuntime.sanitize({
    ...codexRuntimeSettings,
    ...body,
    updatedAt: new Date().toISOString(),
  });
  const risk = codexRuntimeRisk(codexRuntimeSettings, next);
  if (risk) {
    if (approvalAlwaysAllowed("codex-runtime-update", next)) return c.json(applyCodexRuntimeSettings(next));
    const approval = createApproval({
      actionType: "codex-runtime-update",
      risk,
      title: "Codex execution permission change",
      description: risk === "critical"
        ? "Enable Codex sandbox and approval bypass for new tasks."
        : "Enable full filesystem access for new Codex tasks.",
      details: codexRuntimeDetails(next),
      payload: next,
    });
    return c.json({ error: "approval_required", approval: publicApproval(approval) }, 409);
  }
  return c.json(applyCodexRuntimeSettings(next));
});

app.get("/api/approvals", (c) => {
  expirePreviewAccessRequests();
  const status = c.req.query("status");
  if (status && !["pending", "approved", "denied"].includes(status)) return c.json({ error: "invalid_status" }, 400);
  const archived = c.req.query("archived") === "true";
  const page = listApprovals(status, archived, parsePageLimit(c.req.query("limit")), c.req.query("cursor"));
  return c.json({ ...page, items: page.items.map(publicApproval) });
});

app.get("/api/approval-grants", (c) => c.json(listApprovalGrants(parsePageLimit(c.req.query("limit")), c.req.query("cursor"))));

app.delete("/api/approval-grants/:id", (c) => {
  const result = db.prepare("delete from approval_grants where id = ?").run(c.req.param("id"));
  if (!result.changes) return c.json({ error: "approval_grant_not_found" }, 404);
  return c.json({ ok: true, id: c.req.param("id") });
});

app.post("/api/approvals/:id/archive", (c) => {
  const approval = getApproval(c.req.param("id"));
  if (!approval) return c.json({ error: "approval_not_found" }, 404);
  if (approval.status === "pending") return c.json({ error: "approval_pending_cannot_archive", approval: publicApproval(approval) }, 409);
  const archived = archiveApproval(approval.id);
  if (!archived?.archivedAt) return c.json({ error: "approval_archive_failed" }, 400);
  return c.json(publicApproval(archived));
});

app.post("/api/approvals/:id/restore", (c) => {
  const approval = getApproval(c.req.param("id"));
  if (!approval) return c.json({ error: "approval_not_found" }, 404);
  const restored = restoreApproval(approval.id);
  if (!restored) return c.json({ error: "approval_not_found" }, 404);
  return c.json(publicApproval(restored));
});

app.post("/api/approvals/:id/approve", (c) => {
  const approval = getApproval(c.req.param("id"));
  if (!approval) return c.json({ error: "approval_not_found" }, 404);
  if (approval.status !== "pending") return c.json({ error: "approval_already_resolved", approval: publicApproval(approval) }, 409);
  if (c.req.query("always") === "true" || c.req.query("expiresIn")) {
    const expiresIn = Number(c.req.query("expiresIn") ?? 0);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + Math.min(expiresIn, 30 * 24 * 60 * 60) * 1000).toISOString() : null;
    saveApprovalGrant(approval, expiresAt);
  }
  let codexRuntime: CodexRuntimeSettings | undefined;
  if (approval.actionType === "codex-runtime-update") {
    codexRuntime = applyCodexRuntimeSettings(runtimeSettingsStore.codexRuntime.sanitize(approval.payload as Partial<CodexRuntimeSettings>));
  }
  let preview: PreviewSummary | undefined;
  if (approval.actionType === "preview-command-run") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { previewId?: unknown } : {};
    const record = previews.get(String(payload.previewId ?? ""));
    if (!record) return c.json({ error: "preview_not_found" }, 404);
    try {
      startPreviewProcess(record);
      preview = publicPreview(record);
    } catch (error) {
      record.status = "error";
      updatePreview(record);
      return c.json({ error: error instanceof Error ? error.message : "preview_start_failed", preview: publicPreview(record) }, 400);
    }
  }
  if (approval.actionType === "preview-access") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { requestId?: unknown; previewId?: unknown } : {};
    const request = previewAccessRequests.get(String(payload.requestId ?? ""));
    if (!request) return c.json({ error: "preview_access_request_not_found" }, 404);
    const expiresIn = Number(c.req.query("expiresIn") ?? 15 * 60);
    const ttlSeconds = c.req.query("always") === "true"
      ? 30 * 24 * 60 * 60
      : Number.isFinite(expiresIn) && expiresIn > 0
        ? Math.min(expiresIn, 30 * 24 * 60 * 60)
        : 15 * 60;
    const approvedUntil = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const requests = Array.from(previewAccessRequests.values()).filter((item) =>
      item.id === request.id || (payload.previewId && item.previewId === String(payload.previewId) && item.status === "pending")
    );
    for (const item of requests) {
      item.status = "approved";
      item.approvedUntil = approvedUntil;
      item.updatedAt = new Date().toISOString();
      upsertPreviewAccessRequest(item);
    }
  }
  if (approval.actionType === "project-delete-files") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { projectId?: unknown } : {};
    try {
      deleteProjectRecord(String(payload.projectId ?? ""), true);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "project_delete_failed" }, 400);
    }
  }
  let merge: RoomRunMergeResponse | undefined;
  if (approval.actionType === "room-run-merge") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { roomId?: unknown; runId?: unknown } : {};
    try {
      merge = applyRoomRunMerge(String(payload.roomId ?? ""), String(payload.runId ?? ""));
      if (!merge.ok) return c.json({ error: merge.message || "merge_failed", merge }, 409);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "merge_failed" }, 400);
    }
  }
  let gitOperation: ProjectGitOperationSummary | undefined;
  if (approval.actionType === "project-git-operation") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { projectId?: unknown; operation?: unknown; args?: unknown } : {};
    const project = appData.projects.find((item) => item.id === String(payload.projectId ?? ""));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
    const operation = String(payload.operation ?? "") as ProjectGitOperationType;
    gitOperation = runProjectGitOperation(project, operation, args);
  }
  const resolved = resolveApproval(approval.id, "approved");
  if (!resolved) return c.json({ error: "approval_not_found" }, 404);
  const response: ApprovalDecisionResponse = { approval: publicApproval(resolved), codexRuntime, preview, merge, gitOperation };
  return c.json(response);
});

app.post("/api/approvals/:id/deny", (c) => {
  const approval = getApproval(c.req.param("id"));
  if (!approval) return c.json({ error: "approval_not_found" }, 404);
  if (approval.status !== "pending") return c.json({ error: "approval_already_resolved", approval: publicApproval(approval) }, 409);
  const resolved = resolveApproval(approval.id, "denied");
  if (!resolved) return c.json({ error: "approval_not_found" }, 404);
  if (approval.actionType === "room-run-merge") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { roomId?: unknown; runId?: unknown } : {};
    const roomId = String(payload.roomId ?? "");
    if (roomId) createRoomDecision(roomId, {
      title: "Merge approval denied",
      status: "rejected",
      payload: { approvalId: approval.id, runId: payload.runId ?? null },
      resolvedAt: new Date().toISOString(),
    });
  }
  if (approval.actionType === "preview-access") {
    const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { requestId?: unknown } : {};
    const request = previewAccessRequests.get(String(payload.requestId ?? ""));
    if (request) {
      request.status = "denied";
      request.updatedAt = new Date().toISOString();
      upsertPreviewAccessRequest(request);
    }
  }
  const response: ApprovalDecisionResponse = { approval: publicApproval(resolved) };
  return c.json(response);
});

app.get("/api/goals", (c) => {
  const ownerType = goalOwnerType(c.req.query("ownerType"));
  const ownerId = c.req.query("ownerId")?.trim();
  const status = c.req.query("status");
  const limit = parsePageLimit(c.req.query("limit"), 30);
  const rows = db.prepare(`
    select * from goals
    where (@ownerType is null or owner_type = @ownerType)
      and (@ownerId is null or owner_id = @ownerId)
      and (@status is null or status = @status)
    order by updated_at desc, id desc
    limit @limit
  `).all({ ownerType, ownerId: ownerId || null, status: status || null, limit }) as Array<Record<string, unknown>>;
  return c.json(rows.map(goalFromRow));
});

app.post("/api/goals", async (c) => {
  const body = await c.req.json<CreateGoalRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal" }, 400);
  try {
    const actor = goalActorFromRequest(c, body as unknown as Record<string, unknown>);
    if (actor.type === "agent") return c.json({ error: "goal_agent_must_propose" }, 403);
    return c.json(createGoal(body, actor.type, actor.agentId), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_create_failed";
    return c.json({ error: message }, message.endsWith("_not_found") ? 404 : 400);
  }
});

app.get("/api/goals/:id", (c) => {
  try {
    return c.json(goalDetail(c.req.param("id")));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "goal_not_found" }, 404);
  }
});

app.patch("/api/goals/:id", async (c) => {
  const body = await c.req.json<UpdateGoalRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal_update" }, 400);
  try {
    const actor = goalActorFromRequest(c, body as unknown as Record<string, unknown>);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(updateGoal(c.req.param("id"), body, actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_update_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.delete("/api/goals/:id", (c) => {
  try {
    const actor = goalActorFromRequest(c);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(updateGoal(c.req.param("id"), { status: "cancelled" }, actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_cancel_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.get("/api/goals/:id/events", (c) => {
  const rows = db.prepare("select * from goal_events where goal_id = ? order by created_at desc, id desc limit ?").all(c.req.param("id"), parsePageLimit(c.req.query("limit"), 80)) as Array<Record<string, unknown>>;
  return c.json(rows.map(goalEventFromRow));
});

app.post("/api/goals/:id/focuses", async (c) => {
  const body = await c.req.json<CreateGoalFocusRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal_focus" }, 400);
  try {
    const actor = goalActorFromRequest(c, body as unknown as Record<string, unknown>);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(createGoalFocus(c.req.param("id"), body, actor.type, actor.agentId), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_focus_create_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 400);
  }
});

app.patch("/api/goals/:id/focuses/:focusId", async (c) => {
  const body = await c.req.json<UpdateGoalFocusRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal_focus_update" }, 400);
  try {
    const actor = goalActorFromRequest(c, body as unknown as Record<string, unknown>);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(updateGoalFocus(c.req.param("id"), c.req.param("focusId"), body, actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_focus_update_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.get("/api/goals/:id/items", (c) => {
  const rows = db.prepare("select * from goal_items where goal_id = ? order by priority desc, updated_at desc, id desc").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(goalItemFromRow));
});

app.post("/api/goals/:id/items", async (c) => {
  const body = await c.req.json<CreateGoalItemRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal_item" }, 400);
  try {
    const actor = goalActorFromRequest(c, body as unknown as Record<string, unknown>);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(createGoalItem(c.req.param("id"), body, actor.type, actor.agentId), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_item_create_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 400);
  }
});

app.patch("/api/goals/:id/items/:itemId", async (c) => {
  const body = await c.req.json<UpdateGoalItemRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal_item_update" }, 400);
  try {
    const actor = goalActorFromRequest(c, body as unknown as Record<string, unknown>);
    assertCanUpdateGoalItem(c.req.param("id"), c.req.param("itemId"), actor);
    return c.json(updateGoalItem(c.req.param("id"), c.req.param("itemId"), body, actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_item_update_failed";
    return c.json({ error: message }, message === "goal_item_agent_not_assigned" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.delete("/api/goals/:id/items/:itemId", (c) => {
  try {
    const actor = goalActorFromRequest(c);
    assertCanUpdateGoalItem(c.req.param("id"), c.req.param("itemId"), actor);
    return c.json(updateGoalItem(c.req.param("id"), c.req.param("itemId"), { status: "cancelled" }, actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_item_cancel_failed";
    return c.json({ error: message }, message === "goal_item_agent_not_assigned" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.get("/api/goals/:id/proposals", (c) => {
  return c.json(listGoalProposals(c.req.param("id")));
});

app.post("/api/goals/:id/proposals", async (c) => {
  const body = await c.req.json<{ kind?: unknown; title?: unknown; payload?: unknown; proposedByAgentId?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: "invalid_goal_proposal" }, 400);
  try {
    const actor = goalActorFromRequest(c, body);
    return c.json(createGoalProposal(c.req.param("id"), body, actor.type === "agent" ? "agent" : "user", actor.agentId), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_proposal_create_failed";
    return c.json({ error: message }, message === "agent_actor_not_found" ? 403 : 400);
  }
});

app.post("/api/goals/:id/proposals/:proposalId/approve", (c) => {
  try {
    const actor = goalActorFromRequest(c);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(applyGoalProposal(c.req.param("id"), c.req.param("proposalId"), actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_proposal_approve_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.post("/api/goals/:id/proposals/:proposalId/reject", (c) => {
  try {
    const actor = goalActorFromRequest(c);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    return c.json(rejectGoalProposal(c.req.param("id"), c.req.param("proposalId"), actor.type, actor.agentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_proposal_reject_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
  }
});

app.post("/api/goals/:id/plan", (c) => {
  try {
    const actor = goalActorFromRequest(c);
    const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
    assertCanManageGoal(goal, actor);
    const items = createDefaultGoalPlan(c.req.param("id"), actor.type, actor.agentId);
    return c.json({ goal: goalFromRow(db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>), items }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_plan_failed";
    return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 400);
  }
});

app.post("/api/goals/:id/orchestrate", (c) => {
  const goalRow = db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!goalRow) return c.json({ error: "goal_not_found" }, 404);
  const goal = goalFromRow(goalRow);
  try {
    assertCanManageGoal(goal, goalActorFromRequest(c));
  } catch (error) {
    const message = error instanceof Error ? error.message : "goal_orchestrate_forbidden";
    return c.json({ error: message }, 403);
  }
  if (goal.ownerType !== "room") return c.json({ error: "goal_owner_not_room" }, 400);
  const room = db.prepare("select * from rooms where id = ?").get(goal.ownerId) as Record<string, unknown> | undefined;
  if (!room) return c.json({ error: "room_not_found" }, 404);
  let items = (db.prepare("select * from goal_items where goal_id = ? and room_task_id is null and status not in ('completed', 'cancelled') order by priority desc, updated_at asc").all(goal.id) as Array<Record<string, unknown>>).map(goalItemFromRow);
  if (!items.length) {
    items = [createGoalItem(goal.id, {
      title: goal.currentFocus?.text || goal.text.slice(0, 120),
      description: goal.currentFocus ? goal.text : null,
      status: "planned",
      assignedAgentId: goal.coordinatorAgentId ?? goal.managerAgentId ?? null,
      priority: 1,
    }, "system")];
  }
  const now = new Date().toISOString();
  const created: RoomTaskSummary[] = [];
  for (const item of items) {
    const assignedAgentId = item.assignedAgentId && db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(goal.ownerId, item.assignedAgentId)
      ? item.assignedAgentId
      : goal.coordinatorAgentId ?? goal.managerAgentId ?? null;
    const taskId = `room-task-${randomUUID()}`;
    db.prepare(`
      insert into room_tasks (id, room_id, goal_item_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?)
    `).run(
      taskId,
      goal.ownerId,
      item.id,
      item.title,
      [item.description, "", `Goal: ${goal.text}`, goal.currentFocus ? `Current focus: ${goal.currentFocus.text}` : ""].filter(Boolean).join("\n"),
      assignedAgentId ? "assigned" : "queued",
      assignedAgentId,
      item.priority,
      JSON.stringify({ source: "goal-orchestrated", goalId: goal.id, goalItemId: item.id }),
      now,
      now,
    );
    updateGoalItem(goal.id, item.id, { roomTaskId: taskId, status: "active", assignedAgentId }, "system");
    const task = roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(taskId) as Record<string, unknown>);
    created.push(task);
    roomEvent(goal.ownerId, "goal.task.created", { goalId: goal.id, goalItemId: item.id, taskId, title: item.title }, assignedAgentId);
  }
  recordGoalEvent(goal.id, "goal.orchestrated", { roomId: goal.ownerId, taskIds: created.map((task) => task.id) }, "system");
  if (created.length) orchestrateRoom(goal.ownerId, "goal.orchestrated");
  return c.json({ goal: goalFromRow(db.prepare("select * from goals where id = ?").get(goal.id) as Record<string, unknown>), tasks: created }, 201);
});

app.get("/api/previews", (c) => {
  const scopeType = c.req.query("scopeType");
  const scopeId = c.req.query("scopeId");
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const cursor = decodePageCursor(c.req.query("cursor"));
  const items = Array.from(previews.values()).map(publicPreview).filter((preview) => {
    if (scopeType && preview.scopeType !== scopeType) return false;
    if (scopeId && preview.scopeId !== scopeId) return false;
    if (status && preview.status !== status) return false;
    if (q && ![preview.label, preview.scopeType, preview.scopeId, preview.targetHost, String(preview.port), preview.command, preview.cwd, preview.access].some((value) => value?.toLowerCase().includes(q))) return false;
    if (cursor && !(preview.updatedAt < cursor.sortValue || (preview.updatedAt === cursor.sortValue && preview.id < cursor.id))) return false;
    return true;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  if (!c.req.query("limit") && !c.req.query("cursor") && !q && !status) return c.json(items);
  return c.json(pageFromRows(items.slice(0, parsePageLimit(c.req.query("limit"), 20) + 1), parsePageLimit(c.req.query("limit"), 20), (item) => item.updatedAt));
});

app.post("/api/previews", async (c) => {
  const body = await c.req.json<CreatePreviewRequest>().catch(() => null);
  if (!body || (body.scopeType !== "project" && body.scopeType !== "session" && body.scopeType !== "folder")) return c.json({ error: "invalid_scope" }, 400);
  if (!body.scopeId?.trim()) return c.json({ error: "invalid_scope" }, 400);
  const folderScopePath = body.scopeType === "folder" ? resolve(body.scopeId) : "";
  const scopeExists = body.scopeType === "project"
    ? appData.projects.some((project) => project.id === body.scopeId)
    : body.scopeType === "folder"
      ? existsSync(folderScopePath) && statSync(folderScopePath).isDirectory()
      : appData.sessions.some((session) => session.id === body.scopeId);
  if (!scopeExists) return c.json({ error: "scope_not_found" }, 404);
  const port = Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return c.json({ error: "invalid_port" }, 400);
  const targetHost = body.targetHost?.trim() || "127.0.0.1";
  if (!validPreviewHost(targetHost)) return c.json({ error: "invalid_target_host" }, 400);
  const requestedCommand = body.command?.trim() || undefined;
  const requestedCwd = body.cwd?.trim() || undefined;
  const requestedAccess = previewAccess(body.access);
  const existing = Array.from(previews.values()).find((preview) =>
    preview.scopeType === body.scopeType
    && preview.scopeId === body.scopeId
    && preview.targetHost === targetHost
    && preview.port === port
  );
  if (existing) {
    if (requestedCommand && existing.command && existing.command !== requestedCommand) {
      return c.json({ error: "preview_port_in_use", preview: publicPreview(existing) }, 409);
    }
    if (requestedCommand && !existing.command) {
      existing.command = requestedCommand;
      existing.cwd = requestedCwd;
      updatePreview(existing);
    }
    if (existing.access !== requestedAccess) {
      existing.access = requestedAccess;
      updatePreview(existing);
    }
    if (body.autoStart && existing.command && existing.status !== "running" && existing.status !== "starting") {
      const risk = previewCommandRisk(existing);
      if (risk && !approvalAlwaysAllowed("preview-command-run", { previewId: existing.id, command: existing.command ?? "", cwd: existing.cwd ?? "", targetHost: existing.targetHost, port: existing.port, scopeType: existing.scopeType, scopeId: existing.scopeId })) {
        const approval = createPreviewApproval(existing, risk);
        return c.json({ error: "approval_required", approval: publicApproval(approval), preview: publicPreview(existing) }, 409);
      }
      try {
        startPreviewProcess(existing);
      } catch {
        existing.status = "error";
        updatePreview(existing);
        return c.json({ error: "preview_start_failed", preview: publicPreview(existing) }, 400);
      }
    }
    return c.json(publicPreview(existing));
  }
  const conflict = previewUsingPort({ id: "", targetHost, port });
  if (conflict) return c.json({ error: "preview_port_in_use", preview: publicPreview(conflict) }, 409);
  const now = new Date().toISOString();
  const preview: PreviewRecord = {
    id: randomUUID(),
    scopeType: body.scopeType,
    scopeId: body.scopeId,
    label: body.label?.trim() || `${body.scopeType}:${body.scopeId}:${port}`,
    targetHost,
    port,
    command: requestedCommand,
    cwd: requestedCwd,
    status: "registered",
    access: requestedAccess,
    token: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  insertPreview(preview);
  if (body.autoStart && preview.command) {
    const risk = previewCommandRisk(preview);
    if (risk && !approvalAlwaysAllowed("preview-command-run", { previewId: preview.id, command: preview.command ?? "", cwd: preview.cwd ?? "", targetHost: preview.targetHost, port: preview.port, scopeType: preview.scopeType, scopeId: preview.scopeId })) {
      const approval = createPreviewApproval(preview, risk);
      return c.json({ error: "approval_required", approval: publicApproval(approval), preview: publicPreview(preview) }, 409);
    }
    try {
      startPreviewProcess(preview);
    } catch (error) {
      preview.status = "error";
      updatePreview(preview);
      return c.json({ error: error instanceof Error ? error.message : "preview_start_failed", preview: publicPreview(preview) }, 400);
    }
  }
  return c.json(publicPreview(preview), 201);
});

app.post("/api/previews/:id/start", (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.json({ error: "preview_not_found" }, 404);
  if (preview.status === "running" || preview.status === "starting") return c.json(publicPreview(preview));
  const risk = previewCommandRisk(preview);
  if (risk && !approvalAlwaysAllowed("preview-command-run", { previewId: preview.id, command: preview.command ?? "", cwd: preview.cwd ?? "", targetHost: preview.targetHost, port: preview.port, scopeType: preview.scopeType, scopeId: preview.scopeId })) {
    const approval = createPreviewApproval(preview, risk);
    return c.json({ error: "approval_required", approval: publicApproval(approval), preview: publicPreview(preview) }, 409);
  }
  try {
    startPreviewProcess(preview);
  } catch (error) {
    preview.status = "error";
    updatePreview(preview);
    return c.json({ error: error instanceof Error ? error.message : "preview_start_failed", preview: publicPreview(preview) }, 400);
  }
  return c.json(publicPreview(preview));
});

app.post("/api/previews/:id/access", (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.json({ error: "preview_not_found" }, 404);
  if (preview.access === "private") c.header("set-cookie", previewAccessCookie(preview));
  return c.json({ url: previewUrl(preview), preview: publicPreview(preview) });
});

app.put("/api/previews/:id/access", async (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.json({ error: "preview_not_found" }, 404);
  const body = await c.req.json<{ access?: PreviewAccess }>().catch(() => null);
  preview.access = previewAccess(body?.access);
  updatePreview(preview);
  return c.json(publicPreview(preview));
});

app.get("/api/previews/:id/logs", (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.json({ error: "preview_not_found" }, 404);
  return c.json({ previewId: preview.id, logs: previewLogs.get(preview.id) ?? "" });
});

app.post("/api/previews/:id/stop", (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.json({ error: "preview_not_found" }, 404);
  stopPreviewProcess(preview.id);
  preview.status = "stopped";
  updatePreview(preview);
  return c.json(publicPreview(preview));
});

app.delete("/api/previews/:id", (c) => {
  const preview = previews.get(c.req.param("id"));
  if (!preview) return c.json({ error: "preview_not_found" }, 404);
  deletePreview(preview.id);
  return c.json({ ok: true });
});

app.get("/api/sessions", (c) => {
  const limitQuery = c.req.query("limit");
  const includeAgentChildren = c.req.query("includeAgentChildren") === "true" || c.req.query("includeAgentChildren") === "1";
  const visibleSessions = includeAgentChildren ? appData.sessions : appData.sessions.filter((session) => !(session.conversationType === "agent" && session.roomId));
  if (!limitQuery && !c.req.query("cursor") && !c.req.query("q") && !c.req.query("projectId") && !c.req.query("status")) return c.json(visibleSessions);
  const limit = parsePageLimit(limitQuery, 30);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const filtered = visibleSessions
    .filter((session) => !q || session.title.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q) || session.id.toLowerCase().includes(q))
    .filter((session) => !projectId || (projectId === "scratch" ? !session.projectId : session.projectId === projectId))
    .filter((session) => !status || session.status === status)
    .filter((session) => !cursor || session.updatedAt < cursor.sortValue || (session.updatedAt === cursor.sortValue && session.id < cursor.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
});
app.get("/api/sessions/:id", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  return c.json(session);
});
app.post("/api/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();
  const requestedProjectId = body.projectId && body.projectId !== "scratch" ? body.projectId : null;
  const project = requestedProjectId ? appData.projects.find((item) => item.id === requestedProjectId) : null;
  if (requestedProjectId && !project) return c.json({ error: "project_not_found" }, 404);
  const id = `task-${randomUUID()}`;
  const session: SessionSummary = {
    id,
    kind: project ? "project" : "scratch",
    conversationType: conversationType(body.conversationType),
    roomId: body.roomId ?? null,
    title: body.title,
    projectId: project?.id ?? null,
    workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id),
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  appData.sessions.unshift(session);
  if (body.goal?.text?.trim()) {
    const ownerType: GoalOwnerType = session.conversationType === "agent" ? "agent_session" : "session";
    session.goal = createGoal({ ...body.goal, ownerType, ownerId: session.id }, "user");
  }
  saveAppData();
  return c.json(session, 201);
});
app.patch("/api/sessions/:id", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  const body = await c.req.json<UpdateSessionRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_session_update" }, 400);
  if (body.title !== undefined) session.title = body.title.trim() || session.title;
  if (body.notificationsEnabled !== undefined) session.notificationsEnabled = body.notificationsEnabled !== false;
  session.updatedAt = new Date().toISOString();
  upsertSession(session);
  return c.json(session);
});
app.delete("/api/sessions/:id", (c) => {
  const index = appData.sessions.findIndex((item) => item.id === c.req.param("id"));
  if (index === -1) return c.json({ error: "session_not_found" }, 404);
  const [session] = appData.sessions.splice(index, 1);
  const deleteWorkspace = c.req.query("deleteWorkspace") === "true";
  const deleteLogs = c.req.query("deleteLogs") === "true";
  clearCodexTaskRuntime(session.id, true);
  if (session.roomId) {
    const childSessions = appData.sessions.filter((item) => item.conversationType === "agent" && item.roomId === session.roomId);
    for (const childSession of childSessions) {
      clearCodexTaskRuntime(childSession.id, true);
      deleteSessionDatabaseRows(childSession.id);
      deleteSessionData(childSession, deleteWorkspace, deleteLogs);
    }
    appData.sessions = appData.sessions.filter((item) => !(item.conversationType === "agent" && item.roomId === session.roomId));
    deleteRoomDatabaseRows(session.roomId);
  }
  deleteSessionDatabaseRows(session.id);
  deleteSessionData(session, deleteWorkspace, deleteLogs);
  return c.json({ ok: true, id: session.id });
});

app.post("/api/codex/tasks", async (c) => {
  const body = await c.req.json<CreateCodexTaskRequest>().catch(() => null);
  if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
  const project = body.projectId ? appData.projects.find((item) => item.id === body.projectId) : null;
  const providerId = body.providerId ?? null;
  const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
  const selectedModel = body.model ?? provider?.defaultModel ?? null;
  const id = `task-${randomUUID()}`;
  const workspacePath = body.cwd
    ? resolveTerminalCwd(body.cwd)
    : project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id);
  const cwd = workspacePath;
  const session: SessionSummary = {
    id,
    kind: project ? "project" : "scratch",
    conversationType: "codex",
    roomId: null,
    title: body.prompt.trim().slice(0, 60),
    projectId: project?.id ?? null,
    workspacePath,
    providerId: provider?.id ?? null,
    model: selectedModel,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  appData.sessions.unshift(session);
  deleteSessionMessages(session.id);
  let attachments: SavedSessionAttachment[] = [];
  try {
    attachments = saveSessionAttachments(session.id, body.attachments);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "attachment_upload_failed" }, 400);
  }
  const userMessage = appendSessionMessage(session.id, "user", messageWithAttachments(body.prompt, attachments));
  for (const notificationRule of body.ephemeralNotifications ?? []) {
    createNotificationEphemeralRule({
      scopeType: "session",
      scopeId: session.id,
      eventTypes: notificationRule.eventTypes,
      targets: notificationRule.targets,
      expireMode: notificationRule.expireMode,
    });
  }
  saveAppData();
  startCodexTask(session, promptWithAttachments(body.prompt, attachments), cwd, provider, selectedModel, true, attachments.length ? [sessionAttachmentsPath(session.id)] : [], { currentMessageId: userMessage.id });
  return c.json(session, 201);
});
app.get("/api/codex/tasks/:id", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  restoreCodexSessionIdFromLog(session);
  if (session.status !== "running") backfillSessionFromTaskLog(session);
  const output = readCodexOutput(session.id);
  const response: CodexTaskDetail = {
    session,
    messages: allSessionMessages(session.id),
    output: output.output,
    exitCode: output.exitCode,
    errorSummary: output.exitCode && output.exitCode !== 0 ? readTaskErrorSummary(session.id) : undefined,
  };
  return c.json(response);
});
app.get("/api/codex/tasks/:id/log", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const maxBytes = Math.min(Number(c.req.query("maxBytes") ?? 80_000), 300_000);
  let log = "";
  try {
    const content = session.conversationType === "room" ? readRoomTaskLogContent(session, maxBytes) : readTaskLogContent(session.id);
    log = content.length > maxBytes ? content.slice(content.length - maxBytes) : content;
  } catch {
    log = "";
  }
  const response: TaskLogResponse = { sessionId: session.id, log };
  return c.json(response);
});
app.get("/api/codex/tasks/:id/context", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  if (session.conversationType === "room") return c.json(listRoomTaskContextFiles(session));
  return c.json(listTaskContextFiles(session.id));
});
app.get("/api/codex/tasks/:id/context/:file", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  try {
    if (session.conversationType === "room") return c.json(readRoomTaskContextFile(session, c.req.param("file")));
    return c.json(readTaskContextFile(session.id, c.req.param("file")));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "context_file_not_found" }, 404);
  }
});
app.get("/api/codex/tasks/:id/activity", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  if (!listTaskActivities(session.id, 1).items.length) backfillTaskActivitiesFromLog(session.id);
  if (!listTaskActivities(session.id, 1).items.length) backfillRoomActivitiesFromAgentLogs(session);
  const page = listTaskActivities(session.id, parsePageLimit(c.req.query("limit"), 30), c.req.query("cursor"));
  const response: TaskActivityResponse = {
    sessionId: session.id,
    items: page.items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
  return c.json(response);
});
app.get("/api/codex/tasks/:id/runs", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  return c.json(listTaskRunsForSession(session.id, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor")));
});
app.get("/api/task-runs", (c) => {
  const status = c.req.query("status");
  return c.json(listTaskRuns(status, parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor")));
});
app.get("/api/execution-contexts", (c) => {
  const sessionId = c.req.query("sessionId");
  const agentId = c.req.query("agentId");
  const limit = parsePageLimit(c.req.query("limit"), 50);
  const session = sessionId ? appData.sessions.find((item) => item.id === sessionId) : null;
  const rows = db.prepare(`
    select * from execution_contexts
    where (
        @sessionId is null
        or session_id = @sessionId
        or (@roomId is not null and room_id = @roomId)
      )
      and (@agentId is null or agent_id = @agentId)
    order by created_at desc, id desc
    limit @limit
  `).all({ sessionId: sessionId || null, roomId: session?.conversationType === "room" ? session.roomId : null, agentId: agentId || null, limit }) as Array<Record<string, unknown>>;
  return c.json(rows.map(executionContextFromRow));
});
app.get("/api/sessions/:id/messages", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  if (session.status !== "running") backfillSessionFromTaskLog(session);
  return c.json(listSessionMessages(session.id, Number(c.req.query("limit") ?? 20), c.req.query("before") || undefined));
});
app.get("/api/sessions/:id/compaction", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  const latest = latestSessionCompaction(session.id);
  if (!latest) return c.json({ compaction: null, summary: "" });
  const summary = existsSync(latest.filePath) ? readFileSync(latest.filePath, "utf8") : "";
  return c.json({ compaction: latest, summary });
});
app.get("/api/sessions/:id/compactions", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  return c.json(listSessionCompactions(session.id, Number(c.req.query("limit") ?? 20)));
});
app.patch("/api/sessions/:id/compaction", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  const body = await c.req.json<UpdateSessionCompactionRequest>().catch(() => null);
  try {
    return c.json(updateLatestSessionCompaction(session, String(body?.summary ?? "")));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "session_compaction_update_failed" }, 400);
  }
});
app.post("/api/sessions/:id/compactions/:compactionId/restore", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  try {
    return c.json(restoreSessionCompaction(session, c.req.param("compactionId")));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "session_compaction_restore_failed" }, 400);
  }
});
app.post("/api/sessions/:id/compact", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  const body = await c.req.json<CreateSessionCompactionRequest>().catch(() => null);
  try {
    return c.json(await createSessionCompaction(session, body));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "session_compaction_failed" }, 400);
  }
});
app.get("/api/sessions/:id/cards", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  return c.json(listSessionCards(session.id));
});
app.delete("/api/sessions/:id/cards/:cardId", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "session_not_found" }, 404);
  const cardId = c.req.param("cardId");
  if (cardId.startsWith("preview:")) {
    const previewId = cardId.slice("preview:".length);
    const preview = previews.get(previewId);
    if (!preview || preview.scopeType !== "session" || preview.scopeId !== session.id) return c.json({ error: "card_not_found" }, 404);
    dismissMessageCard(session.id, "preview", publicPreview(preview));
    deletePreview(previewId);
    db.prepare("delete from message_cards where session_id = ? and json_extract(payload, '$.previewId') = ?").run(session.id, previewId);
    return c.json({ ok: true, id: cardId });
  }
  const cardRow = db.prepare(`
    select type, payload
    from message_cards
    where id = ? and session_id = ?
  `).get(cardId, session.id) as { type: MessageCardSummary["type"]; payload: string } | undefined;
  if (!cardRow) return c.json({ error: "card_not_found" }, 404);
  let payload: unknown = {};
  try {
    payload = JSON.parse(cardRow.payload);
  } catch {
    payload = {};
  }
  dismissMessageCard(session.id, cardRow.type, payload);
  const result = db.prepare("delete from message_cards where id = ? and session_id = ?").run(cardId, session.id);
  if (!result.changes) return c.json({ error: "card_not_found" }, 404);
  return c.json({ ok: true, id: cardId });
});
app.get("/api/codex/tasks/:id/queue", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  return c.json(listQueuedMessages(session.id));
});
app.post("/api/codex/tasks/:id/queue", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<QueueMessageRequest>().catch(() => null);
  if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
  return c.json(enqueueMessage(session, body), 201);
});
app.patch("/api/codex/tasks/:id/queue/:queueId", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<UpdateQueuedMessageRequest>().catch(() => null);
  if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
  const item = updateQueuedMessage(session, c.req.param("queueId"), body);
  if (!item) return c.json({ error: "queued_message_not_found" }, 404);
  return c.json(item);
});
app.patch("/api/codex/tasks/:id/queue", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<ReorderQueuedMessagesRequest>().catch(() => null);
  if (!Array.isArray(body?.orderedIds)) return c.json({ error: "ordered_ids_required" }, 400);
  const queue = reorderQueuedMessages(session, body.orderedIds);
  if (!queue) return c.json({ error: "queued_message_order_mismatch" }, 409);
  return c.json(queue);
});
app.delete("/api/codex/tasks/:id/queue/:queueId", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  deleteQueuedMessage(session, c.req.param("queueId"));
  return c.json({ ok: true });
});
app.get("/api/codex/tasks/:id/diff", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const cwd = resolveSessionCwd(session);
  const status = await runGitCommand(cwd, ["status", "--short", "--", "."]);
  if (status.exitCode !== 0) {
    const response: CodexTaskDiff = { ok: false, cwd, status: "", stat: "", diff: "", error: status.stderr || "git_status_failed" };
    return c.json(response);
  }
  const stat = await runGitCommand(cwd, ["diff", "--relative", "--stat", "--", "."]);
  const diff = await runGitCommand(cwd, ["diff", "--", "."]);
  const response: CodexTaskDiff = {
    ok: true,
    cwd,
    status: status.stdout,
    stat: stat.stdout,
    diff: diff.stdout,
    error: stat.exitCode === 0 && diff.exitCode === 0 ? undefined : stat.stderr || diff.stderr || "git_diff_failed",
  };
  return c.json(response);
});
app.get("/api/codex/tasks/:id/changes", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  return c.json(await collectWorkspaceChanges(session));
});
app.post("/api/codex/tasks/:id/changes/revert-file", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<RevertWorkspaceFileRequest>().catch(() => null);
  if (!body?.path) return c.json({ error: "path_required" }, 400);
  try {
    const cwd = resolveWorkspaceChangeActionCwd(session, body.cwd);
    const changes = await collectWorkspaceChangesForCwd(cwd);
    const { change, absolutePath } = assertWorkspaceChangePath(changes, body.path);
    if (change.status === "??") {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) return c.json({ error: "untracked_directories_not_supported" }, 400);
      rmSync(absolutePath);
    } else {
      const result = await runGitCommand(changes.cwd, ["checkout", "--", body.path]);
      if (result.exitCode !== 0) return c.json({ error: result.stderr || "git_checkout_failed" }, 400);
    }
    return c.json(await collectWorkspaceChanges(session));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "revert_failed" }, 400);
  }
});
app.post("/api/codex/tasks/:id/changes/stage-file", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
  if (!body?.path) return c.json({ error: "path_required" }, 400);
  try {
    await applyWorkspaceGitFileAction(resolveWorkspaceChangeActionCwd(session, body.cwd), body.path, "stage");
    return c.json(await collectWorkspaceChanges(session));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git_stage_failed" }, 400);
  }
});
app.post("/api/codex/tasks/:id/changes/unstage-file", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
  if (!body?.path) return c.json({ error: "path_required" }, 400);
  try {
    await applyWorkspaceGitFileAction(resolveWorkspaceChangeActionCwd(session, body.cwd), body.path, "unstage");
    return c.json(await collectWorkspaceChanges(session));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git_unstage_failed" }, 400);
  }
});
app.post("/api/codex/tasks/:id/stop", (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const child = codexTaskProcesses.get(session.id);
  const running = latestRunningTaskRun(session.id);
  const runnerPid = typeof running?.pid === "number" ? running.pid : null;
  if (!child && !isProcessAlive(runnerPid)) {
    session.status = session.status === "running" ? "paused" : session.status;
    session.updatedAt = new Date().toISOString();
    saveAppData();
    return c.json(session);
  }
  codexTaskStopRequested.add(session.id);
  markTaskRunStopRequested(session.id);
  if (child) child.kill("SIGTERM");
  else if (runnerPid) process.kill(runnerPid, "SIGTERM");
  session.status = "paused";
  session.updatedAt = new Date().toISOString();
  saveAppData();
  appendCodexErrorOutput(session, "\n[task stopped]\n");
  appendSessionMessage(session.id, "assistant", `用户主动停止任务。停止时间：${new Date().toISOString()}。待发送队列：${listQueuedMessages(session.id).length} 条。`);
  return c.json(session);
});
app.post("/api/codex/tasks/:id/recover", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  if (codexTaskProcesses.has(session.id) || session.status === "running") return c.json({ error: "task_running" }, 409);
  restoreCodexSessionIdFromLog(session);
  const body = await c.req.json<RecoverCodexTaskRequest>().catch(() => null);
  const prompt = body?.prompt?.trim() || "Recover the interrupted task from the current conversation, task log, workspace files, and Git changes. Summarize completed and pending work first, then continue with the next concrete step.";
  const providerId = body?.providerId ?? session.providerId ?? null;
  const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
  const selectedModel = body?.model ?? session.model ?? provider?.defaultModel ?? null;
  session.providerId = provider?.id ?? null;
  session.model = selectedModel;
  session.status = "running";
  session.updatedAt = new Date().toISOString();
  const userMessage = appendSessionMessage(session.id, "user", prompt);
  saveAppData();
  startCodexTask(session, prompt, resolveSessionCwd(session), provider, selectedModel, false, [], { currentMessageId: userMessage.id });
  const response: CodexTaskDetail = {
    session,
    messages: allSessionMessages(session.id),
    output: readCodexOutput(session.id).output,
    exitCode: null,
  };
  return c.json(response, 202);
});
app.post("/api/codex/tasks/:id/messages", async (c) => {
  const session = appData.sessions.find((item) => item.id === c.req.param("id"));
  if (!session) return c.json({ error: "task_not_found" }, 404);
  const body = await c.req.json<ContinueCodexTaskRequest>().catch(() => null);
  if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
  restoreCodexSessionIdFromLog(session);
  if (codexTaskProcesses.has(session.id) || session.status === "running") {
    if (body.attachments?.length) return c.json({ error: "attachments_cannot_queue" }, 409);
    return c.json(enqueueMessage(session, body), 202);
  }
  const providerId = body.providerId ?? session.providerId ?? null;
  const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
  const selectedModel = body.model ?? session.model ?? provider?.defaultModel ?? null;
  const cwd = resolveSessionCwd(session);
  session.providerId = provider?.id ?? null;
  session.model = selectedModel;
  session.status = "running";
  session.updatedAt = new Date().toISOString();
  let attachments: SavedSessionAttachment[] = [];
  try {
    attachments = saveSessionAttachments(session.id, body.attachments);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "attachment_upload_failed" }, 400);
  }
  const userMessage = appendSessionMessage(session.id, "user", messageWithAttachments(body.prompt, attachments), body.replyToMessageId);
  saveAppData();
  const prompt = promptWithReplyContext(session.id, promptWithAttachments(body.prompt, attachments), body.replyToMessageId);
  startCodexTask(session, promptForDirectAgentSession(session, prompt), cwd, provider, selectedModel, !session.codexSessionId, attachments.length ? [sessionAttachmentsPath(session.id)] : [], {
    currentMessageId: userMessage.id,
    replyToMessageId: body.replyToMessageId,
  });
  return c.json(session);
});

app.get("/api/projects", async (c) => {
  const limitQuery = c.req.query("limit");
  if (!limitQuery && !c.req.query("cursor") && !c.req.query("q")) {
    const projects = await Promise.all(appData.projects.map((project) => refreshProjectGitStatus(project)));
    return c.json(projects);
  }
  const limit = parsePageLimit(limitQuery, 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const filtered = appData.projects
    .filter((project) => !q || project.name.toLowerCase().includes(q) || project.workspacePath.toLowerCase().includes(q) || project.id.toLowerCase().includes(q))
    .filter((project) => !cursor || project.name > cursor.sortValue || (project.name === cursor.sortValue && project.id > cursor.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const pageItems = filtered.slice(0, limit + 1);
  await Promise.all(pageItems.slice(0, limit).map((project) => refreshProjectGitStatus(project)));
  return c.json(pageFromRows(pageItems, limit, (item) => item.name));
});
app.post("/api/projects", async (c) => {
  const body = await c.req.json<CreateProjectRequest>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "invalid_project_name" }, 400);
  const id = uniqueProjectId(name);
  const workspacePath = body.workspacePath?.trim()
    ? resolveTerminalCwd(body.workspacePath)
    : defaultProjectWorkspacePath(id);
  if (!body.workspacePath?.trim()) mkdirSync(workspacePath, { recursive: true });
  const project: ProjectSummary = { id, name, workspacePath, runner: "docker", changedFiles: 0, checkCommand: undefined };
  await ensureGitRepositoryForProject(project.workspacePath);
  writeProjectWorkspaceMetadata(project);
  await refreshProjectGitStatus(project);
  appData.projects.unshift(project);
  saveAppData();
  return c.json(project, 201);
});
app.patch("/api/projects/:id", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json<UpdateProjectRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_project_update" }, 400);
  if (body.name !== undefined) project.name = body.name.trim() || project.name;
  if (body.workspacePath !== undefined) project.workspacePath = body.workspacePath.trim() || project.workspacePath;
  if (body.checkCommand !== undefined) project.checkCommand = body.checkCommand.trim() || undefined;
  writeProjectWorkspaceMetadata(project);
  upsertProject(project);
  return c.json(await refreshProjectGitStatus(project));
});
app.get("/api/projects/:id/changes", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    return c.json(await collectWorkspaceChangesForCwd(resolveTerminalCwd(project.workspacePath)));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "project_changes_failed" }, 400);
  }
});
app.post("/api/projects/:id/changes/revert-file", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json<RevertWorkspaceFileRequest>().catch(() => null);
  if (!body?.path) return c.json({ error: "path_required" }, 400);
  const cwd = resolveTerminalCwd(project.workspacePath);
  const changes = await collectWorkspaceChangesForCwd(cwd);
  try {
    const { change, absolutePath } = assertWorkspaceChangePath(changes, body.path);
    if (change.status === "??") {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) return c.json({ error: "untracked_directories_not_supported" }, 400);
      rmSync(absolutePath);
    } else {
      const result = await runGitCommand(cwd, ["checkout", "--", body.path]);
      if (result.exitCode !== 0) return c.json({ error: result.stderr || "git_checkout_failed" }, 400);
    }
    return c.json(await collectWorkspaceChangesForCwd(cwd));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "revert_failed" }, 400);
  }
});
app.post("/api/projects/:id/changes/stage-file", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
  if (!body?.path) return c.json({ error: "path_required" }, 400);
  try {
    return c.json(await applyWorkspaceGitFileAction(resolveTerminalCwd(project.workspacePath), body.path, "stage"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git_stage_failed" }, 400);
  }
});
app.post("/api/projects/:id/changes/unstage-file", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
  if (!body?.path) return c.json({ error: "path_required" }, 400);
  try {
    return c.json(await applyWorkspaceGitFileAction(resolveTerminalCwd(project.workspacePath), body.path, "unstage"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "git_unstage_failed" }, 400);
  }
});
app.get("/api/projects/:id/check-runs", (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  return c.json(listProjectCheckRuns(project.id, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor")));
});
app.get("/api/projects/:id/git-operations", (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  return c.json(listProjectGitOperations(project.id, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor")));
});
app.post("/api/projects/:id/git", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json<ProjectGitOperationRequest>().catch(() => null);
  if (!body?.operation) return c.json({ error: "git_operation_required" }, 400);
  try {
    const args = projectGitArgs(body);
    const changes = await collectWorkspaceChangesForCwd(resolveTerminalCwd(project.workspacePath)).catch(() => null);
    const dirty = Boolean(changes?.summary.filesChanged);
    const needsApproval = body.operation === "push" || ((body.operation === "pull" || body.operation === "branch-checkout") && dirty);
    if (needsApproval && !approvalAlwaysAllowed("project-git-operation", { projectId: project.id, operation: body.operation })) {
      const reason = body.operation === "push" ? "push changes to remote" : "workspace has uncommitted changes";
      const approval = createProjectGitApproval(project, body.operation, args, reason);
      saveProjectGitOperation(project.id, body.operation, args, { exitCode: null, stdout: "", stderr: `approval:${approval.id}` }, "approval_required");
      return c.json({ error: "approval_required", approval: publicApproval(approval) }, 409);
    }
    const record = runProjectGitOperation(project, body.operation, args);
    await refreshProjectGitStatus(project);
    return c.json(record, record.status === "done" ? 200 : 400);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "project_git_failed" }, 400);
  }
});
app.get("/api/projects/:id/sessions", (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const filtered = appData.sessions
    .filter((session) => session.projectId === project.id)
    .filter((session) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
    .filter((session) => !status || session.status === status)
    .filter((session) => !cursor || session.updatedAt < cursor.sortValue || (session.updatedAt === cursor.sortValue && session.id < cursor.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
});
app.get("/api/projects/:id/stats", (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const projectSessions = appData.sessions.filter((session) => session.projectId === project.id);
  const latestCheck = listProjectCheckRuns(project.id, 1).items[0];
  const previewStatusCounts = Array.from(previews.values())
    .filter((preview) => preview.scopeType === "project" && preview.scopeId === project.id)
    .reduce<Record<string, number>>((counts, preview) => {
      counts[preview.status] = (counts[preview.status] ?? 0) + 1;
      return counts;
    }, {});
  const response: ProjectStatsSummary = {
    projectId: project.id,
    totalSessions: projectSessions.length,
    runningSessions: projectSessions.filter((session) => session.status === "running").length,
    latestSessionUpdatedAt: projectSessions.map((session) => session.updatedAt).sort().at(-1) ?? null,
    latestCheckStatus: latestCheck?.status ?? null,
    previewStatusCounts,
  };
  return c.json(response);
});
app.post("/api/projects/:id/check", async (c) => {
  const project = appData.projects.find((item) => item.id === c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json<{ command?: string }>().catch(() => null);
  const command = body?.command?.trim() || splitProjectCheckCommands(project.checkCommand)[0];
  if (!command) return c.json({ error: "check_command_missing" }, 400);
  try {
    const startedAt = new Date().toISOString();
    const result = await runShellCommand(command, resolveTerminalCwd(project.workspacePath));
    saveProjectCheckRun(project.id, result, startedAt);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "project_check_failed" }, 400);
  }
});
app.delete("/api/projects/:id", async (c) => {
  const index = appData.projects.findIndex((item) => item.id === c.req.param("id"));
  if (index === -1) return c.json({ error: "project_not_found" }, 404);

  const deleteFiles = c.req.query("deleteFiles") === "true";
  const project = appData.projects[index];
  if (deleteFiles) {
    if (approvalAlwaysAllowed("project-delete-files", { projectId: project.id, deleteFiles: true })) {
      return c.json(deleteProjectRecord(project.id, true));
    }
    const approval = createProjectDeleteApproval(project);
    return c.json({ error: "approval_required", approval: publicApproval(approval) }, 409);
  }

  return c.json(deleteProjectRecord(project.id, false));
});

app.get("/api/automations", (c) => {
  const limitQuery = c.req.query("limit");
  if (!limitQuery && !c.req.query("cursor") && !c.req.query("q") && !c.req.query("status") && !c.req.query("projectId")) {
    return c.json(appData.automations);
  }
  const limit = parsePageLimit(limitQuery, 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const filtered = appData.automations
    .filter((automation) => !q || automation.name.toLowerCase().includes(q) || automation.prompt.toLowerCase().includes(q) || automation.id.toLowerCase().includes(q))
    .filter((automation) => !status || automation.status === status)
    .filter((automation) => !projectId || (projectId === "global" ? !automation.projectId : automation.projectId === projectId))
    .filter((automation) => !cursor || automation.updatedAt < cursor.sortValue || (automation.updatedAt === cursor.sortValue && automation.id < cursor.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
});
app.post("/api/automations", async (c) => {
  const body = await c.req.json<CreateAutomationRequest>().catch(() => null);
  if (!body?.name?.trim() || !body.prompt?.trim() || !body.schedule?.trim()) return c.json({ error: "invalid_automation" }, 400);
  if (!isValidAutomationSchedule(body.schedule)) return c.json({ error: "invalid_automation_schedule" }, 400);
  const project = body.projectId ? appData.projects.find((item) => item.id === body.projectId) : null;
  const provider = body.providerId ? appData.providers.find((item) => item.id === body.providerId) : null;
  const now = new Date().toISOString();
  const automation: AutomationSummary = {
    id: `automation-${randomUUID()}`,
    name: body.name.trim(),
    projectId: project?.id ?? null,
    providerId: provider?.id ?? null,
    model: body.model?.trim() || null,
    prompt: body.prompt.trim(),
    schedule: body.schedule.trim(),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  appData.automations.unshift(automation);
  upsertAutomation(automation);
  return c.json(automation, 201);
});
app.patch("/api/automations/:id", async (c) => {
  const automation = appData.automations.find((item) => item.id === c.req.param("id"));
  if (!automation) return c.json({ error: "automation_not_found" }, 404);
  const body = await c.req.json<UpdateAutomationRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_automation_update" }, 400);
  if (body.name !== undefined) automation.name = body.name.trim() || automation.name;
  if (body.projectId !== undefined) automation.projectId = appData.projects.find((item) => item.id === body.projectId)?.id ?? null;
  if (body.providerId !== undefined) automation.providerId = appData.providers.find((item) => item.id === body.providerId)?.id ?? null;
  if (body.model !== undefined) automation.model = body.model?.trim() || null;
  if (body.prompt !== undefined) automation.prompt = body.prompt.trim() || automation.prompt;
  if (body.schedule !== undefined) {
    if (!isValidAutomationSchedule(body.schedule)) return c.json({ error: "invalid_automation_schedule" }, 400);
    automation.schedule = body.schedule.trim() || automation.schedule;
  }
  if (body.status !== undefined) automation.status = body.status;
  automation.updatedAt = new Date().toISOString();
  upsertAutomation(automation);
  return c.json(automation);
});
app.delete("/api/automations/:id", (c) => {
  const index = appData.automations.findIndex((item) => item.id === c.req.param("id"));
  if (index === -1) return c.json({ error: "automation_not_found" }, 404);
  const [automation] = appData.automations.splice(index, 1);
  db.prepare("delete from automations where id = ?").run(automation.id);
  db.prepare("delete from automation_runs where automation_id = ?").run(automation.id);
  return c.json({ ok: true, id: automation.id });
});
app.get("/api/automations/:id/runs", (c) => {
  const automation = appData.automations.find((item) => item.id === c.req.param("id"));
  if (!automation) return c.json({ error: "automation_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const rows = db.prepare(`
    select id, automation_id, session_id, status, exit_code, started_at, finished_at
    from automation_runs
    where automation_id = @automationId
      ${cursor ? "and (started_at < @cursorSort or (started_at = @cursorSort and id < @cursorId))" : ""}
    order by started_at desc, id desc
    limit @limit
  `).all({ automationId: automation.id, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return c.json(pageFromRows(rows.map(automationRunFromRow), limit, (item) => item.startedAt));
});
app.post("/api/automations/:id/run", (c) => {
  const automation = appData.automations.find((item) => item.id === c.req.param("id"));
  if (!automation) return c.json({ error: "automation_not_found" }, 404);
  try {
    return c.json(runAutomationNow(automation), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "automation_run_failed" }, 400);
  }
});

app.get("/api/agent-roles", (c) => c.json(listAgentRoles(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));
app.get("/api/agent-role-templates", (c) => c.json(listAgentRoleTemplates().map(publicAgentRoleTemplate)));
app.post("/api/agent-roles", async (c) => {
  const body = await c.req.json<CreateAgentRoleRequest>().catch(() => null);
  const markdownContent = body?.markdownContent?.trim() || body?.systemPrompt?.trim() || "";
  const description = body?.description?.trim() || markdownDescription(markdownContent);
  const systemPrompt = systemPromptWithRoleDescription(body?.systemPrompt?.trim() || markdownContent, description, Boolean(body?.includeDescriptionInPrompt));
  if (!body?.name?.trim() || !systemPrompt) return c.json({ error: "invalid_agent_role" }, 400);
  const now = new Date().toISOString();
  const idBase = slugify(body.name);
  let id = idBase;
  let suffix = 2;
  while (db.prepare("select id from agent_roles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
  db.prepare(`
    insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name.trim(),
    description,
    roleSourceType(body.sourceType),
    body.sourcePath?.trim() || null,
    body.sourceUrl?.trim() || null,
    markdownContent,
    systemPrompt,
    JSON.stringify(body.capabilities ?? []),
    listenMode(body.defaultListenMode),
    JSON.stringify(body.defaultListenEvents ?? []),
    workspaceMode(body.defaultWorkspaceMode),
    body.defaultSandboxMode ?? null,
    body.defaultApprovalPolicy ?? null,
    body.outputContract?.trim() || null,
    body.safetyNotes?.trim() || null,
    now,
    now,
  );
  return c.json(agentRoleFromRow(db.prepare("select * from agent_roles where id = ?").get(id) as Record<string, unknown>), 201);
});
app.post("/api/agent-roles/from-template", async (c) => {
  const body = await c.req.json<CreateAgentRoleFromTemplateRequest>().catch(() => null);
  if (!body?.templateId) return c.json({ error: "template_required" }, 400);
  const template = listAgentRoleTemplates().find((item) => item.id === body.templateId);
  if (!template) return c.json({ error: "agent_role_template_not_found" }, 404);
  const now = new Date().toISOString();
  const roleName = body.name?.trim() || template.name;
  const description = body.description?.trim() || template.description;
  const systemPrompt = systemPromptWithRoleDescription(template.markdownContent, description, Boolean(body.includeDescriptionInPrompt));
  const idBase = slugify(roleName);
  let id = idBase;
  let suffix = 2;
  while (db.prepare("select id from agent_roles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
  db.prepare(`
    insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
    values (?, ?, ?, 'builtin-template', ?, ?, ?, ?, '[]', 'passive', '[]', 'isolated-worktree-with-shared-room', null, null, null, null, ?, ?)
  `).run(id, roleName, description, template.sourcePath, template.sourceUrl ?? null, template.markdownContent, systemPrompt, now, now);
  return c.json(agentRoleFromRow(db.prepare("select * from agent_roles where id = ?").get(id) as Record<string, unknown>), 201);
});
app.post("/api/agent-roles/import-file", async (c) => {
  const body = await c.req.json<{ path?: string; name?: string }>().catch(() => null);
  if (!body?.path?.trim()) return c.json({ error: "path_required" }, 400);
  try {
    const absolutePath = resolveTerminalCwd(body.path);
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return c.json({ error: "invalid_role_file" }, 400);
    const markdownContent = readFileSync(absolutePath, "utf8");
    const name = body.name?.trim() || markdownTitle(markdownContent) || basename(absolutePath).replace(/\.(md|markdown)$/i, "");
    const request: CreateAgentRoleRequest = {
      name,
      description: markdownDescription(markdownContent),
      sourceType: "file-import",
      sourcePath: absolutePath,
      markdownContent,
      systemPrompt: markdownContent,
    };
    const now = new Date().toISOString();
    const idBase = slugify(request.name);
    let id = idBase;
    let suffix = 2;
    while (db.prepare("select id from agent_roles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
    db.prepare(`
      insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
      values (?, ?, ?, 'file-import', ?, null, ?, ?, '[]', 'passive', '[]', 'isolated-worktree-with-shared-room', null, null, null, null, ?, ?)
    `).run(id, request.name, request.description ?? "", absolutePath, markdownContent, markdownContent, now, now);
    return c.json(agentRoleFromRow(db.prepare("select * from agent_roles where id = ?").get(id) as Record<string, unknown>), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "role_import_failed" }, 400);
  }
});
app.patch("/api/agent-roles/:id", async (c) => {
  const current = db.prepare("select * from agent_roles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "agent_role_not_found" }, 404);
  const body = await c.req.json<UpdateAgentRoleRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_agent_role_update" }, 400);
  const next = agentRoleFromRow(current);
  const markdownContent = body.markdownContent?.trim() || next.markdownContent;
  const description = body.description !== undefined ? body.description?.trim() || null : next.description;
  const systemPrompt = systemPromptWithRoleDescription(body.systemPrompt?.trim() || markdownContent || next.systemPrompt, description, Boolean(body.includeDescriptionInPrompt));
  db.prepare(`
    update agent_roles set name = ?, description = ?, source_type = ?, source_path = ?, source_url = ?, markdown_content = ?, system_prompt = ?, capabilities = ?, default_listen_mode = ?, default_listen_events = ?, default_workspace_mode = ?, default_sandbox_mode = ?, default_approval_policy = ?, output_contract = ?, safety_notes = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || next.name,
    description,
    roleSourceType(body.sourceType ?? next.sourceType),
    body.sourcePath !== undefined ? body.sourcePath?.trim() || null : next.sourcePath ?? null,
    body.sourceUrl !== undefined ? body.sourceUrl?.trim() || null : next.sourceUrl ?? null,
    markdownContent,
    systemPrompt,
    JSON.stringify(body.capabilities ?? next.capabilities),
    listenMode(body.defaultListenMode, next.defaultListenMode),
    JSON.stringify(body.defaultListenEvents ?? next.defaultListenEvents),
    workspaceMode(body.defaultWorkspaceMode, next.defaultWorkspaceMode),
    body.defaultSandboxMode !== undefined ? body.defaultSandboxMode : next.defaultSandboxMode ?? null,
    body.defaultApprovalPolicy !== undefined ? body.defaultApprovalPolicy : next.defaultApprovalPolicy ?? null,
    body.outputContract !== undefined ? body.outputContract?.trim() || null : next.outputContract ?? null,
    body.safetyNotes !== undefined ? body.safetyNotes?.trim() || null : next.safetyNotes ?? null,
    new Date().toISOString(),
    next.id,
  );
  return c.json(agentRoleFromRow(db.prepare("select * from agent_roles where id = ?").get(next.id) as Record<string, unknown>));
});
app.delete("/api/agent-roles/:id", (c) => {
  const roleId = c.req.param("id");
  const agents = db.prepare("select count(*) as count from agents where role_id = ?").get(roleId) as { count: number } | undefined;
  if (agents && agents.count > 0) return c.json({ error: "agent_role_in_use" }, 409);
  db.prepare("delete from agent_roles where id = ?").run(roleId);
  return c.json({ ok: true, id: roleId });
});

app.get("/api/agents", (c) => c.json(listAgents(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));
app.get("/api/permission-profiles", (c) => c.json(Object.entries(permissionProfiles).map(([id, permissions]) => ({
  id,
  permissions: { ...defaultAgentPermissions, ...permissions },
}))));
app.post("/api/agents/batch", async (c) => {
  const body = await c.req.json<{ ids?: string[]; enabled?: boolean }>().catch(() => null);
  const ids = [...new Set((body?.ids ?? []).map(String))];
  if (!ids.length || typeof body?.enabled !== "boolean") return c.json({ error: "invalid_agent_batch" }, 400);
  const now = new Date().toISOString();
  const update = db.prepare("update agents set enabled = ?, updated_at = ? where id = ?");
  for (const id of ids) update.run(body.enabled ? 1 : 0, now, id);
  return c.json({ ok: true, ids, enabled: body.enabled });
});
app.get("/api/agents/:id/sessions", (c) => {
  const agentId = c.req.param("id");
  if (!db.prepare("select id from agents where id = ?").get(agentId)) return c.json({ error: "agent_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const rows = db.prepare(`
    select sessions.*
    from sessions
    inner join agent_sessions on agent_sessions.session_id = sessions.id
    where agent_sessions.agent_id = @agentId
      ${status ? "and sessions.status = @status" : ""}
      ${projectId ? "and coalesce(sessions.project_id, '') = @projectId" : ""}
      ${cursor ? "and (sessions.updated_at < @cursorSort or (sessions.updated_at = @cursorSort and sessions.id < @cursorId))" : ""}
    order by sessions.updated_at desc, sessions.id desc
  `).all({ agentId, status, projectId: projectId === "scratch" ? "" : projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id }) as Array<Record<string, unknown>>;
  const projects = appData.projects;
  const filtered = rows.map((row) => sessionFromRow(row, projects))
    .filter((session) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
    .slice(0, limit + 1);
  return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
});
app.get("/api/agents/:id/stats", (c) => {
  const agentId = c.req.param("id");
  if (!db.prepare("select id from agents where id = ?").get(agentId)) return c.json({ error: "agent_not_found" }, 404);
  const runs = db.prepare("select status, started_at, finished_at from agent_runs where agent_id = ?").all(agentId) as Array<{ status: string; started_at: string; finished_at?: string | null }>;
  const directSessions = db.prepare("select count(*) as count from agent_sessions where agent_id = ?").get(agentId) as { count: number } | undefined;
  const completed = runs.filter((run) => run.finished_at);
  const durations = completed.map((run) => new Date(run.finished_at ?? run.started_at).getTime() - new Date(run.started_at).getTime()).filter((value) => Number.isFinite(value) && value >= 0);
  return c.json({
    agentId,
    totalRuns: runs.length,
    runningRuns: runs.filter((run) => run.status === "running").length,
    successfulRuns: runs.filter((run) => run.status === "done").length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
    directSessions: directSessions?.count ?? 0,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    latestRunAt: runs.map((run) => run.started_at).sort().at(-1) ?? null,
  });
});
app.post("/api/agents", async (c) => {
  const body = await c.req.json<CreateAgentRequest>().catch(() => null);
  if (!body?.name?.trim() || !body.roleId || !db.prepare("select id from agent_roles where id = ?").get(body.roleId)) return c.json({ error: "invalid_agent" }, 400);
  const role = agentRoleFromRow(db.prepare("select * from agent_roles where id = ?").get(body.roleId) as Record<string, unknown>);
  const now = new Date().toISOString();
  const id = `agent-${randomUUID()}`;
  const accessMode = projectAccessMode(body.projectAccessMode);
  const allowedProjectIds = normalizeProjectIds(body.allowedProjectIds);
  const favoriteProjectIds = normalizeProjectIds(body.favoriteProjectIds);
  const defaultProjectId = body.defaultProjectId && agentCanAccessProject({
    ...agentFromRow({
      id,
      name: body.name.trim(),
      role_id: body.roleId,
      workspace_mode: body.workspaceMode ?? role.defaultWorkspaceMode,
      permissions: "{}",
      max_concurrent_runs: 1,
      enabled: 1,
      created_at: now,
      updated_at: now,
      project_access_mode: accessMode,
      allowed_project_ids: JSON.stringify(allowedProjectIds),
      favorite_project_ids: JSON.stringify(favoriteProjectIds),
    }),
    projectAccessMode: accessMode,
    allowedProjectIds,
  }, body.defaultProjectId) ? body.defaultProjectId : null;
  db.prepare(`
    insert into agents (id, name, role_id, description, extra_prompt, provider_id, model, listen_mode, listen_events, workspace_mode, default_project_id, favorite_project_ids, project_access_mode, allowed_project_ids, permission_profile_id, permissions, max_concurrent_runs, enabled, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name.trim(),
    body.roleId,
    body.description?.trim() || null,
    body.extraPrompt?.trim() || null,
    body.providerId || null,
    body.model?.trim() || null,
    role.defaultListenMode,
    JSON.stringify(role.defaultListenEvents),
    workspaceMode(body.workspaceMode, role.defaultWorkspaceMode),
    defaultProjectId,
    JSON.stringify(favoriteProjectIds),
    accessMode,
    JSON.stringify(allowedProjectIds),
    permissionProfileId(body.permissionProfileId),
    JSON.stringify(agentPermissions({}, body.permissions)),
    Math.max(1, Math.min(10, Number(body.maxConcurrentRuns ?? 1) || 1)),
    body.enabled === false ? 0 : 1,
    now,
    now,
  );
  return c.json(agentFromRow(db.prepare("select * from agents where id = ?").get(id) as Record<string, unknown>), 201);
});
app.post("/api/agents/:id/sessions", async (c) => {
  const agentRow = db.prepare("select * from agents where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!agentRow) return c.json({ error: "agent_not_found" }, 404);
  const agent = agentFromRow(agentRow);
  if (!agent.enabled) return c.json({ error: "agent_disabled" }, 400);
  const body = await c.req.json<CreateAgentSessionRequest>().catch(() => null);
  let project: ProjectSummary | null = null;
  try {
    project = resolveAgentProject(agent, body?.projectId);
  } catch {
    return c.json({ error: "agent_project_access_denied" }, 403);
  }
  const provider = agent.providerId ? appData.providers.find((item) => item.id === agent.providerId) : appData.providers[0];
  const now = new Date().toISOString();
  const id = `task-${randomUUID()}`;
  const session: SessionSummary = {
    id,
    kind: project ? "project" : "scratch",
    conversationType: "agent",
    roomId: null,
    directAgentId: agent.id,
    title: agent.name,
    projectId: project?.id ?? null,
    workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id),
    providerId: provider?.id ?? null,
    model: agent.model ?? provider?.defaultModel ?? null,
    status: "paused",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions.unshift(session);
  upsertSession(session);
  db.prepare("insert into agent_sessions (session_id, agent_id, created_at) values (?, ?, ?)").run(session.id, agent.id, now);
  return c.json(session, 201);
});
app.patch("/api/agents/:id", async (c) => {
  const current = db.prepare("select * from agents where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "agent_not_found" }, 404);
  const body = await c.req.json<UpdateAgentRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_agent_update" }, 400);
  const next = agentFromRow(current);
  const roleId = body.roleId ?? next.roleId;
  if (!db.prepare("select id from agent_roles where id = ?").get(roleId)) return c.json({ error: "agent_role_not_found" }, 404);
  const currentListenMode = listenMode(current.listen_mode);
  const currentListenEvents = jsonArray(current.listen_events);
  const accessMode = projectAccessMode(body.projectAccessMode ?? next.projectAccessMode);
  const allowedProjectIds = normalizeProjectIds(body.allowedProjectIds ?? next.allowedProjectIds);
  const favoriteProjectIds = normalizeProjectIds(body.favoriteProjectIds ?? next.favoriteProjectIds);
  const requestedDefaultProjectId = body.defaultProjectId !== undefined ? body.defaultProjectId : next.defaultProjectId;
  const defaultProjectId = requestedDefaultProjectId && (accessMode === "all" || (accessMode === "selected" && allowedProjectIds.includes(requestedDefaultProjectId))) ? requestedDefaultProjectId : null;
  db.prepare(`
    update agents set name = ?, role_id = ?, description = ?, extra_prompt = ?, provider_id = ?, model = ?, listen_mode = ?, listen_events = ?, workspace_mode = ?, default_project_id = ?, favorite_project_ids = ?, project_access_mode = ?, allowed_project_ids = ?, permission_profile_id = ?, permissions = ?, max_concurrent_runs = ?, enabled = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || next.name,
    roleId,
    body.description !== undefined ? body.description?.trim() || null : next.description ?? null,
    body.extraPrompt !== undefined ? body.extraPrompt?.trim() || null : next.extraPrompt ?? null,
    body.providerId !== undefined ? body.providerId || null : next.providerId ?? null,
    body.model !== undefined ? body.model?.trim() || null : next.model ?? null,
    currentListenMode,
    JSON.stringify(currentListenEvents),
    workspaceMode(body.workspaceMode, next.workspaceMode),
    defaultProjectId,
    JSON.stringify(favoriteProjectIds),
    accessMode,
    JSON.stringify(allowedProjectIds),
    body.permissionProfileId !== undefined ? permissionProfileId(body.permissionProfileId) : next.permissionProfileId ?? null,
    JSON.stringify(agentPermissions(next.permissions, body.permissions)),
    Math.max(1, Math.min(10, Number(body.maxConcurrentRuns ?? next.maxConcurrentRuns) || 1)),
    body.enabled !== undefined ? body.enabled ? 1 : 0 : next.enabled ? 1 : 0,
    new Date().toISOString(),
    next.id,
  );
  return c.json(agentFromRow(db.prepare("select * from agents where id = ?").get(next.id) as Record<string, unknown>));
});
app.delete("/api/agents/:id", (c) => {
  const agentId = c.req.param("id");
  db.prepare("delete from agent_group_members where agent_id = ?").run(agentId);
  db.prepare("delete from room_agent_threads where agent_id = ?").run(agentId);
  db.prepare("delete from agents where id = ?").run(agentId);
  return c.json({ ok: true, id: agentId });
});

app.get("/api/agent-groups", (c) => c.json(listAgentGroups(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));
app.post("/api/agent-groups", async (c) => {
  const body = await c.req.json<CreateAgentGroupRequest>().catch(() => null);
  if (!body?.name?.trim()) return c.json({ error: "invalid_agent_group" }, 400);
  const now = new Date().toISOString();
  const id = `group-${randomUUID()}`;
  db.prepare(`
    insert into agent_groups (id, name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name.trim(),
    body.description?.trim() || null,
    body.collaborationRules?.trim() || "orchestrator-routed",
    body.eventRoutingRules?.trim() || "orchestrator listens to room events and assigns agents explicitly",
    Math.max(1, Math.min(20, Number(body.maxConcurrentAgents ?? 3) || 3)),
    body.approvalPolicy?.trim() || "approval-required-for-risk",
    body.mergeStrategy?.trim() || "isolated-worktree-review-then-approve",
    now,
    now,
  );
  replaceGroupMembers(id, body.agentIds ?? [], body.memberListenModes ?? {});
  return c.json(agentGroupFromRow(db.prepare("select * from agent_groups where id = ?").get(id) as Record<string, unknown>), 201);
});
app.patch("/api/agent-groups/:id", async (c) => {
  const current = db.prepare("select * from agent_groups where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "agent_group_not_found" }, 404);
  const body = await c.req.json<UpdateAgentGroupRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_agent_group_update" }, 400);
  const next = agentGroupFromRow(current);
  db.prepare(`
    update agent_groups set name = ?, description = ?, collaboration_rules = ?, event_routing_rules = ?, max_concurrent_agents = ?, approval_policy = ?, merge_strategy = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || next.name,
    body.description !== undefined ? body.description?.trim() || null : next.description ?? null,
    body.collaborationRules?.trim() || next.collaborationRules,
    body.eventRoutingRules?.trim() || next.eventRoutingRules,
    Math.max(1, Math.min(20, Number(body.maxConcurrentAgents ?? next.maxConcurrentAgents) || 3)),
    body.approvalPolicy?.trim() || next.approvalPolicy,
    body.mergeStrategy?.trim() || next.mergeStrategy,
    new Date().toISOString(),
    next.id,
  );
  if (body.agentIds) replaceGroupMembers(next.id, body.agentIds, body.memberListenModes ?? next.memberListenModes ?? {});
  return c.json(agentGroupFromRow(db.prepare("select * from agent_groups where id = ?").get(next.id) as Record<string, unknown>));
});
app.delete("/api/agent-groups/:id", (c) => {
  const groupId = c.req.param("id");
  db.prepare("delete from agent_group_members where group_id = ?").run(groupId);
  db.prepare("delete from agent_groups where id = ?").run(groupId);
  return c.json({ ok: true, id: groupId });
});

app.get("/api/agent-groups/:id/rooms", (c) => {
  const groupId = c.req.param("id");
  if (!db.prepare("select id from agent_groups where id = ?").get(groupId)) return c.json({ error: "agent_group_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const rows = db.prepare(`
    select sessions.*
    from rooms
    inner join sessions on sessions.id = rooms.session_id
    where rooms.group_id = @groupId
      ${status ? "and sessions.status = @status" : ""}
      ${projectId ? "and coalesce(sessions.project_id, '') = @projectId" : ""}
      ${cursor ? "and (sessions.updated_at < @cursorSort or (sessions.updated_at = @cursorSort and sessions.id < @cursorId))" : ""}
    order by sessions.updated_at desc, sessions.id desc
  `).all({ groupId, status, projectId: projectId === "scratch" ? "" : projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id }) as Array<Record<string, unknown>>;
  const filtered = rows.map((row) => sessionFromRow(row, appData.projects))
    .filter((session) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
    .slice(0, limit + 1);
  return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
});

app.get("/api/agent-circles", (c) => {
  if (c.req.query("limit") || c.req.query("cursor")) return c.json(listAgentCircles(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor")));
  const rows = db.prepare("select * from agent_circles order by builtin desc, name asc").all() as Array<Record<string, unknown>>;
  return c.json(rows.map(agentCircleFromRow));
});
app.get("/api/agent-circles/:id/rooms", (c) => {
  const circleId = c.req.param("id");
  if (!db.prepare("select id from agent_circles where id = ?").get(circleId)) return c.json({ error: "agent_circle_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const rows = db.prepare(`
    select sessions.*
    from rooms
    inner join sessions on sessions.id = rooms.session_id
    where rooms.circle_id = @circleId
      ${status ? "and sessions.status = @status" : ""}
      ${projectId ? "and coalesce(sessions.project_id, '') = @projectId" : ""}
      ${cursor ? "and (sessions.updated_at < @cursorSort or (sessions.updated_at = @cursorSort and sessions.id < @cursorId))" : ""}
    order by sessions.updated_at desc, sessions.id desc
  `).all({ circleId, status, projectId: projectId === "scratch" ? "" : projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id }) as Array<Record<string, unknown>>;
  const filtered = rows.map((row) => sessionFromRow(row, appData.projects))
    .filter((session) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
    .slice(0, limit + 1);
  return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
});
app.post("/api/agent-circles", async (c) => {
  const body = await c.req.json<CreateAgentCircleRequest>().catch(() => null);
  if (!body?.name?.trim()) return c.json({ error: "invalid_agent_circle" }, 400);
  const roleIds = [...new Set(body.roleIds ?? [])].filter((roleId) => db.prepare("select id from agent_roles where id = ?").get(roleId));
  const now = new Date().toISOString();
  const idBase = `circle-${slugify(body.name)}`;
  let id = idBase;
  let suffix = 2;
  while (db.prepare("select id from agent_circles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
  db.prepare(`
    insert into agent_circles (id, name, description, group_template_id, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, builtin, created_at, updated_at)
    values (?, ?, ?, null, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    body.name.trim(),
    body.description?.trim() || null,
    body.collaborationRules?.trim() || "",
    body.eventRoutingRules?.trim() || "",
    Math.max(1, Math.min(10, Number(body.maxConcurrentAgents ?? 3) || 3)),
    body.approvalPolicy?.trim() || "bounded",
    body.mergeStrategy?.trim() || "approval-required",
    now,
    now,
  );
  const insertRole = db.prepare("insert or ignore into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)");
  roleIds.forEach((roleId, index) => insertRole.run(id, roleId, index));
  return c.json(agentCircleFromRow(db.prepare("select * from agent_circles where id = ?").get(id) as Record<string, unknown>), 201);
});
app.patch("/api/agent-circles/:id", async (c) => {
  const current = db.prepare("select * from agent_circles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "agent_circle_not_found" }, 404);
  if (Number(current.builtin) === 1) return c.json({ error: "builtin_circle_locked" }, 409);
  const body = await c.req.json<UpdateAgentCircleRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_agent_circle_update" }, 400);
  const next = agentCircleFromRow(current);
  db.prepare(`
    update agent_circles set name = ?, description = ?, collaboration_rules = ?, event_routing_rules = ?, max_concurrent_agents = ?, approval_policy = ?, merge_strategy = ?, updated_at = ?
    where id = ?
  `).run(
    body.name?.trim() || next.name,
    body.description !== undefined ? body.description?.trim() || null : next.description ?? null,
    body.collaborationRules?.trim() || next.collaborationRules,
    body.eventRoutingRules?.trim() || next.eventRoutingRules,
    Math.max(1, Math.min(10, Number(body.maxConcurrentAgents ?? next.maxConcurrentAgents) || 3)),
    body.approvalPolicy?.trim() || next.approvalPolicy,
    body.mergeStrategy?.trim() || next.mergeStrategy,
    new Date().toISOString(),
    next.id,
  );
  if (body.roleIds) {
    db.prepare("delete from agent_circle_roles where circle_id = ?").run(next.id);
    const insertRole = db.prepare("insert or ignore into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)");
    [...new Set(body.roleIds)].filter((roleId) => db.prepare("select id from agent_roles where id = ?").get(roleId)).forEach((roleId, index) => insertRole.run(next.id, roleId, index));
  }
  return c.json(agentCircleFromRow(db.prepare("select * from agent_circles where id = ?").get(next.id) as Record<string, unknown>));
});
app.post("/api/agent-circles/:id/groups", async (c) => {
  const circleRow = db.prepare("select * from agent_circles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!circleRow) return c.json({ error: "agent_circle_not_found" }, 404);
  const circle = agentCircleFromRow(circleRow);
  try {
    return c.json(createAgentGroupFromCircle(circle), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "agent_circle_group_create_failed" }, 400);
  }
});
app.delete("/api/agent-circles/:id", (c) => {
  const circle = db.prepare("select * from agent_circles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!circle) return c.json({ error: "agent_circle_not_found" }, 404);
  if (Number(circle.builtin) === 1) return c.json({ error: "builtin_circle_locked" }, 409);
  db.prepare("delete from agent_circle_roles where circle_id = ?").run(c.req.param("id"));
  db.prepare("delete from agent_circles where id = ?").run(c.req.param("id"));
  return c.json({ ok: true, id: c.req.param("id") });
});

app.get("/api/rooms", (c) => c.json(listRooms(c.req.query("status"), parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));
app.get("/api/rooms/:id", (c) => {
  const row = db.prepare("select * from rooms where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: "room_not_found" }, 404);
  return c.json(roomFromRow(row));
});
app.post("/api/rooms", async (c) => {
  const body = await c.req.json<CreateRoomRequest>().catch(() => null);
  if (!body?.name?.trim()) return c.json({ error: "invalid_room" }, 400);
  if (body.groupId && !db.prepare("select id from agent_groups where id = ?").get(body.groupId)) return c.json({ error: "agent_group_not_found" }, 404);
  const circle = body.circleId ? db.prepare("select * from agent_circles where id = ?").get(body.circleId) as Record<string, unknown> | undefined : null;
  if (body.circleId && !circle) return c.json({ error: "agent_circle_not_found" }, 404);
  let groupId = body.groupId ?? (circle?.group_template_id ? String(circle.group_template_id) : null);
  if (!groupId && circle) {
    try {
      groupId = createAgentGroupFromCircle(agentCircleFromRow(circle)).id;
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "agent_circle_group_create_failed" }, 400);
    }
  }
  const now = new Date().toISOString();
  const id = `room-${randomUUID()}`;
  const project = body.projectId ? appData.projects.find((item) => item.id === body.projectId) : null;
  const sessionId = `task-${randomUUID()}`;
  const session: SessionSummary = {
    id: sessionId,
    kind: project ? "project" : "scratch",
    conversationType: "room",
    roomId: id,
    title: body.name.trim(),
    projectId: project?.id ?? null,
    workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(sessionId),
    status: "paused",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions.unshift(session);
  upsertSession(session);
  db.prepare(`
    insert into rooms (id, session_id, name, group_id, circle_id, project_id, status, shared_context, orchestration_settings, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run(id, sessionId, body.name.trim(), groupId, body.circleId ?? null, project?.id ?? null, body.sharedContext?.trim() || null, JSON.stringify(defaultRoomOrchestration), now, now);
  if (body.goal?.text?.trim()) {
    session.goal = createGoal({ ...body.goal, ownerType: "room", ownerId: id, mode: body.goal.mode ?? "orchestrated" }, "user");
  }
  const group = groupId ? agentGroupFromRow(db.prepare("select * from agent_groups where id = ?").get(groupId) as Record<string, unknown>) : null;
  const insertRoomAgent = db.prepare("insert or ignore into room_agents (room_id, agent_id, listen_mode) values (?, ?, ?)");
  for (const agentId of group?.agentIds ?? []) insertRoomAgent.run(id, agentId, listenMode(group?.memberListenModes?.[agentId]));
  roomEvent(id, "room.created", { name: body.name });
  return c.json(roomFromRow(db.prepare("select * from rooms where id = ?").get(id) as Record<string, unknown>), 201);
});
app.patch("/api/rooms/:id", async (c) => {
  const current = db.prepare("select * from rooms where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<UpdateRoomRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_room_update" }, 400);
  const next = roomFromRow(current);
  const orchestration = roomOrchestrationSettings(current.orchestration_settings, body.orchestration);
  db.prepare("update rooms set name = ?, status = ?, shared_context = ?, orchestration_settings = ?, updated_at = ? where id = ?").run(
    body.name?.trim() || next.name,
    roomStatus(body.status, next.status),
    body.sharedContext !== undefined ? body.sharedContext?.trim() || null : next.sharedContext ?? null,
    JSON.stringify(orchestration),
    new Date().toISOString(),
    next.id,
  );
  return c.json(roomFromRow(db.prepare("select * from rooms where id = ?").get(next.id) as Record<string, unknown>));
});
app.get("/api/rooms/:id/agents", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  return c.json(roomAgentsWithListenModes(c.req.param("id")).map((member) => ({ ...member.agent, listenMode: member.listenMode })));
});
app.post("/api/rooms/:id/agents", async (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<{ agentId?: string; listenMode?: AgentListenMode }>().catch(() => null);
  const agentId = body?.agentId?.trim() ?? "";
  if (!agentId || !db.prepare("select id from agents where id = ?").get(agentId)) return c.json({ error: "agent_not_found" }, 404);
  const mode = listenMode(body?.listenMode);
  db.prepare("insert into room_agents (room_id, agent_id, listen_mode) values (?, ?, ?) on conflict(room_id, agent_id) do update set listen_mode = excluded.listen_mode").run(c.req.param("id"), agentId, mode);
  roomEvent(c.req.param("id"), "room.agent.added", { agentId, listenMode: mode }, agentId);
  return c.json(roomAgentsWithListenModes(c.req.param("id")).map((member) => ({ ...member.agent, listenMode: member.listenMode })), 201);
});
app.patch("/api/rooms/:id/agents/:agentId", async (c) => {
  const body = await c.req.json<{ listenMode?: AgentListenMode }>().catch(() => null);
  const mode = listenMode(body?.listenMode);
  const result = db.prepare("update room_agents set listen_mode = ? where room_id = ? and agent_id = ?").run(mode, c.req.param("id"), c.req.param("agentId"));
  if (!result.changes) return c.json({ error: "room_agent_not_found" }, 404);
  roomEvent(c.req.param("id"), "room.agent.listen_mode.updated", { agentId: c.req.param("agentId"), listenMode: mode }, c.req.param("agentId"));
  return c.json(roomAgentsWithListenModes(c.req.param("id")).map((member) => ({ ...member.agent, listenMode: member.listenMode })));
});
app.get("/api/rooms/:id/events", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 50);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const rows = db.prepare(`
    select * from room_events
    where room_id = @roomId
      ${cursor ? "and (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ roomId: c.req.param("id"), cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return c.json(pageFromRows(rows.map(roomEventFromRow), limit, (item) => item.createdAt));
});
app.get("/api/rooms/:id/artifacts", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (c.req.query("limit") || c.req.query("cursor")) {
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const offset = decodeOffsetCursor(c.req.query("cursor"));
    const rows = db.prepare("select * from room_artifacts where room_id = ? order by created_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
    return c.json(offsetPageFromRows(rows.map(roomArtifactFromRow), limit, offset));
  }
  const rows = db.prepare("select * from room_artifacts where room_id = ? order by created_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(roomArtifactFromRow));
});
app.post("/api/rooms/:id/artifacts", async (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<CreateRoomArtifactRequest>().catch(() => null);
  if (!body?.title?.trim() || !body.kind) return c.json({ error: "invalid_room_artifact" }, 400);
  if (body.agentId && !db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.agentId)) {
    return c.json({ error: "agent_not_in_room" }, 400);
  }
  return c.json(createRoomArtifact(c.req.param("id"), {
    agentId: body.agentId ?? null,
    kind: body.kind,
    title: body.title.trim(),
    payload: body.payload ?? {},
  }), 201);
});
app.get("/api/rooms/:id/decisions", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (c.req.query("limit") || c.req.query("cursor")) {
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const offset = decodeOffsetCursor(c.req.query("cursor"));
    const rows = db.prepare("select * from room_decisions where room_id = ? order by created_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
    return c.json(offsetPageFromRows(rows.map(roomDecisionFromRow), limit, offset));
  }
  const rows = db.prepare("select * from room_decisions where room_id = ? order by created_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(roomDecisionFromRow));
});
app.post("/api/rooms/:id/decisions", async (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<CreateRoomDecisionRequest>().catch(() => null);
  if (!body?.title?.trim()) return c.json({ error: "invalid_room_decision" }, 400);
  const status = ["open", "approved", "rejected", "resolved"].includes(String(body.status)) ? body.status as RoomDecisionSummary["status"] : "open";
  return c.json(createRoomDecision(c.req.param("id"), {
    title: body.title.trim(),
    status,
    payload: body.payload ?? {},
    resolvedAt: status !== "open" ? new Date().toISOString() : null,
  }), 201);
});
app.patch("/api/rooms/:id/decisions/:decisionId", async (c) => {
  const roomId = c.req.param("id");
  const decisionId = c.req.param("decisionId");
  const current = db.prepare("select * from room_decisions where room_id = ? and id = ?").get(roomId, decisionId) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "decision_not_found" }, 404);
  const body = await c.req.json<UpdateRoomDecisionRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_room_decision" }, 400);
  const currentDecision = roomDecisionFromRow(current);
  const title = typeof body.title === "string" ? body.title.trim() : currentDecision.title;
  if (!title) return c.json({ error: "invalid_room_decision" }, 400);
  const status = body.status && ["open", "approved", "rejected", "resolved"].includes(body.status) ? body.status : currentDecision.status;
  const resolvedAt = status === "open" ? null : (currentDecision.resolvedAt ?? new Date().toISOString());
  const payload = Object.prototype.hasOwnProperty.call(body, "payload") ? body.payload : currentDecision.payload;
  db.prepare("update room_decisions set title = ?, status = ?, payload = ?, resolved_at = ? where room_id = ? and id = ?")
    .run(title, status, JSON.stringify(payload ?? {}), resolvedAt, roomId, decisionId);
  roomEvent(roomId, "decision.updated", { decisionId, title, status });
  const updated = db.prepare("select * from room_decisions where room_id = ? and id = ?").get(roomId, decisionId) as Record<string, unknown>;
  return c.json(roomDecisionFromRow(updated));
});
app.get("/api/rooms/:id/handoffs", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (c.req.query("limit") || c.req.query("cursor")) {
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const offset = decodeOffsetCursor(c.req.query("cursor"));
    const rows = db.prepare("select * from room_handoffs where room_id = ? order by created_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
    return c.json(offsetPageFromRows(rows.map(roomHandoffFromRow), limit, offset));
  }
  const rows = db.prepare("select * from room_handoffs where room_id = ? order by created_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(roomHandoffFromRow));
});
app.post("/api/rooms/:id/handoffs", async (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<CreateRoomHandoffRequest>().catch(() => null);
  if (!body?.summary?.trim()) return c.json({ error: "invalid_room_handoff" }, 400);
  const status = roomHandoffStatus(body.status);
  return c.json(createRoomHandoff(c.req.param("id"), {
    fromAgentId: body.fromAgentId ?? null,
    toAgentId: body.toAgentId ?? null,
    summary: body.summary.trim(),
    status,
    payload: body.payload ?? {},
    resolvedAt: status !== "open" ? new Date().toISOString() : null,
  }), 201);
});
app.patch("/api/rooms/:id/handoffs/:handoffId", async (c) => {
  const roomId = c.req.param("id");
  const handoffId = c.req.param("handoffId");
  const current = db.prepare("select * from room_handoffs where room_id = ? and id = ?").get(roomId, handoffId) as Record<string, unknown> | undefined;
  if (!current) return c.json({ error: "handoff_not_found" }, 404);
  const body = await c.req.json<UpdateRoomHandoffRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_room_handoff" }, 400);
  const currentHandoff = roomHandoffFromRow(current);
  const summary = typeof body.summary === "string" ? body.summary.trim() : currentHandoff.summary;
  if (!summary) return c.json({ error: "invalid_room_handoff" }, 400);
  const status = body.status ? roomHandoffStatus(body.status) : currentHandoff.status;
  const resolvedAt = status === "open" ? null : (currentHandoff.resolvedAt ?? new Date().toISOString());
  const payload = Object.prototype.hasOwnProperty.call(body, "payload") ? body.payload : currentHandoff.payload;
  db.prepare(`
    update room_handoffs
    set from_agent_id = ?, to_agent_id = ?, summary = ?, status = ?, payload = ?, resolved_at = ?
    where room_id = ? and id = ?
  `).run(
    Object.prototype.hasOwnProperty.call(body, "fromAgentId") ? body.fromAgentId ?? null : currentHandoff.fromAgentId ?? null,
    Object.prototype.hasOwnProperty.call(body, "toAgentId") ? body.toAgentId ?? null : currentHandoff.toAgentId ?? null,
    summary,
    status,
    JSON.stringify(payload ?? {}),
    resolvedAt,
    roomId,
    handoffId,
  );
  roomEvent(roomId, "handoff.updated", { handoffId, status });
  const updated = db.prepare("select * from room_handoffs where room_id = ? and id = ?").get(roomId, handoffId) as Record<string, unknown>;
  return c.json(roomHandoffFromRow(updated));
});
app.post("/api/rooms/:id/messages", async (c) => {
  const room = db.prepare("select id, session_id from rooms where id = ?").get(c.req.param("id")) as { id: string; session_id?: string | null } | undefined;
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<CreateRoomMessageRequest>().catch(() => null);
  const content = body?.content?.trim() ?? "";
  if (!content) return c.json({ error: "message_required" }, 400);
  const roomId = c.req.param("id");
  const requestedSession = body?.sessionId ? appData.sessions.find((item) => item.id === body.sessionId && item.roomId === roomId) : null;
  const linkedSession = room.session_id ? appData.sessions.find((item) => item.id === room.session_id) : null;
  const fallbackSession = appData.sessions.find((item) => item.roomId === roomId) ?? null;
  const session = requestedSession ?? linkedSession ?? fallbackSession;
  let attachments: SavedSessionAttachment[] = [];
  if (session) {
    try {
      attachments = saveSessionAttachments(session.id, body?.attachments);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "attachment_upload_failed" }, 400);
    }
  }
  const contentWithAttachments = messageWithAttachments(content, attachments);
  const promptContent = promptWithAttachments(content, attachments);
  const message = session ? appendSessionMessage(session.id, "user", contentWithAttachments, body?.replyToMessageId ?? null) : null;
  if (session) {
    session.updatedAt = message?.createdAt ?? new Date().toISOString();
    upsertSession(session);
    if (room.session_id !== session.id) db.prepare("update rooms set session_id = ?, updated_at = ? where id = ?").run(session.id, session.updatedAt, roomId);
  }
  const members = roomAgentsWithListenModes(roomId);
  const mentionableAgents = members.filter((member) => member.listenMode !== "none").map((member) => member.agent);
  const mentionedAgents = mentionedRoomAgents(content, mentionableAgents);
  const mentionsUser = mentionsRoomUser(content);
  const orchestration = roomOrchestrationSettings((db.prepare("select orchestration_settings from rooms where id = ?").get(roomId) as { orchestration_settings?: string } | undefined)?.orchestration_settings);
  const autoListenAgents = !mentionedAgents.length && !mentionsUser ? autoListenAgentsForRoomMessage(roomId, orchestration.maxAutoListenTasksPerEvent) : [];
  const tasks = [
    ...mentionedAgents.map((agent) => insertRoomTask(roomId, `@${agent.name}`, promptContent, agent.id, 1, null, { kind: "mention", reason: "user.mentioned", mentionsUser })),
    ...autoListenAgents.map((agent) => insertRoomTask(
      roomId,
      members.find((member) => member.agent.id === agent.id)?.listenMode === "orchestrator" ? `Orchestrate: ${content}`.slice(0, 120) : `Respond: ${content}`.slice(0, 120),
      [
        "Room event: user.message",
        "",
        promptContent,
        "",
        members.find((member) => member.agent.id === agent.id)?.listenMode === "orchestrator"
          ? "As the orchestrator, decide whether the room needs follow-up work and summarize the next step."
          : "You are an active listener in this room. Reply to the room in one concise message. If no action is needed, acknowledge briefly and say you will keep listening.",
      ].join("\n"),
      agent.id,
      members.find((member) => member.agent.id === agent.id)?.listenMode === "orchestrator" ? 2 : 1,
      null,
      { kind: "listen", reason: "user.message", mentionsUser },
    )),
  ];
  const runs = [];
  for (const task of tasks) {
    try {
      runs.push(startRoomTaskRun(roomId, task.id).run);
    } catch {
      // Keep the assigned task visible even if the Agent cannot start immediately.
    }
  }
  const event = roomEvent(roomId, "user.message", { content: contentWithAttachments, messageId: message?.id ?? null, sessionId: session?.id ?? null, replyToMessageId: body?.replyToMessageId ?? null, mentionsUser, mentionedAgentIds: mentionedAgents.map((agent) => agent.id), autoListenAgentIds: autoListenAgents.map((agent) => agent.id), taskIds: tasks.map((task) => task.id) });
  for (const task of tasks) {
    roomEvent(roomId, "agent.mentioned", { content: promptContent, taskId: task.id }, task.assignedAgentId ?? null);
  }
  const routed = orchestrateRoom(roomId, mentionsUser ? "user.mentioned" : "user.message");
  return c.json({ event, message, session: session ?? null, tasks: [...tasks, ...routed.tasks], runs: [...runs, ...routed.runs] }, 201);
});
app.get("/api/rooms/:id/runs", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (c.req.query("limit") || c.req.query("cursor")) {
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const offset = decodeOffsetCursor(c.req.query("cursor"));
    const rows = db.prepare("select * from agent_runs where room_id = ? order by started_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
    return c.json(offsetPageFromRows(rows.map(agentRunFromRow), limit, offset));
  }
  const rows = db.prepare("select * from agent_runs where room_id = ? order by started_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(agentRunFromRow));
});
app.get("/api/rooms/:id/runs/:runId/diff", (c) => {
  const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(c.req.param("runId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!run) return c.json({ error: "agent_run_not_found" }, 404);
  const workspacePath = run.workspace_path ? String(run.workspace_path) : "";
  if (!workspacePath || !existsSync(workspacePath)) return c.json({ error: "workspace_not_found" }, 404);
  const status = runGitSync(workspacePath, ["status", "--short"]);
  const stat = runGitSync(workspacePath, ["diff", "--stat"]);
  const diff = runGitSync(workspacePath, ["diff", "--"]);
  const response: RoomRunDiffResponse = {
    runId: String(run.id),
    ok: status.exitCode === 0 && stat.exitCode === 0 && diff.exitCode === 0,
    workspacePath,
    status: status.stdout,
    stat: stat.stdout,
    diff: diff.stdout,
    error: status.stderr || stat.stderr || diff.stderr || undefined,
  };
  return c.json(response);
});
app.post("/api/rooms/:id/runs/:runId/merge", (c) => {
  const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(c.req.param("runId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!run) return c.json({ error: "agent_run_not_found" }, 404);
  const group = roomGroupForRoom(c.req.param("id"));
  const permissions = agentPermissionsForRun(run);
  const strategyRequiresApproval = group?.mergeStrategy.toLowerCase().includes("approval") ?? false;
  const agentRequiresApproval = !permissions.canMergeChanges;
  if ((strategyRequiresApproval || agentRequiresApproval) && !approvalAlwaysAllowed("room-run-merge", { roomId: c.req.param("id") })) {
    const reason = agentRequiresApproval ? "agent permission does not allow direct merge" : `group merge strategy is ${group?.mergeStrategy}`;
    const approval = createRoomRunMergeApproval(c.req.param("id"), c.req.param("runId"), agentRequiresApproval ? "high" : "medium", reason);
    roomEvent(c.req.param("id"), "audit.operation", { action: "merge-approval-requested", runId: c.req.param("runId"), approvalId: approval.id, reason }, run.agent_id ? String(run.agent_id) : null);
    createRoomDecision(c.req.param("id"), {
      title: "Merge approval requested",
      status: "open",
      payload: { approvalId: approval.id, runId: c.req.param("runId"), reason },
    });
    if (run.session_id) {
      appendMessageCard(String(run.session_id), "approval", "Merge approval requested", {
        approvalId: approval.id,
        roomId: c.req.param("id"),
        runId: c.req.param("runId"),
        reason,
        risk: approval.risk,
      });
    }
    return c.json({ error: "approval_required", approval: publicApproval(approval) }, 409);
  }
  try {
    const response = applyRoomRunMerge(c.req.param("id"), c.req.param("runId"));
    return c.json(response, response.ok ? 200 : 409);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "merge_failed" }, 400);
  }
});
app.post("/api/rooms/:id/runs/:runId/reject", (c) => {
  const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(c.req.param("runId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!run) return c.json({ error: "agent_run_not_found" }, 404);
  db.prepare(`
    insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
    values (?, ?, ?, ?, 'rejected', 'Rejected by user', ?, ?)
    on conflict(run_id) do update set status = 'rejected', summary = excluded.summary, updated_at = excluded.updated_at
  `).run(c.req.param("runId"), c.req.param("id"), roomProject(c.req.param("id"))?.id ?? null, run.workspace_path ? String(run.workspace_path) : "", new Date().toISOString(), new Date().toISOString());
  roomEvent(c.req.param("id"), "audit.operation", { action: "merge-rejected", runId: c.req.param("runId") }, run.agent_id ? String(run.agent_id) : null);
  const response: RoomRunMergeResponse = { run: agentRunFromRow(run), ok: true };
  return c.json(response);
});
app.get("/api/rooms/:id/tasks", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (c.req.query("limit") || c.req.query("cursor")) {
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const offset = decodeOffsetCursor(c.req.query("cursor"));
    const rows = db.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
    return c.json(offsetPageFromRows(rows.map(roomTaskFromRow), limit, offset));
  }
  const rows = db.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(roomTaskFromRow));
});
app.post("/api/rooms/:id/tasks", async (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<CreateRoomTaskRequest>().catch(() => null);
  if (!body?.title?.trim() || !body.prompt?.trim()) return c.json({ error: "invalid_room_task" }, 400);
  if (body.assignedAgentId && !db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.assignedAgentId)) {
    return c.json({ error: "agent_not_in_room" }, 400);
  }
  const now = new Date().toISOString();
  const id = `room-task-${randomUUID()}`;
  db.prepare(`
    insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    c.req.param("id"),
    body.title.trim(),
    body.prompt.trim(),
    body.assignedAgentId ? "assigned" : "queued",
    body.assignedAgentId ?? null,
    Number(body.priority ?? 0) || 0,
    body.dependsOnTaskId ?? null,
    body.scheduledAt ?? null,
    JSON.stringify({}),
    now,
    now,
  );
  roomEvent(c.req.param("id"), "task.created", { taskId: id, title: body.title, scheduledAt: body.scheduledAt ?? null }, body.assignedAgentId ?? null);
  orchestrateRoom(c.req.param("id"), "task.created");
  return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(id) as Record<string, unknown>), 201);
});
app.post("/api/rooms/:id/tasks/retry-failed", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const now = new Date().toISOString();
  const tasks = db.prepare(`
    select * from room_tasks
    where room_id = ? and assigned_agent_id is not null and status in ('failed', 'cancelled')
    order by priority desc, updated_at desc
  `).all(c.req.param("id")) as Array<Record<string, unknown>>;
  for (const task of tasks) {
    db.prepare("update room_tasks set status = 'assigned', started_at = null, finished_at = null, updated_at = ? where id = ?").run(now, String(task.id));
    if (task.goal_item_id) {
      const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
      if (item?.goal_id) updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status: "active" }, "system");
    }
    roomEvent(c.req.param("id"), "task.retry", { taskId: String(task.id), batch: true }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
  }
  if (tasks.length) orchestrateRoom(c.req.param("id"), "task.retry");
  return c.json({ ok: true, retried: tasks.length });
});
app.patch("/api/rooms/:id/tasks/:taskId", async (c) => {
  const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!task) return c.json({ error: "room_task_not_found" }, 404);
  const body = await c.req.json<UpdateRoomTaskRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_room_task_update" }, 400);
  if (String(task.status) === "running" && body.status !== "cancelled") return c.json({ error: "room_task_running" }, 409);
  if (body.assignedAgentId && !db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.assignedAgentId)) {
    return c.json({ error: "agent_not_in_room" }, 400);
  }
  if (body.dependsOnTaskId && !db.prepare("select id from room_tasks where room_id = ? and id = ?").get(c.req.param("id"), body.dependsOnTaskId)) {
    return c.json({ error: "dependency_not_found" }, 400);
  }
  const nextStatus = body.status ?? (body.assignedAgentId !== undefined && body.assignedAgentId ? "assigned" : String(task.status));
  db.prepare(`
    update room_tasks
    set title = ?, prompt = ?, assigned_agent_id = ?, status = ?, priority = ?, depends_on_task_id = ?, updated_at = ?
    where id = ? and room_id = ?
  `).run(
    body.title?.trim() || String(task.title),
    body.prompt?.trim() || String(task.prompt ?? ""),
    body.assignedAgentId !== undefined ? body.assignedAgentId || null : task.assigned_agent_id ?? null,
    nextStatus,
    Number(body.priority ?? task.priority ?? 0) || 0,
    body.dependsOnTaskId !== undefined ? body.dependsOnTaskId || null : task.depends_on_task_id ?? null,
    new Date().toISOString(),
    c.req.param("taskId"),
    c.req.param("id"),
  );
  if (task.goal_item_id && (nextStatus === "done" || nextStatus === "failed" || nextStatus === "cancelled")) {
    const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
    if (item?.goal_id) {
      const status: GoalItemStatus = nextStatus === "done" ? "completed" : nextStatus === "cancelled" ? "cancelled" : "failed";
      updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status }, "system");
    }
  }
  roomEvent(c.req.param("id"), "task.updated", { taskId: c.req.param("taskId"), status: nextStatus }, body.assignedAgentId !== undefined ? body.assignedAgentId : task.assigned_agent_id ? String(task.assigned_agent_id) : null);
  orchestrateRoom(c.req.param("id"), "task.updated");
  return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(c.req.param("taskId")) as Record<string, unknown>));
});
app.post("/api/rooms/:id/tasks/:taskId/cancel", (c) => {
  const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!task) return c.json({ error: "room_task_not_found" }, 404);
  const run = db.prepare("select * from agent_runs where task_id = ? and status = 'running'").get(c.req.param("taskId")) as Record<string, unknown> | undefined;
  if (run?.session_id) {
    const sessionId = String(run.session_id);
    const child = codexTaskProcesses.get(sessionId);
    codexTaskStopRequested.add(sessionId);
    markTaskRunStopRequested(sessionId);
    if (child) {
      child.kill("SIGTERM");
    } else if (isProcessAlive(run.pid === null || run.pid === undefined ? null : Number(run.pid))) {
      process.kill(Number(run.pid), "SIGTERM");
    } else {
      stopOrphanRoomAgentRun(sessionId);
    }
  }
  const now = new Date().toISOString();
  db.prepare("update room_tasks set status = 'cancelled', finished_at = ?, updated_at = ? where id = ?").run(now, now, c.req.param("taskId"));
  if (task.goal_item_id) {
    const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
    if (item?.goal_id) updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status: "cancelled" }, "system");
  }
  roomEvent(c.req.param("id"), "task.cancelled", { taskId: c.req.param("taskId") }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
  roomEvent(c.req.param("id"), "audit.operation", { action: "task-cancelled", taskId: c.req.param("taskId"), runId: run?.id ?? null }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
  return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(c.req.param("taskId")) as Record<string, unknown>));
});
app.post("/api/rooms/:id/tasks/:taskId/retry", (c) => {
  const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!task) return c.json({ error: "room_task_not_found" }, 404);
  if (!task.assigned_agent_id) return c.json({ error: "room_task_unassigned" }, 400);
  db.prepare("update room_tasks set status = 'assigned', started_at = null, finished_at = null, updated_at = ? where id = ?").run(new Date().toISOString(), c.req.param("taskId"));
  if (task.goal_item_id) {
    const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
    if (item?.goal_id) updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status: "active" }, "system");
  }
  roomEvent(c.req.param("id"), "task.retry", { taskId: c.req.param("taskId") }, String(task.assigned_agent_id));
  roomEvent(c.req.param("id"), "audit.operation", { action: "task-retry", taskId: c.req.param("taskId") }, String(task.assigned_agent_id));
  orchestrateRoom(c.req.param("id"), "task.retry");
  return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(c.req.param("taskId")) as Record<string, unknown>));
});
app.post("/api/rooms/:id/tasks/:taskId/start", (c) => {
  try {
    return c.json(startRoomTaskRun(c.req.param("id"), c.req.param("taskId")), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "room_task_start_failed";
    const status = message === "room_not_found" || message === "room_task_not_found" || message === "agent_not_found" || message === "agent_role_not_found" ? 404
      : message === "room_task_not_startable" ? 409
        : 400;
    return c.json({ error: message }, status);
  }
});
app.delete("/api/rooms/:id/tasks/:taskId", (c) => {
  const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!task) return c.json({ error: "room_task_not_found" }, 404);
  if (String(task.status) === "running") return c.json({ error: "room_task_running" }, 409);
  db.prepare("delete from room_tasks where id = ?").run(c.req.param("taskId"));
  db.prepare("delete from agent_runs where task_id = ? and status != 'running'").run(c.req.param("taskId"));
  roomEvent(c.req.param("id"), "task.deleted", { taskId: c.req.param("taskId"), title: task.title }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
  return c.json({ ok: true, id: c.req.param("taskId") });
});
app.get("/api/rooms/:id/schedules", (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (c.req.query("limit") || c.req.query("cursor")) {
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const offset = decodeOffsetCursor(c.req.query("cursor"));
    const rows = db.prepare("select * from room_schedules where room_id = ? order by updated_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
    return c.json(offsetPageFromRows(rows.map(roomScheduleFromRow), limit, offset));
  }
  const rows = db.prepare("select * from room_schedules where room_id = ? order by updated_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json(rows.map(roomScheduleFromRow));
});
app.post("/api/rooms/:id/schedules", async (c) => {
  const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  const body = await c.req.json<CreateRoomScheduleRequest>().catch(() => null);
  if (!body?.agentId || !body.taskPrompt?.trim()) return c.json({ error: "invalid_room_schedule" }, 400);
  if (!db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.agentId)) return c.json({ error: "agent_not_in_room" }, 400);
  const now = new Date().toISOString();
  const id = `room-schedule-${randomUUID()}`;
  db.prepare(`
    insert into room_schedules (id, room_id, agent_id, task_prompt, schedule_type, run_at, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, c.req.param("id"), body.agentId, body.taskPrompt.trim(), body.scheduleType, body.runAt ?? null, now, now);
  roomEvent(c.req.param("id"), "schedule.created", { scheduleId: id, scheduleType: body.scheduleType, runAt: body.runAt ?? null }, body.agentId);
  return c.json(roomScheduleFromRow(db.prepare("select * from room_schedules where id = ?").get(id) as Record<string, unknown>), 201);
});
app.delete("/api/rooms/:id/schedules/:scheduleId", (c) => {
  const schedule = db.prepare("select * from room_schedules where id = ? and room_id = ?").get(c.req.param("scheduleId"), c.req.param("id")) as Record<string, unknown> | undefined;
  if (!schedule) return c.json({ error: "room_schedule_not_found" }, 404);
  db.prepare("delete from room_schedules where id = ?").run(c.req.param("scheduleId"));
  roomEvent(c.req.param("id"), "schedule.deleted", { scheduleId: c.req.param("scheduleId") }, String(schedule.agent_id));
  return c.json({ ok: true, id: c.req.param("scheduleId") });
});

app.get("/api/providers", (c) => c.json(appData.providers.map(publicProvider)));
app.post("/api/providers/detect", async (c) => {
  const body = await c.req.json<CreateProviderRequest>().catch(() => null);
  if (!body?.defaultModel || !body.kind) return c.json({ error: "invalid_provider_draft" }, 400);
  const provider: ProviderRecord = {
    id: "draft",
    name: body.name?.trim() || "Draft Provider",
    kind: body.kind,
    defaultModel: body.defaultModel.trim(),
    baseUrl: body.baseUrl?.trim() || undefined,
    apiKey: body.apiKey?.trim() || undefined,
    capabilities: mergeProviderCapabilities(body.kind, body.capabilities),
    rpmLimit: sanitizeProviderRpmLimit(body.rpmLimit),
    rpmLimitEnabled: body.rpmLimitEnabled === true,
    useProxy: body.kind === "openai-responses" && body.useProxy === true,
  };
  return c.json(await detectProviderInterface(provider));
});
app.post("/api/providers/models", async (c) => {
  const body = await c.req.json<CreateProviderRequest>().catch(() => null);
  if (!body?.kind) return c.json({ error: "invalid_provider_draft" }, 400);
  const provider: ProviderRecord = {
    id: "draft",
    name: body.name || "Draft Provider",
    kind: body.kind,
    defaultModel: body.defaultModel || "",
    baseUrl: body.baseUrl?.trim() || undefined,
    apiKey: body.apiKey?.trim() || undefined,
    rpmLimit: sanitizeProviderRpmLimit(body.rpmLimit),
    rpmLimitEnabled: body.rpmLimitEnabled === true,
    useProxy: body.kind === "openai-responses" && body.useProxy === true,
  };
  return c.json(await discoverProviderModels(provider));
});
app.post("/api/providers", async (c) => {
  const body = await c.req.json<CreateProviderRequest>().catch(() => null);
  if (!body?.name || !body.defaultModel || !body.kind) return c.json({ error: "invalid_provider" }, 400);
  if (body.kind === "openai-compatible-chat" && !body.baseUrl?.trim()) return c.json({ error: "base_url_required" }, 400);
  if (body.kind !== "local" && !body.apiKey?.trim()) return c.json({ error: "api_key_required" }, 400);
  const provider: ProviderRecord = {
    id: slugify(body.name),
    name: body.name,
    kind: body.kind,
    defaultModel: body.defaultModel,
    baseUrl: body.baseUrl?.trim() || undefined,
    apiKey: body.apiKey?.trim() || undefined,
    capabilities: mergeProviderCapabilities(body.kind, body.capabilities),
    rpmLimit: sanitizeProviderRpmLimit(body.rpmLimit),
    rpmLimitEnabled: body.rpmLimitEnabled === true,
    useProxy: body.kind === "openai-responses" && body.useProxy === true,
  };
  appData.providers.unshift(provider);
  saveAppData();
  return c.json(publicProvider(provider), 201);
});
app.post("/api/providers/:id/test", async (c) => {
  const provider = appData.providers.find((item) => item.id === c.req.param("id"));
  if (!provider) return c.json({ error: "provider_not_found" }, 404);
  const result = await testProvider(provider);
  recordProviderHealthCheck(provider.id, "test", result);
  if (!result.ok) {
    emitExternalNotification({
      eventType: "provider_check_failed",
      severity: result.status === 429 ? "warning" : "error",
      title: `Provider 测试失败：${provider.name}`,
      message: [result.status ? `HTTP ${result.status}` : null, result.error].filter(Boolean).join(" · ") || "Provider 连接测试失败。",
      sourceType: "provider",
      sourceId: provider.id,
      metadata: { status: result.status, error: result.error, durationMs: result.durationMs },
    });
  }
  return c.json(result);
});
app.post("/api/providers/:id/detect", async (c) => {
  const provider = appData.providers.find((item) => item.id === c.req.param("id"));
  if (!provider) return c.json({ error: "provider_not_found" }, 404);
  const applyDetection = c.req.query("apply") === "1" || c.req.query("apply") === "true";
  const result = await detectProviderInterface(provider);
  recordProviderHealthCheck(provider.id, "test", {
    ok: result.ok,
    providerId: provider.id,
    status: result.checks.responses.ok ? result.checks.responses.status : result.checks.chatCompletions.status,
    durationMs: result.durationMs,
    error: result.error,
  });
  if (result.ok && applyDetection) {
    provider.kind = result.kind;
    provider.capabilities = result.capabilities;
    clearProviderModelCache(provider.id);
    saveAppData();
  }
  return c.json({ provider: publicProvider(provider), detection: result });
});
app.get("/api/providers/:id/models", async (c) => {
  const provider = appData.providers.find((item) => item.id === c.req.param("id"));
  if (!provider) return c.json({ error: "provider_not_found" }, 404);
  const forceRefresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
  const cached = forceRefresh ? null : readProviderModelCache(provider);
  if (cached) return c.json(cached);
  const result = await discoverProviderModels(provider);
  recordProviderHealthCheck(provider.id, "models", result);
  saveProviderModelCache(provider, result);
  return c.json(result);
});
app.get("/api/providers/:id/health", (c) => {
  const provider = appData.providers.find((item) => item.id === c.req.param("id"));
  if (!provider) return c.json({ error: "provider_not_found" }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const rows = db.prepare(`
    select id, provider_id, kind, ok, status, duration_ms, error, checked_at
    from provider_health_checks
    where provider_id = @providerId
      ${cursor ? "and (checked_at < @cursorSort or (checked_at = @cursorSort and id < @cursorId))" : ""}
    order by checked_at desc, id desc
    limit @limit
  `).all({ providerId: provider.id, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return c.json(pageFromRows(rows.map(providerHealthCheckFromRow), limit, (item) => item.checkedAt));
});
app.patch("/api/providers/:id", async (c) => {
  const provider = appData.providers.find((item) => item.id === c.req.param("id"));
  if (!provider) return c.json({ error: "provider_not_found" }, 404);
  const body = await c.req.json<UpdateProviderRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_provider_update" }, 400);
  if (body.name !== undefined) provider.name = body.name;
  if (body.kind !== undefined) provider.kind = body.kind;
  if (body.defaultModel !== undefined) provider.defaultModel = body.defaultModel;
  if (body.baseUrl !== undefined) provider.baseUrl = body.baseUrl.trim() || undefined;
  if (body.apiKey !== undefined) provider.apiKey = body.apiKey.trim() || undefined;
  if (body.capabilities !== undefined || body.kind !== undefined) provider.capabilities = mergeProviderCapabilities(provider.kind, body.capabilities ?? provider.capabilities);
  if (body.rpmLimit !== undefined) provider.rpmLimit = sanitizeProviderRpmLimit(body.rpmLimit);
  if (body.rpmLimitEnabled !== undefined) provider.rpmLimitEnabled = body.rpmLimitEnabled === true;
  if (body.useProxy !== undefined || body.kind !== undefined) provider.useProxy = provider.kind === "openai-responses" && body.useProxy === true;
  if (body.kind !== undefined || body.defaultModel !== undefined || body.baseUrl !== undefined || body.apiKey !== undefined) clearProviderModelCache(provider.id);
  saveAppData();
  return c.json(publicProvider(provider));
});
app.delete("/api/providers/:id", (c) => {
  const index = appData.providers.findIndex((item) => item.id === c.req.param("id"));
  if (index === -1) return c.json({ error: "provider_not_found" }, 404);
  const [provider] = appData.providers.splice(index, 1);
  db.prepare("delete from providers where id = ?").run(provider.id);
  db.prepare("delete from provider_health_checks where provider_id = ?").run(provider.id);
  clearProviderModelCache(provider.id);
  return c.json({ ok: true, id: provider.id });
});

app.get("/api/extensions/skills", (c) => {
  const items = listSkills();
  if (!c.req.query("limit") && !c.req.query("cursor") && !c.req.query("q")) return c.json(items);
  return c.json(pageExtensions(items, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor"), c.req.query("q") ?? ""));
});
app.get("/api/extensions/plugins", (c) => {
  const items = listPlugins();
  if (!c.req.query("limit") && !c.req.query("cursor") && !c.req.query("q")) return c.json(items);
  return c.json(pageExtensions(items, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor"), c.req.query("q") ?? ""));
});
app.get("/api/extensions/mcp", (c) => {
  const items = listMcpServers();
  if (!c.req.query("limit") && !c.req.query("cursor") && !c.req.query("q")) return c.json(items);
  return c.json(pageExtensions(items, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor"), c.req.query("q") ?? ""));
});
app.get("/api/extensions/detail", (c) => {
  try {
    const type = c.req.query("type") as ExtensionSummary["type"] | undefined;
    const name = c.req.query("name") ?? "";
    if (type !== "plugin" && type !== "skill" && type !== "mcp") return c.json({ error: "invalid_extension_type" }, 400);
    return c.json(readExtensionDetail(type, name, c.req.query("path") ?? undefined));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "extension_detail_failed" }, 400);
  }
});

app.get("/api/file-mounts", (c) => {
  return c.json(Array.from(fileMounts.values()));
});
app.post("/api/file-mounts", async (c) => {
  const body = await c.req.json<CreateFileMountRequest>().catch(() => null);
  if (!body?.name || !body?.rootPath) return c.json({ error: "invalid_mount" }, 400);
  const rootPath = normalizeMountPath(body.rootPath);
  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) return c.json({ error: "mount_root_invalid" }, 400);
  const baseId = slugify(body.name);
  let id = baseId;
  let suffix = 2;
  while (fileMounts.has(id)) id = `${baseId}-${suffix++}`;
  const mount: FileMountRecord = {
    id,
    name: body.name,
    rootPath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertFileMount(mount);
  return c.json(mount, 201);
});
app.patch("/api/file-mounts/:id", async (c) => {
  const mount = fileMounts.get(c.req.param("id"));
  if (!mount) return c.json({ error: "mount_not_found" }, 404);
  const body = await c.req.json<UpdateFileMountRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_mount_update" }, 400);
  const nextMount: FileMountRecord = {
    ...mount,
    name: body.name ?? mount.name,
    rootPath: body.rootPath ? normalizeMountPath(body.rootPath) : mount.rootPath,
    updatedAt: new Date().toISOString(),
  };
  if (body.rootPath && (!existsSync(nextMount.rootPath) || !statSync(nextMount.rootPath).isDirectory())) return c.json({ error: "mount_root_invalid" }, 400);
  upsertFileMount(nextMount);
  return c.json(nextMount);
});
app.delete("/api/file-mounts/:id", (c) => {
  try {
    deleteFileMount(c.req.param("id"));
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "mount_delete_failed" }, 400);
  }
});

app.get("/api/files", (c) => {
  try {
    const mount = resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
    const absolutePath = resolveInsideMount(mount, c.req.query("path"));
    const stat = statSync(absolutePath);
    if (!stat.isDirectory()) return c.json({ error: "not_a_directory" }, 400);
    const entries = readdirSync(absolutePath)
      .filter((name) => name !== ".DS_Store")
      .map((name) => toFileEntry(join(absolutePath, name), mount.rootPath))
      .sort((a, b) => a.kind !== b.kind ? a.kind === "directory" ? -1 : 1 : a.name.localeCompare(b.name));
    const response: FileListResponse = {
      mountId: mount.id,
      root: mount.rootPath,
      path: toRelativePath(absolutePath, mount.rootPath),
      parentPath: absolutePath === mount.rootPath ? null : toRelativePath(resolve(absolutePath, ".."), mount.rootPath),
      entries,
    };
    return c.json(response);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "file_list_failed" }, 400);
  }
});
app.get("/api/files/content", (c) => {
  try {
    const mount = resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
    const absolutePath = resolveInsideMount(mount, c.req.query("path"));
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return c.json({ error: "not_a_file" }, 400);
    if (stat.size > 1024 * 1024) return c.json({ error: "file_too_large" }, 413);
    const response: FileContentResponse = {
      path: toRelativePath(absolutePath, mount.rootPath),
      content: readFileSync(absolutePath, "utf8"),
      updatedAt: stat.mtime.toISOString(),
    };
    return c.json(response);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "file_read_failed" }, 400);
  }
});
app.get("/api/files/archive/templates", (c) => c.json(listArchiveIgnoreTemplates(archiveIgnoreTemplateDir)));
app.post("/api/files/archive/preview", async (c) => {
  try {
    const body = await c.req.json<FileArchiveRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "invalid_archive_request" }, 400);
    const mount = resolveFileRequestMount(body.mountId, body.rootPath);
    const absolutePath = resolveInsideMount(mount, body.path);
    const stat = statSync(absolutePath);
    if (!stat.isDirectory()) return c.json({ error: "not_a_directory" }, 400);
    return c.json(previewZipArchive(absolutePath, Array.isArray(body.excludes) ? body.excludes : []));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "archive_preview_failed" }, 400);
  }
});
app.post("/api/files/archive", async (c) => {
  try {
    const body = await c.req.json<FileArchiveRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "invalid_archive_request" }, 400);
    const mount = resolveFileRequestMount(body.mountId, body.rootPath);
    const absolutePath = resolveInsideMount(mount, body.path);
    const stat = statSync(absolutePath);
    if (!stat.isDirectory()) return c.json({ error: "not_a_directory" }, 400);
    const safeName = basename(absolutePath).replaceAll(/[^\w.-]+/g, "-") || "archive";
    const archive = createZipArchive(absolutePath, safeName, Array.isArray(body.excludes) ? body.excludes : []);
    c.header("content-type", "application/zip");
    c.header("content-disposition", `attachment; filename="${safeName}.zip"`);
    return c.body(archive);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "archive_failed" }, 400);
  }
});
app.put("/api/files/content", async (c) => {
  try {
    const mount = resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
    const absolutePath = resolveInsideMount(mount, c.req.query("path"));
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return c.json({ error: "not_a_file" }, 400);
    const body = await c.req.json<SaveFileRequest>().catch(() => null);
    if (typeof body?.content !== "string") return c.json({ error: "invalid_content" }, 400);
    writeFileSync(absolutePath, body.content, "utf8");
    const response: FileContentResponse = {
      path: toRelativePath(absolutePath, mount.rootPath),
      content: body.content,
      updatedAt: statSync(absolutePath).mtime.toISOString(),
    };
    return c.json(response);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "file_write_failed" }, 400);
  }
});
app.post("/api/files", async (c) => {
  try {
    const body = await c.req.json<CreateFileRequest>().catch(() => null);
    if (!body?.parentPath || !body.name || !body.kind) return c.json({ error: "invalid_create_request" }, 400);
    const mount = resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
    const cleanName = body.name.trim();
    if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
    const targetPath = resolveInsideMount(mount, join(body.parentPath, cleanName));
    if (existsSync(targetPath)) return c.json({ error: "already_exists" }, 409);
    if (body.kind === "directory") mkdirSync(targetPath);
    else writeFileSync(targetPath, "", { flag: "wx" });
    return c.json(toFileEntry(targetPath, mount.rootPath), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "file_create_failed" }, 400);
  }
});
app.patch("/api/files", async (c) => {
  try {
    const body = await c.req.json<RenameFileRequest>().catch(() => null);
    if (!body?.path || !body.newName) return c.json({ error: "invalid_rename_request" }, 400);
    const mount = resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
    const sourcePath = resolveInsideMount(mount, body.path);
    const cleanName = body.newName.trim();
    if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
    const targetPath = resolveInsideMount(mount, join(toRelativePath(dirname(sourcePath), mount.rootPath), cleanName));
    if (sourcePath === mount.rootPath) return c.json({ error: "cannot_rename_root" }, 400);
    if (existsSync(targetPath)) return c.json({ error: "already_exists" }, 409);
    renameSync(sourcePath, targetPath);
    return c.json(toFileEntry(targetPath, mount.rootPath));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "file_rename_failed" }, 400);
  }
});
app.delete("/api/files", (c) => {
  try {
    const mount = resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
    const targetPath = resolveInsideMount(mount, c.req.query("path"));
    if (targetPath === mount.rootPath) return c.json({ error: "cannot_delete_root" }, 400);
    rmSync(targetPath, { recursive: true });
    return c.json({ ok: true, path: basename(targetPath) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "file_delete_failed" }, 400);
  }
});

app.get("/api/terminal/sessions", (c) => c.json(listTerminalSessionSummaries()));
app.get("/api/terminal/defaults", (c) => {
  const response: TerminalDefaultsResponse = { defaultCwd: terminalDefaultCwd };
  return c.json(response);
});
app.post("/api/terminal/sessions", async (c) => {
  try {
    const body = await c.req.json<CreateTerminalSessionRequest>().catch(() => ({}));
    const session = createTerminalSession(body);
    return c.json(terminalSummary(session), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "terminal_session_create_failed" }, 400);
  }
});
app.patch("/api/terminal/sessions/:id", async (c) => {
  const body = await c.req.json<UpdateTerminalSessionRequest>().catch(() => null);
  if (!body) return c.json({ error: "invalid_terminal_update" }, 400);
  const nextName = body.name?.trim();
  if (!nextName) return c.json({ error: "terminal_name_required" }, 400);
  const runtime = terminalSessions.get(c.req.param("id"));
  if (runtime) {
    runtime.name = nextName;
    if (!runtime.ephemeral) upsertTerminalSession(terminalSummary(runtime));
    return c.json(terminalSummary(runtime));
  }
  const row = db.prepare("select id, name, cwd, mode, status, created_at from terminal_sessions where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: "terminal_session_not_found" }, 404);
  const session = terminalSessionFromRow(row);
  session.name = nextName;
  upsertTerminalSession(session);
  return c.json(session);
});
app.delete("/api/terminal/sessions/:id", (c) => {
  const session = terminalSessions.get(c.req.param("id"));
  if (!session) {
    deleteTerminalSessionRecord(c.req.param("id"));
    return c.json({ ok: true });
  }
  deletedTerminalSessionIds.add(session.id);
  session.adapter.kill();
  terminalSessions.delete(session.id);
  deleteTerminalSessionRecord(session.id);
  for (const client of session.clients) client.close(1000, "session_deleted");
  return c.json({ ok: true });
});
app.post("/api/terminal/exec", async (c) => {
  try {
    const body = await c.req.json<TerminalCommandRequest>().catch(() => null);
    if (!body?.command?.trim()) return c.json({ error: "command_required" }, 400);
    const cwd = resolveTerminalCwd(body.cwd);
    if (!statSync(cwd).isDirectory()) return c.json({ error: "cwd_not_directory" }, 400);
    return c.json(await runShellCommand(body.command, cwd));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "command_failed" }, 400);
  }
});

const apiServer = serve({ fetch: app.fetch, hostname: host, port: apiPort });
const wsServer = startTerminalWebSocketServer();
const terminalApiWsServer = startTerminalApiWebSocket(apiServer);
const previewWsServer = startPreviewWebSocketProxy(apiServer);
const automationTimer = setInterval(checkScheduledWork, 60_000);
automationTimer.unref();
const telegramInboundTimer = setInterval(pollTelegramInboundBots, 10_000);
telegramInboundTimer.unref();
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(automationTimer);
  clearInterval(telegramInboundTimer);
  console.log(`Codex Web API shutting down after ${signal}`);
  for (const child of codexTaskProcesses.values()) child.kill("SIGTERM");
  for (const previewId of Array.from(new Set([...previewProcesses.keys(), ...previewProcessGroups.keys()]))) stopPreviewProcess(previewId);
  for (const session of terminalSessions.values()) {
    session.adapter.kill();
    for (const client of session.clients) client.close(1001, "server_shutdown");
  }
  wsServer.close();
  terminalApiWsServer.close();
  previewWsServer.close();
  apiServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
console.log(`Codex Web API listening on http://${host}:${apiPort}`);
console.log(`Codex Web workspace root: ${workspaceRoot}`);
