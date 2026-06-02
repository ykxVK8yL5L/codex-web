import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FilePlus2,
  Files,
  FolderOpen,
  FolderGit2,
  FolderPlus,
  GitPullRequest,
  Globe,
  GripVertical,
  History,
  Info,
  Lock,
  Menu,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  Pause,
  PackageX,
  PanelLeftOpen,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Unlock,
  Users,
  X,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { useAppDialog } from "@/components/AppDialog";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Button } from "@/components/ui/button";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { IconText } from "@/components/IconText";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PreviewDirectoryPicker } from "@/components/PreviewDirectoryPicker";
import { ToastViewport } from "@/components/ToastViewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes, formatShortDate, prettyJson, renderPreviewCommand, rulesForArchiveTemplates } from "@/lib/format";
import { localeLabels, translate, type Locale, type TranslationKey } from "@/lib/i18n";
import { detectInitialLocale, pageFromHash, routeFromHash, type Page } from "@/lib/navigation";
import { openPreviewUrl } from "@/lib/previews";
import type {
  ApprovalDecisionResponse,
  ApprovalGrantSummary,
  ApprovalSummary,
  AgentCircleSummary,
  AgentGroupSummary,
  AgentListenMode,
  AgentProjectAccessMode,
  AgentRoleSummary,
  AgentRoleTemplateSummary,
  AgentSummary,
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
  ContinueCodexTaskRequest,
  CreateCodexTaskRequest,
  CreateFileRequest,
  CreateFileMountRequest,
  CreateRoomMessageResponse,
  CreateProjectRequest,
  CreatePreviewRequest,
  CreateProviderRequest,
  CreateAutomationRequest,
  CreateTerminalSessionRequest,
  ExtensionDetail,
  ExtensionSummary,
  ExecutionContextSummary,
  EnvironmentOverview,
  EnvironmentBulkActionRequest,
  EnvironmentPackageDetailResponse,
  EnvironmentPackageManagerOption,
  EnvironmentPackageRecord,
  EnvironmentRestoreRun,
  EnvironmentToolRecord,
  EnvironmentToolRegistryItem,
  EnvironmentToolProbe,
  EnvironmentToolVersionItem,
  FileContentResponse,
  FileArchiveRequest,
  FileArchivePreviewResponse,
  FileEntry,
  FileListResponse,
  FileMount,
  GoalDetailResponse,
  GoalFocusStatus,
  GoalItemStatus,
  GoalMode,
  GoalStatus,
  GoalSummary,
  LoginResponse,
  MaintenanceCleanupResponse,
  MessageCardSummary,
  NotificationAccountSummary,
  NotificationChannelDefinition,
  NotificationDeliverySummary,
  NotificationEphemeralRuleSummary,
  NotificationEventType,
  NotificationRecipientSummary,
  NotificationRuleSummary,
  NotificationRuleTarget,
  NotificationSeverity,
  NotificationSettingsResponse,
  PageResponse,
  PermissionProfileId,
  ProjectCheckRunSummary,
  ProjectGitOperationRequest,
  ProjectGitOperationSummary,
  ProjectStatsSummary,
  ProjectSummary,
  PreviewAccess,
  PreviewAccessSettings,
  PreviewLogsResponse,
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
  RenameFileRequest,
  ReorderQueuedMessagesRequest,
  AgentRunSummary,
  RecoverCodexTaskRequest,
  RoomEventSummary,
  RoomArtifactSummary,
  RoomAgentSummary,
  RoomDecisionSummary,
  RoomHandoffSummary,
  RoomRunDiffResponse,
  RoomRunMergeResponse,
  RoomScheduleSummary,
  RoomSummary,
  RoomTaskSummary,
  SessionMessage,
  SessionCompactionResponse,
  SessionCompactionSettings,
  SessionMessagesPage,
  SessionSummary,
  SessionCompactionListResponse,
  SetupStartResponse,
  ResetOtpResponse,
  StorageItemSummary,
  StorageScanResponse,
  SystemBackupPreviewResponse,
  SystemBackupSettings,
  SystemRestoreResponse,
  TerminalDefaultsResponse,
  TerminalCommandResponse,
  TaskActivityResponse,
  TaskActivitySummary,
  TaskContextFileResponse,
  TaskContextResponse,
  TaskHealthResponse,
  TaskHealthRepairResponse,
  TaskLogResponse,
  TaskRunSummary,
  TerminalSessionSummary,
  UploadAttachmentInput,
  UpdateQueuedMessageRequest,
  UpdateSessionCompactionRequest,
  UpdateSessionCompactionSettingsRequest,
  UpdateFileMountRequest,
  UpdateProjectRequest,
  UpdateProviderRequest,
  UpdateSessionRequest,
  UpdateAutomationRequest,
  UpdateAccessTokenRequest,
  UpdateCodexRuntimeSettingsRequest,
  InstallEnvironmentToolRequest,
  UpdateRoomDecisionRequest,
  UpdateRoomHandoffRequest,
  UpdateSystemBackupSettingsRequest,
  ConfirmOtpResetRequest,
  UpdateTerminalSessionRequest,
  WorkspaceChangeFile,
  WorkspaceChanges,
} from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";
type ToastState = { id: number; message: string; tone: ToastTone };
type ComposerTarget = "prompt" | "room";
type ComposerFileReference = {
  id: string;
  name: string;
  path: string;
  absolutePath: string;
  kind: FileEntry["kind"];
  sourceLabel: string;
};
const workspaceChangedEvent = "codex-workspace-changed";
const taskActivityChangedEvent = "codex-task-activity-changed";
const sessionInfoRequestedEvent = "codex-session-info-requested";
const browserNotificationsEnabledKey = "codex-web-browser-notifications-enabled";
const suppressedAppNotificationsKey = "codex-web-suppressed-app-notifications";

const listenModeOptions: AgentListenMode[] = ["none", "passive", "active", "orchestrator"];

function localStorageStringSet(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

function readableStatus(status: SessionSummary["status"] | undefined, t: TFunction) {
  if (status === "running") return t("session.statusRunning");
  if (status === "done") return t("session.statusDone");
  if (status === "paused") return t("session.statusPaused");
  if (status === "interrupted") return t("session.statusInterrupted");
  return t("session.statusReady");
}

function readableSessionType(session: SessionSummary | undefined, t: TFunction) {
  if (session?.conversationType === "room") return t("session.typeRoom");
  if (session?.conversationType === "agent") return t("session.typeAgent");
  if (session?.conversationType === "automation") return t("session.typeAutomation");
  return t("session.typeCodex");
}

function readableNotificationEvent(type: NotificationEventType, t: TFunction) {
  if (type === "task_completed") return t("session.notifyEventCompleted");
  if (type === "task_failed") return t("session.notifyEventFailed");
  if (type === "task_interrupted") return t("session.notifyEventInterrupted");
  if (type === "needs_approval") return t("session.notifyEventApproval");
  if (type === "task_health_issue") return t("session.notifyEventTaskHealth");
  if (type === "provider_check_failed") return t("session.notifyEventProviderCheck");
  if (type === "backup_failed") return t("session.notifyEventBackupFailed");
  if (type === "restore_failed") return t("session.notifyEventRestoreFailed");
  if (type === "auth_login") return t("session.notifyEventLogin");
  return type;
}

function readableGoalMode(mode: GoalMode, t: TFunction) {
  if (mode === "tracked") return t("goal.modeTracked");
  if (mode === "managed") return t("goal.modeManaged");
  if (mode === "orchestrated") return t("goal.modeOrchestrated");
  return t("goal.modeReference");
}

function readableGoalStatus(status: GoalStatus | GoalFocusStatus, t: TFunction) {
  if (status === "paused") return t("goal.statusPaused");
  if (status === "completed") return t("goal.statusCompleted");
  if (status === "cancelled") return t("goal.statusCancelled");
  if (status === "archived") return t("goal.statusArchived");
  return t("goal.statusActive");
}

const storageItemTypeLabels: Record<StorageItemSummary["type"], TranslationKey> = {
  "project-workspace": "settings.storageTypeProjectWorkspace",
  "session-data": "settings.storageTypeSessionData",
  "session-workspace": "settings.storageTypeSessionWorkspace",
  "room-workspace": "settings.storageTypeRoomWorkspace",
  "room-worktree": "settings.storageTypeRoomWorktree",
  "task-log": "settings.storageTypeTaskLog",
  "preview-log": "settings.storageTypePreviewLog",
};

function readableStorageItemType(type: StorageItemSummary["type"], t: TFunction) {
  return t(storageItemTypeLabels[type]);
}

const backupManifestTextLabels: Record<string, TranslationKey> = {
  "apps/api/data/**": "settings.backupScopeData",
  "备份清单 manifest.json": "settings.backupScopeManifest",
  "已绑定项目的路径与 Git 参考信息": "settings.backupScopeProjectRefs",
  "apps/api/data 之外的真实项目源码目录": "settings.backupExcludeProjectSource",
  "构建产物和外部挂载目录": "settings.backupExcludeBuildAndMounts",
  "用户配置的备份忽略规则匹配到的 apps/api/data 内文件": "settings.backupExcludeIgnoreRules",
  "真实项目目录不会随系统备份打包；还原后如果路径不存在，需要重新绑定项目目录。": "settings.backupWarningProjectSourceExcluded",
  "Provider API Key 等应用状态会随 apps/api/data 一起备份。请妥善保管备份文件。": "settings.backupWarningSensitiveDataIncluded",
  "SQLite WAL checkpoint 失败，备份仍会继续，但正在写入的数据可能需要重启后再备份一次。": "settings.backupWarningWalCheckpointFailed",
  "系统数据已还原到 apps/api/data。请通过终端重启 API 服务后再继续使用；无需重启前端或 Docker 容器。": "settings.backupWarningRestoreRestartApi",
};

function readableBackupManifestText(value: string, t: TFunction) {
  const key = backupManifestTextLabels[value];
  return key ? t(key) : value;
}

const roomArtifactKinds: RoomArtifactSummary["kind"][] = ["report", "file-change", "preview", "link", "approval", "task", "decision", "handoff"];

const roomArtifactKindLabels: Record<RoomArtifactSummary["kind"], TranslationKey> = {
  report: "room.artifactKindReport",
  "file-change": "room.artifactKindFileChange",
  preview: "room.artifactKindPreview",
  link: "room.artifactKindLink",
  approval: "room.artifactKindApproval",
  task: "room.artifactKindTask",
  decision: "room.artifactKindDecision",
  handoff: "room.artifactKindHandoff",
};

function readableRoomArtifactKind(kind: RoomArtifactSummary["kind"], t: TFunction) {
  return t(roomArtifactKindLabels[kind]);
}

const roomDecisionStatusLabels: Record<RoomDecisionSummary["status"], TranslationKey> = {
  open: "room.decisionStatusOpen",
  approved: "room.decisionStatusApproved",
  rejected: "room.decisionStatusRejected",
  resolved: "room.decisionStatusResolved",
};

function readableRoomDecisionStatus(status: RoomDecisionSummary["status"], t: TFunction) {
  return t(roomDecisionStatusLabels[status] ?? "room.decisionStatusOpen");
}

const roomHandoffStatusLabels: Record<RoomHandoffSummary["status"], TranslationKey> = {
  open: "room.handoffStatusOpen",
  accepted: "room.handoffStatusAccepted",
  returned: "room.handoffStatusReturned",
  resolved: "room.handoffStatusResolved",
  cancelled: "room.handoffStatusCancelled",
};

function readableRoomHandoffStatus(status: RoomHandoffSummary["status"], t: TFunction) {
  return t(roomHandoffStatusLabels[status] ?? "room.handoffStatusOpen");
}

function readableGitStatus(status: ProjectSummary["gitStatus"] | undefined, changedFiles: number, t: TFunction) {
  if (status === "dirty") return t("project.gitChanged").replace("{count}", String(changedFiles));
  if (status === "clean") return t("project.gitClean");
  if (status === "not-git") return t("project.notGitRepo");
  if (status === "error") return t("project.gitStatusFailed");
  return t("project.gitChanged").replace("{count}", String(changedFiles));
}

function readLocalStorageValue(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function projectFolderName(project: ProjectSummary) {
  const normalized = project.workspacePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  return normalized.split("/").filter(Boolean).at(-1) || project.id;
}

function projectDisplayName(project: ProjectSummary | undefined, projects: ProjectSummary[]) {
  if (!project) return "";
  const duplicateName = projects.some((item) => item.id !== project.id && item.name === project.name);
  return duplicateName ? `${project.name} / ${projectFolderName(project)}` : project.name;
}

function readableListenMode(mode: AgentListenMode, t: TFunction) {
  if (mode === "none") return t("contacts.listenModeNone");
  if (mode === "active") return t("contacts.listenModeActive");
  if (mode === "orchestrator") return t("contacts.listenModeOrchestrator");
  return t("contacts.listenModePassive");
}

function readableAgentWorkspaceMode(mode: AgentSummary["workspaceMode"], t: TFunction) {
  if (mode === "shared-readonly") return t("contacts.workspaceModeSharedReadonly");
  if (mode === "isolated-worktree") return t("contacts.workspaceModeIsolatedWorktree");
  if (mode === "isolated-worktree-with-shared-room") return t("contacts.workspaceModeIsolatedWorktreeWithSharedRoom");
  if (mode === "shared-write") return t("contacts.workspaceModeSharedWrite");
  return t("contacts.workspaceModeMergeWorkspace");
}

function readablePermissionProfile(profile: PermissionProfileId | "custom" | null | undefined, t: TFunction) {
  if (profile === "read-only") return t("contacts.permissionProfileReadOnly");
  if (profile === "workspace-write") return t("contacts.permissionProfileWorkspaceWrite");
  if (profile === "developer") return t("contacts.permissionProfileDeveloper");
  if (profile === "maintainer") return t("contacts.permissionProfileMaintainer");
  if (profile === "danger-full-access") return t("contacts.permissionProfileDangerFullAccess");
  return t("contacts.permissionProfileCustom");
}

function newestLinesFirst(log: string) {
  return log.split(/\r?\n/).reverse().join("\n");
}

function newestTaskRunsFirst(log: string) {
  const chunks = log.split(/(?=^\[codex-web\])/m);
  if (chunks.length <= 1) return log;
  const prefix = chunks[0]?.startsWith("[codex-web]") ? "" : chunks.shift() ?? "";
  return [prefix, ...chunks.reverse()].filter(Boolean).join("").trimStart();
}

function localUserMessage(content: string): SessionMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

function attachmentListMarkdown(files: File[]) {
  if (!files.length) return "";
  return [
    "## Attachments",
    ...files.map((file, index) => `${index + 1}. ${file.name} (${formatBytes(file.size)})`),
  ].join("\n");
}

function messageTextWithFiles(prompt: string, files: File[]) {
  const attachmentList = attachmentListMarkdown(files);
  return attachmentList ? `${prompt.trim()}\n\n${attachmentList}` : prompt.trim();
}

function fileReferencesMarkdown(references: ComposerFileReference[]) {
  if (!references.length) return "";
  return [
    "## Referenced files and folders",
    ...references.map((item, index) => `${index + 1}. ${item.kind}: ${item.absolutePath}`),
  ].join("\n");
}

function promptWithFileReferences(prompt: string, references: ComposerFileReference[]) {
  const referenceList = fileReferencesMarkdown(references);
  return referenceList ? `${prompt.trim()}\n\n${referenceList}` : prompt.trim();
}

function messageTextWithContext(prompt: string, files: File[], references: ComposerFileReference[]) {
  return promptWithFileReferences(messageTextWithFiles(prompt, files), references);
}

const maxComposerAttachmentFiles = 8;
const maxComposerAttachmentBytes = 5 * 1024 * 1024;

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

async function filesToAttachmentInputs(files: File[]): Promise<UploadAttachmentInput[]> {
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    type: file.type || null,
    size: file.size,
    dataBase64: await fileToBase64(file),
  })));
}

function mergeMessages(...groups: SessionMessage[][]) {
  const seenIds = new Set<string>();
  const seenPersistedContent = new Set<string>();
  return groups
    .flat()
    .filter((message) => {
      const contentKey = `${message.role}:${message.content}`;
      if (message.id.startsWith("local-")) {
        if (seenPersistedContent.has(contentKey)) return false;
        seenPersistedContent.add(contentKey);
        return true;
      }
      if (seenIds.has(message.id)) return false;
      seenIds.add(message.id);
      seenPersistedContent.add(contentKey);
      return true;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

type TaskEvent =
  | { type: "snapshot"; session: SessionSummary; messages: SessionMessage[]; queue: QueuedMessage[]; exitCode: number | null }
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
type ActivityItem = Extract<TaskEvent, { type: "activity" }>;

function readableActivityStatus(status: string | undefined, kind: string, t: TFunction) {
  if (status === "in_progress") return t("session.activityInProgress");
  if (status === "completed") return t("session.activityCompleted");
  if (status === "failed") return t("session.activityFailed");
  return status || kind;
}

function readableRunStatus(run: TaskRunSummary, t: TFunction) {
  if (run.stopRequested || run.status === "stopped") return t("session.runStopped");
  if (run.status === "running") return t("session.statusRunning");
  if (run.status === "done") return t("session.statusDone");
  if (run.status === "failed") return t("session.activityFailed");
  if (run.status === "interrupted") return t("session.statusInterrupted");
  return run.status;
}

function activityFromSummary(item: TaskActivitySummary): ActivityItem {
  return {
    type: "activity",
    id: item.activityId ?? item.id,
    kind: item.kind,
    label: item.label,
    detail: item.detail ?? undefined,
    status: item.status ?? undefined,
    at: item.updatedAt,
  };
}

function publishWorkspaceChanged(sessionId: string) {
  window.dispatchEvent(new CustomEvent(workspaceChangedEvent, { detail: { sessionId } }));
}

function publishTaskActivityChanged(sessionId: string) {
  window.dispatchEvent(new CustomEvent(taskActivityChangedEvent, { detail: { sessionId } }));
}

const navItems: Array<{ page: Page; labelKey: TranslationKey; icon: React.ComponentType<{ size?: number }> }> = [
  { page: "sessions", labelKey: "nav.sessions", icon: Bot },
  { page: "files", labelKey: "nav.files", icon: Files },
  { page: "terminal", labelKey: "nav.terminal", icon: TerminalIcon },
  { page: "projects", labelKey: "nav.projects", icon: FolderGit2 },
  { page: "previews", labelKey: "nav.previews", icon: Globe },
  { page: "contacts", labelKey: "nav.contacts", icon: Users },
  { page: "extensions", labelKey: "nav.extensions", icon: Plug },
  { page: "automations", labelKey: "nav.automations", icon: Clock3 },
  { page: "providers", labelKey: "nav.providers", icon: Boxes },
  { page: "approvals", labelKey: "nav.approvals", icon: ShieldCheck },
  { page: "settings", labelKey: "nav.settings", icon: Settings },
];

const NotificationCenterContext = React.createContext<React.ReactNode>(null);

function NotificationCenter({
  items,
  unreadCount,
  open,
  permission,
  browserNotificationsEnabled,
  t,
  onToggle,
  onClose,
  onMarkRead,
  onClear,
  onRequestBrowser,
  onBrowserNotificationsEnabledChange,
  onOpenSession,
}: {
  items: AppNotificationSummary[];
  unreadCount: number;
  open: boolean;
  permission: NotificationPermission;
  browserNotificationsEnabled: boolean;
  t: TFunction;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (ids?: string[]) => void;
  onClear: () => void;
  onRequestBrowser: () => void;
  onBrowserNotificationsEnabledChange: (enabled: boolean) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);
  return (
    <div className="notification-center" ref={rootRef}>
      <button className="notification-center-trigger" type="button" aria-label={t("notificationCenter.title")} title={t("notificationCenter.title")} onClick={onToggle}>
        <Bell size={17} />
        {unreadCount > 0 && <span className="notification-dot">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-center-panel">
          <div className="notification-center-head">
            <div>
              <strong>{t("notificationCenter.title")}</strong>
              <span>{unreadCount > 0 ? t("notificationCenter.unread").replace("{count}", String(unreadCount)) : t("notificationCenter.allRead")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => onMarkRead()}>{t("notificationCenter.markAllRead")}</button>
          </div>
          <div className="notification-center-actions">
            <label className="notification-browser-toggle">
              <span>{t("notificationCenter.browserToggle")}</span>
              <Switch checked={browserNotificationsEnabled} onCheckedChange={onBrowserNotificationsEnabledChange} />
            </label>
            {browserNotificationsEnabled && permission !== "granted" && <button className="ghost-button" type="button" onClick={onRequestBrowser}>{t("notificationCenter.enableBrowser")}</button>}
            <button className="ghost-button danger-button" type="button" disabled={!items.length} onClick={onClear}>{t("notificationCenter.clear")}</button>
          </div>
          <div className="notification-center-list">
            {items.map((item) => {
              const canOpenSession = item.sourceType === "session" && Boolean(item.sourceId);
              return (
                <button
                  className={`notification-center-item ${item.readAt ? "" : "unread"}`}
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onMarkRead([item.id]);
                    if (canOpenSession) onOpenSession(String(item.sourceId));
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                  <small>{item.eventType} · {item.severity} · {formatShortDate(item.createdAt)}</small>
                </button>
              );
            })}
            {!items.length && <div className="empty-state">{t("notificationCenter.empty")}</div>}
          </div>
        </section>
      )}
    </div>
  );
}

function App() {
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("codex-web-session") ?? "");
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());
  const t: TFunction = useCallback((key) => translate(locale, key), [locale]);
  const [page, setPage] = useState<Page>(sessionToken ? pageFromHash() : "auth");
  const [authChecked, setAuthChecked] = useState(false);
  const authRequestRef = useRef(0);
  const [auth, setAuth] = useState<AuthState>({
    authenticated: Boolean(sessionToken),
    setupRequired: !sessionToken,
    needsOtp: !sessionToken,
    user: sessionToken ? { id: "local-admin", email: "admin@local" } : null,
  });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionProjectFilter, setSessionProjectFilter] = useState("all");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("all");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const pendingApprovalIdsRef = useRef<Set<string>>(new Set());
  const [taskDetails, setTaskDetails] = useState<Record<string, CodexTaskDetail>>({});
  const [optimisticMessages, setOptimisticMessages] = useState<Record<string, SessionMessage[]>>({});
  const [messageQueues, setMessageQueues] = useState<Record<string, QueuedMessage[]>>({});
  const [activeSessionId, setActiveSessionId] = useState(() => sessionToken ? routeFromHash().sessionId : "");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [draftTaskProjectId, setDraftTaskProjectId] = useState<string | null>(null);
  const [sessionNavOpen, setSessionNavOpen] = useState(false);
  const [mainNavOpen, setMainNavOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [appNotifications, setAppNotifications] = useState<AppNotificationSummary[]>([]);
  const [appNotificationUnreadCount, setAppNotificationUnreadCount] = useState(0);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() => localStorage.getItem(browserNotificationsEnabledKey) !== "false");
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === "undefined" ? "denied" : Notification.permission);
  const appNotificationIdsRef = useRef<Set<string>>(new Set());
  const appNotificationsReadyRef = useRef(false);
  const suppressedAppNotificationIdsRef = useRef<Set<string>>(localStorageStringSet(suppressedAppNotificationsKey));
  const pageActiveRef = useRef(typeof document === "undefined" ? false : document.visibilityState === "visible");
  const toastTimerRef = useRef<number | null>(null);
  const dialog = useAppDialog();
  const activeSession = activeSessionId ? sessions.find((session) => session.id === activeSessionId) : undefined;
  const visibleSessions = sessions.filter((session) => session.conversationType !== "automation");
  const routeSessionPending = page === "sessions" && Boolean(activeSessionId) && !activeSession;

  function navigate(pageName: Page) {
    setSessionNavOpen(false);
    setMainNavOpen(false);
    if (pageName === "auth") {
      setPage("auth");
      return;
    }
    window.location.hash = pageName;
    setPage(pageName);
    if (pageName === "sessions") setActiveSessionId("");
  }

  function navigateSession(sessionId: string) {
    setSessionNavOpen(false);
    window.location.hash = `sessions/${encodeURIComponent(sessionId)}`;
    setPage("sessions");
    setActiveSessionId(sessionId);
  }

  function applyHashRoute() {
    const route = routeFromHash();
    setPage(route.page);
    setActiveSessionId(route.page === "sessions" ? route.sessionId : "");
  }

  function changeLocale(nextLocale: Locale) {
    localStorage.setItem("codex-web-locale", nextLocale);
    setLocale(nextLocale);
  }

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const rememberPendingApprovalId = useCallback((approvalId?: string | null) => {
    if (!approvalId) return;
    const known = pendingApprovalIdsRef.current;
    if (known.has(approvalId)) return;
    known.add(approvalId);
    setPendingApprovalsCount((count) => count + 1);
  }, []);

  const notificationMatchesCurrentSession = useCallback((item: AppNotificationSummary) => {
    const metadata = item.metadata ?? {};
    const metadataSessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : "";
    const metadataRoomId = typeof metadata.roomId === "string" ? metadata.roomId : "";
    return page === "sessions" && Boolean(activeSessionId) && (
      item.sourceId === activeSessionId ||
      metadataSessionId === activeSessionId ||
      (Boolean(activeSession?.roomId) && metadataRoomId === activeSession?.roomId)
    );
  }, [activeSession?.roomId, activeSessionId, page]);

  const shouldSuppressAppNotification = useCallback((item: AppNotificationSummary) => pageActiveRef.current && notificationMatchesCurrentSession(item), [notificationMatchesCurrentSession]);

  function rememberSuppressedAppNotifications(ids: string[]) {
    if (!ids.length) return;
    const suppressed = suppressedAppNotificationIdsRef.current;
    ids.forEach((id) => suppressed.add(id));
    const trimmed = Array.from(suppressed).slice(-300);
    suppressedAppNotificationIdsRef.current = new Set(trimmed);
    localStorage.setItem(suppressedAppNotificationsKey, JSON.stringify(trimmed));
  }

  function markSuppressedAppNotificationsRead(ids: string[]) {
    if (!ids.length || !sessionToken) return;
    void fetch("/api/app-notifications/read", {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
  }

  const pushBrowserNotification = useCallback((item: AppNotificationSummary) => {
    if (!browserNotificationsEnabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (pageActiveRef.current) return;
    if (notificationMatchesCurrentSession(item) && document.visibilityState === "visible") return;
    try {
      new Notification(item.title, {
        body: item.message,
        tag: item.id,
      });
    } catch {
      // Browser notification support can be blocked by runtime policy.
    }
  }, [browserNotificationsEnabled, notificationMatchesCurrentSession]);

  const applyAppNotifications = useCallback((result: AppNotificationsResponse, options: { desktop?: boolean } = {}) => {
    const knownIds = appNotificationIdsRef.current;
    const suppressedNow = result.items.filter((item) => !suppressedAppNotificationIdsRef.current.has(item.id) && shouldSuppressAppNotification(item));
    if (suppressedNow.length) {
      rememberSuppressedAppNotifications(suppressedNow.map((item) => item.id));
      markSuppressedAppNotificationsRead(suppressedNow.filter((item) => !item.readAt).map((item) => item.id));
    }
    const suppressedIds = suppressedAppNotificationIdsRef.current;
    const visibleItems = result.items.filter((item) => !suppressedIds.has(item.id));
    const suppressedUnreadCount = result.items.filter((item) => suppressedIds.has(item.id) && !item.readAt).length;
    const newUnread = visibleItems
      .filter((item) => !knownIds.has(item.id) && !item.readAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setAppNotifications(visibleItems);
    setAppNotificationUnreadCount(Math.max(0, result.unreadCount - suppressedUnreadCount));
    result.items.forEach((item) => knownIds.add(item.id));
    if (options.desktop && appNotificationsReadyRef.current) newUnread.forEach(pushBrowserNotification);
    appNotificationsReadyRef.current = true;
  }, [pushBrowserNotification, sessionToken, shouldSuppressAppNotification]);

  const loadAppNotifications = useCallback(async (options: { desktop?: boolean } = {}) => {
    if (!sessionToken) return;
    const response = await fetch("/api/app-notifications?limit=30", {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = await response.json() as AppNotificationsResponse;
    applyAppNotifications(result, options);
  }, [applyAppNotifications, sessionToken]);

  async function markAppNotificationsRead(ids?: string[]) {
    const response = await fetch("/api/app-notifications/read", {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(ids ? { ids } : { all: true }),
    });
    if (!response.ok) return;
    const result = await response.json() as AppNotificationsResponse;
    setAppNotifications(result.items);
    setAppNotificationUnreadCount(result.unreadCount);
  }

  async function clearAppNotifications() {
    const confirmed = await dialog.confirm({
      title: t("notificationCenter.clearConfirm"),
      message: t("notificationCenter.clearMessage"),
      confirmLabel: t("notificationCenter.clear"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch("/api/app-notifications", {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setAppNotifications([]);
    setAppNotificationUnreadCount(0);
  }

  async function requestBrowserNotifications() {
    if (typeof Notification === "undefined") {
      notify(t("notificationCenter.browserUnsupported"), "error");
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    notify(permission === "granted" ? t("notificationCenter.browserGranted") : t("notificationCenter.browserDenied"), permission === "granted" ? "success" : "error");
  }

  function changeBrowserNotificationsEnabled(enabled: boolean) {
    localStorage.setItem(browserNotificationsEnabledKey, enabled ? "true" : "false");
    setBrowserNotificationsEnabled(enabled);
    if (enabled && browserNotificationPermission !== "granted") void requestBrowserNotifications();
  }

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    function syncPageActive() {
      if (document.visibilityState !== "visible") {
        pageActiveRef.current = false;
        return;
      }
      pageActiveRef.current = typeof document.hasFocus === "function" ? document.hasFocus() : true;
    }
    function handleFocus() {
      pageActiveRef.current = document.visibilityState === "visible";
    }
    function handleBlur() {
      pageActiveRef.current = false;
    }
    syncPageActive();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", syncPageActive);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", syncPageActive);
    };
  }, []);

  useEffect(() => {
    appNotificationsReadyRef.current = false;
    appNotificationIdsRef.current = new Set();
    if (!sessionToken) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 2500;
    let closed = false;
    const eventUrl = `/api/app-notifications/events?${new URLSearchParams({ token: sessionToken })}`;
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(eventUrl);
      source.addEventListener("snapshot", (event) => {
        reconnectDelay = 2500;
        const result = JSON.parse((event as MessageEvent).data) as AppNotificationStreamEvent;
        if (result.type === "snapshot") applyAppNotifications(result, { desktop: true });
      });
      source.addEventListener("notification", (event) => {
        reconnectDelay = 2500;
        const result = JSON.parse((event as MessageEvent).data) as AppNotificationStreamEvent;
        if (result.type !== "notification") return;
        const knownIds = appNotificationIdsRef.current;
        if (
          result.notification.eventType === "needs_approval"
          && result.notification.sourceType === "approval"
          && !knownIds.has(result.notification.id)
        ) {
          rememberPendingApprovalId(result.notification.sourceId);
        }
        if (shouldSuppressAppNotification(result.notification)) {
          rememberSuppressedAppNotifications([result.notification.id]);
          if (!result.notification.readAt) markSuppressedAppNotificationsRead([result.notification.id]);
          knownIds.add(result.notification.id);
          appNotificationsReadyRef.current = true;
          return;
        }
        if (suppressedAppNotificationIdsRef.current.has(result.notification.id)) return;
        const isNewUnread = !knownIds.has(result.notification.id) && !result.notification.readAt;
        setAppNotifications((items) => [result.notification, ...items.filter((item) => item.id !== result.notification.id)].slice(0, 30));
        setAppNotificationUnreadCount(result.unreadCount);
        knownIds.add(result.notification.id);
        if (isNewUnread && appNotificationsReadyRef.current) pushBrowserNotification(result.notification);
        appNotificationsReadyRef.current = true;
      });
      source.addEventListener("ping", () => {
        reconnectDelay = 2500;
      });
      source.onerror = () => {
        source?.close();
        if (closed) return;
        const delay = reconnectDelay;
        reconnectDelay = Math.min(Math.round(reconnectDelay * 1.6), 15_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [applyAppNotifications, pushBrowserNotification, rememberPendingApprovalId, sessionToken, shouldSuppressAppNotification]);

  const resetToLogin = useCallback((nextAuth?: AuthState) => {
    localStorage.removeItem("codex-web-session");
    setSessionToken("");
    setAuth(nextAuth ?? {
      authenticated: false,
      setupRequired: false,
      needsOtp: true,
      user: null,
    });
    navigate("auth");
  }, []);

  useEffect(() => {
    function handleHashChange() {
      if (auth.authenticated) applyHashRoute();
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [auth.authenticated]);

  const loadAppData = useCallback(async (token = sessionToken) => {
    if (!token) return;
    const headers = { authorization: `Bearer ${token}` };
    async function getJson<T>(url: string) {
      const response = await fetch(url, { headers });
      if (response.status === 401) {
        resetToLogin();
        throw new Error("unauthorized");
      }
      if (!response.ok) throw new Error(`request_failed:${url}`);
      return response.json() as Promise<T>;
    }
    const [nextSessions, nextProjects, nextProviders, nextAutomations, nextApprovals] = await Promise.all([
      getJson<PageResponse<SessionSummary>>("/api/sessions?limit=30"),
      getJson<ProjectSummary[]>("/api/projects"),
      getJson<ProviderSummary[]>("/api/providers"),
      getJson<AutomationSummary[]>("/api/automations"),
      getJson<PageResponse<ApprovalSummary>>("/api/approvals?status=pending&limit=1"),
    ]);
    if (!Array.isArray(nextSessions.items) || !Array.isArray(nextProjects) || !Array.isArray(nextProviders) || !Array.isArray(nextAutomations)) {
      throw new Error("invalid_app_data");
    }
    setSessions(nextSessions.items);
    setSessionCursor(nextSessions.nextCursor);
    setSessionHasMore(nextSessions.hasMore);
    setProjects(nextProjects);
    setProviders(nextProviders);
    setAutomations(nextAutomations);
    pendingApprovalIdsRef.current = new Set(nextApprovals.items.map((item) => item.id));
    setPendingApprovalsCount(nextApprovals.items.length + (nextApprovals.hasMore ? 1 : 0));
    if (activeSessionId && !nextSessions.items.some((session) => session.id === activeSessionId)) void ensureSessionLoaded(activeSessionId, token);
    if (!selectedProviderId && nextProviders[0]) setSelectedProviderId(nextProviders[0].id);
  }, [activeSessionId, resetToLogin, selectedProviderId, sessionToken]);

  async function ensureSessionLoaded(sessionId: string, token = sessionToken) {
    if (!sessionId || sessions.some((session) => session.id === sessionId) || !token) return;
    const response = await fetch(`/api/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setActiveSessionId("");
      if (routeFromHash().page === "sessions") window.location.hash = "sessions";
      return;
    }
    const session = (await response.json()) as SessionSummary;
    setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
  }

  async function loadSessionPage(options: { reset?: boolean; search?: string; projectId?: string; status?: string } = {}) {
    if (!sessionToken) return;
    const reset = options.reset ?? false;
    const search = options.search ?? sessionSearch;
    const projectId = options.projectId ?? sessionProjectFilter;
    const status = options.status ?? sessionStatusFilter;
    const params = new URLSearchParams({ limit: "30" });
    if (!reset && sessionCursor) params.set("cursor", sessionCursor);
    if (search.trim()) params.set("q", search.trim());
    if (projectId !== "all") params.set("projectId", projectId);
    if (status !== "all") params.set("status", status);
    const response = await fetch(`/api/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<SessionSummary>;
    setSessions((items) => reset ? page.items : [...items, ...page.items.filter((session) => !items.some((item) => item.id === session.id))]);
    setSessionCursor(page.nextCursor);
    setSessionHasMore(page.hasMore);
  }

  const handleTaskDetail = useCallback((detail: CodexTaskDetail) => {
    setTaskDetails((items) => ({ ...items, [detail.session.id]: detail }));
    setOptimisticMessages((items) => {
      const serverMessages = new Set(detail.messages.map((message) => `${message.role}:${message.content}`));
      const pending = (items[detail.session.id] ?? []).filter((message) => !serverMessages.has(`${message.role}:${message.content}`));
      return { ...items, [detail.session.id]: pending };
    });
    setSessions((items) => {
      const current = items.find((item) => item.id === detail.session.id);
      if (
        current &&
        current.status === detail.session.status &&
        current.updatedAt === detail.session.updatedAt &&
        current.codexSessionId === detail.session.codexSessionId
      ) {
        return items;
      }
      return items.map((item) => item.id === detail.session.id ? detail.session : item);
    });
  }, []);

  async function createCodexTask(prompt: string, projectId: string | null, providerId: string | null, model: string | null, ephemeralNotifications?: CreateCodexTaskRequest["ephemeralNotifications"], attachments?: UploadAttachmentInput[], displayPrompt = prompt) {
    const body: CreateCodexTaskRequest = {
      prompt,
      projectId,
      providerId,
      model,
      ephemeralNotifications,
      attachments,
    };
    const response = await fetch("/api/codex/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const session = (await response.json()) as SessionSummary;
    setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
    setTaskDetails((items) => ({
      ...items,
      [session.id]: {
        session,
        messages: [localUserMessage(displayPrompt)],
        output: "",
        exitCode: null,
      },
    }));
    navigateSession(session.id);
  }

  function newTask() {
    setDraftTaskProjectId(null);
    setSessionNavOpen(false);
    navigate("sessions");
  }

  async function stopCodexTask(sessionId: string) {
    const response = await fetch(`/api/codex/tasks/${sessionId}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextSession = (await response.json()) as SessionSummary;
    setSessions((items) => items.map((item) => item.id === nextSession.id ? nextSession : item));
  }

  async function continueCodexTask(sessionId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null, attachments?: UploadAttachmentInput[], displayPrompt = prompt) {
    const body: ContinueCodexTaskRequest = { prompt, providerId, model, replyToMessageId, attachments };
    const response = await fetch(`/api/codex/tasks/${sessionId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    if (response.status === 202) {
      const queued = (await response.json()) as QueuedMessage;
      setMessageQueues((items) => ({
        ...items,
        [sessionId]: [...(items[sessionId] ?? []).filter((item) => item.id !== queued.id), queued],
      }));
      navigateSession(sessionId);
      return;
    }
    setOptimisticMessages((items) => ({
      ...items,
      [sessionId]: [...(items[sessionId] ?? []), localUserMessage(displayPrompt)],
    }));
    const nextSession = (await response.json()) as SessionSummary;
    setSessions((items) => items.map((item) => item.id === nextSession.id ? nextSession : item));
    navigateSession(nextSession.id);
  }

  async function recoverCodexTask(sessionId: string, prompt: string, providerId: string | null, model: string | null) {
    const body: RecoverCodexTaskRequest = { prompt, providerId, model };
    const response = await fetch(`/api/codex/tasks/${sessionId}/recover`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const detail = (await response.json()) as CodexTaskDetail;
    handleTaskDetail(detail);
    setSessions((items) => items.map((item) => item.id === detail.session.id ? detail.session : item));
    navigateSession(detail.session.id);
  }

  async function updateQueuedMessage(sessionId: string, queueId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null) {
    const body: UpdateQueuedMessageRequest = { prompt, providerId, model, replyToMessageId };
    const response = await fetch(`/api/codex/tasks/${sessionId}/queue/${queueId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const updated = (await response.json()) as QueuedMessage;
    setMessageQueues((items) => ({
      ...items,
      [sessionId]: (items[sessionId] ?? []).map((item) => item.id === updated.id ? updated : item),
    }));
  }

  async function reorderQueuedMessages(sessionId: string, orderedIds: string[]) {
    const body: ReorderQueuedMessagesRequest = { orderedIds };
    const previousQueue = messageQueues[sessionId] ?? [];
    const optimisticQueue = orderedIds
      .map((id) => previousQueue.find((item) => item.id === id))
      .filter((item): item is QueuedMessage => Boolean(item));
    if (optimisticQueue.length === previousQueue.length) {
      setMessageQueues((items) => ({ ...items, [sessionId]: optimisticQueue }));
    }
    const response = await fetch(`/api/codex/tasks/${sessionId}/queue`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessageQueues((items) => ({ ...items, [sessionId]: previousQueue }));
      return;
    }
    const queue = (await response.json()) as QueuedMessage[];
    setMessageQueues((items) => ({ ...items, [sessionId]: queue }));
  }

  async function deleteQueuedMessage(sessionId: string, queueId: string) {
    const response = await fetch(`/api/codex/tasks/${sessionId}/queue/${queueId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setMessageQueues((items) => ({
      ...items,
      [sessionId]: (items[sessionId] ?? []).filter((item) => item.id !== queueId),
    }));
  }

  async function deleteSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const canDeleteWorkspace = !session.projectId;
    const decision = await dialog.confirmWithCheckbox({
      title: t("session.deleteSession"),
      message: t("session.deleteMessage").replace("{title}", session.title).replace("{note}", canDeleteWorkspace ? t("session.deleteDataHint") : t("session.deleteLogsHint")),
      confirmLabel: t("session.deleteSession"),
      checkboxLabel: t("session.deleteData"),
      checkboxDefaultChecked: true,
      danger: true,
    });
    if (!decision.confirmed) return;
    const deleteWorkspace = canDeleteWorkspace && decision.checked;
    const deleteLogs = decision.checked;
    const response = await fetch(`/api/sessions/${sessionId}?${new URLSearchParams({ deleteLogs: String(deleteLogs), deleteWorkspace: String(deleteWorkspace) })}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setTaskDetails((items) => {
      const next = { ...items };
      delete next[sessionId];
      return next;
    });
    setSessions((items) => items.filter((item) => item.id !== sessionId));
    navigate("sessions");
  }

  useEffect(() => {
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    setAuthChecked(false);
    fetch("/api/auth/state", {
      headers: sessionToken ? { authorization: `Bearer ${sessionToken}` } : {},
    })
      .then((response) => response.json())
      .then((nextAuth: AuthState) => {
        if (authRequestRef.current !== requestId) return;
        setAuth(nextAuth);
        if (!nextAuth.authenticated) {
          resetToLogin(nextAuth);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (authRequestRef.current === requestId) setAuthChecked(true);
    });
  }, [resetToLogin, sessionToken]);

  useEffect(() => {
    if (!auth.authenticated || !sessionToken) return;
    loadAppData().catch(() => undefined);
  }, [auth.authenticated, loadAppData, sessionToken]);

  useEffect(() => {
    if (!auth.authenticated || !sessionToken || !activeSessionId || activeSession) return;
    void ensureSessionLoaded(activeSessionId);
  }, [activeSession, activeSessionId, auth.authenticated, sessionToken]);

  if (!authChecked) {
    return <div className="auth-shell"><div className="auth-panel"><strong>{t("auth.checking")}</strong></div></div>;
  }

  if (!auth.authenticated) {
    return (
      <AuthPage
        t={t}
        locale={locale}
        onLocaleChange={changeLocale}
        auth={auth}
        notify={notify}
        onLogin={async (token, nextAuth) => {
          authRequestRef.current += 1;
          localStorage.setItem("codex-web-session", token);
          setSessionToken(token);
          setAuth(nextAuth);
          setAuthChecked(true);
          applyHashRoute();
          await loadAppData(token).catch(() => undefined);
        }}
      />
    );
  }

  const notificationCenterNode = (
    <NotificationCenter
      items={appNotifications}
      unreadCount={appNotificationUnreadCount}
      open={notificationCenterOpen}
      permission={browserNotificationPermission}
      browserNotificationsEnabled={browserNotificationsEnabled}
      t={t}
      onToggle={() => {
        setNotificationCenterOpen((value) => !value);
        void loadAppNotifications();
      }}
      onClose={() => setNotificationCenterOpen(false)}
      onMarkRead={(ids) => void markAppNotificationsRead(ids)}
      onClear={() => void clearAppNotifications()}
      onRequestBrowser={() => void requestBrowserNotifications()}
      onBrowserNotificationsEnabledChange={changeBrowserNotificationsEnabled}
      onOpenSession={navigateSession}
    />
  );

  return (
    <NotificationCenterContext.Provider value={notificationCenterNode}>
    <div className={`app ${page === "sessions" ? "task-layout" : "wide-layout"}`}>
      {dialog.node}
      <ToastViewport toast={toast} onClose={() => setToast(null)} t={t} />
      <div className={`main-nav-drawer ${mainNavOpen ? "open" : ""}`}>
        <button className="drawer-backdrop" type="button" aria-label={t("session.closeMainNav")} onClick={() => setMainNavOpen(false)} />
      </div>
      <aside className={`rail ${mainNavOpen ? "open" : ""}`}>
        <div className="logo">C</div>
        <div className="mobile-nav-head">
          <strong>Codex Web</strong>
          <button className="drawer-close" type="button" onClick={() => setMainNavOpen(false)} title={t("action.close")}>
            <X size={16} />
          </button>
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <button
              className={`rail-button ${page === item.page ? "active" : ""} ${item.page === "auth" ? "auth-button" : ""}`}
              key={item.page}
              onClick={() => navigate(item.page)}
              title={label}
            >
              <Icon size={16} />
              <em>{label}</em>
              {item.page === "approvals" && pendingApprovalsCount > 0 && <span className="nav-badge">{pendingApprovalsCount}</span>}
            </button>
          );
        })}
        <LanguageSelect locale={locale} onChange={changeLocale} compact />
      </aside>

      {page === "sessions" && (
        <div className={`sessions-drawer ${sessionNavOpen ? "open" : ""}`}>
          <button className="drawer-backdrop" type="button" aria-label={t("session.closeSessionList")} onClick={() => setSessionNavOpen(false)} />
          <Threads
            sessions={visibleSessions}
            projects={projects}
            providers={providers}
            selectedProviderId={selectedProviderId}
            onSelectProvider={setSelectedProviderId}
            activeSessionId={activeSessionId}
            onSelectSession={navigateSession}
            onNewTask={newTask}
            search={sessionSearch}
            onSearch={(value) => {
              setSessionSearch(value);
              void loadSessionPage({ reset: true, search: value });
            }}
            projectFilter={sessionProjectFilter}
            onProjectFilter={(value) => {
              setSessionProjectFilter(value);
              void loadSessionPage({ reset: true, projectId: value });
            }}
            statusFilter={sessionStatusFilter}
            onStatusFilter={(value) => {
              setSessionStatusFilter(value);
              void loadSessionPage({ reset: true, status: value });
            }}
            hasMore={sessionHasMore}
            onLoadMore={() => void loadSessionPage()}
            onClose={() => setSessionNavOpen(false)}
            t={t}
          />
        </div>
      )}
      {page === "sessions" && (routeSessionPending ? <SessionLoadingPage t={t} onOpenMainNav={() => setMainNavOpen(true)} onOpenSessionNav={() => setSessionNavOpen(true)} /> : <SessionPage sessionToken={sessionToken} t={t} notify={notify} session={activeSession} project={activeSession ? projects.find((project) => project.id === activeSession.projectId) : projects.find((project) => project.id === draftTaskProjectId)} projects={projects} draftProjectId={draftTaskProjectId} onDraftProjectId={setDraftTaskProjectId} providers={providers} selectedProviderId={selectedProviderId} onSelectProvider={setSelectedProviderId} taskDetail={activeSession ? taskDetails[activeSession.id] : undefined} optimisticMessages={activeSession ? optimisticMessages[activeSession.id] ?? [] : []} queuedMessages={activeSession ? messageQueues[activeSession.id] ?? [] : []} onQueueChange={(sessionId, queue) => setMessageQueues((items) => ({ ...items, [sessionId]: queue }))} onTaskDetail={handleTaskDetail} onSubmitTask={createCodexTask} onContinueTask={continueCodexTask} onRecoverTask={recoverCodexTask} onUpdateQueuedMessage={updateQueuedMessage} onReorderQueuedMessages={reorderQueuedMessages} onDeleteQueuedMessage={deleteQueuedMessage} onStopTask={stopCodexTask} onDeleteSession={deleteSession} onSessionUpdated={(nextSession) => setSessions((items) => items.map((item) => item.id === nextSession.id ? nextSession : item))} onOpenSession={navigateSession} onOpenMainNav={() => setMainNavOpen(true)} onOpenSessionNav={() => setSessionNavOpen(true)} />)}
      {page === "sessions" && <ContextPanel sessionToken={sessionToken} session={activeSession} taskDetail={activeSession ? taskDetails[activeSession.id] : undefined} queuedMessages={activeSession ? messageQueues[activeSession.id] ?? [] : []} onUpdateQueuedMessage={updateQueuedMessage} onReorderQueuedMessages={reorderQueuedMessages} onDeleteQueuedMessage={deleteQueuedMessage} t={t} onOpenFile={(path) => {
        const params = new URLSearchParams({ path });
        if (activeSession?.workspacePath) {
          params.set("rootPath", activeSession.workspacePath);
          params.set("mountName", activeSession.title || "Session Workspace");
        }
        window.location.hash = `files?${params}`;
        setPage("files");
      }} />}
      {page === "files" && <FilesPage sessionToken={sessionToken} t={t} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "terminal" && <TerminalPage sessionToken={sessionToken} t={t} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "previews" && <PreviewsPage sessionToken={sessionToken} projects={projects} sessions={visibleSessions} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "projects" && <ProjectsPage sessionToken={sessionToken} projects={projects} sessions={visibleSessions} notify={notify} onOpenSession={navigateSession} onNewProjectSession={(projectId) => {
        setDraftTaskProjectId(projectId);
        setActiveSessionId("");
        navigate("sessions");
      }} onAnalyzeProjectCheck={async (project, result) => {
        const prompt = [
          t("project.analyzePromptIntro").replace("{name}", project.name),
          t("project.analyzePromptCommand").replace("{command}", result.command),
          t("project.analyzePromptExitCode").replace("{exitCode}", String(result.exitCode ?? "null")),
          "stdout:",
          result.stdout || "(empty)",
          "stderr:",
          result.stderr || "(empty)",
        ].join("\n");
        await createCodexTask(prompt, project.id, selectedProviderId || null, null);
        navigate("sessions");
      }} onChange={loadAppData} t={t} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "contacts" && <ContactsPage sessionToken={sessionToken} t={t} locale={locale} notify={notify} providers={providers} projects={projects} onOpenSession={navigateSession} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "extensions" && <ExtensionsPage sessionToken={sessionToken} title={t("nav.extensions")} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "automations" && <AutomationsPage sessionToken={sessionToken} automations={automations} projects={projects} providers={providers} onChange={loadAppData} onOpenSession={navigateSession} title={t("nav.automations")} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "providers" && <ProvidersPage sessionToken={sessionToken} providers={providers} onChange={loadAppData} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "approvals" && <ApprovalsPage sessionToken={sessionToken} t={t} notify={notify} onPendingChange={setPendingApprovalsCount} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "settings" && <SettingsPage sessionToken={sessionToken} t={t} onOpenSession={navigateSession} onOpenMainNav={() => setMainNavOpen(true)} onSessionRefresh={(token, nextAuth) => {
        localStorage.setItem("codex-web-session", token);
        setSessionToken(token);
        setAuth(nextAuth);
      }} onLogout={() => resetToLogin()} notify={notify} onApprovalRequired={(approval) => rememberPendingApprovalId(approval.id)} />}
    </div>
    </NotificationCenterContext.Provider>
  );
}

function Threads({
  sessions,
  projects,
  providers,
  selectedProviderId,
  onSelectProvider,
  activeSessionId,
  onSelectSession,
  onNewTask,
  search,
  onSearch,
  projectFilter,
  onProjectFilter,
  statusFilter,
  onStatusFilter,
  hasMore,
  onLoadMore,
  onClose,
  t,
}: {
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  providers: ProviderSummary[];
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewTask: () => void;
  search: string;
  onSearch: (value: string) => void;
  projectFilter: string;
  onProjectFilter: (value: string) => void;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  onClose?: () => void;
  t: TFunction;
}) {
  const visibleSessions = sessions.filter((session) => !(session.conversationType === "agent" && session.roomId));
  const projectSession = sessions.find((session) => session.id === activeSessionId && session.projectId);
  const currentProject = projects.find((project) => project.id === projectSession?.projectId);
  const runningSessions = visibleSessions.filter((session) => session.status === "running");
  return (
    <aside className="threads">
      <header className="threads-header">
        <div>
          <div className="product">Codex Web</div>
        </div>
        <div className="threads-header-actions">
          <button className="new-task" onClick={onNewTask} title={t("session.newSession")}>+</button>
          {onClose && (
            <button className="drawer-close" type="button" onClick={onClose} title={t("action.close")}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>
      {currentProject && (
        <section className="project-card">
          <div className="project-row">
            <span className="live-dot" />
            <strong>{projectDisplayName(currentProject, projects)}</strong>
          </div>
          <div className="subtle">{currentProject.workspacePath} · {readableGitStatus(currentProject.gitStatus, currentProject.changedFiles, t)}</div>
        </section>
      )}
      {runningSessions.length > 0 && (
        <>
          <div className="thread-group-title">{t("session.runningTasks")}</div>
          {runningSessions.map((session) => (
            <button className={`thread running ${session.id === activeSessionId ? "active" : ""}`} key={`running-${session.id}`} onClick={() => onSelectSession(session.id)}>
              <span className="thread-title-row">
                <span className={`session-type-badge ${session.conversationType ?? "codex"}`}>{readableSessionType(session, t)}</span>
                <span className="thread-title">{session.title}</span>
              </span>
              <span className="thread-meta">{projectDisplayName(projects.find((project) => project.id === session.projectId), projects) || t("session.noProject")} · {formatShortDate(session.updatedAt)}</span>
            </button>
          ))}
        </>
      )}
      <div className="thread-filters">
        <input name="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t("session.searchSessions")} />
        <div className="thread-filter-row">
          <select name="projectfilter" value={projectFilter} onChange={(event) => onProjectFilter(event.target.value)}>
            <option value="all">{t("session.allProjects")}</option>
            <option value="scratch">{t("session.noProject")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
          </select>
          <select name="statusfilter" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
            <option value="all">{t("session.allStatuses")}</option>
            <option value="running">{t("session.statusRunning")}</option>
            <option value="done">{t("session.statusDone")}</option>
            <option value="paused">{t("session.statusPaused")}</option>
            <option value="interrupted">{t("session.statusInterrupted")}</option>
          </select>
        </div>
      </div>
      <div className="thread-group-title">{t("session.recentSessions")}</div>
      {visibleSessions.map((session) => (
        <button className={`thread ${session.id === activeSessionId ? "active" : ""}`} key={session.id} onClick={() => onSelectSession(session.id)}>
          <span className="thread-title-row">
            <span className={`session-type-badge ${session.conversationType ?? "codex"}`}>{readableSessionType(session, t)}</span>
            <span className="thread-title">{session.title}</span>
          </span>
          <span className="thread-meta">
            {readableStatus(session.status, t)} · {projectDisplayName(projects.find((project) => project.id === session.projectId), projects) || t("session.noProject")} · {providers.find((provider) => provider.id === session.providerId)?.name ?? t("session.noProvider")} / {session.model ?? t("session.noModel")} · {formatShortDate(session.updatedAt)}
          </span>
        </button>
      ))}
      {hasMore && <button className="ghost-button load-more" type="button" onClick={onLoadMore}>{t("session.loadMore")}</button>}
      <div className="thread-group-title">{t("session.providers")}</div>
      <select name="selectedproviderid" className="provider-select" value={selectedProviderId} onChange={(event) => onSelectProvider(event.target.value)}>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.name}</option>
        ))}
      </select>
      <div className="provider-hint">{providers.find((provider) => provider.id === selectedProviderId)?.kind ?? t("session.providerNotConfigured")}</div>
    </aside>
  );
}

function MobileMainToggle({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button className="mobile-main-toggle" type="button" onClick={onClick} aria-label={label} title={label}>
      <PanelLeftOpen size={17} />
    </button>
  );
}

function MobileSessionToggle({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button className="mobile-session-toggle" type="button" onClick={onClick}>
      <Menu size={16} />
      <span>{label}</span>
    </button>
  );
}

function SessionLoadingPage({ t, onOpenMainNav, onOpenSessionNav }: { t: TFunction; onOpenMainNav?: () => void; onOpenSessionNav?: () => void }) {
  const notificationCenter = React.useContext(NotificationCenterContext);
  return (
    <main className="conversation">
      <header className="task-header page-header">
        <div className="header-title-row">
          <MobileMainToggle label={t("nav.sessions")} onClick={onOpenMainNav} />
          <div>
            <div className="crumb">{t("page.sessionLoadingCrumb")}</div>
            <h1>{t("session.loadingTitle")}</h1>
            <div className="task-path">{t("session.loadingHint")}</div>
          </div>
        </div>
        {notificationCenter && <div className="header-actions session-actions">{notificationCenter}</div>}
      </header>
      <div className="mobile-session-bar">
        <MobileSessionToggle label={t("session.sessionList")} onClick={onOpenSessionNav} />
      </div>
      <section className="timeline">
        <Bubble who="C" text={t("session.loadingBubble")} t={t} />
      </section>
    </main>
  );
}

function GoalPanel({
  sessionToken,
  goal,
  ownerType,
  ownerId,
  t,
  notify,
  onGoalChange,
  agents = [],
  compact = false,
  expandSignal = 0,
}: {
  sessionToken: string;
  goal?: GoalSummary | null;
  ownerType: "session" | "agent_session" | "room";
  ownerId: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onGoalChange: (goal: GoalSummary | null) => void;
  agents?: Array<{ id: string; name: string }>;
  compact?: boolean;
  expandSignal?: number;
}) {
  const [text, setText] = useState(goal?.text ?? "");
  const [mode, setMode] = useState<GoalMode>(goal?.mode ?? (ownerType === "room" ? "orchestrated" : "reference"));
  const [focusText, setFocusText] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemAgentId, setItemAgentId] = useState("");
  const [managerAgentId, setManagerAgentId] = useState(goal?.managerAgentId ?? "");
  const [coordinatorAgentId, setCoordinatorAgentId] = useState(goal?.coordinatorAgentId ?? "");
  const [detail, setDetail] = useState<GoalDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expandSignal > 0) setExpanded(true);
  }, [expandSignal]);
  useEffect(() => {
    setText(goal?.text ?? "");
    setMode(goal?.mode ?? (ownerType === "room" ? "orchestrated" : "reference"));
    setManagerAgentId(goal?.managerAgentId ?? "");
    setCoordinatorAgentId(goal?.coordinatorAgentId ?? "");
  }, [goal?.id, goal?.text, goal?.mode, goal?.managerAgentId, goal?.coordinatorAgentId, ownerType]);
  useEffect(() => {
    if (!goal?.id) {
      setDetail(null);
      return;
    }
    const goalId = goal.id;
    let cancelled = false;
    async function loadGoalDetail() {
      const response = await fetch(`/api/goals/${goalId}`, { headers: { authorization: `Bearer ${sessionToken}` } });
      if (!response.ok || cancelled) return;
      setDetail(await response.json() as GoalDetailResponse);
    }
    void loadGoalDetail();
    return () => {
      cancelled = true;
    };
  }, [goal?.id, sessionToken]);
  const items = detail?.items ?? [];
  const focuses = detail?.focuses ?? [];
  const events = detail?.events ?? [];
  const proposals = detail?.proposals ?? [];
  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  async function refreshGoal(goalId: string) {
    const response = await fetch(`/api/goals/${goalId}`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return;
    const next = await response.json() as GoalDetailResponse;
    setDetail(next);
    onGoalChange(next.goal);
  }
  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    const nextText = text.trim();
    if (!nextText) return;
    setBusy(true);
    try {
      const response = await fetch(goal ? `/api/goals/${goal.id}` : "/api/goals", {
        method: goal ? "PATCH" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(goal
          ? { text: nextText, mode, managerAgentId: managerAgentId || null, coordinatorAgentId: coordinatorAgentId || null }
          : { ownerType, ownerId, text: nextText, mode, managerAgentId: managerAgentId || null, coordinatorAgentId: coordinatorAgentId || null }),
      });
      if (!response.ok) throw new Error("goal_save_failed");
      const next = await response.json() as GoalSummary;
      onGoalChange(next);
      notify(t(goal ? "goal.updated" : "goal.created"), "success");
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function updateGoalStatus(status: GoalStatus) {
    if (!goal) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("goal_status_failed");
      onGoalChange(await response.json() as GoalSummary);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function createFocus(event: React.FormEvent) {
    event.preventDefault();
    if (!goal?.id || !focusText.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/focuses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ text: focusText.trim() }),
      });
      if (!response.ok) throw new Error("goal_focus_failed");
      setFocusText("");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function createItem(event: React.FormEvent) {
    event.preventDefault();
    if (!goal?.id || !itemTitle.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ title: itemTitle.trim(), assignedAgentId: itemAgentId || null, status: "planned" }),
      });
      if (!response.ok) throw new Error("goal_item_failed");
      setItemTitle("");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function updateFocusStatus(focusId: string, status: GoalFocusStatus) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/focuses/${focusId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("goal_focus_update_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function updateItemStatus(itemId: string, status: GoalItemStatus) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("goal_item_update_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function approveProposal(proposalId: string) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_proposal_approve_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function rejectProposal(proposalId: string) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/proposals/${proposalId}/reject`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_proposal_reject_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function planGoal() {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/plan`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_plan_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function orchestrateGoal() {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/orchestrate`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_orchestrate_failed");
      const result = await response.json() as { goal: GoalSummary; tasks: unknown[] };
      onGoalChange(result.goal);
      notify(t("goal.orchestrated").replace("{count}", String(result.tasks.length)), "success");
      await refreshGoal(result.goal.id);
    } catch {
      notify(t("goal.orchestrateFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`goal-panel ${compact ? "compact" : ""}`}>
      <div className="goal-panel-head">
        <div>
          <strong>{t("goal.title")}</strong>
          <span>{goal ? `${readableGoalMode(goal.mode, t)} · ${readableGoalStatus(goal.status, t)}` : t("goal.optional")}</span>
        </div>
        <button className={`ghost-button icon-only goal-toggle ${expanded ? "open" : ""}`} type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? t("action.collapse") : t("action.details")} aria-label={expanded ? t("action.collapse") : t("action.details")}>
          <ChevronDown size={16} />
        </button>
      </div>
      {expanded && <form className="goal-form" onSubmit={saveGoal}>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t("goal.placeholder")} rows={compact ? 2 : 3} />
        <div className="goal-form-row">
          <select value={mode} onChange={(event) => setMode(event.target.value as GoalMode)}>
            <option value="reference">{t("goal.modeReference")}</option>
            <option value="tracked">{t("goal.modeTracked")}</option>
            <option value="managed">{t("goal.modeManaged")}</option>
            <option value="orchestrated">{t("goal.modeOrchestrated")}</option>
          </select>
          <button className="ghost-button" type="submit" disabled={busy || !text.trim()}>{goal ? t("goal.update") : t("goal.create")}</button>
        </div>
        {agents.length > 0 && (
          <div className="goal-form-row">
            <select value={managerAgentId} onChange={(event) => setManagerAgentId(event.target.value)}>
              <option value="">{t("goal.noManager")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{t("goal.manager")}: {agent.name}</option>)}
            </select>
            <select value={coordinatorAgentId} onChange={(event) => setCoordinatorAgentId(event.target.value)}>
              <option value="">{t("goal.noCoordinator")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{t("goal.coordinator")}: {agent.name}</option>)}
            </select>
          </div>
        )}
      </form>}
      {expanded && goal && (
        <>
          <div className="goal-panel-actions">
            <button className="ghost-button" type="button" disabled={busy} onClick={() => void planGoal()}>{t("goal.plan")}</button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateGoalStatus("completed")}>{t("goal.complete")}</button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateGoalStatus("cancelled")}>{t("goal.cancel")}</button>
            {ownerType === "room" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void orchestrateGoal()}>{t("goal.orchestrate")}</button>}
          </div>
          <div className="goal-progress">
            <span>{t("goal.items")}: {goal.progress.totalItems}</span>
            <span>{t("goal.active")}: {goal.progress.activeItems}</span>
            <span>{t("goal.completed")}: {goal.progress.completedItems}</span>
            <span>{t("goal.blocked")}: {goal.progress.blockedItems}</span>
            <span>{t("goal.failed")}: {goal.progress.failedItems}</span>
          </div>
          {goal.currentFocus && (
            <div className="goal-current-focus">
              <div>
                <strong>{t("progress.currentFocus")}</strong>
                <span>{goal.currentFocus.text}</span>
              </div>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateFocusStatus(goal.currentFocus!.id, "completed")}>{t("goal.complete")}</button>
            </div>
          )}
          <form className="goal-form inline" onSubmit={createFocus}>
            <input value={focusText} onChange={(event) => setFocusText(event.target.value)} placeholder={goal.currentFocus?.text ?? t("goal.focusPlaceholder")} />
            <button className="ghost-button" type="submit" disabled={busy || !focusText.trim()}>{t("goal.setFocus")}</button>
          </form>
          {pendingProposals.length > 0 && (
            <div className="goal-proposal-list">
              <strong>{t("goal.proposals")}</strong>
              {pendingProposals.slice(0, 6).map((proposal) => (
                <div className="goal-proposal" key={proposal.id}>
                  <div>
                    <strong>{proposal.title}</strong>
                    <span>{proposal.kind} · {proposal.proposedByAgentId ?? "agent"} · {formatShortDate(proposal.createdAt)}</span>
                  </div>
                  <div className="goal-item-actions">
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void approveProposal(proposal.id)}>{t("goal.approveProposal")}</button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void rejectProposal(proposal.id)}>{t("goal.rejectProposal")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {focuses.length > 1 && (
            <details className="goal-history">
              <summary>{t("goal.focusHistory")} · {focuses.length}</summary>
              <div className="goal-item-list">
                {focuses.slice(0, 6).map((focus) => (
                  <div className="goal-item" key={focus.id}>
                    <strong>{focus.text}</strong>
                    <span>{readableGoalStatus(focus.status, t)} · {formatShortDate(focus.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <form className="goal-form inline" onSubmit={createItem}>
            <input value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} placeholder={t("goal.itemPlaceholder")} />
            {agents.length > 0 && (
              <select value={itemAgentId} onChange={(event) => setItemAgentId(event.target.value)}>
                <option value="">{t("room.unassigned")}</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            )}
            <button className="ghost-button" type="submit" disabled={busy || !itemTitle.trim()}>{t("goal.addItem")}</button>
          </form>
          {items.length > 0 && (
            <div className="goal-item-list">
              {items.slice(0, compact ? 4 : 8).map((item) => (
                <div className="goal-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.status}{item.assignedAgentId ? ` · ${agents.find((agent) => agent.id === item.assignedAgentId)?.name ?? item.assignedAgentId}` : ""}{item.roomTaskId ? ` · ${item.roomTaskId}` : ""}</span>
                  <div className="goal-item-actions">
                    {item.status !== "completed" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateItemStatus(item.id, "completed")}>{t("goal.complete")}</button>}
                    {item.status !== "blocked" && item.status !== "completed" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateItemStatus(item.id, "blocked")}>{t("goal.blocked")}</button>}
                    {item.status === "blocked" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateItemStatus(item.id, "active")}>{t("goal.active")}</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {events.length > 0 && (
            <details className="goal-history">
              <summary>{t("goal.events")} · {events.length}</summary>
              <div className="goal-event-list">
                {events.slice(0, 8).map((event) => (
                  <div className="goal-event" key={event.id}>
                    <strong>{event.type}</strong>
                    <span>{event.actorType ?? "system"} · {formatShortDate(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function SessionPage({
  sessionToken,
  t,
  notify,
  session,
  project,
  projects,
  draftProjectId,
  onDraftProjectId,
  providers,
  selectedProviderId,
  onSelectProvider,
  taskDetail,
  optimisticMessages,
  queuedMessages,
  onQueueChange,
  onTaskDetail,
  onSubmitTask,
  onContinueTask,
  onRecoverTask,
  onUpdateQueuedMessage,
  onReorderQueuedMessages,
  onDeleteQueuedMessage,
  onStopTask,
  onDeleteSession,
  onSessionUpdated,
  onOpenSession,
  onOpenMainNav,
  onOpenSessionNav,
}: {
  sessionToken: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  session?: SessionSummary;
  project?: ProjectSummary;
  projects: ProjectSummary[];
  draftProjectId: string | null;
  onDraftProjectId: (projectId: string | null) => void;
  providers: ProviderSummary[];
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
  taskDetail?: CodexTaskDetail;
  optimisticMessages: SessionMessage[];
  queuedMessages: QueuedMessage[];
  onQueueChange: (sessionId: string, queue: QueuedMessage[]) => void;
  onTaskDetail: (detail: CodexTaskDetail) => void;
  onSubmitTask: (prompt: string, projectId: string | null, providerId: string | null, model: string | null, ephemeralNotifications?: CreateCodexTaskRequest["ephemeralNotifications"], attachments?: UploadAttachmentInput[], displayPrompt?: string) => Promise<void>;
  onContinueTask: (sessionId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null, attachments?: UploadAttachmentInput[], displayPrompt?: string) => Promise<void>;
  onRecoverTask: (sessionId: string, prompt: string, providerId: string | null, model: string | null) => Promise<void>;
  onUpdateQueuedMessage: (sessionId: string, queueId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null) => Promise<void>;
  onReorderQueuedMessages: (sessionId: string, orderedIds: string[]) => Promise<void>;
  onDeleteQueuedMessage: (sessionId: string, queueId: string) => Promise<void>;
  onStopTask: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onSessionUpdated: (session: SessionSummary) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenMainNav?: () => void;
  onOpenSessionNav?: () => void;
}) {
  const dialog = useAppDialog(t);
  const [prompt, setPrompt] = useState("");
  const [draftModel, setDraftModel] = useState(providers[0]?.defaultModel ?? "");
  const [draftModels, setDraftModels] = useState<string[]>(providers[0]?.defaultModel ? [providers[0].defaultModel] : []);
  const [providerModelOverrides, setProviderModelOverrides] = useState<Record<string, string[]>>({});
  const [draftSubmittedMessages, setDraftSubmittedMessages] = useState<SessionMessage[]>([]);
  const [messagePage, setMessagePage] = useState<SessionMessagesPage>({ items: [], nextCursor: null, hasMore: false });
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [eventStreamNotice, setEventStreamNotice] = useState("");
  const [lastOutputAt, setLastOutputAt] = useState("");
  const lastOutputAtRef = useRef("");
  const loadingProviderModelsRef = useRef(new Set<string>());
  const [taskRuns, setTaskRuns] = useState<TaskRunSummary[]>([]);
  const [taskRunCursor, setTaskRunCursor] = useState<string | null>(null);
  const [taskRunHasMore, setTaskRunHasMore] = useState(false);
  const [executionContexts, setExecutionContexts] = useState<ExecutionContextSummary[]>([]);
  const [messageCards, setMessageCards] = useState<MessageCardSummary[]>([]);
  const [workspacePanel, setWorkspacePanel] = useState<"files" | "terminal" | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [goalInfoExpandSignal, setGoalInfoExpandSignal] = useState(0);
  const [mobileContextPanel, setMobileContextPanel] = useState<"progress" | "changes" | "activity" | null>(null);
  const [roomConsoleOpen, setRoomConsoleOpen] = useState(false);
  const [taskLogPanel, setTaskLogPanel] = useState<{ log: string } | null>(null);
  const [taskContextPanel, setTaskContextPanel] = useState<{ files: TaskContextResponse["files"]; selectedName: string; content: string } | null>(null);
  const [previewPanelOpen, setPreviewPanelOpen] = useState(false);
  const [sessionPreviews, setSessionPreviews] = useState<PreviewSummary[] | null>(null);
  const [previewCommand, setPreviewCommand] = useState("python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}");
  const [previewPort, setPreviewPort] = useState("4179");
  const [previewDirectory, setPreviewDirectory] = useState(".");
  const [previewAccess, setPreviewAccess] = useState<PreviewAccess>("private");
  const [roomMessage, setRoomMessage] = useState("");
  const [roomMentionAgents, setRoomMentionAgents] = useState<AgentSummary[]>([]);
  const [roomActiveAgentIds, setRoomActiveAgentIds] = useState<string[]>([]);
  const [roomRefreshKey, setRoomRefreshKey] = useState(0);
  const [roomConsoleUpdate, setRoomConsoleUpdate] = useState<RoomConsoleUpdate | null>(null);
  const [roomFollowupUntil, setRoomFollowupUntil] = useState(0);
  const [roomEventStreamNotice, setRoomEventStreamNotice] = useState("");
  const [roomMessageMode, setRoomMessageMode] = useState<"sse" | "polling">(() => readLocalStorageValue("codex-web-room-message-mode", "sse") === "polling" ? "polling" : "sse");
  const [roomDisplayName, setRoomDisplayName] = useState("");
  const [replyTarget, setReplyTarget] = useState<SessionMessage | null>(null);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [compactingMemory, setCompactingMemory] = useState(false);
  const [slashMenuTarget, setSlashMenuTarget] = useState<"prompt" | "room" | null>(null);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [slashMenuQuery, setSlashMenuQuery] = useState("");
  const [slashTokenRange, setSlashTokenRange] = useState<{ target: "prompt" | "room"; start: number; end: number } | null>(null);
  const [promptAttachments, setPromptAttachments] = useState<File[]>([]);
  const [roomAttachments, setRoomAttachments] = useState<File[]>([]);
  const [promptFileReferences, setPromptFileReferences] = useState<ComposerFileReference[]>([]);
  const [roomFileReferences, setRoomFileReferences] = useState<ComposerFileReference[]>([]);
  const [fileReferencePicker, setFileReferencePicker] = useState<{
    target: ComposerTarget;
    rootPath: string;
    sourceLabel: string;
    list: FileListResponse | null;
  } | null>(null);
  const [taskTemplateTarget, setTaskTemplateTarget] = useState<ComposerTarget | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [notifyBuilderOpen, setNotifyBuilderOpen] = useState(false);
  const [notifySettings, setNotifySettings] = useState<NotificationSettingsResponse | null>(null);
  const [notifyEventType, setNotifyEventType] = useState<NotificationEventType>("task_completed");
  const [notifyChannelKind, setNotifyChannelKind] = useState<NotificationRecipientSummary["kind"]>("email");
  const [notifyRecipientId, setNotifyRecipientId] = useState("");
  const [notifySenderAccountId, setNotifySenderAccountId] = useState("");
  const [sessionNotifyRules, setSessionNotifyRules] = useState<Array<{ id: string; eventType: NotificationEventType; recipientName: string; recipientId: string; senderAccountId?: string; persisted: boolean }>>([]);
  const promptFileInputRef = useRef<HTMLInputElement | null>(null);
  const roomFileInputRef = useRef<HTMLInputElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const roomTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("codex-web-room-message-mode", roomMessageMode);
    } catch {
      // ignore storage failures
    }
  }, [roomMessageMode]);
  useEffect(() => {
    setSessionNotifyRules([]);
    setPromptFileReferences([]);
    setRoomFileReferences([]);
    setFileReferencePicker(null);
  }, [draftProjectId, session?.id]);
  const timelineRef = useRef<HTMLElement | null>(null);
  const skipNextTimelineScrollRef = useRef(false);
  const onQueueChangeRef = useRef(onQueueChange);
  const onTaskDetailRef = useRef(onTaskDetail);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const sessionProvider = providers.find((provider) => provider.id === session?.providerId) ?? selectedProvider;
  const composerProjectId = session ? (session.projectId ?? "scratch") : (draftProjectId ?? "scratch");
  const selectedComposerProject = projects.find((item) => item.id === composerProjectId);
  const fallbackSessionProjectId = session?.projectId && !selectedComposerProject ? session.projectId : "";
  const composerProjectName = project ? projectDisplayName(project, projects) : selectedComposerProject ? projectDisplayName(selectedComposerProject, projects) : (session?.projectId ? session.workspacePath || session.projectId : t("session.noProject"));
  const composerModels = draftModel && !draftModels.includes(draftModel) ? [draftModel, ...draftModels] : draftModels;
  const isRoomSession = session?.conversationType === "room";
  const roomHasActiveAgents = isRoomSession && roomActiveAgentIds.length > 0;
  const effectiveSessionStatus = isRoomSession ? (roomHasActiveAgents ? "running" : "paused") : session?.status;
  const taskRunning = isRoomSession ? roomHasActiveAgents : effectiveSessionStatus === "running";
  const shouldConnectTaskEvents = Boolean(session?.id && !isRoomSession && session.status === "running");
  const assistantDisplayName = session?.conversationType === "agent"
    ? (session.title.includes(":") ? session.title.split(":")[0]?.trim() || session.title : session.title)
    : "C";
  const pageSessionTitle = session?.title;
  const goalOwnerType: "session" | "agent_session" | "room" = session?.roomId
    ? "room"
    : session?.conversationType === "agent"
      ? "agent_session"
      : "session";
  const goalOwnerId = goalOwnerType === "room" ? session?.roomId ?? "" : session?.id ?? "";
  const taskFailed = session?.status === "paused" && typeof taskDetail?.exitCode === "number" && taskDetail.exitCode !== 0;
  const taskInterrupted = session?.status === "interrupted";
  const realtimeNotice = isRoomSession ? roomEventStreamNotice : eventStreamNotice;
  const fallbackMessages = session ? [{ id: session.id, role: "user" as const, content: pageSessionTitle ?? session.title, createdAt: session.createdAt ?? session.updatedAt }] : [];
  const persistedMessages = mergeMessages(messagePage.items, taskDetail?.messages ?? []);
  const visibleMessages = session
    ? mergeMessages(persistedMessages.length ? persistedMessages : fallbackMessages, optimisticMessages)
    : draftSubmittedMessages;
  useEffect(() => {
    function handleSessionInfoRequested(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string; expandGoal?: boolean }>).detail;
      if (!session?.id || detail?.sessionId !== session.id) return;
      setInfoOpen(true);
      if (detail?.expandGoal) setGoalInfoExpandSignal((value) => value + 1);
    }
    window.addEventListener(sessionInfoRequestedEvent, handleSessionInfoRequested);
    return () => window.removeEventListener(sessionInfoRequestedEvent, handleSessionInfoRequested);
  }, [session?.id]);
  const notifyRecipients = (notifySettings?.recipients ?? []).filter((recipient) => recipient.enabled);
  const notifyRecipientKinds = [...new Set(notifyRecipients.map((recipient) => recipient.kind))];
  const filteredNotifyRecipients = notifyRecipients.filter((recipient) => recipient.kind === notifyChannelKind);
  const notifySenders = (notifySettings?.accounts ?? []).filter((account) => account.enabled && account.channelKind === notifyChannelKind);
  function displayMessage(message: SessionMessage) {
    if (isRoomSession && message.role === "assistant") {
      const match = message.content.match(/^([^:\n]{1,80}):\n([\s\S]*)$/);
      if (match) return { who: match[1].trim(), text: match[2].trim() };
    }
    return {
      who: message.role === "user" ? t("session.user") : assistantDisplayName,
      text: message.content,
    };
  }

  function startReply(message: SessionMessage) {
    setReplyTarget(message);
    if (!isRoomSession || message.role !== "assistant") return;
    const sender = displayMessage(message).who;
    if (!sender || sender === assistantDisplayName) return;
    const mention = roomMentionToken(sender);
    setRoomMessage((current) => current.includes(mention) ? current : `${mention} ${current}`);
  }

  function handleSessionGoalChange(goal: GoalSummary | null) {
    if (!session) return;
    onSessionUpdated({ ...session, goal, updatedAt: new Date().toISOString() });
    if (session.roomId) setRoomRefreshKey((current) => current + 1);
  }
  const sessionInfoItems = [
    { label: t("session.infoTitleLabel"), value: pageSessionTitle ?? t("session.untitled") },
    ...(isRoomSession && roomDisplayName ? [{ label: t("room.title"), value: roomDisplayName }] : []),
    { label: t("session.infoProject"), value: composerProjectName },
    { label: t("session.infoKind"), value: session?.kind ?? "session" },
    { label: t("session.infoWorkspace"), value: session?.workspacePath ?? selectedComposerProject?.workspacePath ?? t("session.workspacePending"), code: true },
    { label: t("session.infoCreated"), value: formatShortDate(session?.createdAt) },
    { label: t("session.infoUpdated"), value: formatShortDate(session?.updatedAt) },
    { label: t("session.infoStatus"), value: readableStatus(effectiveSessionStatus, t) },
    { label: t("session.infoProvider"), value: sessionProvider?.name ?? t("session.notSelected") },
    { label: t("session.infoModel"), value: session?.model ?? draftModel ?? t("session.notSelected") },
  ];

  useEffect(() => {
    onQueueChangeRef.current = onQueueChange;
    onTaskDetailRef.current = onTaskDetail;
  }, [onQueueChange, onTaskDetail]);

  useEffect(() => {
    const provider = selectedProvider;
    if (!provider) return;
    const overrideModels = providerModelOverrides[provider.id] ?? [];
    const models = overrideModels.length ? overrideModels : provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
    setDraftModels(models);
    setDraftModel((current) => current && models.includes(current) ? current : models[0] ?? provider.defaultModel);
  }, [selectedProvider?.id, selectedProvider?.defaultModel, selectedProvider?.models, providerModelOverrides]);

  useEffect(() => {
    const provider = selectedProvider;
    if (!provider || provider.modelsCachedAt || provider.models?.length || loadingProviderModelsRef.current.has(provider.id)) return;
    const providerId = provider.id;
    loadingProviderModelsRef.current.add(providerId);
    let cancelled = false;
    async function loadProviderModels() {
      const response = await fetch(`/api/providers/${providerId}/models`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = response.ok ? await response.json() as ProviderModelsResponse : null;
      if (!cancelled && result?.models?.length) {
        setProviderModelOverrides((current) => ({ ...current, [providerId]: result.models }));
      }
      loadingProviderModelsRef.current.delete(providerId);
    }
    void loadProviderModels().catch(() => {
      loadingProviderModelsRef.current.delete(providerId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider?.id, selectedProvider?.modelsCachedAt, selectedProvider?.models, sessionToken]);

  useEffect(() => {
    if (session) setDraftSubmittedMessages([]);
    setSessionNotifyRules([]);
    setRoomDisplayName("");
    setReplyTarget(null);
  }, [session?.id]);

  useEffect(() => {
    setMessagePage({ items: [], nextCursor: null, hasMore: false });
    setLiveStatus("");
    lastOutputAtRef.current = "";
    setLastOutputAt("");
    setTaskRuns([]);
    setTaskRunCursor(null);
    setTaskRunHasMore(false);
    setExecutionContexts([]);
    setMessageCards([]);
    setEventStreamNotice("");
    if (!session?.id) return;
    void loadMessages(false, true);
    if (session.conversationType === "room" && session.roomId) {
      void loadRoomActiveRuns();
    }
    void loadQueue();
    void loadTaskRuns();
    void loadExecutionContexts();
    void loadMessageCards();
  }, [session?.id, sessionToken]);

  async function loadMessages(older: boolean, force = false) {
    if (!session?.id || (!force && loadingMessages)) return;
    setLoadingMessages(true);
    if (older) skipNextTimelineScrollRef.current = true;
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (older && messagePage.nextCursor) params.set("before", messagePage.nextCursor);
      const response = await fetch(`/api/sessions/${session.id}/messages?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const page = (await response.json()) as SessionMessagesPage;
      setMessagePage((current) => ({
        items: older ? [...page.items, ...current.items] : page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      }));
    } finally {
      setLoadingMessages(false);
    }
  }

  async function loadRoomActiveRuns() {
    if (!session?.roomId) {
      setRoomActiveAgentIds([]);
      return [] as string[];
    }
    const response = await fetch(`/api/rooms/${session.roomId}/runs?limit=20`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return roomActiveAgentIds;
    const page = (await response.json()) as PageResponse<AgentRunSummary>;
    const activeIds = [...new Set(page.items.filter((run) => run.status === "running").map((run) => run.agentId))];
    setRoomActiveAgentIds(activeIds);
    return activeIds;
  }

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    if (skipNextTimelineScrollRef.current) {
      skipNextTimelineScrollRef.current = false;
      return;
    }
    window.requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
    });
  }, [session?.id, visibleMessages.length, taskRunning, liveStatus, queuedMessages.length]);

  useEffect(() => {
    if (!session?.roomId || roomMessageMode !== "polling" || !roomEventStreamNotice || (!roomFollowupUntil && !roomActiveAgentIds.length)) return;
    let stopped = false;
    async function refreshRoomFollowups() {
      if (stopped) return;
      const [, activeIds] = await Promise.all([loadMessages(false, true), loadRoomActiveRuns()]);
      if (!stopped && (Date.now() < roomFollowupUntil || activeIds.length > 0)) {
        window.setTimeout(refreshRoomFollowups, 2000);
      }
    }
    void refreshRoomFollowups();
    return () => {
      stopped = true;
    };
  }, [roomEventStreamNotice, roomFollowupUntil, roomActiveAgentIds.length, roomMessageMode, session?.roomId, sessionToken]);

  useEffect(() => {
    if (!session?.roomId || !isRoomSession || !sessionToken) {
      setRoomEventStreamNotice("");
      return;
    }
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let noticeTimer: number | null = null;
    let reconnectDelay = 2500;
    let closed = false;
    const roomId = session.roomId;
    const eventUrl = `/api/rooms/${encodeURIComponent(roomId)}/events/stream?${new URLSearchParams({ token: sessionToken })}`;
    const markRoomStreamHealthy = () => {
      reconnectDelay = 2500;
      if (noticeTimer !== null) {
        window.clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      setRoomEventStreamNotice("");
    };
    const applyRoomStream = (data: Extract<RoomStreamEvent, { type: "snapshot" | "activity" }>) => {
      const activeIds = [...new Set(data.runs.filter((run) => run.status === "running").map((run) => run.agentId))];
      setRoomActiveAgentIds(activeIds);
      setRoomFollowupUntil(activeIds.length ? Date.now() + 45_000 : 0);
      if (data.messages.length) setMessagePage((current) => ({ ...current, items: mergeMessages(current.items, data.messages) }));
      const event = data.type === "activity" ? data.event ?? data.events[0] : data.events[0];
      if (event) setRoomConsoleUpdate({ roomId, event, tasks: data.tasks, runs: data.runs, version: Date.now() });
      publishTaskActivityChanged(session.id);
      publishWorkspaceChanged(session.id);
    };
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(eventUrl);
      source.onopen = () => {
        markRoomStreamHealthy();
      };
      const handleEvent = (event: MessageEvent) => {
        markRoomStreamHealthy();
        const data = JSON.parse(event.data) as RoomStreamEvent;
        if (data.type === "snapshot" || data.type === "activity") applyRoomStream(data);
      };
      source.addEventListener("snapshot", handleEvent);
      source.addEventListener("activity", handleEvent);
      source.addEventListener("ping", markRoomStreamHealthy);
      source.onerror = () => {
        if (closed) return;
        source?.close();
        if (noticeTimer === null) {
          noticeTimer = window.setTimeout(() => {
            if (!closed) {
              setRoomEventStreamNotice(roomMessageMode === "polling" ? t("session.roomPollingNotice") : t("room.sseDisconnected"));
            }
            noticeTimer = null;
          }, 12000);
        }
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15_000);
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (noticeTimer !== null) window.clearTimeout(noticeTimer);
      source?.close();
    };
  }, [isRoomSession, roomMessageMode, session?.roomId, sessionToken, t]);

  async function loadQueue() {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/queue`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    onQueueChange(session.id, (await response.json()) as QueuedMessage[]);
  }

  async function loadTaskRuns(older = false) {
    if (!session?.id) return;
    const params = new URLSearchParams({ limit: "10" });
    if (older && taskRunCursor) params.set("cursor", taskRunCursor);
    const response = await fetch(`/api/codex/tasks/${session.id}/runs?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as PageResponse<TaskRunSummary>;
    setTaskRuns((current) => older ? [...current, ...result.items] : result.items);
    setTaskRunCursor(result.nextCursor);
    setTaskRunHasMore(result.hasMore);
  }

  async function loadExecutionContexts() {
    if (!session?.id) return;
    const params = new URLSearchParams({ sessionId: session.id, limit: "5" });
    const response = await fetch(`/api/execution-contexts?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setExecutionContexts((await response.json()) as ExecutionContextSummary[]);
  }

  async function loadMessageCards() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/cards`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setMessageCards((await response.json()) as MessageCardSummary[]);
    window.dispatchEvent(new CustomEvent(taskActivityChangedEvent, { detail: { sessionId: session.id } }));
  }

  async function deleteMessageCard(cardId: string) {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setMessageCards((items) => items.filter((item) => item.id !== cardId));
    void loadMessageCards();
  }

  useEffect(() => {
    if (!session) return;
    if (session.providerId) onSelectProvider(session.providerId);
    if (session.model) setDraftModel(session.model);
  }, [onSelectProvider, session?.id, session?.model, session?.providerId]);

  useEffect(() => {
    if (!session?.id) return;
    if (isRoomSession) {
      setEventStreamNotice("");
      return;
    }
    if (shouldConnectTaskEvents) return;
    if (session.status === "running") setEventStreamNotice(t("session.eventStreamFallback"));
    const sessionId = session.id;
    let stopped = false;
    async function loadTaskDetail() {
      const response = await fetch(`/api/codex/tasks/${sessionId}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok || stopped) return;
      const detail = (await response.json()) as CodexTaskDetail;
      onTaskDetail(detail);
      setMessagePage((current) => {
        const merged = mergeMessages(current.items, detail.messages);
        if (merged.length === current.items.length && merged.every((message, index) => message.id === current.items[index]?.id)) return current;
        return { ...current, items: merged };
      });
      if (detail.session.status === "running" && !stopped && !shouldConnectTaskEvents) {
        window.setTimeout(loadTaskDetail, 1400);
      }
    }
    void loadTaskDetail();
    return () => {
      stopped = true;
    };
  }, [isRoomSession, onTaskDetail, session?.id, session?.status, session?.updatedAt, sessionToken, shouldConnectTaskEvents]);

  useEffect(() => {
    if (!session?.id || !shouldConnectTaskEvents) return;
    if (!sessionToken) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 2500;
    let closed = false;
    const eventUrl = `/api/codex/tasks/${encodeURIComponent(session.id)}/events?${new URLSearchParams({ token: sessionToken })}`;
    const mergeDetail = (nextSession: SessionSummary, messages: SessionMessage[] = [], exitCode: number | null = taskDetail?.exitCode ?? null) => {
      onTaskDetailRef.current({
        session: nextSession,
        messages,
        output: taskDetail?.output ?? "",
        exitCode,
      });
      if (messages.length) {
        setMessagePage((current) => ({ ...current, items: mergeMessages(current.items, messages) }));
      }
    };
    const handleEvent = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as TaskEvent;
      if (data.type === "snapshot") {
        setLiveStatus(data.session.status === "running" ? t("session.processing") : "");
        mergeDetail(data.session, data.messages, data.exitCode);
        onQueueChangeRef.current(data.session.id, data.queue);
      }
      if (data.type === "started") {
        setLiveStatus(t("session.started"));
        mergeDetail(data.session);
      }
      if (data.type === "output") {
        lastOutputAtRef.current = data.at;
        setLastOutputAt(data.at);
        setLiveStatus(`${t("session.outputting")} ${formatShortDate(data.at)}`);
      }
      if (data.type === "activity") {
        lastOutputAtRef.current = data.at;
        setLastOutputAt(data.at);
        setLiveStatus(data.detail ? `${data.label}：${data.detail}` : data.label);
        publishTaskActivityChanged(session.id);
        if ((data.kind === "file" || data.kind === "command") && (data.status === "completed" || data.status === "failed")) {
          publishWorkspaceChanged(session.id);
        }
      }
      if (data.type === "workspace") {
        publishWorkspaceChanged(data.session.id);
      }
      if (data.type === "message") {
        setLiveStatus(t("session.replied"));
        mergeDetail(data.session, [data.message]);
        void loadMessageCards();
      }
      if (data.type === "queue") {
        onQueueChangeRef.current(data.session.id, data.queue);
      }
      if (data.type === "done") {
        setLiveStatus("");
        publishWorkspaceChanged(data.session.id);
        publishTaskActivityChanged(data.session.id);
        void loadTaskRuns();
        void loadMessages(false, true);
        setSessionNotifyRules((items) => items.filter((rule) => rule.eventType !== (data.exitCode === 0 ? "task_completed" : "task_failed")));
        mergeDetail(data.session, [], data.exitCode);
      }
      if (data.type === "error") {
        setLiveStatus(`${t("session.failed")}：${data.error}`);
        publishTaskActivityChanged(data.session.id);
        void loadTaskRuns();
        void loadMessages(false, true);
        setSessionNotifyRules((items) => items.filter((rule) => rule.eventType !== "task_failed"));
        mergeDetail(data.session);
      }
    };
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(eventUrl);
      for (const name of ["snapshot", "started", "output", "activity", "workspace", "message", "queue", "done", "error"]) {
        source.addEventListener(name, handleEvent);
      }
      source.onopen = () => {
        reconnectDelay = 2500;
        setEventStreamNotice("");
      };
      source.onerror = () => {
        const lastAt = lastOutputAtRef.current;
        setLiveStatus(lastAt ? `${t("session.reconnecting")} ${formatShortDate(lastAt)}` : t("session.connectingEvents"));
        setEventStreamNotice(t("session.eventStreamReconnecting"));
        source?.close();
        if (closed) return;
        const delay = reconnectDelay;
        reconnectDelay = Math.min(Math.round(reconnectDelay * 1.6), 15_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [session?.id, session?.status, sessionToken, shouldConnectTaskEvents]);

  useEffect(() => {
    if (!session?.roomId || !isRoomSession) {
      setRoomMentionAgents([]);
      setRoomActiveAgentIds([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/rooms/${session.roomId}/agents`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    })
      .then((response) => response.ok ? response.json() : [])
      .then((items: AgentSummary[]) => {
        if (!cancelled) setRoomMentionAgents(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isRoomSession, session?.roomId, sessionToken]);

  function roomMentionToken(value: string) {
    return /\s/.test(value) ? `@"${value.replace(/"/g, '\\"')}"` : `@${value}`;
  }

  function insertRoomMention(value: string) {
    setRoomMessage((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${roomMentionToken(value)} `);
  }

  function insertComposerText(target: ComposerTarget, text: string) {
    const update = (current: string) => `${current}${current.trim() ? "\n\n" : ""}${text}`;
    if (target === "room") setRoomMessage(update);
    else setPrompt(update);
    window.setTimeout(() => {
      const node = target === "room" ? roomTextareaRef.current : promptTextareaRef.current;
      node?.focus();
      const value = target === "room" ? roomTextareaRef.current?.value ?? "" : promptTextareaRef.current?.value ?? "";
      node?.setSelectionRange(value.length, value.length);
    }, 0);
  }

  const taskTemplates = [
    { id: "fix", title: t("session.taskTemplateFix"), prompt: t("session.taskTemplateFixPrompt") },
    { id: "review", title: t("session.taskTemplateReview"), prompt: t("session.taskTemplateReviewPrompt") },
    { id: "test", title: t("session.taskTemplateTest"), prompt: t("session.taskTemplateTestPrompt") },
    { id: "refactor", title: t("session.taskTemplateRefactor"), prompt: t("session.taskTemplateRefactorPrompt") },
    { id: "docs", title: t("session.taskTemplateDocs"), prompt: t("session.taskTemplateDocsPrompt") },
  ];

  function insertTaskTemplate(template: { prompt: string }) {
    if (!taskTemplateTarget) return;
    insertComposerText(taskTemplateTarget, template.prompt);
    setTaskTemplateTarget(null);
  }

  function composerReferenceRoot() {
    if (session?.workspacePath) {
      return { rootPath: session.workspacePath, sourceLabel: pageSessionTitle ?? session.title };
    }
    const projectRoot = project?.workspacePath ?? selectedComposerProject?.workspacePath;
    if (projectRoot) {
      return { rootPath: projectRoot, sourceLabel: composerProjectName };
    }
    return null;
  }

  async function loadFileReferencePicker(path = ".", target: ComposerTarget = fileReferencePicker?.target ?? "prompt") {
    const root = fileReferencePicker && fileReferencePicker.target === target
      ? { rootPath: fileReferencePicker.rootPath, sourceLabel: fileReferencePicker.sourceLabel }
      : composerReferenceRoot();
    if (!root) {
      notify(t("session.commandFileNeedsWorkspace"), "error");
      return;
    }
    setFileReferencePicker((current) => ({
      target,
      rootPath: root.rootPath,
      sourceLabel: root.sourceLabel,
      list: current?.rootPath === root.rootPath && current.target === target ? current.list : null,
    }));
    const response = await fetch(`/api/files?${new URLSearchParams({ rootPath: root.rootPath, path })}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("session.commandFileReadFailed"), "error");
      return;
    }
    const list = (await response.json()) as FileListResponse;
    setFileReferencePicker({ target, rootPath: root.rootPath, sourceLabel: root.sourceLabel, list });
  }

  function openFileReferencePicker(target: ComposerTarget) {
    void loadFileReferencePicker(".", target);
  }

  function addFileReference(entry?: FileEntry) {
    if (!fileReferencePicker?.list) return;
    const list = fileReferencePicker.list;
    const itemPath = entry?.path ?? list.path;
    const kind = entry?.kind ?? "directory";
    const name = entry?.name ?? (itemPath === "." ? fileReferencePicker.sourceLabel : itemPath.split("/").at(-1) ?? itemPath);
    const absolutePath = itemPath === "."
      ? fileReferencePicker.rootPath
      : `${fileReferencePicker.rootPath.replace(/\/+$/, "")}/${itemPath.replace(/^\/+/, "")}`;
    const reference: ComposerFileReference = {
      id: `${fileReferencePicker.rootPath}:${itemPath}:${Date.now()}`,
      name,
      path: itemPath,
      absolutePath,
      kind,
      sourceLabel: fileReferencePicker.sourceLabel,
    };
    const update = (items: ComposerFileReference[]) => items.some((item) => item.absolutePath === reference.absolutePath)
      ? items
      : [...items, reference];
    if (fileReferencePicker.target === "room") setRoomFileReferences(update);
    else setPromptFileReferences(update);
    setFileReferencePicker(null);
  }

  async function loadNotifySettings() {
    const response = await fetch("/api/notifications", { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return null;
    const settings = await response.json() as NotificationSettingsResponse;
    setNotifySettings(settings);
    const firstRecipient = settings.recipients.find((recipient) => recipient.enabled);
    if (firstRecipient) {
      setNotifyChannelKind(firstRecipient.kind);
      setNotifyRecipientId(firstRecipient.id);
    }
    return settings;
  }

  async function openNotifyBuilder() {
    const settings = notifySettings ?? await loadNotifySettings();
    const firstRecipient = settings?.recipients.find((recipient) => recipient.enabled);
    if (!firstRecipient) {
      notify(t("session.commandNotifyNoRecipients"), "error");
      return;
    }
    setNotifyBuilderOpen(true);
  }

  async function createNotifyRule(event: React.FormEvent) {
    event.preventDefault();
    if (!notifyRecipientId) return;
    const recipient = notifyRecipients.find((item) => item.id === notifyRecipientId);
    let persisted = false;
    let id = `local-${Date.now()}`;
    if (session?.id) {
      const response = await fetch("/api/notifications/ephemeral-rules", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: "session",
          scopeId: session.id,
          eventTypes: [notifyEventType],
          targets: [{ recipientId: notifyRecipientId, senderAccountId: notifySenderAccountId || undefined }],
          expireMode: "after_trigger",
        }),
      });
      if (!response.ok) {
        notify(t("session.commandNotifyCreateFailed"), "error");
        return;
      }
      const result = await response.json().catch(() => null) as { id?: string } | null;
      id = result?.id ?? id;
      persisted = true;
    }
    setSessionNotifyRules((items) => [
      ...items,
      { id, eventType: notifyEventType, recipientName: recipient?.name ?? notifyRecipientId, recipientId: notifyRecipientId, senderAccountId: notifySenderAccountId || undefined, persisted },
    ]);
    setNotifyBuilderOpen(false);
    notify(t("session.commandNotifyCreated"), "success");
  }

  const slashCommands = [
    {
      id: "file",
      command: "/file",
      icon: Files,
      title: t("session.commandFile"),
      description: t("session.commandFileHelp"),
      disabled: !composerReferenceRoot(),
      run: (target: ComposerTarget) => {
        openFileReferencePicker(target);
      },
    },
    {
      id: "preview",
      command: "/preview",
      icon: Globe,
      title: t("session.commandPreview"),
      description: t("session.commandPreviewHelp"),
      disabled: !session,
      run: () => {
        void openSessionPreviews();
      },
    },
    {
      id: "task",
      command: "/task",
      icon: Send,
      title: t("session.commandTask"),
      description: t("session.commandTaskHelp"),
      run: (target: ComposerTarget) => {
        setTaskTemplateTarget(target);
      },
    },
    {
      id: "context",
      command: "/context",
      icon: FolderGit2,
      title: t("session.commandContext"),
      description: t("session.commandContextHelp"),
      disabled: !session,
      run: () => {
        void openTaskContext();
      },
    },
    {
      id: "agent",
      command: "/agent",
      icon: Bot,
      title: t("session.commandAgent"),
      description: t("session.commandAgentHelp"),
      disabled: !isRoomSession,
      run: () => {
        setAgentPickerOpen(true);
      },
    },
    {
      id: "notify",
      command: "/notify",
      icon: Bell,
      title: t("session.commandNotify"),
      description: t("session.commandNotifyHelp"),
      run: () => {
        void openNotifyBuilder();
      },
    },
    {
      id: "stop",
      command: "/stop",
      icon: Square,
      title: t("session.commandStop"),
      description: t("session.commandStopHelp"),
      disabled: !session || !taskRunning,
      run: () => {
        if (session) void onStopTask(session.id);
      },
    },
    {
      id: "new",
      command: "/new",
      icon: RotateCcw,
      title: t("session.commandNew"),
      description: t("session.commandNewHelp"),
      run: (target: "prompt" | "room") => {
        if (target === "room") setRoomMessage("");
        else setPrompt("");
        setReplyTarget(null);
      },
    },
    {
      id: "compact",
      command: "/compact",
      icon: Boxes,
      title: t("session.commandCompact"),
      description: t("session.commandCompactHelp"),
      disabled: !session || compactingMemory,
      run: () => {
        void compactSessionMemory();
      },
    },
  ];

  function commandMatches(value: string) {
    const query = value.toLowerCase();
    if (!query.startsWith("/")) return [];
    return slashCommands.filter((item) => item.command.toLowerCase().startsWith(query) || item.title.toLowerCase().includes(query.slice(1)));
  }

  function activeSlashCommands(target: "prompt" | "room") {
    return slashMenuTarget === target ? commandMatches(slashMenuQuery) : [];
  }

  function closeSlashMenu() {
    setSlashMenuTarget(null);
    setSlashMenuIndex(0);
    setSlashMenuQuery("");
    setSlashTokenRange(null);
  }

  function replaceActiveSlashToken(target: "prompt" | "room", replacement = "") {
    if (!slashTokenRange || slashTokenRange.target !== target) return;
    const value = target === "room" ? roomMessage : prompt;
    const before = value.slice(0, slashTokenRange.start);
    const after = value.slice(slashTokenRange.end);
    const next = `${before}${replacement}${after}`.replace(/[ \t]{2,}/g, " ");
    if (target === "room") setRoomMessage(next);
    else setPrompt(next);
    window.setTimeout(() => {
      const node = target === "room" ? roomTextareaRef.current : promptTextareaRef.current;
      const cursor = Math.max(0, before.length + replacement.length);
      node?.focus();
      node?.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function runSlashCommand(target: "prompt" | "room", command = activeSlashCommands(target)[slashMenuIndex]) {
    if (!command || command.disabled) return;
    replaceActiveSlashToken(target, "");
    command.run(target);
    closeSlashMenu();
  }

  function handleSlashKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, target: "prompt" | "room") {
    const commands = slashMenuTarget === target ? activeSlashCommands(target) : [];
    if (!commands.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashMenuIndex((index) => Math.min(commands.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashMenuIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runSlashCommand(target, commands[slashMenuIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
    }
  }

  function updateComposerValue(target: "prompt" | "room", value: string, cursor = value.length) {
    if (target === "room") setRoomMessage(value);
    else setPrompt(value);
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)(\/[^\s]*)$/);
    if (!match || match.index === undefined) {
      if (slashMenuTarget === target) closeSlashMenu();
      return;
    }
    const query = match[2] ?? "";
    const start = match.index + (match[1]?.length ?? 0);
    setSlashMenuTarget(target);
    setSlashMenuQuery(query);
    setSlashTokenRange({ target, start, end: cursor });
    setSlashMenuIndex(0);
  }

  function addComposerFiles(target: "prompt" | "room", files: FileList | null) {
    const current = target === "room" ? roomAttachments : promptAttachments;
    const next = Array.from(files ?? []).filter((file) => {
      if (file.size <= maxComposerAttachmentBytes) return true;
      notify(t("session.attachmentTooLarge").replace("{name}", file.name).replace("{size}", formatBytes(maxComposerAttachmentBytes)), "error");
      return false;
    });
    if (!next.length) return;
    if (current.length + next.length > maxComposerAttachmentFiles) {
      notify(t("session.attachmentTooMany").replace("{count}", String(maxComposerAttachmentFiles)), "error");
      next.splice(Math.max(0, maxComposerAttachmentFiles - current.length));
    }
    if (!next.length) return;
    if (target === "room") setRoomAttachments((current) => [...current, ...next]);
    else setPromptAttachments((current) => [...current, ...next]);
  }

  function removeComposerFile(target: "prompt" | "room", index: number) {
    const removeAt = (items: File[]) => items.filter((_, itemIndex) => itemIndex !== index);
    if (target === "room") setRoomAttachments(removeAt);
    else setPromptAttachments(removeAt);
  }

  function removeFileReference(target: ComposerTarget, id: string) {
    const remove = (items: ComposerFileReference[]) => items.filter((item) => item.id !== id);
    if (target === "room") setRoomFileReferences(remove);
    else setPromptFileReferences(remove);
  }

  function renderComposerAttachments(target: "prompt" | "room") {
    const files = target === "room" ? roomAttachments : promptAttachments;
    const references = target === "room" ? roomFileReferences : promptFileReferences;
    if (!files.length && !references.length && !sessionNotifyRules.length) return null;
    return (
      <div className="composer-attachments">
        {sessionNotifyRules.map((rule) => (
          <span className="composer-attachment notification-intent-chip" key={rule.id}>
            <Bell size={14} />
            <span>{readableNotificationEvent(rule.eventType, t)}{" -> "}{rule.recipientName}</span>
          </span>
        ))}
        {files.map((file, index) => (
          <span className="composer-attachment" key={`${file.name}-${file.size}-${index}`}>
            <span>{file.name}</span>
            <small>{formatBytes(file.size)}</small>
            <button className="icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => removeComposerFile(target, index)}><X size={14} /></button>
          </span>
        ))}
        {references.map((reference) => (
          <span className="composer-attachment file-reference-chip" key={reference.id} title={reference.absolutePath}>
            <Files size={14} />
            <span>{reference.name}</span>
            <small>{reference.kind === "directory" ? t("file.directoryShort") : reference.sourceLabel}</small>
            <button className="icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => removeFileReference(target, reference.id)}><X size={14} /></button>
          </span>
        ))}
      </div>
    );
  }

  function renderSlashCommandMenu(target: "prompt" | "room") {
    const commands = activeSlashCommands(target);
    if (slashMenuTarget !== target || !commands.length) return null;
    return (
      <div className="slash-command-menu" role="listbox" aria-label={t("session.commandMenuTitle")}>
        <div className="slash-command-title">{t("session.commandMenuTitle")}</div>
        {commands.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              className={`slash-command-item ${index === slashMenuIndex ? "active" : ""}`}
              type="button"
              disabled={item.disabled}
              key={item.id}
              onMouseEnter={() => setSlashMenuIndex(index)}
              onClick={() => runSlashCommand(target, item)}
            >
              <span className="slash-command-icon"><Icon size={18} /></span>
              <span className="slash-command-copy">
                <strong>{item.command}</strong>
                <span>{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function replaceActiveRoomMention(value: string) {
    setRoomMessage((current) => {
      const match = current.match(/(^|\s)@(?:"([^"]*)|([^\s@]*))$/);
      if (!match || match.index === undefined) return `${current}${current && !current.endsWith(" ") ? " " : ""}${roomMentionToken(value)} `;
      const prefix = current.slice(0, match.index) + match[1];
      return `${prefix}${roomMentionToken(value)} `;
    });
  }

  function activeRoomMentionQuery() {
    const match = roomMessage.match(/(^|\s)@(?:"([^"]*)|([^\s@]*))$/);
    return match ? (match[2] ?? match[3] ?? "").toLowerCase() : null;
  }

  async function submitRoomMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.roomId || (!roomMessage.trim() && !roomAttachments.length && !roomFileReferences.length)) return;
    const content = promptWithFileReferences(roomMessage.trim() || t("session.attachmentOnlyPrompt"), roomFileReferences);
    const attachments = await filesToAttachmentInputs(roomAttachments).catch(() => null);
    if (roomAttachments.length && !attachments) {
      notify(t("session.attachmentReadFailed"), "error");
      return;
    }
    const response = await fetch(`/api/rooms/${session.roomId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ content, sessionId: session.id, replyToMessageId: replyTarget?.id ?? null, attachments: attachments ?? undefined }),
    });
    if (!response.ok) {
      notify(t("session.attachmentUploadFailed"), "error");
      return;
    }
    const result = (await response.json()) as CreateRoomMessageResponse;
    const displayContent = messageTextWithContext(roomMessage.trim() || t("session.attachmentOnlyPrompt"), roomAttachments, roomFileReferences);
    const nextMessage = result.message
      ? { ...result.message, replyTo: replyTarget ? { id: replyTarget.id, role: replyTarget.role, content: replyTarget.content } : result.message.replyTo }
      : { ...localUserMessage(displayContent), replyToMessageId: replyTarget?.id ?? null, replyTo: replyTarget ? { id: replyTarget.id, role: replyTarget.role, content: replyTarget.content } : null };
    setRoomMessage("");
    setRoomAttachments([]);
    setRoomFileReferences([]);
    setReplyTarget(null);
    setMessagePage((current) => ({ ...current, items: mergeMessages(current.items, [nextMessage]) }));
    if (result.session) onSessionUpdated(result.session);
    setRoomConsoleUpdate({ roomId: session.roomId, event: result.event, tasks: result.tasks, runs: result.runs, version: Date.now() });
    if (result.runs.length) setRoomActiveAgentIds([...new Set(result.runs.filter((run) => run.status === "running" || run.status === "queued").map((run) => run.agentId))]);
    if (result.tasks.length || result.runs.length) setRoomFollowupUntil(Date.now() + 45_000);
    if (result.tasks.length && /(^|\s)@(?:user\b|"[^"]+"|[^\s@]+)/i.test(content)) {
      notify(t("room.mentionTaskCreated").replace("{count}", String(result.tasks.length)), "success");
    }
  }

  async function renameSessionTitle() {
    if (!session) return;
    const title = await dialog.prompt({
      title: t("session.renameTitle"),
      message: t("session.renameTitleHint"),
      defaultValue: session.title,
      placeholder: t("session.infoTitleLabel"),
      confirmLabel: t("action.rename"),
    });
    if (!title?.trim() || title.trim() === session.title) return;
    const body: UpdateSessionRequest = { title: title.trim() };
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      notify(t("session.renameTitleFailed"), "error");
      return;
    }
    const nextSession = (await response.json()) as SessionSummary;
    onSessionUpdated(nextSession);
    notify(t("session.renameTitleUpdated"), "success");
  }

  async function updateSessionNotifications(enabled: boolean) {
    if (!session) return;
    const body: UpdateSessionRequest = { notificationsEnabled: enabled };
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      notify(t("session.notificationToggleFailed"), "error");
      return;
    }
    const nextSession = (await response.json()) as SessionSummary;
    onSessionUpdated(nextSession);
    notify(enabled ? t("session.notificationEnabled") : t("session.notificationDisabled"), "success");
  }

  async function submitTask(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() && !promptAttachments.length && !promptFileReferences.length) return;
    if (taskRunning && promptAttachments.length) {
      notify(t("session.attachmentsCannotQueue"), "error");
      return;
    }
    const basePrompt = prompt.trim() || t("session.attachmentOnlyPrompt");
    const nextPrompt = promptWithFileReferences(basePrompt, promptFileReferences);
    const nextAttachments = promptAttachments;
    const attachmentInputs = await filesToAttachmentInputs(nextAttachments).catch(() => null);
    if (nextAttachments.length && !attachmentInputs) {
      notify(t("session.attachmentReadFailed"), "error");
      return;
    }
    const displayPrompt = messageTextWithContext(basePrompt, nextAttachments, promptFileReferences);
    const replyToMessageId = replyTarget?.id ?? null;
    setPrompt("");
    setPromptAttachments([]);
    setPromptFileReferences([]);
    setReplyTarget(null);
    if (session) {
      await onContinueTask(session.id, nextPrompt, selectedProviderId || null, draftModel || null, replyToMessageId, attachmentInputs ?? undefined, displayPrompt);
    } else {
      setDraftSubmittedMessages([localUserMessage(displayPrompt)]);
      const pendingNotifications = sessionNotifyRules
        .filter((rule) => !rule.persisted)
        .map((rule) => ({
          eventTypes: [rule.eventType],
          targets: [{ recipientId: rule.recipientId, senderAccountId: rule.senderAccountId }],
          expireMode: "after_trigger" as const,
        }));
      await onSubmitTask(nextPrompt, draftProjectId ?? null, selectedProviderId || null, draftModel || null, pendingNotifications.length ? pendingNotifications : undefined, attachmentInputs ?? undefined, displayPrompt);
    }
  }

  function reorderQueuedMessage(dragId: string | null, dropId: string) {
    if (!session?.id || !dragId || dragId === dropId) return;
    const dragIndex = queuedMessages.findIndex((item) => item.id === dragId);
    const dropIndex = queuedMessages.findIndex((item) => item.id === dropId);
    if (dragIndex < 0 || dropIndex < 0) return;
    const nextQueue = [...queuedMessages];
    const [moved] = nextQueue.splice(dragIndex, 1);
    nextQueue.splice(dropIndex, 0, moved);
    setDraggedQueueId(null);
    void onReorderQueuedMessages(session.id, nextQueue.map((item) => item.id));
  }

  function openWorkspaceFiles() {
    if (!session?.workspacePath) return;
    setWorkspacePanel("files");
  }

  function openWorkspaceTerminal() {
    if (!session?.workspacePath) return;
    setWorkspacePanel("terminal");
  }

  async function openSessionPreviews() {
    if (!session?.id) return;
    setPreviewPanelOpen(true);
    await loadSessionPreviews(true);
  }

  async function loadSessionPreviews(showLoading = false) {
    if (!session?.id) return;
    if (showLoading) setSessionPreviews(null);
    const params = new URLSearchParams({ scopeType: "session", scopeId: session.id });
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) setSessionPreviews((await response.json()) as PreviewSummary[]);
    else setSessionPreviews([]);
  }

  useEffect(() => {
    if (!previewPanelOpen || !sessionPreviews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadSessionPreviews(false), 1500);
    return () => window.clearTimeout(timer);
  }, [previewPanelOpen, sessionPreviews, session?.id, sessionToken]);

  async function createSessionPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.id) return;
    const body: CreatePreviewRequest = {
      scopeType: "session",
      scopeId: session.id,
      label: `${pageSessionTitle ?? session.title}:${previewPort}`,
      targetHost: "127.0.0.1",
      port: Number(previewPort),
      command: renderPreviewCommand(previewCommand, previewPort, previewDirectory),
      access: previewAccess,
      autoStart: true,
    };
    const response = await fetch("/api/previews", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        setLiveStatus(t("approval.required"));
        void openSessionPreviews();
        return;
      }
      setLiveStatus(result?.error ? `${t("project.previewStartFailed")}：${result.error}` : t("project.previewStartFailed"));
      return;
    }
    const preview = (await response.json()) as PreviewSummary;
    setSessionPreviews((items) => [preview, ...(items ?? []).filter((item) => item.id !== preview.id)]);
    void loadMessageCards();
  }

  async function stopSessionPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setSessionPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    void loadMessageCards();
  }

  async function deleteSessionPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setSessionPreviews((items) => (items ?? []).filter((item) => item.id !== preview.id));
    void loadMessageCards();
  }

  async function openTaskLog() {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/log`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskLogResponse;
    setTaskLogPanel({ log: result.log ? newestTaskRunsFirst(result.log) : t("session.noTaskLog") });
  }

  async function loadTaskContextFile(fileName: string, files = taskContextPanel?.files ?? []) {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/context/${encodeURIComponent(fileName)}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskContextFileResponse;
    setTaskContextPanel({ files, selectedName: result.name, content: result.content || t("session.noTaskContext") });
  }

  async function openTaskContext() {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/context`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskContextResponse;
    const first = result.files.find((file) => file.name === "context-pack.md") ?? result.files[0];
    if (!first) {
      setTaskContextPanel({ files: [], selectedName: "", content: t("session.noTaskContext") });
      return;
    }
    await loadTaskContextFile(first.name, result.files);
  }

  async function compactSessionMemory() {
    if (!session?.id || compactingMemory) return;
    setCompactingMemory(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/compact`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => null) as (SessionCompactionResponse & { error?: string }) | null;
      if (!response.ok || !result?.compaction) {
        notify(result?.error ? `${t("session.compactMemoryFailed")}：${result.error}` : t("session.compactMemoryFailed"), "error");
        return;
      }
      notify(`${t("session.compactMemoryDone")} · ${result.compaction.sourceMessageCount}`, "success");
      setTaskContextPanel({
        files: [],
        selectedName: "latest-summary.md",
        content: result.summary || t("session.noTaskContext"),
      });
    } finally {
      setCompactingMemory(false);
    }
  }

  async function openSessionMemory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compaction`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as (Partial<SessionCompactionResponse> & { compaction?: SessionCompactionResponse["compaction"] | null });
    if (!result.compaction) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    setTaskContextPanel({
      files: [],
      selectedName: "latest-summary.md",
      content: result.summary || t("session.noTaskContext"),
    });
  }

  async function editSessionMemory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compaction`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const current = (await response.json()) as (Partial<SessionCompactionResponse> & { compaction?: SessionCompactionResponse["compaction"] | null });
    if (!current.compaction) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    const summary = await dialog.prompt({
      title: t("session.editMemory"),
      message: t("session.editMemoryHint"),
      defaultValue: current.summary ?? "",
      confirmLabel: t("action.save"),
      multiline: true,
    });
    if (summary === null) return;
    const body: UpdateSessionCompactionRequest = { summary };
    const update = await fetch(`/api/sessions/${session.id}/compaction`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await update.json().catch(() => null) as (SessionCompactionResponse & { error?: string }) | null;
    if (!update.ok || !result?.compaction) {
      notify(result?.error ? `${t("session.editMemoryFailed")}：${result.error}` : t("session.editMemoryFailed"), "error");
      return;
    }
    notify(t("session.editMemoryDone"), "success");
    setTaskContextPanel({ files: [], selectedName: "latest-summary.md", content: result.summary });
  }

  async function openSessionMemoryHistory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compactions?limit=30`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as SessionCompactionListResponse;
    if (!result.items.length) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    const content = [
      "# Session Memory History",
      "",
      ...result.items.map((item, index) => [
        `## ${index === 0 ? t("session.latestMemory") : item.id}`,
        `- id: ${item.id}`,
        `- created: ${formatShortDate(item.createdAt)}`,
        `- source messages: ${item.sourceMessageCount}`,
        `- source chars: ${item.sourceChars}`,
        `- provider: ${item.providerId ?? "-"}`,
        `- model: ${item.model ?? "-"}`,
        `- supersedes: ${item.supersedesId ?? "-"}`,
        `- file: ${item.filePath}`,
      ].join("\n")),
    ].join("\n\n");
    setTaskContextPanel({ files: [], selectedName: "memory-history.md", content });
  }

  async function restoreSessionMemory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compactions?limit=30`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const history = (await response.json()) as SessionCompactionListResponse;
    if (!history.items.length) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    const defaultValue = history.items[1]?.id ?? history.items[0]?.id ?? "";
    const compactionId = await dialog.prompt({
      title: t("session.restoreMemory"),
      message: t("session.restoreMemoryHint"),
      defaultValue,
      placeholder: "compaction-...",
      confirmLabel: t("session.restoreMemory"),
    });
    if (!compactionId?.trim()) return;
    const restore = await fetch(`/api/sessions/${session.id}/compactions/${encodeURIComponent(compactionId.trim())}/restore`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await restore.json().catch(() => null) as (SessionCompactionResponse & { error?: string }) | null;
    if (!restore.ok || !result?.compaction) {
      notify(result?.error ? `${t("session.restoreMemoryFailed")}：${result.error}` : t("session.restoreMemoryFailed"), "error");
      return;
    }
    notify(t("session.restoreMemoryDone"), "success");
    setTaskContextPanel({ files: [], selectedName: "latest-summary.md", content: result.summary });
  }

  const roomMentionQuery = isRoomSession ? activeRoomMentionQuery() : null;
  const roomMentionSuggestions = roomMentionQuery === null ? [] : [
    { id: "user", label: "user" },
    ...roomMentionAgents.map((agent) => ({ id: agent.id, label: agent.name })),
  ].filter((item) => item.label.toLowerCase().includes(roomMentionQuery)).slice(0, 8);
  const notificationCenter = React.useContext(NotificationCenterContext);

  return (
    <>
      <main className="conversation">
        <header className="task-header page-header">
          <div className="header-title-row">
            <MobileMainToggle label={t("nav.sessions")} onClick={onOpenMainNav} />
            <div className="session-heading-block">
              <div className="session-title-line">
                {session && <span className={`session-type-badge ${session.conversationType ?? "codex"}`}>{readableSessionType(session, t)}</span>}
                <h1 title={pageSessionTitle ?? t("session.untitled")}>{pageSessionTitle ?? t("session.untitled")}</h1>
              </div>
              <div className="task-path">{session ? readableStatus(effectiveSessionStatus, t) : selectedComposerProject ? projectDisplayName(selectedComposerProject, projects) : t("session.noProject")}</div>
            </div>
          </div>
          <div className="header-actions session-actions">
            {notificationCenter}
            <button className="ghost-button icon-only session-secondary-action" title={t("session.infoTitle")} aria-label={t("session.infoTitle")} onClick={() => setInfoOpen(true)}><IconText icon={Info}>{t("session.infoTitle")}</IconText></button>
            <button className="ghost-button icon-only session-primary-action" title={t("nav.files")} aria-label={t("nav.files")} disabled={!session} onClick={openWorkspaceFiles}><IconText icon={Files}>{t("nav.files")}</IconText></button>
            <button className="ghost-button icon-only session-primary-action" title={t("nav.terminal")} aria-label={t("nav.terminal")} disabled={!session} onClick={openWorkspaceTerminal}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
            <button className="ghost-button icon-only session-secondary-action" title={t("project.preview")} aria-label={t("project.preview")} disabled={!session} onClick={() => void openSessionPreviews()}><IconText icon={Globe}>{t("project.preview")}</IconText></button>
            <button className="ghost-button icon-only session-secondary-action" title={t("preview.stop")} aria-label={t("preview.stop")} disabled={!session || session.status !== "running"} onClick={() => session && onStopTask(session.id)}><IconText icon={Square}>{t("preview.stop")}</IconText></button>
            <button className="ghost-button danger-button icon-only session-secondary-action" title={t("action.delete")} aria-label={t("action.delete")} disabled={!session} onClick={() => session && onDeleteSession(session.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ghost-button icon-only session-mobile-more" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setInfoOpen(true)}><IconText icon={Info}>{t("session.infoTitle")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => setMobileContextPanel("progress")}><IconText icon={Check}>{t("progress.title")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => setMobileContextPanel("activity")}><IconText icon={Activity}>{t("session.activityTitle")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => setMobileContextPanel("changes")}><IconText icon={FolderGit2}>{t("workspace.changes")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => void openSessionPreviews()}><IconText icon={Globe}>{t("project.preview")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session || session.status !== "running"} onSelect={() => session && void onStopTask(session.id)}><IconText icon={Square}>{t("preview.stop")}</IconText></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!session} className="text-red-700 focus:bg-red-50 focus:text-red-800" onSelect={() => session && void onDeleteSession(session.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="mobile-session-bar">
          <MobileSessionToggle label={pageSessionTitle ?? t("session.sessionList")} onClick={onOpenSessionNav} />
        </div>
        <div className={`realtime-notice-slot ${realtimeNotice ? "active" : ""}`} aria-live="polite">
          {realtimeNotice && <><Info size={14} /><span>{realtimeNotice}</span></>}
        </div>
        <section className="timeline" ref={timelineRef}>
          {session?.conversationType === "room" && (
            <div className="room-console-chat-entry">
              <button className="ghost-button icon-only" type="button" title={t("room.title")} aria-label={t("room.title")} onClick={() => setRoomConsoleOpen(true)}>
                <IconText icon={Users}>{t("room.title")}</IconText>
              </button>
            </div>
          )}
          {!session && <Bubble who="C" text={t("session.chooseProjectHint")} t={t} />}
          {session && messagePage.hasMore && (
            <button className="ghost-button load-more" type="button" disabled={loadingMessages} onClick={() => void loadMessages(true)}>
              {loadingMessages ? t("session.loading") : t("session.loadMore")}
            </button>
          )}
          {visibleMessages.map((message) => {
            const display = displayMessage(message);
            return (
              <Bubble
                who={display.who}
                text={display.text}
                user={message.role === "user"}
                t={t}
                replyTo={message.replyTo}
                onReply={() => startReply(message)}
                key={message.id}
              />
            );
          })}
          {messageCards.length > 0 && <MessageCards items={messageCards} sessionToken={sessionToken} t={t} notify={notify} onDelete={(cardId) => void deleteMessageCard(cardId)} />}
          {isRoomSession && roomActiveAgentIds.map((agentId) => {
            const agent = roomMentionAgents.find((item) => item.id === agentId);
            return <Bubble who={agent?.name ?? "Agent"} text={t("session.thinking")} t={t} key={`thinking-${agentId}`} />;
          })}
          {!isRoomSession && taskRunning && <Bubble who={assistantDisplayName} text={liveStatus || t("session.processing")} t={t} />}
          {taskFailed && <Bubble who={assistantDisplayName} text={`${t("session.pausedWithExit")} ${taskDetail?.exitCode}。${t("session.pausedHint")}${taskDetail?.errorSummary ? `\n\n${taskDetail.errorSummary}` : ""}`} t={t} />}
          {taskInterrupted && <Bubble who={assistantDisplayName} text={t("session.interruptedHint")} t={t} />}
          {taskInterrupted && (
            <div className="message-actions recovery-actions">
              <button className="ghost-button" type="button" onClick={() => setPrompt(t("session.recoveryPrompt"))}>{t("session.prepareRecoveryPrompt")}</button>
              {session && <button className="dark-button" type="button" onClick={() => void onRecoverTask(session.id, t("session.recoveryPrompt"), selectedProviderId || null, draftModel || null)}>{t("session.recoverNow")}</button>}
            </div>
          )}
          {session && queuedMessages.length > 0 && (
            <section className="message-queue">
              <div className="queue-head">
                <strong>{t("session.queueTitle")}</strong>
                <span>{queuedMessages.length} {t("session.queueUnit")}</span>
              </div>
              {queuedMessages.map((item, index) => (
                <QueuedMessageRow
                  key={item.id}
                  item={item}
                  index={index}
                  dragging={draggedQueueId === item.id}
                  onDragStart={() => setDraggedQueueId(item.id)}
                  onDragEnd={() => setDraggedQueueId(null)}
                  onDropOn={() => reorderQueuedMessage(draggedQueueId, item.id)}
                  onSave={(nextPrompt) => onUpdateQueuedMessage(
                    session.id,
                    item.id,
                    nextPrompt,
                    item.providerId ?? (selectedProviderId || null),
                    item.model ?? (draftModel || null),
                  )}
                  onDelete={() => onDeleteQueuedMessage(session.id, item.id)}
                  t={t}
                />
              ))}
            </section>
          )}
        </section>
        {isRoomSession ? (
          <form className="composer" onSubmit={submitRoomMessage}>
            {replyTarget && (
              <div className="reply-composer">
                <span>{t("session.replyingTo")}: {replyTarget.content.slice(0, 120)}</span>
                <button className="ghost-button icon-only" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setReplyTarget(null)}><IconText icon={X}>{t("action.close")}</IconText></button>
              </div>
            )}
            <div className="room-mention-bar composer-mention-bar">
              <button className="ghost-button mention-chip" type="button" onClick={() => insertRoomMention("user")}>@user</button>
              {roomMentionAgents.map((agent) => (
                <button className={`ghost-button mention-chip ${roomActiveAgentIds.includes(agent.id) ? "active" : ""}`} key={agent.id} type="button" onClick={() => insertRoomMention(agent.name)}>
                  <span className="mention-status-dot" />
                  @{agent.name}
                </button>
              ))}
            </div>
            <div className="mention-composer-wrap">
              {renderComposerAttachments("room")}
              <div className="composer-input-row">
                <button className="composer-upload-button" type="button" title={t("session.addAttachment")} aria-label={t("session.addAttachment")} onClick={() => roomFileInputRef.current?.click()}><Plus size={20} /></button>
                <input ref={roomFileInputRef} name="roomattachments" type="file" multiple hidden onChange={(event) => { addComposerFiles("room", event.currentTarget.files); event.currentTarget.value = ""; }} />
                <textarea ref={roomTextareaRef} name="roommessage" rows={2} value={roomMessage} onChange={(event) => updateComposerValue("room", event.target.value, event.currentTarget.selectionStart)} onClick={(event) => updateComposerValue("room", event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={(event) => handleSlashKeyDown(event, "room")} placeholder={t("room.messagePlaceholder")} />
              </div>
              {renderSlashCommandMenu("room")}
              {!replyTarget && slashMenuTarget !== "room" && roomMentionSuggestions.length > 0 && (
                <div className="mention-suggestions">
                  {roomMentionSuggestions.map((item) => (
                    <button type="button" key={item.id} onClick={() => replaceActiveRoomMention(item.label)}>@{item.label}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-actions">
              <button type="submit" className="dark-button"><IconText icon={Send}>{t("session.send")}</IconText></button>
            </div>
          </form>
        ) : <form className="composer" onSubmit={submitTask}>
          {replyTarget && (
            <div className="reply-composer">
              <span>{t("session.replyingTo")}: {replyTarget.content.slice(0, 120)}</span>
              <button className="ghost-button icon-only" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setReplyTarget(null)}><IconText icon={X}>{t("action.close")}</IconText></button>
            </div>
          )}
          <div className="mention-composer-wrap">
            {renderComposerAttachments("prompt")}
            <div className="composer-input-row">
              <button className="composer-upload-button" type="button" title={t("session.addAttachment")} aria-label={t("session.addAttachment")} onClick={() => promptFileInputRef.current?.click()}><Plus size={20} /></button>
              <input ref={promptFileInputRef} name="promptattachments" type="file" multiple hidden onChange={(event) => { addComposerFiles("prompt", event.currentTarget.files); event.currentTarget.value = ""; }} />
              <textarea ref={promptTextareaRef} name="prompt" rows={2} value={prompt} onChange={(event) => updateComposerValue("prompt", event.target.value, event.currentTarget.selectionStart)} onClick={(event) => updateComposerValue("prompt", event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={(event) => handleSlashKeyDown(event, "prompt")} placeholder={t("form.composerPrompt")} />
            </div>
            {renderSlashCommandMenu("prompt")}
          </div>
          <div className="composer-actions">
            <select name="draftmodel" className="model-select" value={draftModel} onChange={(event) => setDraftModel(event.target.value)}>
              {composerModels.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
            {session ? (
              <div className="model-select readonly-model-select" title={session.workspacePath}>{composerProjectName}</div>
            ) : (
              <select name="composerprojectid" className="model-select" value={composerProjectId} onChange={(event) => onDraftProjectId(event.target.value === "scratch" ? null : event.target.value)}>
                <option value="scratch">{t("session.noProject")}</option>
                {projects.map((item) => <option value={item.id} key={item.id}>{t("page.projects")}：{item.name}</option>)}
              </select>
            )}
            <button type="submit" className="dark-button"><IconText icon={Send}>{taskRunning ? t("session.queue") : t("session.send")}</IconText></button>
          </div>
        </form>}
      </main>
      {session && workspacePanel && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{workspacePanel === "files" ? t("workspace.sessionFiles") : t("workspace.sessionTerminal")}</strong>
              <span>{pageSessionTitle}</span>
            </div>
            <div className="workspace-modal-controls">
              <div className="workspace-modal-actions">
                <button className={`ghost-button icon-only ${workspacePanel === "files" ? "active" : ""}`} type="button" title={t("nav.files")} aria-label={t("nav.files")} onClick={() => setWorkspacePanel("files")}><IconText icon={Files}>{t("nav.files")}</IconText></button>
                <button className={`ghost-button icon-only ${workspacePanel === "terminal" ? "active" : ""}`} type="button" title={t("nav.terminal")} aria-label={t("nav.terminal")} onClick={() => setWorkspacePanel("terminal")}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
              </div>
              <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setWorkspacePanel(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="workspace-modal-body">
            {workspacePanel === "files" && (
              <FilesPage sessionToken={sessionToken} t={t} initialRootPath={session.workspacePath} initialMountName={session.title || "Session Workspace"} embedded />
            )}
            {workspacePanel === "terminal" && (
              <TerminalPage sessionToken={sessionToken} t={t} initialCwd={session.workspacePath} embedded />
            )}
          </div>
        </div>
      )}
      {previewPanelOpen && session && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.preview")}</strong>
              <span>{pageSessionTitle}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setPreviewPanelOpen(false)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            <form className="preview-form" onSubmit={createSessionPreview}>
              <label>
                <span>{t("project.previewCommand")}</span>
                <input name="previewcommand" value={previewCommand} onChange={(event) => setPreviewCommand(event.target.value)} placeholder="python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}" required />
              </label>
              <label>
                <span>{t("project.previewDirectory")}</span>
                <PreviewDirectoryPicker sessionToken={sessionToken} rootPath={session.workspacePath} value={previewDirectory} onChange={setPreviewDirectory} placeholder="." t={t} />
              </label>
              <label>
                <span>{t("project.previewPort")}</span>
                <input name="previewport" value={previewPort} onChange={(event) => setPreviewPort(event.target.value)} inputMode="numeric" placeholder="4179" required />
              </label>
              <label>
                <span>{t("preview.access")}</span>
                <select name="previewaccess" value={previewAccess} onChange={(event) => setPreviewAccess(event.target.value as PreviewAccess)}>
                  <option value="private">{t("preview.private")}</option>
                  <option value="public">{t("preview.public")}</option>
                </select>
              </label>
              <button className="ghost-button" type="submit"><IconText icon={Play}>{t("project.startPreview")}</IconText></button>
            </form>
            {!sessionPreviews && <div className="subtle">{t("project.loadingPreviews")}</div>}
            {sessionPreviews?.map((preview) => (
              <div className="preview-row" key={preview.id}>
                <div>
                  <strong>{preview.label}</strong>
                  <span>{preview.status} · {preview.access} · {preview.targetHost}:{preview.port}</span>
                  {preview.command && <code>{preview.command}</code>}
                </div>
                <div className="preview-actions">
                  <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, notify, t)}>{t("project.openPreview")}</button>
                  <button className="ghost-button" type="button" disabled={preview.status !== "running" && preview.status !== "starting"} onClick={() => void stopSessionPreview(preview)}>{t("action.disconnect")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteSessionPreview(preview)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {sessionPreviews && !sessionPreviews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      )}
      {mobileContextPanel && session && (
        <div className="dialog-layer mobile-context-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setMobileContextPanel(null)} />
          <section className="dialog-card mobile-context-card" role="dialog" aria-modal="true">
            <div className="dialog-head">
              <div>
                <strong>{mobileContextPanel === "progress" ? t("progress.title") : mobileContextPanel === "activity" ? t("session.activityTitle") : t("workspace.changes")}</strong>
                <p>{pageSessionTitle ?? t("session.untitled")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setMobileContextPanel(null)} title={t("action.close")}>
                <X size={16} />
              </button>
            </div>
            <ContextPanel
              sessionToken={sessionToken}
              session={session}
              taskDetail={taskDetail}
              queuedMessages={queuedMessages}
              onUpdateQueuedMessage={onUpdateQueuedMessage}
              onReorderQueuedMessages={onReorderQueuedMessages}
              onDeleteQueuedMessage={onDeleteQueuedMessage}
              t={t}
              initialPanel={mobileContextPanel}
              modal
              onOpenFile={() => {
                setMobileContextPanel(null);
                openWorkspaceFiles();
              }}
            />
          </section>
        </div>
      )}
      {infoOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setInfoOpen(false)} />
          <section className="dialog-card session-info-card" role="dialog" aria-modal="true" aria-labelledby="session-info-title">
            <div className="dialog-head">
              <div>
                <strong id="session-info-title">{t("session.infoTitle")}</strong>
                <p>{session?.title ?? t("session.untitled")}</p>
              </div>
              <div className="dialog-head-actions">
                <button className="drawer-close" type="button" onClick={() => setInfoOpen(false)} title={t("action.close")}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="session-info-grid">
              {sessionInfoItems.map((item, index) => (
                <div className="session-info-row" key={item.label}>
                  <span>{item.label}</span>
                  {index === 0 ? (
                    <div className="session-info-value-action">
                      <strong>{item.value}</strong>
                      {session && <button className="ghost-button icon-only session-title-action" type="button" onClick={() => void renameSessionTitle()} title={t("session.renameTitle")} aria-label={t("session.renameTitle")}><Pencil size={14} /></button>}
                    </div>
                  ) : item.code ? <code>{item.value}</code> : <strong>{item.value}</strong>}
                </div>
              ))}
            </div>
            {session && (
              <div className="room-settings-grid">
                <label className="room-setting-row">
                  <span>{t("session.notifications")}</span>
                  <Switch checked={session.notificationsEnabled !== false} onCheckedChange={(checked) => void updateSessionNotifications(checked)} />
                </label>
                <span className="subtle">{t("session.notificationsHelp")}</span>
              </div>
            )}
            {session && goalOwnerId && (
              <div className="session-info-goal">
                <GoalPanel
                  sessionToken={sessionToken}
                  goal={session.goal}
                  ownerType={goalOwnerType}
                  ownerId={goalOwnerId}
                  t={t}
                  notify={notify}
                  onGoalChange={handleSessionGoalChange}
                  agents={roomMentionAgents}
                  expandSignal={goalInfoExpandSignal}
                />
              </div>
            )}
            {session?.conversationType === "room" && (
              <div className="room-settings-grid">
                <label className="room-setting-row room-message-mode-row">
                  <span>{t("room.messageMode")}</span>
                  <div className="room-switch-row" title={t("room.messageModeHelp")}>
                    <span className={roomMessageMode === "sse" ? "active" : ""}>{t("room.messageModeSse")}</span>
                    <Switch checked={roomMessageMode === "polling"} onCheckedChange={(checked) => setRoomMessageMode(checked ? "polling" : "sse")} />
                    <span className={roomMessageMode === "polling" ? "active" : ""}>{t("room.messageModePolling")}</span>
                  </div>
                </label>
                <span className="subtle">{t("room.messageModeHelp")}</span>
              </div>
            )}
            <div className="session-run-list">
              <div className="item-row">
                <strong>{t("session.runHistory")}</strong>
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} disabled={!session} onClick={() => void loadTaskRuns()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
              </div>
              {taskRuns.map((run) => (
                <div className="session-run-item" key={run.id}>
                  <strong>{readableRunStatus(run, t)}</strong>
                  <span>{formatShortDate(run.startedAt)} · {run.endedAt ? formatShortDate(run.endedAt) : t("session.statusRunning")} · exit {run.exitCode ?? "null"}</span>
                  {(run.promptChars || run.promptHash) && <span>{t("session.promptMeta")} · {run.promptChars ?? "-"} chars · {run.promptHash ?? "-"}</span>}
                  {run.interruptedReason && <code>{run.interruptedReason}</code>}
                </div>
              ))}
              {taskRunHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadTaskRuns(true)}>{t("session.loadMore")}</button>}
              {!taskRuns.length && <div className="empty-state">{t("session.noRunHistory")}</div>}
            </div>
            <div className="session-run-list">
              <div className="item-row">
                <strong>{t("session.executionContext")}</strong>
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} disabled={!session} onClick={() => void loadExecutionContexts()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
              </div>
              {executionContexts.map((context) => (
                <div className="session-run-item" key={context.id}>
                  <strong>{context.sourceType} · {context.createdBy}</strong>
                  <span>{context.providerId ?? "-"} / {context.model ?? "-"} · {context.sandboxMode} / {context.approvalPolicy}</span>
                  <code>{context.workspacePath}</code>
                </div>
              ))}
              {!executionContexts.length && <div className="empty-state">{t("session.noExecutionContext")}</div>}
            </div>
            <div className="settings-actions">
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openTaskLog()}>{t("session.viewTaskLog")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openTaskContext()}>{t("session.viewTaskContext")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openSessionMemory()}>{t("session.viewMemory")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openSessionMemoryHistory()}>{t("session.memoryHistory")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void editSessionMemory()}>{t("session.editMemory")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void restoreSessionMemory()}>{t("session.restoreMemory")}</button>
              <button className="ghost-button" type="button" disabled={!session || compactingMemory} onClick={() => void compactSessionMemory()}>{compactingMemory ? t("session.compactingMemory") : t("session.compactMemory")}</button>
            </div>
          </section>
        </div>
      )}
      {roomConsoleOpen && session?.conversationType === "room" && session.roomId && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setRoomConsoleOpen(false)} />
          <section className="dialog-card room-info-card" role="dialog" aria-modal="true" aria-labelledby="room-console-title">
            <div className="dialog-head">
              <div>
                <strong id="room-console-title">{t("room.title")}</strong>
                <p>{roomDisplayName || session.title}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setRoomConsoleOpen(false)} title={t("action.close")}>
                <X size={16} />
              </button>
            </div>
            <RoomConsole sessionToken={sessionToken} roomId={session.roomId} sessionWorkspacePath={session.workspacePath} projectWorkspacePath={project?.workspacePath ?? null} reloadKey={roomRefreshKey} recentUpdate={roomConsoleUpdate} realtimeFallback={Boolean(roomEventStreamNotice)} roomMessageMode={roomMessageMode} onRoomMessageModeChange={setRoomMessageMode} t={t} notify={notify} onRoomName={setRoomDisplayName} onOpenSession={onOpenSession} />
          </section>
        </div>
      )}
      {taskLogPanel && (
        <div className="dialog-layer task-log-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setTaskLogPanel(null)} />
          <div className="workspace-modal compact-modal task-log-modal" role="dialog" aria-modal="true">
            <div className="workspace-modal-head">
              <div>
                <strong>{t("session.taskLog")}</strong>
                <span>{session?.id}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setTaskLogPanel(null)}>{t("action.close")}</button>
            </div>
            <pre className="task-log-viewer">{taskLogPanel.log}</pre>
          </div>
        </div>
      )}
      {taskContextPanel && (
        <div className="dialog-layer task-log-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setTaskContextPanel(null)} />
          <div className="workspace-modal compact-modal task-log-modal" role="dialog" aria-modal="true">
            <div className="workspace-modal-head">
              <div>
                <strong>{t("session.taskContext")}</strong>
                <span>{taskContextPanel.selectedName || session?.id}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setTaskContextPanel(null)}>{t("action.close")}</button>
            </div>
            <div className="context-file-tabs">
              {taskContextPanel.files.map((file) => (
                <button className={`ghost-button ${file.name === taskContextPanel.selectedName ? "active" : ""}`} type="button" key={file.name} onClick={() => void loadTaskContextFile(file.name)}>
                  {file.name}
                </button>
              ))}
            </div>
            <pre className="task-log-viewer">{taskContextPanel.content}</pre>
          </div>
        </div>
      )}
      {taskTemplateTarget && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setTaskTemplateTarget(null)} />
          <div className="dialog-card command-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="task-template-title">
            <div className="dialog-head">
              <div>
                <strong id="task-template-title">{t("session.commandTask")}</strong>
                <p>{t("session.commandTaskHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setTaskTemplateTarget(null)} title={t("action.close")}><X size={16} /></button>
            </div>
            <div className="command-picker-list">
              {taskTemplates.map((template) => (
                <button className="file-list-item" type="button" key={template.id} onClick={() => insertTaskTemplate(template)}>
                  <span>{template.title}</span>
                  <em>{template.prompt}</em>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {agentPickerOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setAgentPickerOpen(false)} />
          <div className="dialog-card command-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-picker-title">
            <div className="dialog-head">
              <div>
                <strong id="agent-picker-title">{t("session.commandAgent")}</strong>
                <p>{t("session.commandAgentHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setAgentPickerOpen(false)} title={t("action.close")}><X size={16} /></button>
            </div>
            <div className="command-picker-list">
              <button className="file-list-item" type="button" onClick={() => { insertRoomMention("user"); setAgentPickerOpen(false); }}>
                <span>@user</span>
                <em>{t("session.user")}</em>
              </button>
              {roomMentionAgents.map((agent) => (
                <button className="file-list-item" type="button" key={agent.id} onClick={() => { insertRoomMention(agent.name); setAgentPickerOpen(false); }}>
                  <span>@{agent.name}</span>
                  <em>{agent.description ?? agent.id}</em>
                </button>
              ))}
              {!roomMentionAgents.length && <div className="empty-state">{t("contacts.noAgents")}</div>}
            </div>
          </div>
        </div>
      )}
      {fileReferencePicker && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setFileReferencePicker(null)} />
          <div className="dialog-card file-reference-dialog" role="dialog" aria-modal="true" aria-labelledby="file-reference-title">
            <div className="dialog-head">
              <div>
                <strong id="file-reference-title">{t("session.commandFile")}</strong>
                <p>{fileReferencePicker.sourceLabel}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setFileReferencePicker(null)} title={t("action.close")}><X size={16} /></button>
            </div>
            <div className="file-reference-toolbar">
              <strong>{fileReferencePicker.list?.path ?? "."}</strong>
              <button className="ghost-button" type="button" disabled={!fileReferencePicker.list} onClick={() => addFileReference()}>{t("session.commandFileUseCurrent")}</button>
            </div>
            <div className="file-reference-list">
              {!fileReferencePicker.list && <div className="subtle">{t("file.loadingFiles")}</div>}
              {fileReferencePicker.list?.parentPath && (
                <button className="file-list-item" type="button" onClick={() => void loadFileReferencePicker(fileReferencePicker.list?.parentPath ?? ".", fileReferencePicker.target)}>
                  <span>↩ {t("file.parentDirectory")}</span>
                  <em>{fileReferencePicker.list.parentPath}</em>
                </button>
              )}
              {fileReferencePicker.list?.entries.map((entry) => (
                <div className="file-reference-row" key={entry.path}>
                  <button className="file-list-item" type="button" onClick={() => entry.kind === "directory" ? void loadFileReferencePicker(entry.path, fileReferencePicker.target) : addFileReference(entry)}>
                    <span>{entry.kind === "directory" ? "▸" : "◇"} {entry.name}</span>
                    <em>{entry.kind === "directory" ? t("file.directoryShort") : t("file.sizeKb").replace("{size}", String(Math.ceil(entry.size / 1024)))}</em>
                  </button>
                  {entry.kind === "directory" && (
                    <button className="ghost-button" type="button" onClick={() => addFileReference(entry)}>{t("session.commandFileAdd")}</button>
                  )}
                </div>
              ))}
              {fileReferencePicker.list && !fileReferencePicker.list.entries.length && <div className="empty-state">{t("project.noDirectories")}</div>}
            </div>
          </div>
        </div>
      )}
      {notifyBuilderOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setNotifyBuilderOpen(false)} />
          <form className="dialog-card notify-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="notify-builder-title" onSubmit={createNotifyRule}>
            <div className="dialog-head">
              <div>
                <strong id="notify-builder-title">{t("session.commandNotify")}</strong>
                <p>{t("session.commandNotifyBuilderHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setNotifyBuilderOpen(false)} title={t("action.close")}><X size={16} /></button>
            </div>
            <label>
              <span>{t("settings.notificationEvents")}</span>
              <select name="notify-event-type" value={notifyEventType} onChange={(event) => setNotifyEventType(event.target.value as NotificationEventType)}>
                <option value="task_completed">{t("session.notifyEventCompleted")}</option>
                <option value="task_failed">{t("session.notifyEventFailed")}</option>
                <option value="needs_approval">{t("session.notifyEventApproval")}</option>
              </select>
            </label>
            <label>
              <span>{t("settings.notificationRecipientKind")}</span>
              <select name="notify-channel-kind" value={notifyChannelKind} onChange={(event) => {
                const kind = event.target.value as NotificationRecipientSummary["kind"];
                setNotifyChannelKind(kind);
                setNotifyRecipientId(notifyRecipients.find((recipient) => recipient.kind === kind)?.id ?? "");
                setNotifySenderAccountId("");
              }}>
                {notifyRecipientKinds.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
              </select>
            </label>
            <label>
              <span>{t("settings.notificationRecipientName")}</span>
              <select name="notify-recipient-id" value={notifyRecipientId} onChange={(event) => setNotifyRecipientId(event.target.value)}>
                {filteredNotifyRecipients.map((recipient) => <option value={recipient.id} key={recipient.id}>{recipient.name}</option>)}
              </select>
            </label>
            {notifySenders.length > 1 && (
              <label>
                <span>{t("settings.notificationChooseSender")}</span>
                <select name="notify-sender-id" value={notifySenderAccountId} onChange={(event) => setNotifySenderAccountId(event.target.value)}>
                  <option value="">{t("settings.notificationUseRecipientDefaultSender")}</option>
                  {notifySenders.map((sender) => <option value={sender.id} key={sender.id}>{sender.name}</option>)}
                </select>
              </label>
            )}
            <div className="dialog-actions">
              <button className="ghost-button" type="button" onClick={() => setNotifyBuilderOpen(false)}>{t("action.cancel")}</button>
              <button className="dark-button" type="submit" disabled={!notifyRecipientId}>{t("action.create")}</button>
            </div>
          </form>
        </div>
      )}
      {dialog.node}
    </>
  );
}

function QueuedMessageRow({
  item,
  index,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onSave,
  onDelete,
  t,
}: {
  item: QueuedMessage;
  index: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onSave: (prompt: string) => Promise<void>;
  onDelete: () => Promise<void>;
  t: TFunction;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.prompt);

  useEffect(() => {
    setDraft(item.prompt);
  }, [item.prompt]);

  return (
    <div
      className={`queue-item ${dragging ? "dragging" : ""}`}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropOn();
      }}
    >
      <span className="queue-index">{index + 1}</span>
      <span className="queue-drag-handle" title={t("action.more")} aria-hidden="true"><GripVertical size={15} /></span>
      {editing ? (
        <textarea name="draft" value={draft} rows={2} onChange={(event) => setDraft(event.target.value)} />
      ) : (
        <div className="queue-text">{item.prompt}</div>
      )}
      <div className="queue-actions">
        {editing ? (
          <button className="ghost-button" type="button" onClick={() => {
            void onSave(draft);
            setEditing(false);
          }}>{t("action.save")}</button>
        ) : (
          <button className="ghost-button" type="button" onClick={() => setEditing(true)}>{t("action.edit")}</button>
        )}
        <button className="ghost-button" type="button" onClick={() => void onDelete()}>{t("action.delete")}</button>
      </div>
    </div>
  );
}

function ActivityPanel({ items, hasMore, onLoadMore, t }: { items: ActivityItem[]; hasMore?: boolean; onLoadMore?: () => void; t: TFunction }) {
  return (
    <section className="activity-panel">
      <div className="activity-head">
        <strong>{t("session.activityTitle")}</strong>
        <span>{t("session.recentPrefix")} {items.length} {t("session.queueUnit")}</span>
      </div>
      {items.map((item) => (
        <div className={`activity-item ${item.kind}`} key={`${item.at}-${item.label}-${item.detail ?? ""}`}>
          <span className="activity-dot" />
          <div>
            <strong>{item.label}</strong>
            {item.detail && <code>{item.detail}</code>}
          </div>
          <em>{readableActivityStatus(item.status, item.kind, t)}</em>
        </div>
      ))}
      {hasMore && <button className="ghost-button load-more" type="button" onClick={onLoadMore}>{t("session.loadMore")}</button>}
    </section>
  );
}

type RoomConsoleUpdate = { roomId: string; event: RoomEventSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; version: number };

function RoomConsole({ sessionToken, roomId, sessionWorkspacePath, projectWorkspacePath, reloadKey, recentUpdate, realtimeFallback, roomMessageMode, onRoomMessageModeChange, t, notify, onRoomName, onOpenSession }: { sessionToken: string; roomId: string; sessionWorkspacePath?: string | null; projectWorkspacePath?: string | null; reloadKey?: number; recentUpdate?: RoomConsoleUpdate | null; realtimeFallback?: boolean; roomMessageMode: "sse" | "polling"; onRoomMessageModeChange: (mode: "sse" | "polling") => void; t: TFunction; notify: (message: string, tone?: ToastTone) => void; onRoomName?: (name: string) => void; onOpenSession: (sessionId: string) => void }) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [roomGoalDetail, setRoomGoalDetail] = useState<GoalDetailResponse | null>(null);
  const [agents, setAgents] = useState<RoomAgentSummary[]>([]);
  const [allAgents, setAllAgents] = useState<AgentSummary[]>([]);
  const [tasks, setTasks] = useState<RoomTaskSummary[]>([]);
  const [schedules, setSchedules] = useState<RoomScheduleSummary[]>([]);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [events, setEvents] = useState<RoomEventSummary[]>([]);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [eventHasMore, setEventHasMore] = useState(false);
  const [artifacts, setArtifacts] = useState<RoomArtifactSummary[]>([]);
  const [decisions, setDecisions] = useState<RoomDecisionSummary[]>([]);
  const [handoffs, setHandoffs] = useState<RoomHandoffSummary[]>([]);
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactKind, setArtifactKind] = useState<RoomArtifactSummary["kind"]>("report");
  const [artifactPayload, setArtifactPayload] = useState("");
  const [decisionTitle, setDecisionTitle] = useState("");
  const [handoffFromAgentId, setHandoffFromAgentId] = useState("");
  const [handoffToAgentId, setHandoffToAgentId] = useState("");
  const [handoffSummary, setHandoffSummary] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskAgentId, setTaskAgentId] = useState("");
  const [scheduleAgentId, setScheduleAgentId] = useState("");
  const [newRoomAgentId, setNewRoomAgentId] = useState("");
  const [newRoomAgentListenMode, setNewRoomAgentListenMode] = useState<AgentListenMode>("passive");
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleRunAt, setScheduleRunAt] = useState("");
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [runDiffPanel, setRunDiffPanel] = useState<RoomRunDiffResponse | null>(null);
  const [roomDetailPreview, setRoomDetailPreview] = useState<{ title: string; content: string } | null>(null);
  const [roomListPages, setRoomListPages] = useState({
    tasks: { cursor: null as string | null, hasMore: false },
    schedules: { cursor: null as string | null, hasMore: false },
    runs: { cursor: null as string | null, hasMore: false },
    artifacts: { cursor: null as string | null, hasMore: false },
    decisions: { cursor: null as string | null, hasMore: false },
    handoffs: { cursor: null as string | null, hasMore: false },
  });
  const seenUserMentionRef = useRef("");
  const roomActivity = [
    ...runs.filter((run) => run.status === "running").map((run) => `${agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}: ${t("session.statusRunning")}`),
    ...tasks.filter((task) => task.status === "assigned" || task.status === "queued").slice(0, 3).map((task) => `${task.title}: ${task.status}`),
    ...events.filter((event) => event.type === "orchestrator.decision" || event.type === "user.attention").slice(0, 3).map((event) => event.type),
  ].slice(0, 6);
  const roomStatusCounts = {
    running: tasks.filter((task) => task.status === "running").length,
    waiting: tasks.filter((task) => task.status === "queued" || task.status === "assigned").length,
    done: tasks.filter((task) => task.status === "done").length,
    failed: tasks.filter((task) => task.status === "failed").length,
  };
  const roomAgentLoad = agents.reduce<Record<string, { running: number; waiting: number; latestRun?: AgentRunSummary }>>((items, agent) => {
    items[agent.id] = {
      running: tasks.filter((task) => task.assignedAgentId === agent.id && task.status === "running").length,
      waiting: tasks.filter((task) => task.assignedAgentId === agent.id && (task.status === "queued" || task.status === "assigned")).length,
      latestRun: runs.find((run) => run.agentId === agent.id),
    };
    return items;
  }, {});
  const latestDecision = decisions[0];
  const latestHandoff = handoffs[0];
  const roomParentDir = sessionWorkspacePath?.replace(/\/workspace\/?$/, "") ?? "";
  const dataRoot = roomParentDir.includes("/sessions/") ? roomParentDir.slice(0, roomParentDir.indexOf("/sessions/")) : "";
  const roomRootFromRun = runs.map((run) => run.workspacePath ?? "").find((path) => path.includes(`/rooms/${roomId}/`));
  const roomWorkspaceDir = dataRoot ? `${dataRoot}/rooms/${roomId}` : roomRootFromRun ? roomRootFromRun.slice(0, roomRootFromRun.indexOf(`/rooms/${roomId}/`) + `/rooms/${roomId}`.length) : "";
  const latestAgentWorkspaces = agents
    .map((agent) => ({ agent, run: roomAgentLoad[agent.id]?.latestRun }))
    .filter((item) => item.run?.workspacePath);
  const roomMessageEvents = events.filter((event) => event.type === "user.message" || event.type === "agent.mentioned");
  const roomBlackboardCount = artifacts.length + decisions.length + handoffs.length;
  const roomGoalItems = roomGoalDetail?.items ?? [];
  const roomGoalProposals = roomGoalDetail?.proposals.filter((proposal) => proposal.status === "pending") ?? [];
  const roomGoalColumns = [
    { id: "planned", label: t("goal.items"), items: roomGoalItems.filter((item) => item.status === "planned") },
    { id: "active", label: t("goal.active"), items: roomGoalItems.filter((item) => item.status === "active") },
    { id: "blocked", label: t("goal.blocked"), items: roomGoalItems.filter((item) => item.status === "blocked") },
    { id: "completed", label: t("goal.completed"), items: roomGoalItems.filter((item) => item.status === "completed") },
  ];
  const roomTimeline = [
    ...tasks.slice(0, 4).map((task) => ({ id: task.id, title: task.title, meta: `${t("room.tasks")} · ${task.status}` })),
    ...runs.slice(0, 4).map((run) => ({ id: run.id, title: agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId, meta: `${t("room.runs")} · ${run.status}` })),
    ...decisions.slice(0, 2).map((decision) => ({ id: decision.id, title: decision.title, meta: `${t("room.decision")} · ${readableRoomDecisionStatus(decision.status, t)}` })),
    ...handoffs.slice(0, 2).map((handoff) => ({ id: handoff.id, title: handoff.summary, meta: `${t("room.handoff")} · ${readableRoomHandoffStatus(handoff.status, t)}` })),
  ].slice(0, 8);
  const availableRoomAgents = allAgents.filter((agent) => !agents.some((member) => member.id === agent.id));
  const hasActiveRoomWork = tasks.some((task) => task.status === "running" || task.status === "assigned" || task.status === "queued")
    || runs.some((run) => run.status === "running" || run.status === "queued");

  function renderMentionContent(content?: string) {
    const parts = (content ?? "-").split(/(@"[^"]+"|@[^\s@]+)/g);
    return parts.map((part, index) => part.startsWith("@")
      ? <mark className="mention-token" key={`${part}-${index}`}>{part}</mark>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>);
  }

  async function fetchRoomPage<T>(path: string, cursor?: string | null) {
    const params = new URLSearchParams({ limit: "30" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/rooms/${roomId}/${path}?${params}`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return { items: [], nextCursor: null, hasMore: false } as PageResponse<T>;
    return response.json() as Promise<PageResponse<T>>;
  }

  async function loadRoom() {
    const headers = { authorization: `Bearer ${sessionToken}` };
    const [roomDetail, agentList, allAgentPage, taskPage, schedulePage, runPage, eventPage, artifactPage, decisionPage, handoffPage] = await Promise.all([
      fetch(`/api/rooms/${roomId}`, { headers }).then((response) => response.ok ? response.json() : null),
      fetch(`/api/rooms/${roomId}/agents`, { headers }).then((response) => response.ok ? response.json() : []),
      fetch("/api/agents?limit=100", { headers }).then((response) => response.ok ? response.json() : { items: [] }),
      fetchRoomPage<RoomTaskSummary>("tasks"),
      fetchRoomPage<RoomScheduleSummary>("schedules"),
      fetchRoomPage<AgentRunSummary>("runs"),
      fetch(`/api/rooms/${roomId}/events?limit=10`, { headers }).then((response) => response.ok ? response.json() : { items: [] }),
      fetchRoomPage<RoomArtifactSummary>("artifacts"),
      fetchRoomPage<RoomDecisionSummary>("decisions"),
      fetchRoomPage<RoomHandoffSummary>("handoffs"),
    ]) as [RoomSummary | null, RoomAgentSummary[], PageResponse<AgentSummary>, PageResponse<RoomTaskSummary>, PageResponse<RoomScheduleSummary>, PageResponse<AgentRunSummary>, PageResponse<RoomEventSummary>, PageResponse<RoomArtifactSummary>, PageResponse<RoomDecisionSummary>, PageResponse<RoomHandoffSummary>];
    setRoom(roomDetail);
    if (roomDetail?.goal?.id) {
      const goalResponse = await fetch(`/api/goals/${roomDetail.goal.id}`, { headers });
      setRoomGoalDetail(goalResponse.ok ? await goalResponse.json() as GoalDetailResponse : null);
    } else {
      setRoomGoalDetail(null);
    }
    if (roomDetail?.name) onRoomName?.(roomDetail.name);
    setAgents(agentList);
    setAllAgents(allAgentPage.items ?? []);
    setTasks(taskPage.items ?? []);
    setSchedules(schedulePage.items ?? []);
    setRuns(runPage.items ?? []);
    setEvents(eventPage.items ?? []);
    setEventCursor(eventPage.nextCursor);
    setEventHasMore(eventPage.hasMore);
    setArtifacts(artifactPage.items ?? []);
    setDecisions(decisionPage.items ?? []);
    setHandoffs(handoffPage.items ?? []);
    const currentRoomAgentIds = new Set(agentList.map((agent) => agent.id));
    setNewRoomAgentId((current) => current && !currentRoomAgentIds.has(current) ? current : (allAgentPage.items ?? []).find((agent) => !currentRoomAgentIds.has(agent.id))?.id ?? "");
    setRoomListPages({
      tasks: { cursor: taskPage.nextCursor, hasMore: taskPage.hasMore },
      schedules: { cursor: schedulePage.nextCursor, hasMore: schedulePage.hasMore },
      runs: { cursor: runPage.nextCursor, hasMore: runPage.hasMore },
      artifacts: { cursor: artifactPage.nextCursor, hasMore: artifactPage.hasMore },
      decisions: { cursor: decisionPage.nextCursor, hasMore: decisionPage.hasMore },
      handoffs: { cursor: handoffPage.nextCursor, hasMore: handoffPage.hasMore },
    });
    const userMention = (eventPage.items ?? []).find((event) => {
      const payload = event.payload as { mentionsUser?: boolean; content?: string } | null;
      return event.type === "user.message" && payload?.mentionsUser && event.id !== seenUserMentionRef.current;
    });
    if (userMention) {
      seenUserMentionRef.current = userMention.id;
      const payload = userMention.payload as { content?: string };
      notify(`${t("room.userMentioned")}：${payload.content ?? ""}`, "info");
    }
    setTaskAgentId((current) => current || agentList[0]?.id || "");
    setScheduleAgentId((current) => current || agentList[0]?.id || "");
  }

  async function loadRoomActivity() {
    const headers = { authorization: `Bearer ${sessionToken}` };
    const [taskPage, runPage, eventPage] = await Promise.all([
      fetchRoomPage<RoomTaskSummary>("tasks"),
      fetchRoomPage<AgentRunSummary>("runs"),
      fetch(`/api/rooms/${roomId}/events?limit=10`, { headers }).then((response) => response.ok ? response.json() : { items: [], nextCursor: null, hasMore: false }),
    ]) as [PageResponse<RoomTaskSummary>, PageResponse<AgentRunSummary>, PageResponse<RoomEventSummary>];
    setTasks(taskPage.items ?? []);
    setRuns(runPage.items ?? []);
    setEvents(eventPage.items ?? []);
    setEventCursor(eventPage.nextCursor);
    setEventHasMore(eventPage.hasMore);
    setRoomListPages((current) => ({
      ...current,
      tasks: { cursor: taskPage.nextCursor, hasMore: taskPage.hasMore },
      runs: { cursor: runPage.nextCursor, hasMore: runPage.hasMore },
    }));
  }

  useEffect(() => {
    void loadRoom();
  }, [roomId, sessionToken, reloadKey]);

  useEffect(() => {
    if (!recentUpdate || recentUpdate.roomId !== roomId) return;
    setEvents((current) => [recentUpdate.event, ...current.filter((event) => event.id !== recentUpdate.event.id)]);
    if (recentUpdate.tasks.length) {
      setTasks((current) => [...recentUpdate.tasks, ...current.filter((task) => !recentUpdate.tasks.some((item) => item.id === task.id))]);
    }
    if (recentUpdate.runs.length) {
      setRuns((current) => [...recentUpdate.runs, ...current.filter((run) => !recentUpdate.runs.some((item) => item.id === run.id))]);
    }
  }, [recentUpdate?.version, roomId]);

  const roomPollingFallbackEnabled = roomMessageMode === "polling";

  useEffect(() => {
    if (!roomPollingFallbackEnabled || !realtimeFallback || !hasActiveRoomWork) return;
    let stopped = false;
    async function refreshActiveRoom() {
      if (stopped) return;
      await loadRoomActivity();
      if (!stopped) window.setTimeout(refreshActiveRoom, 2000);
    }
    const timer = window.setTimeout(refreshActiveRoom, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [roomPollingFallbackEnabled, realtimeFallback, hasActiveRoomWork, roomId, sessionToken]);

  async function loadMoreRoomList(kind: keyof typeof roomListPages) {
    const cursor = roomListPages[kind].cursor;
    if (!cursor) return;
    if (kind === "tasks") {
      const page = await fetchRoomPage<RoomTaskSummary>("tasks", cursor);
      setTasks((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, tasks: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "schedules") {
      const page = await fetchRoomPage<RoomScheduleSummary>("schedules", cursor);
      setSchedules((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, schedules: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "runs") {
      const page = await fetchRoomPage<AgentRunSummary>("runs", cursor);
      setRuns((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, runs: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "artifacts") {
      const page = await fetchRoomPage<RoomArtifactSummary>("artifacts", cursor);
      setArtifacts((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, artifacts: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "decisions") {
      const page = await fetchRoomPage<RoomDecisionSummary>("decisions", cursor);
      setDecisions((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, decisions: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else {
      const page = await fetchRoomPage<RoomHandoffSummary>("handoffs", cursor);
      setHandoffs((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, handoffs: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    }
  }

  async function loadMoreRoomEvents() {
    if (!eventCursor) return;
    const params = new URLSearchParams({ limit: "30", cursor: eventCursor });
    const response = await fetch(`/api/rooms/${roomId}/events?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<RoomEventSummary>;
    setEvents((current) => [...current, ...page.items]);
    setEventCursor(page.nextCursor);
    setEventHasMore(page.hasMore);
  }

  async function updateRoomAgentListenMode(agentId: string, listenMode: AgentListenMode) {
    setAgents((current) => current.map((agent) => agent.id === agentId ? { ...agent, listenMode } : agent));
    const response = await fetch(`/api/rooms/${roomId}/agents/${agentId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ listenMode }),
    });
    if (!response.ok) {
      notify(t("contacts.updateGroupFailed"), "error");
      await loadRoom();
      return;
    }
    setAgents((await response.json()) as RoomAgentSummary[]);
  }

  async function addRoomAgent(event: React.FormEvent) {
    event.preventDefault();
    if (!newRoomAgentId) return;
    const response = await fetch(`/api/rooms/${roomId}/agents`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ agentId: newRoomAgentId, listenMode: newRoomAgentListenMode }),
    });
    if (!response.ok) {
      notify(t("contacts.createAgentFailed"), "error");
      return;
    }
    setAgents((await response.json()) as RoomAgentSummary[]);
    await loadRoom();
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: taskTitle, prompt: taskPrompt, assignedAgentId: taskAgentId || null }),
    });
    if (!response.ok) return;
    setTaskTitle("");
    setTaskPrompt("");
    await loadRoom();
  }

  async function createSchedule(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/schedules`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ agentId: scheduleAgentId, taskPrompt: schedulePrompt, scheduleType: "once", runAt: scheduleRunAt || null }),
    });
    if (!response.ok) return;
    setSchedulePrompt("");
    setScheduleRunAt("");
    await loadRoom();
  }

  async function startTask(task: RoomTaskSummary) {
    setStartingTaskId(task.id);
    try {
      const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const result = await response.json() as { session?: SessionSummary };
      await loadRoom();
      if (result.session?.id) onOpenSession(result.session.id);
    } finally {
      setStartingTaskId(null);
    }
  }

  async function deleteRoomTask(task: RoomTaskSummary) {
    if (!window.confirm(t("room.deleteTaskConfirm"))) return;
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function deleteRoomSchedule(schedule: RoomScheduleSummary) {
    if (!window.confirm(t("room.deleteScheduleConfirm"))) return;
    const response = await fetch(`/api/rooms/${roomId}/schedules/${schedule.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function updateRoomSettings(patch: Partial<RoomSummary["orchestration"]>) {
    if (!room) return;
    const response = await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ orchestration: patch }),
    });
    if (response.ok) await loadRoom();
  }

  async function updateRoomTask(task: RoomTaskSummary, patch: Partial<RoomTaskSummary>) {
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (response.ok) await loadRoom();
  }

  async function cancelRoomTask(task: RoomTaskSummary) {
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function retryRoomTask(task: RoomTaskSummary) {
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}/retry`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function retryFailedRoomTasks() {
    const response = await fetch(`/api/rooms/${roomId}/tasks/retry-failed`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await response.json().catch(() => null) as { retried?: number } | null;
    if (response.ok) {
      notify(t("room.retryFailedStarted").replace("{count}", String(result?.retried ?? 0)), "success");
      await loadRoom();
    }
  }

  async function openRunDiff(run: AgentRunSummary) {
    const response = await fetch(`/api/rooms/${roomId}/runs/${run.id}/diff`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setRunDiffPanel((await response.json()) as RoomRunDiffResponse);
  }

  async function mergeRun(run: AgentRunSummary) {
    const response = await fetch(`/api/rooms/${roomId}/runs/${run.id}/merge`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await response.json().catch(() => null) as RoomRunMergeResponse | { message?: string; error?: string } | null;
    if (response.status === 409 && result && "error" in result && result.error === "approval_required") {
      notify(t("approval.required"), "info");
      await loadRoom();
      return;
    }
    notify(response.ok ? t("room.mergeApplied") : `${t("room.mergeFailed")}: ${result && "message" in result ? result.message : result && "error" in result ? result.error : ""}`, response.ok ? "success" : "error");
    await loadRoom();
  }

  async function rejectRun(run: AgentRunSummary) {
    const response = await fetch(`/api/rooms/${roomId}/runs/${run.id}/reject`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) {
      notify(t("room.mergeRejected"), "success");
      await loadRoom();
    }
  }

  function parsePayloadText(value: string) {
    if (!value.trim()) return {};
    try {
      return JSON.parse(value);
    } catch {
      return { text: value.trim() };
    }
  }

  async function createArtifact(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/artifacts`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: artifactTitle, kind: artifactKind, payload: parsePayloadText(artifactPayload) }),
    });
    if (!response.ok) return;
    setArtifactTitle("");
    setArtifactPayload("");
    await loadRoom();
  }

  async function createDecision(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/decisions`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: decisionTitle, status: "open" }),
    });
    if (!response.ok) return;
    setDecisionTitle("");
    await loadRoom();
  }

  async function createHandoff(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/handoffs`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ fromAgentId: handoffFromAgentId || null, toAgentId: handoffToAgentId || null, summary: handoffSummary }),
    });
    if (!response.ok) return;
    setHandoffSummary("");
    await loadRoom();
  }

  function openRoomDetails(title: string, payload: unknown) {
    setRoomDetailPreview({ title, content: prettyJson(payload) });
  }

  async function updateDecision(decision: RoomDecisionSummary, patch: UpdateRoomDecisionRequest) {
    const response = await fetch(`/api/rooms/${roomId}/decisions/${decision.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      notify(t("room.updateDecisionFailed"), "error");
      return;
    }
    const updated = await response.json() as RoomDecisionSummary;
    setDecisions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function updateHandoff(handoff: RoomHandoffSummary, patch: UpdateRoomHandoffRequest) {
    const response = await fetch(`/api/rooms/${roomId}/handoffs/${handoff.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      notify(t("room.updateHandoffFailed"), "error");
      return;
    }
    const updated = await response.json() as RoomHandoffSummary;
    setHandoffs((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  return (
    <section className="room-console">
        <div className="room-console-head">
          <div>
            <strong>{room?.name ?? t("room.title")}</strong>
            <span>{room?.status ?? "draft"} · {agents.length} {t("room.members")}</span>
          </div>
          <div className="room-console-actions">
            <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadRoom()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
          </div>
      </div>
      <div className="room-activity-summary">
        <strong>{t("room.activitySummary")}</strong>
        <span>{t("room.runningTasks")}: {roomStatusCounts.running}</span>
        <span>{t("room.waitingTasks")}: {roomStatusCounts.waiting}</span>
        <span>{t("room.doneTasks")}: {roomStatusCounts.done}</span>
        <span>{t("room.failedTasks")}: {roomStatusCounts.failed}</span>
        {roomActivity.length ? roomActivity.map((item) => <span key={item}>{item}</span>) : <span>{t("room.noActivity")}</span>}
        {roomStatusCounts.failed > 0 && <button className="ghost-button" type="button" onClick={() => void retryFailedRoomTasks()}>{t("room.retryFailedTasks")}</button>}
      </div>
      <Tabs className="room-tabs" defaultValue="overview">
        <TabsList className="settings-tabs" aria-label={t("room.title")}>
          <TabsTrigger className="settings-tab" value="overview">{t("room.overview")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="goal">{t("room.goalBoard")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="messages">{t("room.messages")} {roomMessageEvents.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="members">{t("room.members")} {agents.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="tasks">{t("room.tasks")} {tasks.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="schedules">{t("room.schedules")} {schedules.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="runs">{t("room.runs")} {runs.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="artifacts">{t("room.artifacts")} {roomBlackboardCount}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="events">{t("room.events")} {events.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="settings">{t("room.settings")}</TabsTrigger>
        </TabsList>
        <TabsContent className="room-overview" value="overview">
          <div className="room-grid">
            {agents.map((agent) => (
              <article className="room-card" key={agent.id}>
                <strong>{agent.name}</strong>
                <span>{t("room.runningTasks")}: {roomAgentLoad[agent.id]?.running ?? 0} · {t("room.waitingTasks")}: {roomAgentLoad[agent.id]?.waiting ?? 0}</span>
                <span>{t("room.latestRun")}: {roomAgentLoad[agent.id]?.latestRun?.status ?? "-"}</span>
              </article>
            ))}
          </div>
          <div className="room-activity-summary">
            <strong>{t("room.collaborationBrief")}</strong>
            <span>{t("room.latestDecision")}: {latestDecision ? `${latestDecision.title} · ${readableRoomDecisionStatus(latestDecision.status, t)}` : "-"}</span>
            <span>{t("room.latestHandoff")}: {latestHandoff ? `${latestHandoff.summary} · ${readableRoomHandoffStatus(latestHandoff.status, t)}` : "-"}</span>
          </div>
          <div className="room-directory-terms">
            <strong>{t("room.directoryTerms")}</strong>
            {roomParentDir && <span>{t("room.parentSessionDirectory")}: <code>{roomParentDir}</code> · {t("room.parentSessionDirectoryHelp")}</span>}
            {roomWorkspaceDir && <span>{t("room.roomWorkspaceDirectory")}: <code>{roomWorkspaceDir}</code> · {t("room.roomWorkspaceDirectoryHelp")}</span>}
            {roomWorkspaceDir && <span>{t("room.roomSharedDirectory")}: <code>{`${roomWorkspaceDir}/shared`}</code> · {t("room.roomSharedDirectoryHelp")}</span>}
            <span>{t("room.boundProjectDirectory")}: {projectWorkspacePath ? <code>{projectWorkspacePath}</code> : t("room.noBoundProject")} · {projectWorkspacePath ? t("room.boundProjectDirectoryHelp") : t("room.noBoundProjectHelp")}</span>
            {latestAgentWorkspaces.map(({ agent, run }) => (
              <span key={agent.id}>{t("room.agentWorkspaceDirectory")} · {agent.name}: <code>{run?.workspacePath}</code> · {t("room.agentWorkspaceDirectoryHelp")}</span>
            ))}
            {!latestAgentWorkspaces.length && <span>{t("room.agentWorkspacePending")}</span>}
          </div>
          <div className="room-list room-overview-timeline">
            {roomTimeline.map((item) => (
              <div className="room-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </div>
              </div>
            ))}
            {!roomTimeline.length && <div className="empty-state">{t("room.noActivity")}</div>}
          </div>
        </TabsContent>
        <TabsContent className="room-goal-board" value="goal">
          {room?.goal ? (
            <>
              <div className="room-goal-board-head">
                <div>
                  <strong>{room.goal.text}</strong>
                  <span>{readableGoalMode(room.goal.mode, t)} · {readableGoalStatus(room.goal.status, t)}</span>
                </div>
                <div className="room-goal-board-stats">
                  <span>{t("goal.items")}: {room.goal.progress.totalItems}</span>
                  <span>{t("goal.active")}: {room.goal.progress.activeItems}</span>
                  <span>{t("goal.completed")}: {room.goal.progress.completedItems}</span>
                  <span>{t("goal.blocked")}: {room.goal.progress.blockedItems}</span>
                </div>
              </div>
              {room.goal.currentFocus && (
                <div className="room-goal-focus">
                  <strong>{t("progress.currentFocus")}</strong>
                  <span>{room.goal.currentFocus.text}</span>
                </div>
              )}
              {roomGoalProposals.length > 0 && (
                <div className="room-goal-proposals">
                  <strong>{t("goal.proposals")}</strong>
                  {roomGoalProposals.slice(0, 4).map((proposal) => (
                    <span key={proposal.id}>{proposal.title} · {proposal.kind} · {formatShortDate(proposal.createdAt)}</span>
                  ))}
                </div>
              )}
              <div className="room-goal-columns">
                {roomGoalColumns.map((column) => (
                  <section className="room-goal-column" key={column.id}>
                    <strong>{column.label}</strong>
                    {column.items.map((item) => {
                      const linkedTask = tasks.find((task) => task.goalItemId === item.id || task.id === item.roomTaskId);
                      return (
                        <article className="room-goal-card" key={item.id}>
                          <strong>{item.title}</strong>
                          <span>{item.assignedAgentId ? agents.find((agent) => agent.id === item.assignedAgentId)?.name ?? item.assignedAgentId : t("room.unassigned")}</span>
                          {linkedTask && <span>{t("room.tasks")}: {linkedTask.status}</span>}
                          {item.description && <code>{item.description}</code>}
                        </article>
                      );
                    })}
                    {!column.items.length && <div className="empty-state">{t("room.noTasks")}</div>}
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">{t("progress.noProgress")}</div>
          )}
        </TabsContent>
        <TabsContent className="room-list" value="messages">
          {roomMessageEvents.map((event) => {
            const payload = event.payload as { content?: string; mentionedAgentIds?: string[]; mentionsUser?: boolean; taskId?: string };
            return (
              <div className="room-row" key={event.id}>
                <div>
                  <strong>{event.type === "user.message" ? t("room.userMessage") : t("room.agentMentioned")}</strong>
                  <span>{renderMentionContent(payload.content)}</span>
                  <span>{formatShortDate(event.createdAt)}{payload.mentionsUser ? ` · @user` : ""}</span>
                </div>
              </div>
            );
          })}
          {eventHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomEvents()}>{t("session.loadMore")}</button>}
          {!roomMessageEvents.length && <div className="empty-state">{t("room.noMessages")}</div>}
        </TabsContent>
        <TabsContent className="room-list" value="members">
          <form className="room-mini-form room-member-add-form" onSubmit={addRoomAgent}>
            <strong>{t("room.addMember")}</strong>
            <select name="newroomagentid" value={newRoomAgentId} onChange={(event) => setNewRoomAgentId(event.target.value)} disabled={!availableRoomAgents.length}>
              <option value="">{availableRoomAgents.length ? t("contacts.selectRole") : t("room.noAvailableMembers")}</option>
              {availableRoomAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select name="newroomagentlistenmode" value={newRoomAgentListenMode} onChange={(event) => setNewRoomAgentListenMode(event.target.value as AgentListenMode)}>
              {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
            </select>
            <Button type="submit" disabled={!newRoomAgentId}>{t("action.create")}</Button>
          </form>
          <div className="room-grid">
          {agents.map((agent) => (
            <article className="room-card" key={agent.id}>
              <strong>{agent.name}</strong>
              <span>{agent.workspaceMode}</span>
              <code>{agent.model ?? t("session.noModel")}</code>
              <label className="room-member-mode">
                <span>{t("contacts.listenMode")}</span>
                <select name={`roomagent-${agent.id}-listenmode`} value={agent.listenMode} onChange={(event) => void updateRoomAgentListenMode(agent.id, event.target.value as AgentListenMode)}>
                  {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                </select>
              </label>
              <span>{t("room.runningTasks")}: {roomAgentLoad[agent.id]?.running ?? 0} · {t("room.waitingTasks")}: {roomAgentLoad[agent.id]?.waiting ?? 0}</span>
              {roomAgentLoad[agent.id]?.latestRun && <span>{t("room.latestRun")}: {roomAgentLoad[agent.id]?.latestRun?.status}</span>}
            </article>
          ))}
          </div>
          {!agents.length && <div className="empty-state">{t("contacts.noAgents")}</div>}
        </TabsContent>
        <TabsContent className="room-split" value="tasks">
          <form className="room-mini-form" onSubmit={createTask}>
            <input name="tasktitle" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder={t("room.taskTitle")} required />
            <select name="taskagentid" value={taskAgentId} onChange={(event) => setTaskAgentId(event.target.value)}>
              <option value="">{t("room.unassigned")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <textarea name="taskprompt" value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder={t("room.taskPrompt")} required />
            <Button>{t("room.assignTask")}</Button>
          </form>
          <div className="room-list">
            {tasks.map((task) => {
              const run = runs.find((item) => item.taskId === task.id);
              const canStart = Boolean(task.assignedAgentId) && (task.status === "queued" || task.status === "assigned" || task.status === "failed" || task.status === "cancelled");
              return (
                <div className="room-row" key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.status} · {agents.find((agent) => agent.id === task.assignedAgentId)?.name ?? t("room.unassigned")}</span>
                  </div>
                  <div className="row-actions">
                    {run?.sessionId && <button className="ghost-button icon-only" type="button" title={t("room.openSession")} aria-label={t("room.openSession")} onClick={() => run.sessionId && onOpenSession(run.sessionId)}><IconText icon={PanelLeftOpen}>{t("room.openSession")}</IconText></button>}
                    <select name="task-assignedagentid" value={task.assignedAgentId ?? ""} disabled={task.status === "running"} onChange={(event) => void updateRoomTask(task, { assignedAgentId: event.target.value || null })}>
                      <option value="">{t("room.unassigned")}</option>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                    <select name="task-dependsontaskid" value={task.dependsOnTaskId ?? ""} disabled={task.status === "running"} onChange={(event) => void updateRoomTask(task, { dependsOnTaskId: event.target.value || null })}>
                      <option value="">{t("room.noDependency")}</option>
                      {tasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                    </select>
                    <input name="task-priority" className="priority-input" type="number" value={task.priority} disabled={task.status === "running"} onChange={(event) => void updateRoomTask(task, { priority: Number(event.target.value) })} />
                    <button className="ghost-button icon-only" type="button" title={t("room.startTask")} aria-label={t("room.startTask")} disabled={!canStart || startingTaskId === task.id} onClick={() => void startTask(task)}><IconText icon={Play}>{t("room.startTask")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("room.retryTask")} aria-label={t("room.retryTask")} disabled={task.status === "running"} onClick={() => void retryRoomTask(task)}><IconText icon={RotateCcw}>{t("room.retryTask")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("room.cancelTask")} aria-label={t("room.cancelTask")} disabled={task.status === "done" || task.status === "cancelled"} onClick={() => void cancelRoomTask(task)}><IconText icon={Pause}>{t("room.cancelTask")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} disabled={task.status === "running"} onClick={() => void deleteRoomTask(task)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                  </div>
                </div>
              );
            })}
            {!tasks.length && <div className="empty-state">{t("room.noTasks")}</div>}
            {roomListPages.tasks.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("tasks")}>{t("session.loadMore")}</button>}
          </div>
        </TabsContent>
        <TabsContent className="room-split" value="schedules">
          <form className="room-mini-form" onSubmit={createSchedule}>
            <select name="scheduleagentid" value={scheduleAgentId} onChange={(event) => setScheduleAgentId(event.target.value)} required>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <input name="schedulerunat" value={scheduleRunAt} onChange={(event) => setScheduleRunAt(event.target.value)} placeholder={t("room.runAtPlaceholder")} />
            <textarea name="scheduleprompt" value={schedulePrompt} onChange={(event) => setSchedulePrompt(event.target.value)} placeholder={t("room.taskPrompt")} required />
            <Button>{t("room.scheduleTask")}</Button>
          </form>
          <div className="room-list">
            {schedules.map((schedule) => (
              <div className="room-row" key={schedule.id}>
                <div>
                  <strong>{agents.find((agent) => agent.id === schedule.agentId)?.name ?? schedule.agentId}</strong>
                  <span>{schedule.status} · {schedule.scheduleType} · {schedule.runAt ?? "-"}</span>
                </div>
                <button className="ghost-button danger-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteRoomSchedule(schedule)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
              </div>
            ))}
            {!schedules.length && <div className="empty-state">{t("room.noSchedules")}</div>}
            {roomListPages.schedules.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("schedules")}>{t("session.loadMore")}</button>}
          </div>
        </TabsContent>
        <TabsContent className="room-list" value="runs">
          {runs.map((run) => (
            <div className="room-row" key={run.id}>
              <div>
                <strong>{agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}</strong>
                <span>{run.status} · exit {run.exitCode ?? "null"} · merge {run.mergeStatus ?? "none"}</span>
                {run.workspacePath && <code>{run.workspacePath}</code>}
                {run.mergeSummary && <span>{run.mergeSummary}</span>}
              </div>
              <div className="row-actions">
                <button className="ghost-button icon-only" type="button" title={t("workspace.changes")} aria-label={t("workspace.changes")} onClick={() => void openRunDiff(run)}><IconText icon={FolderGit2}>{t("workspace.changes")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("room.mergeRun")} aria-label={t("room.mergeRun")} disabled={run.mergeStatus !== "pending"} onClick={() => void mergeRun(run)}><IconText icon={GitPullRequest}>{t("room.mergeRun")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("room.rejectRun")} aria-label={t("room.rejectRun")} disabled={run.mergeStatus !== "pending" && run.mergeStatus !== "conflict"} onClick={() => void rejectRun(run)}><IconText icon={X}>{t("room.rejectRun")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("room.openSession")} aria-label={t("room.openSession")} disabled={!run.sessionId} onClick={() => run.sessionId && onOpenSession(run.sessionId)}><IconText icon={PanelLeftOpen}>{t("room.openSession")}</IconText></button>
              </div>
            </div>
          ))}
          {!runs.length && <div className="empty-state">{t("room.noRuns")}</div>}
          {roomListPages.runs.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("runs")}>{t("session.loadMore")}</button>}
        </TabsContent>
        <TabsContent className="room-list" value="artifacts">
          <form className="room-mini-form" onSubmit={createArtifact}>
            <input name="artifacttitle" value={artifactTitle} onChange={(event) => setArtifactTitle(event.target.value)} placeholder={t("room.artifactTitle")} required />
            <select name="artifactkind" value={artifactKind} onChange={(event) => setArtifactKind(event.target.value as RoomArtifactSummary["kind"])}>
              {roomArtifactKinds.map((kind) => <option key={kind} value={kind}>{readableRoomArtifactKind(kind, t)}</option>)}
            </select>
            <textarea name="artifactpayload" value={artifactPayload} onChange={(event) => setArtifactPayload(event.target.value)} placeholder={t("room.artifactPayload")} />
            <Button>{t("room.createArtifact")}</Button>
          </form>
          <form className="room-mini-form" onSubmit={createDecision}>
            <input name="decisiontitle" value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} placeholder={t("room.decisionTitle")} required />
            <Button>{t("room.createDecision")}</Button>
          </form>
          <form className="room-mini-form" onSubmit={createHandoff}>
            <select name="handofffromagentid" value={handoffFromAgentId} onChange={(event) => setHandoffFromAgentId(event.target.value)}>
              <option value="">{t("room.system")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select name="handofftoagentid" value={handoffToAgentId} onChange={(event) => setHandoffToAgentId(event.target.value)}>
              <option value="">{t("room.system")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <textarea name="handoffsummary" value={handoffSummary} onChange={(event) => setHandoffSummary(event.target.value)} placeholder={t("room.handoffSummary")} required />
            <Button>{t("room.createHandoff")}</Button>
          </form>
          <div className="room-section-label"><strong>{t("room.artifacts")}</strong><span>{artifacts.length}</span></div>
          {artifacts.map((artifact) => (
            <div className="room-row" key={artifact.id}>
              <div>
                <strong>{artifact.title}</strong>
                <span>{readableRoomArtifactKind(artifact.kind, t)} · {agents.find((agent) => agent.id === artifact.agentId)?.name ?? t("room.system")}</span>
              </div>
              <div className="row-actions">
                <button className="ghost-button icon-only" type="button" title={t("room.artifactDetails")} aria-label={t("room.artifactDetails")} onClick={() => openRoomDetails(artifact.title, artifact.payload)}><IconText icon={Info}>{t("room.artifactDetails")}</IconText></button>
              </div>
            </div>
          ))}
          {roomListPages.artifacts.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("artifacts")}>{t("session.loadMore")}</button>}
          <div className="room-section-label"><strong>{t("room.decision")}</strong><span>{decisions.length}</span></div>
          {decisions.map((decision) => (
            <div className="room-row" key={decision.id}>
              <div>
                <strong>{decision.title}</strong>
                <span>{t("room.decision")} · {readableRoomDecisionStatus(decision.status, t)} · {formatShortDate(decision.createdAt)}</span>
              </div>
              <div className="row-actions room-state-actions">
                <select value={decision.status} aria-label={t("room.updateDecisionStatus")} onChange={(event) => void updateDecision(decision, { status: event.target.value as RoomDecisionSummary["status"] })}>
                  <option value="open">{t("room.decisionStatusOpen")}</option>
                  <option value="approved">{t("room.decisionStatusApproved")}</option>
                  <option value="rejected">{t("room.decisionStatusRejected")}</option>
                  <option value="resolved">{t("room.decisionStatusResolved")}</option>
                </select>
                <button className="ghost-button icon-only" type="button" title={t("room.decisionDetails")} aria-label={t("room.decisionDetails")} onClick={() => openRoomDetails(decision.title, decision.payload)}><IconText icon={Info}>{t("room.decisionDetails")}</IconText></button>
              </div>
            </div>
          ))}
          {roomListPages.decisions.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("decisions")}>{t("session.loadMore")}</button>}
          <div className="room-section-label"><strong>{t("room.handoff")}</strong><span>{handoffs.length}</span></div>
          {handoffs.map((handoff) => (
            <div className="room-row" key={handoff.id}>
              <div>
                <strong>{handoff.summary}</strong>
                <span>{agents.find((agent) => agent.id === handoff.fromAgentId)?.name ?? t("room.system")} → {agents.find((agent) => agent.id === handoff.toAgentId)?.name ?? t("room.system")}</span>
                <span>{t("room.handoff")} · {readableRoomHandoffStatus(handoff.status, t)} · {formatShortDate(handoff.createdAt)}</span>
              </div>
              <div className="row-actions room-state-actions">
                <select value={handoff.status} aria-label={t("room.updateHandoffStatus")} onChange={(event) => void updateHandoff(handoff, { status: event.target.value as RoomHandoffSummary["status"] })}>
                  <option value="open">{t("room.handoffStatusOpen")}</option>
                  <option value="accepted">{t("room.handoffStatusAccepted")}</option>
                  <option value="returned">{t("room.handoffStatusReturned")}</option>
                  <option value="resolved">{t("room.handoffStatusResolved")}</option>
                  <option value="cancelled">{t("room.handoffStatusCancelled")}</option>
                </select>
                <button className="ghost-button icon-only" type="button" title={t("room.handoffDetails")} aria-label={t("room.handoffDetails")} onClick={() => openRoomDetails(handoff.summary, handoff.payload)}><IconText icon={Info}>{t("room.handoffDetails")}</IconText></button>
              </div>
            </div>
          ))}
          {roomListPages.handoffs.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("handoffs")}>{t("session.loadMore")}</button>}
          {!artifacts.length && !decisions.length && !handoffs.length && <div className="empty-state">{t("room.noArtifacts")}</div>}
        </TabsContent>
        <TabsContent className="room-list" value="events">
          {events.map((event) => <div className="room-row" key={event.id}><div><strong>{event.type}</strong><span>{formatShortDate(event.createdAt)}</span><pre className="approval-details">{prettyJson(event.payload)}</pre></div></div>)}
          {eventHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomEvents()}>{t("session.loadMore")}</button>}
          {!events.length && <div className="empty-state">{t("room.noEvents")}</div>}
        </TabsContent>
        <TabsContent className="room-list" value="settings">
          {room && (
            <div className="room-settings-grid">
              <label className="room-setting-row">
                <span>{t("room.autoStartTasks")}</span>
                <input name="room-orchestration-autostarttasks" type="checkbox" checked={room.orchestration.autoStartTasks} onChange={(event) => void updateRoomSettings({ autoStartTasks: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.autoCreateReviewTasks")}</span>
                <input name="room-orchestration-autocreatereviewtasks" type="checkbox" checked={room.orchestration.autoCreateReviewTasks} onChange={(event) => void updateRoomSettings({ autoCreateReviewTasks: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.autoListenAfterAgentEvents")}</span>
                <input name="room-orchestration-autolistenafteragentevents" type="checkbox" checked={room.orchestration.autoListenAfterAgentEvents} onChange={(event) => void updateRoomSettings({ autoListenAfterAgentEvents: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.notifyUserOnFailure")}</span>
                <input name="room-orchestration-notifyuseronfailure" type="checkbox" checked={room.orchestration.notifyUserOnFailure} onChange={(event) => void updateRoomSettings({ notifyUserOnFailure: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.maxAutoRetries")}</span>
                <Input name="room-orchestration-maxautoretries" className="room-setting-number" type="number" min={0} max={10} value={room.orchestration.maxAutoRetries} onChange={(event) => void updateRoomSettings({ maxAutoRetries: Number(event.target.value) })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.maxAutoListenChainDepth")}</span>
                <Input name="room-orchestration-maxautolistenchaindepth" className="room-setting-number" type="number" min={0} max={10} value={room.orchestration.maxAutoListenChainDepth} onChange={(event) => void updateRoomSettings({ maxAutoListenChainDepth: Number(event.target.value) })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.maxAutoListenTasksPerEvent")}</span>
                <Input name="room-orchestration-maxautolistentasks" className="room-setting-number" type="number" min={1} max={20} value={room.orchestration.maxAutoListenTasksPerEvent} onChange={(event) => void updateRoomSettings({ maxAutoListenTasksPerEvent: Number(event.target.value) })} />
              </label>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {runDiffPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("workspace.changes")}</strong>
              <span>{runDiffPanel.workspacePath}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setRunDiffPanel(null)}>{t("action.close")}</button>
          </div>
          <pre className="task-log-viewer">{[runDiffPanel.status, runDiffPanel.stat, runDiffPanel.diff || runDiffPanel.error].filter(Boolean).join("\n\n") || t("workspace.noPatch")}</pre>
        </div>
      )}
      {roomDetailPreview && (
        <div className="dialog-layer" role="dialog" aria-modal="true">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setRoomDetailPreview(null)} />
          <div className="dialog-card room-detail-dialog">
            <div className="dialog-head">
              <div>
                <strong>{roomDetailPreview.title}</strong>
                <span>{t("room.details")}</span>
              </div>
              <button className="drawer-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setRoomDetailPreview(null)}>
                <X size={16} />
              </button>
            </div>
            <pre className="approval-details room-detail-json">{roomDetailPreview.content}</pre>
          </div>
        </div>
      )}
    </section>
  );
}

function LanguageSelect({
  locale,
  onChange,
  compact = false,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  compact?: boolean;
}) {
  return (
    <select name="locale"
      className={compact ? "language-select compact" : "language-select"}
      value={locale}
      title={translate(locale, "common.language")}
      onChange={(event) => onChange(event.target.value as Locale)}
    >
      {(Object.keys(localeLabels) as Locale[]).map((item) => (
        <option key={item} value={item}>{compact ? item.slice(0, 2).toUpperCase() : localeLabels[item]}</option>
      ))}
    </select>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the textarea fallback for browsers that block clipboard access.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function Bubble({
  who,
  text,
  user = false,
  t,
  replyTo,
  onReply,
}: {
  who: string;
  text: string;
  user?: boolean;
  t?: TFunction;
  replyTo?: SessionMessage["replyTo"];
  onReply?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className={`bubble ${user ? "user" : "assistant"}`}>
      <div className="avatar" title={who}>{who}</div>
      <div className="bubble-body">
        <div className="bubble-sender" title={who}>{who}</div>
        <div className="bubble-toolbar">
          <button className="copy-message" type="button" onClick={() => void handleCopy()} title={copied ? t?.("action.copied") ?? "Copied" : t?.("session.copyMessageContent") ?? "Copy message content"} aria-label={copied ? t?.("action.copied") ?? "Copied" : t?.("session.copyMessageContent") ?? "Copy message content"}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {onReply && (
            <button className="copy-message" type="button" onClick={onReply} title={t?.("session.reply") ?? "Reply"} aria-label={t?.("session.reply") ?? "Reply"}>
              <MessageSquare size={13} />
            </button>
          )}
        </div>
        {replyTo && <div className="bubble-reply">{replyTo.role}: {replyTo.content}</div>}
        <div className="bubble-text">{text}</div>
      </div>
    </article>
  );
}

function MessageCards({ items, sessionToken, t, notify, onDelete }: { items: MessageCardSummary[]; sessionToken: string; t: TFunction; notify: (message: string, tone?: ToastTone) => void; onDelete: (cardId: string) => void }) {
  const [openPayloadId, setOpenPayloadId] = useState<string | null>(null);
  return (
    <section className="message-cards">
      {items.map((item) => {
        const preview = item.type === "preview" ? item.payload as PreviewSummary : null;
        const payload = (item.payload && typeof item.payload === "object" ? item.payload : {}) as Record<string, unknown>;
        const hasPayload = Object.keys(payload).length > 0;
        const payloadOpen = openPayloadId === item.id;
        const detail = preview
          ? `${preview.status} · ${preview.access} · ${preview.port}`
          : [item.type, payload.status, payload.risk, payload.reason].filter(Boolean).join(" · ");
        const href = preview?.url || (typeof payload.url === "string" ? payload.url : null);
        return (
          <article className="message-card" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>{detail}</span>
              {hasPayload && payloadOpen && <code className="message-card-json">{JSON.stringify(payload, null, 2)}</code>}
            </div>
            <div className="message-card-actions">
              {preview ? (
                <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, notify, t)}>
                  <IconText icon={Globe}>{t("project.preview")}</IconText>
                </button>
              ) : href && (
                <a className="ghost-button" href={href} target="_blank" rel="noreferrer">
                  <IconText icon={Globe}>{t("action.open")}</IconText>
                </a>
              )}
              {hasPayload && (
                <button className="ghost-button icon-only" type="button" onClick={() => setOpenPayloadId((current) => current === item.id ? null : item.id)} title={t("action.details")} aria-label={t("action.details")}>
                  <Info size={16} />
                </button>
              )}
              <button className="ghost-button icon-only danger-button" type="button" onClick={() => onDelete(item.id)} title={t("action.delete")} aria-label={t("action.delete")}>
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ContextPanel({
  sessionToken,
  session,
  taskDetail,
  queuedMessages = [],
  onUpdateQueuedMessage,
  onReorderQueuedMessages,
  onDeleteQueuedMessage,
  t,
  onOpenFile,
  initialPanel = "progress",
  modal = false,
}: {
  sessionToken: string;
  session?: SessionSummary;
  taskDetail?: CodexTaskDetail;
  queuedMessages?: QueuedMessage[];
  onUpdateQueuedMessage?: (sessionId: string, queueId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null) => Promise<void>;
  onReorderQueuedMessages?: (sessionId: string, orderedIds: string[]) => Promise<void>;
  onDeleteQueuedMessage?: (sessionId: string, queueId: string) => Promise<void>;
  t: TFunction;
  onOpenFile: (path: string) => void;
  initialPanel?: "progress" | "changes" | "activity";
  modal?: boolean;
}) {
  const dialog = useAppDialog(t);
  const [activePanel, setActivePanel] = useState<"progress" | "changes" | "activity">(initialPanel);
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
  const [goalDetail, setGoalDetail] = useState<GoalDetailResponse | null>(null);
  const [previews, setPreviews] = useState<PreviewSummary[]>([]);
  const [browserCards, setBrowserCards] = useState<MessageCardSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [message, setMessage] = useState("");
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [contextDraggedQueueId, setContextDraggedQueueId] = useState<string | null>(null);
  const activityRefreshTimerRef = useRef<number | null>(null);
  const changesRefreshTimerRef = useRef<number | null>(null);
  const selectedFile = changes?.files.find((item) => item.path === selectedPath) ?? changes?.files[0] ?? null;
  const goal = goalDetail?.goal ?? session?.goal ?? null;
  const goalItems = goalDetail?.items ?? [];
  const latestActivity = activityItems[0] ?? null;
  const previewIds = new Set(previews.map((preview) => preview.id));
  const browserRows = [
    ...previews.map((preview) => ({
      id: `preview:${preview.id}`,
      label: preview.label,
      detail: `${t("project.preview")} · ${preview.status}`,
      href: preview.url,
      cardId: null as string | null,
    })),
    ...browserCards.flatMap((card) => {
      const payload = (card.payload && typeof card.payload === "object" ? card.payload : {}) as Record<string, unknown>;
      const previewId = typeof payload.previewId === "string" ? payload.previewId : null;
      if (previewId && previewIds.has(previewId)) return [];
      const href = typeof payload.url === "string" ? payload.url : null;
      if (!href) return [];
      return [{
        id: card.id,
        label: card.title || href,
        detail: card.type,
        href,
        cardId: card.id,
      }];
    }),
  ].slice(0, 6);
  const progressSteps = [
    ...(goal ? [{ id: goal.id, label: goal.text, meta: `${readableGoalMode(goal.mode, t)} · ${readableGoalStatus(goal.status, t)}`, done: goal.status === "completed" }] : []),
    ...(goal?.currentFocus ? [{ id: goal.currentFocus.id, label: goal.currentFocus.text, meta: t("progress.currentFocus"), done: goal.currentFocus.status === "completed" }] : []),
    ...goalItems.slice(0, 5).map((item) => ({
      id: item.id,
      label: item.title,
      meta: [item.status, item.assignedAgentId].filter(Boolean).join(" · "),
      done: item.status === "completed",
    })),
    ...activityItems.slice(0, Math.max(0, goalItems.length ? 3 : 6)).map((item) => ({
      id: item.id ?? `${item.kind}-${item.at}`,
      label: item.label,
      meta: readableActivityStatus(item.status, item.kind, t),
      done: item.status === "completed",
    })),
  ].slice(0, 8);

  useEffect(() => {
    setActivePanel(initialPanel);
  }, [initialPanel]);

  const loadChanges = useCallback(async () => {
    if (!session?.id) {
      setChanges(null);
      return;
    }
    const response = await fetch(`/api/codex/tasks/${session.id}/changes`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextChanges = (await response.json()) as WorkspaceChanges;
    setChanges(nextChanges);
    setSelectedPath((current) => current && nextChanges.files.some((item) => item.path === current) ? current : nextChanges.files[0]?.path ?? "");
  }, [session?.id, sessionToken]);

  const scheduleLoadChanges = useCallback(() => {
    if (changesRefreshTimerRef.current !== null) window.clearTimeout(changesRefreshTimerRef.current);
    changesRefreshTimerRef.current = window.setTimeout(() => {
      changesRefreshTimerRef.current = null;
      void loadChanges();
    }, 900);
  }, [loadChanges]);

  const loadGoalDetail = useCallback(async () => {
    if (!session?.goal?.id) {
      setGoalDetail(null);
      return;
    }
    const response = await fetch(`/api/goals/${session.goal.id}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setGoalDetail((await response.json()) as GoalDetailResponse);
  }, [session?.goal?.id, sessionToken]);

  const loadPreviews = useCallback(async () => {
    if (!session?.id) {
      setPreviews([]);
      return;
    }
    const params = new URLSearchParams({ scopeType: "session", scopeId: session.id });
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setPreviews((await response.json()) as PreviewSummary[]);
  }, [session?.id, sessionToken]);

  const loadBrowserCards = useCallback(async () => {
    if (!session?.id) {
      setBrowserCards([]);
      return;
    }
    const response = await fetch(`/api/sessions/${session.id}/cards`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setBrowserCards((await response.json()) as MessageCardSummary[]);
  }, [session?.id, sessionToken]);

  const loadActivity = useCallback(async (older = false) => {
    if (!session?.id) {
      setActivityItems([]);
      setActivityCursor(null);
      setActivityHasMore(false);
      return;
    }
    const params = new URLSearchParams({ limit: "20" });
    if (older && activityCursor) params.set("cursor", activityCursor);
    const response = await fetch(`/api/codex/tasks/${session.id}/activity?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskActivityResponse;
    const items = result.items.map(activityFromSummary);
    setActivityItems((current) => older ? [...current, ...items] : items);
    setActivityCursor(result.nextCursor);
    setActivityHasMore(result.hasMore);
  }, [activityCursor, session?.id, sessionToken]);

  const scheduleLoadActivity = useCallback(() => {
    if (activityRefreshTimerRef.current !== null) window.clearTimeout(activityRefreshTimerRef.current);
    activityRefreshTimerRef.current = window.setTimeout(() => {
      activityRefreshTimerRef.current = null;
      void loadActivity();
    }, 350);
  }, [loadActivity]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  useEffect(() => {
    void loadGoalDetail();
  }, [loadGoalDetail]);

  useEffect(() => {
    void loadPreviews();
  }, [loadPreviews]);

  useEffect(() => {
    void loadBrowserCards();
  }, [loadBrowserCards]);

  useEffect(() => {
    setActivityItems([]);
    setActivityCursor(null);
    setActivityHasMore(false);
    if (activePanel === "activity" || activePanel === "progress") void loadActivity();
    if (activePanel === "progress") void Promise.all([loadPreviews(), loadBrowserCards()]);
  }, [activePanel, loadBrowserCards, loadPreviews, session?.id, sessionToken]);

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!session?.id || detail?.sessionId !== session.id) return;
      scheduleLoadChanges();
    }
    window.addEventListener(workspaceChangedEvent, handleWorkspaceChanged);
    return () => {
      window.removeEventListener(workspaceChangedEvent, handleWorkspaceChanged);
      if (changesRefreshTimerRef.current !== null) {
        window.clearTimeout(changesRefreshTimerRef.current);
        changesRefreshTimerRef.current = null;
      }
    };
  }, [scheduleLoadChanges, session?.id]);

  useEffect(() => {
    function handleTaskActivityChanged(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!session?.id || detail?.sessionId !== session.id) return;
      if (activePanel !== "activity" && activePanel !== "progress") return;
      scheduleLoadActivity();
      if (activePanel === "progress") void loadBrowserCards();
    }
    window.addEventListener(taskActivityChangedEvent, handleTaskActivityChanged);
    return () => {
      window.removeEventListener(taskActivityChangedEvent, handleTaskActivityChanged);
      if (activityRefreshTimerRef.current !== null) {
        window.clearTimeout(activityRefreshTimerRef.current);
        activityRefreshTimerRef.current = null;
      }
    };
  }, [activePanel, loadBrowserCards, scheduleLoadActivity, session?.id]);

  async function copyPatch(file?: WorkspaceChangeFile | null) {
    const value = file ? file.patch || file.newContent || "" : changes?.raw.diff ?? "";
    if (!value) return;
    await copyText(value);
    setMessage(t("workspace.copyDiff"));
    window.setTimeout(() => setMessage(""), 1200);
  }

  async function revertFile(file: WorkspaceChangeFile) {
    if (!session?.id) return;
    const confirmed = await dialog.confirm({
      title: t("workspace.revertTitle"),
      message: file.path,
      confirmLabel: t("workspace.revert"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/changes/revert-file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: file.sourcePath ?? file.path, cwd: file.sourceCwd }),
    });
    if (!response.ok) {
      setMessage(t("workspace.revertFailed"));
      return;
    }
    setChanges((await response.json()) as WorkspaceChanges);
    setMessage(t("workspace.reverted"));
    window.setTimeout(() => setMessage(""), 1200);
  }

  async function gitFileAction(file: WorkspaceChangeFile, action: "stage" | "unstage") {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/changes/${action}-file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: file.sourcePath ?? file.path, cwd: file.sourceCwd }),
    });
    if (!response.ok) {
      setMessage(action === "stage" ? t("workspace.stageFailed") : t("workspace.unstageFailed"));
      return;
    }
    setChanges((await response.json()) as WorkspaceChanges);
    setMessage(action === "stage" ? t("workspace.staged") : t("workspace.unstaged"));
    window.setTimeout(() => setMessage(""), 1200);
  }

  function openSessionGoalSettings() {
    if (!session?.id) return;
    window.dispatchEvent(new CustomEvent(sessionInfoRequestedEvent, { detail: { sessionId: session.id, expandGoal: true } }));
  }

  function reorderContextQueue(dragId: string | null, dropId: string) {
    if (!session?.id || !onReorderQueuedMessages || !dragId || dragId === dropId) return;
    const dragIndex = queuedMessages.findIndex((item) => item.id === dragId);
    const dropIndex = queuedMessages.findIndex((item) => item.id === dropId);
    if (dragIndex < 0 || dropIndex < 0) return;
    const nextQueue = [...queuedMessages];
    const [moved] = nextQueue.splice(dragIndex, 1);
    nextQueue.splice(dropIndex, 0, moved);
    setContextDraggedQueueId(null);
    void onReorderQueuedMessages(session.id, nextQueue.map((item) => item.id));
  }

  async function dismissBrowserCard(cardId: string | null) {
    if (!session?.id || !cardId) return;
    const response = await fetch(`/api/sessions/${session.id}/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadBrowserCards();
  }

  return (
    <aside className={`context-panel ${modal ? "mobile-context-panel" : ""}`}>
      {dialog.node}
      <header className="context-header">
        <div className="context-tabs" role="tablist" aria-label={t("session.infoTitle")}>
          <button className="context-tab" type="button" role="tab" aria-selected={activePanel === "progress"} data-state={activePanel === "progress" ? "active" : "inactive"} onClick={() => setActivePanel("progress")} title={t("progress.title")}>
            <IconText icon={Check}>{t("progress.title")}</IconText>
          </button>
          <button className="context-tab" type="button" role="tab" aria-selected={activePanel === "changes"} data-state={activePanel === "changes" ? "active" : "inactive"} onClick={() => setActivePanel("changes")} title={t("workspace.changes")}>
            <IconText icon={FolderGit2}>{t("workspace.changes")}</IconText>
          </button>
          <button className="context-tab" type="button" role="tab" aria-selected={activePanel === "activity"} data-state={activePanel === "activity" ? "active" : "inactive"} onClick={() => setActivePanel("activity")} title={t("session.activityTitle")}>
            <IconText icon={Activity}>{t("session.activityTitle")}</IconText>
          </button>
        </div>
        <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => activePanel === "changes" ? void loadChanges() : activePanel === "progress" ? void Promise.all([loadActivity(), loadGoalDetail(), loadPreviews(), loadBrowserCards()]) : void loadActivity()} disabled={!session}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
      </header>
      <section className={`panel progress-panel ${activePanel === "progress" ? "active" : ""}`}>
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("progress.title")}</strong>
            <button className="ghost-button compact-action" type="button" disabled={!session} onClick={openSessionGoalSettings}>
              {goal ? t("goal.update") : t("goal.create")}
            </button>
          </div>
          <div className="progress-step-list">
            {progressSteps.map((step) => (
              <div className="progress-step" key={step.id}>
                <span className={`progress-check ${step.done ? "done" : ""}`}><Check size={12} /></span>
                <div>
                  <strong>{step.label}</strong>
                  {step.meta && <span>{step.meta}</span>}
                </div>
              </div>
            ))}
            {!progressSteps.length && <div className="empty-state">{session ? t("progress.noProgress") : t("workspace.noSession")}</div>}
          </div>
        </div>
        <div className="progress-divider" />
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("progress.execution")}</strong>
            <Activity size={15} />
          </div>
          <div className="progress-meta-list">
            <div className="progress-meta-row"><Clock3 size={15} /><span>{t("session.infoStatus")}</span><strong>{readableStatus(session?.status, t)}</strong></div>
            <div className="progress-meta-row"><Activity size={15} /><span>{t("progress.latestActivity")}</span><strong>{latestActivity ? readableActivityStatus(latestActivity.status, latestActivity.kind, t) : "-"}</strong></div>
            {latestActivity && <div className="progress-meta-row wide"><Info size={15} /><span>{latestActivity.label}</span><strong>{formatShortDate(latestActivity.at)}</strong></div>}
            {taskDetail?.exitCode !== undefined && taskDetail.exitCode !== null && <div className="progress-meta-row"><TerminalIcon size={15} /><span>{t("project.exitCode")}</span><strong>{taskDetail.exitCode}</strong></div>}
          </div>
        </div>
        <div className="progress-divider" />
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("session.queueTitle")}</strong>
            <span>{queuedMessages.length} {t("session.queueUnit")}</span>
          </div>
          <div className="context-queue-list">
            {queuedMessages.slice(0, 6).map((item, index) => (
              <QueuedMessageRow
                key={item.id}
                item={item}
                index={index}
                dragging={contextDraggedQueueId === item.id}
                onDragStart={() => setContextDraggedQueueId(item.id)}
                onDragEnd={() => setContextDraggedQueueId(null)}
                onDropOn={() => reorderContextQueue(contextDraggedQueueId, item.id)}
                onSave={(nextPrompt) => session && onUpdateQueuedMessage
                  ? onUpdateQueuedMessage(session.id, item.id, nextPrompt, item.providerId ?? session.providerId ?? null, item.model ?? session.model ?? null, item.replyToMessageId ?? null)
                  : Promise.resolve()}
                onDelete={() => session && onDeleteQueuedMessage ? onDeleteQueuedMessage(session.id, item.id) : Promise.resolve()}
                t={t}
              />
            ))}
            {!queuedMessages.length && <div className="empty-state">{t("progress.noQueuedInput")}</div>}
          </div>
        </div>
        <div className="progress-divider" />
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("progress.browser")}</strong>
            <Globe size={15} />
          </div>
          <div className="progress-meta-list">
            {browserRows.map((row) => (
              <div className="progress-browser-row" key={row.id}>
                <a className="progress-meta-row progress-link-row" href={row.href} target="_blank" rel="noreferrer">
                  <Globe size={15} />
                  <span>{row.label}</span>
                  <strong>{row.detail}</strong>
                </a>
                <button className="ghost-button icon-only" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyText(row.href)}><IconText icon={Copy}>{t("action.copy")}</IconText></button>
                {row.cardId && <button className="ghost-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void dismissBrowserCard(row.cardId)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>}
              </div>
            ))}
            {!browserRows.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      </section>
      <section className={`panel ${activePanel === "changes" ? "active" : ""}`}>
        <div className="diff-summary">
          <strong>{changes ? `${changes.summary.filesChanged} ${t("workspace.filesChanged")}` : t("workspace.noSession")}</strong>
          <span className="pill warm">+{changes?.summary.additions ?? 0} -{changes?.summary.deletions ?? 0}</span>
        </div>
        {message && <div className="subtle">{message}</div>}
        {changes && !changes.isGitRepo && <div className="empty-state">{changes.error ?? t("workspace.notGitRepo")}</div>}
        {changes?.files.map((file) => (
          <button className={`change-row ${file.path === selectedFile?.path ? "active" : ""}`} key={file.path} onClick={() => setSelectedPath(file.path)}>
            <span className="pill">{file.status}</span>
            <strong>{file.path}</strong>
            {file.sourceLabel && <small>{file.sourceLabel}</small>}
            <em>+{file.additions} -{file.deletions}</em>
          </button>
        ))}
        {selectedFile && (
          <div className="diff-file">
            <div className="diff-file-head">
              <span>{selectedFile.path}</span>
              <button className="ghost-button icon-only" type="button" title={t("project.openFile")} aria-label={t("project.openFile")} disabled={Boolean(selectedFile.sourceCwd)} onClick={() => onOpenFile(selectedFile.path)}><IconText icon={FolderOpen}>{t("project.openFile")}</IconText></button>
            </div>
            <pre>{selectedFile.patch || selectedFile.newContent || (selectedFile.binary ? t("workspace.binaryFile") : t("workspace.noPatch"))}</pre>
            <div className="change-actions">
              <button className="ghost-button icon-only" type="button" title={t("workspace.stageFile")} aria-label={t("workspace.stageFile")} onClick={() => void gitFileAction(selectedFile, "stage")}><IconText icon={Save}>{t("workspace.stageFile")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("workspace.unstageFile")} aria-label={t("workspace.unstageFile")} onClick={() => void gitFileAction(selectedFile, "unstage")}><IconText icon={RotateCcw}>{t("workspace.unstageFile")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("workspace.copyPatch")} aria-label={t("workspace.copyPatch")} onClick={() => void copyPatch(selectedFile)}><IconText icon={Copy}>{t("workspace.copyPatch")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("workspace.copyAll")} aria-label={t("workspace.copyAll")} onClick={() => void copyPatch()}><IconText icon={Copy}>{t("workspace.copyAll")}</IconText></button>
              <button className="ghost-button danger-button icon-only" type="button" title={t("workspace.revertFile")} aria-label={t("workspace.revertFile")} onClick={() => void revertFile(selectedFile)}><IconText icon={RotateCcw}>{t("workspace.revertFile")}</IconText></button>
            </div>
          </div>
        )}
      </section>
      <section className={`panel ${activePanel === "activity" ? "active" : ""}`}>
        <ActivityPanel items={activityItems} hasMore={activityHasMore} onLoadMore={() => void loadActivity(true)} t={t} />
        {!activityItems.length && <div className="empty-state">{session ? t("room.noActivity") : t("workspace.noSession")}</div>}
      </section>
    </aside>
  );
}

function FilesPage({
  sessionToken,
  t,
  initialRootPath,
  initialMountName,
  initialPath,
  embedded = false,
  onOpenMainNav,
}: {
  sessionToken: string;
  t: TFunction;
  initialRootPath?: string;
  initialMountName?: string;
  initialPath?: string;
  embedded?: boolean;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog();
  const [mounts, setMounts] = useState<FileMount[]>([]);
  const [activeMountId, setActiveMountId] = useState("");
  const [currentPath, setCurrentPath] = useState(".");
  const [fileList, setFileList] = useState<FileListResponse | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileContentResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [fileVisibleCount, setFileVisibleCount] = useState(100);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [mountsPanelOpen, setMountsPanelOpen] = useState(false);
  const [transientRootPath, setTransientRootPath] = useState<string | null>(null);
  const [transientMountName, setTransientMountName] = useState<string | null>(null);
  const [archivePanel, setArchivePanel] = useState<{ path: string; displayPath: string } | null>(null);
  const [archiveTemplateItems, setArchiveTemplateItems] = useState<ArchiveIgnoreTemplate[]>([]);
  const [archiveTemplates, setArchiveTemplates] = useState<string[]>(["common", "sensitive"]);
  const [archiveRules, setArchiveRules] = useState("");
  const [archivePreview, setArchivePreview] = useState<FileArchivePreviewResponse | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [folderPreviewPanel, setFolderPreviewPanel] = useState<{ path: string; displayPath: string; previews: PreviewSummary[] | null } | null>(null);
  const [folderPreviewCommand, setFolderPreviewCommand] = useState("python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}");
  const [folderPreviewPort, setFolderPreviewPort] = useState("4179");
  const [folderPreviewAccess, setFolderPreviewAccess] = useState<PreviewAccess>("private");

  const authHeaders = { authorization: `Bearer ${sessionToken}` };
  const activeMount = mounts.find((mount) => mount.id === activeMountId) ?? mounts[0] ?? null;
  const lockedRootPath = embedded ? initialRootPath : undefined;
  const activeRootPath = lockedRootPath ?? transientRootPath ?? undefined;
  const fileQuery = (path: string, mountIdOverride = activeMountId, rootPathOverride = activeRootPath) => new URLSearchParams({
    path,
    ...(rootPathOverride ? { rootPath: rootPathOverride } : mountIdOverride ? { mountId: mountIdOverride } : {}),
  });

  function requestedFileParamsFromHash() {
    const [, query = ""] = window.location.hash.split("?");
    const params = new URLSearchParams(query);
    return {
      path: params.get("path"),
      rootPath: params.get("rootPath"),
      mountName: params.get("mountName"),
    };
  }

  async function loadMounts() {
    const response = await fetch("/api/file-mounts", { headers: authHeaders });
    if (!response.ok) throw new Error("mounts_failed");
    const nextMounts = (await response.json()) as FileMount[];
    setMounts(nextMounts);
    setActiveMountId((current) => current && nextMounts.some((mount) => mount.id === current) ? current : nextMounts[0]?.id ?? "");
    return nextMounts;
  }

  useEffect(() => {
    if (activeRootPath) return;
    loadMounts().catch(() => setMessage(t("file.readMountsFailed")));
  }, [activeRootPath, sessionToken]);

  useEffect(() => {
    fetch("/api/files/archive/templates", { headers: authHeaders })
      .then((response) => response.ok ? response.json() : [])
      .then((templates: ArchiveIgnoreTemplate[]) => {
        setArchiveTemplateItems(templates);
        const defaultIds = templates.filter((template) => ["common", "sensitive"].includes(template.id)).map((template) => template.id);
        setArchiveTemplates(defaultIds);
        setArchiveRules(rulesForArchiveTemplates(templates, defaultIds));
      })
      .catch(() => undefined);
  }, [sessionToken]);

  useEffect(() => {
    if (!activeRootPath && !activeMountId) return;
    setMessage("");
    fetch(`/api/files?${fileQuery(currentPath)}`, { headers: authHeaders })
      .then((response) => {
        if (!response.ok) throw new Error("file_list_failed");
        return response.json();
      })
      .then((nextList: FileListResponse) => {
        setFileList(nextList);
        if (!pendingOpenPath) {
          setSelectedEntry(null);
          setSelectedFile(null);
          setDraft("");
          setDirty(false);
        }
      })
      .catch(() => {
        setFileList({ mountId: activeMountId, root: activeRootPath ?? activeMount?.rootPath ?? "", path: currentPath, parentPath: null, entries: [] });
        setMessage(t("file.readDirectoryFailed"));
      });
  }, [activeMountId, activeRootPath, currentPath, reloadKey, sessionToken, pendingOpenPath]);

  useEffect(() => {
    setFileVisibleCount(100);
  }, [activeMountId, activeRootPath, currentPath, fileFilter, reloadKey]);

  useEffect(() => {
    function handleWorkspaceChanged() {
      if (dirty) return;
      setReloadKey((key) => key + 1);
    }
    window.addEventListener(workspaceChangedEvent, handleWorkspaceChanged);
    return () => window.removeEventListener(workspaceChangedEvent, handleWorkspaceChanged);
  }, [dirty]);

  function switchMount(mountId: string) {
    setTransientRootPath(null);
    setTransientMountName(null);
    setActiveMountId(mountId);
    setMountsPanelOpen(false);
    setCurrentPath(".");
    setFileList(null);
    setSelectedEntry(null);
    setSelectedFile(null);
    setDraft("");
    setDirty(false);
  }

  async function openEntry(entry: FileEntry) {
    setMessage("");
    setSelectedEntry(entry);
    if (entry.kind === "directory") {
      setCurrentPath(entry.path);
      return;
    }

    const response = await fetch(`/api/files/content?${fileQuery(entry.path)}`, {
      headers: authHeaders,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(`${t("file.readFileFailed")}：${error?.error ?? t("file.readFileLimitHint")}`);
      return;
    }

    const nextFile = (await response.json()) as FileContentResponse;
    setSelectedFile(nextFile);
    setDraft(nextFile.content);
    setDirty(false);
  }

  async function openPath(path: string, mountIdOverride = activeMountId, rootPathOverride = activeRootPath) {
    const parent = path.includes("/") ? path.split("/").slice(0, -1).join("/") || "." : ".";
    setPendingOpenPath(path);
    setCurrentPath(parent);
    await openFilePath(path, mountIdOverride, rootPathOverride);
    setPendingOpenPath(null);
  }

  async function openFilePath(path: string, mountIdOverride = activeMountId, rootPathOverride = activeRootPath) {
    const response = await fetch(`/api/files/content?${fileQuery(path, mountIdOverride, rootPathOverride)}`, {
      headers: authHeaders,
    });
    if (!response.ok) return;
    const nextFile = (await response.json()) as FileContentResponse;
    setSelectedEntry({ name: path.split("/").at(-1) ?? path, path, kind: "file", size: nextFile.content.length, updatedAt: nextFile.updatedAt });
    setSelectedFile(nextFile);
    setDraft(nextFile.content);
    setDirty(false);
  }

  useEffect(() => {
    const hashParams = requestedFileParamsFromHash();
    const path = lockedRootPath ? initialPath ?? null : hashParams.path;
    const rootPath = lockedRootPath ?? hashParams.rootPath;
    const mountName = initialMountName ?? hashParams.mountName;
    if (lockedRootPath) {
      if (path) {
        void openPath(path);
        return;
      }
      setCurrentPath(".");
      setFileList(null);
      setSelectedEntry(null);
      setSelectedFile(null);
      setDraft("");
      setDirty(false);
      setReloadKey((key) => key + 1);
      return;
    }
    if (rootPath) {
      setTransientRootPath(rootPath);
      setTransientMountName(mountName ?? "Session Workspace");
      setCurrentPath(".");
      setFileList(null);
      setSelectedEntry(null);
      setSelectedFile(null);
      setDraft("");
      setDirty(false);
      if (path) window.setTimeout(() => void openPath(path, "", rootPath), 0);
      else setReloadKey((key) => key + 1);
      return;
    }
    if (path) void openPath(path);
  }, [initialMountName, initialPath, lockedRootPath, sessionToken]);

  async function createEntry(kind: CreateFileRequest["kind"]) {
    const name = await dialog.prompt({
      title: kind === "directory" ? t("file.newDirectory") : t("file.newFile"),
      message: t("file.createInPath").replace("{path}", absoluteFilePath(fileList?.path ?? currentPath)),
      placeholder: kind === "directory" ? t("file.directoryName") : t("file.fileName"),
      confirmLabel: t("action.create"),
    });
    if (!name) return;
    setMessage("");
    const body: CreateFileRequest = {
      parentPath: fileList?.path ?? currentPath,
      name,
      kind,
    };
    const response = await fetch(`/api/files?${new URLSearchParams(activeRootPath ? { rootPath: activeRootPath } : activeMountId ? { mountId: activeMountId } : {})}`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.createFailed"));
      return;
    }
    setReloadKey((key) => key + 1);
  }

  async function renameEntry() {
    if (!selectedEntry) return;
    const newName = await dialog.prompt({
      title: t("action.rename"),
      message: absoluteFilePath(selectedEntry.path),
      defaultValue: selectedEntry.name,
      placeholder: t("action.rename"),
      confirmLabel: t("action.rename"),
    });
    if (!newName || newName === selectedEntry.name) return;
    setMessage("");
    const body: RenameFileRequest = {
      path: selectedEntry.path,
      newName,
    };
    const response = await fetch(`/api/files?${new URLSearchParams(activeRootPath ? { rootPath: activeRootPath } : activeMountId ? { mountId: activeMountId } : {})}`, {
      method: "PATCH",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.renameFailed"));
      return;
    }
    setSelectedFile(null);
    setSelectedEntry(null);
    setDraft("");
    setDirty(false);
    setReloadKey((key) => key + 1);
  }

  async function deleteEntry() {
    if (!selectedEntry) return;
    const targetPath = absoluteFilePath(selectedEntry.path);
    const confirmed = await dialog.confirm({
      title: selectedEntry.kind === "directory" ? t("file.deleteDirectory") : t("file.deleteFile"),
      message: selectedEntry.kind === "directory"
        ? t("file.deleteDirectoryMessage").replace("{path}", targetPath)
        : targetPath,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setMessage("");
    const response = await fetch(`/api/files?${fileQuery(selectedEntry.path)}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      setMessage(t("file.deleteFailed"));
      return;
    }
    setSelectedFile(null);
    setSelectedEntry(null);
    setDraft("");
    setDirty(false);
    setReloadKey((key) => key + 1);
  }

  async function saveFile() {
    if (!selectedFile) return;
    setMessage("");
    const response = await fetch(`/api/files/content?${fileQuery(selectedFile.path)}`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: draft }),
    });
    if (!response.ok) {
      setMessage(t("file.saveFailed"));
      return;
    }

    const nextFile = (await response.json()) as FileContentResponse;
    setSelectedFile(nextFile);
    setDraft(nextFile.content);
    setDirty(false);
    setMessage(t("file.saved"));
  }

  function absoluteFilePath(path: string) {
    const root = fileList?.root ?? activeRootPath ?? activeMount?.rootPath ?? "";
    if (!root) return path;
    if (path === ".") return root;
    return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  function selectedDirectoryPath() {
    if (selectedEntry?.kind === "directory") return absoluteFilePath(selectedEntry.path);
    if (selectedEntry?.kind === "file") {
      const parent = selectedEntry.path.includes("/") ? selectedEntry.path.split("/").slice(0, -1).join("/") || "." : ".";
      return absoluteFilePath(parent);
    }
    return absoluteFilePath(fileList?.path ?? currentPath);
  }

  function selectedDirectoryRelativePath() {
    if (selectedEntry?.kind === "directory") return selectedEntry.path;
    if (selectedEntry?.kind === "file") return selectedEntry.path.includes("/") ? selectedEntry.path.split("/").slice(0, -1).join("/") || "." : ".";
    return fileList?.path ?? currentPath;
  }

  async function closeSelectedFile() {
    if (dirty) {
      const confirmed = await dialog.confirm({
        title: t("file.unsavedChanges"),
        message: selectedFile?.path ?? selectedEntry?.path ?? "",
        confirmLabel: t("action.close"),
        danger: true,
      });
      if (!confirmed) return;
    }
    setSelectedEntry(null);
    setSelectedFile(null);
    setDraft("");
    setDirty(false);
    setPreviewExpanded(false);
  }

  async function copyCurrentPath() {
    await navigator.clipboard?.writeText(selectedEntry ? absoluteFilePath(selectedEntry.path) : absoluteFilePath(fileList?.path ?? currentPath)).catch(() => undefined);
    setMessage(t("file.pathCopied"));
  }

  function openTerminalHere() {
    setTerminalCwd(selectedDirectoryPath());
  }

  function openArchivePanel() {
    const path = selectedEntry?.kind === "directory" ? selectedEntry.path : fileList?.path ?? currentPath;
    setArchivePanel({ path, displayPath: absoluteFilePath(path) });
    setArchivePreview(null);
  }

  async function openFolderPreviewPanel() {
    const path = selectedDirectoryRelativePath();
    const displayPath = absoluteFilePath(path);
    setFolderPreviewPanel({ path: displayPath, displayPath, previews: null });
    await loadFolderPreviews(displayPath);
  }

  async function loadFolderPreviews(displayPath: string) {
    const params = new URLSearchParams({ scopeType: "folder", scopeId: displayPath });
    const response = await fetch(`/api/previews?${params}`, { headers: authHeaders });
    if (!response.ok) {
      setMessage(t("project.previewReadFailed"));
      setFolderPreviewPanel((current) => current?.path === displayPath ? { ...current, previews: [] } : current);
      return;
    }
    const previews = (await response.json()) as PreviewSummary[];
    setFolderPreviewPanel((current) => current?.path === displayPath ? { ...current, previews } : current);
  }

  async function createFolderPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!folderPreviewPanel) return;
    const folderName = folderPreviewPanel.displayPath.split("/").filter(Boolean).at(-1) ?? "folder";
    const body: CreatePreviewRequest = {
      scopeType: "folder",
      scopeId: folderPreviewPanel.displayPath,
      label: `${folderName}:${folderPreviewPort}`,
      targetHost: "127.0.0.1",
      port: Number(folderPreviewPort),
      command: renderPreviewCommand(folderPreviewCommand, folderPreviewPort, "."),
      cwd: ".",
      access: folderPreviewAccess,
      autoStart: true,
    };
    const response = await fetch("/api/previews", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(result?.error ? `${t("project.previewStartFailed")}：${result.error}` : t("project.previewStartFailed"));
      if (response.status === 409 && result?.error === "approval_required") await loadFolderPreviews(folderPreviewPanel.displayPath);
      return;
    }
    const preview = (await response.json()) as PreviewSummary;
    setFolderPreviewPanel((current) => current ? { ...current, previews: [preview, ...(current.previews ?? []).filter((item) => item.id !== preview.id)] } : current);
    setMessage(t("project.previewStarted"));
  }

  async function stopFolderPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: authHeaders,
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setFolderPreviewPanel((current) => current ? { ...current, previews: (current.previews ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item) } : current);
  }

  async function deleteFolderPreview(preview: PreviewSummary) {
    const confirmed = await dialog.confirm({
      title: t("project.deletePreview"),
      message: `${preview.label}\n${preview.targetHost}:${preview.port}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      setMessage(t("project.previewDeleteFailed"));
      return;
    }
    setFolderPreviewPanel((current) => current ? { ...current, previews: (current.previews ?? []).filter((item) => item.id !== preview.id) } : current);
    setMessage(t("project.previewDeleted"));
  }

  useEffect(() => {
    if (!folderPreviewPanel?.previews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadFolderPreviews(folderPreviewPanel.displayPath), 1500);
    return () => window.clearTimeout(timer);
  }, [folderPreviewPanel, sessionToken]);

  function toggleArchiveTemplate(templateId: string) {
    setArchiveTemplates((current) => {
      const next = current.includes(templateId) ? current.filter((id) => id !== templateId) : [...current, templateId];
      setArchiveRules(rulesForArchiveTemplates(archiveTemplateItems, next));
      setArchivePreview(null);
      return next;
    });
  }

  function archiveRequestBody(): FileArchiveRequest | null {
    if (!archivePanel) return null;
    return {
      path: archivePanel.path,
      ...(activeRootPath ? { rootPath: activeRootPath } : activeMountId ? { mountId: activeMountId } : {}),
      excludes: archiveRules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    };
  }

  async function previewArchive() {
    const body = archiveRequestBody();
    if (!body) return;
    setArchiveBusy(true);
    try {
      const response = await fetch("/api/files/archive/preview", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage(t("file.archivePreviewFailed"));
        return;
      }
      setArchivePreview((await response.json()) as FileArchivePreviewResponse);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function downloadArchive() {
    const body = archiveRequestBody();
    if (!body) return;
    if (archivePreview && archivePreview.bytes > 500 * 1024 * 1024 && !window.confirm(t("file.archiveLargeConfirm").replace("{size}", formatBytes(archivePreview.bytes)))) return;
    setArchiveBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/files/archive", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage(t("file.archiveFailed"));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const filename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "archive.zip";
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setArchivePanel(null);
      setMessage(t("file.archiveStarted"));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function createMount() {
    const name = await dialog.prompt({ title: t("file.addMount"), placeholder: t("file.mountName"), confirmLabel: t("file.next") });
    if (!name) return;
    const rootPath = await dialog.prompt({
      title: t("file.mountPath"),
      message: t("file.mountNameMessage").replace("{name}", name),
      defaultValue: activeMount?.rootPath ?? "/",
      placeholder: t("file.localPath"),
      confirmLabel: t("file.addMount"),
    });
    if (!rootPath) return;
    setMessage("");
    const body: CreateFileMountRequest = { name, rootPath };
    const response = await fetch("/api/file-mounts", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.addMountFailed"));
      return;
    }
    const mount = (await response.json()) as FileMount;
    await loadMounts();
    switchMount(mount.id);
  }

  async function editMount(mount: FileMount) {
    const name = await dialog.prompt({ title: t("file.editMountName"), defaultValue: mount.name, placeholder: t("file.mountName") });
    if (!name) return;
    const rootPath = await dialog.prompt({ title: t("file.editMountPath"), defaultValue: mount.rootPath, placeholder: t("file.localPath") });
    if (!rootPath) return;
    setMessage("");
    const body: UpdateFileMountRequest = { name, rootPath };
    const response = await fetch(`/api/file-mounts/${mount.id}`, {
      method: "PATCH",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.updateMountFailed"));
      return;
    }
    await loadMounts();
    setReloadKey((key) => key + 1);
  }

  async function deleteMount(mount: FileMount) {
    const confirmed = await dialog.confirm({
      title: t("file.removeMount"),
      message: `${mount.name} · ${mount.rootPath}\n${t("file.removeMountHint")}`,
      confirmLabel: t("file.removeMount"),
      danger: true,
    });
    if (!confirmed) return;
    setMessage("");
    const response = await fetch(`/api/file-mounts/${mount.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      setMessage(t("file.removeMountFailed"));
      return;
    }
    await loadMounts();
    setCurrentPath(".");
    setFileList(null);
    setSelectedEntry(null);
    setSelectedFile(null);
    setDraft("");
    setDirty(false);
  }

  const selectedPath = selectedFile?.path;
  const filteredFileEntries = fileList?.entries.filter((entry) => entry.name.toLowerCase().includes(fileFilter.trim().toLowerCase())) ?? [];
  const visibleFileEntries = filteredFileEntries.slice(0, fileVisibleCount);
  const fileCountText = fileList
    ? fileFilter.trim()
      ? t("file.filteredItemCount").replace("{visible}", String(Math.min(visibleFileEntries.length, filteredFileEntries.length))).replace("{filtered}", String(filteredFileEntries.length)).replace("{total}", String(fileList.entries.length))
      : t("file.itemCount").replace("{visible}", String(Math.min(visibleFileEntries.length, filteredFileEntries.length))).replace("{total}", String(fileList.entries.length))
    : t("file.itemCount").replace("{visible}", "0").replace("{total}", "0");
  const groupedArchiveTemplates = archiveTemplateItems.reduce<Array<{ group: string; templates: ArchiveIgnoreTemplate[] }>>((groups, template) => {
    const group = groups.find((item) => item.group === template.group);
    if (group) group.templates.push(template);
    else groups.push({ group: template.group, templates: [template] });
    return groups;
  }, []);

  function renderMounts() {
    return (
      <>
        <div className="pane-title">{t("file.mounts")}</div>
        <button className="ghost-button mount-add icon-only" type="button" title={t("file.addMount")} aria-label={t("file.addMount")} onClick={createMount}><IconText icon={FolderPlus}>{t("file.addMount")}</IconText></button>
        {mounts.map((mount) => (
          <div className={`mount-row ${mount.id === activeMountId ? "active" : ""}`} key={mount.id}>
            <button className="mount" onClick={() => switchMount(mount.id)}>
              <strong>{mount.name}</strong><span>{mount.rootPath}</span>
            </button>
            <div className="mount-actions">
              <button type="button" onClick={() => editMount(mount)}>{t("action.edit")}</button>
              <button type="button" onClick={() => deleteMount(mount)}>{t("file.removeMount")}</button>
            </div>
          </div>
        ))}
        {!mounts.length && <div className="subtle">{t("file.loadingMounts")}</div>}
      </>
    );
  }

  return (
    <main className={`files-page ${embedded ? "embedded-page" : ""}`}>
      {dialog.node}
      {!embedded && <PageHeader crumb={`${t("page.global")} / ${t("nav.files")}`} title={t("page.files")} action={t("action.refresh")} onAction={() => setReloadKey((key) => key + 1)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.files")} />}
      <section className={`file-workbench ${activeRootPath ? "locked-workspace" : ""}`}>
        {!activeRootPath && (
          <aside className="mounts-pane">
            {renderMounts()}
          </aside>
        )}
        <section className="file-list-pane">
          <div className="file-toolbar">
            <div><strong>{transientMountName ? `${transientMountName} · ${fileList?.path ?? currentPath}` : fileList?.path ?? currentPath}</strong><span className="subtle"> · {fileCountText}</span></div>
            <div className="file-actions">
              {!activeRootPath && <button className="ghost-button icon-only file-mobile-mounts" type="button" title={t("file.mounts")} aria-label={t("file.mounts")} onClick={() => setMountsPanelOpen(true)}><IconText icon={FolderOpen}>{t("file.mounts")}</IconText></button>}
              <button className="ghost-button icon-only" type="button" title={t("file.newFile")} aria-label={t("file.newFile")} onClick={() => createEntry("file")}><IconText icon={FilePlus2}>{t("file.newFile")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("file.newDirectory")} aria-label={t("file.newDirectory")} onClick={() => createEntry("directory")}><IconText icon={FolderPlus}>{t("file.newDirectory")}</IconText></button>
              {!embedded && <button className="ghost-button icon-only" type="button" title={t("file.openTerminal")} aria-label={t("file.openTerminal")} onClick={openTerminalHere}><IconText icon={TerminalIcon}>{t("file.openTerminal")}</IconText></button>}
              <button className="ghost-button icon-only" type="button" title={t("file.previewFolder")} aria-label={t("file.previewFolder")} onClick={() => void openFolderPreviewPanel()}><IconText icon={Globe}>{t("file.previewFolder")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("file.archiveDownload")} aria-label={t("file.archiveDownload")} onClick={openArchivePanel}><IconText icon={Download}>{t("file.archiveDownload")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("file.copyPath")} aria-label={t("file.copyPath")} onClick={() => void copyCurrentPath()}><IconText icon={Copy}>{t("file.copyPath")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("action.rename")} aria-label={t("action.rename")} disabled={!selectedEntry} onClick={renameEntry}><IconText icon={Pencil}>{t("action.rename")}</IconText></button>
              <button className="ghost-button danger-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} disabled={!selectedEntry} onClick={deleteEntry}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
            </div>
          </div>
          <input name="filefilter" className="search-input file-search-input" value={fileFilter} onChange={(event) => setFileFilter(event.target.value)} placeholder={t("file.searchCurrentDirectory")} />
          {fileList?.parentPath && (
            <button className="file-list-item" onClick={() => setCurrentPath(fileList.parentPath ?? ".")}>
              <span>↩ {t("file.parentDirectory")}</span>
              <em>{fileList.parentPath}</em>
            </button>
          )}
          {visibleFileEntries.map((entry) => (
            <button className={`file-list-item ${selectedPath === entry.path ? "active" : ""}`} key={entry.path} onClick={() => openEntry(entry)}>
              <span>{entry.kind === "directory" ? "▸" : "◇"} {entry.name}</span>
              <em>{entry.kind === "directory" ? t("file.directoryShort") : t("file.sizeKb").replace("{size}", String(Math.ceil(entry.size / 1024)))}</em>
            </button>
          ))}
          {filteredFileEntries.length > visibleFileEntries.length && (
            <button className="ghost-button load-more" type="button" onClick={() => setFileVisibleCount((count) => count + 100)}>{t("session.loadMore")}</button>
          )}
          {fileList && fileFilter && !filteredFileEntries.length && <div className="empty-state">{t("file.searchEmpty")}</div>}
          {!fileList && <div className="subtle">{t("file.loadingFiles")}</div>}
        </section>
        <section className={`file-preview-pane ${selectedFile ? "has-file" : ""} ${previewExpanded ? "expanded-preview" : ""}`}>
          <div className="file-preview-head">
            <div className="file-preview-title">
              <div className="file-preview-title-line">
                <strong>{selectedFile?.path ?? t("file.selectFile")}</strong>
                <div className="file-actions preview-actions">
                  <button className="ghost-button icon-only preview-expand-button" type="button" title={previewExpanded ? t("action.collapse") : t("action.fullscreen")} aria-label={previewExpanded ? t("action.collapse") : t("action.fullscreen")} onClick={() => setPreviewExpanded((value) => !value)}>
                    <IconText icon={previewExpanded ? Minimize2 : Maximize2}>{previewExpanded ? t("action.collapse") : t("action.fullscreen")}</IconText>
                  </button>
                  <button className="ghost-button icon-only file-preview-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => void closeSelectedFile()}><IconText icon={X}>{t("action.close")}</IconText></button>
                  <button className="ghost-button icon-only" title={t("action.save")} aria-label={t("action.save")} disabled={!selectedFile || !dirty} onClick={saveFile}><IconText icon={Save}>{t("action.save")}</IconText></button>
                </div>
              </div>
              <div className="subtle">{message || (dirty ? t("file.unsavedChanges") : t("file.globalFileView"))}</div>
            </div>
          </div>
          {selectedFile ? (
            <textarea name="draft-2"
              className="large-code file-editor"
              value={draft}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
              }}
            />
          ) : (
            <div className="empty-state">{t("file.chooseTextFile")}</div>
          )}
        </section>
      </section>
      {!activeRootPath && mountsPanelOpen && (
        <div className="workspace-modal compact-modal file-mounts-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("file.mounts")}</strong>
              <span>{activeMount?.name ?? ""}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setMountsPanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <div className="mounts-pane modal-mounts-pane">
            {renderMounts()}
          </div>
        </div>
      )}
      {archivePanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("file.archiveDownload")}</strong>
              <span>{archivePanel.displayPath}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setArchivePanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail archive-dialog">
            {groupedArchiveTemplates.map((group) => (
              <section className="archive-template-group" key={group.group}>
                <strong>{group.group}</strong>
                <div className="archive-template-grid">
                  {group.templates.map((template) => (
                    <label className="checkbox-row" key={template.id}>
                      <input name="archivetemplates-includes-template-id" type="checkbox" checked={archiveTemplates.includes(template.id)} onChange={() => toggleArchiveTemplate(template.id)} />
                      <span>{template.name}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
            <label className="archive-rules-field">
              <span>{t("file.archiveExcludeRules")}</span>
              <textarea name="archiverules" className="large-code archive-rules" value={archiveRules} spellCheck={false} onChange={(event) => {
                setArchiveRules(event.target.value);
                setArchivePreview(null);
              }} />
            </label>
            {archivePreview && (
              <section className="archive-preview-summary">
                <strong>{t("file.archivePreview")}</strong>
                <span>{t("file.archivePreviewStats").replace("{files}", String(archivePreview.files)).replace("{size}", formatBytes(archivePreview.bytes)).replace("{excluded}", String(archivePreview.excluded))}</span>
                {archivePreview.excludedExamples.length > 0 && (
                  <code>{archivePreview.excludedExamples.join("\n")}</code>
                )}
              </section>
            )}
            <div className="settings-actions">
              <button className="ghost-button" type="button" onClick={() => setArchivePanel(null)}>{t("action.cancel")}</button>
              <button className="ghost-button" type="button" disabled={archiveBusy} onClick={() => void previewArchive()}>{t("file.archivePreview")}</button>
              <button className="dark-button" type="button" disabled={archiveBusy} onClick={() => void downloadArchive()}><IconText icon={Download}>{t("file.archiveDownload")}</IconText></button>
            </div>
          </div>
        </div>
      )}
      {folderPreviewPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("file.previewFolder")}</strong>
              <span>{folderPreviewPanel.displayPath}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setFolderPreviewPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            <form className="preview-form" onSubmit={createFolderPreview}>
              <label>
                <span>{t("project.previewCommand")}</span>
                <input name="folder-preview-command" value={folderPreviewCommand} onChange={(event) => setFolderPreviewCommand(event.target.value)} placeholder="python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}" required />
              </label>
              <label>
                <span>{t("project.previewDirectory")}</span>
                <input name="folder-preview-directory" value={folderPreviewPanel.displayPath} readOnly />
              </label>
              <label>
                <span>{t("project.previewPort")}</span>
                <input name="folder-preview-port" value={folderPreviewPort} onChange={(event) => setFolderPreviewPort(event.target.value)} inputMode="numeric" placeholder="4179" required />
              </label>
              <label>
                <span>{t("preview.access")}</span>
                <select name="folder-preview-access" value={folderPreviewAccess} onChange={(event) => setFolderPreviewAccess(event.target.value as PreviewAccess)}>
                  <option value="private">{t("preview.private")}</option>
                  <option value="public">{t("preview.public")}</option>
                </select>
              </label>
              <button className="ghost-button" type="submit"><IconText icon={Play}>{t("project.startPreview")}</IconText></button>
            </form>
            {!folderPreviewPanel.previews && <div className="subtle">{t("project.loadingPreviews")}</div>}
            {folderPreviewPanel.previews?.map((preview) => (
              <div className="preview-row" key={preview.id}>
                <div>
                  <strong>{preview.label}</strong>
                  <span>{preview.status} · {preview.access} · {preview.targetHost}:{preview.port}</span>
                  {preview.command && <code>{preview.command}</code>}
                </div>
                <div className="preview-actions">
                  <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, undefined, t)}>{t("project.openPreview")}</button>
                  <button className="ghost-button" type="button" disabled={preview.status !== "running" && preview.status !== "starting"} onClick={() => void stopFolderPreview(preview)}>{t("action.disconnect")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteFolderPreview(preview)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {folderPreviewPanel.previews && !folderPreviewPanel.previews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      )}
      {terminalCwd && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("page.terminal")}</strong>
              <span>{terminalCwd}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setTerminalCwd(null)}>{t("action.close")}</button>
          </div>
          <div className="workspace-modal-body">
            <TerminalPage sessionToken={sessionToken} t={t} initialCwd={terminalCwd} embedded />
          </div>
        </div>
      )}
    </main>
  );
}

function TerminalPage({
  sessionToken,
  t,
  initialCwd,
  embedded = false,
  onOpenMainNav,
}: {
  sessionToken: string;
  t: TFunction;
  initialCwd?: string;
  embedded?: boolean;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog();
  function requestedTerminalCwdFromHash() {
    const [, query = ""] = window.location.hash.split("?");
    return new URLSearchParams(query).get("cwd");
  }

  const requestedCwd = initialCwd ?? requestedTerminalCwdFromHash();
  const [cwd, setCwd] = useState(requestedCwd ?? "~");
  const [connected, setConnected] = useState(false);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("");
  const [terminalSearch, setTerminalSearch] = useState("");
  const [terminalStatusFilter, setTerminalStatusFilter] = useState("");
  const [terminalSessionsPanelOpen, setTerminalSessionsPanelOpen] = useState(false);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalModeRef = useRef<"pty" | "pipe">("pty");
  const activeTerminalSession = terminalSessions.find((item) => item.id === activeTerminalId);
  const visibleTerminalSessions = terminalSessions.filter((session) => {
    const query = terminalSearch.trim().toLowerCase();
    if (terminalStatusFilter && session.status !== terminalStatusFilter) return false;
    return !query || [session.name, session.cwd, session.mode, session.status].some((value) => value.toLowerCase().includes(query));
  });

  async function getTerminalDefaultCwd() {
    if (requestedCwd) return requestedCwd;
    const response = await fetch("/api/terminal/defaults", {
      headers: { authorization: `Bearer ${sessionToken}` },
    }).catch(() => null);
    if (!response?.ok) return "~";
    const defaults = (await response.json().catch(() => null)) as TerminalDefaultsResponse | null;
    return defaults?.defaultCwd || "~";
  }

  useEffect(() => {
    if (!terminalHostRef.current) return;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "SFMono-Regular, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#111511",
        foreground: "#d9e7dc",
        cursor: "#d9e7dc",
        selectionBackground: "#315f9f66",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminal.onData((data) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        if (terminalModeRef.current === "pipe") {
          terminal.write(data === "\r" ? "\r\n" : data);
        }
        socketRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendTerminalSize();
    });
    resizeObserver.observe(terminalHostRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    void (async () => {
      const anonymousCwd = await getTerminalDefaultCwd();
      setCwd(anonymousCwd);
      connectShell("", anonymousCwd, true);
      if (!embedded) void refreshTerminalSessions();
    })();

    return () => {
      resizeObserver.disconnect();
      socketRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  function writeTerminal(value: string) {
    terminalRef.current?.write(value);
  }

  function sendTerminalSize() {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!terminal || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
  }

  async function refreshTerminalSessions() {
    const response = await fetch("/api/terminal/sessions", {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return [];
    const sessions = (await response.json()) as TerminalSessionSummary[];
    setTerminalSessions(sessions);
    return sessions;
  }

  async function createShellSession(name?: string, nextCwd = cwd) {
    const body: CreateTerminalSessionRequest = { name, cwd: nextCwd };
    const response = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      writeTerminal(`\r\n[${t("terminal.createSessionFailed")}]\r\n`);
      return null;
    }
    const session = (await response.json()) as TerminalSessionSummary;
    setTerminalSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
    setActiveTerminalId(session.id);
    return session;
  }

  function nextShellName(sessions: TerminalSessionSummary[]) {
    const names = new Set(sessions.map((session) => session.name));
    let index = 1;
    while (names.has(`shell ${index}`)) index += 1;
    return `shell ${index}`;
  }

  async function newShellSession() {
    const name = await dialog.prompt({
      title: t("terminal.newShell"),
      message: `${t("terminal.workingDirectory")}：${cwd}`,
      defaultValue: `shell ${terminalSessions.length + 1}`,
      placeholder: t("terminal.sessionName"),
      confirmLabel: t("action.create"),
    });
    if (name === null) return;
    const session = await createShellSession(name, cwd);
    if (session) {
      setTerminalSessionsPanelOpen(false);
      connectShell(session.id);
    }
  }

  async function reopenSelectedShell(selected = terminalSessions.find((item) => item.id === activeTerminalId)) {
    const session = await createShellSession(selected ? `${selected.name} copy` : undefined, selected?.cwd ?? cwd);
    if (session) connectShell(session.id);
  }

  async function closeShellSession(id: string) {
    const session = terminalSessions.find((item) => item.id === id);
    const confirmed = await dialog.confirm({
      title: t("terminal.deleteSession"),
      message: session ? `${t("terminal.deleteSession")}：${session.name}` : t("terminal.deleteSessionFallback"),
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const closingActiveConnection = id === activeTerminalId && connected;
    await fetch(`/api/terminal/sessions/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const sessions = await refreshTerminalSessions();
    if (closingActiveConnection) {
      socketRef.current?.close();
      terminalRef.current?.reset();
      setConnected(false);
    }
    const currentStillExists = sessions.some((item) => item.id === id);
    if (!currentStillExists) setActiveTerminalId("");
  }

  async function renameShellSession(sessionId = activeTerminalId) {
    const session = terminalSessions.find((item) => item.id === sessionId);
    if (!session) return;
    const name = await dialog.prompt({
      title: t("terminal.renameSession"),
      defaultValue: session.name,
      placeholder: t("terminal.sessionNamePlaceholder"),
      confirmLabel: t("action.rename"),
    });
    if (!name || name === session.name) return;
    const body: UpdateTerminalSessionRequest = { name };
    const response = await fetch(`/api/terminal/sessions/${session.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const updated = (await response.json()) as TerminalSessionSummary;
    setTerminalSessions((items) => items.map((item) => item.id === updated.id ? updated : item));
  }

  function connectShell(sessionId = activeTerminalId, connectCwd = cwd, ephemeral = false) {
    if (!sessionId && !ephemeral) {
      writeTerminal(`\r\n${t("terminal.createOrSelectShell")}\r\n`);
      return;
    }
    const target = terminalSessions.find((item) => item.id === sessionId);
    if (target && target.status !== "running") {
      setActiveTerminalId(target.id);
      void reopenSelectedShell(target);
      return;
    }
    socketRef.current?.close();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL("/api/terminal/ws", window.location.href);
    url.protocol = protocol;
    url.searchParams.set("token", sessionToken);
    if (sessionId) url.searchParams.set("sessionId", sessionId);
    else {
      url.searchParams.set("cwd", connectCwd);
      if (ephemeral) url.searchParams.set("ephemeral", "true");
    }
    const socket = new WebSocket(url);
    const connectingEphemeral = ephemeral;
    socketRef.current = socket;
    terminalModeRef.current = "pty";
    terminalRef.current?.reset();
    writeTerminal(`${t("terminal.connecting")}\r\n`);
    socket.addEventListener("open", () => {
      setConnected(true);
      terminalRef.current?.focus();
      sendTerminalSize();
    });
    socket.addEventListener("error", () => writeTerminal(`\r\n[${t("terminal.ptyConnectionError")}]\r\n`));
    socket.addEventListener("close", (event) => {
      setConnected(false);
      if (event.code !== 1000) {
        writeTerminal(`\r\n[${t("terminal.ptyClosed").replace("{code}", String(event.code)).replace("{reason}", event.reason ? ` ${event.reason}` : "")}]\r\n`);
      }
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; data?: string; cwd?: string; mode?: string; exitCode?: number; error?: string; warning?: string; session?: TerminalSessionSummary };
      if (message.type === "ready") {
        const readySession = message.session ?? null;
        if (readySession && !connectingEphemeral) {
          setActiveTerminalId(readySession.id);
          setTerminalSessions((items) => [readySession, ...items.filter((item) => item.id !== readySession.id)]);
        }
        terminalModeRef.current = message.mode === "pipe" ? "pipe" : "pty";
        writeTerminal(`${t("terminal.connectedTo").replace("{cwd}", message.cwd ?? "").replace("{mode}", message.mode ?? "pty")}\r\n`);
        terminalRef.current?.focus();
      }
      if (message.type === "warning") writeTerminal(`[${t("terminal.warning").replace("{message}", message.warning ?? "")}]\r\n`);
      if (message.type === "output" && message.data) terminalRef.current?.write(message.data);
      if (message.type === "exit") writeTerminal(`\r\n[${t("terminal.processExited").replace("{code}", String(message.exitCode ?? ""))}]\r\n`);
      if (message.type === "error") writeTerminal(`\r\n[${t("terminal.error").replace("{message}", message.error ?? "")}]\r\n`);
    });
  }

  function disconnectShell() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
    writeTerminal(`\r\n[${t("terminal.disconnected")}]\r\n`);
  }

  function renderTerminalSessions() {
    return (
      <>
        <div className="pane-title">{t("terminal.sessions")}</div>
        <div className="terminal-field">
          <input name="terminalsearch" value={terminalSearch} onChange={(event) => setTerminalSearch(event.target.value)} placeholder={t("terminal.searchSessions")} />
          <select name="terminalstatusfilter" value={terminalStatusFilter} onChange={(event) => setTerminalStatusFilter(event.target.value)}>
            <option value="">{t("session.allStatuses")}</option>
            <option value="running">{t("session.statusRunning")}</option>
            <option value="closed">{t("action.disconnect")}</option>
          </select>
        </div>
        <div className="terminal-field terminal-create-row">
          <label>
            <span>{t("terminal.newSessionCwd")}</span>
            <input name="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} />
          </label>
          <button className="icon-button" type="button" onClick={newShellSession} title={t("terminal.newShell")} aria-label={t("terminal.newShell")}>
            <TerminalIcon size={15} />
          </button>
        </div>
        {visibleTerminalSessions.map((session) => (
          <div className={`session-row ${session.id === activeTerminalId ? "active" : ""}`} key={session.id}>
            <button
              className="session"
              type="button"
              onClick={() => {
                setActiveTerminalId(session.id);
                setTerminalSessionsPanelOpen(false);
                if (session.status === "running") connectShell(session.id);
              }}
            >
              <strong>{session.name}</strong>
              <span>{session.status} · {session.mode} · {session.cwd}</span>
            </button>
            <div className="session-actions">
              <button className="icon-button" type="button" onClick={() => void renameShellSession(session.id)} title={t("action.rename")} aria-label={`${t("action.rename")} ${session.name}`}>
                <Pencil size={14} />
              </button>
              <button className="icon-button danger-button" type="button" onClick={() => void closeShellSession(session.id)} title={t("action.delete")} aria-label={`${t("action.delete")} ${session.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!visibleTerminalSessions.length && <div className="empty-state">{t("terminal.noSessions")}</div>}
      </>
    );
  }

  return (
    <main className={`terminal-page ${embedded ? "embedded-page" : ""}`}>
      {dialog.node}
      {!embedded && <PageHeader crumb={`${t("page.global")} / ${t("nav.terminal")}`} title={t("page.terminal")} action={connected ? t("action.disconnect") : activeTerminalSession?.status === "closed" ? t("action.reconnect") : t("action.connect")} onAction={connected ? disconnectShell : activeTerminalSession?.status === "closed" ? reopenSelectedShell : activeTerminalSession ? connectShell : () => connectShell("", cwd, true)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.terminal")} />}
      <section className={`terminal-workbench ${embedded ? "locked-workspace" : ""}`}>
        {!embedded && (
          <aside className="session-pane">
            {renderTerminalSessions()}
          </aside>
        )}
        <section className="shell-pane">
          <div className="shell-head">
            <div><strong>{t("terminal.hostShell")}</strong><div className="subtle">{connected ? t("terminal.xtermConnected") : t("terminal.xtermDisconnected")}</div></div>
            {!embedded && (
              <div className="shell-head-actions">
                <button className="ghost-button icon-only terminal-mobile-sessions" type="button" title={t("terminal.sessions")} aria-label={t("terminal.sessions")} onClick={() => setTerminalSessionsPanelOpen(true)}><History size={16} /></button>
              </div>
            )}
            {embedded && <button className="ghost-button" type="button" onClick={connected ? disconnectShell : () => connectShell("", requestedCwd ?? cwd, true)}><IconText icon={connected ? Square : Play}>{connected ? t("action.disconnect") : t("action.connect")}</IconText></button>}
          </div>
          <div className="terminal-console">
            <div className="xterm-host" ref={terminalHostRef} />
          </div>
        </section>
      </section>
      {!embedded && terminalSessionsPanelOpen && (
        <div className="workspace-modal compact-modal terminal-sessions-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("terminal.sessions")}</strong>
              <span>{cwd}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setTerminalSessionsPanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <div className="session-pane modal-session-pane">
            {renderTerminalSessions()}
          </div>
        </div>
      )}
    </main>
  );
}

function PreviewsPage({
  sessionToken,
  projects,
  sessions,
  t,
  notify,
  onOpenMainNav,
}: {
  sessionToken: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog();
  const [previews, setPreviews] = useState<PreviewSummary[] | null>(null);
  const [previewCursor, setPreviewCursor] = useState<string | null>(null);
  const [previewHasMore, setPreviewHasMore] = useState(false);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewStatusFilter, setPreviewStatusFilter] = useState("");
  const [previewScopeFilter, setPreviewScopeFilter] = useState("");
  const [detailPreview, setDetailPreview] = useState<PreviewSummary | null>(null);
  const [detailLogs, setDetailLogs] = useState<string | null>(null);
  const [detailLogSearch, setDetailLogSearch] = useState("");
  const [message, setMessage] = useState("");
  const previewLogsRef = useRef<HTMLPreElement | null>(null);
  const visibleDetailLogs = detailLogs && detailLogSearch.trim()
    ? detailLogs.split(/\r?\n/).filter((line) => line.toLowerCase().includes(detailLogSearch.trim().toLowerCase())).join("\n")
    : detailLogs;

  const sources = [
    ...projects.map((project) => ({
      key: `project:${project.id}`,
      scopeType: "project" as const,
      scopeId: project.id,
      label: `${t("nav.projects")} · ${projectDisplayName(project, projects)}`,
    })),
    ...sessions.map((session) => ({
      key: `session:${session.id}`,
      scopeType: "session" as const,
      scopeId: session.id,
      label: `${t("nav.sessions")} · ${session.title}`,
    })),
    ...Array.from(new Map((previews ?? [])
      .filter((preview) => preview.scopeType === "folder")
      .map((preview) => [preview.scopeId, {
        key: `folder:${preview.scopeId}`,
        scopeType: "folder" as const,
        scopeId: preview.scopeId,
        label: `${t("nav.files")} · ${preview.scopeId}`,
      }])).values()),
  ];

  useEffect(() => {
    void loadPreviews();
  }, [sessionToken]);

  useEffect(() => {
    if (!previews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadPreviews(false, false), 1500);
    return () => window.clearTimeout(timer);
  }, [previews, sessionToken, previewSearch, previewStatusFilter, previewScopeFilter]);

  useEffect(() => {
    if (!detailPreview) return;
    setDetailLogs(null);
    const eventUrl = `/api/previews/${encodeURIComponent(detailPreview.id)}/logs/events?${new URLSearchParams({ token: sessionToken })}`;
    const source = new EventSource(eventUrl);
    source.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { preview?: PreviewSummary; logs?: string };
      if (data.preview) {
        const nextPreview = data.preview;
        setDetailPreview(nextPreview);
        setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
      }
      setDetailLogs(data.logs ?? "");
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { chunk?: string };
      setDetailLogs((current) => `${current ?? ""}${data.chunk ?? ""}`);
    });
    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { preview?: PreviewSummary };
      if (!data.preview) return;
      const nextPreview = data.preview;
      setDetailPreview(nextPreview);
      setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    });
    source.onerror = () => {
      setDetailLogs((current) => current === null ? "" : current);
    };
    return () => source.close();
  }, [detailPreview?.id, sessionToken]);

  useEffect(() => {
    if (!previewLogsRef.current) return;
    previewLogsRef.current.scrollTop = 0;
  }, [detailLogs]);

  async function loadPreviews(older = false, showLoading = true) {
    if (!older && showLoading) setPreviews(null);
    const params = new URLSearchParams({ limit: "20" });
    if (older && previewCursor) params.set("cursor", previewCursor);
    if (previewSearch.trim()) params.set("q", previewSearch.trim());
    if (previewStatusFilter) params.set("status", previewStatusFilter);
    if (previewScopeFilter) {
      const [scopeType, scopeId] = previewScopeFilter.split(":");
      params.set("scopeType", scopeType);
      params.set("scopeId", scopeId);
    }
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setPreviews([]);
      setMessage(t("project.previewReadFailed"));
      notify(t("project.previewReadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<PreviewSummary>;
    setPreviews((items) => older ? [...(items ?? []), ...page.items] : page.items);
    setPreviewCursor(page.nextCursor);
    setPreviewHasMore(page.hasMore);
  }

  function sourceForPreview(preview: PreviewSummary) {
    const source = sources.find((item) => item.scopeType === preview.scopeType && item.scopeId === preview.scopeId);
    return source?.label ?? `${preview.scopeType}:${preview.scopeId}`;
  }

  async function previewLastError(previewId: string) {
    const response = await fetch(`/api/previews/${previewId}/logs`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return "";
    const result = (await response.json().catch(() => null)) as PreviewLogsResponse | null;
    return (result?.logs ?? "").split(/\r?\n/).reverse().find((line) => line.includes("[error]")) ?? "";
  }

  async function startPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        setMessage(t("approval.required"));
        notify(t("approval.required"), "info");
        await loadPreviews();
        return;
      }
      const logError = await previewLastError(preview.id);
      const errorText = result?.error || logError;
      setMessage(errorText ? `${t("project.previewStartFailed")}：${errorText}` : t("project.previewStartFailed"));
      notify(errorText ? `${t("project.previewStartFailed")}：${errorText}` : t("project.previewStartFailed"), "error");
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
  }

  async function stopPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
  }

  async function deletePreview(preview: PreviewSummary) {
    const confirmed = await dialog.confirm({
      title: t("project.deletePreview"),
      message: `${preview.label}\n${preview.targetHost}:${preview.port}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setMessage(t("project.previewDeleteFailed"));
      notify(t("project.previewDeleteFailed"), "error");
      return;
    }
    setPreviews((items) => (items ?? []).filter((item) => item.id !== preview.id));
  }

  async function copyPreviewUrl(preview: PreviewSummary) {
    const copied = await copyText(`${window.location.origin}${preview.url}`);
    setMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function updatePreviewAccess(preview: PreviewSummary, access: PreviewAccess) {
    const response = await fetch(`/api/previews/${preview.id}/access`, {
      method: "PUT",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ access }),
    });
    if (!response.ok) {
      notify(t("preview.accessUpdateFailed"), "error");
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
  }

  return (
    <main className="management-page contacts-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.previews")}`} title={t("page.previews")} action={t("action.refresh")} onAction={() => void loadPreviews()} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.previews")} />
      <FilterToolbar className="preview-filter-toolbar">
        <FilterSearchInput
          value={previewSearch}
          onChange={(event) => setPreviewSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadPreviews();
          }}
          placeholder={t("preview.searchPreviews")}
        />
        <select name="previewstatusfilter" className="filter-select" value={previewStatusFilter} onChange={(event) => setPreviewStatusFilter(event.target.value)}>
          <option value="">{t("session.allStatuses")}</option>
          {["registered", "starting", "running", "stopped", "error"].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select name="previewscopefilter" className="filter-select" value={previewScopeFilter} onChange={(event) => setPreviewScopeFilter(event.target.value)}>
          <option value="">{t("preview.allSources")}</option>
          {sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
        </select>
        <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadPreviews()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
      </FilterToolbar>
      <section className="preview-list preview-list-full">
        {message && <div className="subtle">{message}</div>}
          {!previews && <div className="subtle">{t("project.loadingPreviews")}</div>}
          {previews?.map((preview) => (
            <article className="preview-item" key={preview.id}>
              <div className="preview-item-main">
                <strong>{preview.label}</strong>
                <span>{sourceForPreview(preview)} · {preview.access}</span>
              </div>
              <div className="preview-item-signal">
                <span className={`preview-status ${preview.status}`}>{preview.status}</span>
                <code>{preview.port}</code>
              </div>
              <button className="ghost-button icon-only" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailPreview(preview)}><IconText icon={Info}>{t("preview.details")}</IconText></button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ghost-button icon-only" type="button" title={t("preview.actions")} aria-label={t("preview.actions")}><MoreHorizontal size={16} /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={preview.status !== "running"} onSelect={() => void openPreviewUrl(preview, sessionToken, notify, t)}><IconText icon={Globe}>{t("project.openPreview")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyPreviewUrl(preview)}><IconText icon={Copy}>{t("action.copy")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void updatePreviewAccess(preview, preview.access === "private" ? "public" : "private")}>
                    <IconText icon={preview.access === "private" ? Unlock : Lock}>{preview.access === "private" ? t("preview.makePublic") : t("preview.makePrivate")}</IconText>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={preview.status === "running" || preview.status === "starting"} onSelect={() => void startPreview(preview)}><IconText icon={Play}>{t("preview.start")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem disabled={preview.status !== "running" && preview.status !== "starting"} onSelect={() => void stopPreview(preview)}><IconText icon={Square}>{t("preview.stop")}</IconText></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="danger-menu-item" onSelect={() => void deletePreview(preview)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          ))}
          {previewHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadPreviews(true)}>{t("session.loadMore")}</button>}
          {previews && !previews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
      </section>
      {detailPreview && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{detailPreview.label}</strong>
              <span>{sourceForPreview(detailPreview)}</span>
            </div>
            <button className="modal-head-close" type="button" aria-label={t("action.close")} onClick={() => { setDetailPreview(null); setDetailLogs(null); setDetailLogSearch(""); }}><X size={16} /></button>
          </div>
          <div className="preview-detail">
            <PreviewDetailRow label={t("preview.status")} value={detailPreview.status} />
            <PreviewDetailRow label={t("preview.access")} value={detailPreview.access} />
            <PreviewDetailRow label={t("preview.port")} value={String(detailPreview.port)} />
            <PreviewDetailRow label={t("preview.url")} value={`${window.location.origin}${detailPreview.url}`} />
            <PreviewDetailRow label={t("project.previewCommand")} value={detailPreview.command ?? "-"} />
            <PreviewDetailRow label={t("project.previewDirectory")} value={detailPreview.cwd ?? "-"} />
            <PreviewDetailRow label={t("preview.target")} value={`${detailPreview.targetHost}:${detailPreview.port}`} />
            <PreviewDetailRow label={t("preview.createdAt")} value={formatShortDate(detailPreview.createdAt)} />
            <PreviewDetailRow label={t("preview.updatedAt")} value={formatShortDate(detailPreview.updatedAt)} />
            <div className="preview-detail-row">
              <span>{t("preview.logs")}</span>
              <div className="preview-log-tools">
                <input className="search-input" name="preview-log-search" value={detailLogSearch} onChange={(event) => setDetailLogSearch(event.target.value)} placeholder={t("preview.searchLogs")} />
                <button className="ghost-button" type="button" disabled={!detailLogs} onClick={() => detailPreview && detailLogs !== null && downloadTextFile(`${(detailPreview.label || detailPreview.id).replace(/[\\/:*?"<>|]+/g, "-")}.log`, detailLogs)}><IconText icon={Download}>{t("preview.downloadLogs")}</IconText></button>
              </div>
              <pre ref={previewLogsRef} className="preview-logs">{detailLogs === null ? t("preview.logsLoading") : visibleDetailLogs ? newestLinesFirst(visibleDetailLogs) : t("preview.noLogs")}</pre>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function PreviewDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="preview-detail-row">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function ProjectsPage({
  sessionToken,
  projects,
  sessions,
  onOpenSession,
  onNewProjectSession,
  onAnalyzeProjectCheck,
  onChange,
  t,
  notify,
  onOpenMainNav,
}: {
  sessionToken: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onNewProjectSession: (projectId: string) => void;
  onAnalyzeProjectCheck: (project: ProjectSummary, result: TerminalCommandResponse) => Promise<void>;
  onChange: () => Promise<void>;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog();
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [showWorkspacePathInput, setShowWorkspacePathInput] = useState(false);
  const [message, setMessage] = useState("");
  const [projectItems, setProjectItems] = useState<ProjectSummary[]>(projects);
  const [projectCursor, setProjectCursor] = useState<string | null>(null);
  const [projectHasMore, setProjectHasMore] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [workspacePanel, setWorkspacePanel] = useState<{ mode: "files" | "terminal"; project: ProjectSummary } | null>(null);
  const [changesPanel, setChangesPanel] = useState<{ project: ProjectSummary; changes: WorkspaceChanges | null; selectedFile?: WorkspaceChangeFile } | null>(null);
  const [detailPanel, setDetailPanel] = useState<{ project: ProjectSummary; stats: ProjectStatsSummary | null; sessions: SessionSummary[] | null; sessionsCursor?: string | null; sessionsHasMore?: boolean; checks: ProjectCheckRunSummary[] | null; gitOps?: ProjectGitOperationSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [sessionsPanel, setSessionsPanel] = useState<{ project: ProjectSummary; sessions: SessionSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [checkResult, setCheckResult] = useState<{ project: ProjectSummary; result: TerminalCommandResponse | null } | null>(null);
  const [previewPanel, setPreviewPanel] = useState<{ project: ProjectSummary; previews: PreviewSummary[] | null } | null>(null);
  const [previewCommand, setPreviewCommand] = useState("python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}");
  const [previewPort, setPreviewPort] = useState("4179");
  const [previewDirectory, setPreviewDirectory] = useState("preview-demo");
  const [previewAccess, setPreviewAccess] = useState<PreviewAccess>("private");

  function showError(value: string) {
    setMessage(value);
    notify(value, "error");
  }

  useEffect(() => {
    setProjectItems(projects);
  }, [projects]);

  useEffect(() => {
    void loadProjects(true);
  }, [sessionToken]);

  async function loadProjects(reset = false, search = projectSearch) {
    const params = new URLSearchParams({ limit: "20" });
    if (!reset && projectCursor) params.set("cursor", projectCursor);
    if (search.trim()) params.set("q", search.trim());
    const response = await fetch(`/api/projects?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<ProjectSummary>;
    setProjectItems((items) => reset ? page.items : [...items, ...page.items.filter((project) => !items.some((item) => item.id === project.id))]);
    setProjectCursor(page.nextCursor);
    setProjectHasMore(page.hasMore);
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const body: CreateProjectRequest = {
      name,
    };
    if (workspacePath.trim()) body.workspacePath = workspacePath.trim();
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("project.createFailed"));
      return;
    }
    setName("");
    setWorkspacePath("");
    setShowWorkspacePathInput(false);
    await onChange();
    await loadProjects(true);
    notify(t("project.created"), "success");
  }

  async function deleteProject(project: ProjectSummary) {
    const decision = await dialog.confirmWithCheckbox({
      title: t("project.deleteProject"),
      message: t("project.deleteProjectMessage").replace("{name}", project.name).replace("{path}", project.workspacePath),
      confirmLabel: t("project.deleteProject"),
      checkboxLabel: t("project.deleteProjectFilesCheckbox"),
      checkboxDefaultChecked: false,
      danger: true,
    });
    if (!decision.confirmed) return;
    const deleteFiles = decision.checked;
    setMessage("");
    const response = await fetch(`/api/projects/${project.id}?${new URLSearchParams({ deleteFiles: String(deleteFiles) })}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        notify(t("approval.required"), "info");
        return;
      }
      showError(deleteFiles ? t("project.deleteFailedProtected") : t("project.deleteFailed"));
      return;
    }
    await onChange();
    await loadProjects(true);
    notify(t("project.deleted"), "success");
  }

  async function updateProject(project: ProjectSummary, input: UpdateProjectRequest) {
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      showError(t("project.updateFailed"));
      return null;
    }
    await onChange();
    await loadProjects(true);
    notify(t("project.updated"), "success");
    return (await response.json()) as ProjectSummary;
  }

  async function editCheckCommand(project: ProjectSummary) {
    const checkCommand = await dialog.prompt({
      title: t("project.checkCommand"),
      message: project.name,
      defaultValue: project.checkCommand ?? "pnpm run check",
      placeholder: t("project.checkPlaceholder"),
      confirmLabel: t("action.save"),
    });
    if (checkCommand === null) return;
    await updateProject(project, { checkCommand });
  }

  async function editProject(project: ProjectSummary) {
    const name = await dialog.prompt({
      title: t("project.editName"),
      defaultValue: project.name,
      placeholder: t("form.projectName"),
      confirmLabel: t("file.next"),
    });
    if (!name) return;
    const workspacePath = await dialog.prompt({
      title: t("project.editWorkspace"),
      message: name,
      defaultValue: project.workspacePath,
      placeholder: t("form.workspacePath"),
      confirmLabel: t("action.save"),
    });
    if (!workspacePath) return;
    await updateProject(project, { name, workspacePath });
  }

  async function runProjectCheck(project: ProjectSummary) {
    setCheckResult({ project, result: null });
    const response = await fetch(`/api/projects/${project.id}/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.checkRunFailed"));
      return;
    }
    setCheckResult({ project, result: (await response.json()) as TerminalCommandResponse });
  }

  async function runProjectCheckCommand(project: ProjectSummary, command: string) {
    setCheckResult({ project, result: null });
    const response = await fetch(`/api/projects/${project.id}/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!response.ok) {
      showError(t("project.checkRunFailed"));
      return;
    }
    setCheckResult({ project, result: (await response.json()) as TerminalCommandResponse });
  }

  async function runProjectGit(project: ProjectSummary, operation: ProjectGitOperationRequest["operation"]) {
    let body: ProjectGitOperationRequest = { operation };
    if (operation === "commit") {
      const messageValue = await dialog.prompt({ title: t("project.gitCommit"), message: project.name, placeholder: t("project.gitCommitMessage"), confirmLabel: t("project.gitCommit") });
      if (!messageValue) return;
      body = { operation, message: messageValue };
    }
    if (operation === "branch-create" || operation === "branch-checkout") {
      const branch = await dialog.prompt({ title: operation === "branch-create" ? t("project.gitBranchCreate") : t("project.gitBranchCheckout"), message: project.name, placeholder: t("project.gitBranchName"), confirmLabel: t("action.save") });
      if (!branch) return;
      body = { operation, branch };
    }
    const response = await fetch(`/api/projects/${project.id}/git`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as ProjectGitOperationSummary | { error?: string; approval?: ApprovalSummary } | null;
    if (response.status === 409 && result && "error" in result && result.error === "approval_required") {
      notify(t("approval.required"), "info");
      return;
    }
    if (!response.ok) {
      showError(result && "error" in result && result.error ? result.error : t("project.gitOperationFailed"));
      return;
    }
    notify(t("project.gitOperationDone"), "success");
    await onChange();
    await loadProjects(true);
    if (detailPanel?.project.id === project.id) void loadProjectGitOperations(project);
  }

  async function openProjectChanges(project: ProjectSummary) {
    setChangesPanel({ project, changes: null });
    await loadProjectChanges(project);
  }

  async function loadProjectChanges(project: ProjectSummary, selectedPath?: string) {
    const response = await fetch(`/api/projects/${project.id}/changes`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.changesReadFailed"));
      return;
    }
    const changes = (await response.json()) as WorkspaceChanges;
    const selectedFile = selectedPath ? changes.files.find((file) => file.path === selectedPath) : undefined;
    setChangesPanel({ project, changes, selectedFile });
  }

  async function copyProjectPatch(file?: WorkspaceChangeFile) {
    const value = file ? file.patch || file.newContent || "" : changesPanel?.changes?.raw.diff ?? "";
    if (!value) return;
    await copyText(value);
    notify(t("workspace.copyDiff"), "success");
  }

  async function revertProjectFile(file: WorkspaceChangeFile) {
    if (!changesPanel) return;
    const confirmed = await dialog.confirm({
      title: t("workspace.revertTitle"),
      message: file.path,
      confirmLabel: t("workspace.revert"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/projects/${changesPanel.project.id}/changes/revert-file`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    });
    if (!response.ok) {
      showError(t("workspace.revertFailed"));
      return;
    }
    const changes = (await response.json()) as WorkspaceChanges;
    setChangesPanel({ project: changesPanel.project, changes });
    notify(t("workspace.reverted"), "success");
  }

  async function projectGitFileAction(file: WorkspaceChangeFile, action: "stage" | "unstage") {
    if (!changesPanel) return;
    const response = await fetch(`/api/projects/${changesPanel.project.id}/changes/${action}-file`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    });
    if (!response.ok) {
      showError(action === "stage" ? t("workspace.stageFailed") : t("workspace.unstageFailed"));
      return;
    }
    const changes = (await response.json()) as WorkspaceChanges;
    setChangesPanel({ project: changesPanel.project, changes, selectedFile: changes.files.find((item) => item.path === file.path) });
    notify(action === "stage" ? t("workspace.staged") : t("workspace.unstaged"), "success");
  }

  async function openProjectDetail(project: ProjectSummary) {
    setDetailPanel({ project, stats: null, sessions: null, checks: null, gitOps: null });
    void loadProjectStats(project);
    void loadProjectSessions(project, false, "detail");
    void loadProjectGitOperations(project);
    await loadProjectCheckRuns(project, false);
  }

  async function loadProjectStats(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/stats`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const stats = (await response.json()) as ProjectStatsSummary;
    setDetailPanel((current) => current?.project.id === project.id ? { ...current, stats } : current);
  }

  async function loadProjectSessions(project: ProjectSummary, older: boolean, target: "detail" | "panel") {
    const currentCursor = older
      ? target === "detail" && detailPanel?.project.id === project.id
        ? detailPanel.sessionsCursor
        : target === "panel" && sessionsPanel?.project.id === project.id
          ? sessionsPanel.cursor
          : null
      : null;
    const params = new URLSearchParams({ limit: "10" });
    if (currentCursor) params.set("cursor", currentCursor);
    const response = await fetch(`/api/projects/${project.id}/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.sessionsReadFailed"));
      return;
    }
    const page = (await response.json()) as PageResponse<SessionSummary>;
    if (target === "detail") {
      setDetailPanel((panel) => panel?.project.id === project.id ? {
        ...panel,
        sessions: older ? [...(panel.sessions ?? []), ...page.items] : page.items,
        sessionsCursor: page.nextCursor,
        sessionsHasMore: page.hasMore,
      } : panel);
      return;
    }
    setSessionsPanel((panel) => panel?.project.id === project.id ? {
      project,
      sessions: older ? [...(panel.sessions ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    } : { project, sessions: page.items, cursor: page.nextCursor, hasMore: page.hasMore });
  }

  async function loadProjectGitOperations(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/git-operations?${new URLSearchParams({ limit: "10" })}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<ProjectGitOperationSummary>;
    setDetailPanel((current) => current?.project.id === project.id ? { ...current, gitOps: page.items } : current);
  }

  async function loadProjectCheckRuns(project: ProjectSummary, older: boolean) {
    const currentCursor = older && detailPanel?.project.id === project.id ? detailPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (currentCursor) params.set("cursor", currentCursor);
    const response = await fetch(`/api/projects/${project.id}/check-runs?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.checkHistoryReadFailed"));
      return;
    }
    const page = (await response.json()) as PageResponse<ProjectCheckRunSummary>;
    setDetailPanel((current) => ({
      project,
      stats: current?.project.id === project.id ? current.stats : null,
      sessions: current?.project.id === project.id ? current.sessions : null,
      sessionsCursor: current?.project.id === project.id ? current.sessionsCursor : null,
      sessionsHasMore: current?.project.id === project.id ? current.sessionsHasMore : false,
      gitOps: current?.project.id === project.id ? current.gitOps : null,
      checks: older && current?.project.id === project.id ? [...(current.checks ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function openProjectPreviews(project: ProjectSummary) {
    setPreviewPanel({ project, previews: null });
    await loadProjectPreviews(project);
  }

  async function loadProjectPreviews(project: ProjectSummary) {
    const params = new URLSearchParams({ scopeType: "project", scopeId: project.id });
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.previewReadFailed"));
      return;
    }
    setPreviewPanel({ project, previews: (await response.json()) as PreviewSummary[] });
  }

  useEffect(() => {
    if (!previewPanel?.previews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadProjectPreviews(previewPanel.project), 1500);
    return () => window.clearTimeout(timer);
  }, [previewPanel, sessionToken]);

  async function openProjectSessions(project: ProjectSummary) {
    setSessionsPanel({ project, sessions: null });
    await loadProjectSessions(project, false, "panel");
  }

  async function createProjectPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!previewPanel) return;
    const body: CreatePreviewRequest = {
      scopeType: "project",
      scopeId: previewPanel.project.id,
      label: `${previewPanel.project.name}:${previewPort}`,
      targetHost: "127.0.0.1",
      port: Number(previewPort),
      command: renderPreviewCommand(previewCommand, previewPort, previewDirectory),
      access: previewAccess,
      autoStart: true,
    };
    const response = await fetch("/api/previews", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        showError(t("approval.required"));
        await openProjectPreviews(previewPanel.project);
        return;
      }
      showError(result?.error ? `${t("project.previewStartFailed")}：${result.error}` : t("project.previewStartFailed"));
      return;
    }
    const preview = (await response.json()) as PreviewSummary;
    setPreviewPanel((current) => current ? { ...current, previews: [preview, ...(current.previews ?? []).filter((item) => item.id !== preview.id)] } : current);
    notify(t("project.previewStarted"), "success");
  }

  async function stopProjectPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviewPanel((current) => current ? {
      ...current,
      previews: (current.previews ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item),
    } : current);
  }

  async function deleteProjectPreview(preview: PreviewSummary) {
    const confirmed = await dialog.confirm({
      title: t("project.deletePreview"),
      message: `${preview.label}\n${preview.targetHost}:${preview.port}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.previewDeleteFailed"));
      return;
    }
    setPreviewPanel((current) => current ? {
      ...current,
      previews: (current.previews ?? []).filter((item) => item.id !== preview.id),
    } : current);
    notify(t("project.previewDeleted"), "success");
  }

  return (
    <main className="projects-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.projects")}`} title={t("page.projects")} action={t("action.refresh")} onAction={() => void loadProjects(true)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.projects")} />
      <section className="management-layout">
        <form className="management-form" onSubmit={createProject}>
          <strong>{t("project.createTitle")}</strong>
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.projectName")} required />
          {showWorkspacePathInput ? (
            <>
              <input name="workspacepath" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder={t("form.workspacePathOptional")} />
              <span className="subtle">{t("project.workspacePathAutoHint")}</span>
            </>
          ) : (
            <button className="ghost-button" type="button" onClick={() => setShowWorkspacePathInput(true)}><IconText icon={FolderOpen}>{t("project.useCustomWorkspacePath")}</IconText></button>
          )}
          {message && <span className="form-error">{message}</span>}
          <Button>{t("project.create")}</Button>
        </form>
        <section className="project-list-pane">
          <div className="project-list-head">
            <strong>{t("project.listTitle")}</strong>
            <span>{projectItems.length} {t("project.countSuffix")}</span>
          </div>
          <div className="thread-filters project-search-row">
            <input name="projectsearch" value={projectSearch} onChange={(event) => {
              const value = event.target.value;
              setProjectSearch(value);
              void loadProjects(true, value);
            }} placeholder={t("project.searchProjects")} />
          </div>
          <div className="project-list">
            {projectItems.map((project) => (
              <article className="project-list-card" key={project.id}>
                <div className="project-list-title">
                  <strong>{projectDisplayName(project, projectItems)}</strong>
                </div>
                <code>{project.workspacePath}</code>
                <div className="project-list-meta">
                  <span>{readableGitStatus(project.gitStatus, project.changedFiles, t)}</span>
                  <span>{t("project.gitBreakdown").replace("{staged}", String(project.stagedFiles ?? 0)).replace("{modified}", String(project.modifiedFiles ?? 0)).replace("{untracked}", String(project.untrackedFiles ?? 0))}</span>
                  <span>{project.gitBranch ? `branch: ${project.gitBranch}` : "no branch"}</span>
                  <span>{project.gitRemoteStatus ?? "no remote"}</span>
                  <span>{project.checkCommand ? `check: ${project.checkCommand}` : "no check command"}</span>
                  <span>{project.id}</span>
                </div>
                <div className="project-list-actions">
                  <button className="ghost-button icon-only" type="button" title={t("nav.files")} aria-label={t("nav.files")} onClick={() => setWorkspacePanel({ mode: "files", project })}><IconText icon={Files}>{t("nav.files")}</IconText></button>
                  <button className="ghost-button icon-only" type="button" title={t("nav.terminal")} aria-label={t("nav.terminal")} onClick={() => setWorkspacePanel({ mode: "terminal", project })}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
                  <button className="ghost-button icon-only" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => void openProjectDetail(project)}><IconText icon={Info}>{t("preview.details")}</IconText></button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="ghost-button icon-only" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void openProjectSessions(project)}><IconText icon={Bot}>{t("project.sessions")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onNewProjectSession(project.id)}><IconText icon={Send}>{t("session.newSession")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void openProjectChanges(project)}><IconText icon={Activity}>{t("project.changes")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void openProjectPreviews(project)}><IconText icon={Globe}>{t("project.preview")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void editProject(project)}><IconText icon={Pencil}>{t("action.edit")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void editCheckCommand(project)}><IconText icon={Save}>{t("project.setCheck")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem disabled={!project.checkCommand} onSelect={() => void runProjectCheck(project)}><IconText icon={Play}>{t("project.runCheck")}</IconText></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "pull")}><IconText icon={Download}>{t("project.gitPull")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "commit")}><IconText icon={Save}>{t("project.gitCommit")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "branch-create")}><IconText icon={FolderGit2}>{t("project.gitBranchCreate")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "branch-checkout")}><IconText icon={GitPullRequest}>{t("project.gitBranchCheckout")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "push")}><IconText icon={Globe}>{t("project.gitPush")}</IconText></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-red-700 focus:bg-red-50 focus:text-red-800" onSelect={() => deleteProject(project)}><IconText icon={Trash2}>{t("project.deleteProject")}</IconText></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            ))}
            {projectHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjects(false)}>{t("session.loadMore")}</button>}
            {!projectItems.length && <div className="empty-state">{t("project.noProjects")}</div>}
          </div>
        </section>
      </section>
      {workspacePanel && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{workspacePanel.mode === "files" ? t("workspace.projectFiles") : t("workspace.projectTerminal")}</strong>
              <span>{workspacePanel.project.workspacePath}</span>
            </div>
            <div className="workspace-modal-controls">
              <div className="workspace-modal-actions">
                <button className={`ghost-button icon-only ${workspacePanel.mode === "files" ? "active" : ""}`} type="button" title={t("nav.files")} aria-label={t("nav.files")} onClick={() => setWorkspacePanel({ ...workspacePanel, mode: "files" })}><IconText icon={Files}>{t("nav.files")}</IconText></button>
                <button className={`ghost-button icon-only ${workspacePanel.mode === "terminal" ? "active" : ""}`} type="button" title={t("nav.terminal")} aria-label={t("nav.terminal")} onClick={() => setWorkspacePanel({ ...workspacePanel, mode: "terminal" })}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
              </div>
              <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setWorkspacePanel(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="workspace-modal-body">
            {workspacePanel.mode === "files" && (
              <FilesPage sessionToken={sessionToken} t={t} initialRootPath={workspacePanel.project.workspacePath} initialMountName={workspacePanel.project.name} embedded />
            )}
            {workspacePanel.mode === "terminal" && (
              <TerminalPage sessionToken={sessionToken} t={t} initialCwd={workspacePanel.project.workspacePath} embedded />
            )}
          </div>
        </div>
      )}
      {detailPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{projectDisplayName(detailPanel.project, projectItems)}</strong>
              <span>{detailPanel.project.workspacePath}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setDetailPanel(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="preview-detail">
            <PreviewDetailRow label={t("project.projectId")} value={detailPanel.project.id} />
            <PreviewDetailRow label={t("project.git")} value={`${readableGitStatus(detailPanel.project.gitStatus, detailPanel.project.changedFiles, t)} · ${t("project.gitBreakdown").replace("{staged}", String(detailPanel.project.stagedFiles ?? 0)).replace("{modified}", String(detailPanel.project.modifiedFiles ?? 0)).replace("{untracked}", String(detailPanel.project.untrackedFiles ?? 0))}`} />
            <PreviewDetailRow label={t("project.branch")} value={detailPanel.project.gitBranch ?? "-"} />
            <PreviewDetailRow label={t("project.remote")} value={detailPanel.project.gitRemoteStatus ?? "-"} />
            <PreviewDetailRow label={t("project.checkCommand")} value={detailPanel.project.checkCommand ?? t("project.unconfigured")} />
            {Boolean(detailPanel.project.checkCommands?.length) && (
              <div className="preview-detail-row">
                <span>{t("project.checkCommands")}</span>
                <div className="detail-stack">
                  {detailPanel.project.checkCommands?.map((command) => (
                    <button className="file-list-item" key={command} type="button" onClick={() => void runProjectCheckCommand(detailPanel.project, command)}>
                      <span>{command}</span>
                      <em>{t("project.runCheck")}</em>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="project-stat-grid">
              <div><strong>{detailPanel.stats?.totalSessions ?? "-"}</strong><span>{t("project.totalSessions")}</span></div>
              <div><strong>{detailPanel.stats?.runningSessions ?? "-"}</strong><span>{t("project.runningSessions")}</span></div>
              <div><strong>{detailPanel.stats?.latestCheckStatus ?? "-"}</strong><span>{t("project.latestCheck")}</span></div>
              <div><strong>{Object.entries(detailPanel.stats?.previewStatusCounts ?? {}).map(([status, count]) => `${status}:${count}`).join(" · ") || "-"}</strong><span>{t("project.previewSummary")}</span></div>
            </div>
            <div className="preview-detail-row">
              <span>{t("project.sessions")}</span>
              <div className="detail-stack">
                {!detailPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
                {detailPanel.sessions?.map((session) => (
                  <button className="file-list-item" key={session.id} type="button" onClick={() => onOpenSession(session.id)}>
                    <span>{session.title}</span>
                    <em>{readableStatus(session.status, t)} · {formatShortDate(session.updatedAt)}</em>
                  </button>
                ))}
                {detailPanel.sessionsHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjectSessions(detailPanel.project, true, "detail")}>{t("session.loadMore")}</button>}
                {detailPanel.sessions && !detailPanel.sessions.length && <div className="empty-state">{t("project.noProjectSessions")}</div>}
              </div>
            </div>
            <div className="preview-detail-row">
              <span>{t("project.checkHistory")}</span>
              <div className="detail-stack">
                {!detailPanel.checks && <div className="subtle">{t("project.checkHistoryLoading")}</div>}
                {detailPanel.checks?.map((run) => (
                  <details className="check-run-detail" key={run.id}>
                    <summary>{run.status} · exit {run.exitCode ?? "null"} · {run.durationMs}ms · {formatShortDate(run.finishedAt ?? run.startedAt)}</summary>
                    <code>{run.command}</code>
                    <pre className="preview-logs">{[run.stdout, run.stderr].filter(Boolean).join("\n") || t("project.noOutput")}</pre>
                  </details>
                ))}
                {detailPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjectCheckRuns(detailPanel.project, true)}>{t("session.loadMore")}</button>}
                {detailPanel.checks && !detailPanel.checks.length && <div className="empty-state">{t("project.noCheckHistory")}</div>}
              </div>
            </div>
            <div className="preview-detail-row">
              <span>{t("project.gitHistory")}</span>
              <div className="detail-stack">
                {!detailPanel.gitOps && <div className="subtle">{t("session.loading")}</div>}
                {detailPanel.gitOps?.map((op) => (
                  <details className="check-run-detail" key={op.id}>
                    <summary>{op.operation} · {op.status} · exit {op.exitCode ?? "null"} · {formatShortDate(op.createdAt)}</summary>
                    <code>git {op.args.join(" ")}</code>
                    <pre className="preview-logs">{[op.stdout, op.stderr].filter(Boolean).join("\n") || t("project.noOutput")}</pre>
                  </details>
                ))}
                {detailPanel.gitOps && !detailPanel.gitOps.length && <div className="empty-state">{t("project.noGitHistory")}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
      {changesPanel && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.changes")}</strong>
              <span>{changesPanel.project.workspacePath}</span>
            </div>
            <div className="workspace-modal-controls">
              <div className="workspace-modal-actions">
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadProjectChanges(changesPanel.project, changesPanel.selectedFile?.path)}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("workspace.copyAll")} aria-label={t("workspace.copyAll")} disabled={!changesPanel.changes?.raw.diff} onClick={() => void copyProjectPatch()}><IconText icon={Copy}>{t("workspace.copyAll")}</IconText></button>
              </div>
              <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setChangesPanel(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="project-changes-layout">
            <aside className="project-change-files">
              {!changesPanel.changes && <div className="subtle">{t("project.loadingChanges")}</div>}
              {changesPanel.changes && !changesPanel.changes.isGitRepo && <div className="empty-state">{t("project.notGitRepo")}</div>}
              {changesPanel.changes?.files.map((file) => (
                <button className={`file-list-item ${changesPanel.selectedFile?.path === file.path ? "active" : ""}`} key={file.path} type="button" onClick={() => setChangesPanel({ ...changesPanel, selectedFile: file })}>
                  <span>{file.status} {file.path}</span>
                  <em>+{file.additions} -{file.deletions}</em>
                </button>
              ))}
              {changesPanel.changes?.isGitRepo && !changesPanel.changes.files.length && <div className="empty-state">{t("project.noChanges")}</div>}
            </aside>
            <section className="project-change-diff">
              <div className="file-preview-head">
                <div>
                  <strong>{changesPanel.selectedFile?.path ?? t("project.selectChangedFile")}</strong>
                  <div className="subtle">{changesPanel.changes ? `${changesPanel.changes.summary.filesChanged} files · +${changesPanel.changes.summary.additions} -${changesPanel.changes.summary.deletions}` : ""}</div>
                </div>
                {changesPanel.selectedFile && (
                  <div className="workspace-modal-actions">
                    <button className="ghost-button icon-only" type="button" title={t("project.openFile")} aria-label={t("project.openFile")} onClick={() => setWorkspacePanel({ mode: "files", project: changesPanel.project })}><IconText icon={FolderOpen}>{t("project.openFile")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("workspace.stageFile")} aria-label={t("workspace.stageFile")} onClick={() => changesPanel.selectedFile && void projectGitFileAction(changesPanel.selectedFile, "stage")}><IconText icon={Save}>{t("workspace.stageFile")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("workspace.unstageFile")} aria-label={t("workspace.unstageFile")} onClick={() => changesPanel.selectedFile && void projectGitFileAction(changesPanel.selectedFile, "unstage")}><IconText icon={RotateCcw}>{t("workspace.unstageFile")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("workspace.copyPatch")} aria-label={t("workspace.copyPatch")} onClick={() => void copyProjectPatch(changesPanel.selectedFile)}><IconText icon={Copy}>{t("workspace.copyPatch")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" title={t("workspace.revertFile")} aria-label={t("workspace.revertFile")} onClick={() => changesPanel.selectedFile && void revertProjectFile(changesPanel.selectedFile)}><IconText icon={RotateCcw}>{t("workspace.revertFile")}</IconText></button>
                  </div>
                )}
              </div>
              <pre className="large-code diff-view">{changesPanel.selectedFile?.patch || changesPanel.changes?.raw.status || t("project.waitingChangedFile")}</pre>
            </section>
          </div>
        </div>
      )}
      {sessionsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.sessions")}</strong>
              <span>{projectDisplayName(sessionsPanel.project, projectItems)}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSessionsPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {!sessionsPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
            {sessionsPanel.sessions?.map((session) => (
              <button className="file-list-item" key={session.id} type="button" onClick={() => {
                setSessionsPanel(null);
                onOpenSession(session.id);
              }}>
                <span>{session.title}</span>
                <em>{readableStatus(session.status, t)} · {formatShortDate(session.updatedAt)}</em>
              </button>
            ))}
            {sessionsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjectSessions(sessionsPanel.project, true, "panel")}>{t("session.loadMore")}</button>}
            {sessionsPanel.sessions && !sessionsPanel.sessions.length && <div className="empty-state">{t("project.noProjectSessions")}</div>}
          </div>
        </div>
      )}
      {previewPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.preview")}</strong>
              <span>{projectDisplayName(previewPanel.project, projectItems)}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setPreviewPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            <form className="preview-form" onSubmit={createProjectPreview}>
              <label>
                <span>{t("project.previewCommand")}</span>
                <input name="previewcommand-2" value={previewCommand} onChange={(event) => setPreviewCommand(event.target.value)} placeholder="python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}" required />
              </label>
              <label>
                <span>{t("project.previewDirectory")}</span>
                <PreviewDirectoryPicker sessionToken={sessionToken} rootPath={previewPanel.project.workspacePath} value={previewDirectory} onChange={setPreviewDirectory} placeholder="preview-demo" t={t} />
              </label>
              <label>
                <span>{t("project.previewPort")}</span>
                <input name="previewport-2" value={previewPort} onChange={(event) => setPreviewPort(event.target.value)} inputMode="numeric" placeholder="4179" required />
              </label>
              <label>
                <span>{t("preview.access")}</span>
                <select name="previewaccess-2" value={previewAccess} onChange={(event) => setPreviewAccess(event.target.value as PreviewAccess)}>
                  <option value="private">{t("preview.private")}</option>
                  <option value="public">{t("preview.public")}</option>
                </select>
              </label>
              <button className="ghost-button" type="submit"><IconText icon={Play}>{t("project.startPreview")}</IconText></button>
            </form>
            {!previewPanel.previews && <div className="subtle">{t("project.loadingPreviews")}</div>}
            {previewPanel.previews?.map((preview) => (
              <div className="preview-row" key={preview.id}>
                <div>
                  <strong>{preview.label}</strong>
                  <span>{preview.status} · {preview.access} · {preview.targetHost}:{preview.port}</span>
                  {preview.command && <code>{preview.command}</code>}
                </div>
                <div className="preview-actions">
                  <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, notify, t)}>{t("project.openPreview")}</button>
                  <button className="ghost-button" type="button" disabled={preview.status !== "running" && preview.status !== "starting"} onClick={() => void stopProjectPreview(preview)}>{t("action.disconnect")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteProjectPreview(preview)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {previewPanel.previews && !previewPanel.previews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      )}
      {checkResult && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.projectCheck")}</strong>
              <span>{checkResult.project.checkCommand ?? t("project.unconfigured")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setCheckResult(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {!checkResult.result && <div className="subtle">{t("project.checkRunning")}</div>}
            {checkResult.result && (
              <>
                <code>{checkResult.result.cwd} · {t("project.exitCode")} {checkResult.result.exitCode ?? "null"} · {checkResult.result.durationMs}ms</code>
                <button className="ghost-button" type="button" onClick={() => checkResult.result && void onAnalyzeProjectCheck(checkResult.project, checkResult.result)}><IconText icon={Bot}>{t("project.analyzeWithCodex")}</IconText></button>
                <pre className="extension-detail-content">{[checkResult.result.stdout, checkResult.result.stderr].filter(Boolean).join("\n") || t("project.noOutput")}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function ProvidersPage({
  sessionToken,
  providers,
  onChange,
  t,
  notify,
  onOpenMainNav,
}: {
  sessionToken: string;
  providers: ProviderSummary[];
  onChange: () => Promise<void>;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog(t);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderSummary["kind"]>("openai-compatible-chat");
  const [defaultModel, setDefaultModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [rpmLimit, setRpmLimit] = useState("");
  const [rpmLimitEnabled, setRpmLimitEnabled] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities>({
    responsesApi: false,
    chatCompletions: true,
    tools: true,
    jsonMode: true,
    vision: false,
    streaming: true,
  });
  const [message, setMessage] = useState("");
  const [testingProviderId, setTestingProviderId] = useState("");
  const [detectingProviderInterfaceId, setDetectingProviderInterfaceId] = useState("");
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResponse>>({});
  const [discoveringProviderId, setDiscoveringProviderId] = useState("");
  const [modelResults, setModelResults] = useState<Record<string, ProviderModelsResponse>>({});
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({});
  const [modelVisible, setModelVisible] = useState<Record<string, number>>({});
  const [discoveringDraftModels, setDiscoveringDraftModels] = useState(false);
  const [detectingDraftInterface, setDetectingDraftInterface] = useState(false);
  const [draftModels, setDraftModels] = useState<ProviderModelsResponse | null>(null);
  const [discoveringEditModels, setDiscoveringEditModels] = useState(false);
  const [editModels, setEditModels] = useState<ProviderModelsResponse | null>(null);
  const [providerModelPicker, setProviderModelPicker] = useState<{
    target: "draft" | "edit";
    title: string;
    result: ProviderModelsResponse;
  } | null>(null);
  const [healthPanel, setHealthPanel] = useState<{ provider: ProviderSummary; checks: ProviderHealthCheck[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [editPanel, setEditPanel] = useState<{
    provider: ProviderSummary;
    name: string;
    kind: ProviderSummary["kind"];
    defaultModel: string;
    baseUrl: string;
    apiKey: string;
    rpmLimit: string;
    rpmLimitEnabled: boolean;
    useProxy: boolean;
    capabilities: ProviderCapabilities;
  } | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [providerKindFilter, setProviderKindFilter] = useState<ProviderSummary["kind"] | "all">("all");
  const capabilityItems: Array<{ key: keyof ProviderCapabilities; label: string }> = [
    { key: "responsesApi", label: t("provider.capabilityResponses") },
    { key: "chatCompletions", label: t("provider.capabilityChat") },
    { key: "tools", label: t("provider.capabilityTools") },
    { key: "jsonMode", label: t("provider.capabilityJson") },
    { key: "vision", label: t("provider.capabilityVision") },
    { key: "streaming", label: t("provider.capabilityStreaming") },
  ];
  const providerSearchText = providerSearch.trim().toLowerCase();
  const visibleProviders = providers.filter((provider) => {
    if (providerKindFilter !== "all" && provider.kind !== providerKindFilter) return false;
    if (!providerSearchText) return true;
    return [
      provider.name,
      provider.kind,
      provider.defaultModel,
      provider.baseUrl ?? "",
      provider.rpmLimitEnabled && provider.rpmLimit ? `${t("provider.rpmLimit")} ${provider.rpmLimit}` : t("provider.rpmDisabled"),
      provider.useProxy ? t("provider.proxyLocal") : t("provider.proxyDirect"),
      provider.apiKeyConfigured ? t("provider.keyConfigured") : t("provider.keyMissing"),
    ].some((value) => value.toLowerCase().includes(providerSearchText));
  });

  function showError(value: string) {
    setMessage(value);
    notify(value, "error");
  }

  async function providerError(response: Response, fallback: string) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? `${fallback}: http_${response.status}`;
  }

  function openProviderModelPicker(target: "draft" | "edit", result: ProviderModelsResponse) {
    setProviderModelPicker({
      target,
      title: target === "draft" ? t("provider.createTitle") : editPanel?.provider.name ?? t("provider.editTitle"),
      result,
    });
  }

  function selectProviderModelFromDialog(model: string) {
    if (!providerModelPicker) return;
    if (providerModelPicker.target === "draft") {
      setDefaultModel(model);
    } else {
      setEditPanel((current) => current ? { ...current, defaultModel: model } : current);
    }
    setProviderModelPicker(null);
  }

  async function createProvider(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (kind !== "local" && !apiKey.trim()) {
      showError(t("provider.apiKeyRequired"));
      return;
    }
    if (rpmLimitEnabled && !rpmLimit.trim()) {
      showError(t("provider.rpmRequired"));
      return;
    }
    let detectedKind = kind;
    let detectedCapabilities = capabilities;
    if (kind !== "local") {
      setDetectingDraftInterface(true);
      const detected = await requestDraftInterfaceDetection();
      setDetectingDraftInterface(false);
      if (detected?.ok) {
        detectedKind = detected.kind;
        detectedCapabilities = detected.capabilities;
        setKind(detectedKind);
        setCapabilities(detectedCapabilities);
      } else {
        notify(detected?.error ?? t("provider.detectFailed"), "info");
      }
    }
    if (detectedKind === "openai-compatible-chat" && !baseUrl.trim()) {
      showError(t("provider.baseUrlRequired"));
      return;
    }
    const body: CreateProviderRequest = {
      name,
      kind: detectedKind,
      defaultModel,
      baseUrl,
      apiKey,
      capabilities: detectedCapabilities,
      rpmLimit: rpmLimit.trim() ? Number(rpmLimit) : null,
      rpmLimitEnabled,
      useProxy: detectedKind === "openai-responses" && useProxy,
    };
    const response = await fetch("/api/providers", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("provider.createFailed"));
      return;
    }
    setName("");
    setDefaultModel("");
    setBaseUrl("");
    setApiKey("");
    setRpmLimit("");
    setRpmLimitEnabled(false);
    setUseProxy(false);
    setCapabilities(defaultProviderCapabilitiesForKind(detectedKind));
    setDraftModels(null);
    setCreatePanelOpen(false);
    await onChange();
    notify(t("provider.created"), "success");
  }

  async function testProvider(providerId: string) {
    setTestingProviderId(providerId);
    const response = await fetch(`/api/providers/${providerId}/test`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const result = response.ok
      ? ((await response.json()) as ProviderTestResponse)
      : {
          ok: false,
          providerId,
          status: response.status,
          durationMs: 0,
          error: await providerError(response, "provider_test_failed"),
        };
    setTestResults((items) => ({ ...items, [providerId]: result }));
    setTestingProviderId("");
  }

  async function detectProviderInterface(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    setDetectingProviderInterfaceId(providerId);
    const response = await fetch(`/api/providers/${providerId}/detect`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const result = response.ok
      ? ((await response.json()) as { provider: ProviderSummary; detection: ProviderDetectionResponse })
      : null;
    if (!result?.detection.ok) {
      showError(result?.detection.error ?? await providerError(response, "provider_detection_failed"));
      setDetectingProviderInterfaceId("");
      return;
    }
    const currentCapabilities = { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}) };
    const detectedCapabilities = result.detection.capabilities;
    const capabilitiesChanged = capabilityItems.some((item) => currentCapabilities[item.key] !== detectedCapabilities[item.key]);
    const kindChanged = provider.kind !== result.detection.kind;
    if (kindChanged || capabilitiesChanged) {
      const kindLabel = (value: ProviderSummary["kind"]) => value === "openai-responses" ? t("provider.kindResponses") : value === "openai-compatible-chat" ? t("provider.kindCompatible") : t("provider.kindLocal");
      const confirmed = await dialog.confirm({
        title: t("provider.applyDetectionTitle"),
        message: t("provider.applyDetectionMessage")
          .replace("{current}", kindLabel(provider.kind))
          .replace("{detected}", kindLabel(result.detection.kind)),
        confirmLabel: t("provider.applyDetection"),
      });
      if (!confirmed) {
        const messageKey = result.detection.kind === "openai-responses" ? "provider.detectedResponses" : "provider.detectedChat";
        notify(t(messageKey), "info");
        setDetectingProviderInterfaceId("");
        return;
      }
      const applyResponse = await fetch(`/api/providers/${providerId}/detect?apply=1`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
      });
      if (!applyResponse.ok) {
        showError(await providerError(applyResponse, "provider_detection_apply_failed"));
        setDetectingProviderInterfaceId("");
        return;
      }
    }
    await onChange();
    const messageKey = result.detection.kind === "openai-responses" ? "provider.detectedResponses" : "provider.detectedChat";
    notify(t(messageKey), "success");
    setDetectingProviderInterfaceId("");
  }

  async function discoverModels(providerId: string) {
    setDiscoveringProviderId(providerId);
    const response = await fetch(`/api/providers/${providerId}/models?refresh=1`, {
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const result = response.ok
      ? ((await response.json()) as ProviderModelsResponse)
      : {
          ok: false,
          providerId,
          models: [],
          status: response.status,
          durationMs: 0,
          error: await providerError(response, "provider_models_failed"),
        };
    setModelResults((items) => ({ ...items, [providerId]: result }));
    if (result.ok) await onChange();
    setDiscoveringProviderId("");
  }

  async function discoverDraftModels() {
    setDiscoveringDraftModels(true);
    setMessage("");
    const body: CreateProviderRequest = {
      name: name || t("provider.draftName"),
      kind,
      defaultModel,
      baseUrl,
      apiKey,
      rpmLimit: rpmLimit.trim() ? Number(rpmLimit) : null,
      rpmLimitEnabled,
      useProxy: kind === "openai-responses" && useProxy,
    };
    const response = await fetch("/api/providers/models", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = response.ok
      ? ((await response.json()) as ProviderModelsResponse)
      : {
          ok: false,
          providerId: "draft",
          models: [],
          status: response.status,
          durationMs: 0,
          error: await providerError(response, "provider_models_failed"),
    };
    setDraftModels(result);
    openProviderModelPicker("draft", result);
    if (result.models[0] && !defaultModel) setDefaultModel(result.models[0]);
    setDiscoveringDraftModels(false);
  }

  async function discoverEditProviderModels() {
    if (!editPanel) return;
    setDiscoveringEditModels(true);
    setMessage("");
    const useDraftConfig = Boolean(editPanel.apiKey.trim()) || !editPanel.provider.apiKeyConfigured;
    let result: ProviderModelsResponse;
    if (useDraftConfig) {
      const body: CreateProviderRequest = {
        name: editPanel.name || editPanel.provider.name || t("provider.draftName"),
        kind: editPanel.kind,
        defaultModel: editPanel.defaultModel,
        baseUrl: editPanel.baseUrl,
        apiKey: editPanel.apiKey,
        rpmLimit: editPanel.rpmLimit.trim() ? Number(editPanel.rpmLimit) : null,
        rpmLimitEnabled: editPanel.rpmLimitEnabled,
        useProxy: editPanel.kind === "openai-responses" && editPanel.useProxy,
        capabilities: editPanel.capabilities,
      };
      const response = await fetch("/api/providers/models", {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      result = response.ok
        ? ((await response.json()) as ProviderModelsResponse)
        : {
            ok: false,
            providerId: editPanel.provider.id,
            models: [],
            status: response.status,
            durationMs: 0,
            error: await providerError(response, "provider_models_failed"),
          };
    } else {
      const response = await fetch(`/api/providers/${editPanel.provider.id}/models?refresh=1`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      result = response.ok
        ? ((await response.json()) as ProviderModelsResponse)
        : {
            ok: false,
            providerId: editPanel.provider.id,
            models: [],
            status: response.status,
            durationMs: 0,
            error: await providerError(response, "provider_models_failed"),
          };
    }
    setEditModels(result);
    openProviderModelPicker("edit", result);
    if (result.models[0] && !editPanel.defaultModel) {
      setEditPanel((current) => current ? { ...current, defaultModel: result.models[0] } : current);
    }
    if (result.ok) await onChange();
    setDiscoveringEditModels(false);
  }

  async function requestDraftInterfaceDetection() {
    const body: CreateProviderRequest = {
      name: name || t("provider.draftName"),
      kind,
      defaultModel,
      baseUrl,
      apiKey,
      capabilities,
      rpmLimit: rpmLimit.trim() ? Number(rpmLimit) : null,
      rpmLimitEnabled,
      useProxy: kind === "openai-responses" && useProxy,
    };
    const response = await fetch("/api/providers/detect", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return response.ok
      ? ((await response.json()) as ProviderDetectionResponse)
      : {
          ok: false,
          providerId: "draft",
          kind,
          capabilities,
          durationMs: 0,
          checks: {
            responses: { ok: false, status: response.status },
            chatCompletions: { ok: false, status: response.status },
          },
          error: await providerError(response, "provider_detection_failed"),
        };
  }

  async function detectDraftInterface() {
    setDetectingDraftInterface(true);
    setMessage("");
    const result = await requestDraftInterfaceDetection();
    if (!result.ok) {
      showError(result.error ?? t("provider.detectFailed"));
      setDetectingDraftInterface(false);
      return;
    }
    setKind(result.kind);
    setCapabilities(result.capabilities);
    const messageKey = result.kind === "openai-responses" ? "provider.detectedResponses" : "provider.detectedChat";
    setMessage(t(messageKey));
    notify(t(messageKey), "success");
    setDetectingDraftInterface(false);
  }

  async function applyDefaultModel(providerId: string, model: string) {
    const body: UpdateProviderRequest = { defaultModel: model };
    const response = await fetch(`/api/providers/${providerId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) await onChange();
    if (response.ok) notify(t("provider.updated"), "success");
  }

  function defaultProviderCapabilitiesForKind(nextKind: ProviderSummary["kind"]): ProviderCapabilities {
    return {
      responsesApi: nextKind === "openai-responses",
      chatCompletions: nextKind === "openai-compatible-chat" || nextKind === "local",
      tools: nextKind !== "local",
      jsonMode: nextKind !== "local",
      vision: false,
      streaming: true,
    };
  }

  async function toggleProviderCapability(provider: ProviderSummary, key: keyof ProviderCapabilities) {
    const nextCapabilities = { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}), [key]: !(provider.capabilities ?? defaultProviderCapabilitiesForKind(provider.kind))[key] };
    const body: UpdateProviderRequest = { capabilities: nextCapabilities };
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await onChange();
      notify(t("provider.updated"), "success");
    }
  }

  async function toggleProviderProxy(provider: ProviderSummary) {
    const body: UpdateProviderRequest = { useProxy: !provider.useProxy };
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await onChange();
      notify(t("provider.updated"), "success");
    }
  }

  async function toggleProviderRpmLimit(provider: ProviderSummary) {
    const body: UpdateProviderRequest = { rpmLimitEnabled: !provider.rpmLimitEnabled };
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await onChange();
      notify(t("provider.updated"), "success");
    }
  }

  function openEditProvider(provider: ProviderSummary) {
    setEditModels(provider.models?.length ? {
      ok: true,
      providerId: provider.id,
      models: provider.models,
      status: null,
      durationMs: 0,
    } : null);
    setEditPanel({
      provider,
      name: provider.name,
      kind: provider.kind,
      defaultModel: provider.defaultModel,
      baseUrl: provider.baseUrl ?? "",
      apiKey: "",
      rpmLimit: provider.rpmLimit ? String(provider.rpmLimit) : "",
      rpmLimitEnabled: provider.rpmLimitEnabled ?? false,
      useProxy: provider.useProxy ?? false,
      capabilities: { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}) },
    });
  }

  async function saveEditedProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!editPanel) return;
    if (!editPanel.name.trim() || !editPanel.defaultModel.trim()) {
      showError(t("provider.createFailed"));
      return;
    }
    if (editPanel.kind === "openai-compatible-chat" && !editPanel.baseUrl.trim()) {
      showError(t("provider.baseUrlRequired"));
      return;
    }
    if (editPanel.kind !== "local" && !editPanel.provider.apiKeyConfigured && !editPanel.apiKey.trim()) {
      showError(t("provider.apiKeyRequired"));
      return;
    }
    if (editPanel.rpmLimitEnabled && !editPanel.rpmLimit.trim()) {
      showError(t("provider.rpmRequired"));
      return;
    }
    const body: UpdateProviderRequest = {
      name: editPanel.name.trim(),
      kind: editPanel.kind,
      defaultModel: editPanel.defaultModel.trim(),
      baseUrl: editPanel.baseUrl,
      rpmLimit: editPanel.rpmLimit.trim() ? Number(editPanel.rpmLimit) : null,
      rpmLimitEnabled: editPanel.rpmLimitEnabled,
      useProxy: editPanel.kind === "openai-responses" && editPanel.useProxy,
      capabilities: editPanel.capabilities,
    };
    if (editPanel.apiKey.trim()) body.apiKey = editPanel.apiKey;
    const response = await fetch(`/api/providers/${editPanel.provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("provider.updateFailed"));
      return;
    }
    setEditPanel(null);
    setEditModels(null);
    await onChange();
    notify(t("provider.updated"), "success");
  }

  function renderModelPicker(key: string, result: ProviderModelsResponse, selectedModel: string, onSelect: (model: string) => void, onClose?: () => void) {
    const query = modelSearch[key]?.trim().toLowerCase() ?? "";
    const visible = modelVisible[key] ?? 20;
    const models = result.models.filter((model) => !query || model.toLowerCase().includes(query));
    return (
      <div className="model-list">
        <div className="model-list-head">
          <span>{result.models.length ? String(result.models.length) : t("provider.noModels")}</span>
          {onClose && <button className="ghost-button icon-only" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={onClose}><X size={14} /></button>}
        </div>
        {result.models.length > 8 && (
          <input name="modelsearch-key"
            className="model-search"
            value={modelSearch[key] ?? ""}
            onChange={(event) => {
              setModelSearch((items) => ({ ...items, [key]: event.target.value }));
              setModelVisible((items) => ({ ...items, [key]: 20 }));
            }}
            placeholder={t("provider.searchModels")}
          />
        )}
        {models.length === 0 && <span className="result-error">{result.error ?? t("provider.noModels")} · {result.status ?? t("provider.noStatus")} · {result.durationMs}ms</span>}
        {models.slice(0, visible).map((model) => (
          <button className="model-chip" type="button" key={model} onClick={() => onSelect(model)}>
            {model === selectedModel ? "✓ " : ""}{model}
          </button>
        ))}
        {models.length > visible && (
          <button className="ghost-button load-more" type="button" onClick={() => setModelVisible((items) => ({ ...items, [key]: visible + 20 }))}>{t("session.loadMore")}</button>
        )}
      </div>
    );
  }

  async function deleteProvider(providerId: string, providerName: string) {
    const confirmed = await dialog.confirm({
      title: t("provider.deleteProvider"),
      message: providerName,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/providers/${providerId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    if (!response.ok) return;
    setTestResults((items) => {
      const next = { ...items };
      delete next[providerId];
      return next;
    });
    setModelResults((items) => {
      const next = { ...items };
      delete next[providerId];
      return next;
    });
    await onChange();
    notify(t("provider.deleted"), "success");
  }

  async function openProviderHealth(provider: ProviderSummary, older = false) {
    if (!older) setHealthPanel({ provider, checks: null });
    const cursor = older && healthPanel?.provider.id === provider.id ? healthPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/providers/${provider.id}/health?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<ProviderHealthCheck>;
    setHealthPanel((current) => ({
      provider,
      checks: older && current?.provider.id === provider.id ? [...(current.checks ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  return (
    <main className="management-page provider-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.providers")}`} title={t("page.providers")} action={t("action.refresh")} onAction={() => void onChange()} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.providers")} />
      <section className="management-layout">
        <form className="management-form" onSubmit={createProvider}>
          <strong>{t("provider.createTitle")}</strong>
          <input name="name-2" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.providerName")} required />
          <select name="kind" value={kind} onChange={(event) => {
            const nextKind = event.target.value as ProviderSummary["kind"];
            setKind(nextKind);
            setCapabilities(defaultProviderCapabilitiesForKind(nextKind));
          }}>
            <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
            <option value="openai-responses">{t("provider.kindResponses")}</option>
            <option value="local">{t("provider.kindLocal")}</option>
          </select>
          <input name="baseurl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("form.baseUrl")} />
          <input name="apikey" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("form.apiKey")} type="password" />
          <input name="defaultmodel" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder={t("form.defaultModel")} required />
          <input name="rpmlimit" value={rpmLimit} onChange={(event) => setRpmLimit(event.target.value)} placeholder={t("form.rpmLimit")} type="number" min="1" inputMode="numeric" />
          <label className="checkbox-row">
            <input name="rpmlimitenabled" type="checkbox" checked={rpmLimitEnabled} onChange={(event) => setRpmLimitEnabled(event.target.checked)} />
            <span>{t("provider.rpmEnabled")}</span>
          </label>
          {kind === "openai-responses" && (
            <label className="checkbox-row">
              <input name="useproxy" type="checkbox" checked={useProxy} onChange={(event) => setUseProxy(event.target.checked)} />
              <span>{t("provider.useProxy")}</span>
            </label>
          )}
          <button className="ghost-button" type="button" onClick={detectDraftInterface} disabled={detectingDraftInterface || !defaultModel.trim()}>
            <IconText icon={Activity}>{detectingDraftInterface ? t("provider.detecting") : t("provider.detectInterface")}</IconText>
          </button>
          <button className="ghost-button" type="button" onClick={discoverDraftModels} disabled={discoveringDraftModels}>
            <IconText icon={RefreshCw}>{discoveringDraftModels ? t("provider.detecting") : t("provider.detectModels")}</IconText>
          </button>
          {draftModels && (
            <button className="ghost-button" type="button" onClick={() => openProviderModelPicker("draft", draftModels)}>
              {t("provider.detectModels")} · {draftModels.models.length || t("provider.noModels")}
            </button>
          )}
          {message && <span className="form-error">{message}</span>}
          <button className="dark-button"><IconText icon={Save}>{t("provider.saveProvider")}</IconText></button>
        </form>
        <section className="management-grid provider-management-grid">
          <div className="project-list-head">
            <strong>{t("page.providers")}</strong>
            <div className="project-list-head-actions">
              <span>{visibleProviders.length}/{providers.length}</span>
              <Button className="provider-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("provider.createTitle")} aria-label={t("provider.createTitle")} onClick={() => setCreatePanelOpen(true)}><Plus size={16} /></Button>
            </div>
          </div>
          <FilterToolbar className="provider-filter-toolbar">
            <FilterSearchInput value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder={t("provider.searchProviders")} />
            <select name="providerkindfilter" className="filter-select" value={providerKindFilter} onChange={(event) => setProviderKindFilter(event.target.value as ProviderSummary["kind"] | "all")}>
              <option value="all">{t("provider.allKinds")}</option>
              <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
              <option value="openai-responses">{t("provider.kindResponses")}</option>
              <option value="local">{t("provider.kindLocal")}</option>
            </select>
            <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void onChange()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
          </FilterToolbar>
          {visibleProviders.map((provider) => (
            <div className="provider-card" key={provider.id}>
              <strong>{provider.name}</strong>
              <span>{provider.kind} · {provider.defaultModel}</span>
              <span>{provider.baseUrl ?? t("provider.defaultEndpoint")} · {t("provider.keyLabel")} {provider.apiKeyConfigured ? t("provider.keyConfigured") : t("provider.keyMissing")} · {provider.rpmLimitEnabled && provider.rpmLimit ? `${t("provider.rpmLimit")} ${provider.rpmLimit}` : t("provider.rpmDisabled")} · {provider.useProxy ? t("provider.proxyLocal") : t("provider.proxyDirect")}</span>
              {provider.rpmLimit && (
                <label className="checkbox-row">
                  <input name="provider-rpmlimitenabled" type="checkbox" checked={provider.rpmLimitEnabled ?? false} onChange={() => void toggleProviderRpmLimit(provider)} />
                  <span>{t("provider.rpmEnabled")}</span>
                </label>
              )}
              {provider.kind === "openai-responses" && (
                <label className="checkbox-row">
                  <input name="provider-useproxy" type="checkbox" checked={provider.useProxy ?? false} onChange={() => void toggleProviderProxy(provider)} />
                  <span>{t("provider.useProxy")}</span>
                </label>
              )}
              <div className="checkbox-grid compact-capabilities">
                {capabilityItems.map((item) => {
                  const current = { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}) };
                  return (
                    <label key={item.key}>
                      <input name="current-item-key" type="checkbox" checked={current[item.key]} onChange={() => void toggleProviderCapability(provider, item.key)} />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
              {testResults[provider.id] && (
                <span className={testResults[provider.id].ok ? "result-ok" : "result-error"}>
                  {testResults[provider.id].ok ? t("provider.testOk") : t("provider.testFailed")} · {testResults[provider.id].status ?? t("provider.noStatus")} · {testResults[provider.id].durationMs}ms
                  {testResults[provider.id].error ? ` · ${testResults[provider.id].error}` : ""}
                </span>
              )}
              <div className="provider-card-actions">
                <button className="ghost-button" type="button" onClick={() => openEditProvider(provider)}>
                  <IconText icon={Pencil}>{t("provider.editTitle")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => testProvider(provider.id)} disabled={testingProviderId === provider.id}>
                  <IconText icon={Activity}>{testingProviderId === provider.id ? t("provider.testing") : t("provider.testConnection")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => detectProviderInterface(provider.id)} disabled={detectingProviderInterfaceId === provider.id}>
                  <IconText icon={Activity}>{detectingProviderInterfaceId === provider.id ? t("provider.detecting") : t("provider.detectInterface")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => discoverModels(provider.id)} disabled={discoveringProviderId === provider.id}>
                  <IconText icon={RefreshCw}>{discoveringProviderId === provider.id ? t("provider.detecting") : t("provider.detectModels")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => void openProviderHealth(provider)}>
                  <IconText icon={History}>{t("provider.healthHistory")}</IconText>
                </button>
                <button className="ghost-button danger-button" type="button" onClick={() => deleteProvider(provider.id, provider.name)}>
                  <IconText icon={Trash2}>{t("action.delete")}</IconText>
                </button>
              </div>
              <div className="provider-card-action-menu">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("provider.editTitle")} aria-label={t("provider.editTitle")} onClick={() => openEditProvider(provider)}><IconText icon={Pencil}>{t("provider.editTitle")}</IconText></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={testingProviderId === provider.id} onSelect={() => void testProvider(provider.id)}><IconText icon={Activity}>{testingProviderId === provider.id ? t("provider.testing") : t("provider.testConnection")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem disabled={detectingProviderInterfaceId === provider.id} onSelect={() => void detectProviderInterface(provider.id)}><IconText icon={Activity}>{detectingProviderInterfaceId === provider.id ? t("provider.detecting") : t("provider.detectInterface")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem disabled={discoveringProviderId === provider.id} onSelect={() => void discoverModels(provider.id)}><IconText icon={RefreshCw}>{discoveringProviderId === provider.id ? t("provider.detecting") : t("provider.detectModels")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void openProviderHealth(provider)}><IconText icon={History}>{t("provider.healthHistory")}</IconText></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="danger-menu-item" onSelect={() => deleteProvider(provider.id, provider.name)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {modelResults[provider.id] && (
                renderModelPicker(provider.id, modelResults[provider.id], provider.defaultModel, (model) => void applyDefaultModel(provider.id, model), () => setModelResults((items) => {
                  const next = { ...items };
                  delete next[provider.id];
                  return next;
                }))
              )}
            </div>
          ))}
          {!visibleProviders.length && <div className="empty-state">{t("provider.noProviders")}</div>}
        </section>
      </section>
      {healthPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.healthTitle")}</strong>
              <span>{healthPanel.provider.name}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setHealthPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {!healthPanel.checks && <div className="subtle">{t("provider.healthLoading")}</div>}
            {healthPanel.checks?.map((check) => (
              <div className="provider-health-row" key={check.id}>
                <strong>{check.kind} · {check.ok ? t("provider.testOk") : t("provider.testFailed")}</strong>
                <span>{check.status ?? t("provider.noStatus")} · {check.durationMs}ms · {formatShortDate(check.checkedAt)}</span>
                {check.error && <code>{check.error}</code>}
              </div>
            ))}
            {healthPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openProviderHealth(healthPanel.provider, true)}>{t("session.loadMore")}</button>}
            {healthPanel.checks && !healthPanel.checks.length && <div className="empty-state">{t("provider.noHealthChecks")}</div>}
          </div>
        </div>
      )}
      {providerModelPicker && (
        <div className="workspace-modal compact-modal provider-model-picker-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.detectModels")}</strong>
              <span>{providerModelPicker.title}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setProviderModelPicker(null)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <div className="provider-model-picker-body">
            {renderModelPicker(
              `provider-picker-${providerModelPicker.target}`,
              providerModelPicker.result,
              providerModelPicker.target === "draft" ? defaultModel : editPanel?.defaultModel ?? "",
              selectProviderModelFromDialog,
            )}
          </div>
        </div>
      )}
      {editPanel && (
        <div className="workspace-modal compact-modal provider-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.editTitle")}</strong>
              <span>{editPanel.provider.name}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => { setEditPanel(null); setEditModels(null); }} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={saveEditedProvider}>
            <input name="edit-provider-name" value={editPanel.name} onChange={(event) => setEditPanel((current) => current ? { ...current, name: event.target.value } : current)} placeholder={t("form.providerName")} required />
            <select name="edit-provider-kind" value={editPanel.kind} onChange={(event) => {
              const nextKind = event.target.value as ProviderSummary["kind"];
              setEditModels(null);
              setEditPanel((current) => current ? {
                ...current,
                kind: nextKind,
                useProxy: nextKind === "openai-responses" ? current.useProxy : false,
                capabilities: defaultProviderCapabilitiesForKind(nextKind),
              } : current);
            }}>
              <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
              <option value="openai-responses">{t("provider.kindResponses")}</option>
              <option value="local">{t("provider.kindLocal")}</option>
            </select>
            <input name="edit-provider-baseurl" value={editPanel.baseUrl} onChange={(event) => {
              setEditModels(null);
              setEditPanel((current) => current ? { ...current, baseUrl: event.target.value } : current);
            }} placeholder={t("form.baseUrl")} />
            <input name="edit-provider-apikey" value={editPanel.apiKey} onChange={(event) => {
              setEditModels(null);
              setEditPanel((current) => current ? { ...current, apiKey: event.target.value } : current);
            }} placeholder={t("provider.apiKeyEditPlaceholder")} type="password" />
            <input name="edit-provider-defaultmodel" value={editPanel.defaultModel} onChange={(event) => setEditPanel((current) => current ? { ...current, defaultModel: event.target.value } : current)} placeholder={t("form.defaultModel")} required />
            <button className="ghost-button" type="button" onClick={() => void discoverEditProviderModels()} disabled={discoveringEditModels}>
              <IconText icon={RefreshCw}>{discoveringEditModels ? t("provider.detecting") : t("provider.detectModels")}</IconText>
            </button>
            {editModels && (
              <button className="ghost-button" type="button" onClick={() => openProviderModelPicker("edit", editModels)}>
                {t("provider.detectModels")} · {editModels.models.length || t("provider.noModels")}
              </button>
            )}
            <input name="edit-provider-rpmlimit" value={editPanel.rpmLimit} onChange={(event) => setEditPanel((current) => current ? { ...current, rpmLimit: event.target.value } : current)} placeholder={t("form.rpmLimit")} type="number" min="1" inputMode="numeric" />
            <label className="checkbox-row">
              <input name="edit-provider-rpmlimitenabled" type="checkbox" checked={editPanel.rpmLimitEnabled} onChange={(event) => setEditPanel((current) => current ? { ...current, rpmLimitEnabled: event.target.checked } : current)} />
              <span>{t("provider.rpmEnabled")}</span>
            </label>
            {editPanel.kind === "openai-responses" && (
              <label className="checkbox-row">
                <input name="edit-provider-useproxy" type="checkbox" checked={editPanel.useProxy} onChange={(event) => setEditPanel((current) => current ? { ...current, useProxy: event.target.checked } : current)} />
                <span>{t("provider.useProxy")}</span>
              </label>
            )}
            <div className="checkbox-grid">
              {capabilityItems.map((item) => (
                <label key={item.key}>
                  <input name={`edit-provider-capability-${item.key}`} type="checkbox" checked={editPanel.capabilities[item.key]} onChange={(event) => setEditPanel((current) => current ? { ...current, capabilities: { ...current.capabilities, [item.key]: event.target.checked } } : current)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            {message && <span className="form-error">{message}</span>}
            <button className="dark-button"><IconText icon={Save}>{t("provider.saveChanges")}</IconText></button>
          </form>
        </div>
      )}
      {createPanelOpen && (
        <div className="workspace-modal compact-modal provider-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.createTitle")}</strong>
              <span>{t("page.providers")}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setCreatePanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={createProvider}>
            <input name="mobile-name-2" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.providerName")} required />
            <select name="mobile-kind" value={kind} onChange={(event) => {
              const nextKind = event.target.value as ProviderSummary["kind"];
              setKind(nextKind);
              setCapabilities(defaultProviderCapabilitiesForKind(nextKind));
            }}>
              <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
              <option value="openai-responses">{t("provider.kindResponses")}</option>
              <option value="local">{t("provider.kindLocal")}</option>
            </select>
            <input name="mobile-baseurl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("form.baseUrl")} />
            <input name="mobile-apikey" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("form.apiKey")} type="password" />
            <input name="mobile-defaultmodel" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder={t("form.defaultModel")} required />
            <input name="mobile-rpmlimit" value={rpmLimit} onChange={(event) => setRpmLimit(event.target.value)} placeholder={t("form.rpmLimit")} type="number" min="1" inputMode="numeric" />
            <label className="checkbox-row">
              <input name="mobile-rpmlimitenabled" type="checkbox" checked={rpmLimitEnabled} onChange={(event) => setRpmLimitEnabled(event.target.checked)} />
              <span>{t("provider.rpmEnabled")}</span>
            </label>
            {kind === "openai-responses" && (
              <label className="checkbox-row">
                <input name="mobile-useproxy" type="checkbox" checked={useProxy} onChange={(event) => setUseProxy(event.target.checked)} />
                <span>{t("provider.useProxy")}</span>
              </label>
            )}
            <button className="ghost-button" type="button" onClick={detectDraftInterface} disabled={detectingDraftInterface || !defaultModel.trim()}>
              <IconText icon={Activity}>{detectingDraftInterface ? t("provider.detecting") : t("provider.detectInterface")}</IconText>
            </button>
            <button className="ghost-button" type="button" onClick={discoverDraftModels} disabled={discoveringDraftModels}>
              <IconText icon={RefreshCw}>{discoveringDraftModels ? t("provider.detecting") : t("provider.detectModels")}</IconText>
            </button>
            {draftModels && (
              <button className="ghost-button" type="button" onClick={() => openProviderModelPicker("draft", draftModels)}>
                {t("provider.detectModels")} · {draftModels.models.length || t("provider.noModels")}
              </button>
            )}
            {message && <span className="form-error">{message}</span>}
            <button className="dark-button"><IconText icon={Save}>{t("provider.saveProvider")}</IconText></button>
          </form>
        </div>
      )}
    </main>
  );
}

function AutomationsPage({
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
  const [scheduleMode, setScheduleMode] = useState<"manual" | "hourly" | "daily" | "weekly" | "cron">("manual");
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
  const [runDetailPanel, setRunDetailPanel] = useState<{ automation: AutomationSummary; run: AutomationRunSummary } | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<AutomationSummary | null>(null);
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
    if (value === "hourly") return { mode: "hourly", time: "09:00", weekday: "1", cron: "0 9 * * *" };
    if (dailyMatch?.[1]) return { mode: "daily", time: dailyMatch[1], weekday: "1", cron: "0 9 * * *" };
    if (weeklyMatch?.[1] && weeklyMatch[2]) return { mode: "weekly", time: weeklyMatch[2], weekday: weeklyMatch[1] === "7" ? "0" : weeklyMatch[1], cron: "0 9 * * *" };
    if (value.startsWith("cron ")) return { mode: "cron", time: "09:00", weekday: "1", cron: value.slice(5).trim() || "0 9 * * *" };
    return { mode: "manual", time: "09:00", weekday: "1", cron: "0 9 * * *" };
  }

  function buildAutomationSchedule(mode: typeof scheduleMode, time = "09:00", weekday = "1", cron = "0 9 * * *") {
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
    return /^(manual|hourly|daily\s+[0-2]\d:[0-5]\d|weekly\s+[0-7]\s+[0-2]\d:[0-5]\d|cron\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+)$/i.test(schedule.trim());
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
    const confirmed = await dialog.confirm({
      title: t("automation.deleteAutomation"),
      message: automation.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/automations/${automation.id}`, {
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
              <button className="file-list-item" key={run.id} type="button" onClick={() => setRunDetailPanel({ automation: runsPanel.automation, run })}>
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
    </main>
  );
}

function ContactsPage({ sessionToken, t, locale, notify, providers, projects, onOpenSession, onOpenMainNav }: { sessionToken: string; t: TFunction; locale: Locale; notify: (message: string, tone?: ToastTone) => void; providers: ProviderSummary[]; projects: ProjectSummary[]; onOpenSession: (sessionId: string) => void; onOpenMainNav?: () => void }) {
  type ContactTab = "agents" | "groups" | "roles" | "circles" | "permissions";
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [groups, setGroups] = useState<AgentGroupSummary[]>([]);
  const [roles, setRoles] = useState<AgentRoleSummary[]>([]);
  const [roleTemplates, setRoleTemplates] = useState<AgentRoleTemplateSummary[]>([]);
  const [circles, setCircles] = useState<AgentCircleSummary[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<Array<{ id: string; permissions: unknown }>>([]);
  const [loading, setLoading] = useState(false);
  const [contactTab, setContactTab] = useState<ContactTab>("agents");
  const [contactSearch, setContactSearch] = useState("");
  const [contactCreatePanelOpen, setContactCreatePanelOpen] = useState(false);
  const [detailContact, setDetailContact] = useState<
    | { kind: "agent"; item: AgentSummary }
    | { kind: "group"; item: AgentGroupSummary }
    | { kind: "role"; item: AgentRoleSummary }
    | { kind: "circle"; item: AgentCircleSummary }
    | null
  >(null);
  const [agentSessionsPanel, setAgentSessionsPanel] = useState<{ agent: AgentSummary; sessions: SessionSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [contactSessionFilter, setContactSessionFilter] = useState({ q: "", status: "", projectId: "" });
  const [roomSessionsPanel, setRoomSessionsPanel] = useState<{ kind: "group" | "circle"; id: string; name: string; sessions: SessionSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [agentSessionDialog, setAgentSessionDialog] = useState<{ agent: AgentSummary; projectId: string } | null>(null);
  const [roomSessionDialog, setRoomSessionDialog] = useState<{ kind: "group" | "circle"; id: string; name: string; projectId: string } | null>(null);
  const [agentStatsPanel, setAgentStatsPanel] = useState<{ agent: AgentSummary; stats: unknown | null } | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleDescriptionInPrompt, setRoleDescriptionInPrompt] = useState(false);
  const [rolePrompt, setRolePrompt] = useState("");
  const [roleSourceType, setRoleSourceType] = useState<"builtin-template" | "custom-markdown" | "file-import">("builtin-template");
  const [roleSourcePath, setRoleSourcePath] = useState("");
  const [roleTemplateId, setRoleTemplateId] = useState("");
  const [editingRoleId, setEditingRoleId] = useState("");
  const [editingRoleName, setEditingRoleName] = useState("");
  const [editingRoleDescription, setEditingRoleDescription] = useState("");
  const [editingRolePrompt, setEditingRolePrompt] = useState("");
  const [editingRoleDescriptionInPrompt, setEditingRoleDescriptionInPrompt] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentRoleId, setAgentRoleId] = useState("");
  const [agentProviderId, setAgentProviderId] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [agentCustomModel, setAgentCustomModel] = useState(false);
  const [discoveringAgentModels, setDiscoveringAgentModels] = useState(false);
  const [agentDescription, setAgentDescription] = useState("");
  const [agentExtraPrompt, setAgentExtraPrompt] = useState("");
  const [agentDefaultProjectId, setAgentDefaultProjectId] = useState("");
  const [agentProjectAccessMode, setAgentProjectAccessMode] = useState<AgentProjectAccessMode>("all");
  const [agentAllowedProjectIds, setAgentAllowedProjectIds] = useState<string[]>([]);
  const [agentFavoriteProjectIds, setAgentFavoriteProjectIds] = useState<string[]>([]);
  const [agentPermissionProfileId, setAgentPermissionProfileId] = useState<PermissionProfileId>("developer");
  const [editingAgentId, setEditingAgentId] = useState("");
  const [editingAgentName, setEditingAgentName] = useState("");
  const [editingAgentRoleId, setEditingAgentRoleId] = useState("");
  const [editingAgentProviderId, setEditingAgentProviderId] = useState("");
  const [editingAgentModel, setEditingAgentModel] = useState("");
  const [editingAgentModels, setEditingAgentModels] = useState<string[]>([]);
  const [editingAgentCustomModel, setEditingAgentCustomModel] = useState(false);
  const [discoveringEditingAgentModels, setDiscoveringEditingAgentModels] = useState(false);
  const [editingAgentDescription, setEditingAgentDescription] = useState("");
  const [editingAgentExtraPrompt, setEditingAgentExtraPrompt] = useState("");
  const [editingAgentWorkspaceMode, setEditingAgentWorkspaceMode] = useState<AgentSummary["workspaceMode"]>("isolated-worktree-with-shared-room");
  const [editingAgentEnabled, setEditingAgentEnabled] = useState(true);
  const [editingAgentDefaultProjectId, setEditingAgentDefaultProjectId] = useState("");
  const [editingAgentProjectAccessMode, setEditingAgentProjectAccessMode] = useState<AgentProjectAccessMode>("all");
  const [editingAgentAllowedProjectIds, setEditingAgentAllowedProjectIds] = useState<string[]>([]);
  const [editingAgentFavoriteProjectIds, setEditingAgentFavoriteProjectIds] = useState<string[]>([]);
  const [editingAgentPermissionProfileId, setEditingAgentPermissionProfileId] = useState<PermissionProfileId>("developer");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupAgentIds, setGroupAgentIds] = useState<string[]>([]);
  const [groupMemberListenModes, setGroupMemberListenModes] = useState<Record<string, AgentListenMode>>({});
  const [editingGroupId, setEditingGroupId] = useState("");
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupDescription, setEditingGroupDescription] = useState("");
  const [editingGroupAgentIds, setEditingGroupAgentIds] = useState<string[]>([]);
  const [editingGroupMemberListenModes, setEditingGroupMemberListenModes] = useState<Record<string, AgentListenMode>>({});
  const [circleName, setCircleName] = useState("");
  const [circleDescription, setCircleDescription] = useState("");
  const [circleRoleIds, setCircleRoleIds] = useState<string[]>([]);
  const [circleRules, setCircleRules] = useState("");
  const [editingCircleId, setEditingCircleId] = useState("");
  const [editingCircleName, setEditingCircleName] = useState("");
  const [editingCircleDescription, setEditingCircleDescription] = useState("");
  const [editingCircleRoleIds, setEditingCircleRoleIds] = useState<string[]>([]);
  const [editingCircleRules, setEditingCircleRules] = useState("");
  const [contactPages, setContactPages] = useState({
    agents: { cursor: null as string | null, hasMore: false },
    groups: { cursor: null as string | null, hasMore: false },
    roles: { cursor: null as string | null, hasMore: false },
    circles: { cursor: null as string | null, hasMore: false },
  });

  async function loadContacts() {
    setLoading(true);
    try {
      const headers = { authorization: `Bearer ${sessionToken}` };
      const [agentsPage, groupsPage, rolesPage, templatesList, circlesPage, profilesList] = await Promise.all([
        fetch("/api/agents?limit=50", { headers }).then((response) => response.json() as Promise<PageResponse<AgentSummary>>),
        fetch("/api/agent-groups?limit=50", { headers }).then((response) => response.json() as Promise<PageResponse<AgentGroupSummary>>),
        fetch("/api/agent-roles?limit=50", { headers }).then((response) => response.json() as Promise<PageResponse<AgentRoleSummary>>),
        fetch("/api/agent-role-templates", { headers }).then((response) => response.json() as Promise<AgentRoleTemplateSummary[]>),
        fetch("/api/agent-circles?limit=50", { headers }).then((response) => response.json() as Promise<PageResponse<AgentCircleSummary>>),
        fetch("/api/permission-profiles", { headers }).then((response) => response.json() as Promise<Array<{ id: string; permissions: unknown }>>),
      ]);
      setAgents(agentsPage.items ?? []);
      setGroups(groupsPage.items ?? []);
      setRoles(rolesPage.items ?? []);
      setContactPages({
        agents: { cursor: agentsPage.nextCursor, hasMore: agentsPage.hasMore },
        groups: { cursor: groupsPage.nextCursor, hasMore: groupsPage.hasMore },
        roles: { cursor: rolesPage.nextCursor, hasMore: rolesPage.hasMore },
        circles: { cursor: circlesPage.nextCursor, hasMore: circlesPage.hasMore },
      });
      setRoleTemplates(Array.isArray(templatesList) ? templatesList : []);
      setCircles(circlesPage.items ?? []);
      setPermissionProfiles(Array.isArray(profilesList) ? profilesList : []);
    } catch {
      notify(t("contacts.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContacts();
  }, [sessionToken]);

  async function loadMoreContacts(kind: keyof typeof contactPages) {
    const cursor = contactPages[kind].cursor;
    if (!cursor) return;
    const headers = { authorization: `Bearer ${sessionToken}` };
    const endpoint = kind === "agents" ? "agents" : kind === "groups" ? "agent-groups" : kind === "roles" ? "agent-roles" : "agent-circles";
    const response = await fetch(`/api/${endpoint}?limit=50&cursor=${encodeURIComponent(cursor)}`, { headers });
    if (!response.ok) {
      notify(t("contacts.loadFailed"), "error");
      return;
    }
    if (kind === "agents") {
      const page = (await response.json()) as PageResponse<AgentSummary>;
      setAgents((current) => [...current, ...page.items]);
      setContactPages((current) => ({ ...current, agents: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "groups") {
      const page = (await response.json()) as PageResponse<AgentGroupSummary>;
      setGroups((current) => [...current, ...page.items]);
      setContactPages((current) => ({ ...current, groups: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else {
      if (kind === "circles") {
        const page = (await response.json()) as PageResponse<AgentCircleSummary>;
        setCircles((current) => [...current, ...page.items]);
        setContactPages((current) => ({ ...current, circles: { cursor: page.nextCursor, hasMore: page.hasMore } }));
        return;
      }
      const page = (await response.json()) as PageResponse<AgentRoleSummary>;
      setRoles((current) => [...current, ...page.items]);
      setContactPages((current) => ({ ...current, roles: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    }
  }

  useEffect(() => {
    if (!agentRoleId && roles[0]) setAgentRoleId(roles[0].id);
  }, [agentRoleId, roles]);

  useEffect(() => {
    if (!roleTemplateId && roleTemplates[0]) setRoleTemplateId(roleTemplates[0].id);
  }, [roleTemplateId, roleTemplates]);

  function templateName(template?: AgentRoleTemplateSummary) {
    return template?.localizedNames?.[locale]?.name || template?.localizedNames?.[locale.split("-")[0]]?.name || template?.name || "";
  }

  function templateDescription(template?: AgentRoleTemplateSummary) {
    return template?.localizedNames?.[locale]?.description || template?.localizedNames?.[locale.split("-")[0]]?.description || template?.description || "";
  }

  useEffect(() => {
    if (!agentProviderId && providers[0]) {
      setAgentProviderId(providers[0].id);
      setAgentModel(providers[0].defaultModel);
      setAgentModels(providers[0].defaultModel ? [providers[0].defaultModel] : []);
    }
  }, [agentProviderId, providers]);

  async function discoverAgentModels(providerId = agentProviderId, refresh = false) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      setAgentModels([]);
      return;
    }
    if (!refresh) {
      const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
      setAgentModels(models);
      if (!agentCustomModel && (!agentModel || !models.includes(agentModel))) setAgentModel(models[0] ?? provider.defaultModel ?? "");
      return;
    }
    setDiscoveringAgentModels(true);
    try {
      const response = await fetch(`/api/providers/${provider.id}/models?refresh=1`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = response.ok ? ((await response.json()) as ProviderModelsResponse) : null;
      const models = result?.models?.length ? result.models : provider.defaultModel ? [provider.defaultModel] : [];
      setAgentModels(models);
      if (!agentCustomModel && (!agentModel || !models.includes(agentModel))) setAgentModel(models[0] ?? provider.defaultModel ?? "");
    } finally {
      setDiscoveringAgentModels(false);
    }
  }

  async function discoverEditingAgentModels(providerId = editingAgentProviderId, refresh = false) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      setEditingAgentModels(editingAgentModel ? [editingAgentModel] : []);
      return;
    }
    if (!refresh) {
      const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
      setEditingAgentModels(models);
      setEditingAgentCustomModel(Boolean(editingAgentModel && !models.includes(editingAgentModel)));
      if (!editingAgentModel && models[0]) setEditingAgentModel(models[0]);
      return;
    }
    setDiscoveringEditingAgentModels(true);
    try {
      const response = await fetch(`/api/providers/${provider.id}/models?refresh=1`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = response.ok ? ((await response.json()) as ProviderModelsResponse) : null;
      const models = result?.models?.length ? result.models : provider.defaultModel ? [provider.defaultModel] : [];
      setEditingAgentModels(models);
      setEditingAgentCustomModel(Boolean(editingAgentModel && !models.includes(editingAgentModel)));
      if (!editingAgentModel && models[0]) setEditingAgentModel(models[0]);
    } finally {
      setDiscoveringEditingAgentModels(false);
    }
  }

  useEffect(() => {
    if (agentProviderId) void discoverAgentModels(agentProviderId);
  }, [agentProviderId, providers]);

  useEffect(() => {
    if (editingAgentId && editingAgentProviderId) void discoverEditingAgentModels(editingAgentProviderId);
  }, [editingAgentId, editingAgentProviderId, providers]);

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    const response = roleSourceType === "builtin-template" ? await fetch("/api/agent-roles/from-template", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        templateId: roleTemplateId,
        name: roleName || templateName(roleTemplates.find((template) => template.id === roleTemplateId)) || undefined,
        description: roleDescription || templateDescription(roleTemplates.find((template) => template.id === roleTemplateId)) || undefined,
        includeDescriptionInPrompt: roleDescriptionInPrompt,
      }),
    }) : roleSourceType === "file-import" ? await fetch("/api/agent-roles/import-file", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ path: roleSourcePath, name: roleName || undefined }),
    }) : await fetch("/api/agent-roles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: roleName, description: roleDescription, includeDescriptionInPrompt: roleDescriptionInPrompt, sourceType: "custom-markdown", markdownContent: rolePrompt, systemPrompt: rolePrompt }),
    });
    if (!response.ok) {
      notify(t("contacts.createRoleFailed"), "error");
      return;
    }
    setRoleName("");
    setRoleDescription("");
    setRoleDescriptionInPrompt(false);
    setRolePrompt("");
    setRoleSourcePath("");
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: agentName,
        roleId: agentRoleId,
        providerId: agentProviderId || null,
        model: agentModel || null,
        description: agentDescription,
        extraPrompt: agentExtraPrompt,
        defaultProjectId: agentDefaultProjectId || null,
        projectAccessMode: agentProjectAccessMode,
        allowedProjectIds: agentAllowedProjectIds,
        favoriteProjectIds: agentFavoriteProjectIds,
        permissionProfileId: agentPermissionProfileId,
      }),
    });
    if (!response.ok) {
      notify(t("contacts.createAgentFailed"), "error");
      return;
    }
    setAgentName("");
    setAgentDescription("");
    setAgentExtraPrompt("");
    setAgentDefaultProjectId("");
    setAgentAllowedProjectIds([]);
    setAgentFavoriteProjectIds([]);
    setAgentProjectAccessMode("all");
    setAgentPermissionProfileId("developer");
    setAgentModel(providers.find((provider) => provider.id === agentProviderId)?.defaultModel ?? "");
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  function startEditAgent(agent: AgentSummary) {
    const provider = providers.find((item) => item.id === agent.providerId);
    const models = provider?.models?.length ? provider.models : provider?.defaultModel ? [provider.defaultModel] : [];
    setEditingAgentId(agent.id);
    setEditingAgentName(agent.name);
    setEditingAgentRoleId(agent.roleId);
    setEditingAgentProviderId(agent.providerId ?? "");
    setEditingAgentModel(agent.model ?? "");
    setEditingAgentModels(models);
    setEditingAgentCustomModel(Boolean(agent.model && !models.includes(agent.model)));
    setEditingAgentDescription(agent.description ?? "");
    setEditingAgentExtraPrompt(agent.extraPrompt ?? "");
    setEditingAgentWorkspaceMode(agent.workspaceMode);
    setEditingAgentEnabled(agent.enabled);
    setEditingAgentDefaultProjectId(agent.defaultProjectId ?? "");
    setEditingAgentProjectAccessMode(agent.projectAccessMode);
    setEditingAgentAllowedProjectIds(agent.allowedProjectIds ?? []);
    setEditingAgentFavoriteProjectIds(agent.favoriteProjectIds ?? []);
    setEditingAgentPermissionProfileId(agent.permissionProfileId ?? "developer");
  }

  async function updateAgent(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agents/${editingAgentId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingAgentName,
        roleId: editingAgentRoleId,
        providerId: editingAgentProviderId || null,
        model: editingAgentModel || null,
        description: editingAgentDescription,
        extraPrompt: editingAgentExtraPrompt,
        workspaceMode: editingAgentWorkspaceMode,
        enabled: editingAgentEnabled,
        defaultProjectId: editingAgentDefaultProjectId || null,
        projectAccessMode: editingAgentProjectAccessMode,
        allowedProjectIds: editingAgentAllowedProjectIds,
        favoriteProjectIds: editingAgentFavoriteProjectIds,
        permissionProfileId: editingAgentPermissionProfileId,
      }),
    });
    if (!response.ok) {
      notify(t("contacts.updateAgentFailed"), "error");
      return;
    }
    setEditingAgentId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  function agentProjectOptions(agent: AgentSummary) {
    if (agent.projectAccessMode === "none") return [];
    if (agent.projectAccessMode === "selected") return projects.filter((project) => agent.allowedProjectIds.includes(project.id));
    return projects;
  }

  function openAgentSessionDialog(agent: AgentSummary) {
    const options = agentProjectOptions(agent);
    const defaultProjectId = agent.defaultProjectId && options.some((project) => project.id === agent.defaultProjectId) ? agent.defaultProjectId : "";
    setAgentSessionDialog({ agent, projectId: defaultProjectId });
  }

  async function startAgentSession(agent: AgentSummary, projectId?: string | null) {
    const response = await fetch(`/api/agents/${agent.id}/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: projectId === undefined ? agent.defaultProjectId ?? null : projectId || null }),
    });
    if (!response.ok) {
      notify(t("contacts.startAgentSessionFailed"), "error");
      return;
    }
    const session = (await response.json()) as SessionSummary;
    setAgentSessionDialog(null);
    onOpenSession(session.id);
    notify(t("contacts.agentSessionStarted"), "success");
  }

  async function openAgentSessions(agent: AgentSummary, older = false) {
    if (!older) setAgentSessionsPanel({ agent, sessions: null });
    const cursor = older && agentSessionsPanel?.agent.id === agent.id ? agentSessionsPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    if (contactSessionFilter.q.trim()) params.set("q", contactSessionFilter.q.trim());
    if (contactSessionFilter.status) params.set("status", contactSessionFilter.status);
    if (contactSessionFilter.projectId) params.set("projectId", contactSessionFilter.projectId);
    const response = await fetch(`/api/agents/${agent.id}/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("contacts.sessionsReadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<SessionSummary>;
    setAgentSessionsPanel((current) => ({
      agent,
      sessions: older && current?.agent.id === agent.id ? [...(current.sessions ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function continueLatestAgentSession(agent: AgentSummary) {
    const params = new URLSearchParams({ limit: "1" });
    const response = await fetch(`/api/agents/${agent.id}/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return notify(t("contacts.sessionsReadFailed"), "error");
    const page = (await response.json()) as PageResponse<SessionSummary>;
    if (page.items[0]) {
      onOpenSession(page.items[0].id);
      return;
    }
    await startAgentSession(agent);
  }

  async function openRoomSessions(kind: "group" | "circle", id: string, name: string, older = false) {
    if (!older) setRoomSessionsPanel({ kind, id, name, sessions: null });
    const current = older && roomSessionsPanel?.id === id ? roomSessionsPanel : null;
    const params = new URLSearchParams({ limit: "10" });
    if (current?.cursor) params.set("cursor", current.cursor);
    if (contactSessionFilter.q.trim()) params.set("q", contactSessionFilter.q.trim());
    if (contactSessionFilter.status) params.set("status", contactSessionFilter.status);
    if (contactSessionFilter.projectId) params.set("projectId", contactSessionFilter.projectId);
    const path = kind === "group" ? "agent-groups" : "agent-circles";
    const response = await fetch(`/api/${path}/${id}/rooms?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return notify(t("contacts.sessionsReadFailed"), "error");
    const page = (await response.json()) as PageResponse<SessionSummary>;
    setRoomSessionsPanel((panel) => ({
      kind,
      id,
      name,
      sessions: older && panel?.id === id ? [...(panel.sessions ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function openAgentStats(agent: AgentSummary) {
    setAgentStatsPanel({ agent, stats: null });
    const response = await fetch(`/api/agents/${agent.id}/stats`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return notify(t("contacts.statsReadFailed"), "error");
    setAgentStatsPanel({ agent, stats: await response.json() });
  }

  function sessionOriginLabel(session: SessionSummary) {
    const projectName = projectDisplayName(projects.find((project) => project.id === session.projectId), projects);
    const projectLabel = projectName || (session.projectId ? session.projectId : t("session.noProject"));
    const providerLabel = providers.find((provider) => provider.id === session.providerId)?.name ?? t("session.noProvider");
    const parts = [
      readableStatus(session.status, t),
      session.conversationType ?? "codex",
      projectLabel,
      `${providerLabel} / ${session.model ?? t("session.noModel")}`,
      formatShortDate(session.updatedAt),
    ];
    return parts.join(" · ");
  }

  function contactSessionFilters(onRefresh: () => void, options: { showProject?: boolean } = {}) {
    return (
      <div className="project-list-filters">
        <input name="contactsessionfilter-q"
          value={contactSessionFilter.q}
          onChange={(event) => setContactSessionFilter((filter) => ({ ...filter, q: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRefresh();
          }}
          placeholder={t("contacts.sessionSearch")}
        />
        <select name="contactsessionfilter-status" value={contactSessionFilter.status} onChange={(event) => setContactSessionFilter((filter) => ({ ...filter, status: event.target.value }))}>
          <option value="">{t("contacts.allStatuses")}</option>
          <option value="running">{t("session.statusRunning")}</option>
          <option value="done">{t("session.statusDone")}</option>
          <option value="paused">{t("session.statusPaused")}</option>
          <option value="interrupted">{t("session.statusInterrupted")}</option>
        </select>
        {options.showProject !== false && (
          <select name="contactsessionfilter-projectid" value={contactSessionFilter.projectId} onChange={(event) => setContactSessionFilter((filter) => ({ ...filter, projectId: event.target.value }))}>
            <option value="">{t("contacts.allProjects")}</option>
            <option value="scratch">{t("contacts.scratchSessions")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
          </select>
        )}
        <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={onRefresh}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
      </div>
    );
  }

  async function batchSetAgents(enabled: boolean) {
    const response = await fetch("/api/agents/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedAgentIds, enabled }),
    });
    if (!response.ok) return notify(t("contacts.batchFailed"), "error");
    setSelectedAgentIds([]);
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  async function duplicateRole(role: AgentRoleSummary) {
    const response = await fetch("/api/agent-roles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: `${role.name} Copy`,
        description: role.description,
        sourceType: "custom-markdown",
        markdownContent: role.markdownContent,
        systemPrompt: role.systemPrompt,
        capabilities: role.capabilities,
        defaultListenMode: role.defaultListenMode,
        defaultListenEvents: role.defaultListenEvents,
        defaultWorkspaceMode: role.defaultWorkspaceMode,
        defaultSandboxMode: role.defaultSandboxMode,
        defaultApprovalPolicy: role.defaultApprovalPolicy,
        outputContract: role.outputContract,
        safetyNotes: role.safetyNotes,
      }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  async function duplicateAgent(agent: AgentSummary) {
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...agent, name: `${agent.name} Copy`, enabled: false }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  async function duplicateGroup(group: AgentGroupSummary) {
    const response = await fetch("/api/agent-groups", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...group, name: `${group.name} Copy` }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  function startEditGroup(group: AgentGroupSummary) {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setEditingGroupDescription(group.description ?? "");
    setEditingGroupAgentIds(group.agentIds);
    setEditingGroupMemberListenModes(group.memberListenModes ?? {});
  }

  async function updateGroup(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agent-groups/${editingGroupId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingGroupName,
        description: editingGroupDescription,
        agentIds: editingGroupAgentIds,
        memberListenModes: editingGroupMemberListenModes,
      }),
    });
    if (!response.ok) return notify(t("contacts.updateGroupFailed"), "error");
    setEditingGroupId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  async function duplicateCircle(circle: AgentCircleSummary) {
    const response = await fetch("/api/agent-circles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...circle, name: `${circle.name} Copy`, builtin: false }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  function startEditCircle(circle: AgentCircleSummary) {
    setEditingCircleId(circle.id);
    setEditingCircleName(circle.name);
    setEditingCircleDescription(circle.description ?? "");
    setEditingCircleRoleIds(circle.roleIds);
    setEditingCircleRules(circle.collaborationRules ?? "");
  }

  async function updateCircle(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agent-circles/${editingCircleId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingCircleName,
        description: editingCircleDescription,
        roleIds: editingCircleRoleIds,
        collaborationRules: editingCircleRules,
      }),
    });
    if (!response.ok) return notify(t("contacts.updateCircleFailed"), "error");
    setEditingCircleId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agent-groups", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: groupName, description: groupDescription, agentIds: groupAgentIds, memberListenModes: groupMemberListenModes }),
    });
    if (!response.ok) {
      notify(t("contacts.createGroupFailed"), "error");
      return;
    }
    setGroupName("");
    setGroupDescription("");
    setGroupAgentIds([]);
    setGroupMemberListenModes({});
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  async function createCircle(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agent-circles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: circleName, description: circleDescription, roleIds: circleRoleIds, collaborationRules: circleRules }),
    });
    if (!response.ok) {
      notify(t("contacts.createCircleFailed"), "error");
      return;
    }
    setCircleName("");
    setCircleDescription("");
    setCircleRoleIds([]);
    setCircleRules("");
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  async function createGroupFromCircle(circle: AgentCircleSummary) {
    const response = await fetch(`/api/agent-circles/${circle.id}/groups`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("contacts.createGroupFailed"), "error");
      return null;
    }
    const group = (await response.json()) as AgentGroupSummary;
    await loadContacts();
    notify(t("contacts.created"), "success");
    return group;
  }

  async function deleteContact(kind: "agent" | "group" | "role" | "circle", id: string) {
    const path = kind === "agent" ? "agents" : kind === "group" ? "agent-groups" : kind === "circle" ? "agent-circles" : "agent-roles";
    const response = await fetch(`/api/${path}/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("contacts.deleteFailed"), "error");
      return;
    }
    await loadContacts();
    notify(t("contacts.deleted"), "success");
  }

  async function copyRoleContent(role: AgentRoleSummary) {
    const copied = await copyText(role.systemPrompt || role.markdownContent);
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  function startEditRole(role: AgentRoleSummary) {
    setEditingRoleId(role.id);
    setEditingRoleName(role.name);
    setEditingRoleDescription(role.description ?? "");
    setEditingRolePrompt(role.systemPrompt || role.markdownContent);
    setEditingRoleDescriptionInPrompt(role.systemPrompt.includes("## Role Extension Description"));
  }

  async function updateRole(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agent-roles/${editingRoleId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingRoleName,
        description: editingRoleDescription,
        systemPrompt: editingRolePrompt,
        markdownContent: editingRolePrompt,
        includeDescriptionInPrompt: editingRoleDescriptionInPrompt,
      }),
    });
    if (!response.ok) {
      notify(t("contacts.updateRoleFailed"), "error");
      return;
    }
    setEditingRoleId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  function roleTemplateName(role: AgentRoleSummary) {
    if (role.sourceType !== "builtin-template" || !role.sourcePath) return "";
    const template = roleTemplates.find((item) => item.sourcePath === role.sourcePath);
    return templateName(template) || role.sourcePath.split("/").pop()?.replace(/\.md$/i, "") || "";
  }

  function toggleGroupAgent(agentId: string) {
    setGroupAgentIds((items) => items.includes(agentId) ? items.filter((item) => item !== agentId) : [...items, agentId]);
    setGroupMemberListenModes((items) => ({ ...items, [agentId]: items[agentId] ?? "passive" }));
  }

  function toggleEditingGroupAgent(agentId: string) {
    setEditingGroupAgentIds((items) => items.includes(agentId) ? items.filter((item) => item !== agentId) : [...items, agentId]);
    setEditingGroupMemberListenModes((items) => ({ ...items, [agentId]: items[agentId] ?? "passive" }));
  }

  function toggleString(items: string[], value: string) {
    return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
  }

  function toggleCircleRole(roleId: string) {
    setCircleRoleIds((items) => items.includes(roleId) ? items.filter((item) => item !== roleId) : [...items, roleId]);
  }

  function openRoomSessionDialog(input: { kind: "group" | "circle"; id: string; name: string }) {
    setRoomSessionDialog({ ...input, projectId: "" });
  }

  async function startRoom(input: { name: string; groupId?: string; circleId?: string; projectId?: string | null }) {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      notify(t("contacts.startRoomFailed"), "error");
      return;
    }
    const room = (await response.json()) as RoomSummary;
    setRoomSessionDialog(null);
    if (room.sessionId) onOpenSession(room.sessionId);
    notify(t("contacts.roomStarted"), "success");
  }

  async function startRoomFromDialog() {
    if (!roomSessionDialog) return;
    const projectId = roomSessionDialog.projectId || null;
    if (roomSessionDialog.kind === "group") {
      await startRoom({ name: roomSessionDialog.name, groupId: roomSessionDialog.id, projectId });
      return;
    }
    const circle = circles.find((item) => item.id === roomSessionDialog.id);
    if (!circle) return notify(t("contacts.startRoomFailed"), "error");
    const group = await createGroupFromCircle(circle);
    if (group) await startRoom({ name: roomSessionDialog.name, groupId: group.id, circleId: circle.id, projectId });
  }

  const searchText = contactSearch.trim().toLowerCase();
  const matchesSearch = (...values: Array<string | null | undefined>) => !searchText || values.some((value) => value?.toLowerCase().includes(searchText));
  const filteredAgents = agents.filter((agent) => matchesSearch(agent.name, agent.description, agent.model, agent.providerId, agent.permissionProfileId, agent.projectAccessMode));
  const filteredGroups = groups.filter((group) => matchesSearch(group.name, group.description, group.approvalPolicy, group.mergeStrategy));
  const filteredRoles = roles.filter((role) => matchesSearch(role.name, role.description, role.sourceType, roleTemplateName(role)));
  const filteredCircles = circles.filter((circle) => matchesSearch(circle.name, circle.description, circle.collaborationRules, circle.mergeStrategy));

  return (
    <main className="management-page contacts-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.contacts")}`} title={t("page.contacts")} action={loading ? t("session.loading") : t("action.refresh")} onAction={() => void loadContacts()} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.contacts")} />
      <FilterToolbar>
        <FilterSearchInput value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder={t("contacts.searchContacts")} />
      </FilterToolbar>
      <Tabs className="approvals-root" value={contactTab} onValueChange={(value) => setContactTab(value as ContactTab)}>
        <TabsList className="settings-tabs" aria-label={t("page.contacts")}>
          <TabsTrigger className="settings-tab" value="agents">{t("contacts.agents")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="groups">{t("contacts.groups")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="roles">{t("contacts.roles")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="circles">{t("contacts.circles")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="permissions">{t("contacts.permissionProfiles")}</TabsTrigger>
        </TabsList>
        <TabsContent className="extension-list contact-tab-content" value="agents">
          <div className="contact-content-toolbar">
            <span>{filteredAgents.length} {t("contacts.agents")}</span>
            <div className="row-actions">
              <Button variant="outline" size="sm" type="button" disabled={!filteredAgents.length} onClick={() => {
                const filteredIds = filteredAgents.map((agent) => agent.id);
                const allSelected = filteredIds.every((id) => selectedAgentIds.includes(id));
                setSelectedAgentIds(allSelected ? [] : filteredIds);
              }}>{filteredAgents.length && filteredAgents.every((agent) => selectedAgentIds.includes(agent.id)) ? t("contacts.clearSelectedAgents") : t("contacts.selectAllAgents")}</Button>
              <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createAgent")} aria-label={t("contacts.createAgent")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
            </div>
          </div>
          {selectedAgentIds.length > 0 && (
            <div className="settings-actions">
              <span className="subtle">{selectedAgentIds.length} {t("contacts.selectedAgents")}</span>
              <Button variant="outline" size="sm" type="button" onClick={() => void batchSetAgents(true)}>{t("contacts.enableSelected")}</Button>
              <Button variant="outline" size="sm" type="button" onClick={() => void batchSetAgents(false)}>{t("contacts.disableSelected")}</Button>
            </div>
          )}
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createAgent}>
            <strong>{t("contacts.createAgent")}</strong>
            <input name="agentname" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder={t("contacts.agentName")} required />
            <select name="agentroleid" value={agentRoleId} onChange={(event) => setAgentRoleId(event.target.value)} required>
              <option value="">{t("contacts.selectRole")}</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <select name="agentproviderid" value={agentProviderId} onChange={(event) => {
              const provider = providers.find((item) => item.id === event.target.value);
              setAgentProviderId(event.target.value);
              setAgentModel(provider?.defaultModel ?? "");
              setAgentModels(provider?.defaultModel ? [provider.defaultModel] : []);
              setAgentCustomModel(false);
            }}>
              <option value="">{t("contacts.defaultProvider")}</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
            <div className="inline-field-with-action">
              <select name="agentcustommodel" value={agentCustomModel || !agentModels.includes(agentModel) ? "__custom" : agentModel} onChange={(event) => {
                if (event.target.value === "__custom") {
                  setAgentCustomModel(true);
                  return;
                }
                setAgentCustomModel(false);
                setAgentModel(event.target.value);
              }}>
                {agentModels.map((model) => <option key={model} value={model}>{model}</option>)}
                <option value="__custom">{t("contacts.customModel")}</option>
              </select>
              <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!agentProviderId || discoveringAgentModels} onClick={() => void discoverAgentModels(agentProviderId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
            </div>
            {(agentCustomModel || !agentModels.length || !agentModels.includes(agentModel)) && <input name="agentmodel" value={agentModel} onChange={(event) => setAgentModel(event.target.value)} placeholder={t("contacts.agentModel")} />}
            <input name="agentdescription" value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} placeholder={t("contacts.description")} />
            <textarea name="agentextraprompt" value={agentExtraPrompt} onChange={(event) => setAgentExtraPrompt(event.target.value)} placeholder={t("contacts.extraPrompt")} />
            <select name="agentpermissionprofileid" value={agentPermissionProfileId} onChange={(event) => setAgentPermissionProfileId(event.target.value as PermissionProfileId)}>
              {(["read-only", "workspace-write", "developer", "maintainer", "danger-full-access"] as PermissionProfileId[]).map((profile) => <option key={profile} value={profile}>{readablePermissionProfile(profile, t)}</option>)}
            </select>
            <select name="agentprojectaccessmode" value={agentProjectAccessMode} onChange={(event) => setAgentProjectAccessMode(event.target.value as AgentProjectAccessMode)}>
              <option value="none">{t("contacts.projectAccessNone")}</option>
              <option value="selected">{t("contacts.projectAccessSelected")}</option>
              <option value="all">{t("contacts.projectAccessAll")}</option>
            </select>
            <select name="agentdefaultprojectid" value={agentDefaultProjectId} onChange={(event) => setAgentDefaultProjectId(event.target.value)}>
              <option value="">{t("session.noProject")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="agentallowedprojectids-includes-project-id" type="checkbox" checked={agentAllowedProjectIds.includes(project.id)} onChange={() => setAgentAllowedProjectIds((items) => toggleString(items, project.id))} />
                  <span>{projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="agentfavoriteprojectids-includes-project-id" type="checkbox" checked={agentFavoriteProjectIds.includes(project.id)} onChange={() => setAgentFavoriteProjectIds((items) => toggleString(items, project.id))} />
                  <span>{t("contacts.favoriteProject")}: {projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <Button disabled={!roles.length}>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredAgents.map((agent) => (
              <article className="provider-card" key={agent.id}>
              <div className="project-list-title">
                <strong><input name="selectedagentids-includes-agent-id" type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => setSelectedAgentIds((items) => toggleString(items, agent.id))} /> {agent.name}</strong>
                <span className={`pill ${agent.enabled ? "" : "warm"}`}>{agent.enabled ? t("contacts.enabled") : t("contacts.disabled")}</span>
              </div>
              {agent.description && <span className="subtle">{agent.description}</span>}
              <div className="project-list-meta">
                <span>{t("contacts.workspaceMode")}: {readableAgentWorkspaceMode(agent.workspaceMode, t)}</span>
                <span>{providers.find((provider) => provider.id === agent.providerId)?.name ?? t("contacts.defaultProvider")} · {agent.model ?? t("session.noModel")}</span>
                <span>{t("contacts.projectAccess")}: {agent.projectAccessMode} · {projectDisplayName(projects.find((project) => project.id === agent.defaultProjectId), projects) || t("session.noProject")}</span>
                <span>{t("contacts.permissionProfile")}: {readablePermissionProfile(agent.permissionProfileId ?? "custom", t)}</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.startAgentSession")} aria-label={t("contacts.startAgentSession")} onClick={() => openAgentSessionDialog(agent)}><IconText icon={MessageSquare}>{t("contacts.startAgentSession")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.continueLatest")} aria-label={t("contacts.continueLatest")} onClick={() => void continueLatestAgentSession(agent)}><IconText icon={PanelLeftOpen}>{t("contacts.continueLatest")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.sessions")} aria-label={t("contacts.sessions")} onClick={() => void openAgentSessions(agent)}><IconText icon={History}>{t("contacts.sessions")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "agent", item: agent })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void openAgentStats(agent)}><IconText icon={Activity}>{t("contacts.stats")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void duplicateAgent(agent)}><IconText icon={Copy}>{t("contacts.duplicate")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => startEditAgent(agent)}><IconText icon={Pencil}>{t("action.edit")}</IconText></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="danger-menu-item" onSelect={() => void deleteContact("agent", agent.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              </article>
            ))}
          </div>
          {contactPages.agents.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("agents")}>{t("session.loadMore")}</button>}
          {!agents.length && <div className="empty-state">{t("contacts.noAgents")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="groups">
          <div className="contact-content-toolbar">
            <span>{filteredGroups.length} {t("contacts.groups")}</span>
            <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createGroup")} aria-label={t("contacts.createGroup")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
          </div>
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createGroup}>
            <strong>{t("contacts.createGroup")}</strong>
            <input name="groupname" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("contacts.groupName")} required />
            <input name="groupdescription" value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input name="groupagentids-includes-agent-id" type="checkbox" checked={groupAgentIds.includes(agent.id)} onChange={() => toggleGroupAgent(agent.id)} />
                  <span>{agent.name}</span>
                  {groupAgentIds.includes(agent.id) && (
                    <select name="groupmemberlistenmodes-agent-id" value={groupMemberListenModes[agent.id] ?? "passive"} onChange={(event) => setGroupMemberListenModes((items) => ({ ...items, [agent.id]: event.target.value as AgentListenMode }))}>
                      {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                    </select>
                  )}
                </label>
              ))}
              {!agents.length && <span className="subtle">{t("contacts.noAgents")}</span>}
            </div>
            <Button>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredGroups.map((group) => (
              <article className="provider-card" key={group.id}>
              <div className="project-list-title">
                <strong>{group.name}</strong>
                <span className="pill">{group.agentIds.length} {t("contacts.members")}</span>
              </div>
              {group.description && <span className="subtle">{group.description}</span>}
              <code>{group.mergeStrategy}</code>
              <div className="project-list-meta">
                <span>{group.approvalPolicy}</span>
                <span>{group.maxConcurrentAgents} max</span>
                <span>{Object.entries(group.memberListenModes ?? {}).map(([agentId, mode]) => `${agents.find((agent) => agent.id === agentId)?.name ?? agentId}: ${mode}`).join(", ") || "-"}</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.startRoom")} aria-label={t("contacts.startRoom")} onClick={() => openRoomSessionDialog({ kind: "group", id: group.id, name: group.name })}><IconText icon={MessageSquare}>{t("contacts.startRoom")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.sessions")} aria-label={t("contacts.sessions")} onClick={() => void openRoomSessions("group", group.id, group.name)}><IconText icon={History}>{t("contacts.sessions")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "group", item: group })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.duplicate")} aria-label={t("contacts.duplicate")} onClick={() => void duplicateGroup(group)}><IconText icon={Copy}>{t("contacts.duplicate")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.edit")} aria-label={t("action.edit")} onClick={() => startEditGroup(group)}><IconText icon={Pencil}>{t("action.edit")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteContact("group", group.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>
              </div>
              </article>
            ))}
          </div>
          {contactPages.groups.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("groups")}>{t("session.loadMore")}</button>}
          {!filteredGroups.length && <div className="empty-state">{t("contacts.noGroups")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="roles">
          <div className="contact-content-toolbar">
            <span>{filteredRoles.length} {t("contacts.roles")}</span>
            <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createRole")} aria-label={t("contacts.createRole")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
          </div>
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createRole}>
            <strong>{t("contacts.createRole")}</strong>
            <select name="rolesourcetype" value={roleSourceType} onChange={(event) => setRoleSourceType(event.target.value as "builtin-template" | "custom-markdown" | "file-import")}>
              <option value="builtin-template">{t("contacts.builtinTemplate")}</option>
              <option value="custom-markdown">{t("contacts.customMarkdown")}</option>
              <option value="file-import">{t("contacts.fileImport")}</option>
            </select>
            <input name="rolename" value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder={roleSourceType === "builtin-template" ? t("contacts.roleNameOptional") : t("contacts.roleName")} required={roleSourceType === "custom-markdown"} />
            <input name="roledescription" value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <label className="inline-check">
              <input name="roledescriptioninprompt" type="checkbox" checked={roleDescriptionInPrompt} onChange={(event) => setRoleDescriptionInPrompt(event.target.checked)} />
              <span>{t("contacts.descriptionInPrompt")}</span>
            </label>
            {roleSourceType === "builtin-template" ? (
              <>
                <select name="roletemplateid" value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)} required>
                  <option value="">{t("contacts.selectTemplate")}</option>
                  {roleTemplates.map((template) => <option key={template.id} value={template.id}>{template.group} / {templateName(template)}</option>)}
                </select>
                {roleTemplates.find((template) => template.id === roleTemplateId) && (
                  <div className="template-preview">
                    <strong>{templateName(roleTemplates.find((template) => template.id === roleTemplateId))}</strong>
                    <span>{templateDescription(roleTemplates.find((template) => template.id === roleTemplateId))}</span>
                    <code>{roleTemplates.find((template) => template.id === roleTemplateId)?.sourcePath}</code>
                  </div>
                )}
              </>
            ) : roleSourceType === "file-import" ? (
              <input name="rolesourcepath" value={roleSourcePath} onChange={(event) => setRoleSourcePath(event.target.value)} placeholder={t("contacts.roleFilePath")} required />
            ) : (
              <textarea name="roleprompt" value={rolePrompt} onChange={(event) => setRolePrompt(event.target.value)} placeholder={t("contacts.systemPrompt")} required />
            )}
            <Button>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredRoles.map((role) => (
              <article className="provider-card" key={role.id}>
              <div className="project-list-title">
                <strong>{role.name}</strong>
                <span className="pill">{role.sourceType}</span>
              </div>
              <span className="subtle">{role.description}</span>
              <div className="project-list-meta">
                {roleTemplateName(role) && <span>{t("contacts.selectedTemplate")}: {roleTemplateName(role)}</span>}
                <span>{role.defaultListenMode}</span>
                <span>{role.defaultWorkspaceMode}</span>
                <span>{role.capabilities.join(", ") || "-"}</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyRoleContent(role)}><IconText icon={Copy}>{t("action.copy")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "role", item: role })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.duplicate")} aria-label={t("contacts.duplicate")} onClick={() => void duplicateRole(role)}><IconText icon={FilePlus2}>{t("contacts.duplicate")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.edit")} aria-label={t("action.edit")} onClick={() => startEditRole(role)}><IconText icon={Pencil}>{t("action.edit")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteContact("role", role.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>
              </div>
              </article>
            ))}
          </div>
          {contactPages.roles.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("roles")}>{t("session.loadMore")}</button>}
          {!filteredRoles.length && <div className="empty-state">{t("contacts.noRoles")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="circles">
          <div className="contact-content-toolbar">
            <span>{filteredCircles.length} {t("contacts.circles")}</span>
            <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createCircle")} aria-label={t("contacts.createCircle")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
          </div>
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createCircle}>
            <strong>{t("contacts.createCircle")}</strong>
            <input name="circlename" value={circleName} onChange={(event) => setCircleName(event.target.value)} placeholder={t("contacts.circleName")} required />
            <input name="circledescription" value={circleDescription} onChange={(event) => setCircleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {roles.map((role) => (
                <label key={role.id}>
                  <input name="circleroleids-includes-role-id" type="checkbox" checked={circleRoleIds.includes(role.id)} onChange={() => toggleCircleRole(role.id)} />
                  <span>{role.name}</span>
                </label>
              ))}
              {!roles.length && <span className="subtle">{t("contacts.noRoles")}</span>}
            </div>
            <textarea name="circlerules" value={circleRules} onChange={(event) => setCircleRules(event.target.value)} placeholder={t("contacts.collaborationRules")} />
            <Button>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredCircles.map((circle) => (
              <article className="provider-card" key={circle.id}>
              <div className="project-list-title">
                <strong>{circle.name}</strong>
                {circle.builtin && <span className="pill">{t("contacts.builtin")}</span>}
              </div>
              {circle.description && <span className="subtle">{circle.description}</span>}
              <div className="project-list-meta">
                <span>{circle.roleIds.length} {t("contacts.roles")}</span>
                <span>{t("contacts.members")}: {circle.maxConcurrentAgents} max</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.createGroupFromCircle")} aria-label={t("contacts.createGroupFromCircle")} onClick={() => void createGroupFromCircle(circle)}><IconText icon={Users}>{t("contacts.createGroupFromCircle")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.sessions")} aria-label={t("contacts.sessions")} onClick={() => void openRoomSessions("circle", circle.id, circle.name)}><IconText icon={History}>{t("contacts.sessions")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "circle", item: circle })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.duplicate")} aria-label={t("contacts.duplicate")} onClick={() => void duplicateCircle(circle)}><IconText icon={Copy}>{t("contacts.duplicate")}</IconText></Button>
                {!circle.builtin && <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.edit")} aria-label={t("action.edit")} onClick={() => startEditCircle(circle)}><IconText icon={Pencil}>{t("action.edit")}</IconText></Button>}
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.startRoom")} aria-label={t("contacts.startRoom")} onClick={() => openRoomSessionDialog({ kind: "circle", id: circle.id, name: circle.name })}><IconText icon={MessageSquare}>{t("contacts.startRoom")}</IconText></Button>
                {!circle.builtin && <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteContact("circle", circle.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>}
              </div>
              </article>
            ))}
          </div>
          {contactPages.circles.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("circles")}>{t("session.loadMore")}</button>}
          {!filteredCircles.length && <div className="empty-state">{t("contacts.noCircles")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="permissions">
          <div className="contact-content-toolbar">
            <span>{permissionProfiles.length} {t("contacts.permissionProfiles")}</span>
          </div>
          <div className="contact-card-grid">
            {permissionProfiles.map((profile) => (
              <article className="provider-card" key={profile.id}>
              <div className="project-list-title">
                <strong>{readablePermissionProfile(profile.id as PermissionProfileId, t)}</strong>
                <span className="pill">{t("contacts.permissionProfile")}</span>
              </div>
              <pre className="approval-details">{prettyJson(profile.permissions)}</pre>
              </article>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      {contactCreatePanelOpen && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{contactTab === "agents" ? t("contacts.createAgent") : contactTab === "groups" ? t("contacts.createGroup") : contactTab === "roles" ? t("contacts.createRole") : t("contacts.createCircle")}</strong>
              <span>{t("page.contacts")}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setContactCreatePanelOpen(false)}><X size={16} /></button>
          </div>
          {contactTab === "agents" && (
            <form className="management-form" onSubmit={createAgent}>
              <input name="modal-agentname" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder={t("contacts.agentName")} required />
              <select name="modal-agentroleid" value={agentRoleId} onChange={(event) => setAgentRoleId(event.target.value)} required>
                <option value="">{t("contacts.selectRole")}</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              <select name="modal-agentproviderid" value={agentProviderId} onChange={(event) => {
                const provider = providers.find((item) => item.id === event.target.value);
                setAgentProviderId(event.target.value);
                setAgentModel(provider?.defaultModel ?? "");
                setAgentModels(provider?.defaultModel ? [provider.defaultModel] : []);
                setAgentCustomModel(false);
              }}>
                <option value="">{t("contacts.defaultProvider")}</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
              <div className="inline-field-with-action">
                <select name="modal-agentcustommodel" value={agentCustomModel || !agentModels.includes(agentModel) ? "__custom" : agentModel} onChange={(event) => {
                  if (event.target.value === "__custom") {
                    setAgentCustomModel(true);
                    return;
                  }
                  setAgentCustomModel(false);
                  setAgentModel(event.target.value);
                }}>
                  {agentModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  <option value="__custom">{t("contacts.customModel")}</option>
                </select>
                <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!agentProviderId || discoveringAgentModels} onClick={() => void discoverAgentModels(agentProviderId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
              </div>
              {(agentCustomModel || !agentModels.length || !agentModels.includes(agentModel)) && <input name="modal-agentmodel" value={agentModel} onChange={(event) => setAgentModel(event.target.value)} placeholder={t("contacts.agentModel")} />}
              <input name="modal-agentdescription" value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} placeholder={t("contacts.description")} />
              <textarea name="modal-agentextraprompt" value={agentExtraPrompt} onChange={(event) => setAgentExtraPrompt(event.target.value)} placeholder={t("contacts.extraPrompt")} />
              <select name="modal-agentpermissionprofileid" value={agentPermissionProfileId} onChange={(event) => setAgentPermissionProfileId(event.target.value as PermissionProfileId)}>
                {(["read-only", "workspace-write", "developer", "maintainer", "danger-full-access"] as PermissionProfileId[]).map((profile) => <option key={profile} value={profile}>{readablePermissionProfile(profile, t)}</option>)}
              </select>
              <select name="modal-agentprojectaccessmode" value={agentProjectAccessMode} onChange={(event) => setAgentProjectAccessMode(event.target.value as AgentProjectAccessMode)}>
                <option value="none">{t("contacts.projectAccessNone")}</option>
                <option value="selected">{t("contacts.projectAccessSelected")}</option>
                <option value="all">{t("contacts.projectAccessAll")}</option>
              </select>
              <select name="modal-agentdefaultprojectid" value={agentDefaultProjectId} onChange={(event) => setAgentDefaultProjectId(event.target.value)}>
                <option value="">{t("session.noProject")}</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
              </select>
              <div className="checkbox-grid">
                {projects.map((project) => (
                  <label key={project.id} className="inline-check">
                    <input name="modal-agentallowedprojectids-includes-project-id" type="checkbox" checked={agentAllowedProjectIds.includes(project.id)} onChange={() => setAgentAllowedProjectIds((items) => toggleString(items, project.id))} />
                    <span>{projectDisplayName(project, projects)}</span>
                  </label>
                ))}
              </div>
              <div className="checkbox-grid">
                {projects.map((project) => (
                  <label key={project.id} className="inline-check">
                    <input name="modal-agentfavoriteprojectids-includes-project-id" type="checkbox" checked={agentFavoriteProjectIds.includes(project.id)} onChange={() => setAgentFavoriteProjectIds((items) => toggleString(items, project.id))} />
                    <span>{t("contacts.favoriteProject")}: {projectDisplayName(project, projects)}</span>
                  </label>
                ))}
              </div>
              <Button disabled={!roles.length}>{t("action.create")}</Button>
            </form>
          )}
          {contactTab === "groups" && (
            <form className="management-form" onSubmit={createGroup}>
              <input name="modal-groupname" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("contacts.groupName")} required />
              <input name="modal-groupdescription" value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder={t("contacts.description")} />
              <div className="checkbox-grid">
                {agents.map((agent) => (
                  <label key={agent.id}>
                    <input name="modal-groupagentids-includes-agent-id" type="checkbox" checked={groupAgentIds.includes(agent.id)} onChange={() => toggleGroupAgent(agent.id)} />
                    <span>{agent.name}</span>
                    {groupAgentIds.includes(agent.id) && (
                      <select name="modal-groupmemberlistenmodes-agent-id" value={groupMemberListenModes[agent.id] ?? "passive"} onChange={(event) => setGroupMemberListenModes((items) => ({ ...items, [agent.id]: event.target.value as AgentListenMode }))}>
                        {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                      </select>
                    )}
                  </label>
                ))}
                {!agents.length && <span className="subtle">{t("contacts.noAgents")}</span>}
              </div>
              <Button>{t("action.create")}</Button>
            </form>
          )}
          {contactTab === "roles" && (
            <form className="management-form" onSubmit={createRole}>
              <select name="modal-rolesourcetype" value={roleSourceType} onChange={(event) => setRoleSourceType(event.target.value as "builtin-template" | "custom-markdown" | "file-import")}>
                <option value="builtin-template">{t("contacts.builtinTemplate")}</option>
                <option value="custom-markdown">{t("contacts.customMarkdown")}</option>
                <option value="file-import">{t("contacts.fileImport")}</option>
              </select>
              <input name="modal-rolename" value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder={roleSourceType === "builtin-template" ? t("contacts.roleNameOptional") : t("contacts.roleName")} required={roleSourceType === "custom-markdown"} />
              <input name="modal-roledescription" value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} placeholder={t("contacts.description")} />
              <label className="inline-check">
                <input name="modal-roledescriptioninprompt" type="checkbox" checked={roleDescriptionInPrompt} onChange={(event) => setRoleDescriptionInPrompt(event.target.checked)} />
                <span>{t("contacts.descriptionInPrompt")}</span>
              </label>
              {roleSourceType === "builtin-template" ? (
                <>
                  <select name="modal-roletemplateid" value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)} required>
                    <option value="">{t("contacts.selectTemplate")}</option>
                    {roleTemplates.map((template) => <option key={template.id} value={template.id}>{template.group} / {templateName(template)}</option>)}
                  </select>
                  {roleTemplates.find((template) => template.id === roleTemplateId) && (
                    <div className="template-preview">
                      <strong>{templateName(roleTemplates.find((template) => template.id === roleTemplateId))}</strong>
                      <span>{templateDescription(roleTemplates.find((template) => template.id === roleTemplateId))}</span>
                      <code>{roleTemplates.find((template) => template.id === roleTemplateId)?.sourcePath}</code>
                    </div>
                  )}
                </>
              ) : roleSourceType === "file-import" ? (
                <input name="modal-rolesourcepath" value={roleSourcePath} onChange={(event) => setRoleSourcePath(event.target.value)} placeholder={t("contacts.roleFilePath")} required />
              ) : (
                <textarea name="modal-roleprompt" value={rolePrompt} onChange={(event) => setRolePrompt(event.target.value)} placeholder={t("contacts.systemPrompt")} required />
              )}
              <Button>{t("action.create")}</Button>
            </form>
          )}
          {contactTab === "circles" && (
            <form className="management-form" onSubmit={createCircle}>
              <input name="modal-circlename" value={circleName} onChange={(event) => setCircleName(event.target.value)} placeholder={t("contacts.circleName")} required />
              <input name="modal-circledescription" value={circleDescription} onChange={(event) => setCircleDescription(event.target.value)} placeholder={t("contacts.description")} />
              <div className="checkbox-grid">
                {roles.map((role) => (
                  <label key={role.id}>
                    <input name="modal-circleroleids-includes-role-id" type="checkbox" checked={circleRoleIds.includes(role.id)} onChange={() => toggleCircleRole(role.id)} />
                    <span>{role.name}</span>
                  </label>
                ))}
                {!roles.length && <span className="subtle">{t("contacts.noRoles")}</span>}
              </div>
              <textarea name="modal-circlerules" value={circleRules} onChange={(event) => setCircleRules(event.target.value)} placeholder={t("contacts.collaborationRules")} />
              <Button>{t("action.create")}</Button>
            </form>
          )}
        </div>
      )}
      {editingAgentId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.editAgent")}</strong>
              <span>{editingAgentName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingAgentId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateAgent}>
            <input name="modal-editingagentname" value={editingAgentName} onChange={(event) => setEditingAgentName(event.target.value)} placeholder={t("contacts.agentName")} required />
            <select name="modal-editingagentroleid" value={editingAgentRoleId} onChange={(event) => setEditingAgentRoleId(event.target.value)} required>
              <option value="">{t("contacts.selectRole")}</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <select name="modal-editingagentproviderid" value={editingAgentProviderId} onChange={(event) => {
              const provider = providers.find((item) => item.id === event.target.value);
              setEditingAgentProviderId(event.target.value);
              const models = provider?.models?.length ? provider.models : provider?.defaultModel ? [provider.defaultModel] : [];
              setEditingAgentModels(models);
              setEditingAgentCustomModel(false);
              setEditingAgentModel(models[0] ?? provider?.defaultModel ?? "");
            }}>
              <option value="">{t("contacts.defaultProvider")}</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
            <div className="inline-field-with-action">
              <select name="modal-editingagentcustommodel" value={editingAgentCustomModel || !editingAgentModels.includes(editingAgentModel) ? "__custom" : editingAgentModel} onChange={(event) => {
                if (event.target.value === "__custom") {
                  setEditingAgentCustomModel(true);
                  return;
                }
                setEditingAgentCustomModel(false);
                setEditingAgentModel(event.target.value);
              }}>
                {editingAgentModels.map((model) => <option key={model} value={model}>{model}</option>)}
                <option value="__custom">{t("contacts.customModel")}</option>
              </select>
              <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!editingAgentProviderId || discoveringEditingAgentModels} onClick={() => void discoverEditingAgentModels(editingAgentProviderId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
            </div>
            {(editingAgentCustomModel || !editingAgentModels.length || !editingAgentModels.includes(editingAgentModel)) && <input name="modal-editingagentmodel" value={editingAgentModel} onChange={(event) => setEditingAgentModel(event.target.value)} placeholder={t("contacts.agentModel")} />}
            <select name="modal-editingagentworkspacemode" value={editingAgentWorkspaceMode} onChange={(event) => setEditingAgentWorkspaceMode(event.target.value as AgentSummary["workspaceMode"])}>
              {(["shared-readonly", "isolated-worktree", "isolated-worktree-with-shared-room", "shared-write", "merge-workspace"] as AgentSummary["workspaceMode"][]).map((mode) => (
                <option key={mode} value={mode}>{readableAgentWorkspaceMode(mode, t)}</option>
              ))}
            </select>
            <input name="modal-editingagentdescription" value={editingAgentDescription} onChange={(event) => setEditingAgentDescription(event.target.value)} placeholder={t("contacts.description")} />
            <textarea name="modal-editingagentextraprompt" value={editingAgentExtraPrompt} onChange={(event) => setEditingAgentExtraPrompt(event.target.value)} placeholder={t("contacts.extraPrompt")} />
            <select name="modal-editingagentpermissionprofileid" value={editingAgentPermissionProfileId} onChange={(event) => setEditingAgentPermissionProfileId(event.target.value as PermissionProfileId)}>
              {(["read-only", "workspace-write", "developer", "maintainer", "danger-full-access"] as PermissionProfileId[]).map((profile) => <option key={profile} value={profile}>{readablePermissionProfile(profile, t)}</option>)}
            </select>
            <select name="modal-editingagentprojectaccessmode" value={editingAgentProjectAccessMode} onChange={(event) => setEditingAgentProjectAccessMode(event.target.value as AgentProjectAccessMode)}>
              <option value="none">{t("contacts.projectAccessNone")}</option>
              <option value="selected">{t("contacts.projectAccessSelected")}</option>
              <option value="all">{t("contacts.projectAccessAll")}</option>
            </select>
            <select name="modal-editingagentdefaultprojectid" value={editingAgentDefaultProjectId} onChange={(event) => setEditingAgentDefaultProjectId(event.target.value)}>
              <option value="">{t("session.noProject")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="modal-editingagentallowedprojectids-includes-project-id" type="checkbox" checked={editingAgentAllowedProjectIds.includes(project.id)} onChange={() => setEditingAgentAllowedProjectIds((items) => toggleString(items, project.id))} />
                  <span>{projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="modal-editingagentfavoriteprojectids-includes-project-id" type="checkbox" checked={editingAgentFavoriteProjectIds.includes(project.id)} onChange={() => setEditingAgentFavoriteProjectIds((items) => toggleString(items, project.id))} />
                  <span>{t("contacts.favoriteProject")}: {projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <label className="inline-check">
              <input name="modal-editingagentenabled" type="checkbox" checked={editingAgentEnabled} onChange={(event) => setEditingAgentEnabled(event.target.checked)} />
              <span>{editingAgentEnabled ? t("contacts.enabled") : t("contacts.disabled")}</span>
            </label>
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingAgentId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {editingGroupId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("action.edit")} {t("contacts.groups")}</strong>
              <span>{editingGroupName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingGroupId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateGroup}>
            <input name="modal-editinggroupname" value={editingGroupName} onChange={(event) => setEditingGroupName(event.target.value)} placeholder={t("contacts.groupName")} required />
            <input name="modal-editinggroupdescription" value={editingGroupDescription} onChange={(event) => setEditingGroupDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input name="modal-editinggroupagentids-includes-agent-id" type="checkbox" checked={editingGroupAgentIds.includes(agent.id)} onChange={() => toggleEditingGroupAgent(agent.id)} />
                  <span>{agent.name}</span>
                  {editingGroupAgentIds.includes(agent.id) && (
                    <select name="modal-editinggroupmemberlistenmodes-agent-id" value={editingGroupMemberListenModes[agent.id] ?? "passive"} onChange={(event) => setEditingGroupMemberListenModes((items) => ({ ...items, [agent.id]: event.target.value as AgentListenMode }))}>
                      {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                    </select>
                  )}
                </label>
              ))}
            </div>
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingGroupId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {editingRoleId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.editRole")}</strong>
              <span>{editingRoleName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingRoleId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateRole}>
            <input name="modal-editingrolename" value={editingRoleName} onChange={(event) => setEditingRoleName(event.target.value)} placeholder={t("contacts.roleName")} required />
            <input name="modal-editingroledescription" value={editingRoleDescription} onChange={(event) => setEditingRoleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <label className="inline-check">
              <input name="modal-editingroledescriptioninprompt" type="checkbox" checked={editingRoleDescriptionInPrompt} onChange={(event) => setEditingRoleDescriptionInPrompt(event.target.checked)} />
              <span>{t("contacts.descriptionInPrompt")}</span>
            </label>
            <textarea name="modal-editingroleprompt" value={editingRolePrompt} onChange={(event) => setEditingRolePrompt(event.target.value)} placeholder={t("contacts.systemPrompt")} required />
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingRoleId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {editingCircleId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("action.edit")} {t("contacts.circles")}</strong>
              <span>{editingCircleName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingCircleId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateCircle}>
            <input name="modal-editingcirclename" value={editingCircleName} onChange={(event) => setEditingCircleName(event.target.value)} placeholder={t("contacts.circleName")} required />
            <input name="modal-editingcircledescription" value={editingCircleDescription} onChange={(event) => setEditingCircleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {roles.map((role) => (
                <label key={role.id}>
                  <input name="modal-editingcircleroleids-includes-role-id" type="checkbox" checked={editingCircleRoleIds.includes(role.id)} onChange={() => setEditingCircleRoleIds((items) => toggleString(items, role.id))} />
                  <span>{role.name}</span>
                </label>
              ))}
              {!roles.length && <span className="subtle">{t("contacts.noRoles")}</span>}
            </div>
            <textarea name="modal-editingcirclerules" value={editingCircleRules} onChange={(event) => setEditingCircleRules(event.target.value)} placeholder={t("contacts.collaborationRules")} />
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingCircleId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {detailContact && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("preview.details")}</strong>
              <span>{detailContact.kind}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setDetailContact(null)}><X size={16} /></button>
          </div>
          <div className="preview-detail">
            <pre className="approval-details">{prettyJson(detailContact.item)}</pre>
          </div>
        </div>
      )}
      {agentSessionDialog && (
        <div className="workspace-modal compact-modal session-start-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.startAgentSession")}</strong>
              <span>{agentSessionDialog.agent.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setAgentSessionDialog(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail session-project-dialog">
            <label className="project-select-label">
              <span>{t("contacts.sessionProject")}</span>
              <div className="project-select-field">
                <FolderGit2 size={16} />
                <select name="agentsessiondialog-projectid" value={agentSessionDialog.projectId} onChange={(event) => setAgentSessionDialog((current) => current ? { ...current, projectId: event.target.value } : current)}>
                  <option value="">{t("session.noProject")}</option>
                  {agentProjectOptions(agentSessionDialog.agent).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.id === agentSessionDialog.agent.defaultProjectId ? `${projectDisplayName(project, projects)} · ${t("contacts.defaultProject")}` : projectDisplayName(project, projects)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <div className="session-dialog-facts">
              <code>{projects.find((project) => project.id === agentSessionDialog.projectId)?.workspacePath ?? t("session.noProject")}</code>
              <span>{t("contacts.projectAccess")}: {agentSessionDialog.agent.projectAccessMode}</span>
              <span>{t("contacts.permissionProfile")}: {readablePermissionProfile(agentSessionDialog.agent.permissionProfileId ?? "custom", t)}</span>
              <span>{providers.find((provider) => provider.id === agentSessionDialog.agent.providerId)?.name ?? t("contacts.defaultProvider")} / {agentSessionDialog.agent.model ?? t("session.noModel")}</span>
            </div>
            {agentSessionDialog.agent.favoriteProjectIds.length > 0 && (
              <div className="room-mention-bar">
                {agentSessionDialog.agent.favoriteProjectIds
                  .map((projectId) => projects.find((project) => project.id === projectId))
                  .filter((project): project is ProjectSummary => Boolean(project))
                  .map((project) => (
                    <button className="ghost-button" type="button" key={project.id} onClick={() => setAgentSessionDialog((current) => current ? { ...current, projectId: project.id } : current)}>{projectDisplayName(project, projects)}</button>
                  ))}
              </div>
            )}
            <div className="row-actions">
              <Button type="button" onClick={() => void startAgentSession(agentSessionDialog.agent, agentSessionDialog.projectId || null)}>{t("contacts.startAgentSession")}</Button>
              <Button variant="outline" type="button" onClick={() => setAgentSessionDialog(null)}>{t("action.cancel")}</Button>
            </div>
          </div>
        </div>
      )}
      {roomSessionDialog && (
        <div className="workspace-modal compact-modal session-start-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.startRoom")}</strong>
              <span>{roomSessionDialog.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setRoomSessionDialog(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail session-project-dialog">
            <label className="project-select-label">
              <span>{t("contacts.sessionProject")}</span>
              <div className="project-select-field">
                <FolderGit2 size={16} />
                <select name="roomsessiondialog-projectid" value={roomSessionDialog.projectId} onChange={(event) => setRoomSessionDialog((current) => current ? { ...current, projectId: event.target.value } : current)}>
                  <option value="">{t("session.noProject")}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <div className="session-dialog-facts">
              <span>{roomSessionDialog.kind === "group" ? t("contacts.groups") : t("contacts.circles")}</span>
              <code>{projects.find((project) => project.id === roomSessionDialog.projectId)?.workspacePath ?? t("session.noProject")}</code>
            </div>
            <div className="row-actions">
              <Button type="button" onClick={() => void startRoomFromDialog()}>{t("contacts.startRoom")}</Button>
              <Button variant="outline" type="button" onClick={() => setRoomSessionDialog(null)}>{t("action.cancel")}</Button>
            </div>
          </div>
        </div>
      )}
      {agentSessionsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.sessions")}</strong>
              <span>{agentSessionsPanel.agent.name}</span>
            </div>
            <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.continueLatest")} aria-label={t("contacts.continueLatest")} onClick={() => void continueLatestAgentSession(agentSessionsPanel.agent)}><IconText icon={PanelLeftOpen}>{t("contacts.continueLatest")}</IconText></Button>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setAgentSessionsPanel(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail">
            <strong>{t("contacts.sessionFilters")}</strong>
            {contactSessionFilters(() => void openAgentSessions(agentSessionsPanel.agent))}
            {!agentSessionsPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
            {agentSessionsPanel.sessions?.map((session) => (
              <button className="file-list-item" key={session.id} type="button" onClick={() => onOpenSession(session.id)}>
                <span>{session.title}</span>
                <em>{sessionOriginLabel(session)}</em>
              </button>
            ))}
            {agentSessionsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openAgentSessions(agentSessionsPanel.agent, true)}>{t("session.loadMore")}</button>}
            {agentSessionsPanel.sessions && !agentSessionsPanel.sessions.length && <div className="empty-state">{t("contacts.noSessions")}</div>}
          </div>
        </div>
      )}
      {roomSessionsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.roomSessions")}</strong>
              <span>{roomSessionsPanel.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setRoomSessionsPanel(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail">
            <strong>{t("contacts.sessionFilters")}</strong>
            {contactSessionFilters(() => void openRoomSessions(roomSessionsPanel.kind, roomSessionsPanel.id, roomSessionsPanel.name))}
            {!roomSessionsPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
            {roomSessionsPanel.sessions?.map((session) => (
              <button className="file-list-item" key={session.id} type="button" onClick={() => onOpenSession(session.id)}>
                <span>{session.title}</span>
                <em>{sessionOriginLabel(session)}</em>
              </button>
            ))}
            {roomSessionsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openRoomSessions(roomSessionsPanel.kind, roomSessionsPanel.id, roomSessionsPanel.name, true)}>{t("session.loadMore")}</button>}
            {roomSessionsPanel.sessions && !roomSessionsPanel.sessions.length && <div className="empty-state">{t("contacts.noSessions")}</div>}
          </div>
        </div>
      )}
      {agentStatsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.stats")}</strong>
              <span>{agentStatsPanel.agent.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setAgentStatsPanel(null)}><X size={16} /></button>
          </div>
          <div className="preview-detail">
            <pre className="approval-details">{prettyJson(agentStatsPanel.stats)}</pre>
          </div>
        </div>
      )}
    </main>
  );
}

function ExtensionsPage({ sessionToken, title, t, notify, onOpenMainNav }: { sessionToken: string; title: string; t: TFunction; notify: (message: string, tone?: ToastTone) => void; onOpenMainNav?: () => void }) {
  const [tab, setTab] = useState<ExtensionSummary["type"]>("plugin");
  const [items, setItems] = useState<Record<ExtensionSummary["type"], ExtensionSummary[]>>({ plugin: [], skill: [], mcp: [] });
  const [extensionCursors, setExtensionCursors] = useState<Record<ExtensionSummary["type"], string | null>>({ plugin: null, skill: null, mcp: null });
  const [extensionHasMore, setExtensionHasMore] = useState<Record<ExtensionSummary["type"], boolean>>({ plugin: false, skill: false, mcp: false });
  const [extensionSearch, setExtensionSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedExtension, setSelectedExtension] = useState<ExtensionSummary | null>(null);
  const [extensionDetail, setExtensionDetail] = useState<ExtensionDetail | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<{ name: string; path: string } | null>(null);

  function extensionEndpoint(type: ExtensionSummary["type"]) {
    return type === "plugin" ? "plugins" : type === "skill" ? "skills" : "mcp";
  }

  async function loadExtensionType(type: ExtensionSummary["type"], reset = false, q = extensionSearch) {
    const params = new URLSearchParams({ limit: "20" });
    const cursor = extensionCursors[type];
    if (!reset && cursor) params.set("cursor", cursor);
    if (q.trim()) params.set("q", q.trim());
    const response = await fetch(`/api/extensions/${extensionEndpoint(type)}?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) throw new Error("extension_read_failed");
    const page = (await response.json()) as PageResponse<ExtensionSummary>;
    setItems((current) => ({ ...current, [type]: reset ? page.items : [...current[type], ...page.items] }));
    setExtensionCursors((current) => ({ ...current, [type]: page.nextCursor }));
    setExtensionHasMore((current) => ({ ...current, [type]: page.hasMore }));
  }

  async function loadExtensions(reset = true, q = extensionSearch) {
    setLoading(true);
    setMessage("");
    try {
      await Promise.all(tabs.map((item) => loadExtensionType(item.id, reset, q)));
    } catch {
      setMessage(t("extension.readFailed"));
      notify(t("extension.readFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExtensions();
  }, [sessionToken]);

  const tabs: Array<{ id: ExtensionSummary["type"]; label: string }> = [
    { id: "plugin", label: t("extension.plugins") },
    { id: "skill", label: t("extension.skills") },
    { id: "mcp", label: t("extension.mcpServers") },
  ];
  const activeItems = items[tab];

  function extensionDirectory(item: ExtensionSummary) {
    if (!item.path) return "";
    if (item.path.endsWith(".toml") || item.path.endsWith(".json") || item.path.endsWith(".md")) {
      return item.path.split("/").slice(0, -1).join("/") || "/";
    }
    return item.path;
  }

  async function copyExtensionPath(item: ExtensionSummary) {
    if (!item.path) return;
    const copied = await copyText(item.path);
    setMessage(copied ? t("extension.pathCopied") : t("settings.copyFailed"));
    notify(copied ? t("extension.pathCopied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function openExtensionDetail(item: ExtensionSummary) {
    setSelectedExtension(item);
    setExtensionDetail(null);
    const params = new URLSearchParams({ type: item.type, name: item.name });
    if (item.path) params.set("path", item.path);
    const response = await fetch(`/api/extensions/detail?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setMessage(t("extension.detailReadFailed"));
      notify(t("extension.detailReadFailed"), "error");
      return;
    }
    setExtensionDetail((await response.json()) as ExtensionDetail);
  }

  return (
    <main className="management-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.extensions")}`} title={title} action={loading ? t("session.loading") : t("action.refresh")} onAction={() => void loadExtensions(true)} onOpenMainNav={onOpenMainNav} menuLabel={title} />
      <FilterToolbar className="extension-filter-toolbar">
        <FilterSearchInput
          value={extensionSearch}
          onChange={(event) => setExtensionSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadExtensions(true, extensionSearch);
          }}
          placeholder={t("extension.searchExtensions")}
        />
        <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadExtensions(true, extensionSearch)}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
      </FilterToolbar>
      <section className="extensions-layout">
        <aside className="extensions-tabs">
          {tabs.map((item) => (
            <button className={`extension-tab ${tab === item.id ? "active" : ""}`} key={item.id} type="button" onClick={() => setTab(item.id)}>
              <strong>{item.label}</strong>
              <span>{items[item.id].length}</span>
            </button>
          ))}
        </aside>
        <section className="extension-list">
          {message && <span className="form-error">{message}</span>}
          {activeItems.map((item) => (
            <article className="extension-card" key={item.id}>
              <div className="extension-card-head">
                <strong>{item.name}</strong>
                <span>{item.source ?? item.type}</span>
              </div>
              {item.description && <p>{item.description}</p>}
              {item.path && <code>{item.path}</code>}
              <div className="extension-card-actions">
                <button className="ghost-button icon-only" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => void openExtensionDetail(item)}><IconText icon={Activity}>{t("preview.details")}</IconText></button>
                {item.path && <button className="ghost-button icon-only" type="button" title={t("extension.openDirectory")} aria-label={t("extension.openDirectory")} onClick={() => setWorkspaceRoot({ name: item.name, path: extensionDirectory(item) })}><IconText icon={FolderOpen}>{t("extension.openDirectory")}</IconText></button>}
                {item.path && <button className="ghost-button icon-only" type="button" title={t("file.copyPath")} aria-label={t("file.copyPath")} onClick={() => void copyExtensionPath(item)}><IconText icon={Copy}>{t("file.copyPath")}</IconText></button>}
              </div>
            </article>
          ))}
          {extensionHasMore[tab] && <button className="ghost-button load-more" type="button" disabled={loading} onClick={() => void loadExtensionType(tab, false, extensionSearch)}>{t("session.loadMore")}</button>}
          {!loading && !activeItems.length && <div className="empty-state">{t("extension.noItems")}</div>}
        </section>
      </section>
      {selectedExtension && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{selectedExtension.name}</strong>
              <span>{selectedExtension.type} · {selectedExtension.source ?? t("extension.local")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => {
              setSelectedExtension(null);
              setExtensionDetail(null);
            }}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {(extensionDetail?.item.description ?? selectedExtension.description) && <p>{extensionDetail?.item.description ?? selectedExtension.description}</p>}
            {(extensionDetail?.item.path ?? selectedExtension.path) && <code>{extensionDetail?.item.path ?? selectedExtension.path}</code>}
            <pre className="extension-detail-content">{extensionDetail?.content ?? t("extension.readingDetail")}</pre>
          </div>
        </div>
      )}
      {workspaceRoot && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{workspaceRoot.name}</strong>
              <span>{workspaceRoot.path}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setWorkspaceRoot(null)}>{t("action.close")}</button>
          </div>
          <div className="workspace-modal-body">
            <FilesPage sessionToken={sessionToken} t={(key) => key} initialRootPath={workspaceRoot.path} initialMountName={workspaceRoot.name} embedded />
          </div>
        </div>
      )}
    </main>
  );
}

function ApprovalsPage({
  sessionToken,
  t,
  notify,
  onPendingChange,
  onOpenMainNav,
}: {
  sessionToken: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onPendingChange: (count: number) => void;
  onOpenMainNav?: () => void;
}) {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [approvalCursor, setApprovalCursor] = useState<string | null>(null);
  const [approvalHasMore, setApprovalHasMore] = useState(false);
  const [grants, setGrants] = useState<ApprovalGrantSummary[]>([]);
  const [grantCursor, setGrantCursor] = useState<string | null>(null);
  const [grantHasMore, setGrantHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"pending" | "all" | "archived" | "grants">("pending");
  const [busy, setBusy] = useState("");

  async function loadApprovals(filter = statusFilter, older = false) {
    const params = new URLSearchParams({ limit: "20" });
    if (filter === "pending") params.set("status", "pending");
    if (filter === "archived") params.set("archived", "true");
    if (older && approvalCursor) params.set("cursor", approvalCursor);
    const response = await fetch(`/api/approvals?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("approval.loadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<ApprovalSummary>;
    setApprovals((current) => older ? [...current, ...page.items] : page.items);
    setApprovalCursor(page.nextCursor);
    setApprovalHasMore(page.hasMore);
    if (filter === "pending") onPendingChange(page.items.length + (page.hasMore ? 1 : 0));
  }

  async function loadGrants(older = false) {
    const params = new URLSearchParams({ limit: "20" });
    if (older && grantCursor) params.set("cursor", grantCursor);
    const response = await fetch(`/api/approval-grants?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("approval.loadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<ApprovalGrantSummary>;
    setGrants((current) => older ? [...current, ...page.items] : page.items);
    setGrantCursor(page.nextCursor);
    setGrantHasMore(page.hasMore);
  }

  useEffect(() => {
    if (statusFilter === "grants") void loadGrants();
    else void loadApprovals(statusFilter);
  }, [sessionToken, statusFilter]);

  async function decide(approvalId: string, decision: "approve" | "deny", always = false, expiresIn?: number) {
    setBusy(approvalId);
    try {
      const params = new URLSearchParams();
      if (always && decision === "approve") params.set("always", "true");
      if (expiresIn && decision === "approve") params.set("expiresIn", String(expiresIn));
      const response = await fetch(`/api/approvals/${approvalId}/${decision}${params.size ? `?${params}` : ""}`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as ApprovalDecisionResponse | { error?: string } | null;
      if (!response.ok || !result || !("approval" in result)) {
        notify(t("approval.decisionFailed"), "error");
        return;
      }
      notify(decision === "approve" ? (always ? t("approval.approvedAlways") : expiresIn ? t("approval.approvedTemporarily") : t("approval.approved")) : t("approval.denied"), decision === "approve" ? "success" : "info");
      await loadApprovals();
    } catch {
      notify(t("approval.decisionFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function archiveApprovalRecord(approvalId: string) {
    setBusy(approvalId);
    try {
      const response = await fetch(`/api/approvals/${approvalId}/archive`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(t("approval.archiveFailed"), "error");
        return;
      }
      notify(t("approval.archived"), "success");
      await loadApprovals(statusFilter);
    } finally {
      setBusy("");
    }
  }

  async function restoreApprovalRecord(approvalId: string) {
    setBusy(approvalId);
    try {
      const response = await fetch(`/api/approvals/${approvalId}/restore`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(t("approval.restoreFailed"), "error");
        return;
      }
      notify(t("approval.restored"), "success");
      await loadApprovals(statusFilter);
    } finally {
      setBusy("");
    }
  }

  async function revokeGrant(grantId: string) {
    setBusy(grantId);
    try {
      const response = await fetch(`/api/approval-grants/${grantId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(t("approval.grantRevokeFailed"), "error");
        return;
      }
      notify(t("approval.grantRevoked"), "success");
      await loadGrants();
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="management-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.approvals")}`} title={t("page.approvals")} action={t("action.refresh")} onAction={() => statusFilter === "grants" ? void loadGrants() : void loadApprovals(statusFilter)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.approvals")} />
      <Tabs className="approvals-root" value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
        <TabsList className="settings-tabs" aria-label={t("page.approvals")}>
          <TabsTrigger className="settings-tab" value="pending">{t("approval.pending")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="all">{t("approval.all")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="archived">{t("approval.archivedTab")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="grants">{t("approval.grants")}</TabsTrigger>
        </TabsList>
        <TabsContent className="extension-list approval-list" value="pending">
          {statusFilter === "pending" && approvals.map((approval) => (
            <article className="provider-card" key={approval.id}>
              <div className="item-row">
                <div>
                  <strong>{approval.title}</strong>
                  <span>{approval.description}</span>
                </div>
                <span className={`pill ${approval.risk === "critical" || approval.risk === "high" ? "danger" : ""}`}>{approval.risk}</span>
              </div>
              <pre className="approval-details">{approval.details}</pre>
              {approval.related !== undefined && <pre className="approval-details">{JSON.stringify(approval.related, null, 2)}</pre>}
              <div className="item-row">
                <span className="subtle">{approval.status} · {formatShortDate(approval.createdAt)}</span>
                {approval.status === "pending" && (
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "deny")}>{t("approval.deny")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve")}>{t("approval.allowOnce")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", false, 24 * 60 * 60)}>{t("approval.allow24h")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", true)}>{t("approval.allowAlways")}</button>
                  </div>
                )}
                {approval.status !== "pending" && (
                  <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void archiveApprovalRecord(approval.id)}>{t("approval.archive")}</button>
                )}
              </div>
            </article>
          ))}
          {statusFilter === "pending" && approvalHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadApprovals(statusFilter, true)}>{t("session.loadMore")}</button>}
          {statusFilter === "pending" && !approvals.length && <div className="empty-state">{t("approval.empty")}</div>}
        </TabsContent>
        <TabsContent className="extension-list approval-list" value="all">
          {approvals.map((approval) => (
            <article className="provider-card" key={approval.id}>
              <div className="item-row">
                <div>
                  <strong>{approval.title}</strong>
                  <span>{approval.description}</span>
                </div>
                <span className={`pill ${approval.risk === "critical" || approval.risk === "high" ? "danger" : ""}`}>{approval.risk}</span>
              </div>
              <pre className="approval-details">{approval.details}</pre>
              {approval.related !== undefined && <pre className="approval-details">{JSON.stringify(approval.related, null, 2)}</pre>}
              <div className="item-row">
                <span className="subtle">{approval.status} · {formatShortDate(approval.createdAt)}</span>
                {approval.status === "pending" && (
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "deny")}>{t("approval.deny")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve")}>{t("approval.allowOnce")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", false, 24 * 60 * 60)}>{t("approval.allow24h")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", true)}>{t("approval.allowAlways")}</button>
                  </div>
                )}
                {approval.status !== "pending" && (
                  <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void archiveApprovalRecord(approval.id)}>{t("approval.archive")}</button>
                )}
              </div>
            </article>
          ))}
          {approvalHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadApprovals(statusFilter, true)}>{t("session.loadMore")}</button>}
          {!approvals.length && <div className="empty-state">{t("approval.empty")}</div>}
        </TabsContent>
        <TabsContent className="extension-list approval-list" value="archived">
          {approvals.map((approval) => (
            <article className="provider-card" key={approval.id}>
              <div className="item-row">
                <div>
                  <strong>{approval.title}</strong>
                  <span>{approval.description}</span>
                </div>
                <span className={`pill ${approval.risk === "critical" || approval.risk === "high" ? "danger" : ""}`}>{approval.risk}</span>
              </div>
              <pre className="approval-details">{approval.details}</pre>
              {approval.related !== undefined && <pre className="approval-details">{JSON.stringify(approval.related, null, 2)}</pre>}
              <div className="item-row">
                <span className="subtle">{approval.status} · {approval.archivedAt ? `${t("approval.archivedAt")} ${formatShortDate(approval.archivedAt)}` : formatShortDate(approval.createdAt)}</span>
                <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void restoreApprovalRecord(approval.id)}>{t("approval.restore")}</button>
              </div>
            </article>
          ))}
          {approvalHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadApprovals(statusFilter, true)}>{t("session.loadMore")}</button>}
          {!approvals.length && <div className="empty-state">{t("approval.archivedEmpty")}</div>}
        </TabsContent>
        <TabsContent className="extension-list approval-list" value="grants">
          {grants.map((grant) => (
            <article className="provider-card" key={grant.id}>
              <div className="item-row">
                <div>
                  <strong>{grant.title}</strong>
                  <span>{grant.actionType} · {formatShortDate(grant.createdAt)} · {grant.expiresAt ? `${t("approval.expiresAt")} ${formatShortDate(grant.expiresAt)}` : t("approval.neverExpires")}</span>
                </div>
                <button className="ghost-button danger-button" type="button" disabled={busy === grant.id} onClick={() => void revokeGrant(grant.id)}>{t("approval.revokeGrant")}</button>
              </div>
              <pre className="approval-details">{grant.details}</pre>
            </article>
          ))}
          {grantHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadGrants(true)}>{t("session.loadMore")}</button>}
          {!grants.length && <div className="empty-state">{t("approval.grantsEmpty")}</div>}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function SettingsPage({
  sessionToken,
  t,
  onOpenSession,
  onOpenMainNav,
  onSessionRefresh,
  onLogout,
  notify,
  onApprovalRequired,
}: {
  sessionToken: string;
  t: TFunction;
  onOpenSession: (sessionId: string) => void;
  onOpenMainNav?: () => void;
  onSessionRefresh: (token: string, auth: AuthState) => void;
  onLogout: () => void;
  notify: (message: string, tone?: ToastTone) => void;
  onApprovalRequired: (approval: ApprovalSummary) => void;
}) {
  const dialog = useAppDialog(t);
  const [currentAccessToken, setCurrentAccessToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [confirmAccessToken, setConfirmAccessToken] = useState("");
  const [otpSecret, setOtpSecret] = useState("");
  const [otpQr, setOtpQr] = useState("");
  const [otpAccessToken, setOtpAccessToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [tokenMessage, setTokenMessage] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const [otpCopyMessage, setOtpCopyMessage] = useState("");
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [storageScan, setStorageScan] = useState<StorageScanResponse | null>(null);
  const [storageSearch, setStorageSearch] = useState("");
  const [storageStatusFilter, setStorageStatusFilter] = useState("");
  const [storageSort, setStorageSort] = useState<"bytes" | "updated" | "type">("bytes");
  const [selectedStorageIds, setSelectedStorageIds] = useState<string[]>([]);
  const [backupPreview, setBackupPreview] = useState<SystemBackupPreviewResponse | null>(null);
  const [backupSettings, setBackupSettings] = useState<SystemBackupSettings | null>(null);
  const [backupIgnoreRules, setBackupIgnoreRules] = useState("");
  const [restorePreview, setRestorePreview] = useState<SystemBackupPreviewResponse | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cleanupArchivedApprovals, setCleanupArchivedApprovals] = useState(true);
  const [cleanupArchivedApprovalDays, setCleanupArchivedApprovalDays] = useState(30);
  const [cleanupApprovalAuditLog, setCleanupApprovalAuditLog] = useState(false);
  const [taskHealth, setTaskHealth] = useState<TaskHealthResponse | null>(null);
  const [settingsTab, setSettingsTab] = useState<"account" | "runtime" | "environment" | "network" | "notifications" | "maintenance" | "storage" | "backup">("account");
  const [busy, setBusy] = useState("");
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeSettings | null>(null);
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>("workspace-write");
  const [approvalPolicy, setApprovalPolicy] = useState<CodexApprovalPolicy>("never");
  const [bypassSandbox, setBypassSandbox] = useState(false);
  const [previewAccessSettings, setPreviewAccessSettings] = useState<PreviewAccessSettings | null>(null);
  const [previewAccessRequestTtlMinutes, setPreviewAccessRequestTtlMinutes] = useState("30");
  const [sessionCompactionSettings, setSessionCompactionSettings] = useState<SessionCompactionSettings | null>(null);
  const [sessionCompactionEnabled, setSessionCompactionEnabled] = useState(true);
  const [sessionCompactionForm, setSessionCompactionForm] = useState({
    autoCompactMessages: "80",
    autoCompactChars: "80000",
    minNewMessages: "20",
    minNewChars: "12000",
  });
  const [rateLimitSettings, setRateLimitSettings] = useState<RateLimitSettings | null>(null);
  const [environmentOverview, setEnvironmentOverview] = useState<EnvironmentOverview | null>(null);
  const [environmentRegistry, setEnvironmentRegistry] = useState<EnvironmentToolRegistryItem[]>([]);
  const [environmentToolQuery, setEnvironmentToolQuery] = useState("");
  const [environmentToolPickerOpen, setEnvironmentToolPickerOpen] = useState(false);
  const [environmentVersions, setEnvironmentVersions] = useState<EnvironmentToolVersionItem[]>([]);
  const [environmentVersionHistory, setEnvironmentVersionHistory] = useState<EnvironmentToolVersionItem[]>([]);
  const [environmentVersionPickerOpen, setEnvironmentVersionPickerOpen] = useState(false);
  const [environmentVersionError, setEnvironmentVersionError] = useState("");
  const [environmentShowVersionHistory, setEnvironmentShowVersionHistory] = useState(false);
  const [environmentProbe, setEnvironmentProbe] = useState<EnvironmentToolProbe | null>(null);
  const [environmentPackagePanel, setEnvironmentPackagePanel] = useState<EnvironmentPackageDetailResponse | null>(null);
  const [environmentPackageForm, setEnvironmentPackageForm] = useState({
    manager: "",
    packageName: "",
    versionSpec: "",
    notes: "",
  });
  const [environmentPackageProbe, setEnvironmentPackageProbe] = useState<{ installed: boolean; manager: string; packageName: string; version?: string | null; checked?: boolean } | null>(null);
  const [environmentInstallForm, setEnvironmentInstallForm] = useState({
    tool: "",
    version: "",
    scope: "global",
    autoRestore: true,
    notes: "",
  });
  const environmentReconcileItems = environmentOverview?.reconcile ?? [];
  const environmentProjectUsageItems = environmentOverview?.projectUsage ?? [];
  const [rateLimitEnabled, setRateLimitEnabled] = useState(true);
  const [rateLimitForm, setRateLimitForm] = useState({
    globalPerMinute: "300",
    authPerMinute: "20",
    previewAccessPerMinute: "10",
    expensivePerFiveMinutes: "30",
    providerProxyPerMinute: "60",
    providerProxyPerHour: "600",
    providerProxyMaxConcurrent: "5",
  });
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettingsResponse | null>(null);
  const [notificationView, setNotificationView] = useState<"senders" | "recipients" | "rules" | "logs">("senders");
  const [notificationRuleEnabledFilter, setNotificationRuleEnabledFilter] = useState("");
  const [notificationRuleCursor, setNotificationRuleCursor] = useState<string | null>(null);
  const [notificationRuleLoading, setNotificationRuleLoading] = useState(false);
  const [notificationEphemeralRuleCursor, setNotificationEphemeralRuleCursor] = useState<string | null>(null);
  const [notificationEphemeralRuleLoading, setNotificationEphemeralRuleLoading] = useState(false);
  const [notificationDeliveryEventFilter, setNotificationDeliveryEventFilter] = useState("");
  const [notificationDeliveryStatusFilter, setNotificationDeliveryStatusFilter] = useState("");
  const [notificationDeliverySeverityFilter, setNotificationDeliverySeverityFilter] = useState("");
  const [notificationDeliveryCursor, setNotificationDeliveryCursor] = useState<string | null>(null);
  const [notificationDeliveryLoading, setNotificationDeliveryLoading] = useState(false);
  const [notificationAccountForm, setNotificationAccountForm] = useState({
    name: "",
    channelId: "email",
    channelKind: "email" as NotificationAccountSummary["channelKind"],
    enabled: true,
    customConfig: {} as Record<string, string>,
    webhookUrl: "",
    webhookMethod: "POST",
    webhookHeaders: "",
    webhookBodyTemplate: "",
    barkServerUrl: "https://api.day.app",
    barkDeviceKey: "",
    barkGroup: "Codex Web",
    barkSound: "",
    barkIcon: "",
    barkUrl: "",
    emailHost: "",
    emailPort: "587",
    emailSecure: false,
    emailUsername: "",
    emailPassword: "",
    emailFromName: "Codex Web",
    emailFromEmail: "",
    emailCreateRecipient: true,
    telegramBotToken: "",
    telegramProxyUrl: "",
    telegramTestChatId: "",
    telegramInboundEnabled: false,
    telegramAllowedChatIds: "",
    telegramAllowedUserIds: "",
    telegramDefaultSessionId: "",
    testEmailTo: "",
    permissionAgentIds: "",
    permissionRoomIds: "",
    permissionProjectIds: "",
  });
  const [notificationEditingAccountId, setNotificationEditingAccountId] = useState("");
  const [notificationRuleForm, setNotificationRuleForm] = useState({
    name: "",
    enabled: true,
    eventTypes: ["task_completed", "task_failed", "needs_approval"] as NotificationEventType[],
    minSeverity: "info" as NotificationSeverity,
    recipientIds: [] as string[],
    senderAccountId: "",
    telegramSenderAccountId: "",
    emailTo: "",
    dedupeMinutes: "5",
  });
  const [notificationEditingRuleId, setNotificationEditingRuleId] = useState("");
  const [notificationRecipientForm, setNotificationRecipientForm] = useState({
    name: "",
    kind: "email" as NotificationRecipientSummary["kind"],
    enabled: true,
    senderAccountId: "",
    channelId: "webhook",
    email: "",
    webhookUrl: "",
    barkServerUrl: "https://api.day.app",
    barkDeviceKey: "",
    barkGroup: "Codex Web",
    telegramChatId: "",
    telegramSenderAccountId: "",
    customConfig: {} as Record<string, string>,
    permissionAgentIds: "",
    permissionRoomIds: "",
    permissionProjectIds: "",
  });
  const [notificationEditingRecipientId, setNotificationEditingRecipientId] = useState("");
  const [notificationChannelManagerOpen, setNotificationChannelManagerOpen] = useState(false);
  const [notificationEditingChannelId, setNotificationEditingChannelId] = useState("");
  const [notificationChannelForm, setNotificationChannelForm] = useState({
    name: "",
    description: "",
    adapter: "webhook",
    authType: "none",
    method: "POST",
    urlTemplate: "",
    headersTemplate: "",
    bodyTemplate: "{\n  \"title\": \"{{title}}\",\n  \"message\": \"{{message}}\"\n}",
    accountFields: "",
  });

  function showTokenNotice(value: string) {
    setTokenMessage(value);
    notify(value, value === t("settings.tokenUpdated") ? "success" : "error");
  }

  function showOtpNotice(value: string) {
    setOtpMessage(value);
    notify(value, value === t("settings.otpReset") || value === t("settings.otpGenerated") || value === t("action.copied") ? "success" : "error");
  }

  useEffect(() => {
    const headers = { authorization: `Bearer ${sessionToken}` };
    fetch("/api/settings/codex-runtime", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: CodexRuntimeSettings | null) => {
        if (!settings) return;
        setCodexRuntime(settings);
        setSandboxMode(settings.sandboxMode);
        setApprovalPolicy(settings.approvalPolicy);
        setBypassSandbox(settings.bypassSandbox);
      })
      .catch(() => undefined);
    fetch("/api/settings/preview-access", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: PreviewAccessSettings | null) => {
        if (!settings) return;
        setPreviewAccessSettings(settings);
        setPreviewAccessRequestTtlMinutes(String(settings.requestTtlMinutes));
      })
      .catch(() => undefined);
    fetch("/api/settings/session-compaction", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: SessionCompactionSettings | null) => {
        if (!settings) return;
        setSessionCompactionSettings(settings);
        setSessionCompactionEnabled(settings.enabled);
        setSessionCompactionForm({
          autoCompactMessages: String(settings.autoCompactMessages),
          autoCompactChars: String(settings.autoCompactChars),
          minNewMessages: String(settings.minNewMessages),
          minNewChars: String(settings.minNewChars),
        });
      })
      .catch(() => undefined);
    fetch("/api/settings/rate-limit", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: RateLimitSettings | null) => {
        if (!settings) return;
        setRateLimitSettings(settings);
        setRateLimitEnabled(settings.enabled);
        setRateLimitForm({
          globalPerMinute: String(settings.globalPerMinute),
          authPerMinute: String(settings.authPerMinute),
          previewAccessPerMinute: String(settings.previewAccessPerMinute),
          expensivePerFiveMinutes: String(settings.expensivePerFiveMinutes),
          providerProxyPerMinute: String(settings.providerProxyPerMinute),
          providerProxyPerHour: String(settings.providerProxyPerHour),
          providerProxyMaxConcurrent: String(settings.providerProxyMaxConcurrent),
        });
      })
      .catch(() => undefined);
    fetch("/api/settings/backup", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: SystemBackupSettings | null) => {
        if (!settings) return;
        setBackupSettings(settings);
        setBackupIgnoreRules(settings.ignorePatterns.join("\n"));
      })
      .catch(() => undefined);
    fetch("/api/settings/environment", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((overview: EnvironmentOverview | null) => {
        if (!overview) return;
        setEnvironmentOverview(overview);
      })
      .catch(() => undefined);
    fetch("/api/settings/environment/tool-registry", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { items: EnvironmentToolRegistryItem[] } | null) => {
        if (!result) return;
        setEnvironmentRegistry(result.items);
      })
      .catch(() => undefined);
    void loadNotifications();
  }, [sessionToken]);

  useEffect(() => {
    if (!notificationSettings) return;
    void loadNotifications();
  }, [notificationRuleEnabledFilter, notificationDeliveryEventFilter, notificationDeliveryStatusFilter, notificationDeliverySeverityFilter]);

  async function loadNotifications() {
    const headers = { authorization: `Bearer ${sessionToken}` };
    const response = await fetch("/api/notifications", { headers });
    if (!response.ok) return;
    const result = await response.json() as NotificationSettingsResponse;
    const ruleParams = new URLSearchParams({ limit: "20" });
    if (notificationRuleEnabledFilter) ruleParams.set("enabled", notificationRuleEnabledFilter);
    const deliveryParams = new URLSearchParams({ limit: "20" });
    if (notificationDeliveryEventFilter) deliveryParams.set("eventType", notificationDeliveryEventFilter);
    if (notificationDeliveryStatusFilter) deliveryParams.set("status", notificationDeliveryStatusFilter);
    if (notificationDeliverySeverityFilter) deliveryParams.set("severity", notificationDeliverySeverityFilter);
    const [rulesResponse, ephemeralRulesResponse, deliveriesResponse] = await Promise.all([
      fetch(`/api/notifications/rules?${ruleParams}`, { headers }),
      fetch("/api/notifications/ephemeral-rules?limit=20", { headers }),
      fetch(`/api/notifications/deliveries?${deliveryParams}`, { headers }),
    ]);
    const rulesPage = rulesResponse.ok ? await rulesResponse.json() as PageResponse<NotificationRuleSummary> : null;
    const ephemeralRulesPage = ephemeralRulesResponse.ok ? await ephemeralRulesResponse.json() as PageResponse<NotificationEphemeralRuleSummary> : null;
    const deliveriesPage = deliveriesResponse.ok ? await deliveriesResponse.json() as PageResponse<NotificationDeliverySummary> : null;
    setNotificationSettings({
      ...result,
      rules: rulesPage?.items ?? result.rules,
      ephemeralRules: ephemeralRulesPage?.items ?? result.ephemeralRules,
      recentDeliveries: deliveriesPage?.items ?? result.recentDeliveries,
    });
    setNotificationRuleCursor(rulesPage?.nextCursor ?? null);
    setNotificationEphemeralRuleCursor(ephemeralRulesPage?.nextCursor ?? null);
    setNotificationDeliveryCursor(deliveriesPage?.nextCursor ?? null);
  }

  async function loadMoreNotificationRules() {
    if (!notificationRuleCursor || notificationRuleLoading) return;
    setNotificationRuleLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20", cursor: notificationRuleCursor });
      if (notificationRuleEnabledFilter) params.set("enabled", notificationRuleEnabledFilter);
      const response = await fetch(`/api/notifications/rules?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const page = await response.json() as PageResponse<NotificationRuleSummary>;
      setNotificationSettings((current) => current ? { ...current, rules: [...current.rules, ...page.items] } : current);
      setNotificationRuleCursor(page.nextCursor);
    } finally {
      setNotificationRuleLoading(false);
    }
  }

  async function loadMoreNotificationEphemeralRules() {
    if (!notificationEphemeralRuleCursor || notificationEphemeralRuleLoading) return;
    setNotificationEphemeralRuleLoading(true);
    try {
      const response = await fetch(`/api/notifications/ephemeral-rules?limit=20&cursor=${encodeURIComponent(notificationEphemeralRuleCursor)}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const page = await response.json() as PageResponse<NotificationEphemeralRuleSummary>;
      setNotificationSettings((current) => current ? { ...current, ephemeralRules: [...current.ephemeralRules, ...page.items] } : current);
      setNotificationEphemeralRuleCursor(page.nextCursor);
    } finally {
      setNotificationEphemeralRuleLoading(false);
    }
  }

  async function loadMoreNotificationDeliveries() {
    if (!notificationDeliveryCursor || notificationDeliveryLoading) return;
    setNotificationDeliveryLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20", cursor: notificationDeliveryCursor });
      if (notificationDeliveryEventFilter) params.set("eventType", notificationDeliveryEventFilter);
      if (notificationDeliveryStatusFilter) params.set("status", notificationDeliveryStatusFilter);
      if (notificationDeliverySeverityFilter) params.set("severity", notificationDeliverySeverityFilter);
      const response = await fetch(`/api/notifications/deliveries?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const page = await response.json() as PageResponse<NotificationDeliverySummary>;
      setNotificationSettings((current) => current ? { ...current, recentDeliveries: [...current.recentDeliveries, ...page.items] } : current);
      setNotificationDeliveryCursor(page.nextCursor);
    } finally {
      setNotificationDeliveryLoading(false);
    }
  }

  function selectedNotificationChannel() {
    return notificationSettings?.channels.find((channel) => channel.id === notificationAccountForm.channelId)
      ?? notificationSettings?.channels.find((channel) => channel.kind === notificationAccountForm.channelKind)
      ?? null;
  }

  function emailNotificationSenders() {
    return (notificationSettings?.accounts ?? []).filter((account) => account.enabled && account.channelKind === "email");
  }

  function telegramNotificationSenders() {
    return (notificationSettings?.accounts ?? []).filter((account) => account.enabled && account.channelKind === "telegram");
  }

  function csvIds(value: string) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  function configListToCsv(value: unknown) {
    if (Array.isArray(value)) return value.map(String).join(", ");
    return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean).join(", ");
  }

  function notificationPermissionsFromForm(form: { permissionAgentIds: string; permissionRoomIds: string; permissionProjectIds: string }) {
    return {
      allowedAgentIds: csvIds(form.permissionAgentIds),
      allowedRoomIds: csvIds(form.permissionRoomIds),
      allowedProjectIds: csvIds(form.permissionProjectIds),
    };
  }

  function notificationPermissionsToForm(permissions?: { allowedAgentIds?: string[]; allowedRoomIds?: string[]; allowedProjectIds?: string[] }) {
    return {
      permissionAgentIds: (permissions?.allowedAgentIds ?? []).join(", "),
      permissionRoomIds: (permissions?.allowedRoomIds ?? []).join(", "),
      permissionProjectIds: (permissions?.allowedProjectIds ?? []).join(", "),
    };
  }

  function notificationPermissionSummary(permissions?: { allowedAgentIds?: string[]; allowedRoomIds?: string[]; allowedProjectIds?: string[] }) {
    const count = (permissions?.allowedAgentIds?.length ?? 0) + (permissions?.allowedRoomIds?.length ?? 0) + (permissions?.allowedProjectIds?.length ?? 0);
    return count ? t("settings.notificationPermissionRestricted") : t("settings.notificationPermissionUnrestricted");
  }

  function notificationAccountConfig() {
    const selectedChannel = selectedNotificationChannel();
    if (selectedChannel && selectedChannel.builtin === false) return notificationAccountForm.customConfig;
    if (notificationAccountForm.channelKind === "email") {
      return {
        host: notificationAccountForm.emailHost,
        port: Number(notificationAccountForm.emailPort) || 587,
        secure: notificationAccountForm.emailSecure,
        username: notificationAccountForm.emailUsername,
        password: notificationAccountForm.emailPassword,
        fromName: notificationAccountForm.emailFromName,
        fromEmail: notificationAccountForm.emailFromEmail,
        testEmailTo: csvIds(notificationAccountForm.testEmailTo),
      };
    }
    if (notificationAccountForm.channelKind === "telegram") {
      return {
        botToken: notificationAccountForm.telegramBotToken,
        proxyUrl: notificationAccountForm.telegramProxyUrl,
        inboundEnabled: notificationAccountForm.telegramInboundEnabled,
        allowedChatIds: csvIds(notificationAccountForm.telegramAllowedChatIds),
        allowedUserIds: csvIds(notificationAccountForm.telegramAllowedUserIds),
        defaultSessionId: notificationAccountForm.telegramDefaultSessionId,
        testChatId: notificationAccountForm.telegramTestChatId,
      };
    }
    if (notificationAccountForm.channelKind === "webhook") {
      const headers = Object.fromEntries(notificationAccountForm.webhookHeaders.split("\n").map((line) => {
        const index = line.indexOf(":");
        return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : ["", ""];
      }).filter(([key]) => key));
      return {
        url: notificationAccountForm.webhookUrl,
        method: notificationAccountForm.webhookMethod,
        headers,
        bodyTemplate: notificationAccountForm.webhookBodyTemplate,
      };
    }
    return {
      serverUrl: notificationAccountForm.barkServerUrl,
      deviceKey: notificationAccountForm.barkDeviceKey,
      group: notificationAccountForm.barkGroup,
      sound: notificationAccountForm.barkSound,
      icon: notificationAccountForm.barkIcon,
      url: notificationAccountForm.barkUrl,
    };
  }

  function resetNotificationAccountForm() {
    setNotificationEditingAccountId("");
    setNotificationAccountForm({
      name: "",
      channelId: "email",
      channelKind: "email",
      enabled: true,
      customConfig: {},
      webhookUrl: "",
      webhookMethod: "POST",
      webhookHeaders: "",
      webhookBodyTemplate: "",
      barkServerUrl: "https://api.day.app",
      barkDeviceKey: "",
      barkGroup: "Codex Web",
      barkSound: "",
      barkIcon: "",
      barkUrl: "",
      emailHost: "",
      emailPort: "587",
      emailSecure: false,
      emailUsername: "",
      emailPassword: "",
      emailFromName: "Codex Web",
      emailFromEmail: "",
      emailCreateRecipient: true,
      telegramBotToken: "",
      telegramProxyUrl: "",
      telegramTestChatId: "",
      telegramInboundEnabled: false,
      telegramAllowedChatIds: "",
      telegramAllowedUserIds: "",
      telegramDefaultSessionId: "",
      testEmailTo: "",
      permissionAgentIds: "",
      permissionRoomIds: "",
      permissionProjectIds: "",
    });
  }

  function editNotificationAccount(account: NotificationAccountSummary) {
    const config = account.config as Record<string, unknown>;
    setNotificationEditingAccountId(account.id);
    setNotificationAccountForm({
      name: account.name,
      channelId: account.channelId ?? account.channelKind,
      channelKind: account.channelKind,
      enabled: account.enabled,
      customConfig: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value ?? "")])),
      webhookUrl: String(config.url ?? ""),
      webhookMethod: String(config.method ?? "POST"),
      webhookHeaders: config.headers && typeof config.headers === "object"
        ? Object.entries(config.headers as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value ?? "")}`).join("\n")
        : "",
      webhookBodyTemplate: String(config.bodyTemplate ?? ""),
      barkServerUrl: String(config.serverUrl ?? "https://api.day.app"),
      barkDeviceKey: String(config.deviceKey ?? ""),
      barkGroup: String(config.group ?? "Codex Web"),
      barkSound: String(config.sound ?? ""),
      barkIcon: String(config.icon ?? ""),
      barkUrl: String(config.url ?? ""),
      emailHost: String(config.host ?? ""),
      emailPort: String(config.port ?? "587"),
      emailSecure: config.secure === true,
      emailUsername: String(config.username ?? ""),
      emailPassword: String(config.password ?? ""),
      emailFromName: String(config.fromName ?? "Codex Web"),
      emailFromEmail: String(config.fromEmail ?? ""),
      emailCreateRecipient: false,
      testEmailTo: configListToCsv(config.testEmailTo),
      telegramBotToken: String(config.botToken ?? ""),
      telegramProxyUrl: String(config.proxyUrl ?? ""),
      telegramTestChatId: String(config.testChatId ?? ""),
      telegramInboundEnabled: config.inboundEnabled === true,
      telegramAllowedChatIds: configListToCsv(config.allowedChatIds),
      telegramAllowedUserIds: configListToCsv(config.allowedUserIds),
      telegramDefaultSessionId: String(config.defaultSessionId ?? ""),
      ...notificationPermissionsToForm(account.permissions),
    });
  }

  function toggleNotificationEvent(type: NotificationEventType) {
    setNotificationRuleForm((current) => ({
      ...current,
      eventTypes: current.eventTypes.includes(type)
        ? current.eventTypes.filter((item) => item !== type)
        : [...current.eventTypes, type],
    }));
  }

  function toggleNotificationTarget(recipientId: string) {
    setNotificationRuleForm((current) => ({
      ...current,
      recipientIds: current.recipientIds.includes(recipientId)
        ? current.recipientIds.filter((item) => item !== recipientId)
        : [...current.recipientIds, recipientId],
    }));
  }

  function resetNotificationRuleForm() {
    setNotificationEditingRuleId("");
    setNotificationRuleForm({
      name: "",
      enabled: true,
      eventTypes: ["task_completed", "task_failed", "needs_approval"],
      minSeverity: "info",
      recipientIds: [],
      senderAccountId: "",
      telegramSenderAccountId: "",
      emailTo: "",
      dedupeMinutes: "5",
    });
  }

  function editNotificationRule(rule: NotificationRuleSummary) {
    const targetRecipientIds = rule.targets.map((target) => target.recipientId).filter(Boolean) as string[];
    const emailSenderAccountId = rule.targets.find((target) => {
      const recipient = notificationSettings?.recipients.find((item) => item.id === target.recipientId);
      return recipient?.kind === "email" && target.senderAccountId;
    })?.senderAccountId ?? "";
    const telegramSenderAccountId = rule.targets.find((target) => {
      const recipient = notificationSettings?.recipients.find((item) => item.id === target.recipientId);
      return recipient?.kind === "telegram" && target.senderAccountId;
    })?.senderAccountId ?? "";
    setNotificationEditingRuleId(rule.id);
    setNotificationRuleForm({
      name: rule.name,
      enabled: rule.enabled,
      eventTypes: rule.eventTypes,
      minSeverity: rule.minSeverity,
      recipientIds: targetRecipientIds,
      senderAccountId: emailSenderAccountId,
      telegramSenderAccountId,
      emailTo: "",
      dedupeMinutes: String(rule.dedupeMinutes),
    });
  }

  function resetNotificationChannelForm() {
    setNotificationEditingChannelId("");
    setNotificationChannelForm({
      name: "",
      description: "",
      adapter: "webhook",
      authType: "none",
      method: "POST",
      urlTemplate: "",
      headersTemplate: "",
      bodyTemplate: "{\n  \"title\": \"{{title}}\",\n  \"message\": \"{{message}}\"\n}",
      accountFields: "",
    });
  }

  function editNotificationChannel(channel: NotificationChannelDefinition) {
    if (channel.kind !== "webhook") return;
    setNotificationEditingChannelId(channel.id);
    setNotificationChannelForm({
      name: channel.name,
      description: channel.description,
      adapter: channel.adapter ?? "webhook",
      authType: channel.authType ?? "none",
      method: channel.method ?? "POST",
      urlTemplate: channel.urlTemplate ?? "",
      headersTemplate: channel.headersTemplate ?? "",
      bodyTemplate: channel.bodyTemplate ?? "",
      accountFields: (channel.accountFields ?? []).join(","),
    });
  }

  async function createNotificationChannel(event: React.FormEvent) {
    event.preventDefault();
    const editingChannel = notificationSettings?.channels.find((channel) => channel.id === notificationEditingChannelId);
    if (editingChannel?.builtin) return;
    setBusy("notification-channel");
    try {
      const response = await fetch(notificationEditingChannelId ? `/api/notifications/channels/${notificationEditingChannelId}` : "/api/notifications/channels", {
        method: notificationEditingChannelId ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: notificationChannelForm.name,
          description: notificationChannelForm.description,
          adapter: notificationChannelForm.adapter,
          authType: notificationChannelForm.authType,
          method: notificationChannelForm.method,
          urlTemplate: notificationChannelForm.urlTemplate,
          headersTemplate: notificationChannelForm.headersTemplate,
          bodyTemplate: notificationChannelForm.bodyTemplate,
          accountFields: notificationChannelForm.accountFields.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error("notification_channel_failed");
      resetNotificationChannelForm();
      await loadNotifications();
      notify(t("settings.notificationChannelSaved"), "success");
    } catch {
      notify(t("settings.notificationChannelSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationChannel(channel: NotificationChannelDefinition) {
    if (channel.builtin) return;
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteChannelConfirm"),
      message: channel.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-channel-delete:${channel.id}`);
    try {
      const response = await fetch(`/api/notifications/channels/${channel.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      if (!response.ok) notify(t("settings.notificationChannelDeleteFailed"), "error");
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  function notificationRecipientConfig() {
    if (notificationRecipientForm.kind === "email") return { email: notificationRecipientForm.email };
    if (notificationRecipientForm.kind === "telegram") return { chatId: notificationRecipientForm.telegramChatId };
    const channel = notificationSettings?.channels.find((item) => item.id === notificationRecipientForm.channelId);
    if (channel?.id && channel.id !== "webhook") return notificationRecipientForm.customConfig;
    return { url: notificationRecipientForm.webhookUrl, method: "POST", headers: {} };
  }

  function resetNotificationRecipientForm() {
    setNotificationEditingRecipientId("");
    setNotificationRecipientForm({
      name: "",
      kind: "email",
      enabled: true,
      senderAccountId: "",
      channelId: "webhook",
      email: "",
      webhookUrl: "",
      barkServerUrl: "https://api.day.app",
      barkDeviceKey: "",
      barkGroup: "Codex Web",
      telegramChatId: "",
      telegramSenderAccountId: "",
      customConfig: {},
      permissionAgentIds: "",
      permissionRoomIds: "",
      permissionProjectIds: "",
    });
  }

  function editNotificationRecipient(recipient: NotificationRecipientSummary) {
    const config = recipient.config as Record<string, unknown>;
    setNotificationEditingRecipientId(recipient.id);
    setNotificationRecipientForm({
      name: recipient.name,
      kind: recipient.kind,
      enabled: recipient.enabled,
      senderAccountId: recipient.senderAccountId ?? "",
      channelId: recipient.channelId ?? "webhook",
      email: String(config.email ?? ""),
      webhookUrl: String(config.url ?? ""),
      barkServerUrl: String(config.serverUrl ?? "https://api.day.app"),
      barkDeviceKey: String(config.deviceKey ?? ""),
      barkGroup: String(config.group ?? "Codex Web"),
      telegramChatId: String(config.chatId ?? ""),
      telegramSenderAccountId: recipient.senderAccountId ?? "",
      customConfig: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value ?? "")])),
      ...notificationPermissionsToForm(recipient.permissions),
    });
  }

  async function createNotificationRecipient(event: React.FormEvent) {
    event.preventDefault();
    setBusy("notification-recipient");
    try {
      const response = await fetch(notificationEditingRecipientId ? `/api/notifications/recipients/${notificationEditingRecipientId}` : "/api/notifications/recipients", {
        method: notificationEditingRecipientId ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: notificationRecipientForm.name,
          kind: notificationRecipientForm.kind,
          enabled: notificationRecipientForm.enabled,
          senderAccountId: notificationRecipientForm.kind === "email"
            ? notificationRecipientForm.senderAccountId || (emailNotificationSenders().length === 1 ? emailNotificationSenders()[0].id : null)
            : notificationRecipientForm.kind === "telegram"
              ? notificationRecipientForm.telegramSenderAccountId || (telegramNotificationSenders().length === 1 ? telegramNotificationSenders()[0].id : null)
              : null,
          channelId: notificationRecipientForm.kind === "webhook" ? notificationRecipientForm.channelId : null,
          config: notificationRecipientConfig(),
          permissions: notificationPermissionsFromForm(notificationRecipientForm),
        }),
      });
      if (!response.ok) throw new Error("notification_recipient_failed");
      resetNotificationRecipientForm();
      await loadNotifications();
      notify(t("settings.notificationRecipientSaved"), "success");
    } catch {
      notify(t("settings.notificationRecipientSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationRecipient(recipient: NotificationRecipientSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteRecipientConfirm"),
      message: recipient.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-recipient-delete:${recipient.id}`);
    try {
      await fetch(`/api/notifications/recipients/${recipient.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function testNotificationRecipient(recipient: NotificationRecipientSummary) {
    setBusy(`notification-recipient-test:${recipient.id}`);
    try {
      const response = await fetch(`/api/notifications/recipients/${recipient.id}/test`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      await loadNotifications();
      notify(response.ok ? t("settings.notificationTestSent") : t("settings.notificationTestFailed"), response.ok ? "success" : "error");
    } finally {
      setBusy("");
    }
  }

  async function createNotificationAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy("notification-account");
    try {
      const response = await fetch(notificationEditingAccountId ? `/api/notifications/accounts/${notificationEditingAccountId}` : "/api/notifications/accounts", {
        method: notificationEditingAccountId ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: notificationAccountForm.name,
          channelId: notificationAccountForm.channelId,
          channelKind: notificationAccountForm.channelKind,
          enabled: notificationAccountForm.enabled,
          config: notificationAccountConfig(),
          permissions: notificationPermissionsFromForm(notificationAccountForm),
        }),
      });
      if (!response.ok) throw new Error("notification_account_failed");
      const account = await response.json() as NotificationAccountSummary;
      if (!notificationEditingAccountId && notificationAccountForm.channelKind === "email" && notificationAccountForm.emailCreateRecipient && notificationAccountForm.emailFromEmail.trim()) {
        await fetch("/api/notifications/recipients", {
          method: "POST",
          headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            name: notificationAccountForm.name || notificationAccountForm.emailFromEmail,
            kind: "email",
            enabled: true,
            senderAccountId: account.id,
            config: { email: notificationAccountForm.emailFromEmail.trim() },
          }),
        });
      }
      resetNotificationAccountForm();
      await loadNotifications();
      notify(t("settings.notificationAccountSaved"), "success");
    } catch {
      notify(t("settings.notificationAccountSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function testNotificationAccount(account: NotificationAccountSummary) {
    setBusy(`notification-test:${account.id}`);
    try {
      const emailTo = notificationAccountForm.testEmailTo.split(",").map((item) => item.trim()).filter(Boolean);
      const response = await fetch(`/api/notifications/accounts/${account.id}/test`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ emailTo, chatId: notificationAccountForm.telegramTestChatId.trim() || undefined }),
      });
      await loadNotifications();
      notify(response.ok ? t("settings.notificationTestSent") : t("settings.notificationTestFailed"), response.ok ? "success" : "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationAccount(account: NotificationAccountSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteAccountConfirm"),
      message: account.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-account-delete:${account.id}`);
    try {
      await fetch(`/api/notifications/accounts/${account.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function createNotificationRule(event: React.FormEvent) {
    event.preventDefault();
    const targets: NotificationRuleTarget[] = notificationRuleForm.recipientIds.map((recipientId) => {
      const recipient = notificationSettings?.recipients.find((item) => item.id === recipientId);
      return {
        recipientId,
        senderAccountId: recipient?.kind === "telegram" ? notificationRuleForm.telegramSenderAccountId || undefined : notificationRuleForm.senderAccountId || undefined,
      };
    });
    setBusy("notification-rule");
    try {
      const response = await fetch(notificationEditingRuleId ? `/api/notifications/rules/${notificationEditingRuleId}` : "/api/notifications/rules", {
        method: notificationEditingRuleId ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: notificationRuleForm.name,
          enabled: notificationRuleForm.enabled,
          eventTypes: notificationRuleForm.eventTypes,
          minSeverity: notificationRuleForm.minSeverity,
          targets,
          dedupeMinutes: Number(notificationRuleForm.dedupeMinutes) || 0,
        }),
      });
      if (!response.ok) throw new Error("notification_rule_failed");
      resetNotificationRuleForm();
      await loadNotifications();
      notify(t("settings.notificationRuleSaved"), "success");
    } catch {
      notify(t("settings.notificationRuleSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function toggleNotificationRule(rule: NotificationRuleSummary) {
    setBusy(`notification-rule:${rule.id}`);
    try {
      await fetch(`/api/notifications/rules/${rule.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationRule(rule: NotificationRuleSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteRuleConfirm"),
      message: rule.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-rule-delete:${rule.id}`);
    try {
      await fetch(`/api/notifications/rules/${rule.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      if (notificationEditingRuleId === rule.id) resetNotificationRuleForm();
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationEphemeralRule(rule: NotificationEphemeralRuleSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteEphemeralRuleConfirm"),
      message: `${rule.scopeType} · ${rule.eventTypes.join(", ")}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-ephemeral-rule-delete:${rule.id}`);
    try {
      await fetch(`/api/notifications/ephemeral-rules/${rule.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function clearNotificationRules() {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationClearRulesConfirm"),
      message: t("settings.notificationClearRulesMessage"),
      confirmLabel: t("settings.notificationClearRules"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("notification-rules-clear");
    try {
      await fetch("/api/notifications/rules", { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationDelivery(delivery: NotificationDeliverySummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteDeliveryConfirm"),
      message: delivery.title,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-delivery-delete:${delivery.id}`);
    try {
      await fetch(`/api/notifications/deliveries/${delivery.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function retryNotificationDelivery(delivery: NotificationDeliverySummary) {
    setBusy(`notification-delivery-retry:${delivery.id}`);
    try {
      const response = await fetch(`/api/notifications/deliveries/${delivery.id}/retry`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      notify(response.ok ? t("settings.notificationRetryStarted") : t("settings.notificationRetryFailed"), response.ok ? "success" : "error");
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function clearNotificationDeliveries() {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationClearDeliveriesConfirm"),
      message: t("settings.notificationClearDeliveriesMessage"),
      confirmLabel: t("settings.notificationClearDeliveries"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("notification-deliveries-clear");
    try {
      await fetch("/api/notifications/deliveries", { method: "DELETE", headers: { authorization: `Bearer ${sessionToken}` } });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  function notificationDeliveryMetadata(delivery: NotificationDeliverySummary) {
    const metadata = delivery.metadata ?? {};
    const account = metadata.account && typeof metadata.account === "object" ? metadata.account as Record<string, unknown> : {};
    const recipient = metadata.recipient && typeof metadata.recipient === "object" ? metadata.recipient as Record<string, unknown> : {};
    const target = metadata.target && typeof metadata.target === "object" ? metadata.target as Record<string, unknown> : {};
    return {
      targetName: recipient.name ? String(recipient.name) : account.name ? String(account.name) : delivery.accountId ?? "-",
      targetKind: recipient.kind ? String(recipient.kind) : account.kind ? String(account.kind) : "-",
      accountName: account.name ? String(account.name) : delivery.accountId ?? "-",
      responseStatus: delivery.responseStatus ?? "-",
      attempts: delivery.attempts,
      sentAt: delivery.sentAt ? formatShortDate(delivery.sentAt) : "-",
      emailToCount: Number(target.emailToCount ?? 0),
      chatConfigured: Boolean(target.chatId),
    };
  }

  async function updateAccessToken(event: React.FormEvent) {
    event.preventDefault();
    setTokenMessage("");
    if (accessToken !== confirmAccessToken) {
      showTokenNotice(t("settings.tokenMismatch"));
      return;
    }
    setBusy("token");
    try {
      const body: UpdateAccessTokenRequest = { currentAccessToken, accessToken };
      const response = await fetch("/api/auth/access-token", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as (LoginResponse & { error?: string }) | null;
      if (!response.ok) {
        if (result?.error === "unauthorized") showTokenNotice(t("settings.loginExpired"));
        else if (result?.error === "invalid_current_access_token") showTokenNotice(t("settings.currentTokenInvalid"));
        else if (result?.error === "access_token_required") showTokenNotice(t("settings.tokenRequired"));
        else showTokenNotice(t("settings.tokenUpdateFailed"));
        return;
      }
      if (result?.sessionToken) {
        onSessionRefresh(result.sessionToken, result.auth);
        setCurrentAccessToken("");
        setAccessToken("");
        setConfirmAccessToken("");
        showTokenNotice(t("settings.tokenUpdated"));
      } else {
        showTokenNotice(t("settings.tokenUpdateFailed"));
      }
    } catch {
      showTokenNotice(t("settings.tokenUpdateFailed"));
    } finally {
      setBusy("");
    }
  }

  async function resetOtp() {
    setOtpMessage("");
    setBusy("otp");
    const response = await fetch("/api/auth/otp/reset", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    setBusy("");
    if (!response.ok) {
      showOtpNotice(t("settings.otpResetFailed"));
      return;
    }
    const result = (await response.json()) as ResetOtpResponse;
    setOtpSecret(result.otpSecret);
    setOtpQr(await QRCode.toDataURL(result.otpauthUrl, {
      margin: 1,
      width: 192,
      color: { dark: "#191d1b", light: "#ffffff" },
    }));
    setOtpAccessToken("");
    setOtpCode("");
    setOtpCopyMessage("");
    setOtpMessage(t("settings.otpGenerated"));
  }

  async function confirmOtpReset(event: React.FormEvent) {
    event.preventDefault();
    if (!otpSecret || !otpAccessToken.trim() || !otpCode.trim()) return;
    setOtpMessage("");
    setBusy("otp-confirm");
    const body: ConfirmOtpResetRequest = { currentAccessToken: otpAccessToken, otp: otpCode.trim() };
    const response = await fetch("/api/auth/otp/reset/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy("");
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      showOtpNotice(result?.error === "invalid_current_access_token" ? t("settings.currentTokenInvalid") : t("settings.otpVerifyFailed"));
      return;
    }
    const result = (await response.json()) as LoginResponse;
    if (result.sessionToken) {
      showOtpNotice(t("settings.otpReset"));
      onSessionRefresh(result.sessionToken, result.auth);
      setOtpAccessToken("");
      setOtpCode("");
    }
  }

  async function copyOtpSecret() {
    if (!otpSecret) return;
    const copied = await copyText(otpSecret);
    setOtpCopyMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    setOtpMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
    window.setTimeout(() => setOtpCopyMessage(""), 4000);
  }

  async function cleanupMaintenance() {
    if (!window.confirm(cleanupApprovalAuditLog ? t("settings.cleanupAuditConfirm") : t("settings.cleanupConfirm"))) return;
    setCleanupMessage("");
    setBusy("cleanup");
    try {
      const response = await fetch("/api/settings/maintenance/cleanup", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          deleteArchivedApprovals: cleanupArchivedApprovals,
          archivedApprovalRetentionDays: cleanupArchivedApprovalDays,
          deleteApprovalAuditLog: cleanupApprovalAuditLog,
        }),
      });
      const result = await response.json().catch(() => null) as MaintenanceCleanupResponse | { error?: string } | null;
      if (!response.ok || !result || !("deleted" in result)) {
        setCleanupMessage(t("settings.cleanupFailed"));
        notify(t("settings.cleanupFailed"), "error");
        return;
      }
      const totalDeleted = Object.values(result.deleted).reduce((sum, value) => sum + value, 0);
      const totalUpdated = Object.values(result.updated).reduce((sum, value) => sum + value, 0);
      const message = `${t("settings.cleanupDone")} ${t("settings.cleanupDeleted")}: ${totalDeleted}; ${t("settings.cleanupUpdated")}: ${totalUpdated}`;
      setCleanupMessage(message);
      notify(message, "success");
    } catch {
      setCleanupMessage(t("settings.cleanupFailed"));
      notify(t("settings.cleanupFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function loadTaskHealth() {
    setBusy("task-health");
    try {
      const response = await fetch("/api/settings/task-health", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("task_health_failed");
      const result = (await response.json()) as TaskHealthResponse;
      setTaskHealth(result);
      notify(result.ok ? t("settings.taskHealthOk") : t("settings.taskHealthIssues"), result.ok ? "success" : "info");
    } catch {
      notify(t("settings.taskHealthFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function repairTaskHealth() {
    const confirmed = await dialog.confirm({
      title: t("settings.repairTaskHealth"),
      message: t("settings.repairTaskHealthConfirm"),
      confirmLabel: t("settings.repairTaskHealth"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("task-health-repair");
    try {
      const response = await fetch("/api/settings/task-health/repair", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("task_health_repair_failed");
      const result = (await response.json()) as TaskHealthRepairResponse;
      setTaskHealth(result.health);
      notify(t("settings.taskHealthRepaired").replace("{count}", String(result.repaired.length)), "success");
    } catch {
      notify(t("settings.taskHealthRepairFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function resetApprovals() {
    if (!window.confirm(t("settings.resetApprovalsConfirm"))) return;
    setCleanupMessage("");
    setBusy("approval-reset");
    try {
      const response = await fetch("/api/settings/approvals/reset", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; deletedGrants?: number } | null;
      if (!response.ok || !result?.ok) {
        setCleanupMessage(t("settings.resetApprovalsFailed"));
        notify(t("settings.resetApprovalsFailed"), "error");
        return;
      }
      const message = t("settings.resetApprovalsDone").replace("{count}", String(result.deletedGrants ?? 0));
      setCleanupMessage(message);
      notify(message, "success");
    } catch {
      setCleanupMessage(t("settings.resetApprovalsFailed"));
      notify(t("settings.resetApprovalsFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function scanStorage() {
    setBusy("storage-scan");
    try {
      const response = await fetch("/api/settings/storage", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("storage_scan_failed");
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds([]);
    } catch {
      notify(t("common.loadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteStorageItem(item: StorageItemSummary) {
    const force = item.status === "active";
    if (!window.confirm(force ? t("settings.storageForceDeleteConfirm") : t("settings.storageDeleteConfirm"))) return;
    setBusy(`storage-delete:${item.id}`);
    try {
      const response = await fetch("/api/settings/storage/delete", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ type: item.type, path: item.path, force }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "storage_delete_failed");
      }
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds((items) => items.filter((id) => id !== item.id));
      notify(t("settings.storageDeleted"), "success");
    } catch (error) {
      notify(error instanceof Error && error.message === "storage_item_active" ? t("settings.storageDeleteActiveFailed") : t("settings.storageDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function copyStoragePath(item: StorageItemSummary) {
    const copied = await copyText(item.path);
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function deleteSelectedStorageItems() {
    const selected = visibleStorageItems.filter((item) => selectedStorageIds.includes(item.id));
    if (!selected.length) return;
    const activeCount = selected.filter((item) => item.status === "active").length;
    const force = activeCount > 0;
    const confirmMessage = force
      ? t("settings.storageForceDeleteSelectedConfirm").replace("{count}", String(activeCount))
      : t("settings.storageDeleteSelectedConfirm").replace("{count}", String(selected.length));
    if (!window.confirm(confirmMessage)) return;
    setBusy("storage-delete-selected");
    try {
      const response = await fetch("/api/settings/storage/delete-batch", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ items: selected.map((item) => ({ type: item.type, path: item.path })), force }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "storage_delete_failed");
      }
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds([]);
      notify(t("settings.storageDeleted"), "success");
    } catch (error) {
      notify(error instanceof Error && error.message === "storage_item_active" ? t("settings.storageDeleteActiveFailed") : t("settings.storageDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteOrphanStorageItems() {
    const selected = orphanStorageItems;
    if (!selected.length) return;
    if (!window.confirm(t("settings.storageDeleteOrphansConfirm").replace("{count}", String(selected.length)))) return;
    setBusy("storage-delete-orphans");
    try {
      const response = await fetch("/api/settings/storage/delete-batch", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ items: selected.map((item) => ({ type: item.type, path: item.path })), force: false }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "storage_delete_failed");
      }
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds([]);
      notify(t("settings.storageDeleted"), "success");
    } catch {
      notify(t("settings.storageDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveBackupSettings(nextRules = backupIgnoreRules) {
    setBusy("backup-settings");
    try {
      const body: UpdateSystemBackupSettingsRequest = { ignorePatterns: nextRules };
      const response = await fetch("/api/settings/backup", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("backup_settings_failed");
      const settings = (await response.json()) as SystemBackupSettings;
      setBackupSettings(settings);
      setBackupIgnoreRules(settings.ignorePatterns.join("\n"));
      setBackupPreview(null);
      notify(t("settings.backupIgnoreSaved"), "success");
    } catch {
      notify(t("settings.backupIgnoreSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function editBackupIgnoreRules() {
    const nextRules = await dialog.prompt({
      title: t("settings.backupIgnoreTitle"),
      message: t("settings.backupIgnoreHelp"),
      defaultValue: backupIgnoreRules,
      placeholder: "node_modules/\n.DS_Store\n*.tmp",
      confirmLabel: t("settings.saveBackupIgnore"),
      multiline: true,
    });
    if (nextRules === null) return;
    setBackupIgnoreRules(nextRules);
    await saveBackupSettings(nextRules);
  }

  async function loadBackupPreview() {
    setBusy("backup-preview");
    try {
      const response = await fetch("/api/settings/backup/preview", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("backup_preview_failed");
      setBackupPreview((await response.json()) as SystemBackupPreviewResponse);
    } catch {
      notify(t("settings.backupPreviewFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function downloadSystemBackup() {
    setBusy("backup-download");
    try {
      const response = await fetch("/api/settings/backup/download", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("backup_download_failed");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `codex-web-system-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify(t("settings.backupDownloadStarted"), "success");
    } catch {
      notify(t("settings.backupDownloadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function previewRestoreBackup(file: File) {
    setRestoreFile(file);
    setRestorePreview(null);
    setRestoreMessage("");
    setBusy("restore-preview");
    try {
      const form = new FormData();
      form.append("backup", file);
      const response = await fetch("/api/settings/restore/preview", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      if (!response.ok) throw new Error("restore_preview_failed");
      setRestorePreview((await response.json()) as SystemBackupPreviewResponse);
    } catch {
      setRestoreFile(null);
      notify(t("settings.restorePreviewFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function restoreSystemBackup() {
    if (!restoreFile) return;
    if (!window.confirm(t("settings.restoreConfirm"))) return;
    setRestoreMessage("");
    setBusy("restore-apply");
    try {
      const form = new FormData();
      form.append("backup", restoreFile);
      const response = await fetch("/api/settings/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      const result = await response.json().catch(() => null) as (SystemRestoreResponse & { error?: string }) | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "restore_failed");
      const message = t("settings.restoreDone").replace("{path}", result.backupBeforeRestorePath);
      setRestoreMessage(message);
      notify(t("settings.restoreDoneToast"), "success");
    } catch {
      setRestoreMessage(t("settings.restoreFailed"));
      notify(t("settings.restoreFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveCodexRuntime(event: React.FormEvent) {
    event.preventDefault();
    setBusy("runtime");
    const body: UpdateCodexRuntimeSettingsRequest = { sandboxMode, approvalPolicy, bypassSandbox };
    try {
      const response = await fetch("/api/settings/codex-runtime", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string; approval?: ApprovalSummary } | null;
        if (response.status === 409 && result?.error === "approval_required") {
          if (result.approval) onApprovalRequired(result.approval);
          notify(t("approval.required"), "info");
          return;
        }
        notify(t("settings.runtimeSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as CodexRuntimeSettings;
      setCodexRuntime(settings);
      setSandboxMode(settings.sandboxMode);
      setApprovalPolicy(settings.approvalPolicy);
      setBypassSandbox(settings.bypassSandbox);
      notify(t("settings.runtimeSaved"), "success");
    } catch {
      notify(t("settings.runtimeSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function savePreviewAccessSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("preview-access");
    try {
      const response = await fetch("/api/settings/preview-access", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requestTtlMinutes: Number(previewAccessRequestTtlMinutes) }),
      });
      if (!response.ok) {
        notify(t("settings.previewAccessSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as PreviewAccessSettings;
      setPreviewAccessSettings(settings);
      setPreviewAccessRequestTtlMinutes(String(settings.requestTtlMinutes));
      notify(t("settings.previewAccessSaved"), "success");
    } catch {
      notify(t("settings.previewAccessSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveSessionCompactionSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("session-compaction");
    const body: UpdateSessionCompactionSettingsRequest = {
      enabled: sessionCompactionEnabled,
      autoCompactMessages: Number(sessionCompactionForm.autoCompactMessages),
      autoCompactChars: Number(sessionCompactionForm.autoCompactChars),
      minNewMessages: Number(sessionCompactionForm.minNewMessages),
      minNewChars: Number(sessionCompactionForm.minNewChars),
    };
    try {
      const response = await fetch("/api/settings/session-compaction", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        notify(t("settings.sessionCompactionSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as SessionCompactionSettings;
      setSessionCompactionSettings(settings);
      setSessionCompactionEnabled(settings.enabled);
      setSessionCompactionForm({
        autoCompactMessages: String(settings.autoCompactMessages),
        autoCompactChars: String(settings.autoCompactChars),
        minNewMessages: String(settings.minNewMessages),
        minNewChars: String(settings.minNewChars),
      });
      notify(t("settings.sessionCompactionSaved"), "success");
    } catch {
      notify(t("settings.sessionCompactionSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveRateLimitSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("rate-limit");
    try {
      const response = await fetch("/api/settings/rate-limit", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          enabled: rateLimitEnabled,
          globalPerMinute: Number(rateLimitForm.globalPerMinute),
          authPerMinute: Number(rateLimitForm.authPerMinute),
          previewAccessPerMinute: Number(rateLimitForm.previewAccessPerMinute),
          expensivePerFiveMinutes: Number(rateLimitForm.expensivePerFiveMinutes),
          providerProxyPerMinute: Number(rateLimitForm.providerProxyPerMinute),
          providerProxyPerHour: Number(rateLimitForm.providerProxyPerHour),
          providerProxyMaxConcurrent: Number(rateLimitForm.providerProxyMaxConcurrent),
        }),
      });
      if (!response.ok) {
        notify(t("settings.rateLimitSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as RateLimitSettings;
      setRateLimitSettings(settings);
      setRateLimitEnabled(settings.enabled);
      setRateLimitForm({
        globalPerMinute: String(settings.globalPerMinute),
        authPerMinute: String(settings.authPerMinute),
        previewAccessPerMinute: String(settings.previewAccessPerMinute),
        expensivePerFiveMinutes: String(settings.expensivePerFiveMinutes),
        providerProxyPerMinute: String(settings.providerProxyPerMinute),
        providerProxyPerHour: String(settings.providerProxyPerHour),
        providerProxyMaxConcurrent: String(settings.providerProxyMaxConcurrent),
      });
      notify(t("settings.rateLimitSaved"), "success");
    } catch {
      notify(t("settings.rateLimitSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function scanEnvironment() {
    setBusy("environment-scan");
    try {
      const response = await fetch("/api/settings/environment/scan", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_scan_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentScanSuccess"), "success");
    } catch {
      notify(t("settings.environmentScanFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function installMise() {
    setBusy("environment-mise-install");
    try {
      const response = await fetch("/api/settings/environment/mise/install", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentMiseInstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentMiseInstallSuccess"), "success");
    } catch {
      notify(t("settings.environmentMiseInstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function installEnvironmentTool(event: React.FormEvent) {
    event.preventDefault();
    setBusy("environment-install");
    try {
      const body: InstallEnvironmentToolRequest = {
        tool: environmentInstallForm.tool,
        version: environmentInstallForm.version,
        scope: environmentInstallForm.scope as InstallEnvironmentToolRequest["scope"],
        autoRestore: environmentInstallForm.autoRestore,
        notes: environmentInstallForm.notes,
      };
      const endpoint = environmentProbe?.installed ? "/api/settings/environment/tools/register" : "/api/settings/environment/tools/install";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          detectedVersion: environmentProbe?.detectedVersion ?? null,
          source: environmentProbe?.installed ? "system" : undefined,
        }),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { error?: string; detail?: string; overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentInstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify((environmentProbe?.installed ? t("settings.environmentRecordSuccess") : t("settings.environmentInstallSuccess")).replace("{tool}", environmentInstallForm.tool), "success");
    } catch {
      notify(t("settings.environmentInstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteEnvironmentToolRecord(tool: EnvironmentToolRecord) {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentToolDeleteConfirm"),
      message: `${tool.tool} ${tool.requestedVersion}\n${t("settings.environmentToolDeleteHint")}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-tool-delete:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_tool_delete_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentToolDeleted"), "success");
    } catch {
      notify(t("settings.environmentToolDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function uninstallEnvironmentTool(tool: EnvironmentToolRecord) {
    if (tool.source !== "mise") return;
    const confirmed = await dialog.confirm({
      title: t("settings.environmentToolUninstallConfirm"),
      message: `${tool.tool} ${tool.requestedVersion}\n${t("settings.environmentToolUninstallHint")}`,
      confirmLabel: t("settings.environmentToolUninstall"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-tool-uninstall:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}/uninstall`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { error?: string; overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentToolUninstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentToolUninstalled"), "success");
    } catch {
      notify(t("settings.environmentToolUninstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function setEnvironmentToolDefault(tool: EnvironmentToolRecord) {
    setBusy(`environment-tool-default:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}/set-default`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentToolSetDefaultFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentToolSetDefaultSuccess").replace("{tool}", `${tool.tool}@${tool.requestedVersion}`), "success");
    } catch {
      notify(t("settings.environmentToolSetDefaultFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function openEnvironmentPackagePanel(tool: EnvironmentToolRecord) {
    setBusy(`environment-packages:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}/packages`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_packages_failed");
      const detail = (await response.json()) as EnvironmentPackageDetailResponse;
      setEnvironmentPackagePanel(detail);
      setEnvironmentPackageForm({
        manager: "",
        packageName: "",
        versionSpec: "",
        notes: "",
      });
      setEnvironmentPackageProbe(null);
    } catch {
      notify(t("settings.environmentPackagesLoadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  const selectedEnvironmentPackageManager = environmentPackagePanel?.managers.find((manager) => manager.id === environmentPackageForm.manager) ?? null;
  const normalizedEnvironmentPackageName = environmentPackageForm.packageName.trim().toLowerCase();
  const environmentPackageAlreadyTracked = environmentPackagePanel?.packages.some((pkg) => pkg.manager === environmentPackageForm.manager && pkg.packageName.trim().toLowerCase() === normalizedEnvironmentPackageName) ?? false;
  const filteredEnvironmentPackages = environmentPackagePanel?.packages.filter((pkg) => {
    if (!normalizedEnvironmentPackageName) return true;
    return pkg.packageName.toLowerCase().includes(normalizedEnvironmentPackageName);
  }) ?? [];
  const environmentPackageNeedsManualCleanup = (pkg: EnvironmentPackageRecord) => pkg.manager === "go-install" || pkg.manager === "shards";

  async function probeEnvironmentPackage() {
    if (!environmentPackagePanel || !environmentPackageForm.manager || !environmentPackageForm.packageName.trim()) return;
    setBusy("environment-package-probe");
    try {
      const params = new URLSearchParams({
        manager: environmentPackageForm.manager,
        package: environmentPackageForm.packageName.trim(),
      });
      const response = await fetch(`/api/settings/environment/tools/${environmentPackagePanel.toolRecord.id}/packages/probe?${params.toString()}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_package_probe_failed");
      const probe = (await response.json()) as { installed: boolean; version?: string | null; manager: string; packageName: string };
      setEnvironmentPackageProbe({ ...probe, checked: true });
      notify(probe.installed ? t("settings.environmentPackageDetected") : t("settings.environmentPackageNotDetected"), probe.installed ? "success" : "info");
    } catch {
      notify(t("settings.environmentPackageCheckFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function runEnvironmentBulkAction(input: EnvironmentBulkActionRequest) {
    setBusy(`environment-bulk:${input.action}`);
    try {
      const response = await fetch("/api/settings/environment/bulk", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentPackagesLoadFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      if (environmentPackagePanel && input.toolRecordId === environmentPackagePanel.toolRecord.id) {
        await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      }
    } catch {
      notify(t("settings.environmentPackagesLoadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function installEnvironmentPackage(event: React.FormEvent) {
    event.preventDefault();
    if (!environmentPackagePanel) return;
    setBusy("environment-package-install");
    try {
      const response = await fetch("/api/settings/environment/packages/install", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          toolRecordId: environmentPackagePanel.toolRecord.id,
          manager: environmentPackageForm.manager,
          packageName: environmentPackageForm.packageName,
          versionSpec: environmentPackageForm.versionSpec,
          notes: environmentPackageForm.notes,
        }),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentPackageInstallFailed"), "error");
        return;
      }
      const overview = result as EnvironmentOverview;
      setEnvironmentOverview(overview);
      await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      setEnvironmentPackageProbe(null);
      notify(t("settings.environmentPackageInstalled").replace("{name}", environmentPackageForm.packageName), "success");
    } catch {
      notify(t("settings.environmentPackageInstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function uninstallEnvironmentPackage(pkg: EnvironmentPackageRecord) {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentPackageUninstallConfirm"),
      message: `${pkg.packageName}\n${t("settings.environmentPackageUninstallHint")}`,
      confirmLabel: t("settings.environmentPackageUninstall"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-package-delete:${pkg.id}`);
    try {
      const response = await fetch(`/api/settings/environment/packages/${pkg.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ manager: pkg.manager }),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentPackageUninstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      if (environmentPackagePanel) await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      notify(t("settings.environmentPackageUninstalled").replace("{name}", pkg.packageName), "success");
    } catch {
      notify(t("settings.environmentPackageUninstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteEnvironmentRestoreRun(run: EnvironmentRestoreRun) {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentRestoreDeleteConfirm"),
      message: run.summary,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-restore-delete:${run.id}`);
    try {
      const response = await fetch(`/api/settings/environment/restore-runs/${run.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_restore_delete_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentRestoreDeleted"), "success");
    } catch {
      notify(t("settings.environmentRestoreDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function clearEnvironmentRestoreRuns() {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentRestoreClearConfirm"),
      message: t("settings.environmentRestoreClearHint"),
      confirmLabel: t("settings.environmentRestoreClear"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("environment-restore-clear");
    try {
      const response = await fetch("/api/settings/environment/restore-runs", {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_restore_clear_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentRestoreCleared"), "success");
    } catch {
      notify(t("settings.environmentRestoreDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function loadEnvironmentRegistry(query = environmentToolQuery) {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/settings/environment/tool-registry${params.toString() ? `?${params}` : ""}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_registry_failed");
      const result = (await response.json()) as { items: EnvironmentToolRegistryItem[]; mise?: EnvironmentOverview["mise"] };
      setEnvironmentRegistry(result.items);
      if (result.mise && environmentOverview) {
        setEnvironmentOverview({ ...environmentOverview, mise: result.mise });
      }
    } catch {
      notify(t("settings.environmentRegistryFailed"), "error");
    }
  }

  async function loadEnvironmentVersions(tool = environmentInstallForm.tool) {
    if (!tool.trim()) {
      setEnvironmentVersions([]);
      setEnvironmentVersionHistory([]);
      setEnvironmentVersionError("");
      return;
    }
    try {
      const params = new URLSearchParams({ tool: tool.trim() });
      const response = await fetch(`/api/settings/environment/tool-versions?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_versions_failed");
      const result = (await response.json()) as { items: EnvironmentToolVersionItem[]; history?: EnvironmentToolVersionItem[]; error?: string | null; mise?: EnvironmentOverview["mise"] };
      setEnvironmentVersions(result.items);
      setEnvironmentVersionHistory(result.history ?? []);
      setEnvironmentVersionError(result.error ?? "");
      setEnvironmentShowVersionHistory(false);
      if (result.mise && environmentOverview) {
        setEnvironmentOverview({ ...environmentOverview, mise: result.mise });
      }
    } catch {
      setEnvironmentVersions([]);
      setEnvironmentVersionHistory([]);
      setEnvironmentVersionError(t("settings.environmentVersionsFailed"));
    }
  }

  async function probeEnvironmentTool(tool = environmentInstallForm.tool) {
    if (!tool.trim()) {
      setEnvironmentProbe(null);
      return;
    }
    try {
      const params = new URLSearchParams({ tool: tool.trim() });
      const response = await fetch(`/api/settings/environment/tool-probe?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_probe_failed");
      const result = (await response.json()) as { probe: EnvironmentToolProbe; mise?: EnvironmentOverview["mise"] };
      setEnvironmentProbe(result.probe);
      if (result.mise && environmentOverview) {
        setEnvironmentOverview({ ...environmentOverview, mise: result.mise });
      }
    } catch {
      setEnvironmentProbe(null);
    }
  }

  const visibleStorageItems = (storageScan?.items ?? [])
    .filter((item) => {
      const query = storageSearch.trim().toLowerCase();
      if (storageStatusFilter && item.status !== storageStatusFilter) return false;
      return !query || [item.label, item.type, readableStorageItemType(item.type, t), item.status, item.path, item.relatedId, item.relatedName, item.relatedType].some((value) => value?.toLowerCase().includes(query));
    })
    .sort((a, b) => {
      if (storageSort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (storageSort === "type") return a.type.localeCompare(b.type) || b.bytes - a.bytes;
      return b.bytes - a.bytes;
    });
  const visibleStorageIds = visibleStorageItems.map((item) => item.id);
  const allVisibleStorageSelected = visibleStorageIds.length > 0 && visibleStorageIds.every((id) => selectedStorageIds.includes(id));
  const activeStorageItems = storageScan?.items.filter((item) => item.status === "active") ?? [];
  const orphanStorageItems = storageScan?.items.filter((item) => item.status === "orphan") ?? [];
  const miseStatus = environmentOverview?.mise ?? null;
  const miseInstalled = miseStatus?.installed === true;

  return (
    <main className="management-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.settings")}`} title={t("page.settings")} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.settings")} />
      <Tabs className="settings-root" value={settingsTab} onValueChange={(value) => setSettingsTab(value as typeof settingsTab)}>
        <TabsList className="settings-tabs" aria-label={t("page.settings")}>
          <TabsTrigger className="settings-tab" value="account">{t("settings.tabAccount")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="runtime">{t("settings.tabRuntime")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="environment">{t("settings.tabEnvironment")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="network">{t("settings.tabNetwork")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="notifications">{t("settings.tabNotifications")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="maintenance">{t("settings.tabMaintenance")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="storage">{t("settings.tabStorage")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="backup">{t("settings.tabBackup")}</TabsTrigger>
        </TabsList>
        <TabsContent className="settings-list" value="account">
          <form className="provider-card" onSubmit={updateAccessToken}>
          <strong>{t("settings.accessTitle")}</strong>
          <span>{t("settings.accessHelp")}</span>
          <input name="currentaccesstoken" className="search-input" type="password" autoComplete="current-password" value={currentAccessToken} onChange={(event) => setCurrentAccessToken(event.target.value)} placeholder={t("settings.currentToken")} required />
          <input name="accesstoken" className="search-input" type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("settings.newToken")} required />
          <input name="confirmaccesstoken" className="search-input" type="password" autoComplete="new-password" value={confirmAccessToken} onChange={(event) => setConfirmAccessToken(event.target.value)} placeholder={t("settings.confirmToken")} required />
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy === "token"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
          {tokenMessage && <span className={tokenMessage === t("settings.tokenUpdated") ? "result-ok" : "result-error"}>{tokenMessage}</span>}
          </form>
          <form className="provider-card" onSubmit={confirmOtpReset}>
          <strong>{t("settings.otpTitle")}</strong>
          <span>{t("settings.otpHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "otp"} onClick={() => void resetOtp()}><IconText icon={RefreshCw}>{t("settings.resetOtp")}</IconText></button>
          </div>
          {otpQr && <img className="otp-qr" src={otpQr} alt={t("auth.otpQrAlt")} />}
          {otpSecret && (
            <>
              <div className="secret-row">
                <code className="secret-box">{otpSecret}</code>
                <button className="ghost-button" type="button" onClick={() => void copyOtpSecret()}>{otpCopyMessage || t("action.copy")}</button>
              </div>
              <input name="otpaccesstoken" className="search-input" type="password" autoComplete="current-password" value={otpAccessToken} onChange={(event) => setOtpAccessToken(event.target.value)} placeholder={t("settings.currentToken")} required />
              <input name="otpcode" className="search-input" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} placeholder={t("settings.otpCode")} required />
              <div className="settings-actions">
                <button className="ghost-button" type="submit" disabled={busy === "otp-confirm"}><IconText icon={Save}>{t("settings.verifyOtp")}</IconText></button>
              </div>
            </>
          )}
          {otpMessage && <span className={otpMessage === t("settings.otpReset") || otpMessage === t("settings.otpGenerated") || otpMessage === t("action.copied") ? "result-ok" : "result-error"}>{otpMessage}</span>}
          </form>
          <section className="provider-card">
          <strong>{t("settings.logoutTitle")}</strong>
          <span>{t("settings.logoutHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={onLogout}>{t("settings.logout")}</button>
          </div>
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="runtime">
          <form className="provider-card" onSubmit={saveCodexRuntime}>
          <strong>{t("settings.codexRuntimeTitle")}</strong>
          <span>{t("settings.codexRuntimeHelp")}</span>
          <label>
            <span>{t("settings.sandboxMode")}</span>
            <select name="sandboxmode" className="search-input" value={sandboxMode} onChange={(event) => setSandboxMode(event.target.value as CodexSandboxMode)} disabled={bypassSandbox}>
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="danger-full-access">danger-full-access</option>
            </select>
          </label>
          <label>
            <span>{t("settings.approvalPolicy")}</span>
            <select name="approvalpolicy" className="search-input" value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as CodexApprovalPolicy)} disabled={bypassSandbox}>
              <option value="never">never</option>
              <option value="on-request">on-request</option>
              <option value="untrusted">untrusted</option>
              <option value="on-failure">on-failure</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input name="bypasssandbox" type="checkbox" checked={bypassSandbox} onChange={(event) => setBypassSandbox(event.target.checked)} />
            <span>{t("settings.bypassSandbox")}</span>
          </label>
          <span>{t("settings.bypassSandboxHelp")}</span>
          {codexRuntime && <code>{codexRuntime.sandboxMode} · {codexRuntime.approvalPolicy} · bypass={String(codexRuntime.bypassSandbox)}</code>}
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy === "runtime"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
          </form>
          <form className="provider-card" onSubmit={saveSessionCompactionSettings}>
          <strong>{t("settings.sessionCompactionTitle")}</strong>
          <span>{t("settings.sessionCompactionHelp")}</span>
          <label className="checkbox-row">
            <input name="sessioncompactionenabled" type="checkbox" checked={sessionCompactionEnabled} onChange={(event) => setSessionCompactionEnabled(event.target.checked)} />
            <span>{t("settings.sessionCompactionEnabled")}</span>
          </label>
          {([
            ["autoCompactMessages", "sessionCompactionAutoMessages"],
            ["autoCompactChars", "sessionCompactionAutoChars"],
            ["minNewMessages", "sessionCompactionMinNewMessages"],
            ["minNewChars", "sessionCompactionMinNewChars"],
          ] as const).map(([key, labelKey]) => (
            <label key={key}>
              <span>{t(`settings.${labelKey}`)}</span>
              <input name={key} className="search-input" type="number" min="1" value={sessionCompactionForm[key]} onChange={(event) => setSessionCompactionForm((current) => ({ ...current, [key]: event.target.value }))} />
            </label>
          ))}
          {sessionCompactionSettings && <code>{sessionCompactionSettings.enabled ? "enabled" : "disabled"} · {sessionCompactionSettings.autoCompactMessages} messages / {sessionCompactionSettings.autoCompactChars} chars</code>}
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy === "session-compaction"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
          </form>
        </TabsContent>
        <TabsContent className="settings-list" value="environment">
          <section className="settings-feature-panel">
            <div className="settings-feature-hero environment-hero">
              <div>
                <strong>{t("settings.environmentTitle")}</strong>
                <span>{t("settings.environmentHelp")}</span>
                <div className={`environment-mise-status ${miseInstalled ? "ok" : "warning"}`}>
                  <span className={`pill ${miseInstalled ? "" : "warm"}`}>{miseInstalled ? t("settings.environmentMiseReady") : t("settings.environmentMiseMissing")}</span>
                  <span>
                    {miseInstalled
                      ? t("settings.environmentMiseVersion").replace("{version}", miseStatus?.version ?? t("settings.environmentMissingVersion"))
                      : t("settings.environmentMiseMissingHelp")}
                  </span>
                </div>
              </div>
              <div className="settings-actions">
                {!miseInstalled && (
                  <button className="ghost-button" type="button" disabled={busy === "environment-mise-install"} onClick={() => void installMise()}>
                    <IconText icon={Download}>{busy === "environment-mise-install" ? t("settings.environmentMiseInstalling") : t("settings.environmentMiseInstall")}</IconText>
                  </button>
                )}
                <button className="ghost-button" type="button" disabled={busy === "environment-scan"} onClick={() => void scanEnvironment()}><IconText icon={RefreshCw}>{t("settings.environmentScan")}</IconText></button>
              </div>
            </div>
            <div className="environment-layout">
              <form className="provider-card environment-install-card" onSubmit={installEnvironmentTool}>
                <div className="environment-card-head">
                  <div>
                    <strong>{t("settings.environmentInstall")}</strong>
                    <span>{t("settings.environmentInstallHelp")}</span>
                  </div>
                </div>
                <div className="environment-install-grid">
                  <label>
                    <span>{t("settings.environmentToolName")}</span>
                    <div className="environment-tool-picker">
                      <input
                        className="search-input"
                        value={environmentToolQuery || environmentInstallForm.tool}
                        onFocus={() => {
                          setEnvironmentToolPickerOpen(false);
                        }}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEnvironmentToolQuery(value);
                          setEnvironmentInstallForm((current) => ({ ...current, tool: value }));
                          setEnvironmentToolPickerOpen(false);
                        }}
                        placeholder={t("settings.environmentToolPlaceholder")}
                        required
                      />
                      <button
                        className="environment-tool-search"
                        type="button"
                        onClick={() => {
                          setEnvironmentToolPickerOpen(true);
                          void loadEnvironmentRegistry(environmentToolQuery || environmentInstallForm.tool);
                        }}
                      >
                        {t("settings.environmentSearchTools")}
                      </button>
                      {environmentToolPickerOpen && (
                        <div className="environment-tool-menu">
                          {environmentRegistry.length ? environmentRegistry.slice(0, 12).map((item) => (
                            <button
                              className="environment-tool-option"
                              type="button"
                              key={item.name}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setEnvironmentInstallForm((current) => ({ ...current, tool: item.name }));
                                setEnvironmentToolQuery(item.name);
                                setEnvironmentToolPickerOpen(false);
                                setEnvironmentVersionPickerOpen(true);
                                void loadEnvironmentVersions(item.name);
                                void probeEnvironmentTool(item.name);
                              }}
                            >
                              <strong>{item.name}</strong>
                              {item.description && <span>{item.description}</span>}
                            </button>
                          )) : <div className="environment-tool-empty">{t("settings.environmentRegistryEmpty")}</div>}
                        </div>
                      )}
                    </div>
                  </label>
                  <label>
                    <span>{t("settings.environmentToolVersion")}</span>
                    <div className="environment-tool-picker">
                      <input
                        className="search-input"
                        value={environmentInstallForm.version}
                        onFocus={() => {
                          setEnvironmentVersionPickerOpen(false);
                        }}
                        onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, version: event.target.value }))}
                        placeholder={t("settings.environmentVersionPlaceholder")}
                        required
                      />
                      <button
                        className="environment-tool-search"
                        type="button"
                        disabled={!environmentInstallForm.tool.trim()}
                        onClick={() => {
                          setEnvironmentVersionPickerOpen(true);
                          void loadEnvironmentVersions();
                        }}
                      >
                        {t("settings.environmentLoadVersions")}
                      </button>
                      {environmentVersionPickerOpen && (
                        <div className="environment-tool-menu">
                          {environmentVersions.length ? (
                            <>
                              {environmentVersions.map((item) => (
                                <button
                                  className="environment-tool-option"
                                  type="button"
                                  key={item.version}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setEnvironmentInstallForm((current) => ({ ...current, version: item.version }));
                                    setEnvironmentVersionPickerOpen(false);
                                  }}
                                >
                                  <strong>{item.version}</strong>
                                  {item.recommended && <span>{t("settings.environmentRecommendedVersion")}</span>}
                                </button>
                              ))}
                              {Boolean(environmentVersionHistory.length) && (
                                <>
                                  <button
                                    className="environment-tool-more"
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => setEnvironmentShowVersionHistory((current) => !current)}
                                  >
                                    {environmentShowVersionHistory ? t("settings.environmentHideHistory") : t("settings.environmentShowHistory")}
                                  </button>
                                  {environmentShowVersionHistory && environmentVersionHistory.map((item) => (
                                    <button
                                      className="environment-tool-option"
                                      type="button"
                                      key={`history-${item.version}`}
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setEnvironmentInstallForm((current) => ({ ...current, version: item.version }));
                                        setEnvironmentVersionPickerOpen(false);
                                      }}
                                    >
                                      <strong>{item.version}</strong>
                                    </button>
                                  ))}
                                </>
                              )}
                            </>
                          ) : <div className="environment-tool-empty">{environmentVersionError || t("settings.environmentVersionEmpty")}</div>}
                        </div>
                      )}
                    </div>
                  </label>
                  <label>
                    <span>{t("settings.environmentScope")}</span>
                    <select className="search-input" value={environmentInstallForm.scope} onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, scope: event.target.value }))}>
                      <option value="global">{t("settings.environmentScopeGlobal")}</option>
                      <option value="workspace">{t("settings.environmentScopeWorkspace")}</option>
                      <option value="room">{t("settings.environmentScopeRoom")}</option>
                      <option value="session">{t("settings.environmentScopeSession")}</option>
                    </select>
                  </label>
                  <label>
                    <span>{t("settings.environmentNotes")}</span>
                    <input className="search-input" value={environmentInstallForm.notes} onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("settings.environmentNotesPlaceholder")} />
                  </label>
                </div>
                {environmentProbe?.tool === environmentInstallForm.tool && (
                  <div className={`environment-detected-status ${environmentProbe.installed ? "ok" : "warning"}`}>
                    <span className={`pill ${environmentProbe.installed ? "" : "warm"}`}>
                      {environmentProbe.installed ? t("settings.environmentDetectedInstalled") : t("settings.environmentDetectedMissing")}
                    </span>
                    <span>
                      {environmentProbe.installed
                        ? t("settings.environmentDetectedVersion").replace("{version}", environmentProbe.detectedVersion ?? t("settings.environmentMissingVersion"))
                        : t("settings.environmentDetectedMissingHelp")}
                    </span>
                  </div>
                )}
                <label className="checkbox-row environment-inline-toggle">
                  <input type="checkbox" checked={environmentInstallForm.autoRestore} onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, autoRestore: event.target.checked }))} />
                  <span>{t("settings.environmentAutoRestore")}</span>
                </label>
                <div className="settings-actions environment-actions">
                  <button className="ghost-button" type="submit" disabled={busy === "environment-install"}>
                    <IconText icon={busy === "environment-install" ? RefreshCw : Plus}>
                      {busy === "environment-install"
                        ? (environmentProbe?.installed ? t("settings.environmentRecording") : t("settings.environmentInstalling"))
                        : (environmentProbe?.installed ? t("settings.environmentRecord") : t("settings.environmentInstall"))}
                    </IconText>
                  </button>
                </div>
              </form>
              <div className="environment-summary-grid">
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentReconcileTitle")}</strong>
                      <span>{t("settings.environmentReconcileHelp")}</span>
                    </div>
                    <span className="pill">{environmentReconcileItems.length}</span>
                  </div>
                  {!environmentReconcileItems.length && <div className="empty-state">{t("settings.environmentEmptyReconcile")}</div>}
                  {Boolean(environmentReconcileItems.length) && (
                    <div className="environment-list">
                      {environmentReconcileItems.map((item) => (
                        <article className="environment-item" key={item.id}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{item.title}</strong>
                              <span className="pill warm">{item.status}</span>
                            </div>
                            <span>{item.detail}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentTrackedTools")}</strong>
                      <span>{t("settings.environmentTrackedToolsHelp")}</span>
                    </div>
                    <span className="pill">{environmentOverview?.tools.length ?? 0}</span>
                  </div>
                  {!environmentOverview?.tools.length && <div className="empty-state">{t("settings.environmentEmpty")}</div>}
                  {Boolean(environmentOverview?.tools.length) && (
                    <div className="environment-list">
                      {environmentOverview?.tools.map((tool) => (
                        <article className="environment-item" key={tool.id}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{tool.tool}</strong>
                              <div className="provider-card-actions">
                                {tool.isGlobalDefault && <span className="pill">{t("settings.environmentGlobalDefault")}</span>}
                                <span className={`pill ${tool.status === "installed" ? "" : "warm"}`}>{tool.status}</span>
                              </div>
                            </div>
                            <span>{tool.requestedVersion} · {tool.detectedVersion ?? t("settings.environmentMissingVersion")}</span>
                            <span>{tool.scope} · {tool.source} · {tool.autoRestore ? t("settings.environmentAutoRestoreOn") : t("settings.environmentAutoRestoreOff")}</span>
                            {tool.notes && <span>{tool.notes}</span>}
                          </div>
                          <div className="storage-actions">
                            {!tool.isGlobalDefault && (
                              <button className="ghost-button icon-only" type="button" disabled={busy === `environment-tool-default:${tool.id}`} title={t("settings.environmentSetGlobalDefault")} aria-label={t("settings.environmentSetGlobalDefault")} onClick={() => void setEnvironmentToolDefault(tool)}><IconText icon={Check}>{t("settings.environmentSetGlobalDefault")}</IconText></button>
                            )}
                            <button className="ghost-button icon-only" type="button" disabled={busy === `environment-packages:${tool.id}`} title={t("settings.environmentPackageManage")} aria-label={t("settings.environmentPackageManage")} onClick={() => void openEnvironmentPackagePanel(tool)}><IconText icon={Boxes}>{t("settings.environmentPackageManage")}</IconText></button>
                            {tool.source === "mise" && (
                              <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-tool-uninstall:${tool.id}`} title={t("settings.environmentToolUninstall")} aria-label={t("settings.environmentToolUninstall")} onClick={() => void uninstallEnvironmentTool(tool)}><IconText icon={PackageX}>{t("settings.environmentToolUninstall")}</IconText></button>
                            )}
                            <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-tool-delete:${tool.id}`} title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteEnvironmentToolRecord(tool)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentProjectUsageTitle")}</strong>
                      <span>{t("settings.environmentProjectUsageHelp")}</span>
                    </div>
                    <span className="pill">{environmentProjectUsageItems.length}</span>
                  </div>
                  {!environmentProjectUsageItems.length && <div className="empty-state">{t("settings.environmentEmptyProjectUsage")}</div>}
                  {Boolean(environmentProjectUsageItems.length) && (
                    <div className="environment-list">
                      {environmentProjectUsageItems.map((item) => (
                        <article className="environment-item" key={item.projectId}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{item.projectName}</strong>
                              <span className="pill">{item.matchedTools.join(", ")}</span>
                            </div>
                            <span>{item.workspacePath}</span>
                            <span>{item.detectedFiles.join(" · ")}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentRestoreHistory")}</strong>
                      <span>{t("settings.environmentRestoreHistoryHelp")}</span>
                    </div>
                    <div className="provider-card-actions">
                      <span className="pill">{environmentOverview?.restoreRuns.length ?? 0}</span>
                      <button className="ghost-button danger-button" type="button" disabled={busy === "environment-bulk:cleanup_stale_records"} onClick={() => void runEnvironmentBulkAction({ action: "cleanup_stale_records" })}>{t("settings.environmentBulkCleanupStale")}</button>
                      <button className="ghost-button danger-button" type="button" disabled={busy === "environment-restore-clear" || !(environmentOverview?.restoreRuns.length ?? 0)} onClick={() => void clearEnvironmentRestoreRuns()}>{t("settings.environmentRestoreClear")}</button>
                    </div>
                  </div>
                  {!environmentOverview?.restoreRuns.length && <div className="empty-state">{t("settings.environmentRestoreEmpty")}</div>}
                  {Boolean(environmentOverview?.restoreRuns.length) && (
                    <div className="environment-list">
                      {environmentOverview?.restoreRuns.map((run) => (
                        <article className="environment-item" key={run.id}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{run.summary}</strong>
                              <span className={`pill ${run.status === "success" ? "" : "warm"}`}>{run.status}</span>
                            </div>
                            <span>{formatShortDate(run.createdAt)}</span>
                          </div>
                          <div className="storage-actions">
                            <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-restore-delete:${run.id}`} title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteEnvironmentRestoreRun(run)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="network">
          <form className="provider-card" onSubmit={savePreviewAccessSettings}>
            <strong>{t("settings.previewAccessTitle")}</strong>
            <span>{t("settings.previewAccessHelp")}</span>
            <label>
              <span>{t("settings.previewAccessRequestTtl")}</span>
              <input name="previewaccessttl" className="search-input" type="number" min="1" max="1440" value={previewAccessRequestTtlMinutes} onChange={(event) => setPreviewAccessRequestTtlMinutes(event.target.value)} />
            </label>
            {previewAccessSettings && <code>{t("settings.previewAccessCurrent").replace("{minutes}", String(previewAccessSettings.requestTtlMinutes))}</code>}
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "preview-access"}><IconText icon={Save}>{t("action.save")}</IconText></button>
            </div>
          </form>
          <form className="provider-card" onSubmit={saveRateLimitSettings}>
            <strong>{t("settings.rateLimitTitle")}</strong>
            <span>{t("settings.rateLimitHelp")}</span>
            <label className="checkbox-row">
              <input name="ratelimitenabled" type="checkbox" checked={rateLimitEnabled} onChange={(event) => setRateLimitEnabled(event.target.checked)} />
              <span>{t("settings.rateLimitEnabled")}</span>
            </label>
            {([
              ["globalPerMinute", "rateLimitGlobalPerMinute"],
              ["authPerMinute", "rateLimitAuthPerMinute"],
              ["previewAccessPerMinute", "rateLimitPreviewAccessPerMinute"],
              ["expensivePerFiveMinutes", "rateLimitExpensivePerFiveMinutes"],
              ["providerProxyPerMinute", "rateLimitProviderProxyPerMinute"],
              ["providerProxyPerHour", "rateLimitProviderProxyPerHour"],
              ["providerProxyMaxConcurrent", "rateLimitProviderProxyMaxConcurrent"],
            ] as const).map(([key, labelKey]) => (
              <label key={key}>
                <span>{t(`settings.${labelKey}`)}</span>
                <input name={key} className="search-input" type="number" min="1" value={rateLimitForm[key]} onChange={(event) => setRateLimitForm((current) => ({ ...current, [key]: event.target.value }))} />
              </label>
            ))}
            {rateLimitSettings && <code>{rateLimitSettings.enabled ? "enabled" : "disabled"} · global={rateLimitSettings.globalPerMinute}/min</code>}
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "rate-limit"}><IconText icon={Save}>{t("action.save")}</IconText></button>
            </div>
          </form>
        </TabsContent>
        <TabsContent className="settings-list" value="notifications">
          <div className="settings-tabs notification-inner-tabs">
            {(["senders", "recipients", "rules", "logs"] as const).map((view) => (
              <button className={`settings-tab ${notificationView === view ? "active" : ""}`} type="button" key={view} onClick={() => setNotificationView(view)}>
                {t(`settings.notificationTab${view === "senders" ? "Senders" : view === "recipients" ? "Recipients" : view === "rules" ? "Rules" : "Logs"}`)}
              </button>
            ))}
          </div>
          {notificationView === "senders" && (
            <>
          <form className="notification-card" onSubmit={createNotificationAccount}>
            <strong>{t("settings.notificationAccountsTitle")}</strong>
            <span>{t("settings.notificationAccountsHelp")}</span>
            <label>
              <span>{t("settings.notificationAccountName")}</span>
              <input name="notification-account-name" className="search-input" value={notificationAccountForm.name} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label>
              <span>{t("settings.notificationSenderType")}</span>
              <select name="notification-account-channel-kind" className="search-input" value={notificationAccountForm.channelKind} disabled={Boolean(notificationEditingAccountId)} onChange={(event) => {
                const channelKind = event.target.value as NotificationAccountSummary["channelKind"];
                setNotificationAccountForm((current) => ({ ...current, channelKind, channelId: channelKind }));
              }}>
                <option value="email">Email SMTP</option>
                <option value="telegram">Telegram Bot</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input name="notification-account-enabled" type="checkbox" checked={notificationAccountForm.enabled} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>{t("settings.notificationEnabled")}</span>
            </label>
            <label>
              <span>{t("settings.notificationAllowedAgents")}</span>
              <input name="notification-account-allowed-agents" className="search-input" value={notificationAccountForm.permissionAgentIds} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, permissionAgentIds: event.target.value }))} placeholder="agent-id-1, agent-id-2" />
            </label>
            <label>
              <span>{t("settings.notificationAllowedRooms")}</span>
              <input name="notification-account-allowed-rooms" className="search-input" value={notificationAccountForm.permissionRoomIds} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, permissionRoomIds: event.target.value }))} placeholder="room-id-1, room-id-2" />
            </label>
            <label>
              <span>{t("settings.notificationAllowedProjects")}</span>
              <input name="notification-account-allowed-projects" className="search-input" value={notificationAccountForm.permissionProjectIds} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, permissionProjectIds: event.target.value }))} placeholder="project-id-1, project-id-2" />
            </label>
            {notificationAccountForm.channelKind === "email" && (
              <>
                <label>
                  <span>{t("settings.notificationEmailHost")}</span>
                  <input name="notification-email-host" className="search-input" value={notificationAccountForm.emailHost} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailHost: event.target.value }))} />
                </label>
                <label>
                  <span>{t("settings.notificationEmailPort")}</span>
                  <input name="notification-email-port" className="search-input" type="number" min="1" value={notificationAccountForm.emailPort} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailPort: event.target.value }))} />
                </label>
                <label className="checkbox-row">
                  <input name="notification-email-secure" type="checkbox" checked={notificationAccountForm.emailSecure} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailSecure: event.target.checked }))} />
                  <span>{t("settings.notificationEmailSecure")}</span>
                </label>
                <label>
                  <span>{t("settings.notificationEmailUsername")}</span>
                  <input name="notification-email-username" className="search-input" value={notificationAccountForm.emailUsername} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailUsername: event.target.value }))} />
                </label>
                <label>
                  <span>{t("settings.notificationEmailPassword")}</span>
                  <input name="notification-email-password" className="search-input" type="password" value={notificationAccountForm.emailPassword} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailPassword: event.target.value }))} />
                </label>
                <label>
                  <span>{t("settings.notificationEmailFromName")}</span>
                  <input name="notification-email-from-name" className="search-input" value={notificationAccountForm.emailFromName} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailFromName: event.target.value }))} />
                </label>
                <label>
                  <span>{t("settings.notificationEmailFromEmail")}</span>
                  <input name="notification-email-from-email" className="search-input" value={notificationAccountForm.emailFromEmail} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailFromEmail: event.target.value }))} />
                </label>
                {!notificationEditingAccountId && <label className="checkbox-row">
                  <input name="notification-email-create-recipient" type="checkbox" checked={notificationAccountForm.emailCreateRecipient} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, emailCreateRecipient: event.target.checked }))} />
                  <span>{t("settings.notificationEmailCreateRecipient")}</span>
                </label>}
              </>
            )}
            {notificationAccountForm.channelKind === "telegram" && (
              <>
                <label>
                  <span>{t("settings.notificationTelegramBotToken")}</span>
                  <input name="notification-telegram-bot-token" className="search-input" type="password" value={notificationAccountForm.telegramBotToken} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramBotToken: event.target.value }))} />
                </label>
                <label>
                  <span>{t("settings.notificationTelegramProxyUrl")}</span>
                  <input name="notification-telegram-proxy-url" className="search-input" value={notificationAccountForm.telegramProxyUrl} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramProxyUrl: event.target.value }))} placeholder="https://proxy.example.com/" />
                </label>
                <label className="dialog-checkbox">
                  <input name="notification-telegram-inbound-enabled" type="checkbox" checked={notificationAccountForm.telegramInboundEnabled} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramInboundEnabled: event.target.checked }))} />
                  <span>{t("settings.notificationTelegramInboundEnabled")}</span>
                </label>
                <label>
                  <span>{t("settings.notificationTelegramAllowedChatIds")}</span>
                  <input name="notification-telegram-allowed-chat-ids" className="search-input" value={notificationAccountForm.telegramAllowedChatIds} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramAllowedChatIds: event.target.value }))} placeholder="-100123,123456" />
                </label>
                <label>
                  <span>{t("settings.notificationTelegramAllowedUserIds")}</span>
                  <input name="notification-telegram-allowed-user-ids" className="search-input" value={notificationAccountForm.telegramAllowedUserIds} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramAllowedUserIds: event.target.value }))} placeholder="123456,789012" />
                </label>
                <label>
                  <span>{t("settings.notificationTelegramDefaultSessionId")}</span>
                  <input name="notification-telegram-default-session-id" className="search-input" value={notificationAccountForm.telegramDefaultSessionId} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramDefaultSessionId: event.target.value }))} placeholder="task-..." />
                </label>
                <label>
                  <span>{t("settings.notificationTelegramTestChatId")}</span>
                  <input name="notification-telegram-test-chat-id" className="search-input" value={notificationAccountForm.telegramTestChatId} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, telegramTestChatId: event.target.value }))} />
                </label>
              </>
            )}
            {notificationAccountForm.channelKind === "email" && (
              <label>
                <span>{t("settings.notificationTestEmailTo")}</span>
                <input name="notification-test-email" className="search-input" value={notificationAccountForm.testEmailTo} onChange={(event) => setNotificationAccountForm((current) => ({ ...current, testEmailTo: event.target.value }))} placeholder="a@example.com,b@example.com" />
              </label>
            )}
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "notification-account"}><IconText icon={notificationEditingAccountId ? Save : Plus}>{notificationEditingAccountId ? t("action.saveChanges") : t("settings.notificationAddAccount")}</IconText></button>
              {notificationEditingAccountId && <button className="ghost-button" type="button" onClick={resetNotificationAccountForm}>{t("action.cancel")}</button>}
              <button className="ghost-button" type="button" onClick={() => void loadNotifications()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
            </div>
          </form>
          <div className="notification-card">
            <div className="filter-toolbar compact-filter-toolbar">
              <select name="notification-rule-enabled-filter" className="filter-select" value={notificationRuleEnabledFilter} onChange={(event) => setNotificationRuleEnabledFilter(event.target.value)}>
                <option value="">{t("session.allStatuses")}</option>
                <option value="true">{t("contacts.enabled")}</option>
                <option value="false">{t("contacts.disabled")}</option>
              </select>
            </div>
          </div>
          <section className="notification-card">
            <strong>{t("settings.notificationAccountList")}</strong>
            {(notificationSettings?.accounts ?? []).map((account) => (
              <div className="storage-item" key={account.id}>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.channelKind} · {account.enabled ? "enabled" : "disabled"} · {account.lastTestStatus ?? "untested"} · {notificationPermissionSummary(account.permissions)}</span>
                  {account.lastError && <span className="result-error">{account.lastError}</span>}
                </div>
                <div className="storage-actions">
                  <button className="ghost-button" type="button" onClick={() => editNotificationAccount(account)}>{t("action.edit")}</button>
                  <button className="ghost-button" type="button" disabled={busy === `notification-test:${account.id}`} onClick={() => void testNotificationAccount(account)}>{t("settings.notificationTest")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationAccount(account)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {notificationSettings && !notificationSettings.accounts.length && <div className="empty-state">{t("settings.notificationNoAccounts")}</div>}
          </section>
            </>
          )}
          {notificationView === "recipients" && (
            <>
          <form className="notification-card" onSubmit={createNotificationRecipient}>
            <strong>{t("settings.notificationRecipientsTitle")}</strong>
            <span>{t("settings.notificationRecipientsHelp")}</span>
            <label>
              <span>{t("settings.notificationRecipientName")}</span>
              <input name="notification-recipient-name" className="search-input" value={notificationRecipientForm.name} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label>
              <span>{t("settings.notificationRecipientKind")}</span>
              <select name="notification-recipient-kind" className="search-input" value={notificationRecipientForm.kind} disabled={Boolean(notificationEditingRecipientId)} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, kind: event.target.value as NotificationRecipientSummary["kind"] }))}>
                <option value="email">Email</option>
                <option value="telegram">Telegram</option>
                <option value="webhook">Webhook</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input name="notification-recipient-enabled" type="checkbox" checked={notificationRecipientForm.enabled} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>{t("settings.notificationEnabled")}</span>
            </label>
            <label>
              <span>{t("settings.notificationAllowedAgents")}</span>
              <input name="notification-recipient-allowed-agents" className="search-input" value={notificationRecipientForm.permissionAgentIds} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, permissionAgentIds: event.target.value }))} placeholder="agent-id-1, agent-id-2" />
            </label>
            <label>
              <span>{t("settings.notificationAllowedRooms")}</span>
              <input name="notification-recipient-allowed-rooms" className="search-input" value={notificationRecipientForm.permissionRoomIds} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, permissionRoomIds: event.target.value }))} placeholder="room-id-1, room-id-2" />
            </label>
            <label>
              <span>{t("settings.notificationAllowedProjects")}</span>
              <input name="notification-recipient-allowed-projects" className="search-input" value={notificationRecipientForm.permissionProjectIds} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, permissionProjectIds: event.target.value }))} placeholder="project-id-1, project-id-2" />
            </label>
            {notificationRecipientForm.kind === "email" && (
              <>
                <label>
                  <span>{t("settings.notificationEmailTo")}</span>
                  <input name="notification-recipient-email" className="search-input" value={notificationRecipientForm.email} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, email: event.target.value }))} />
                </label>
                {emailNotificationSenders().length > 1 ? (
                  <label>
                    <span>{t("settings.notificationDefaultEmailSender")}</span>
                    <select name="notification-recipient-email-sender" className="search-input" value={notificationRecipientForm.senderAccountId} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, senderAccountId: event.target.value }))}>
                      <option value="">{t("settings.notificationChooseSender")}</option>
                      {emailNotificationSenders().map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <span className="subtle">{emailNotificationSenders().length === 1 ? t("settings.notificationEmailSenderAuto") : t("settings.notificationEmailSenderMissing")}</span>
                )}
              </>
            )}
            {notificationRecipientForm.kind === "webhook" && (
              <>
                <label>
                  <span>{t("settings.notificationChannel")}</span>
                  <div className="notification-channel-select">
                    <select name="notification-recipient-channel-id" className="search-input" value={notificationRecipientForm.channelId} onChange={(event) => {
                      const channelId = event.target.value;
                      setNotificationRecipientForm((current) => ({
                        ...current,
                        channelId,
                        customConfig: channelId === "bark" ? { serverUrl: "https://api.day.app", group: "Codex Web" } : {} as Record<string, string>,
                      }));
                    }}>
                      {(notificationSettings?.channels ?? []).filter((channel) => channel.kind === "webhook").map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                    </select>
                    <button className="ghost-button icon-only" type="button" title={t("settings.notificationManageChannels")} aria-label={t("settings.notificationManageChannels")} onClick={() => setNotificationChannelManagerOpen(true)}><IconText icon={Plus}>{t("settings.notificationManageChannels")}</IconText></button>
                  </div>
                </label>
                {(notificationSettings?.channels.find((channel) => channel.id === notificationRecipientForm.channelId)?.id !== "webhook")
                  ? (notificationSettings?.channels.find((channel) => channel.id === notificationRecipientForm.channelId)?.accountFields ?? []).map((field) => (
                    <label key={field}>
                      <span>{field}</span>
                      <input name={`notification-recipient-field-${field}`} className="search-input" type={/key|token|secret|password/i.test(field) ? "password" : "text"} value={notificationRecipientForm.customConfig[field] ?? ""} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, customConfig: { ...current.customConfig, [field]: event.target.value } }))} />
                    </label>
                  ))
                  : (
                    <label>
                      <span>{t("settings.notificationWebhookUrl")}</span>
                      <input name="notification-recipient-webhook-url" className="search-input" value={notificationRecipientForm.webhookUrl} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, webhookUrl: event.target.value }))} />
                    </label>
                  )}
              </>
            )}
            {notificationRecipientForm.kind === "telegram" && (
              <>
                <label>
                  <span>{t("settings.notificationTelegramChatId")}</span>
                  <input name="notification-recipient-telegram-chat-id" className="search-input" value={notificationRecipientForm.telegramChatId} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, telegramChatId: event.target.value }))} />
                </label>
                {telegramNotificationSenders().length > 1 ? (
                  <label>
                    <span>{t("settings.notificationDefaultTelegramSender")}</span>
                    <select name="notification-recipient-telegram-sender" className="search-input" value={notificationRecipientForm.telegramSenderAccountId} onChange={(event) => setNotificationRecipientForm((current) => ({ ...current, telegramSenderAccountId: event.target.value }))}>
                      <option value="">{t("settings.notificationChooseSender")}</option>
                      {telegramNotificationSenders().map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <span className="subtle">{telegramNotificationSenders().length === 1 ? t("settings.notificationTelegramSenderAuto") : t("settings.notificationTelegramSenderMissing")}</span>
                )}
              </>
            )}
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "notification-recipient"}><IconText icon={notificationEditingRecipientId ? Save : Plus}>{notificationEditingRecipientId ? t("action.saveChanges") : t("settings.notificationAddRecipient")}</IconText></button>
              {notificationEditingRecipientId && <button className="ghost-button" type="button" onClick={resetNotificationRecipientForm}>{t("action.cancel")}</button>}
            </div>
          </form>
          <section className="notification-card">
            <strong>{t("settings.notificationRecipientList")}</strong>
            {(notificationSettings?.recipients ?? []).map((recipient) => (
              <div className="storage-item" key={recipient.id}>
                <div>
                  <strong>{recipient.name}</strong>
                  <span>{recipient.kind} · {recipient.enabled ? "enabled" : "disabled"} · {notificationPermissionSummary(recipient.permissions)}</span>
                </div>
                <div className="storage-actions">
                  <button className="ghost-button" type="button" onClick={() => editNotificationRecipient(recipient)}>{t("action.edit")}</button>
                  <button className="ghost-button" type="button" disabled={busy === `notification-recipient-test:${recipient.id}`} onClick={() => void testNotificationRecipient(recipient)}>{t("settings.notificationTest")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationRecipient(recipient)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {notificationSettings && !notificationSettings.recipients.length && <div className="empty-state">{t("settings.notificationNoRecipients")}</div>}
          </section>
            </>
          )}
          {notificationView === "rules" && (
            <>
          <form className="notification-card" onSubmit={createNotificationRule}>
            <strong>{t("settings.notificationRulesTitle")}</strong>
            <span>{t("settings.notificationRulesHelp")}</span>
            <label>
              <span>{t("settings.notificationRuleName")}</span>
              <input name="notification-rule-name" className="search-input" value={notificationRuleForm.name} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="checkbox-row">
              <input name="notification-rule-enabled" type="checkbox" checked={notificationRuleForm.enabled} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>{t("settings.notificationEnabled")}</span>
            </label>
            <label>
              <span>{t("settings.notificationEvents")}</span>
              <div className="notification-check-grid">
                {(["task_completed", "task_failed", "task_interrupted", "needs_approval", "task_health_issue", "provider_check_failed", "backup_failed", "restore_failed", "auth_login"] as NotificationEventType[]).map((type) => (
                  <label className="checkbox-row" key={type}>
                    <input name={`notification-rule-event-${type}`} type="checkbox" checked={notificationRuleForm.eventTypes.includes(type)} onChange={() => toggleNotificationEvent(type)} />
                    <span>{readableNotificationEvent(type, t)}</span>
                  </label>
                ))}
              </div>
            </label>
            <label>
              <span>{t("settings.notificationMinSeverity")}</span>
              <select name="notification-rule-min-severity" className="search-input" value={notificationRuleForm.minSeverity} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, minSeverity: event.target.value as NotificationSeverity }))}>
                {(["info", "success", "warning", "error"] as NotificationSeverity[]).map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </label>
            {emailNotificationSenders().length > 1 && (
              <label>
                <span>{t("settings.notificationEmailSenderOverride")}</span>
                <select name="notification-rule-email-sender-override" className="search-input" value={notificationRuleForm.senderAccountId} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, senderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationUseRecipientDefaultSender")}</option>
                  {emailNotificationSenders().map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            {telegramNotificationSenders().length > 1 && (
              <label>
                <span>{t("settings.notificationTelegramSenderOverride")}</span>
                <select name="notification-rule-telegram-sender-override" className="search-input" value={notificationRuleForm.telegramSenderAccountId} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, telegramSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationUseRecipientDefaultSender")}</option>
                  {telegramNotificationSenders().map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>{t("settings.notificationTargets")}</span>
              <div className="notification-check-grid">
                {(notificationSettings?.recipients ?? []).map((recipient) => (
                  <label className="checkbox-row" key={recipient.id}>
                    <input name={`notification-rule-recipient-${recipient.id}`} type="checkbox" checked={notificationRuleForm.recipientIds.includes(recipient.id)} onChange={() => toggleNotificationTarget(recipient.id)} />
                    <span>{recipient.name} · {recipient.kind}</span>
                  </label>
                ))}
              </div>
              {notificationSettings && !notificationSettings.recipients.length && <span className="subtle">{t("settings.notificationNoRecipients")}</span>}
            </label>
            <label>
              <span>{t("settings.notificationDedupeMinutes")}</span>
              <input name="notification-dedupe" className="search-input" type="number" min="0" value={notificationRuleForm.dedupeMinutes} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, dedupeMinutes: event.target.value }))} />
            </label>
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "notification-rule"}><IconText icon={notificationEditingRuleId ? Save : Plus}>{notificationEditingRuleId ? t("action.saveChanges") : t("settings.notificationAddRule")}</IconText></button>
              {notificationEditingRuleId && <button className="ghost-button" type="button" onClick={resetNotificationRuleForm}>{t("action.cancel")}</button>}
            </div>
          </form>
          <section className="notification-card">
            <div className="item-row">
              <strong>{t("settings.notificationRuleList")}</strong>
              <button className="ghost-button danger-button" type="button" disabled={busy === "notification-rules-clear" || !((notificationSettings?.rules.length ?? 0) + (notificationSettings?.ephemeralRules.length ?? 0))} onClick={() => void clearNotificationRules()}><IconText icon={Trash2}>{t("settings.notificationClearRules")}</IconText></button>
            </div>
            {(notificationSettings?.rules ?? []).map((rule) => (
              <div className="storage-item" key={rule.id}>
                <div>
                  <strong>{rule.name}</strong>
                  <span>{rule.enabled ? "enabled" : "disabled"} · {rule.eventTypes.join(", ")} · {rule.targets.length} targets</span>
                </div>
                <div className="storage-actions">
                  <button className="ghost-button" type="button" onClick={() => editNotificationRule(rule)}>{t("action.edit")}</button>
                  <button className="ghost-button" type="button" onClick={() => void toggleNotificationRule(rule)}>{rule.enabled ? t("automation.pause") : t("automation.resume")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationRule(rule)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {notificationSettings && !notificationSettings.rules.length && <div className="empty-state">{t("settings.notificationNoRules")}</div>}
            {notificationRuleCursor && (
              <div className="settings-actions">
                <button className="ghost-button" type="button" disabled={notificationRuleLoading} onClick={() => void loadMoreNotificationRules()}>{t("session.loadMore")}</button>
              </div>
            )}
          </section>
          <section className="notification-card">
            <strong>{t("settings.notificationEphemeralRuleList")}</strong>
            {(notificationSettings?.ephemeralRules ?? []).map((rule: NotificationEphemeralRuleSummary) => (
              <div className="storage-item" key={rule.id}>
                <div>
                  <strong>{rule.scopeType} · {rule.scopeId}</strong>
                  <span>{rule.enabled ? "enabled" : "disabled"} · {rule.eventTypes.join(", ")} · {rule.targets.map((target) => notificationSettings?.recipients.find((recipient) => recipient.id === target.recipientId)?.name ?? target.recipientId ?? target.accountId).filter(Boolean).join(", ")}</span>
                  <span>{rule.expireMode} · {formatShortDate(rule.createdAt)}{rule.triggeredAt ? ` · triggered ${formatShortDate(rule.triggeredAt)}` : ""}</span>
                </div>
                <div className="storage-actions">
                  <button className="ghost-button danger-button" type="button" disabled={busy === `notification-ephemeral-rule-delete:${rule.id}`} onClick={() => void deleteNotificationEphemeralRule(rule)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {notificationSettings && !notificationSettings.ephemeralRules.length && <div className="empty-state">{t("settings.notificationNoEphemeralRules")}</div>}
            {notificationEphemeralRuleCursor && (
              <div className="settings-actions">
                <button className="ghost-button" type="button" disabled={notificationEphemeralRuleLoading} onClick={() => void loadMoreNotificationEphemeralRules()}>{t("session.loadMore")}</button>
              </div>
            )}
          </section>
            </>
          )}
          {notificationView === "logs" && (
          <section className="notification-card">
            <div className="item-row">
              <strong>{t("settings.notificationDeliveriesTitle")}</strong>
              <button className="ghost-button danger-button" type="button" disabled={busy === "notification-deliveries-clear" || !(notificationSettings?.recentDeliveries.length ?? 0)} onClick={() => void clearNotificationDeliveries()}><IconText icon={Trash2}>{t("settings.notificationClearDeliveries")}</IconText></button>
            </div>
            <div className="filter-toolbar compact-filter-toolbar">
              <select name="notification-delivery-event-filter" className="filter-select" value={notificationDeliveryEventFilter} onChange={(event) => setNotificationDeliveryEventFilter(event.target.value)}>
                <option value="">{t("settings.notificationEvents")}</option>
                {(["task_completed", "task_failed", "task_interrupted", "needs_approval", "task_health_issue", "provider_check_failed", "backup_failed", "restore_failed", "auth_login"] as NotificationEventType[]).map((type) => (
                  <option key={type} value={type}>{readableNotificationEvent(type, t)}</option>
                ))}
              </select>
              <select name="notification-delivery-status-filter" className="filter-select" value={notificationDeliveryStatusFilter} onChange={(event) => setNotificationDeliveryStatusFilter(event.target.value)}>
                <option value="">{t("session.allStatuses")}</option>
                {(["pending", "sent", "failed", "skipped"] as NotificationDeliverySummary["status"][]).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <select name="notification-delivery-severity-filter" className="filter-select" value={notificationDeliverySeverityFilter} onChange={(event) => setNotificationDeliverySeverityFilter(event.target.value)}>
                <option value="">{t("settings.notificationMinSeverity")}</option>
                {(["info", "success", "warning", "error"] as NotificationSeverity[]).map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </div>
            {(notificationSettings?.recentDeliveries ?? []).map((delivery: NotificationDeliverySummary) => {
              const detail = notificationDeliveryMetadata(delivery);
              return (
              <div className="storage-item notification-delivery-item" key={delivery.id}>
                <div>
                  <strong>{delivery.title}</strong>
                  <span>{delivery.eventType} · {delivery.severity} · {delivery.status} · {formatShortDate(delivery.createdAt)}</span>
                  <span>{delivery.message}</span>
                  <div className="notification-delivery-details">
                    <span>{t("settings.notificationDeliveryTarget")}：{detail.targetName} · {detail.targetKind}</span>
                    <span>{t("settings.notificationDeliverySender")}：{detail.accountName}</span>
                    <span>{t("settings.notificationDeliveryAttempts")}：{detail.attempts}</span>
                    <span>{t("settings.notificationDeliveryResponse")}：{detail.responseStatus}</span>
                    <span>{t("settings.notificationDeliverySentAt")}：{detail.sentAt}</span>
                    {detail.emailToCount > 0 && <span>{t("settings.notificationDeliveryEmailCount")}：{detail.emailToCount}</span>}
                    {detail.chatConfigured && <span>{t("settings.notificationDeliveryChatConfigured")}</span>}
                  </div>
                  {delivery.lastError && <span className="result-error">{delivery.lastError}</span>}
                </div>
                <div className="storage-actions">
                  {delivery.status === "failed" && (
                    <button className="ghost-button" type="button" disabled={busy === `notification-delivery-retry:${delivery.id}`} onClick={() => void retryNotificationDelivery(delivery)}>
                      <IconText icon={RefreshCw}>{t("settings.notificationRetry")}</IconText>
                    </button>
                  )}
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationDelivery(delivery)}>{t("action.delete")}</button>
                </div>
              </div>
              );
            })}
            {notificationSettings && !notificationSettings.recentDeliveries.length && <div className="empty-state">{t("settings.notificationNoDeliveries")}</div>}
            {notificationDeliveryCursor && (
              <div className="settings-actions">
                <button className="ghost-button" type="button" disabled={notificationDeliveryLoading} onClick={() => void loadMoreNotificationDeliveries()}>{t("session.loadMore")}</button>
              </div>
            )}
          </section>
          )}
        </TabsContent>
        <TabsContent className="settings-list" value="maintenance">
          <section className="provider-card">
          <strong>{t("settings.maintenanceTitle")}</strong>
          <span>{t("settings.maintenanceHelp")}</span>
          <label className="checkbox-row">
            <input name="cleanuparchivedapprovals" type="checkbox" checked={cleanupArchivedApprovals} onChange={(event) => setCleanupArchivedApprovals(event.target.checked)} />
            <span>{t("settings.cleanupArchivedApprovals")}</span>
          </label>
          <label>
            <span>{t("settings.cleanupArchivedApprovalDays")}</span>
            <input name="cleanuparchivedapprovaldays" className="search-input" type="number" min={0} max={3650} value={cleanupArchivedApprovalDays} onChange={(event) => setCleanupArchivedApprovalDays(Number(event.target.value))} disabled={!cleanupArchivedApprovals} />
          </label>
          <label className="checkbox-row">
            <input name="cleanupapprovalauditlog" type="checkbox" checked={cleanupApprovalAuditLog} onChange={(event) => setCleanupApprovalAuditLog(event.target.checked)} />
            <span>{t("settings.cleanupApprovalAuditLog")}</span>
          </label>
          <span>{t("settings.cleanupApprovalAuditLogHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "cleanup"} onClick={() => void cleanupMaintenance()}><IconText icon={Trash2}>{t("settings.cleanupDatabase")}</IconText></button>
            <button className="ghost-button" type="button" disabled={busy === "approval-reset"} onClick={() => void resetApprovals()}><IconText icon={ShieldCheck}>{t("settings.resetApprovals")}</IconText></button>
          </div>
          {cleanupMessage && <span className={cleanupMessage === t("settings.cleanupFailed") || cleanupMessage === t("settings.resetApprovalsFailed") ? "result-error" : "result-ok"}>{cleanupMessage}</span>}
          </section>
          <section className="provider-card">
          <strong>{t("settings.taskHealthTitle")}</strong>
          <span>{t("settings.taskHealthHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "task-health"} onClick={() => void loadTaskHealth()}><IconText icon={Activity}>{t("settings.checkTaskHealth")}</IconText></button>
            <button className="ghost-button danger-button" type="button" disabled={busy === "task-health-repair" || !taskHealth?.items.some((item) => item.issue)} onClick={() => void repairTaskHealth()}><IconText icon={RefreshCw}>{t("settings.repairTaskHealth")}</IconText></button>
            {taskHealth && <span className={taskHealth.ok ? "result-ok" : "result-error"}>{taskHealth.ok ? t("settings.taskHealthOk") : t("settings.taskHealthIssues")}</span>}
          </div>
          {taskHealth && !taskHealth.items.length && <div className="empty-state">{t("settings.taskHealthEmpty")}</div>}
          {taskHealth && taskHealth.items.length > 0 && (
            <div className="storage-list">
              {taskHealth.items.map((item) => (
                <div className="storage-item" key={`${item.sessionId}:${item.runId ?? ""}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.sessionId}</span>
                    <span>runner {item.pid ?? "-"} · {item.pidAlive ? t("settings.taskHealthAlive") : t("settings.taskHealthMissing")} · log {formatBytes(item.logBytes)}</span>
                    {item.childPid && <span>codex {item.childPid} · {item.childPidAlive ? t("settings.taskHealthAlive") : t("settings.taskHealthMissing")}</span>}
                  </div>
                  <div className="storage-actions">
                    <span className={`pill ${item.issue ? "warm" : ""}`}>{item.issue ?? t("settings.taskHealthHealthy")}</span>
                    <button className="ghost-button" type="button" onClick={() => onOpenSession(item.sessionId)}>{t("nav.sessions")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="storage">
          <section className="provider-card">
          <strong>{t("settings.storageTitle")}</strong>
          <span>{t("settings.storageHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "storage-scan"} onClick={() => void scanStorage()}><IconText icon={FolderOpen}>{t("settings.scanStorage")}</IconText></button>
            {storageScan && (
              <>
                <button className="ghost-button" type="button" disabled={!visibleStorageItems.length} onClick={() => setSelectedStorageIds(allVisibleStorageSelected ? selectedStorageIds.filter((id) => !visibleStorageIds.includes(id)) : Array.from(new Set([...selectedStorageIds, ...visibleStorageIds])))}>{allVisibleStorageSelected ? t("settings.storageUnselectVisible") : t("settings.storageSelectVisible")}</button>
                <button className="ghost-button danger-button" type="button" disabled={!selectedStorageIds.length || busy === "storage-delete-selected"} onClick={() => void deleteSelectedStorageItems()}><IconText icon={Trash2}>{t("settings.storageDeleteSelected").replace("{count}", String(selectedStorageIds.length))}</IconText></button>
                <button className="ghost-button danger-button" type="button" disabled={!orphanStorageItems.length || busy === "storage-delete-orphans"} onClick={() => void deleteOrphanStorageItems()}><IconText icon={Trash2}>{t("settings.storageDeleteOrphans").replace("{count}", String(orphanStorageItems.length))}</IconText></button>
              </>
            )}
            {storageScan && <span className="subtle">{t("settings.storageTotal")}: {formatBytes(storageScan.totalBytes)} · {t("settings.storageActive")} {activeStorageItems.length} · {t("settings.storageOrphan")} {orphanStorageItems.length}</span>}
          </div>
          {storageScan && <span className="subtle">{t("settings.storageOrphanHelp")}</span>}
          {storageScan && (
            <div className="project-list-filters">
              <input name="storagesearch" value={storageSearch} onChange={(event) => setStorageSearch(event.target.value)} placeholder={t("settings.storageSearch")} />
              <select name="storagestatusfilter" value={storageStatusFilter} onChange={(event) => setStorageStatusFilter(event.target.value)}>
                <option value="">{t("session.allStatuses")}</option>
                <option value="active">{t("settings.storageActive")}</option>
                <option value="orphan">{t("settings.storageOrphan")}</option>
              </select>
              <select name="storagesort" value={storageSort} onChange={(event) => setStorageSort(event.target.value as typeof storageSort)}>
                <option value="bytes">{t("settings.storageSortSize")}</option>
                <option value="updated">{t("settings.storageSortUpdated")}</option>
                <option value="type">{t("settings.storageSortType")}</option>
              </select>
            </div>
          )}
          {storageScan && !storageScan.items.length && <div className="empty-state">{t("settings.storageEmpty")}</div>}
          {storageScan && storageScan.items.length > 0 && (
            <div className="storage-list">
              {visibleStorageItems.map((item) => (
                <div className="storage-item" key={item.id}>
                  <div>
                    <strong><input name={`storage-${item.id}`} type="checkbox" checked={selectedStorageIds.includes(item.id)} onChange={() => setSelectedStorageIds((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])} /> {item.label}</strong>
                    {item.relatedName && (
                      <span>{t(`settings.storageRelated${item.relatedType === "project" ? "Project" : item.relatedType === "room" ? "Room" : item.relatedType === "run" ? "Run" : item.relatedType === "preview" ? "Preview" : "Session"}`)}: {item.relatedName}</span>
                    )}
                    <span>{readableStorageItemType(item.type, t)} · {formatBytes(item.bytes)} · {formatShortDate(item.updatedAt)}</span>
                    <code>{item.path}</code>
                  </div>
                  <div className="storage-actions">
                    <span className={`pill ${item.status === "orphan" ? "warm" : ""}`}>{item.status === "orphan" ? t("settings.storageOrphan") : t("settings.storageActive")}</span>
                    <button className="ghost-button icon-only" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyStoragePath(item)}><IconText icon={Copy}>{t("action.copy")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `storage-delete:${item.id}`} title={t("settings.storageDelete")} aria-label={t("settings.storageDelete")} onClick={() => void deleteStorageItem(item)}><IconText icon={Trash2}>{t("settings.storageDelete")}</IconText></button>
                  </div>
                </div>
              ))}
              {!visibleStorageItems.length && <div className="empty-state">{t("settings.storageEmpty")}</div>}
            </div>
          )}
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="backup">
          <section className="provider-card">
            <strong>{t("settings.backupTitle")}</strong>
            <span>{t("settings.backupHelp")}</span>
            <div className="settings-actions">
              <button className="ghost-button" type="button" disabled={busy === "backup-settings"} onClick={() => void editBackupIgnoreRules()}><IconText icon={Info}>{t("settings.editBackupIgnore")}</IconText></button>
              <button className="ghost-button" type="button" disabled={busy === "backup-preview"} onClick={() => backupPreview ? setBackupPreview(null) : void loadBackupPreview()}><IconText icon={Files}>{backupPreview ? t("settings.backupHidePreview") : t("settings.backupPreview")}</IconText></button>
              <button className="ghost-button" type="button" disabled={busy === "backup-download"} onClick={() => void downloadSystemBackup()}><IconText icon={Download}>{t("settings.backupDownload")}</IconText></button>
            </div>
            {backupSettings && <span className="subtle">{t("settings.backupIgnoreUpdated").replace("{time}", formatShortDate(backupSettings.updatedAt))}</span>}
            <div className="backup-scope-grid">
              <div>
                <strong>{t("settings.backupIncluded")}</strong>
                <ul>
                  {(backupPreview?.manifest.included ?? [t("settings.backupIncludedDefault")]).map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}
                </ul>
              </div>
              <div>
                <strong>{t("settings.backupExcluded")}</strong>
                <ul>
                  {(backupPreview?.manifest.excluded ?? [t("settings.backupExcludedDefault")]).map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}
                </ul>
              </div>
            </div>
            {backupPreview && (
              <>
                <span className="result-ok">{t("settings.backupPreviewStats").replace("{entries}", String(backupPreview.entries)).replace("{size}", formatBytes(backupPreview.bytes))}</span>
                <div className="storage-list">
                  {backupPreview.manifest.projects.length ? backupPreview.manifest.projects.map((project) => (
                    <div className="storage-item" key={project.id}>
                      <div>
                        <strong>{project.name}</strong>
                        <span>{project.exists ? t("settings.projectPathExists") : t("settings.projectPathMissing")} · {t("settings.projectSourceExcluded")}</span>
                        <code>{project.workspacePath}</code>
                        {(project.gitBranch || project.gitCommit || project.gitRemote) && <span>{[project.gitBranch, project.gitCommit?.slice(0, 8), project.gitDirty ? t("settings.gitDirty") : null].filter(Boolean).join(" · ")}</span>}
                      </div>
                      <span className="pill warm">{t("settings.notIncluded")}</span>
                    </div>
                  )) : <div className="empty-state">{t("settings.noProjectReferences")}</div>}
                </div>
                {backupPreview.manifest.warnings.map((warning) => <span className="result-error" key={warning}>{readableBackupManifestText(warning, t)}</span>)}
              </>
            )}
          </section>
          <section className="provider-card">
            <strong>{t("settings.restoreTitle")}</strong>
            <span>{t("settings.restoreHelp")}</span>
            <div className="restore-file-picker">
              <input ref={restoreFileInputRef} className="restore-file-native" type="file" accept=".zip,application/zip" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void previewRestoreBackup(file);
              }} />
              <button className="ghost-button" type="button" onClick={() => {
                if (restoreFileInputRef.current) restoreFileInputRef.current.value = "";
                restoreFileInputRef.current?.click();
              }}>{t("settings.restoreChooseFile")}</button>
              <span className="subtle">{restoreFile?.name ?? t("settings.restoreNoFileSelected")}</span>
            </div>
            {restorePreview && (
              <>
                <span className="result-ok">{t("settings.restorePreviewStats").replace("{entries}", String(restorePreview.entries)).replace("{size}", formatBytes(restorePreview.bytes))}</span>
                <div className="backup-scope-grid">
                  <div>
                    <strong>{t("settings.backupIncluded")}</strong>
                    <ul>{restorePreview.manifest.included.map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}</ul>
                  </div>
                  <div>
                    <strong>{t("settings.backupExcluded")}</strong>
                    <ul>{restorePreview.manifest.excluded.map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}</ul>
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="ghost-button danger-button" type="button" disabled={busy === "restore-apply"} onClick={() => void restoreSystemBackup()}><IconText icon={RotateCcw}>{t("settings.restoreApply")}</IconText></button>
                </div>
                {restorePreview.manifest.warnings.map((warning) => <span className="result-error" key={warning}>{readableBackupManifestText(warning, t)}</span>)}
              </>
            )}
            {restoreMessage && <span className={restoreMessage === t("settings.restoreFailed") ? "result-error" : "result-ok"}>{restoreMessage}</span>}
          </section>
        </TabsContent>
      </Tabs>
      {notificationChannelManagerOpen && (
        <div className="dialog-layer" role="presentation">
          <div className="dialog-backdrop" onClick={() => { resetNotificationChannelForm(); setNotificationChannelManagerOpen(false); }} />
          <section className="dialog-card notification-channel-dialog" role="dialog" aria-modal="true" aria-label={t("settings.notificationManageChannels")}>
            <div className="dialog-head">
              <div>
                <strong>{t("settings.notificationManageChannels")}</strong>
                <p>{t("settings.notificationChannelsHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => { resetNotificationChannelForm(); setNotificationChannelManagerOpen(false); }} aria-label={t("action.close")}><X size={18} /></button>
            </div>
            <form className="settings-list" onSubmit={createNotificationChannel}>
              {notificationEditingChannelId && (
                <span className="subtle">
                  {(notificationSettings?.channels.find((channel) => channel.id === notificationEditingChannelId)?.builtin)
                    ? t("settings.notificationBuiltinChannelReadonly")
                    : t("settings.notificationEditingChannel")}
                </span>
              )}
              <label>
                <span>{t("settings.notificationChannelName")}</span>
                <input name="notification-channel-name" value={notificationChannelForm.name} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, name: event.target.value }))} required disabled={Boolean(notificationSettings?.channels.find((channel) => channel.id === notificationEditingChannelId)?.builtin)} />
              </label>
              <label>
                <span>{t("settings.notificationChannelDescription")}</span>
                <input name="notification-channel-description" value={notificationChannelForm.description} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                <span>{t("settings.notificationChannelAdapter")}</span>
                <select name="notification-channel-adapter" value={notificationChannelForm.adapter} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, adapter: event.target.value }))}>
                  <option value="webhook">{t("settings.notificationChannelAdapterWebhook")}</option>
                  <option value="authenticated_webhook">{t("settings.notificationChannelAdapterAuthenticatedWebhook")}</option>
                </select>
              </label>
              <label>
                <span>{t("settings.notificationChannelAuthType")}</span>
                <select name="notification-channel-auth-type" value={notificationChannelForm.authType} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, authType: event.target.value }))}>
                  <option value="none">{t("settings.notificationChannelAuthNone")}</option>
                  <option value="bearer">{t("settings.notificationChannelAuthBearer")}</option>
                  <option value="query_token">{t("settings.notificationChannelAuthQueryToken")}</option>
                  <option value="token_request">{t("settings.notificationChannelAuthTokenRequest")}</option>
                </select>
              </label>
              <label>
                <span>{t("settings.notificationWebhookMethod")}</span>
                <select name="notification-channel-method" value={notificationChannelForm.method} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, method: event.target.value }))}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </label>
              <label>
                <span>{t("settings.notificationChannelUrlTemplate")}</span>
                <input name="notification-channel-url-template" value={notificationChannelForm.urlTemplate} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, urlTemplate: event.target.value }))} placeholder="https://example.com/{{token}}" required />
              </label>
              <label>
                <span>{t("settings.notificationChannelFields")}</span>
                <input name="notification-channel-account-fields" value={notificationChannelForm.accountFields} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, accountFields: event.target.value }))} placeholder="serverUrl,deviceKey,group" />
              </label>
              <label>
                <span>{t("settings.notificationWebhookHeaders")}</span>
                <textarea name="notification-channel-headers-template" rows={3} value={notificationChannelForm.headersTemplate} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, headersTemplate: event.target.value }))} />
              </label>
              <label>
                <span>{t("settings.notificationWebhookTemplate")}</span>
                <textarea name="notification-channel-body-template" rows={5} value={notificationChannelForm.bodyTemplate} onChange={(event) => setNotificationChannelForm((current) => ({ ...current, bodyTemplate: event.target.value }))} />
              </label>
              <div className="dialog-actions">
                <button className="ghost-button" type="button" onClick={notificationEditingChannelId ? resetNotificationChannelForm : () => { resetNotificationChannelForm(); setNotificationChannelManagerOpen(false); }}>{t("action.cancel")}</button>
                <button className="dark-button" type="submit" disabled={busy === "notification-channel" || Boolean(notificationSettings?.channels.find((channel) => channel.id === notificationEditingChannelId)?.builtin)}>
                  {notificationEditingChannelId ? t("action.saveChanges") : t("settings.notificationAddChannel")}
                </button>
              </div>
            </form>
            <div className="storage-list">
              {(notificationSettings?.channels ?? []).filter((channel) => channel.kind === "webhook").map((channel) => (
                <div className="storage-item" key={channel.id}>
                  <div>
                    <strong>{channel.name}</strong>
                    <span>{channel.builtin ? t("settings.notificationBuiltinChannel") : t("settings.notificationCustomChannel")} · {channel.adapter ?? "webhook"} · {channel.authType ?? "none"} · {channel.accountFields?.join(", ") || "-"}</span>
                  </div>
                  <div className="storage-actions">
                    <button className="ghost-button" type="button" onClick={() => editNotificationChannel(channel)}>{t("action.edit")}</button>
                    {!channel.builtin && (
                      <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationChannel(channel)}>{t("action.delete")}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {environmentPackagePanel && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setEnvironmentPackagePanel(null)} />
          <section className="dialog-card environment-package-dialog" role="dialog" aria-modal="true" aria-label={t("settings.environmentPackageManage")}>
            <div className="dialog-head">
              <div>
                <strong>{t("settings.environmentPackageManage")}</strong>
                <p>{`${environmentPackagePanel.toolRecord.tool}@${environmentPackagePanel.toolRecord.requestedVersion}`}</p>
                <p>{t("settings.environmentPackageSupportHint")}</p>
                {environmentPackagePanel.toolRecord.tool === "python" && <p>{t("settings.environmentPythonPackageHint")}</p>}
              </div>
              <div className="dialog-head-actions">
                <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={() => setEnvironmentPackagePanel(null)}><X size={16} /></button>
              </div>
            </div>
            <form className="environment-package-form" onSubmit={installEnvironmentPackage}>
              <label>
                <span>{t("settings.environmentPackageManager")}</span>
                <select value={environmentPackageForm.manager} onChange={(event) => {
                  const manager = event.target.value;
                  setEnvironmentPackageForm((current) => ({ ...current, manager }));
                  setEnvironmentPackageProbe(environmentPackagePanel.packages.some((pkg) => pkg.packageName.toLowerCase() === environmentPackageForm.packageName.trim().toLowerCase() && pkg.manager === manager)
                    ? { installed: true, manager, packageName: environmentPackageForm.packageName.trim(), checked: false }
                    : null);
                }} required>
                  <option value="">{t("settings.environmentPackageManagerPlaceholder")}</option>
                  {environmentPackagePanel.managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>{manager.label}{manager.detectedVersion ? ` · ${manager.detectedVersion} · ${t("settings.environmentPackageManagerRecommended")}` : ""}</option>
                  ))}
                </select>
              </label>
              {selectedEnvironmentPackageManager && (
                <div className="environment-package-manager-hint">
                  <span className="pill">{selectedEnvironmentPackageManager.label}</span>
                  {selectedEnvironmentPackageManager.detectedVersion && <span className="pill">{`${t("settings.environmentDetectedVersion")} ${selectedEnvironmentPackageManager.detectedVersion}`}</span>}
                  <span className="subtle">{selectedEnvironmentPackageManager.installCommandExample}</span>
                  {environmentPackagePanel.toolRecord.tool === "python" && selectedEnvironmentPackageManager.id === "pip" && <span className="subtle">{t("settings.environmentPythonPipHint")}</span>}
                  {environmentPackagePanel.toolRecord.tool === "python" && selectedEnvironmentPackageManager.id === "uv" && <span className="subtle">{t("settings.environmentPythonUvToolHint")}</span>}
                </div>
              )}
              <div className="environment-package-name-row">
                <label>
                  <span>{t("settings.environmentPackageName")}</span>
                  <input value={environmentPackageForm.packageName} onChange={(event) => {
                    const value = event.target.value;
                    setEnvironmentPackageForm((current) => ({ ...current, packageName: value }));
                    setEnvironmentPackageProbe(environmentPackagePanel.packages.some((pkg) => pkg.packageName.toLowerCase() === value.trim().toLowerCase() && pkg.manager === environmentPackageForm.manager)
                      ? { installed: true, manager: environmentPackageForm.manager, packageName: value.trim(), checked: false }
                      : null);
                  }} placeholder={t("settings.environmentPackageNamePlaceholder")} required />
                </label>
                <button className="ghost-button" type="button" disabled={busy === "environment-package-probe" || !environmentPackageForm.manager || !environmentPackageForm.packageName.trim()} onClick={() => void probeEnvironmentPackage()}>
                  <IconText icon={busy === "environment-package-probe" ? RefreshCw : Search}>{busy === "environment-package-probe" ? t("settings.environmentPackageChecking") : t("settings.environmentPackageCheck")}</IconText>
                </button>
              </div>
              {normalizedEnvironmentPackageName && (
                <div className="environment-package-inline-state">
                  {environmentPackageAlreadyTracked
                    ? <span className="pill">{t("settings.environmentPackageAlreadyTracked")}</span>
                    : environmentPackageProbe?.installed
                      ? <span className="pill">{t("settings.environmentPackageDetected")}</span>
                      : environmentPackageProbe?.checked
                        ? <span className="subtle">{t("settings.environmentPackageNotDetected")}</span>
                        : <span className="subtle">{t("settings.environmentPackageWillInstall")}</span>}
                  {environmentPackageProbe?.installed && environmentPackageProbe.version && <span className="pill">{environmentPackageProbe.version}</span>}
                </div>
              )}
              <label>
                <span>{t("settings.environmentPackageVersion")}</span>
                <input value={environmentPackageForm.versionSpec} onChange={(event) => setEnvironmentPackageForm((current) => ({ ...current, versionSpec: event.target.value }))} placeholder={t("settings.environmentPackageVersionPlaceholder")} />
              </label>
              <label>
                <span>{t("settings.environmentNotes")}</span>
                <input value={environmentPackageForm.notes} onChange={(event) => setEnvironmentPackageForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("settings.environmentNotesPlaceholder")} />
              </label>
              <div className="dialog-actions">
                <button className="ghost-button" type="submit" disabled={busy === "environment-package-install" || !environmentPackageForm.manager}><IconText icon={Plus}>{environmentPackageProbe?.installed ? t("settings.environmentPackageRecord") : t("settings.environmentPackageInstall")}</IconText></button>
                <button className="ghost-button" type="button" disabled={busy === "environment-bulk:record_detected_packages"} onClick={() => void runEnvironmentBulkAction({ action: "record_detected_packages", toolRecordId: environmentPackagePanel.toolRecord.id })}>{t("settings.environmentBulkRecordDetected")}</button>
                <button className="ghost-button" type="button" disabled={busy === "environment-bulk:install_missing_packages"} onClick={() => void runEnvironmentBulkAction({ action: "install_missing_packages", toolRecordId: environmentPackagePanel.toolRecord.id })}>{t("settings.environmentBulkInstallMissing")}</button>
              </div>
            </form>
            <div className="environment-package-list">
              <div className="environment-card-head">
                <div>
                  <strong>{t("settings.environmentRestorePreviewTitle")}</strong>
                  <span>{t("settings.environmentRestorePreviewHelp")}</span>
                </div>
              </div>
              {!environmentPackagePanel.restorePreview.length && <div className="empty-state">{t("settings.environmentPreviewEmpty")}</div>}
              {environmentPackagePanel.restorePreview.map((item) => (
                <article className="environment-item" key={item.id}>
                  <div className="environment-item-main">
                    <div className="environment-item-head">
                      <strong>{item.title}</strong>
                      <span className={`pill ${item.action === "manual" ? "warm" : ""}`}>
                        {item.action === "install" ? t("settings.environmentActionInstall")
                          : item.action === "record" ? t("settings.environmentActionRecord")
                            : item.action === "manual" ? t("settings.environmentActionManual")
                              : t("settings.environmentActionSkip")}
                      </span>
                    </div>
                    <span>{item.detail}</span>
                    {item.command && <code>{item.command}</code>}
                  </div>
                </article>
              ))}
            </div>
            <div className="environment-package-list">
              {!environmentPackagePanel.packages.length && <div className="empty-state">{t("settings.environmentPackageEmpty")}</div>}
              {Boolean(environmentPackagePanel.packages.length) && !filteredEnvironmentPackages.length && <div className="empty-state">{t("settings.environmentPackageFilterEmpty")}</div>}
              {filteredEnvironmentPackages.map((pkg) => (
                <article className="environment-item" key={pkg.id}>
                  <div className="environment-item-main">
                    <div className="environment-item-head">
                      <strong>{pkg.packageName}</strong>
                      <div className="provider-card-actions">
                        <span className={`pill ${pkg.status === "failed" ? "warm" : ""}`}>{pkg.manager}</span>
                        <span className="pill">{pkg.persisted ? t("settings.environmentPackageRecorded") : t("settings.environmentPackageDetected")}</span>
                      </div>
                    </div>
                    <span>{pkg.installedVersion ?? pkg.versionSpec ?? t("settings.environmentMissingVersion")}</span>
                    <span>{pkg.targetLabel}</span>
                    {pkg.notes && <span>{pkg.notes}</span>}
                  </div>
                  <div className="storage-actions">
                    <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-package-delete:${pkg.id}` || environmentPackageNeedsManualCleanup(pkg)} title={environmentPackageNeedsManualCleanup(pkg) ? t("settings.environmentPackageManualCleanup") : t("settings.environmentPackageUninstall")} aria-label={environmentPackageNeedsManualCleanup(pkg) ? t("settings.environmentPackageManualCleanup") : t("settings.environmentPackageUninstall")} onClick={() => void uninstallEnvironmentPackage(pkg)}><IconText icon={Trash2}>{environmentPackageNeedsManualCleanup(pkg) ? t("settings.environmentPackageManualCleanup") : t("settings.environmentPackageUninstall")}</IconText></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {dialog.node}
    </main>
  );
}

function AuthPage({
  auth,
  locale,
  t,
  onLocaleChange,
  onLogin,
  notify,
}: {
  auth: AuthState;
  locale: Locale;
  t: TFunction;
  onLocaleChange: (locale: Locale) => void;
  onLogin: (token: string, auth: AuthState) => void | Promise<void>;
  notify: (message: string, tone?: ToastTone) => void;
}) {
  const [setup, setSetup] = useState<SetupStartResponse | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [confirmAccessToken, setConfirmAccessToken] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  function showAuthError(value: string) {
    setError(value);
    notify(value, "error");
  }

  useEffect(() => {
    if (!auth.setupRequired) return;
    fetch("/api/auth/setup/start", { method: "POST" })
      .then((response) => response.json())
      .then((nextSetup: SetupStartResponse) => setSetup(nextSetup))
      .catch(() => showAuthError(t("settings.otpResetFailed")));
  }, [auth.setupRequired]);

  useEffect(() => {
    if (!setup?.otpauthUrl) return;
    QRCode.toDataURL(setup.otpauthUrl, {
      margin: 1,
      width: 192,
      color: {
        dark: "#191d1b",
        light: "#ffffff",
      },
    })
      .then(setQrCode)
      .catch(() => showAuthError(t("settings.otpResetFailed")));
  }, [setup?.otpauthUrl]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (auth.setupRequired && accessToken !== confirmAccessToken) {
      showAuthError(t("auth.tokenMismatch"));
      return;
    }
    const response = await fetch(auth.setupRequired ? "/api/auth/setup/complete" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken, otp }),
    });
    const result = (await response.json()) as LoginResponse;
    if (!response.ok || !result.ok || !result.sessionToken) {
      showAuthError(result.error ?? t("auth.loginFailed"));
      return;
    }
    await onLogin(result.sessionToken, result.auth);
  }

  async function copyOtpSecret() {
    if (!setup?.otpSecret) return;
    const copied = await copyText(setup.otpSecret);
    setCopyMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    window.setTimeout(() => setCopyMessage(""), 1600);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-heading">
          <div className="crumb">Codex Web</div>
          <h1>{auth.setupRequired ? t("auth.firstSetup") : t("auth.login")}</h1>
          <LanguageSelect locale={locale} onChange={onLocaleChange} />
        </div>
      <form className="auth-card" onSubmit={login}>
        {auth.setupRequired && (
          <div>
            <strong>{t("auth.otpSecret")}</strong>
            {qrCode && <img className="otp-qr" src={qrCode} alt={t("auth.otpQrAlt")} />}
            <div className="secret-row">
              <code className="secret-box">{setup?.otpSecret ?? t("auth.generating")}</code>
              <button className="ghost-button" type="button" onClick={copyOtpSecret} disabled={!setup?.otpSecret}>{t("action.copy")}</button>
            </div>
            {copyMessage && <span className="subtle">{copyMessage}</span>}
            <span className="subtle">{t("auth.otpHelp")}</span>
          </div>
        )}
        <div><strong>{auth.setupRequired ? t("auth.setupToken") : t("auth.accessToken")}</strong><input name="accesstoken-2" className="search-input" type="password" autoComplete="current-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("auth.tokenPlaceholder")} /></div>
        {auth.setupRequired && (
          <div><strong>{t("auth.confirmToken")}</strong><input name="confirmaccesstoken-2" className="search-input" type="password" autoComplete="new-password" value={confirmAccessToken} onChange={(event) => setConfirmAccessToken(event.target.value)} placeholder={t("auth.confirmTokenPlaceholder")} /></div>
        )}
        <div><strong>{t("auth.otp")}</strong><input name="otp" className="search-input" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder={t("auth.otpPlaceholder")} /></div>
        {error && <div className="auth-error">{error}</div>}
        <button className="dark-button">{auth.setupRequired ? t("action.setup") : t("action.login")}</button>
      </form>
      </section>
    </main>
  );
}

function PageHeader({
  crumb,
  title,
  action,
  onAction,
  onOpenMainNav,
  menuLabel,
}: {
  crumb: string;
  title: string;
  action?: string;
  onAction?: () => void;
  onOpenMainNav?: () => void;
  menuLabel?: string;
}) {
  const notificationCenter = React.useContext(NotificationCenterContext);
  return (
    <header className="page-header">
      <div className="header-title-row">
        <MobileMainToggle label={menuLabel ?? title} onClick={onOpenMainNav} />
        <div>
          <div className="crumb">{crumb}</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="header-actions page-header-actions">
        {notificationCenter}
        {action && <button className="dark-button icon-only" title={action} aria-label={action} onClick={onAction}><IconText icon={RefreshCw}>{action}</IconText></button>}
      </div>
    </header>
  );
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
