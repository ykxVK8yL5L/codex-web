export type SessionKind = "project" | "scratch";
export type ConversationType = "codex" | "agent" | "room" | "automation";
export type GoalOwnerType = "session" | "agent_session" | "room";
export type GoalMode = "reference" | "tracked" | "managed" | "orchestrated";
export type GoalStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
export type GoalFocusStatus = "active" | "completed" | "cancelled" | "paused";
export type GoalItemStatus = "planned" | "active" | "blocked" | "completed" | "failed" | "cancelled";

export interface GoalProgress {
  totalItems: number;
  activeItems: number;
  completedItems: number;
  failedItems: number;
  blockedItems: number;
  latestSummary?: string | null;
  updatedAt?: string | null;
}

export interface GoalFocusSummary {
  id: string;
  goalId: string;
  text: string;
  status: GoalFocusStatus;
  ownerAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface GoalSummary {
  id: string;
  ownerType: GoalOwnerType;
  ownerId: string;
  text: string;
  mode: GoalMode;
  status: GoalStatus;
  managerAgentId?: string | null;
  coordinatorAgentId?: string | null;
  currentFocus?: GoalFocusSummary | null;
  progress: GoalProgress;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface GoalItemSummary {
  id: string;
  goalId: string;
  roomTaskId?: string | null;
  title: string;
  description?: string | null;
  status: GoalItemStatus;
  assignedAgentId?: string | null;
  priority: number;
  dependsOnItemId?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface GoalEventSummary {
  id: string;
  goalId: string;
  type: string;
  actorType?: string | null;
  actorId?: string | null;
  payload: unknown;
  createdAt: string;
}

export type GoalProposalStatus = "pending" | "approved" | "rejected";
export type GoalProposalKind = "goal_update" | "focus" | "item" | "plan";

export interface GoalProposalSummary {
  id: string;
  goalId: string;
  kind: GoalProposalKind;
  status: GoalProposalStatus;
  title: string;
  payload: unknown;
  proposedByAgentId?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  conversationType?: ConversationType;
  roomId?: string | null;
  directAgentId?: string | null;
  title: string;
  projectId: string | null;
  workspacePath: string;
  providerId?: string | null;
  model?: string | null;
  codexSessionId?: string | null;
  notificationsEnabled?: boolean;
  goal?: GoalSummary | null;
  status: "running" | "paused" | "done" | "interrupted";
  createdAt?: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspacePath: string;
  runner: "docker" | "none";
  changedFiles: number;
  stagedFiles?: number;
  modifiedFiles?: number;
  untrackedFiles?: number;
  gitStatus?: "clean" | "dirty" | "not-git" | "error";
  gitBranch?: string;
  gitRemoteStatus?: string;
  checkCommand?: string;
  checkCommands?: string[];
}

export interface ProjectCheckRunSummary {
  id: string;
  projectId: string;
  command: string;
  cwd: string;
  status: "running" | "done" | "failed" | "timed_out";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt?: string;
}

export type ProjectGitOperationType = "pull" | "commit" | "branch-create" | "branch-checkout" | "push";

export interface ProjectGitOperationSummary {
  id: string;
  projectId: string;
  operation: ProjectGitOperationType;
  args: string[];
  status: "done" | "failed" | "approval_required";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  createdAt: string;
}

export interface ProjectGitOperationRequest {
  operation: ProjectGitOperationType;
  message?: string;
  branch?: string;
}

export interface ProjectStatsSummary {
  projectId: string;
  totalSessions: number;
  runningSessions: number;
  latestSessionUpdatedAt?: string | null;
  latestCheckStatus?: ProjectCheckRunSummary["status"] | null;
  previewStatusCounts: Record<string, number>;
}

export type PreviewScopeType = "project" | "session" | "folder";
export type PreviewAccess = "private" | "public";

export interface PreviewSummary {
  id: string;
  scopeType: PreviewScopeType;
  scopeId: string;
  label: string;
  targetHost: string;
  port: number;
  command?: string;
  cwd?: string;
  status: "registered" | "starting" | "running" | "stopped" | "error";
  access: PreviewAccess;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewLogsResponse {
  previewId: string;
  logs: string;
}

export interface PageResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreatePreviewRequest {
  scopeType: PreviewScopeType;
  scopeId: string;
  label?: string;
  targetHost?: string;
  port: number;
  command?: string;
  cwd?: string;
  access?: PreviewAccess;
  autoStart?: boolean;
}

export interface UpdatePreviewRequest {
  label?: string;
}

export interface ProviderSummary {
  id: string;
  name: string;
  kind: "openai-responses" | "openai-compatible-chat" | "local";
  defaultModel: string;
  baseUrl?: string;
  apiKeyConfigured?: boolean;
  capabilities?: ProviderCapabilities;
  models?: string[];
  modelsCachedAt?: string | null;
  rpmLimit?: number | null;
  rpmLimitEnabled?: boolean;
  useProxy?: boolean;
}

export interface ProviderCapabilities {
  responsesApi: boolean;
  chatCompletions: boolean;
  tools: boolean;
  jsonMode: boolean;
  vision: boolean;
  streaming: boolean;
}

export interface AuthState {
  authenticated: boolean;
  setupRequired: boolean;
  needsOtp: boolean;
  user: {
    id: string;
    email: string;
  } | null;
}

export interface LoginRequest {
  accessToken: string;
  otp: string;
}

export interface LoginResponse {
  ok: boolean;
  sessionToken: string | null;
  auth: AuthState;
  error?: string;
}

export interface SetupStartResponse {
  setupRequired: boolean;
  otpSecret: string | null;
  otpauthUrl: string | null;
}

export interface SetupCompleteRequest {
  accessToken: string;
  otp: string;
}

export interface UpdateAccessTokenRequest {
  currentAccessToken: string;
  accessToken: string;
}

export interface ResetOtpResponse {
  otpSecret: string;
  otpauthUrl: string;
}

export interface ConfirmOtpResetRequest {
  currentAccessToken: string;
  otp: string;
}

export type ApiKeyPermission =
  | "auth.read"
  | "auth.manage"
  | "sessions.read"
  | "sessions.manage"
  | "sessions.run"
  | "rooms.read"
  | "rooms.manage"
  | "rooms.run"
  | "agents.read"
  | "agents.manage"
  | "automations.read"
  | "automations.manage"
  | "automations.run"
  | "goals.read"
  | "goals.manage"
  | "goals.run"
  | "projects.read"
  | "projects.manage"
  | "projects.git"
  | "previews.read"
  | "previews.manage"
  | "files.read"
  | "files.write"
  | "terminal.exec"
  | "providers.read"
  | "providers.manage"
  | "extensions.read"
  | "extensions.manage"
  | "extensions.install"
  | "environment.read"
  | "environment.manage"
  | "environment.restore"
  | "notifications.read"
  | "notifications.manage"
  | "approvals.read"
  | "approvals.decide"
  | "settings.read"
  | "settings.manage"
  | "storage.read"
  | "storage.manage"
  | "backup.read"
  | "backup.restore";

export interface ApiKeySummary {
  id: string;
  name: string;
  permissions: ApiKeyPermission[];
  keyPreview: string;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string | null;
}

export interface ApiKeyDetailResponse extends ApiKeySummary {
  key?: string | null;
}

export interface ApiKeyPermissionGroup {
  id: string;
  label: string;
  permissions: Array<{ id: ApiKeyPermission; label: string }>;
}

export interface ApiKeyPreset {
  id: string;
  label: string;
  permissions: ApiKeyPermission[];
}

export interface ApiKeyPermissionsResponse {
  groups: ApiKeyPermissionGroup[];
  presets: ApiKeyPreset[];
}

export interface CreateApiKeyRequest {
  name: string;
  permissions: ApiKeyPermission[];
}

export interface UpdateApiKeyRequest {
  name: string;
  permissions: ApiKeyPermission[];
}

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

export interface CodexRuntimeSettings {
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  bypassSandbox: boolean;
  updatedAt: string;
}

export interface UpdateCodexRuntimeSettingsRequest {
  sandboxMode?: CodexSandboxMode;
  approvalPolicy?: CodexApprovalPolicy;
  bypassSandbox?: boolean;
}

export interface PreviewAccessSettings {
  requestTtlMinutes: number;
  updatedAt: string;
}

export interface SessionCompactionSettings {
  enabled: boolean;
  autoCompactMessages: number;
  autoCompactChars: number;
  minNewMessages: number;
  minNewChars: number;
  updatedAt: string;
}

export interface UpdateSessionCompactionSettingsRequest {
  enabled?: boolean;
  autoCompactMessages?: number;
  autoCompactChars?: number;
  minNewMessages?: number;
  minNewChars?: number;
}

export interface RateLimitSettings {
  enabled: boolean;
  globalPerMinute: number;
  authPerMinute: number;
  previewAccessPerMinute: number;
  expensivePerFiveMinutes: number;
  providerProxyPerMinute: number;
  providerProxyPerHour: number;
  providerProxyMaxConcurrent: number;
  updatedAt: string;
}

export interface NotificationTestSettings {
  titleZh: string;
  titleEn: string;
  messageZh: string;
  messageEn: string;
  includeHelp: boolean;
  updatedAt: string;
}

export interface UpdateNotificationTestSettingsRequest {
  titleZh?: string;
  titleEn?: string;
  messageZh?: string;
  messageEn?: string;
  includeHelp?: boolean;
}

export type EnvironmentToolStatus = "installed" | "missing" | "version_mismatch" | "unknown";
export type EnvironmentToolSource = "mise" | "manual" | "system" | "external";
export type EnvironmentRecordScope = "global" | "workspace" | "room" | "session";

export interface EnvironmentToolRecord {
  id: string;
  tool: string;
  requestedVersion: string;
  detectedVersion?: string | null;
  isGlobalDefault?: boolean;
  status: EnvironmentToolStatus;
  source: EnvironmentToolSource;
  scope: EnvironmentRecordScope;
  autoRestore: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentPackageRecord {
  id: string;
  toolRecordId?: string | null;
  tool: string;
  runtimeVersion?: string | null;
  ecosystem: string;
  manager: string;
  packageName: string;
  versionSpec?: string | null;
  installedVersion?: string | null;
  installCommand: string;
  uninstallCommand?: string | null;
  targetLabel: string;
  scope: EnvironmentRecordScope;
  autoRestore: boolean;
  persisted: boolean;
  status?: "installed" | "missing" | "failed";
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type EnvironmentReconcileStatus =
  | "ok"
  | "missing_runtime"
  | "runtime_version_mismatch"
  | "untracked_runtime"
  | "missing_package"
  | "package_version_mismatch"
  | "untracked_package";

export interface EnvironmentReconcileItem {
  id: string;
  kind: "tool" | "package";
  status: EnvironmentReconcileStatus;
  title: string;
  detail: string;
  toolRecordId?: string | null;
  packageRecordId?: string | null;
  projectIds?: string[];
}

export interface EnvironmentProjectUsage {
  projectId: string;
  projectName: string;
  workspacePath: string;
  matchedTools: string[];
  detectedFiles: string[];
}

export interface EnvironmentRestorePreviewItem {
  id: string;
  kind: "tool" | "package";
  action: "install" | "record" | "manual" | "skip";
  title: string;
  detail: string;
  command?: string | null;
  toolRecordId?: string | null;
  packageRecordId?: string | null;
}

export interface EnvironmentBulkActionRequest {
  action: "record_detected_packages" | "install_missing_packages" | "cleanup_stale_records";
  toolRecordId?: string;
  packageIds?: string[];
}

export interface EnvironmentRestoreRun {
  id: string;
  status: "success" | "failed" | "partial";
  summary: string;
  createdAt: string;
}

export interface EnvironmentOverview {
  tools: EnvironmentToolRecord[];
  packageRecords: EnvironmentPackageRecord[];
  restoreRuns: EnvironmentRestoreRun[];
  reconcile: EnvironmentReconcileItem[];
  projectUsage: EnvironmentProjectUsage[];
  mise: {
    installed: boolean;
    version?: string | null;
    warning?: string | null;
  };
  updatedAt: string;
}

export interface InstallEnvironmentToolRequest {
  tool: string;
  version: string;
  scope?: EnvironmentRecordScope;
  autoRestore?: boolean;
  notes?: string;
}

export interface RegisterEnvironmentToolRequest extends InstallEnvironmentToolRequest {
  detectedVersion?: string | null;
  source?: EnvironmentToolSource;
}

export interface EnvironmentToolRegistryItem {
  name: string;
  description: string | null;
  backend: string | null;
}

export interface EnvironmentToolVersionItem {
  version: string;
  recommended?: boolean;
}

export interface EnvironmentToolProbe {
  tool: string;
  detectedVersion: string | null;
  installed: boolean;
}

export interface EnvironmentPackageManagerOption {
  id: string;
  label: string;
  installCommandExample: string;
  uninstallCommandExample: string;
  supported: boolean;
  detectedVersion?: string | null;
}

export interface EnvironmentPackageDetailResponse {
  toolRecord: EnvironmentToolRecord;
  packages: EnvironmentPackageRecord[];
  managers: EnvironmentPackageManagerOption[];
  restorePreview: EnvironmentRestorePreviewItem[];
}

export interface EnvironmentRestoreMissingRequest {
  mode?: "all" | "auto";
  includeTools?: boolean;
  includePackages?: boolean;
}

export interface EnvironmentRestorePreviewResponse {
  items: EnvironmentRestorePreviewItem[];
  tools: number;
  packages: number;
}

export interface InstallEnvironmentPackageRequest {
  toolRecordId: string;
  manager: string;
  packageName: string;
  versionSpec?: string;
  notes?: string;
  autoRestore?: boolean;
}

export interface UninstallEnvironmentPackageRequest {
  manager?: string;
}

export type ApprovalStatus = "pending" | "approved" | "denied";
export type ApprovalRisk = "low" | "medium" | "high" | "critical";
export type ApprovalActionType = "codex-runtime-update" | "preview-command-run" | "preview-access" | "project-delete-files" | "room-run-merge" | "project-git-operation";

export interface ApprovalSummary {
  id: string;
  actionType: ApprovalActionType;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  title: string;
  description: string;
  details: string;
  related?: unknown;
  createdAt: string;
  resolvedAt?: string | null;
  archivedAt?: string | null;
}

export interface ApprovalGrantSummary {
  id: string;
  actionType: ApprovalActionType;
  title: string;
  details: string;
  createdAt: string;
  expiresAt?: string | null;
}

export interface ApprovalDecisionResponse {
  approval: ApprovalSummary;
  codexRuntime?: CodexRuntimeSettings;
  preview?: PreviewSummary;
  merge?: RoomRunMergeResponse;
  gitOperation?: ProjectGitOperationSummary;
}

export interface MaintenanceCleanupResponse {
  ok: true;
  deleted: {
    previews: number;
    previewLogs: number;
    messages: number;
    queuedMessages: number;
    taskActivities: number;
    projectCheckRuns: number;
    automationRuns: number;
    providerHealthChecks: number;
    closedTerminalSessions: number;
    archivedApprovals: number;
    approvalAuditLog: number;
    orphanAgentSessions: number;
    orphanRoomRecords: number;
  };
  updated: {
    detachedSessions: number;
  };
}

export interface TaskHealthItem {
  sessionId: string;
  title: string;
  sessionStatus: SessionSummary["status"];
  runId?: string | null;
  runStatus?: TaskRunSummary["status"] | null;
  pid?: number | null;
  pidAlive: boolean;
  runnerRunning?: boolean | null;
  runnerExitCode?: number | null;
  childPid?: number | null;
  childPidAlive?: boolean | null;
  logBytes: number;
  updatedAt: string;
  issue?: string | null;
}

export interface TaskHealthResponse {
  ok: boolean;
  checkedAt: string;
  items: TaskHealthItem[];
}

export interface TaskHealthRepairResponse {
  ok: boolean;
  repaired: Array<{ sessionId: string; issue: string; action: string }>;
  health: TaskHealthResponse;
}

export type NotificationChannelKind = "webhook" | "bark" | "email" | "telegram" | "weixin" | "wecom" | "dingtalk" | "feishu" | "qq";
export type NotificationChannelAdapter = "webhook" | "authenticated_webhook" | "email" | "telegram" | "weixin" | "wecom" | "dingtalk" | "feishu" | "qq";
export type NotificationChannelAuthType = "none" | "bearer" | "query_token" | "token_request";
export type NotificationSeverity = "info" | "success" | "warning" | "error";
export type NotificationEventType = "task_completed" | "task_failed" | "task_interrupted" | "needs_approval" | "task_health_issue" | "provider_check_failed" | "backup_failed" | "restore_failed" | "auth_login";
export type NotificationDeliveryStatus = "pending" | "sent" | "failed" | "skipped";
export type PlatformKind = "telegram" | "email" | "webhook" | "bark" | "weixin" | "dingtalk" | "wecom" | "feishu" | "qq";
export type PlatformCapability =
  | "inbound_messages"
  | "outbound_messages"
  | "session_binding"
  | "session_selection"
  | "reply_routing"
  | "working_status"
  | "command_menu"
  | "file_browse"
  | "terminal";

export interface NotificationChannelDefinition {
  id: string;
  kind: NotificationChannelKind;
  adapter?: NotificationChannelAdapter;
  authType?: NotificationChannelAuthType;
  name: string;
  description: string;
  builtin?: boolean;
  method?: string;
  urlTemplate?: string;
  headersTemplate?: string;
  bodyTemplate?: string;
  accountFields?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface NotificationAccountSummary {
  id: string;
  name: string;
  channelId?: string | null;
  channelKind: NotificationChannelKind;
  enabled: boolean;
  config: Record<string, unknown>;
  permissions?: NotificationPermissionPolicy;
  lastTestStatus?: NotificationDeliveryStatus | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRuleTarget {
  accountId?: string;
  recipientId?: string;
  senderAccountId?: string | null;
  chatId?: string;
  emailTo?: string[];
}

export type NotificationRecipientKind = "email" | "webhook" | "bark" | "telegram" | "weixin" | "wecom" | "dingtalk" | "feishu" | "qq";

export interface NotificationPermissionPolicy {
  allowedAgentIds?: string[];
  allowedRoomIds?: string[];
  allowedProjectIds?: string[];
}

export interface NotificationRecipientSummary {
  id: string;
  name: string;
  kind: NotificationRecipientKind;
  enabled: boolean;
  senderAccountId?: string | null;
  channelId?: string | null;
  config: Record<string, unknown>;
  permissions?: NotificationPermissionPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRuleSummary {
  id: string;
  name: string;
  enabled: boolean;
  eventTypes: NotificationEventType[];
  minSeverity: NotificationSeverity;
  targets: NotificationRuleTarget[];
  dedupeMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliverySummary {
  id: string;
  ruleId?: string | null;
  accountId?: string | null;
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  responseStatus?: number | null;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  sentAt?: string | null;
}

export interface NotificationEphemeralRuleSummary {
  id: string;
  scopeType: "task" | "session" | "room_task" | "automation";
  scopeId: string;
  source?: {
    type: "task" | "session" | "room_task" | "automation";
    id: string;
    label: string;
    detail?: string | null;
    exists: boolean;
  } | null;
  eventTypes: NotificationEventType[];
  targets: NotificationRuleTarget[];
  enabled: boolean;
  expireMode: "after_trigger" | "session_end" | "manual";
  createdAt: string;
  expiresAt?: string | null;
  triggeredAt?: string | null;
}

export interface NotificationSettingsResponse {
  channels: NotificationChannelDefinition[];
  accounts: NotificationAccountSummary[];
  recipients: NotificationRecipientSummary[];
  rules: NotificationRuleSummary[];
  ephemeralRules: NotificationEphemeralRuleSummary[];
  recentDeliveries: NotificationDeliverySummary[];
}

export interface PlatformRouteSummary {
  id: string;
  kind: PlatformKind;
  accountId: string;
  chatId: string;
  sessionId: string;
  sessionTitle: string;
  sessionConversationType?: ConversationType | null;
  updatedAt: string;
}

export interface WebhookRouteSummary {
  id: string;
  routeKey: string;
  name: string;
  enabled: boolean;
  secret: string;
  curlExample: string;
  sessionId?: string | null;
  sessionTitle?: string | null;
  commandTemplate: string;
  promptTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSummary {
  id: string;
  kind: PlatformKind;
  label: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  channelId?: string | null;
  accountCount: number;
  connectedRouteCount: number;
  baselineCapabilities: PlatformCapability[];
  supportedCapabilities: PlatformCapability[];
  notes?: string | null;
}

export interface PlatformSettingsResponse {
  baselineCapabilities: PlatformCapability[];
  capabilityLabels: Record<PlatformCapability, string>;
  platforms: PlatformSummary[];
  routes: PlatformRouteSummary[];
  webhookRoutes: WebhookRouteSummary[];
}

export interface AppNotificationSummary {
  id: string;
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}

export interface AppNotificationsResponse {
  items: AppNotificationSummary[];
  unreadCount: number;
}

export type AppNotificationStreamEvent =
  | ({ type: "snapshot" } & AppNotificationsResponse)
  | { type: "notification"; notification: AppNotificationSummary; unreadCount: number };

export interface UpsertNotificationAccountRequest {
  name?: string;
  channelId?: string;
  channelKind?: NotificationChannelKind;
  enabled?: boolean;
  config?: Record<string, unknown>;
  permissions?: NotificationPermissionPolicy;
}

export interface UpsertNotificationChannelRequest {
  name?: string;
  description?: string;
  adapter?: NotificationChannelAdapter;
  authType?: NotificationChannelAuthType;
  method?: string;
  urlTemplate?: string;
  headersTemplate?: string;
  bodyTemplate?: string;
  accountFields?: string[];
}

export interface UpsertNotificationRecipientRequest {
  name?: string;
  kind?: NotificationRecipientKind;
  enabled?: boolean;
  senderAccountId?: string | null;
  channelId?: string | null;
  config?: Record<string, unknown>;
  permissions?: NotificationPermissionPolicy;
}

export interface UpsertNotificationRuleRequest {
  name?: string;
  enabled?: boolean;
  eventTypes?: NotificationEventType[];
  minSeverity?: NotificationSeverity;
  targets?: NotificationRuleTarget[];
  dedupeMinutes?: number;
}

export interface TestNotificationAccountRequest {
  emailTo?: string[];
  chatId?: string;
  title?: string;
  message?: string;
  includeHelp?: boolean;
}

export interface SystemBackupProjectReference {
  id: string;
  name: string;
  workspacePath: string;
  exists: boolean;
  gitRemote?: string | null;
  gitBranch?: string | null;
  gitCommit?: string | null;
  gitDirty?: boolean | null;
  included: false;
  note: string;
}

export interface SystemBackupFileEntry {
  path: string;
  bytes: number;
  modifiedAt?: string | null;
}

export interface SystemBackupManifest {
  schemaVersion: 1;
  createdAt: string;
  app: "codex-web";
  dataDir: string;
  ignorePatterns: string[];
  included: string[];
  excluded: string[];
  projects: SystemBackupProjectReference[];
  warnings: string[];
}

export interface SystemBackupSettings {
  ignorePatterns: string[];
  updatedAt: string;
}

export interface UpdateSystemBackupSettingsRequest {
  ignorePatterns: string[] | string;
}

export interface SystemBackupPreviewResponse {
  ok: boolean;
  manifest: SystemBackupManifest;
  entries: number;
  files: SystemBackupFileEntry[];
  bytes: number;
  restartRequired: boolean;
}

export interface SystemRestoreResponse {
  ok: boolean;
  manifest: SystemBackupManifest;
  restoredAt: string;
  backupBeforeRestorePath: string;
  restartRequired: boolean;
  warnings: string[];
}

export type StorageItemType = "project-workspace" | "session-data" | "session-workspace" | "room-workspace" | "room-worktree" | "task-log" | "preview-log";
export type StorageItemStatus = "active" | "orphan";

export interface StorageItemSummary {
  id: string;
  type: StorageItemType;
  status: StorageItemStatus;
  label: string;
  path: string;
  bytes: number;
  updatedAt: string;
  sessionType?: ConversationType | null;
  sessionKind?: SessionKind | null;
  relatedId?: string | null;
  relatedName?: string | null;
  relatedType?: "project" | "session" | "room" | "run" | "preview" | null;
}

export interface StorageScanResponse {
  items: StorageItemSummary[];
  totalBytes: number;
}

export interface CreateSessionRequest {
  title: string;
  kind: SessionKind;
  projectId: string | null;
  conversationType?: ConversationType;
  roomId?: string | null;
  goal?: Omit<CreateGoalRequest, "ownerType" | "ownerId"> | null;
}

export interface UpdateSessionRequest {
  title?: string;
  notificationsEnabled?: boolean;
}

export interface CreateGoalRequest {
  ownerType: GoalOwnerType;
  ownerId: string;
  text: string;
  mode?: GoalMode;
  managerAgentId?: string | null;
  coordinatorAgentId?: string | null;
  focusText?: string | null;
  focusOwnerAgentId?: string | null;
}

export interface UpdateGoalRequest {
  text?: string;
  mode?: GoalMode;
  status?: GoalStatus;
  managerAgentId?: string | null;
  coordinatorAgentId?: string | null;
  progressSummary?: string | null;
}

export interface CreateGoalFocusRequest {
  text: string;
  ownerAgentId?: string | null;
}

export interface UpdateGoalFocusRequest {
  text?: string;
  status?: GoalFocusStatus;
  ownerAgentId?: string | null;
}

export interface CreateGoalItemRequest {
  title: string;
  description?: string | null;
  status?: GoalItemStatus;
  assignedAgentId?: string | null;
  priority?: number;
  dependsOnItemId?: string | null;
}

export interface UpdateGoalItemRequest {
  title?: string;
  description?: string | null;
  status?: GoalItemStatus;
  assignedAgentId?: string | null;
  priority?: number;
  dependsOnItemId?: string | null;
  roomTaskId?: string | null;
}

export interface GoalDetailResponse {
  goal: GoalSummary;
  focuses: GoalFocusSummary[];
  items: GoalItemSummary[];
  events: GoalEventSummary[];
  proposals: GoalProposalSummary[];
}

export interface CreateCodexTaskRequest {
  prompt: string;
  projectId: string | null;
  providerId?: string | null;
  model?: string | null;
  cwd?: string;
  attachments?: UploadAttachmentInput[];
  ephemeralNotifications?: Array<{
    eventTypes?: NotificationEventType[];
    targets?: NotificationRuleTarget[];
    expireMode?: "after_trigger" | "session_end" | "manual";
  }>;
}

export interface ContinueCodexTaskRequest {
  prompt: string;
  providerId?: string | null;
  model?: string | null;
  replyToMessageId?: string | null;
  attachments?: UploadAttachmentInput[];
}

export interface UploadAttachmentInput {
  name: string;
  type?: string | null;
  size?: number | null;
  dataBase64: string;
}

export interface RecoverCodexTaskRequest {
  prompt?: string;
  providerId?: string | null;
  model?: string | null;
}

export interface QueuedMessage {
  id: string;
  sessionId: string;
  prompt: string;
  providerId?: string | null;
  model?: string | null;
  replyToMessageId?: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface QueueMessageRequest {
  prompt: string;
  providerId?: string | null;
  model?: string | null;
  replyToMessageId?: string | null;
}

export interface UpdateQueuedMessageRequest {
  prompt: string;
  providerId?: string | null;
  model?: string | null;
  replyToMessageId?: string | null;
}

export interface ReorderQueuedMessagesRequest {
  orderedIds: string[];
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
  } | null;
  createdAt: string;
}

export type MessageCardType = "preview" | "link" | "artifact" | "approval" | "file-change" | "task" | "service";

export interface MessageCardSummary {
  id: string;
  sessionId: string;
  messageId?: string | null;
  type: MessageCardType;
  title: string;
  payload: unknown;
  createdAt: string;
}

export interface SessionMessagesPage {
  items: SessionMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CodexTaskDetail {
  session: SessionSummary;
  messages: SessionMessage[];
  output: string;
  exitCode: number | null;
  errorSummary?: string;
}

export interface TaskActivitySummary {
  id: string;
  sessionId: string;
  activityId?: string | null;
  kind: "command" | "file" | "tool";
  label: string;
  detail?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivityResponse {
  sessionId: string;
  items: TaskActivitySummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TaskRunSummary {
  id: string;
  sessionId: string;
  status: "running" | "done" | "failed" | "stopped" | "interrupted";
  pid?: number | null;
  startedAt: string;
  endedAt?: string | null;
  exitCode?: number | null;
  stopRequested: boolean;
  interruptedReason?: string | null;
  promptChars?: number | null;
  promptHash?: string | null;
  contextPath?: string | null;
}

export interface TaskLogResponse {
  sessionId: string;
  log: string;
}

export interface TaskContextFileSummary {
  name: string;
  bytes: number;
  updatedAt: string;
}

export interface TaskContextResponse {
  sessionId: string;
  files: TaskContextFileSummary[];
  activeContextPack?: string | null;
}

export interface TaskContextFileResponse {
  sessionId: string;
  name: string;
  content: string;
  updatedAt: string;
}

export interface SessionCompactionSummary {
  id: string;
  sessionId: string;
  providerId?: string | null;
  model?: string | null;
  sourceMessageStartId?: string | null;
  sourceMessageEndId?: string | null;
  sourceMessageCount: number;
  sourceChars: number;
  promptHash: string;
  filePath: string;
  supersedesId?: string | null;
  createdAt: string;
}

export interface CreateSessionCompactionRequest {
  providerId?: string | null;
  model?: string | null;
}

export interface UpdateSessionCompactionRequest {
  summary: string;
}

export interface SessionCompactionResponse {
  compaction: SessionCompactionSummary;
  summary: string;
}

export interface SessionCompactionListResponse {
  sessionId: string;
  items: SessionCompactionSummary[];
}

export interface CodexTaskDiff {
  ok: boolean;
  cwd: string;
  status: string;
  stat: string;
  diff: string;
  error?: string;
}

export interface WorkspaceChangeFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
  newContent?: string;
  binary?: boolean;
  sourcePath?: string;
  sourceCwd?: string;
  sourceLabel?: string;
  sourceRunId?: string;
}

export interface WorkspaceChanges {
  ok: boolean;
  cwd: string;
  isGitRepo: boolean;
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  files: WorkspaceChangeFile[];
  raw: {
    status: string;
    stat: string;
    diff: string;
  };
  error?: string;
}

export interface RevertWorkspaceFileRequest {
  path: string;
  cwd?: string;
}

export interface WorkspaceGitFileRequest {
  path: string;
  cwd?: string;
}

export interface CreateProjectRequest {
  name: string;
  workspacePath?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  workspacePath?: string;
  checkCommand?: string;
}

export interface CreateProviderRequest {
  name: string;
  kind: ProviderSummary["kind"];
  defaultModel: string;
  baseUrl?: string;
  apiKey?: string;
  capabilities?: Partial<ProviderCapabilities>;
  rpmLimit?: number | null;
  rpmLimitEnabled?: boolean;
  useProxy?: boolean;
}

export interface UpdateProviderRequest {
  name?: string;
  kind?: ProviderSummary["kind"];
  defaultModel?: string;
  baseUrl?: string;
  apiKey?: string;
  capabilities?: Partial<ProviderCapabilities>;
  rpmLimit?: number | null;
  rpmLimitEnabled?: boolean;
  useProxy?: boolean;
}

export interface ExtensionSummary {
  id: string;
  type: "plugin" | "skill" | "mcp";
  name: string;
  description?: string;
  path?: string;
  source?: string;
  enabled?: boolean;
  sourceType?: "codex_skill" | "codex_plugin" | "plugin_cache" | "mcp_config" | "local" | "unknown";
  managedBy?: "codex_cli" | "web" | "project" | "external" | "unknown";
  syncStatus?: "synced" | "changed" | "missing" | "external" | "unknown";
  scannedAt?: string;
  capabilityKinds?: Array<"knowledge" | "tool" | "action" | "connector" | "provider" | "ui">;
  permissions?: string[];
  assignableTo?: Array<"agent" | "room" | "automation">;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  instructions: string;
}

export interface UpdateSkillRequest extends CreateSkillRequest {
  path: string;
}

export interface DeleteSkillRequest {
  path: string;
}

export interface ImportSkillRequest {
  url?: string;
  content?: string;
}

export interface ImportSkillResponse {
  imported: ExtensionSummary;
}

export interface CreatePluginRequest {
  name: string;
  description?: string;
}

export interface CreateMcpServerRequest {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ImportMcpServerRequest {
  url?: string;
  content?: string;
}

export interface ImportMcpServerResponse {
  imported: ExtensionSummary[];
  candidates: CreateMcpServerRequest[];
}

export type MarketplaceCapabilityType = "skill" | "mcp" | "plugin";

export interface MarketplaceCatalogSource {
  id: string;
  name: string;
  homepage?: string;
}

export interface MarketplaceSkillInstall {
  kind: "skill";
  skill: CreateSkillRequest;
}

export interface MarketplaceSkillUrlInstall {
  kind: "skillUrl";
  url: string;
}

export interface MarketplaceMcpServersInstall {
  kind: "mcpServers";
  config: {
    mcpServers: Record<string, Omit<CreateMcpServerRequest, "name">>;
  } | Record<string, Omit<CreateMcpServerRequest, "name">>;
}

export interface MarketplacePluginInstall {
  kind: "plugin";
  manifest: CreatePluginRequest & { version?: string };
}

export type MarketplaceInstall =
  | MarketplaceSkillInstall
  | MarketplaceSkillUrlInstall
  | MarketplaceMcpServersInstall
  | MarketplacePluginInstall;

export interface MarketplaceCatalogItem {
  id: string;
  type: MarketplaceCapabilityType;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  author?: string;
  version?: string;
  source?: string;
  requires?: {
    runtimes?: string[];
    commands?: string[];
  };
  install: MarketplaceInstall;
}

export interface MarketplaceCatalog {
  schemaVersion: 1;
  source: MarketplaceCatalogSource;
  items: MarketplaceCatalogItem[];
}

export interface MarketplaceCatalogResponse {
  source: MarketplaceCatalogSource;
  items: MarketplaceCatalogItem[];
  error?: string;
  fetchedAt?: string;
}

export interface ImportMarketplaceCatalogRequest {
  url?: string;
  content?: string;
}

export interface DeleteMarketplaceItemsRequest {
  ids: string[];
}

export interface InstallMarketplaceItemRequest {
  item: MarketplaceCatalogItem;
}

export interface InstallMarketplaceItemResponse {
  installed: ExtensionSummary[];
}

export interface ExtensionDetail {
  item: ExtensionSummary;
  format: "json" | "markdown" | "toml" | "text";
  content: string;
}

export interface ProviderTestResponse {
  ok: boolean;
  providerId: string;
  status: number | null;
  durationMs: number;
  error?: string;
}

export interface ProviderModelsResponse {
  ok: boolean;
  providerId: string;
  models: string[];
  status: number | null;
  durationMs: number;
  error?: string;
}

export interface ProviderDetectionResponse {
  ok: boolean;
  providerId: string;
  kind: ProviderSummary["kind"];
  capabilities: ProviderCapabilities;
  durationMs: number;
  checks: {
    responses: { ok: boolean; status: number | null; error?: string };
    chatCompletions: { ok: boolean; status: number | null; error?: string };
  };
  error?: string;
}

export interface ProviderHealthCheck {
  id: string;
  providerId: string;
  kind: "test" | "models";
  ok: boolean;
  status: number | null;
  durationMs: number;
  error?: string;
  checkedAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  updatedAt: string;
}

export interface FileMount {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFileMountRequest {
  name: string;
  rootPath: string;
}

export interface UpdateFileMountRequest {
  name?: string;
  rootPath?: string;
}

export interface FileListResponse {
  mountId?: string;
  root: string;
  path: string;
  parentPath: string | null;
  entries: FileEntry[];
}

export interface FileContentResponse {
  path: string;
  content: string;
  updatedAt: string;
}

export interface FileArchiveRequest {
  path: string;
  mountId?: string | null;
  rootPath?: string | null;
  excludes: string[];
}

export interface FileArchivePreviewResponse {
  files: number;
  bytes: number;
  excluded: number;
  excludedExamples: string[];
}

export interface ArchiveIgnoreTemplate {
  id: string;
  name: string;
  group: string;
  rules: string;
}

export interface SaveFileRequest {
  content: string;
}

export interface CreateFileRequest {
  parentPath: string;
  name: string;
  kind: "file" | "directory";
}

export interface RenameFileRequest {
  path: string;
  newName: string;
}

export interface TerminalCommandRequest {
  command: string;
  cwd?: string;
  sessionId?: string;
}

export interface TerminalCommandResponse {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface TerminalSessionSummary {
  id: string;
  name: string;
  cwd: string;
  mode: "pty" | "pipe";
  status: "running" | "closed";
  createdAt: string;
}

export interface CreateTerminalSessionRequest {
  name?: string;
  cwd?: string;
}

export interface UpdateTerminalSessionRequest {
  name?: string;
}

export interface TerminalDefaultsResponse {
  defaultCwd: string;
}

export interface AutomationSummary {
  id: string;
  name: string;
  projectId: string | null;
  providerId?: string | null;
  model?: string | null;
  actionType?: "agent" | "command";
  prompt: string;
  command?: string | null;
  cwd?: string | null;
  commandTimeoutSeconds?: number | null;
  retryMax?: number | null;
  retryDelayMinutes?: number | null;
  overlapPolicy?: "queue" | "skip";
  sessionId?: string | null;
  runningRuns?: number;
  queuedRuns?: number;
  lastRunStatus?: AutomationRunSummary["status"] | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  schedule: string;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunSummary {
  id: string;
  automationId: string;
  sessionId: string;
  status: "queued" | "running" | "done" | "failed" | "stopped" | "skipped" | "canceled";
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
}

export interface CreateAutomationRequest {
  name: string;
  projectId: string | null;
  providerId?: string | null;
  model?: string | null;
  actionType?: AutomationSummary["actionType"];
  prompt: string;
  command?: string | null;
  cwd?: string | null;
  commandTimeoutSeconds?: number | null;
  retryMax?: number | null;
  retryDelayMinutes?: number | null;
  overlapPolicy?: AutomationSummary["overlapPolicy"];
  schedule: string;
}

export interface UpdateAutomationRequest {
  name?: string;
  projectId?: string | null;
  providerId?: string | null;
  model?: string | null;
  actionType?: AutomationSummary["actionType"];
  prompt?: string;
  command?: string | null;
  cwd?: string | null;
  commandTimeoutSeconds?: number | null;
  retryMax?: number | null;
  retryDelayMinutes?: number | null;
  overlapPolicy?: AutomationSummary["overlapPolicy"];
  schedule?: string;
  status?: AutomationSummary["status"];
}

export type AgentListenMode = "none" | "passive" | "active" | "orchestrator";
export type AgentWorkspaceMode = "shared-readonly" | "isolated-worktree" | "isolated-worktree-with-shared-room" | "shared-write" | "merge-workspace";
export type AgentProjectAccessMode = "none" | "selected" | "all";
export type PermissionProfileId = "read-only" | "workspace-write" | "developer" | "maintainer" | "danger-full-access";
export type RoomStatus = "draft" | "running" | "paused" | "done" | "failed";
export type AgentRunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "interrupted";
export type AgentRoleSourceType = "custom-markdown" | "file-import" | "builtin-template";

export interface AgentRoleTemplateSummary {
  id: string;
  name: string;
  group: string;
  description: string;
  localizedNames?: Record<string, { name: string; description?: string }>;
  sourcePath: string;
  sourceUrl?: string | null;
}

export interface AgentPermissionSettings {
  canWriteFiles: boolean;
  canRunCommands: boolean;
  canUseTerminal: boolean;
  canCreatePreview: boolean;
  canWriteSharedWorkspace: boolean;
  canRequestApproval: boolean;
  canTriggerAgents: boolean;
  canMergeChanges: boolean;
}

export interface AgentRoleSummary {
  id: string;
  name: string;
  description: string;
  sourceType: AgentRoleSourceType;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  markdownContent: string;
  systemPrompt: string;
  capabilities: string[];
  defaultListenMode: AgentListenMode;
  defaultListenEvents: string[];
  defaultWorkspaceMode: AgentWorkspaceMode;
  defaultSandboxMode?: CodexSandboxMode | null;
  defaultApprovalPolicy?: CodexApprovalPolicy | null;
  outputContract?: string | null;
  safetyNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRoleRequest {
  name: string;
  description?: string;
  includeDescriptionInPrompt?: boolean;
  sourceType?: AgentRoleSourceType;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  markdownContent?: string;
  systemPrompt?: string;
  capabilities?: string[];
  defaultListenMode?: AgentListenMode;
  defaultListenEvents?: string[];
  defaultWorkspaceMode?: AgentWorkspaceMode;
  defaultSandboxMode?: CodexSandboxMode | null;
  defaultApprovalPolicy?: CodexApprovalPolicy | null;
  outputContract?: string | null;
  safetyNotes?: string | null;
}

export interface CreateAgentRoleFromTemplateRequest {
  templateId: string;
  name?: string;
  description?: string | null;
  includeDescriptionInPrompt?: boolean;
}

export type UpdateAgentRoleRequest = Partial<CreateAgentRoleRequest>;

export interface AgentSummary {
  id: string;
  name: string;
  roleId: string;
  description?: string | null;
  extraPrompt?: string | null;
  providerId?: string | null;
  model?: string | null;
  workspaceMode: AgentWorkspaceMode;
  defaultProjectId?: string | null;
  favoriteProjectIds: string[];
  projectAccessMode: AgentProjectAccessMode;
  allowedProjectIds: string[];
  permissionProfileId?: PermissionProfileId | null;
  permissions: AgentPermissionSettings;
  maxConcurrentRuns: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomAgentSummary extends AgentSummary {
  listenMode: AgentListenMode;
}

export interface CreateAgentRequest {
  name: string;
  roleId: string;
  description?: string | null;
  extraPrompt?: string | null;
  providerId?: string | null;
  model?: string | null;
  workspaceMode?: AgentWorkspaceMode;
  defaultProjectId?: string | null;
  favoriteProjectIds?: string[];
  projectAccessMode?: AgentProjectAccessMode;
  allowedProjectIds?: string[];
  permissionProfileId?: PermissionProfileId | null;
  permissions?: Partial<AgentPermissionSettings>;
  maxConcurrentRuns?: number;
  enabled?: boolean;
}

export type UpdateAgentRequest = Partial<CreateAgentRequest>;

export interface CreateAgentSessionRequest {
  projectId?: string | null;
}

export interface ExecutionContextSummary {
  id: string;
  sourceType: "session" | "agent-chat" | "room-task" | "automation" | "schedule";
  sessionId?: string | null;
  agentId?: string | null;
  roomId?: string | null;
  projectId?: string | null;
  workspacePath: string;
  providerId?: string | null;
  model?: string | null;
  permissionProfileId?: PermissionProfileId | null;
  resolvedPermissions: AgentPermissionSettings;
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  createdBy: "user" | "system" | "agent";
  createdAt: string;
}

export interface AgentGroupSummary {
  id: string;
  name: string;
  description?: string | null;
  agentIds: string[];
  memberListenModes?: Record<string, AgentListenMode>;
  collaborationRules: string;
  eventRoutingRules: string;
  maxConcurrentAgents: number;
  approvalPolicy: string;
  mergeStrategy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentGroupRequest {
  name: string;
  description?: string | null;
  agentIds?: string[];
  memberListenModes?: Record<string, AgentListenMode>;
  collaborationRules?: string;
  eventRoutingRules?: string;
  maxConcurrentAgents?: number;
  approvalPolicy?: string;
  mergeStrategy?: string;
}

export type UpdateAgentGroupRequest = Partial<CreateAgentGroupRequest>;

export interface AgentCircleSummary {
  id: string;
  name: string;
  description?: string | null;
  roleIds: string[];
  collaborationRules: string;
  eventRoutingRules: string;
  maxConcurrentAgents: number;
  approvalPolicy: string;
  mergeStrategy: string;
  groupTemplateId?: string | null;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentCircleRequest {
  name: string;
  description?: string | null;
  roleIds?: string[];
  collaborationRules?: string;
  eventRoutingRules?: string;
  maxConcurrentAgents?: number;
  approvalPolicy?: string;
  mergeStrategy?: string;
}

export type UpdateAgentCircleRequest = Partial<CreateAgentCircleRequest>;

export interface RoomSummary {
  id: string;
  sessionId?: string | null;
  name: string;
  groupId?: string | null;
  circleId?: string | null;
  projectId?: string | null;
  status: RoomStatus;
  sharedContext?: string | null;
  goal?: GoalSummary | null;
  orchestration: RoomOrchestrationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface RoomOrchestrationSettings {
  autoStartTasks: boolean;
  autoCreateReviewTasks: boolean;
  autoListenAfterAgentEvents: boolean;
  notifyUserOnFailure: boolean;
  maxAutoRetries: number;
  maxAutoListenChainDepth: number;
  maxAutoListenTasksPerEvent: number;
}

export interface CreateRoomRequest {
  name: string;
  groupId?: string | null;
  circleId?: string | null;
  projectId?: string | null;
  sharedContext?: string | null;
  goal?: Omit<CreateGoalRequest, "ownerType" | "ownerId"> | null;
}

export type UpdateRoomRequest = Partial<Pick<CreateRoomRequest, "name" | "sharedContext">> & { status?: RoomStatus; orchestration?: Partial<RoomOrchestrationSettings> };

export interface RoomEventSummary {
  id: string;
  roomId: string;
  type: string;
  sourceAgentId?: string | null;
  targetAgentId?: string | null;
  payload: unknown;
  createdAt: string;
}

export type RoomArtifactKind = "report" | "file-change" | "preview" | "link" | "approval" | "task" | "decision" | "handoff";

export interface RoomArtifactSummary {
  id: string;
  roomId: string;
  agentId?: string | null;
  kind: RoomArtifactKind;
  title: string;
  payload: unknown;
  createdAt: string;
}

export interface CreateRoomArtifactRequest {
  agentId?: string | null;
  kind: RoomArtifactKind;
  title: string;
  payload?: unknown;
}

export interface RoomDecisionSummary {
  id: string;
  roomId: string;
  title: string;
  status: "open" | "approved" | "rejected" | "resolved";
  payload: unknown;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface CreateRoomDecisionRequest {
  title: string;
  status?: RoomDecisionSummary["status"];
  payload?: unknown;
}

export interface UpdateRoomDecisionRequest {
  title?: string;
  status?: RoomDecisionSummary["status"];
  payload?: unknown;
}

export type RoomHandoffStatus = "open" | "accepted" | "returned" | "resolved" | "cancelled";

export interface RoomHandoffSummary {
  id: string;
  roomId: string;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  summary: string;
  status: RoomHandoffStatus;
  payload: unknown;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface CreateRoomHandoffRequest {
  fromAgentId?: string | null;
  toAgentId?: string | null;
  summary: string;
  status?: RoomHandoffStatus;
  payload?: unknown;
}

export interface UpdateRoomHandoffRequest {
  fromAgentId?: string | null;
  toAgentId?: string | null;
  summary?: string;
  status?: RoomHandoffStatus;
  payload?: unknown;
}

export interface CreateRoomMessageRequest {
  content: string;
  sessionId?: string | null;
  replyToMessageId?: string | null;
  attachments?: UploadAttachmentInput[];
}

export interface CreateRoomMessageResponse {
  event: RoomEventSummary;
  message?: SessionMessage | null;
  session?: SessionSummary | null;
  tasks: RoomTaskSummary[];
  runs: AgentRunSummary[];
}

export interface AgentRunSummary {
  id: string;
  roomId: string;
  agentId: string;
  taskId?: string | null;
  goalId?: string | null;
  sessionId?: string | null;
  status: AgentRunStatus;
  providerId?: string | null;
  model?: string | null;
  workspacePath?: string | null;
  mergeStatus?: "none" | "pending" | "merged" | "rejected" | "conflict" | "error";
  mergeSummary?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  exitCode?: number | null;
}

export interface RoomRunDiffResponse {
  runId: string;
  ok: boolean;
  workspacePath: string;
  status: string;
  stat: string;
  diff: string;
  error?: string;
}

export interface RoomRunMergeResponse {
  run: AgentRunSummary;
  ok: boolean;
  message?: string;
}

export type RoomTaskStatus = "queued" | "assigned" | "running" | "done" | "failed" | "cancelled";
export type RoomScheduleStatus = "active" | "paused" | "done";

export interface RoomTaskSummary {
  id: string;
  roomId: string;
  goalItemId?: string | null;
  title: string;
  prompt: string;
  assignedAgentId?: string | null;
  status: RoomTaskStatus;
  priority: number;
  dependsOnTaskId?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoomTaskRequest {
  title: string;
  prompt: string;
  assignedAgentId?: string | null;
  priority?: number;
  dependsOnTaskId?: string | null;
  scheduledAt?: string | null;
}

export interface UpdateRoomTaskRequest {
  title?: string;
  prompt?: string;
  assignedAgentId?: string | null;
  priority?: number;
  dependsOnTaskId?: string | null;
  status?: RoomTaskStatus;
}

export interface RoomScheduleSummary {
  id: string;
  roomId: string;
  agentId: string;
  taskPrompt: string;
  scheduleType: "once" | "hourly" | "daily";
  runAt?: string | null;
  status: RoomScheduleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoomScheduleRequest {
  agentId: string;
  taskPrompt: string;
  scheduleType: "once" | "hourly" | "daily";
  runAt?: string | null;
}
