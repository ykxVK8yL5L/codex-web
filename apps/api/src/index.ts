import Database from "better-sqlite3";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fork, spawn as spawnProcess, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty } from "node-pty";
import { generateSecret } from "otplib";
import { WebSocketServer, WebSocket } from "ws";
import { createDingtalkPlatform } from "./platforms/dingtalk.js";
import { createEmailPlatform } from "./platforms/email.js";
import { createFeishuPlatform } from "./platforms/feishu.js";
import { createQQPlatform } from "./platforms/qq.js";
import { createWeComPlatform } from "./platforms/wecom.js";
import { createTelegramPlatform } from "./platforms/telegram.js";
import { createWeixinPlatform } from "./platforms/weixin.js";
import { createAppDataStore } from "./app-data.js";
import { createTaskEventBus, type TaskEvent } from "./tasks/events.js";
import { activityLabel, readActivityEvent, readAssistantText, readFileActivityPath, readTextField, shortenActivityDetail } from "./tasks/activity-parser.js";
import { createTaskStorage } from "./tasks/storage.js";
import { createTaskLogRuntime } from "./tasks/logs.js";
import { setSessionQueueDeps, listQueuedMessages, getQueuedMessage, enqueueMessage, updateQueuedMessage, deleteQueuedMessage, reorderQueuedMessages, popNextQueuedMessage } from "./sessions/queue.js";
import { setSessionMessageDeps, listSessionMessages, allSessionMessages } from "./sessions/messages.js";
import { createSessionMessageRuntime } from "./sessions/runtime.js";
import { createSessionFilesystem } from "./sessions/filesystem.js";
import { createSessionDeletionService } from "./sessions/deletion.js";
import { createSessionCompactionRuntime } from "./sessions/compaction.js";
import {
  activeGoalForOwner,
  activeGoalForSession,
  applyGoalProposal,
  createDefaultGoalPlan,
  createGoal,
  createGoalFocus,
  createGoalItem,
  createGoalProposal,
  createReplanProposal,
  goalActorFromRequest,
  goalDetail,
  goalEventFromRow,
  goalFocusFromRow,
  goalFromRow,
  goalItemFromRow,
  goalMode,
  goalOwnerType,
  goalProposalFromRow,
  goalStatus,
  assertCanManageGoal,
  assertCanUpdateGoalItem,
  recordGoalEvent,
  rejectGoalProposal,
  setGoalStoreDeps,
  updateGoal,
  updateGoalFocus,
  updateGoalItem,
  listGoalProposals,
} from "./goals/index.js";
import { registerGoalRoutes } from "./goals/routes.js";
import {
  deleteFileMount,
  deleteFileMountsForRoot,
  deleteStorageItem,
  listStorageItems,
  loadFileMounts,
  normalizeMountPath,
  pathWithinRoot,
  resolveFileRequestMount,
  resolveInsideMount,
  resolveInsideRoot,
  resolveMountWorkspace,
  setFileStoreDeps,
  toFileEntry,
  toRelativePath,
  upsertFileMount,
  writeProjectWorkspaceMetadata,
} from "./files/index.js";
import { createWorkspacePathService } from "./files/paths.js";
import { registerFileRoutes } from "./files/routes.js";
import {
  agentRunFromRow,
  listRooms,
  publishRoomEvent,
  roomActivitySnapshot,
  roomEventFromRow,
  roomFromRow,
  roomOrchestrationSettings,
  roomScheduleFromRow,
  roomStatus,
  roomTaskFromRow,
  setRoomStoreDeps,
  subscribeRoomEvents,
} from "./rooms/index.js";
import { createRoomRecordService } from "./rooms/records.js";
import {
  createTaskRun,
  finishTaskRun,
  finishTaskRunById,
  latestRunningTaskRun,
  listTaskHealth,
  listTaskRuns,
  listTaskRunsForSession,
  markTaskRunStopRequested,
  setTaskRunStoreDeps,
  taskActivityFromRow,
  taskRunFromRow,
  updateTaskRunPid,
} from "./tasks/runs.js";
import { setApiKeyStoreDeps } from "./auth/api-keys.js";
import { registerApiAuthMiddleware, registerProtectedAuthRoutes, registerPublicAuthRoutes } from "./auth/routes.js";
import { registerAppNotificationRoutes, registerAppNotificationStreamRoute } from "./notifications/app-routes.js";
import { notificationChannels } from "./notifications/channels.js";
import { createNotificationService } from "./notifications/service.js";
import { registerNotificationAccountRoutes, registerNotificationBaseRoutes, registerNotificationRecipientRoutes, registerNotificationRuleRoutes } from "./notifications/routes.js";
import {
  automationCommandTimeoutSeconds,
  automationFromRow,
  automationHasRunningRun,
  automationRuntimeFields,
  automationStatusLabel,
  buildAutomationNotificationMessage,
  cronFieldMatches,
  cronMatches,
  isValidAutomationSchedule,
  nextAutomationRunAt,
  notificationDurationLabel,
  notificationSnippet,
  sanitizeAutomationOverlapPolicy,
  sanitizeAutomationRetryDelayMinutes,
  sanitizeAutomationRetryMax,
  setAutomationStoreDeps,
  shouldRunAutomationNow,
} from "./automations/index.js";
import { createAutomationRuntime } from "./automations/runtime.js";
import { registerAutomationRoutes } from "./automations/routes.js";
import {
  appNotificationFromRow,
  appNotificationUnreadCount,
  createAppNotification,
  getNotificationChannel,
  listAppNotifications,
  listNotificationChannels,
  notificationAccountFromRow,
  notificationChannelFromRow,
  notificationDeliveryFromRow,
  notificationEphemeralRuleFromRow,
  notificationEventTypes,
  notificationLanguageFromConfig,
  notificationLocaleText,
  notificationRecipientFromRow,
  notificationRuleFromRow,
  notificationSeverityRank,
  publicNotificationConfig,
  publishAppNotificationEvent,
  publishAppNotificationsSnapshot,
  sanitizeNotificationPermissions,
  setNotificationStoreDeps,
  subscribeAppNotifications,
} from "./notifications/index.js";
import type {
  ApprovalActionType,
  ApprovalDecisionResponse,
  ApprovalGrantSummary,
  ApprovalRisk,
  ApprovalStatus,
  ApprovalSummary,
  AgentCircleSummary,
  AgentListenMode,
  AgentPermissionSettings,
  AgentRoleSummary,
  AgentRunSummary,
  AgentSummary,
  AppNotificationSummary,
  AppNotificationStreamEvent,
  AppNotificationsResponse,
  ApiKeyDetailResponse,
  ApiKeyPermission,
  ApiKeyPermissionGroup,
  ApiKeyPermissionsResponse,
  ApiKeyPreset,
  ApiKeySummary,
  ArchiveIgnoreTemplate,
  AuthState,
  AutomationRunSummary,
  AutomationSummary,
  CodexRuntimeSettings,
  CodexTaskDetail,
  CodexTaskDiff,
  ContinueCodexTaskRequest,
  CreateCodexTaskRequest,
  CreateAutomationRequest,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
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
  CreateMcpServerRequest,
  CreatePluginRequest,
  CreateProviderRequest,
  ImportSkillRequest,
  ImportSkillResponse,
  ImportMcpServerRequest,
  ImportMcpServerResponse,
  ImportMarketplaceCatalogRequest,
  DeleteMarketplaceItemsRequest,
  InstallMarketplaceItemRequest,
  InstallMarketplaceItemResponse,
  MarketplaceCatalog,
  MarketplaceCatalogItem,
  MarketplaceCatalogResponse,
  UpdateProjectRequest,
  CreateRoomRequest,
  CreateRoomMessageRequest,
  CreateSessionRequest,
  CreateSessionCompactionRequest,
  CreateSkillRequest,
  DeleteSkillRequest,
  UpdateSessionRequest,
  UpdateSkillRequest,
  CreateTerminalSessionRequest,
  ExecutionContextSummary,
  EnvironmentOverview,
  EnvironmentPackageDetailResponse,
  EnvironmentPackageManagerOption,
  EnvironmentPackageRecord,
  EnvironmentBulkActionRequest,
  EnvironmentProjectUsage,
  EnvironmentReconcileItem,
  EnvironmentRestoreMissingRequest,
  EnvironmentRestorePreviewResponse,
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
  NotificationTestSettings,
  TestNotificationAccountRequest,
  UpdateNotificationTestSettingsRequest,
  PageResponse,
  PlatformSettingsResponse,
  WebhookRouteSummary,
  CreatePreviewRequest,
  ProjectStatsSummary,
  ProjectSummary,
  PreviewAccessSettings,
  PayloadRewriteSettings,
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
  TokenUsageRetentionSettings,
  TokenUsageDisplaySettings,
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
import { createAuthHelpers, type AuthConfig } from "./auth/index.js";
import { createApprovalService } from "./auth/approvals.js";
import { createAuthConfigStore } from "./auth/config.js";
import { seedMultiAgentDefaults } from "./agents/defaults.js";
import { createDirectAgentSessionService } from "./agents/direct-sessions.js";
import { createExecutionContextStore } from "./agents/execution-contexts.js";
import { agentPermissions, conversationType, defaultAgentPermissions, listenMode, permissionProfileId, permissionProfiles, previewAccess, projectAccessMode, resolvedAgentPermissions, roleSourceType, workspaceMode } from "./agents/permissions.js";
import { createAgentRoleTemplateService, markdownDescription, markdownTitle, systemPromptWithRoleDescription, type AgentRoleTemplateRecord } from "./agents/role-templates.js";
import { registerAgentCircleRoutes, registerAgentGroupRoutes, registerAgentRoleRoutes, registerAgentRoutes } from "./agents/routes.js";
import { createAgentStore } from "./agents/store.js";
import { archiveExcluder, createZipArchive, createZipArchiveWithEntries, listArchiveIgnoreTemplates, parseStoredZipArchive, previewZipArchive } from "./archive.js";
import { createProjectHistoryService } from "./projects/history.js";
import {
  createRateLimitMiddleware,
  createRateLimitStore,
  decrementProviderProxyConcurrency,
  getProviderProxyConcurrency,
  incrementProviderProxyConcurrency,
} from "./rate-limit.js";
import { createRuntimeSettingsStore } from "./runtime-settings.js";
import { decodePageCursor, pageFromRows, parsePageLimit } from "./pagination.js";
import { registerWebhookRoutes } from "./webhooks/routes.js";
import {
  buildEnvironmentOverview,
  saveEnvironmentOverview,
  setEnvironmentStoreDeps,
} from "./environment/index.js";
import { registerEnvironmentRoutes } from "./environment/routes.js";
import { commandVersion, managedChildEnv, miseCommandCandidates, miseExecVersion, resolveMiseCommand } from "./environment/runtime-utils.js";
import { createExtensionService } from "./extensions/index.js";
import { registerExtensionRoutes } from "./extensions/routes.js";
import { registerProviderRoutes } from "./providers/routes.js";
import { createProviderRuntime } from "./providers/runtime.js";
import { registerPreviewLogStreamRoute, registerPreviewRoutes } from "./previews/routes.js";
import { createPreviewRuntime } from "./previews/runtime.js";
import { cleanupTokenUsageRecords, ensureTokenUsageSchema, readCodexUsage, recordCodexUsage, registerUsageRoutes } from "./usage.js";
import { createPreviewAccessService } from "./previews/access.js";
import { createPreviewLogEventBus } from "./previews/events.js";
import { createPreviewProcessRuntime } from "./previews/processes.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { createProjectGitRuntime } from "./projects/git-runtime.js";
import { createRoomRuntimeService } from "./rooms/runtime.js";
import { registerRoomRoutes } from "./rooms/routes.js";
import { registerSettingsRoutes } from "./settings/routes.js";
import { createSettingsRuntime } from "./settings/runtime.js";
import { jsonArray, jsonPayload } from "./server/json.js";
import { registerServerRoutes } from "./server/routes.js";
import { createDatabaseRecordDeletionService } from "./storage/database-records.js";
import { registerStorageRoutes } from "./storage/routes.js";
import { registerTaskRoutes } from "./tasks/routes.js";
import { registerTerminalRoutes } from "./terminal/routes.js";
import { createTerminalRuntime } from "./terminal/runtime.js";
import { createTerminalCommandRuntime } from "./terminal/commands.js";
import { createWebhookService } from "./webhooks/index.js";

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
seedMultiAgentDefaults(db, agentRoleTemplateDir);
const rateLimitStore = createRateLimitStore(db);
const runtimeSettingsStore = createRuntimeSettingsStore(db, { codexSandboxMode, codexApprovalPolicy, codexBypassSandbox });
const authConfigStore = createAuthConfigStore(db);
const {
  loadAuthConfig,
  saveAuthConfig,
} = authConfigStore;
let authConfig = loadAuthConfig();
const {
  anonymousState,
  authenticatedAuthState,
  getBearerToken,
  hashToken,
  parseCookieHeader,
  providerProxyToken,
  signPreviewAccessToken,
  signSessionToken,
  verifyOtp,
  verifyPreviewAccessToken,
  verifyProviderProxyToken,
  verifySessionToken,
} = createAuthHelpers(() => authConfig, sessionTtlMs);
setApiKeyStoreDeps({
  db,
  hashToken,
  verifySessionToken,
});
const sessionCookieName = "codex_web_session";
let pendingOtpSecret = generateSecret();
let pendingResetOtpSecret: string | null = null;
const authRouteDeps = {
  anonymousState,
  authenticatedAuthState,
  clearSessionCookie,
  emitExternalNotification: (event: any) => emitExternalNotification(event),
  getAuthConfig: () => authConfig,
  getBearerToken,
  getPendingOtpSecret: () => pendingOtpSecret,
  getPendingResetOtpSecret: () => pendingResetOtpSecret,
  hashToken,
  saveAuthConfig,
  sessionCookie,
  setAuthConfig: (config: AuthConfig) => {
    authConfig = config;
  },
  setPendingResetOtpSecret: (secret: string | null) => {
    pendingResetOtpSecret = secret;
  },
  signSessionToken,
  verifyOtp,
  verifySessionToken,
};
const appNotificationRouteDeps = {
  db,
  getBearerToken,
  listAppNotifications,
  parsePageLimit,
  publishAppNotificationEvent,
  publishAppNotificationsSnapshot,
  subscribeAppNotifications,
  verifySessionToken,
};
const environmentRouteDeps = {
  getOverview: () => environmentOverview,
  setOverview: (overview: EnvironmentOverview) => {
    environmentOverview = overview;
  },
};
let appDataProjectsForPaths: ProjectSummary[] = [];
const workspacePathService = createWorkspacePathService({
  getProjects: () => appDataProjectsForPaths,
  projectWorkspaceRoot,
  resolveInsideMount,
  resolveInsideRoot,
  resolveMountWorkspace,
  terminalDefaultCwd,
  terminalRoot,
  toRelativePath,
});
const {
  defaultProjectWorkspacePath,
  resolveChildPath,
  resolveTerminalCwd,
  resolveWorkspacePath,
  slugify,
  toTerminalPath,
  uniqueProjectId,
} = workspacePathService;
const settingsRuntime = createSettingsRuntime({
  archiveExcluder,
  codexHome,
  createZipArchiveWithEntries,
  dataDir,
  db,
  getAppData: () => appData,
  getSystemBackupSettings: () => systemBackupSettings,
  parseStoredZipArchive,
  resolveTerminalCwd,
  runGitSync: (cwd, args) => runGitSync(cwd, args),
  sessionWorkspaceRoot,
});
const {
  backupTimestamp,
  buildSystemBackupManifest,
  createSystemBackupArchive,
  dataBackupEntries,
  defaultSystemBackupSettings,
  loadJsonSetting,
  loadNotificationTestSettings,
  loadSystemBackupSettings,
  pathStats,
  projectBackupReferences,
  pruneCodexSessionProjectTrustEntries,
  readBackupUpload,
  readSystemBackupArchive,
  safeBackupEntryName,
  sanitizeNotificationTestSettings,
  sanitizeSystemBackupSettings,
  saveJsonSetting,
  saveNotificationTestSettings,
  saveSystemBackupSettings,
  systemBackupPreviewFromArchive,
} = settingsRuntime;
let codexRuntimeSettings = runtimeSettingsStore.codexRuntime.load();
let previewAccessSettings = runtimeSettingsStore.previewAccess.load();
let sessionCompactionSettings = runtimeSettingsStore.sessionCompaction.load();
let tokenUsageRetentionSettings = runtimeSettingsStore.tokenUsageRetention.load();
let tokenUsageDisplaySettings = runtimeSettingsStore.tokenUsageDisplay.load();
let payloadRewriteSettings = runtimeSettingsStore.payloadRewrite.load();
let rateLimitSettings = rateLimitStore.load();
let systemBackupSettings = loadSystemBackupSettings();
let notificationTestSettings: NotificationTestSettings;
notificationTestSettings = loadNotificationTestSettings();
let writeSessionMetadataHandler: ((session: SessionSummary) => void) | null = null;
function writeSessionMetadata(session: SessionSummary) {
  writeSessionMetadataHandler?.(session);
}
function earlyTopLevelSessionDataPath(sessionId: string) {
  return resolve(sessionWorkspaceRoot, sessionId);
}
function earlyRoomParentSessionId(roomId: string) {
  const row = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  return row?.session_id ?? null;
}
function earlySessionDataPath(sessionId: string) {
  const row = db.prepare("select conversation_type, room_id from sessions where id = ?").get(sessionId) as { conversation_type?: string | null; room_id?: string | null } | undefined;
  if (row?.conversation_type === "agent" && row.room_id) {
    const parentSessionId = earlyRoomParentSessionId(row.room_id);
    if (parentSessionId && parentSessionId !== sessionId) return resolve(earlyTopLevelSessionDataPath(parentSessionId), "room", "agent-sessions", sessionId);
  }
  return earlyTopLevelSessionDataPath(sessionId);
}
function earlyScratchSessionWorkspacePath(sessionId: string) {
  return resolve(earlySessionDataPath(sessionId), "workspace");
}
function earlyEnsureScratchSessionWorkspace(sessionId: string) {
  const workspacePath = earlyScratchSessionWorkspacePath(sessionId);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}
const appDataStore = createAppDataStore({
  db,
  activeGoalForSession,
  automationFromRow,
  conversationType,
  ensureScratchSessionWorkspace: earlyEnsureScratchSessionWorkspace,
  jsonArray,
  resolveTerminalCwd,
  scratchSessionWorkspacePath: earlyScratchSessionWorkspacePath,
  upsertAutomation,
  upsertProject,
  upsertProvider,
  upsertSession,
});
const {
  defaultProviderCapabilities,
  loadAppData,
  mergeProviderCapabilities,
  projectCheckRunFromRow,
  projectFromRow,
  projectGitOperationFromRow,
  providerFromRow,
  providerHealthCheckFromRow,
  sanitizeProviderRpmLimit,
  sessionFromRow,
  splitProjectCheckCommands,
} = appDataStore;
const appData = loadAppData();
appDataProjectsForPaths = appData.projects;
function saveAppData() {
  appDataStore.saveAppData(appData);
}
const agentStore = createAgentStore({
  db,
  getProjects: () => appData.projects,
  jsonArray,
  agentPermissions,
  listenMode,
  permissionProfileId,
  projectAccessMode,
  roleSourceType,
  workspaceMode,
});
const {
  agentCanAccessProject,
  agentCircleFromRow,
  agentFromRow,
  agentGroupFromRow,
  agentRoleFromRow,
  listAgentCircles,
  listAgentGroups,
  listAgentRoles,
  listAgents,
  normalizeProjectIds,
  resolveAgentProject,
} = agentStore;
const directAgentSessionService = createDirectAgentSessionService({
  db,
  agentFromRow,
  agentRoleFromRow,
});
const { directAgentForSession, promptForDirectAgentSession } = directAgentSessionService;
const executionContextStore = createExecutionContextStore({
  db,
  agentPermissions,
  permissionProfileId,
});
const { executionContextFromRow, recordExecutionContext } = executionContextStore;
const roomRecordService = createRoomRecordService({
  db,
  jsonPayload,
  roomEvent,
});
const {
  createRoomArtifact,
  createRoomDecision,
  createRoomHandoff,
  roomArtifactFromRow,
  roomDecisionFromRow,
  roomHandoffFromRow,
  roomHandoffStatus,
} = roomRecordService;
const notificationService = createNotificationService({
  appData,
  db,
  host,
  notificationChannels,
  dingtalkPlatform: {
    sendNotification: (...args: any[]) => dingtalkPlatform.sendNotification(...args as [any, any]),
  },
  feishuPlatform: {
    sendNotification: (...args: any[]) => feishuPlatform.sendNotification(...args as [any, any, any]),
  },
  qqPlatform: {
    sendNotification: (...args: any[]) => qqPlatform.sendNotification(...args as [any, any, any]),
  },
  sendEmailNotification: (...args: any[]) => sendEmailNotification(...args as [any, any]),
  wecomPlatform: {
    sendNotification: (...args: any[]) => wecomPlatform.sendNotification(...args as [any, any, any]),
  },
  weixinPlatform: {
    sendNotification: (...args: any[]) => weixinPlatform.sendNotification(...args as [any, any, any]),
  },
});
const {
  cleanupNotificationTargetsForDeletedReferences,
  createExternalNotification,
  createNotificationEphemeralRule,
  deleteNotificationAccount,
  deliverNotification,
  deliverNotificationToRecipient,
  emitExternalNotification,
  listAllNotificationRules,
  listNotificationAccounts,
  listNotificationDeliveries,
  listNotificationEphemeralRules,
  listNotificationRecipients,
  listNotificationRules,
  parseJsonValue,
  parseWebhookPayload,
  readNotificationRecipients,
  registerEphemeralNotificationsFromPrompt,
  sanitizeNotificationConfig,
  sanitizeNotificationTargets,
  sendNotificationToAccount,
  sendWebhookNotification,
  syncDefaultNotificationRecipients,
  syncTelegramBotCommands,
  validateWebhookToken,
} = notificationService;
const approvalService = createApprovalService({
  db,
  emitExternalNotification,
  saveCodexRuntimeSettings: (settings) => runtimeSettingsStore.codexRuntime.save(settings),
  setCodexRuntimeSettings: (settings) => {
    codexRuntimeSettings = settings;
  },
});
const {
  approvalAlwaysAllowed,
  archiveApproval,
  applyCodexRuntimeSettings,
  codexRuntimeDetails,
  codexRuntimeRisk,
  createApproval,
  createPreviewApproval,
  createProjectDeleteApproval,
  createProjectGitApproval,
  createRoomRunMergeApproval,
  getApproval,
  listApprovalGrants,
  listApprovals,
  previewCommandRisk,
  publicApproval,
  resolveApproval,
  restoreApproval,
  saveApprovalGrant,
  stableJson,
} = approvalService;
const providerRuntime = createProviderRuntime({
  db,
  providerTimeoutMs,
  providerModelsCacheTtlMs,
  defaultProviderCapabilities,
  mergeProviderCapabilities,
  stableJson,
  stringifyReadable,
  getPayloadRewriteRules: () => payloadRewriteSettings.rules,
});
const {
  clearProviderModelCache,
  detectProviderInterface,
  discoverProviderModels,
  joinUrl,
  proxyResponsesToChatCompletions,
  proxyResponsesToResponses,
  publicProvider,
  readProviderModelCache,
  recordProviderHealthCheck,
  saveProviderModelCache,
  testProvider,
} = providerRuntime;

const sessionFilesystem = createSessionFilesystem({
  appData,
  dataDir,
  db,
  ensureGitRepositorySync: (workspacePath) => ensureGitRepositorySync(workspacePath),
  resolveTerminalCwd,
  runGitSync: (cwd, args) => runGitSync(cwd, args),
  sessionWorkspaceRoot,
  upsertSession,
});
const {
  attachmentMarkdown,
  ensureRoomRunWorkspace,
  ensureRoomWorkspace,
  ensureScratchSessionWorkspace,
  messageWithAttachments,
  migrateLegacyScratchSessionWorkspace,
  migrateRoomAgentSessionDataRoots,
  migrateRoomWorkspaceRoots,
  promptWithAttachments,
  resetSessionContextFiles,
  resolveSessionWorkspace,
  roomParentSessionId,
  roomWorkspaceDataPath,
  saveSessionAttachments,
  scratchSessionWorkspacePath,
  sessionAttachmentsPath,
  sessionCodexMetadataPath,
  sessionContextPath,
  sessionDataPath,
  sessionLogsPath,
  sessionMemoryPath,
  topLevelSessionDataPath,
  writeSessionContextFile,
  writeSessionMetadata: writeSessionMetadataFromFilesystem,
} = sessionFilesystem;
writeSessionMetadataHandler = writeSessionMetadataFromFilesystem;
const notificationBaseRouteDeps = {
  appData,
  cleanupNotificationTargetsForDeletedReferences,
  deleteNotificationAccount,
  db,
  deliverNotification,
  deliverNotificationToRecipient,
  getNotificationChannel,
  getNotificationChannels: () => notificationChannels,
  getNotificationTestSettings: () => notificationTestSettings,
  createNotificationEphemeralRule,
  listNotificationAccounts,
  listNotificationChannels,
  listNotificationDeliveries,
  listNotificationEphemeralRules,
  listNotificationRecipients,
  listNotificationRules,
  listWebhookRoutes: () => listWebhookRoutes(),
  notificationAccountFromRow,
  notificationAccountHelpText: (account: NotificationAccountSummary) =>
    account.channelKind === "telegram"
      ? telegramPlatform.telegramHelpText(account)
      : account.channelKind === "weixin"
        ? weixinPlatform.weixinHelpText(account)
        : account.channelKind === "wecom"
          ? wecomPlatform.wecomHelpText(account)
          : account.channelKind === "dingtalk"
            ? dingtalkPlatform.dingtalkHelpText(account)
            : account.channelKind === "feishu"
              ? feishuPlatform.feishuHelpText(account)
              : account.channelKind === "qq"
                ? qqPlatform.qqHelpText(account)
                : "",
  notificationChannelFromRow,
  notificationLanguageFromConfig,
  notificationLocaleText: (language: string, zh: string, en: string) => notificationLocaleText(language === "zh-CN" ? "zh-CN" : "en-US", zh, en),
  notificationDeliveryFromRow,
  notificationEphemeralRuleFromRow,
  notificationEventTypes,
  notificationRuleFromRow,
  notificationSeverityRank,
  notificationRecipientFromRow,
  parseJsonValue,
  platformSyncConnections: () => {
    void Promise.resolve(feishuPlatform.syncConnections()).catch((error: unknown) => console.warn("feishu sync failed", error));
    void Promise.resolve(wecomPlatform.syncConnections()).catch((error: unknown) => console.warn("wecom sync failed", error));
    void Promise.resolve(qqPlatform.syncConnections()).catch((error: unknown) => console.warn("qq sync failed", error));
  },
  recipientHelpText: (kind: NotificationRecipientSummary["kind"]) =>
    kind === "telegram"
      ? telegramPlatform.telegramHelpText({ config: { language: "en-US" } } as unknown as NotificationAccountSummary)
      : kind === "weixin"
        ? weixinPlatform.weixinHelpText({ config: { language: "en-US" } } as unknown as NotificationAccountSummary)
        : kind === "wecom"
          ? wecomPlatform.wecomHelpText({ config: { language: "en-US" } } as unknown as NotificationAccountSummary)
          : kind === "dingtalk"
            ? dingtalkPlatform.dingtalkHelpText({ config: { language: "en-US" } } as unknown as NotificationAccountSummary)
            : kind === "qq"
              ? qqPlatform.qqHelpText({ config: { language: "en-US" } } as unknown as NotificationAccountSummary)
              : kind === "feishu"
                ? feishuPlatform.feishuHelpText({ config: { language: "en-US" } } as unknown as NotificationAccountSummary)
                : "",
  sanitizeNotificationPermissions,
  sanitizeNotificationConfig,
  sanitizeNotificationTargets,
  syncTelegramBotCommands,
  wecomConnectionStatus: (account: NotificationAccountSummary) => wecomPlatform.connectionStatus(account),
  weixinGetQrLoginState: (key: string) => weixinPlatform.getQrLoginState(key),
  weixinRefreshQrLogin: (key: string) => weixinPlatform.refreshQrLogin(key),
  weixinStartDraftQrLogin: (botType: string) => weixinPlatform.startDraftQrLogin(botType),
  weixinStartQrLogin: (accountId: string, botType: string) => weixinPlatform.startQrLogin(accountId, botType),
};
const webhookService = createWebhookService({
  appData,
  db,
  host,
  listAgents,
  listRooms,
});
const {
  listWebhookAgentSummaries,
  listWebhookRoomSummaries,
  listWebhookRoutes,
  listWebhookSessionSummaries,
  normalizeWebhookRouteSecret,
  slugifyWebhookRouteName,
  upsertWebhookRoute,
  webhookRouteFromRow,
  webhookSecretIsSafe,
} = webhookService;
const webhookRouteDeps = {
  appData,
  db,
  dispatchMessageToSession,
  listWebhookAgentSummaries,
  listWebhookRoomSummaries,
  listWebhookRoutes,
  listWebhookSessionSummaries,
  normalizeWebhookRouteSecret,
  parsePageLimit,
  parseWebhookPayload,
  slugifyWebhookRouteName,
  upsertWebhookRoute,
  validateWebhookToken,
  webhookRouteFromRow,
  webhookSecretIsSafe,
};
const goalRouteDeps = {
  applyGoalProposal,
  assertCanManageGoal,
  assertCanUpdateGoalItem,
  createDefaultGoalPlan,
  createGoal,
  createGoalFocus,
  createGoalItem,
  createGoalProposal,
  db,
  goalActorFromRequest,
  goalDetail,
  goalEventFromRow,
  goalFromRow,
  goalItemFromRow,
  goalOwnerType,
  listGoalProposals,
  orchestrateRoom,
  recordGoalEvent,
  rejectGoalProposal,
  roomEvent,
  roomTaskFromRow,
  updateGoal,
  updateGoalFocus,
  updateGoalItem,
};
const extensionService = createExtensionService({
  codexHome,
  loadJsonSetting,
  saveJsonSetting,
  slugify,
});
const extensionRouteDeps = extensionService;
const terminalCommandRuntime = createTerminalCommandRuntime({
  managedChildEnv,
  toTerminalPath,
});
const { formatShellCommandOutput, runShellCommand } = terminalCommandRuntime;
const projectGitRuntime = createProjectGitRuntime({
  appData,
  db,
  deletePreviewsForScope: (scopeType, scopeId) => deletePreviewsForScope(scopeType, scopeId),
  ensureScratchSessionWorkspace,
  managedChildEnv,
  resolveSessionCwd,
  resolveTerminalCwd,
  saveAppData,
  terminalRoot,
  upsertProject,
  upsertSession,
  writeProjectWorkspaceMetadata,
});
const {
  applyWorkspaceGitFileAction,
  assertWorkspaceChangePath,
  collectRoomWorkspaceChanges,
  collectWorkspaceChanges,
  collectWorkspaceChangesForCwd,
  deleteProjectRecord,
  ensureGitRepositoryForProject,
  ensureGitRepositorySync,
  hasGitCommand,
  parseNumstat,
  parseShortStatusLine,
  readGitRemoteStatus,
  readTextFileIfSmall,
  refreshProjectGitStatus,
  resolveWorkspaceChangeActionCwd,
  runGitCommand,
} = projectGitRuntime;
const projectHistoryService = createProjectHistoryService({
  db,
  projectCheckRunFromRow,
  projectGitOperationFromRow,
  resolveTerminalCwd,
  runGitSync: (cwd, args) => runGitSync(cwd, args),
});
const {
  listProjectCheckRuns,
  listProjectGitOperations,
  projectGitArgs,
  runProjectGitOperation,
  saveProjectCheckRun,
  saveProjectGitOperation,
} = projectHistoryService;
const projectRouteDeps = {
  appData,
  applyWorkspaceGitFileAction,
  approvalAlwaysAllowed,
  assertWorkspaceChangePath,
  collectWorkspaceChangesForCwd,
  createProjectDeleteApproval,
  createProjectGitApproval,
  defaultProjectWorkspacePath,
  deleteProjectRecord,
  ensureGitRepositoryForProject,
  listProjectCheckRuns,
  listProjectGitOperations,
  getPreviews: () => previews,
  projectGitArgs,
  publicApproval,
  refreshProjectGitStatus,
  resolveTerminalCwd,
  runGitCommand,
  runProjectGitOperation,
  runShellCommand,
  saveAppData,
  saveProjectCheckRun,
  saveProjectGitOperation,
  splitProjectCheckCommands,
  uniqueProjectId,
  upsertProject,
  writeProjectWorkspaceMetadata,
};
const agentRoleTemplateService = createAgentRoleTemplateService(agentRoleTemplateDir);
const {
  listAgentRoleTemplates,
  publicAgentRoleTemplate,
} = agentRoleTemplateService;
const agentRouteDeps = {
  agentCanAccessProject,
  agentCircleFromRow,
  agentFromRow,
  agentGroupFromRow,
  agentPermissions,
  agentRoleFromRow,
  appData,
  createAgentGroupFromCircle,
  db,
  getDefaultAgentPermissions: () => defaultAgentPermissions,
  ensureScratchSessionWorkspace,
  jsonArray,
  listenMode,
  listAgentCircles,
  listAgentGroups,
  listAgentRoleTemplates,
  listAgentRoles,
  listAgents,
  markdownDescription,
  markdownTitle,
  normalizeProjectIds,
  permissionProfileId,
  getPermissionProfiles: () => permissionProfiles,
  projectAccessMode,
  publicAgentRoleTemplate,
  replaceGroupMembers,
  resolveAgentProject,
  resolveTerminalCwd,
  roleSourceType,
  sessionFromRow,
  slugify,
  systemPromptWithRoleDescription,
  upsertSession,
  workspaceMode,
};
const sessionMessageRuntime = createSessionMessageRuntime({
  db,
  appData,
  previews: () => previews,
  discoverPreviewUrls: (session, value) => discoverPreviewUrls(session, value),
  publicPreview: (preview) => publicPreview(preview),
  forwardAssistantMessageToEmail: (session, message) => forwardAssistantMessageToEmail(session, message),
  forwardAssistantMessageToTelegram: (session, message) => forwardAssistantMessageToTelegram(session, message),
  feishuPlatform: () => feishuPlatform,
  wecomPlatform: () => wecomPlatform,
  qqPlatform: () => qqPlatform,
  weixinPlatform: () => weixinPlatform,
});
const {
  appendMessageCard,
  appendSessionMessage,
  appendUrlCardsForMessage,
  deleteSessionMessages,
  dismissMessageCard,
  ensureSessionUrlCards,
  getSessionMessage,
  isMessageCardDismissed,
  listSessionCards,
  messageCardFromRow,
  messageFromRow,
  promptWithReplyContext,
  syncRoomMessagesToSession,
} = sessionMessageRuntime;
const previewLogEventBus = createPreviewLogEventBus();
const { publishPreviewLogEvent, subscribePreviewLogEvents } = previewLogEventBus;
const previewRuntime = createPreviewRuntime({
  db,
  appendMessageCard,
  appendPreviewLog: (previewId, value) => appendPreviewLog(previewId, value),
  getPreviewAccessSettings: () => previewAccessSettings,
  isMessageCardDismissed,
  latestExecutionContextForSession: (sessionId) => latestExecutionContextForSession(sessionId),
  previewAccess,
  publishPreviewLogEvent,
  resolveApproval,
  stopPreviewProcess: (previewId) => stopPreviewProcess(previewId),
});
const {
  deletePreview,
  deletePreviewsForScope,
  discoverPreviewUrls,
  expirePreviewAccessRequests,
  insertPreview,
  loadPreviewAccessRequests,
  loadPreviewLogs,
  loadPreviews,
  normalizePreviewProxyPaths,
  previewAccessRequestFromRow,
  previewAccessRequests,
  previewFromRow,
  previewLogs,
  previews,
  previewUrl,
  publicPreview,
  shouldIgnoreDiscoveredPreviewUrl,
  updatePreview,
  upsertPreviewAccessRequest,
} = previewRuntime;
const previewAccessService = createPreviewAccessService({
  createApproval,
  expirePreviewAccessRequests,
  getBearerToken,
  parseCookieHeader,
  previewAccessRequests,
  previewUrl,
  sessionCookieName,
  signPreviewAccessToken,
  upsertPreviewAccessRequest,
  verifyPreviewAccessToken,
  verifySessionToken,
});
const {
  createPreviewAccessRequest,
  getPreviewAccessRequest,
  previewAccessCookie,
  privatePreviewAccessResponse,
  requestHasPreviewAccess,
} = previewAccessService;
const databaseRecordDeletionService = createDatabaseRecordDeletionService({
  db,
  deletePreviewsForScope,
  deleteSessionMessages,
});
const { deleteRoomDatabaseRows, deleteSessionDatabaseRows } = databaseRecordDeletionService;
const taskLogRuntime = createTaskLogRuntime({
  db,
  readTaskLogContent: (sessionId) => readTaskLogContent(sessionId),
  sessionLogsPath,
  taskLogDir,
});
const {
  legacyTaskLogPath,
  legacyTaskMetaPath,
  readRoomTaskLogContent,
  roomAgentRunLogSources,
  taskLogPath,
  taskMetaPath,
} = taskLogRuntime;
const sessionDeletionService = createSessionDeletionService({
  dataDir,
  deleteFileMountsForRoot,
  legacyTaskLogPath,
  legacyTaskMetaPath,
  pathWithinRoot,
  roomWorkspaceDataPath,
  sessionContextPath,
  sessionDataPath,
  sessionWorkspaceRoot,
  taskLogPath,
  taskMetaPath,
});
const { deleteSessionData } = sessionDeletionService;
const sessionCompactionRuntime = createSessionCompactionRuntime({
  allSessionMessages,
  appendSessionMessage,
  appendCodexErrorOutput: (session, value) => appendCodexErrorOutput(session, value),
  appData,
  db,
  getSessionCompactionSettings: () => sessionCompactionSettings,
  getPayloadRewriteRules: () => payloadRewriteSettings.rules,
  joinUrl,
  publishTaskEvent: (sessionId, event) => publishTaskEvent(sessionId, event),
  recordTaskActivity: (sessionId, activity) => recordTaskActivity(sessionId, activity),
  sessionMemoryPath,
});
const {
  createSessionCompaction,
  latestSessionCompaction,
  latestSessionMemoryMarkdown,
  listSessionCompactions,
  messagesAfterCompaction,
  restoreSessionCompaction,
  scheduleSessionAutoCompaction,
  sessionCompactionFromRow,
  sessionCompactionPrompt,
  shouldAutoCompactSession,
  updateLatestSessionCompaction,
} = sessionCompactionRuntime;
const previewProcessRuntime = createPreviewProcessRuntime({
  apiPort,
  appData,
  db,
  host,
  managedChildEnv,
  previewLogs,
  previews,
  previewUrl,
  publishPreviewLogEvent,
  toTerminalPath,
  updatePreview,
});
const {
  appendPreviewLog,
  isPreviewReachable,
  markPreviewRunningIfReachable,
  previewFromReferer,
  previewProcessGroups,
  previewProcesses,
  previewScopeWorkspace,
  previewUpstreamPathFromUrl,
  previewUsingPort,
  resolvePreviewCwd,
  rewritePreviewCss,
  rewritePreviewHtml,
  rewritePreviewLocation,
  rewritePreviewText,
  settlePreviewProcessExit,
  startPreviewProcess,
  stopPreviewProcess,
  validPreviewHost,
  waitForPreviewReady,
} = previewProcessRuntime;
const roomRuntimeService = createRoomRuntimeService({
  agentFromRow,
  agentPermissionsForRun: resolvedAgentPermissions,
  agentGroupFromRow,
  agentRoleFromRow,
  agentRunFromRow,
  allSessionMessages,
  appendCodexOutput: (sessionId: string, value: string) => appendCodexOutput(sessionId, value),
  appendMessageCard,
  appData,
  appendSessionMessage,
  createRoomArtifact,
  createGoalItem,
  createRoomDecision,
  db,
  deleteSessionMessages,
  directAgentForSession,
  ensureRoomRunWorkspace,
  ensureScratchSessionWorkspace,
  executionContextFromRow,
  finishTaskRun,
  finishTaskRunById,
  goalFromRow,
  getCodexTaskStopRequested: () => codexTaskStopRequested,
  getDefaultAgentPermissions: () => defaultAgentPermissions,
  groupContextForRoom,
  jsonPayload,
  latestRunningTaskRun,
  markTaskRunStopRequested,
  managedChildEnv,
  messageFromRow,
  orchestrateRoom,
  publishTaskEvent: (sessionId: string, event: TaskEvent) => publishTaskEvent(sessionId, event),
  publicApproval,
  readCodexOutput,
  readRoomAgentThread,
  recentRoomContext,
  resolveAgentProject,
  resolveTerminalCwd,
  roomAgentsWithListenModes,
  roomEvent,
  roomFromRow,
  roomTaskFromRow,
  saveAppData,
  saveProjectCheckRun,
  scheduleSessionAutoCompaction,
  splitProjectCheckCommands,
  startCodexTask,
  taskLogPath,
  toTerminalPath,
  updateGoalItem,
  upsertSession,
});
const {
  agentPermissionsForRun,
  applyRoomRunMerge,
  finishAgentRun,
  latestExecutionContextForSession,
  mentionsRoomUser,
  roomGroupForRoom,
  roomProject,
  roomTaskShouldNotifyUser,
  runGitSync,
  setRoomParentSessionStatus,
  startRoomTaskRun,
  stopOrphanRoomAgentRun,
} = roomRuntimeService;
const automationRuntime = createAutomationRuntime({
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
  publishTaskEvent: (sessionId: string, event: TaskEvent) => publishTaskEvent(sessionId, event),
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
});
const {
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
} = automationRuntime;
const roomRouteDeps = {
  agentCircleFromRow,
  agentGroupFromRow,
  agentPermissionsForRun,
  agentRunFromRow,
  appData,
  appendMessageCard,
  appendSessionMessage,
  applyRoomRunMerge,
  approvalAlwaysAllowed,
  autoListenAgentsForRoomMessage,
  getCodexTaskProcesses: () => codexTaskProcesses,
  getCodexTaskStopRequested: () => codexTaskStopRequested,
  createAgentGroupFromCircle,
  createGoal,
  createRoomArtifact,
  createRoomDecision,
  createRoomHandoff,
  createRoomRunMergeApproval,
  db,
  ensureScratchSessionWorkspace,
  insertRoomTask,
  isProcessAlive,
  listenMode,
  listRooms,
  markTaskRunStopRequested,
  mentionedRoomAgents,
  mentionsRoomUser,
  messageWithAttachments,
  orchestrateRoom,
  promptWithAttachments,
  publicApproval,
  resolveTerminalCwd,
  roomAgentsWithListenModes,
  roomArtifactFromRow,
  roomDecisionFromRow,
  roomEvent,
  roomEventFromRow,
  roomFromRow,
  roomGroupForRoom,
  roomHandoffFromRow,
  roomHandoffStatus,
  roomOrchestrationSettings,
  roomProject,
  roomScheduleFromRow,
  roomStatus,
  roomTaskFromRow,
  runGitSync,
  saveSessionAttachments,
  startRoomTaskRun,
  stopOrphanRoomAgentRun,
  upsertSession,
  updateGoalItem,
};
const taskRouteDeps = {
  allSessionMessages,
  appendCodexErrorOutput,
  appendSessionMessage,
  applyWorkspaceGitFileAction,
  appData,
  assertWorkspaceChangePath,
  backfillRoomActivitiesFromAgentLogs,
  backfillSessionFromTaskLog,
  backfillTaskActivitiesFromLog,
  clearCodexTaskRuntime,
  collectWorkspaceChanges,
  collectWorkspaceChangesForCwd,
  conversationType,
  createGoal,
  createNotificationEphemeralRule,
  createSessionCompaction,
  db,
  deletePreview,
  deleteQueuedMessage,
  deleteRoomDatabaseRows,
  deleteSessionData,
  deleteSessionDatabaseRows,
  deleteSessionMessages,
  dismissMessageCard,
  enqueueMessage,
  ensureScratchSessionWorkspace,
  executionContextFromRow,
  getCodexTaskProcesses: () => codexTaskProcesses,
  getCodexTaskStopRequested: () => codexTaskStopRequested,
  getPreviews: () => previews,
  isProcessAlive,
  latestRunningTaskRun,
  latestSessionCompaction,
  listQueuedMessages,
  listRoomTaskContextFiles,
  listSessionCards,
  listSessionCompactions,
  listSessionMessages,
  listTaskActivities,
  listTaskContextFiles,
  listTaskRuns,
  listTaskRunsForSession,
  markTaskRunStopRequested,
  messageWithAttachments,
  promptForDirectAgentSession,
  promptWithAttachments,
  promptWithReplyContext,
  publicPreview,
  readCodexOutput,
  readRoomTaskContextFile,
  readRoomTaskLogContent,
  readTaskContextFile,
  readTaskErrorSummary,
  getReadTaskLogContent: () => readTaskLogContent,
  reorderQueuedMessages,
  resolveSessionCwd,
  resolveTerminalCwd,
  resolveWorkspaceChangeActionCwd,
  restoreCodexSessionIdFromLog,
  restoreSessionCompaction,
  runGitCommand,
  saveAppData,
  saveSessionAttachments,
  sessionAttachmentsPath,
  sessionHasExistingAutomationOwner,
  startCodexTask,
  updateLatestSessionCompaction,
  updateQueuedMessage,
  upsertSession,
  writeSessionMetadata,
};
const settingsRouteDeps = {
  appData,
  applyCodexRuntimeSettings,
  applyRoomRunMerge,
  archiveExcluder,
  archiveApproval,
  backupTimestamp,
  cleanupDatabaseRedundancy,
  codexRuntimeSettings,
  codexRuntimeDetails,
  codexRuntimeRisk,
  createApproval,
  createRoomDecision,
  createSystemBackupArchive,
  createZipArchive,
  createZipArchiveWithEntries,
  dataDir,
  db,
  deleteProjectRecord,
  dirname,
  emitExternalNotification,
  expirePreviewAccessRequests,
  getApproval,
  getCodexRuntimeSettings: () => codexRuntimeSettings,
  getNotificationTestSettings: () => notificationTestSettings,
  getPreviewAccessRequests: () => previewAccessRequests,
  getPreviewAccessSettings: () => previewAccessSettings,
  getRateLimitSettings: () => rateLimitSettings,
  getSessionCompactionSettings: () => sessionCompactionSettings,
  getTokenUsageDisplaySettings: () => tokenUsageDisplaySettings,
  getTokenUsageRetentionSettings: () => tokenUsageRetentionSettings,
  getPayloadRewriteSettings: () => payloadRewriteSettings,
  getSystemBackupSettings: () => systemBackupSettings,
  join,
  listApprovalGrants,
  listApprovals,
  listArchiveIgnoreTemplates,
  listTaskHealth,
  mkdirSync,
  getAppNotificationRouteDeps: () => appNotificationRouteDeps,
  getEnvironmentRouteDeps: () => environmentRouteDeps,
  getNotificationBaseRouteDeps: () => notificationBaseRouteDeps,
  getStorageRouteDeps: () => storageRouteDeps,
  getWebhookRouteDeps: () => webhookRouteDeps,
  parseStoredZipArchive,
  previewZipArchive,
  publicApproval,
  publicPreview,
  readBackupUpload,
  readSystemBackupArchive,
  rateLimitStore,
  registerAppNotificationRoutes,
  registerEnvironmentRoutes,
  registerNotificationAccountRoutes,
  registerNotificationBaseRoutes,
  registerNotificationRecipientRoutes,
  registerNotificationRuleRoutes,
  registerStorageRoutes,
  registerWebhookRoutes,
  repairTaskHealth,
  restoreApproval,
  resolveApproval,
  runtimeSettingsStore,
  runProjectGitOperation,
  sanitizeNotificationTestSettings,
  sanitizeSystemBackupSettings,
  saveApprovalGrant,
  saveNotificationTestSettings,
  saveSystemBackupSettings,
  setCodexRuntimeSettings: (next: CodexRuntimeSettings) => {
    codexRuntimeSettings = next;
  },
  setNotificationTestSettings: (next: NotificationTestSettings) => {
    notificationTestSettings = next;
  },
  setPreviewAccessSettings: (next: PreviewAccessSettings) => {
    previewAccessSettings = next;
  },
  setRateLimitSettings: (next: RateLimitSettings) => {
    rateLimitSettings = next;
  },
  setSessionCompactionSettings: (next: SessionCompactionSettings) => {
    sessionCompactionSettings = next;
  },
  setTokenUsageRetentionSettings: (next: TokenUsageRetentionSettings) => {
    tokenUsageRetentionSettings = next;
  },
  setTokenUsageDisplaySettings: (next: TokenUsageDisplaySettings) => {
    tokenUsageDisplaySettings = next;
  },
  setPayloadRewriteSettings: (next: PayloadRewriteSettings) => {
    payloadRewriteSettings = next;
  },
  setSystemBackupSettings: (next: SystemBackupSettings) => {
    systemBackupSettings = next;
  },
  approvalAlwaysAllowed,
  pathWithinRoot,
  getPreviews: () => previews,
  rmSync,
  systemBackupPreviewFromArchive,
  markPreviewRunningIfReachable,
  startPreviewProcess,
  updatePreview,
  upsertPreviewAccessRequest,
  writeFileSync,
};
const serverRouteDeps = {
  allSessionMessages,
  appData,
  appNotificationRouteDeps,
  authRouteDeps,
  createPreviewAccessRequest,
  decrementProviderProxyConcurrency,
  expirePreviewAccessRequests,
  getBearerToken,
  getPreviews: () => previews,
  getPreviewAccessRequest,
  getProviderProxyConcurrency,
  getRateLimitSettings: () => rateLimitSettings,
  incrementProviderProxyConcurrency,
  listQueuedMessages,
  previewAccessCookie,
  previewFromReferer,
  getPreviewRouteDeps: () => previewRouteDeps,
  previewUpstreamPathFromUrl,
  previewUrl,
  privatePreviewAccessResponse,
  proxyPreviewHttpRequest,
  proxyResponsesToChatCompletions,
  proxyResponsesToResponses,
  readCodexOutput,
  registerAppNotificationStreamRoute,
  registerPreviewLogStreamRoute,
  registerPublicAuthRoutes,
  requestHasPreviewAccess,
  roomActivitySnapshot,
  subscribeRoomEvents,
  getSubscribeTaskEvents: () => subscribeTaskEvents,
  verifyProviderProxyToken,
  verifySessionToken,
};
const providerRouteDeps = {
  appData,
  clearProviderModelCache,
  db,
  detectProviderInterface,
  discoverProviderModels,
  emitExternalNotification,
  mergeProviderCapabilities,
  providerHealthCheckFromRow,
  publicProvider,
  readProviderModelCache,
  recordProviderHealthCheck,
  sanitizeProviderRpmLimit,
  saveAppData,
  saveProviderModelCache,
  slugify,
  testProvider,
};
setRoomStoreDeps({
  db,
  activeGoalForOwner,
  allSessionMessages,
});
setGoalStoreDeps({
  db,
  findSessionById: (sessionId) => appData.sessions.find((item) => item.id === sessionId),
});
const terminalRuntime = createTerminalRuntime({
  db,
  managedChildEnv,
  resolveTerminalCwd,
  toTerminalPath,
});
const {
  closePersistedRunningTerminals,
  createTerminalSession,
  deletedTerminalSessionIds,
  deleteTerminalSessionRecord,
  listTerminalSessionSummaries,
  markTerminalClosed,
  resolveShellPath,
  terminalSessionFromRow,
  terminalSessions,
  terminalSummary,
  upsertTerminalSession,
} = terminalRuntime;
setSessionMessageDeps({
  db,
  messageFromRow,
  findSessionById: (sessionId) => appData.sessions.find((item) => item.id === sessionId),
  syncRoomMessagesToSession,
});
const emailPlatform = createEmailPlatform({
  db,
  sessions: appData.sessions,
  listNotificationAccounts,
  dispatchMessageToSession,
  createInboundSession: createInboundEmailSession,
});
const telegramPlatform = createTelegramPlatform({
  db,
  sessions: appData.sessions,
  sessionVisibleInChatTools,
  providers: appData.providers,
  listNotificationAccounts,
  dispatchMessageToSession,
  workspaceRoot,
  resolveShellPath,
  managedChildEnv,
  spawnProcess,
  pathWithinRoot,
  resolveTerminalCwd,
  ensureScratchSessionWorkspace,
  resolveAgentProject,
  upsertSession,
  agentFromRow,
  roomFromRow,
});
  const dingtalkPlatform = createDingtalkPlatform();
const {
  start: startEmailPlatform,
  shutdown: shutdownEmailPlatform,
  forwardAssistantMessageToEmail,
  sendNotification: sendEmailNotification,
} = emailPlatform;
const {
  start: startTelegramPlatform,
  shutdown: shutdownTelegramPlatform,
  forwardAssistantMessageToTelegram,
  resolveTelegramTargetSession,
  telegramSessionChoices,
  telegramSessionLabel,
  telegramGroupedSessionText,
  telegramRecentSessionsText,
  clearTelegramRouteSession,
  setTelegramRouteSession,
  activateTelegramReplyTargetFromQueue,
  clearTelegramActiveReplyTargets,
} = telegramPlatform;
  const feishuPlatform = createFeishuPlatform({
  db,
  sessions: appData.sessions,
  listNotificationAccounts,
  dispatchMessageToSession,
  resolveTelegramTargetSession,
  telegramSessionChoices,
  telegramSessionLabel,
  telegramGroupedSessionText,
  });
  const wecomPlatform = createWeComPlatform({
  db,
  sessions: appData.sessions,
  sessionVisibleInChatTools,
  listNotificationAccounts,
  dispatchMessageToSession,
  resolveTelegramTargetSession,
  telegramSessionChoices,
  telegramSessionLabel,
  telegramGroupedSessionText: (_account: NotificationAccountSummary, _sessions: SessionSummary[], limit?: number) => telegramPlatform.telegramGroupedSessionText(limit ?? 12),
});
const qqPlatform = createQQPlatform({
  db,
  sessions: appData.sessions,
  sessionVisibleInChatTools,
  listNotificationAccounts,
  dispatchMessageToSession,
  resolveTelegramTargetSession,
  telegramSessionChoices,
  telegramSessionLabel,
  telegramGroupedSessionText: (_account: NotificationAccountSummary, _sessions: SessionSummary[], limit?: number) => telegramPlatform.telegramGroupedSessionText(limit ?? 12),
});
const weixinPlatform = createWeixinPlatform({
  db,
  sessions: appData.sessions,
  sessionVisibleInChatTools,
  listNotificationAccounts,
  dispatchMessageToSession,
  resolveTelegramTargetSession,
  telegramSessionChoices,
  telegramSessionLabel,
  telegramGroupedSessionText,
});
setNotificationStoreDeps({
  db,
  builtinNotificationChannels: notificationChannels,
  listNotificationAccounts,
});
setAutomationStoreDeps({ db });

startEmailPlatform();
feishuPlatform.start();
wecomPlatform.start();
qqPlatform.start();
weixinPlatform.start();
startTelegramPlatform();

pruneCodexSessionProjectTrustEntries();
setEnvironmentStoreDeps({
  appProjects: appData.projects,
  commandVersion,
  loadJsonSetting,
  managedChildEnv,
  resolveMiseCommand,
  resolveTerminalCwd,
  saveJsonSetting,
});
let environmentOverview = buildEnvironmentOverview();
migrateRoomAgentSessionDataRoots();
migrateRoomWorkspaceRoots();
const fileMounts = new Map<string, FileMountRecord>();
const fileRouteDeps = {
  archiveIgnoreTemplateDir,
  createZipArchive,
  deleteFileMount,
  fileMounts,
  listArchiveIgnoreTemplates,
  normalizeMountPath,
  previewZipArchive,
  resolveFileRequestMount,
  resolveInsideMount,
  slugify,
  toFileEntry,
  toRelativePath,
  upsertFileMount,
};
const storageRouteDeps = {
  deleteStorageItem,
  listStorageItems,
};
const previewRouteDeps = {
  appData,
  approvalAlwaysAllowed,
  createPreviewApproval,
  deletePreview,
  getBearerToken,
  insertPreview,
  normalizePreviewProxyPaths,
  previewAccess,
  previewAccessCookie,
  previewCommandRisk,
  previewLogs,
  previews,
  previewUrl,
  previewUsingPort,
  publicApproval,
  publicPreview,
  markPreviewRunningIfReachable,
  startPreviewProcess,
  stopPreviewProcess,
  subscribePreviewLogEvents,
  updatePreview,
  validPreviewHost,
  verifySessionToken,
};
setFileStoreDeps({
  db,
  appData,
  previews,
  previewLogs,
  fileMounts,
  workspaceRoot,
  dataDir,
  internalProjectWorkspaceRoot,
  sessionWorkspaceRoot,
  taskLogDir,
  projectWorkspaceMetadataFile,
  resolveTerminalCwd,
  legacyTaskLogPath,
  legacyTaskMetaPath,
  deleteSessionDatabaseRows,
});
loadFileMounts();
loadPreviews();
loadPreviewLogs();
const terminalRouteDeps = {
  appData,
  createTerminalSession,
  db,
  deletedTerminalSessionIds,
  deleteTerminalSessionRecord,
  listTerminalSessionSummaries,
  resolveTerminalCwd,
  runLoggedShellCommand,
  runShellCommand,
  terminalDefaultCwd,
  terminalSessionFromRow,
  terminalSessions,
  terminalSummary,
  upsertTerminalSession,
};
const codexTaskOutputs = new Map<string, { output: string; exitCode: number | null }>();
const codexTaskProcesses = new Map<string, ChildProcess>();
const codexTaskStopRequested = new Set<string>();
const shellTaskProcesses = new Map<string, ChildProcess>();
const shellTaskStopRequested = new Set<string>();
const automationRouteDeps = {
  appendCodexErrorOutput,
  appendSessionMessage,
  appData,
  clearCodexTaskRuntime,
  codexTaskProcesses,
  codexTaskStopRequested,
  db,
  deleteSessionData,
  deleteSessionDatabaseRows,
  finishAutomationRun,
  isProcessAlive,
  latestAutomationSession,
  runAutomationNow,
  saveAppData,
  shellTaskProcesses,
  shellTaskStopRequested,
  upsertAutomation,
  upsertSession,
};
const codexTaskStdoutBuffers = new Map<string, string>();
const codexTaskCurrentMessageIds = new Map<string, string>();
const codexTaskPendingUsageMessageIds = new Map<string, string>();
const codexTaskLogOffsets = new Map<string, number>();
const codexTaskTailers = new Map<string, NodeJS.Timeout>();
const finalizedRecoveredTasks = new Set<string>();
const roomEventSubscribers = new Map<string, Set<(event: RoomStreamEvent) => void>>();
const { publishTaskEvent, subscribeTaskEvents } = createTaskEventBus({
  recordTaskActivity: (sessionId, activity) => recordTaskActivity(sessionId, activity),
});
setSessionQueueDeps({
  db,
  publishTaskEvent,
});
const {
  readTaskLogContent,
  appendCodexOutput,
  readTaskExitCode,
  readTaskMeta,
  writeTaskExitCode,
  taskLogBytes,
} = createTaskStorage({
  sessionLogsPath,
  taskLogPath,
  legacyTaskLogPath,
  taskMetaPath,
  legacyTaskMetaPath,
});
setTaskRunStoreDeps({
  db,
  findSessionById: (sessionId) => appData.sessions.find((item) => item.id === sessionId),
  isProcessAlive,
  parsePageLimit,
  decodePageCursor,
  pageFromRows,
  readTaskMeta,
  taskLogBytes,
});
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
    create table if not exists api_keys (
      id text primary key,
      name text not null,
      key_hash text not null,
      key_preview text not null,
      permissions text not null,
      last_used_at text,
      revoked_at text,
      created_at text not null,
      updated_at text not null
    );
    create unique index if not exists api_keys_key_hash_idx on api_keys(key_hash);
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
    create table if not exists token_usage_records (
      id text primary key,
      session_id text not null,
      session_title text,
      message_id text,
      task_run_id text,
      provider_id text,
      provider_name text,
      model text,
      source text not null,
      raw_hash text not null,
      input_tokens integer not null default 0,
      cached_input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      reasoning_output_tokens integer not null default 0,
      total_tokens integer not null default 0,
      raw_usage text,
      created_at text not null
    );
    create unique index if not exists token_usage_records_raw_hash_idx on token_usage_records(raw_hash);
    create index if not exists token_usage_records_session_idx on token_usage_records(session_id, created_at desc);
    create index if not exists token_usage_records_provider_idx on token_usage_records(provider_id, created_at desc);
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
      show_message_usage integer,
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
      proxy_paths_json text not null default '[]',
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
      session_id text,
      provider_id text,
      model text,
      action_type text not null default 'agent',
      prompt text not null,
      command text,
      cwd text,
      command_timeout_seconds integer,
      retry_max integer not null default 0,
      retry_delay_minutes integer not null default 5,
      overlap_policy text not null default 'queue',
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
    create table if not exists weixin_chat_routes (
      account_id text not null,
      chat_id text not null,
      session_id text not null,
      context_token text,
      updated_at text not null,
      primary key (account_id, chat_id)
    );
    create table if not exists email_chat_routes (
      account_id text not null,
      chat_id text not null,
      session_id text not null,
      subject text,
      inbound_message_id text,
      last_message_id text,
      updated_at text not null,
      primary key (account_id, chat_id)
    );
    create table if not exists feishu_chat_routes (
      account_id text not null,
      chat_id text not null,
      session_id text not null,
      updated_at text not null,
      primary key (account_id, chat_id)
    );
    create table if not exists wecom_chat_routes (
      account_id text not null,
      chat_id text not null,
      session_id text not null,
      updated_at text not null,
      primary key (account_id, chat_id)
    );
    create table if not exists qq_chat_routes (
      account_id text not null,
      chat_id text not null,
      session_id text not null,
      updated_at text not null,
      primary key (account_id, chat_id)
    );
    create table if not exists webhook_routes (
      id text primary key,
      route_key text not null unique,
      name text not null,
      enabled integer not null,
      secret text not null,
      session_id text,
      prompt_template text not null,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists webhook_routes_updated_idx on webhook_routes(updated_at desc, id desc);
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
      context_path text,
      message_id text
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
  if (!taskRunColumns.some((column) => column.name === "message_id")) database.prepare("alter table task_runs add column message_id text").run();
  const approvalColumns = database.prepare("pragma table_info(approvals)").all() as Array<{ name: string }>;
  if (!approvalColumns.some((column) => column.name === "archived_at")) database.prepare("alter table approvals add column archived_at text").run();
  const approvalGrantColumns = database.prepare("pragma table_info(approval_grants)").all() as Array<{ name: string }>;
  if (!approvalGrantColumns.some((column) => column.name === "expires_at")) database.prepare("alter table approval_grants add column expires_at text").run();
  const sessionColumns = database.prepare("pragma table_info(sessions)").all() as Array<{ name: string; notnull?: number }>;
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
  if (!sessionColumns.some((column) => column.name === "show_message_usage")) {
    database.prepare("alter table sessions add column show_message_usage integer").run();
  }
  relaxSessionShowMessageUsageColumn(database);
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
  if (!previewColumns.some((column) => column.name === "proxy_paths_json")) database.prepare("alter table previews add column proxy_paths_json text not null default '[]'").run();
  if (!previewColumns.some((column) => column.name === "updated_at")) database.prepare("alter table previews add column updated_at text").run();
  const previewLogColumns = database.prepare("pragma table_info(preview_logs)").all() as Array<{ name: string }>;
  if (!previewLogColumns.some((column) => column.name === "label")) database.prepare("alter table preview_logs add column label text").run();
  database.prepare("update previews set updated_at = created_at where updated_at is null").run();
  const automationColumns = database.prepare("pragma table_info(automations)").all() as Array<{ name: string }>;
  if (!automationColumns.some((column) => column.name === "session_id")) database.prepare("alter table automations add column session_id text").run();
  if (!automationColumns.some((column) => column.name === "provider_id")) database.prepare("alter table automations add column provider_id text").run();
  if (!automationColumns.some((column) => column.name === "model")) database.prepare("alter table automations add column model text").run();
  if (!automationColumns.some((column) => column.name === "action_type")) database.prepare("alter table automations add column action_type text not null default 'agent'").run();
  if (!automationColumns.some((column) => column.name === "command")) database.prepare("alter table automations add column command text").run();
  if (!automationColumns.some((column) => column.name === "cwd")) database.prepare("alter table automations add column cwd text").run();
  if (!automationColumns.some((column) => column.name === "command_timeout_seconds")) database.prepare("alter table automations add column command_timeout_seconds integer").run();
  if (!automationColumns.some((column) => column.name === "retry_max")) database.prepare("alter table automations add column retry_max integer not null default 0").run();
  if (!automationColumns.some((column) => column.name === "retry_delay_minutes")) database.prepare("alter table automations add column retry_delay_minutes integer not null default 5").run();
  if (!automationColumns.some((column) => column.name === "overlap_policy")) database.prepare("alter table automations add column overlap_policy text not null default 'queue'").run();
  database.prepare(`
    update automations
    set session_id = (
      select session_id
      from automation_runs
      where automation_runs.automation_id = automations.id
      order by started_at desc, id desc
      limit 1
    )
    where (session_id is null or session_id = '')
      and exists (
        select 1
        from automation_runs
        where automation_runs.automation_id = automations.id
      )
  `).run();
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

function relaxSessionShowMessageUsageColumn(database: Database.Database) {
  const columns = database.prepare("pragma table_info(sessions)").all() as Array<{ name: string; notnull?: number }>;
  const column = columns.find((item) => item.name === "show_message_usage");
  if (!column?.notnull) return;
  database.exec(`
    create table if not exists sessions_next (
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
      show_message_usage integer,
      status text not null,
      created_at text,
      updated_at text not null
    );
    insert into sessions_next (
      id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model,
      codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at
    )
    select
      id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model,
      codex_session_id, notifications_enabled, case when show_message_usage = 1 then 1 else null end,
      status, created_at, updated_at
    from sessions;
    drop table sessions;
    alter table sessions_next rename to sessions;
    create index if not exists sessions_project_updated_idx on sessions(project_id, updated_at desc, id desc);
    create index if not exists sessions_status_updated_idx on sessions(status, updated_at desc, id desc);
  `);
}

function upsertSession(session: SessionSummary) {
  db.prepare(`
    insert into sessions (id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      show_message_usage = excluded.show_message_usage,
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
    session.showMessageUsage === null || session.showMessageUsage === undefined ? null : session.showMessageUsage === true ? 1 : 0,
    session.status,
    session.createdAt ?? null,
    session.updatedAt,
  );
  writeSessionMetadata(session);
}

function createInboundEmailSession(senderEmail: string, senderName: string, subject?: string | null) {
  const id = `task-${randomUUID()}`;
  const now = new Date().toISOString();
  const title = subject?.trim()
    ? `Email: ${subject.trim().slice(0, 60)}`
    : senderName && senderName !== senderEmail
      ? `Email: ${senderName} <${senderEmail}>`
      : `Email: ${senderEmail}`;
  const session: SessionSummary = {
    id,
    kind: "scratch",
    conversationType: "codex",
    roomId: null,
    title,
    projectId: null,
    workspacePath: ensureScratchSessionWorkspace(id),
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions.unshift(session);
  saveAppData();
  return session;
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
    insert into automations (id, name, project_id, provider_id, model, action_type, prompt, command, cwd, command_timeout_seconds, retry_max, retry_delay_minutes, overlap_policy, schedule, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      project_id = excluded.project_id,
      provider_id = excluded.provider_id,
      model = excluded.model,
      action_type = excluded.action_type,
      prompt = excluded.prompt,
      command = excluded.command,
      cwd = excluded.cwd,
      command_timeout_seconds = excluded.command_timeout_seconds,
      retry_max = excluded.retry_max,
      retry_delay_minutes = excluded.retry_delay_minutes,
      overlap_policy = excluded.overlap_policy,
      schedule = excluded.schedule,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    automation.id,
    automation.name,
    automation.projectId,
    automation.providerId ?? null,
    automation.model ?? null,
    automation.actionType ?? "agent",
    automation.prompt,
    automation.command ?? null,
    automation.cwd ?? null,
    automation.commandTimeoutSeconds ?? null,
    sanitizeAutomationRetryMax(automation.retryMax),
    sanitizeAutomationRetryDelayMinutes(automation.retryDelayMinutes),
    sanitizeAutomationOverlapPolicy(automation.overlapPolicy),
    automation.schedule,
    automation.status,
    automation.createdAt,
    automation.updatedAt,
  );
}

function createAutomationRun(automationId: string, sessionId: string, status: AutomationRunSummary["status"] = "running", startedAt = new Date().toISOString(), finishedAt?: string | null) {
  const run: AutomationRunSummary = {
    id: `automation-run-${randomUUID()}`,
    automationId,
    sessionId,
    status,
    exitCode: null,
    startedAt,
    finishedAt: finishedAt ?? undefined,
  };
  db.prepare(`
    insert into automation_runs (id, automation_id, session_id, status, exit_code, started_at, finished_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(run.id, run.automationId, run.sessionId, run.status, run.exitCode, run.startedAt, run.finishedAt ?? null);
  return run;
}

function finishAutomationRun(sessionId: string, exitCode: number | null, stopped: boolean) {
  const status: AutomationRunSummary["status"] = stopped ? "stopped" : exitCode === 0 ? "done" : "failed";
  const run = db.prepare("select id, automation_id from automation_runs where session_id = ? and status = 'running' order by started_at desc, id desc limit 1").get(sessionId) as { id?: string; automation_id?: string } | undefined;
  if (!run?.id) return;
  db.prepare(`
    update automation_runs
    set status = ?, exit_code = ?, finished_at = ?
    where id = ?
  `).run(status, exitCode, new Date().toISOString(), run.id);
  const automationId = run.automation_id;
  if (automationId && status === "failed") scheduleAutomationRetry(automationId, sessionId);
  if (automationId) setTimeout(() => startNextQueuedAutomationRun(automationId), 0);
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

function assignedSkillMarkdown(capabilityId: string) {
  if (!capabilityId.startsWith("skill:")) return "";
  const folder = capabilityId.slice("skill:".length);
  try {
    const rootPath = extensionService.assertInsideCodexHome(folder);
    const skillPath = join(rootPath, "SKILL.md");
    if (!existsSync(skillPath)) return "";
    const metadata = extensionService.readSkillMetadata(skillPath);
    const content = readFileSync(skillPath, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\s*/m, "").trim();
    return [
      `## ${metadata.name ?? basename(rootPath)}`,
      metadata.description ? `Description: ${metadata.description}` : "",
      `Path: ${rootPath}`,
      "",
      truncateContextText(content, 3200),
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

function agentSkillsContext(session: SessionSummary, contextInput?: CodexTaskContextInput) {
  const agentId = contextInput?.agentId ?? directAgentForSession(session.id)?.agent.id ?? null;
  if (!agentId) return "";
  const skillIds = extensionService.listSkills().map((skill) => skill.id);
  const sections = skillIds.map(assignedSkillMarkdown).filter(Boolean);
  if (!sections.length) return "";
  return [
    "# Available Skills",
    "Agents can use all currently discovered Skills by default. Use the relevant Skills when they fit the current task.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

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
  const agentSkillContext = agentSkillsContext(session, contextInput);
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
    agentSkillContext ? "- agent-skills.md" : "",
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
    agentSkillContext,
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
  if (agentSkillContext) writeSessionContextFile(session.id, "agent-skills.md", agentSkillContext);
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
    "Do not assume unavailable chat history beyond this pack.",
    "",
    fitManagedContextForPrompt(pack),
    "",
    "Now complete the current prompt.",
  ].join("\n");
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

function sessionCookie(token: string) {
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.max(1, Math.floor(sessionTtlMs / 1000))}; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

app.use("*", createRateLimitMiddleware(
  () => rateLimitSettings,
  (providerId) => {
    const provider = appData.providers.find((item) => item.id === providerId);
    return provider ? { enabled: provider.rpmLimitEnabled, rpmLimit: provider.rpmLimit } : null;
  },
));

async function runLoggedShellCommand(session: SessionSummary, command: string, cwd: string, options: { timeoutMs?: number | null; source?: string } = {}) {
  const promptHash = createHash("sha256").update(command).digest("hex").slice(0, 12);
  const runId = createTaskRun(session.id, undefined, { promptChars: command.length, promptHash });
  if (!codexTaskOutputs.has(session.id)) codexTaskOutputs.set(session.id, readCodexOutput(session.id));
  appendCodexErrorOutput(session, "\n" + [
    "[codex-web]",
    "mode=shell",
    `session=${session.id}`,
    `promptChars=${command.length}`,
    `promptHash=${promptHash}`,
    `cwd=${cwd}`,
    `source=${options.source ?? "shell"}`,
  ].join(" ") + "\n");
  appendCodexErrorOutput(session, `$ /bin/zsh -lc ${JSON.stringify(command)}\n`);
  try {
    const result = await runShellCommand(command, cwd, {
      timeoutMs: options.timeoutMs,
      onChild: (child) => {
        shellTaskProcesses.set(session.id, child);
        updateTaskRunPid(runId, child.pid);
      },
    });
    const stopped = shellTaskStopRequested.has(session.id) || Boolean((db.prepare("select stop_requested from task_runs where id = ?").get(runId) as { stop_requested?: number } | undefined)?.stop_requested);
    const timeoutSeconds = options.timeoutMs === null || options.timeoutMs === undefined ? null : Math.round(options.timeoutMs / 1000);
    appendCodexErrorOutput(session, `${formatShellCommandOutput(result, timeoutSeconds)}${stopped ? "\nStopped: true" : ""}\n`);
    const status: TaskRunSummary["status"] = stopped ? "stopped" : result.exitCode === 0 && !result.timedOut ? "done" : "failed";
    finishTaskRunById(runId, status, result.exitCode, stopped ? "user_stopped" : result.timedOut ? "shell_command_timed_out" : undefined);
    const output = codexTaskOutputs.get(session.id);
    if (output) output.exitCode = result.exitCode;
    writeTaskExitCode(session.id, result.exitCode);
    return { ...result, stopped };
  } finally {
    shellTaskProcesses.delete(session.id);
    shellTaskStopRequested.delete(session.id);
  }
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
      codexTaskPendingUsageMessageIds.set(session.id, message.id);
      ingestAssistantArtifacts(session, message, assistantText);
      publishTaskEvent(session.id, { type: "message", message, session });
    }
    if (readCodexUsage(line)) {
      const preferredUsageMessageId = codexTaskPendingUsageMessageIds.get(session.id) ?? undefined;
      recordCodexUsage({ db, sessions: appData.sessions, providers: appData.providers, parsePageLimit, latestRunningTaskRun }, session, line, preferredUsageMessageId);
      codexTaskPendingUsageMessageIds.delete(session.id);
    }
  }
}

function appendCodexErrorOutput(session: SessionSummary, value: string) {
  appendCodexOutput(session.id, value);
  processCodexLogChunk(session, value);
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
  let pendingUsageMessageId: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    rememberCodexSessionId(session, line);
    const activity = readActivityEvent(line);
    if (activity?.type === "activity") recordTaskActivity(session.id, activity);
    const assistantText = readAssistantText(line);
    if (assistantText) {
      const existing = db.prepare("select id from messages where session_id = ? and role = 'assistant' and content = ? limit 1").get(session.id, assistantText) as { id?: string } | undefined;
      if (existing?.id) {
        pendingUsageMessageId = existing.id;
      } else {
        const message = appendSessionMessage(session.id, "assistant", assistantText);
        pendingUsageMessageId = message.id;
        ingestAssistantArtifacts(session, message, assistantText);
      }
      continue;
    }
    if (readCodexUsage(line)) {
      recordCodexUsage({ db, sessions: appData.sessions, providers: appData.providers, parsePageLimit, latestRunningTaskRun }, session, line, pendingUsageMessageId);
      pendingUsageMessageId = null;
    }
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

function isProcessAlive(pid?: number | null) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  codexTaskCurrentMessageIds.delete(sessionId);
  codexTaskPendingUsageMessageIds.delete(sessionId);
  stopCodexTaskTailer(sessionId);
}

function hasAssistantMessageAfter(sessionId: string, messageId?: string | null) {
  if (!messageId) return true;
  const row = db.prepare("select created_at, id from messages where session_id = ? and id = ?").get(sessionId, messageId) as { created_at?: string; id?: string } | undefined;
  if (!row?.created_at || !row.id) return true;
  return Boolean(db.prepare(`
    select 1 from messages
    where session_id = ?
      and role = 'assistant'
      and (created_at > ? or (created_at = ? and id > ?))
    limit 1
  `).get(sessionId, row.created_at, row.created_at, row.id));
}

function emptyCodexReplyMessage(sessionId: string, exitCode: number | null) {
  const summary = readTaskErrorSummary(sessionId);
  return [
    `Codex 任务已结束，退出码为 ${exitCode ?? "null"}，但没有返回可显示的助手回复。`,
    summary,
  ].filter(Boolean).join("\n\n");
}

function finalizeCodexRunnerTask(session: SessionSummary, exitCode: number | null, reason?: string) {
  if (finalizedRecoveredTasks.has(session.id)) return;
  finalizedRecoveredTasks.add(session.id);
  const currentMessageId = codexTaskCurrentMessageIds.get(session.id) ?? null;
  const running = latestRunningTaskRun(session.id);
  const agentRun = db.prepare("select * from agent_runs where session_id = ? order by started_at desc, id desc limit 1").get(session.id) as Record<string, unknown> | undefined;
  const wasStopped = codexTaskStopRequested.has(session.id) || Boolean((running as { stop_requested?: unknown } | undefined)?.stop_requested);
  flushCodexTaskLog(session);
  backfillSessionFromTaskLog(session);
  clearTelegramActiveReplyTargets(session.id);
  feishuPlatform.clearActiveReplyTargets(session.id);
  wecomPlatform.clearActiveReplyTargets(session.id);
  weixinPlatform.clearActiveReplyTargets(session.id);
  codexTaskProcesses.delete(session.id);
  codexTaskStdoutBuffers.delete(session.id);
  codexTaskCurrentMessageIds.delete(session.id);
  codexTaskPendingUsageMessageIds.delete(session.id);
  stopCodexTaskTailer(session.id);
  const output = codexTaskOutputs.get(session.id);
  if (output) output.exitCode = exitCode;
  const missingAssistantReply = !wasStopped && exitCode === 0 && !hasAssistantMessageAfter(session.id, currentMessageId);
  session.status = exitCode === 0 && !wasStopped ? "done" : "paused";
  finishTaskRun(session.id, wasStopped ? "stopped" : exitCode === 0 ? "done" : "failed", exitCode, reason ?? (wasStopped ? "user_stopped" : undefined));
  if ((exitCode !== 0 && !wasStopped) || missingAssistantReply) {
    const summary = readTaskErrorSummary(session.id);
    const content = missingAssistantReply
      ? emptyCodexReplyMessage(session.id, exitCode)
      : [`任务运行失败，Codex 退出码为 ${exitCode ?? "null"}。`, summary].filter(Boolean).join("\n\n");
    appendSessionMessage(session.id, "assistant", content);
    publishTaskEvent(session.id, { type: "message", message: allSessionMessages(session.id).at(-1)!, session });
  }
  finishAutomationRun(session.id, exitCode, wasStopped);
  finishAgentRun(session.id, exitCode, wasStopped);
  codexTaskStopRequested.delete(session.id);
  session.updatedAt = new Date().toISOString();
  writeTaskExitCode(session.id, exitCode);
  saveAppData();
  pruneCodexSessionProjectTrustEntries();
  publishTaskEvent(session.id, { type: "workspace", session, reason: "done", at: new Date().toISOString() });
  publishTaskEvent(session.id, { type: "done", session, exitCode });
  const notificationScopes = [
    { scopeType: "session", scopeId: session.id },
    running?.id ? { scopeType: "task", scopeId: String(running.id) } : null,
    agentRun?.task_id ? { scopeType: "room_task", scopeId: String(agentRun.task_id) } : null,
    session.conversationType === "automation" ? { scopeType: "automation", scopeId: automationIdForSession(session.id) ?? session.id } : null,
  ].filter((scope): scope is { scopeType: "session" | "task" | "room_task" | "automation"; scopeId: string } => Boolean(scope));
  const latestAssistant = allSessionMessages(session.id).filter((message) => message.role === "assistant").at(-1)?.content ?? "";
  const isRoomTaskNotification = Boolean(agentRun?.room_id && agentRun?.task_id);
  const shouldEmitTaskNotification = !isRoomTaskNotification || roomTaskShouldNotifyUser(String(agentRun?.room_id ?? ""), String(agentRun?.task_id ?? ""), latestAssistant);
  if (shouldEmitTaskNotification) {
    const automation = session.conversationType === "automation" ? automationForSession(session.id) : null;
    const errorSummary = exitCode === 0 && !wasStopped ? "" : readTaskErrorSummary(session.id);
    const notificationMessage = automation
      ? buildAutomationNotificationMessage({
        automation,
        session,
        exitCode,
        stopped: wasStopped,
        assistantResult: latestAssistant,
        errorSummary,
      })
      : wasStopped ? "任务已被停止。" : `Codex 退出码：${exitCode ?? "null"}`;
    emitExternalNotification({
      eventType: wasStopped ? "task_interrupted" : exitCode === 0 ? "task_completed" : "task_failed",
      severity: wasStopped ? "warning" : exitCode === 0 ? "success" : "error",
      title: automation
        ? exitCode === 0 && !wasStopped ? `自动化完成：${automation.name}` : `自动化异常：${automation.name}`
        : exitCode === 0 && !wasStopped ? `任务完成：${session.title}` : `任务异常：${session.title}`,
      message: notificationMessage,
      sourceType: "session",
      sourceId: session.id,
      metadata: {
        automationId: automation?.id ?? null,
        automationName: automation?.name ?? null,
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
  activateTelegramReplyTargetFromQueue(session.id, item.id);
  feishuPlatform.activateReplyTargetFromQueue(session.id, item.id);
  wecomPlatform.activateReplyTargetFromQueue(session.id, item.id);
  weixinPlatform.activateReplyTargetFromQueue(session.id, item.id);
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
  const hasExistingTaskLog = existsSync(taskLogPath(session.id)) || existsSync(legacyTaskLogPath(session.id));
  const shouldResetTaskLog = resetOutput && !hasExistingTaskLog;
  if (shouldResetTaskLog) codexTaskOutputs.set(session.id, { output: "", exitCode: null });
  else if (!codexTaskOutputs.has(session.id)) codexTaskOutputs.set(session.id, readCodexOutput(session.id));
  codexTaskStdoutBuffers.set(session.id, "");
  if (contextInput?.currentMessageId) codexTaskCurrentMessageIds.set(session.id, contextInput.currentMessageId);
  else codexTaskCurrentMessageIds.delete(session.id);
  finalizedRecoveredTasks.delete(session.id);
  if (shouldResetTaskLog) {
    mkdirSync(sessionLogsPath(session.id), { recursive: true });
    writeFileSync(taskLogPath(session.id), "", "utf8");
    rmSync(taskMetaPath(session.id), { force: true });
    rmSync(legacyTaskLogPath(session.id), { force: true });
    rmSync(legacyTaskMetaPath(session.id), { force: true });
  } else {
    appendCodexOutput(session.id, "\n\n--- follow-up ---\n");
  }
  const useResume = false;
  const args = ["exec", "--json", ...codexExecPermissionArgs("exec", cwd, effectiveExtraWritableDirs, effectiveRuntime), ...codexProviderConfigArgs(provider)];
  const selectedModel = model || provider?.defaultModel;
  if (selectedModel) args.push("-m", selectedModel);
  args.push("--");
  args.push(managedPrompt);
  const env = managedChildEnv();
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
  createTaskRun(session.id, runner.pid, { promptChars: managedPrompt.length, promptHash: managedPromptHash, contextPath: contextPackPath, messageId: contextInput?.currentMessageId ?? null });
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
    let fromPreviewReferer = false;
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
      fromPreviewReferer = true;
    }
    const preview = previews.get(previewId);
    if (!preview || preview.token !== token || (fromPreviewReferer && !shouldProxyPreviewRefererPath(preview, url.pathname)) || !requestHasPreviewAccess(preview, request)) {
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

function shouldProxyPreviewRefererPath(preview: { proxyPaths?: unknown }, path: string) {
  if (isReservedPreviewShellPath(path)) return false;
  if (!Array.isArray(preview.proxyPaths) || preview.proxyPaths.length === 0) return true;
  return previewProxyPathMatches(preview, path);
}

function isReservedPreviewShellPath(path: string) {
  return path === "/health" || path.startsWith("/preview/");
}

function previewProxyPathMatches(preview: { proxyPaths?: unknown }, path: string) {
  const prefixes = Array.isArray(preview.proxyPaths) ? preview.proxyPaths : [];
  return prefixes.some((prefix) => {
    const normalized = String(prefix || "").trim().replace(/\/+$/g, "");
    return normalized && (path === normalized || path.startsWith(`${normalized}/`));
  });
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

registerServerRoutes(app, serverRouteDeps);

registerApiAuthMiddleware(app, authRouteDeps);

registerProtectedAuthRoutes(app, authRouteDeps);
registerSettingsRoutes(app, settingsRouteDeps);

registerGoalRoutes(app, goalRouteDeps);

registerPreviewRoutes(app, previewRouteDeps);

registerTaskRoutes(app, taskRouteDeps);

registerProjectRoutes(app, projectRouteDeps);

registerAutomationRoutes(app, automationRouteDeps);

registerAgentRoleRoutes(app, agentRouteDeps);
registerAgentRoutes(app, agentRouteDeps);
registerAgentGroupRoutes(app, agentRouteDeps);
registerAgentCircleRoutes(app, agentRouteDeps);
registerRoomRoutes(app, roomRouteDeps);

registerProviderRoutes(app, providerRouteDeps);

ensureTokenUsageSchema(db);
registerUsageRoutes(app, {
  db,
  sessions: appData.sessions,
  providers: appData.providers,
  parsePageLimit,
  latestRunningTaskRun,
  getRetentionDays: () => tokenUsageRetentionSettings.retentionDays,
  backfillSessionUsage: (sessionId) => {
    const session = appData.sessions.find((item) => item.id === sessionId);
    if (session) backfillSessionFromTaskLog(session);
  },
});

registerExtensionRoutes(app, extensionRouteDeps);

registerFileRoutes(app, fileRouteDeps);

registerTerminalRoutes(app, terminalRouteDeps);

const apiServer = serve({ fetch: app.fetch, hostname: host, port: apiPort });
const wsServer = startTerminalWebSocketServer();
const terminalApiWsServer = startTerminalApiWebSocket(apiServer);
const previewWsServer = startPreviewWebSocketProxy(apiServer);
const automationTimer = setInterval(checkScheduledWork, 60_000);
automationTimer.unref();
function cleanupTokenUsageByRetention() {
  const deleted = cleanupTokenUsageRecords(db, tokenUsageRetentionSettings.retentionDays);
  if (deleted > 0) console.log(`token usage retention cleanup deleted ${deleted} records`);
}
cleanupTokenUsageByRetention();
const tokenUsageCleanupTimer = setInterval(cleanupTokenUsageByRetention, 60 * 60_000);
tokenUsageCleanupTimer.unref();
const startupAutomationTimer = setTimeout(runStartupAutomations, 2_000);
startupAutomationTimer.unref();
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(automationTimer);
  clearInterval(tokenUsageCleanupTimer);
  clearTimeout(startupAutomationTimer);
  shutdownEmailPlatform();
  shutdownTelegramPlatform();
  void feishuPlatform.shutdown();
  void wecomPlatform.shutdown();
  weixinPlatform.shutdown();
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
