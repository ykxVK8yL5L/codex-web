export type SessionKind = "project" | "scratch";
export type ConversationType = "codex" | "agent" | "room";

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

export type PreviewScopeType = "project" | "session";
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
}

export interface UpdateSessionRequest {
  title?: string;
}

export interface CreateCodexTaskRequest {
  prompt: string;
  projectId: string | null;
  providerId?: string | null;
  model?: string | null;
  cwd?: string;
}

export interface ContinueCodexTaskRequest {
  prompt: string;
  providerId?: string | null;
  model?: string | null;
  replyToMessageId?: string | null;
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
}

export interface UpdateProviderRequest {
  name?: string;
  kind?: ProviderSummary["kind"];
  defaultModel?: string;
  baseUrl?: string;
  apiKey?: string;
  capabilities?: Partial<ProviderCapabilities>;
}

export interface ExtensionSummary {
  id: string;
  type: "plugin" | "skill" | "mcp";
  name: string;
  description?: string;
  path?: string;
  source?: string;
  enabled?: boolean;
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
  prompt: string;
  schedule: string;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunSummary {
  id: string;
  automationId: string;
  sessionId: string;
  status: "running" | "done" | "failed" | "stopped";
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
}

export interface CreateAutomationRequest {
  name: string;
  projectId: string | null;
  providerId?: string | null;
  model?: string | null;
  prompt: string;
  schedule: string;
}

export interface UpdateAutomationRequest {
  name?: string;
  projectId?: string | null;
  providerId?: string | null;
  model?: string | null;
  prompt?: string;
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
  orchestration: RoomOrchestrationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface RoomOrchestrationSettings {
  autoStartTasks: boolean;
  autoCreateReviewTasks: boolean;
  notifyUserOnFailure: boolean;
  maxAutoRetries: number;
}

export interface CreateRoomRequest {
  name: string;
  groupId?: string | null;
  circleId?: string | null;
  projectId?: string | null;
  sharedContext?: string | null;
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
