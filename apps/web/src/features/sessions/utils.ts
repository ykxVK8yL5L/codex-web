import type {
  AgentListenMode,
  AgentSummary,
  FileEntry,
  GoalFocusStatus,
  GoalMode,
  GoalStatus,
  NotificationEventType,
  PermissionProfileId,
  ProjectSummary,
  RoomArtifactSummary,
  RoomDecisionSummary,
  RoomHandoffSummary,
  SessionMessage,
  SessionSummary,
  StorageItemSummary,
  TaskActivitySummary,
  TaskRunSummary,
  UploadAttachmentInput,
} from "@codex-web/protocol";
import { formatBytes } from "@/lib/format";
import { taskActivityChangedEvent, workspaceChangedEvent } from "@/lib/events";
import type { TranslationKey } from "@/lib/i18n";

export type TFunction = (key: TranslationKey) => string;
export type ComposerFileReference = {
  id: string;
  name: string;
  path: string;
  absolutePath: string;
  kind: FileEntry["kind"];
  sourceLabel: string;
};

export type ActivityItem = {
  type: "activity";
  id?: string;
  kind: "command" | "file" | "tool";
  label: string;
  detail?: string;
  status?: string;
  at: string;
};

export const listenModeOptions: AgentListenMode[] = ["none", "passive", "active", "orchestrator"];

export function localStorageStringSet(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

export function readableStatus(status: SessionSummary["status"] | undefined, t: TFunction) {
  if (status === "running") return t("session.statusRunning");
  if (status === "done") return t("session.statusDone");
  if (status === "paused") return t("session.statusPaused");
  if (status === "interrupted") return t("session.statusInterrupted");
  return t("session.statusReady");
}

export function readableSessionType(session: SessionSummary | undefined, t: TFunction) {
  if (session?.conversationType === "room") return t("session.typeRoom");
  if (session?.conversationType === "agent") return t("session.typeAgent");
  if (session?.conversationType === "automation") return t("session.typeAutomation");
  return t("session.typeCodex");
}

export function readableStorageSessionType(sessionType: StorageItemSummary["sessionType"], t: TFunction) {
  if (sessionType === "room") return t("session.typeRoom");
  if (sessionType === "agent") return t("session.typeAgent");
  if (sessionType === "automation") return t("session.typeAutomation");
  return t("session.typeCodex");
}

export function readableStorageSessionKind(sessionKind: StorageItemSummary["sessionKind"], t: TFunction) {
  if (sessionKind === "project") return t("settings.storageSessionKindProject");
  if (sessionKind === "scratch") return t("settings.storageSessionKindScratch");
  return "";
}

export function readableNotificationEvent(type: NotificationEventType, t: TFunction) {
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

export function readableGoalMode(mode: GoalMode, t: TFunction) {
  if (mode === "tracked") return t("goal.modeTracked");
  if (mode === "managed") return t("goal.modeManaged");
  if (mode === "orchestrated") return t("goal.modeOrchestrated");
  return t("goal.modeReference");
}

export function readableGoalStatus(status: GoalStatus | GoalFocusStatus, t: TFunction) {
  if (status === "paused") return t("goal.statusPaused");
  if (status === "completed") return t("goal.statusCompleted");
  if (status === "cancelled") return t("goal.statusCancelled");
  if (status === "archived") return t("goal.statusArchived");
  return t("goal.statusActive");
}

export const storageItemTypeLabels: Record<StorageItemSummary["type"], TranslationKey> = {
  "project-workspace": "settings.storageTypeProjectWorkspace",
  "session-data": "settings.storageTypeSessionData",
  "session-workspace": "settings.storageTypeSessionWorkspace",
  "room-workspace": "settings.storageTypeRoomWorkspace",
  "room-worktree": "settings.storageTypeRoomWorktree",
  "task-log": "settings.storageTypeTaskLog",
  "preview-log": "settings.storageTypePreviewLog",
};

export function readableStorageItemType(type: StorageItemSummary["type"], t: TFunction) {
  return t(storageItemTypeLabels[type]);
}

export const backupManifestTextLabels: Record<string, TranslationKey> = {
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

export function readableBackupManifestText(value: string, t: TFunction) {
  const key = backupManifestTextLabels[value];
  return key ? t(key) : value;
}

export const roomArtifactKinds: RoomArtifactSummary["kind"][] = ["report", "file-change", "preview", "link", "approval", "task", "decision", "handoff"];

export const roomArtifactKindLabels: Record<RoomArtifactSummary["kind"], TranslationKey> = {
  report: "room.artifactKindReport",
  "file-change": "room.artifactKindFileChange",
  preview: "room.artifactKindPreview",
  link: "room.artifactKindLink",
  approval: "room.artifactKindApproval",
  task: "room.artifactKindTask",
  decision: "room.artifactKindDecision",
  handoff: "room.artifactKindHandoff",
};

export function readableRoomArtifactKind(kind: RoomArtifactSummary["kind"], t: TFunction) {
  return t(roomArtifactKindLabels[kind]);
}

export const roomDecisionStatusLabels: Record<RoomDecisionSummary["status"], TranslationKey> = {
  open: "room.decisionStatusOpen",
  approved: "room.decisionStatusApproved",
  rejected: "room.decisionStatusRejected",
  resolved: "room.decisionStatusResolved",
};

export function readableRoomDecisionStatus(status: RoomDecisionSummary["status"], t: TFunction) {
  return t(roomDecisionStatusLabels[status] ?? "room.decisionStatusOpen");
}

export const roomHandoffStatusLabels: Record<RoomHandoffSummary["status"], TranslationKey> = {
  open: "room.handoffStatusOpen",
  accepted: "room.handoffStatusAccepted",
  returned: "room.handoffStatusReturned",
  resolved: "room.handoffStatusResolved",
  cancelled: "room.handoffStatusCancelled",
};

export function readableRoomHandoffStatus(status: RoomHandoffSummary["status"], t: TFunction) {
  return t(roomHandoffStatusLabels[status] ?? "room.handoffStatusOpen");
}

export function readableGitStatus(status: ProjectSummary["gitStatus"] | undefined, changedFiles: number, t: TFunction) {
  if (status === "dirty") return t("project.gitChanged").replace("{count}", String(changedFiles));
  if (status === "clean") return t("project.gitClean");
  if (status === "not-git") return t("project.notGitRepo");
  if (status === "error") return t("project.gitStatusFailed");
  return t("project.gitChanged").replace("{count}", String(changedFiles));
}

export function readLocalStorageValue(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function projectFolderName(project: ProjectSummary) {
  const normalized = project.workspacePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  return normalized.split("/").filter(Boolean).at(-1) || project.id;
}

export function projectDisplayName(project: ProjectSummary | undefined, projects: ProjectSummary[]) {
  if (!project) return "";
  const duplicateName = projects.some((item) => item.id !== project.id && item.name === project.name);
  return duplicateName ? `${project.name} / ${projectFolderName(project)}` : project.name;
}

export function readableListenMode(mode: AgentListenMode, t: TFunction) {
  if (mode === "none") return t("contacts.listenModeNone");
  if (mode === "active") return t("contacts.listenModeActive");
  if (mode === "orchestrator") return t("contacts.listenModeOrchestrator");
  return t("contacts.listenModePassive");
}

export function readableAgentWorkspaceMode(mode: AgentSummary["workspaceMode"], t: TFunction) {
  if (mode === "shared-readonly") return t("contacts.workspaceModeSharedReadonly");
  if (mode === "isolated-worktree") return t("contacts.workspaceModeIsolatedWorktree");
  if (mode === "isolated-worktree-with-shared-room") return t("contacts.workspaceModeIsolatedWorktreeWithSharedRoom");
  if (mode === "shared-write") return t("contacts.workspaceModeSharedWrite");
  return t("contacts.workspaceModeMergeWorkspace");
}

export function readablePermissionProfile(profile: PermissionProfileId | "custom" | null | undefined, t: TFunction) {
  if (profile === "read-only") return t("contacts.permissionProfileReadOnly");
  if (profile === "workspace-write") return t("contacts.permissionProfileWorkspaceWrite");
  if (profile === "developer") return t("contacts.permissionProfileDeveloper");
  if (profile === "maintainer") return t("contacts.permissionProfileMaintainer");
  if (profile === "danger-full-access") return t("contacts.permissionProfileDangerFullAccess");
  return t("contacts.permissionProfileCustom");
}

export function newestLinesFirst(log: string) {
  return log.split(/\r?\n/).reverse().join("\n");
}

export function newestTaskRunsFirst(log: string) {
  const chunks = log.split(/(?=^\[codex-web\])/m);
  if (chunks.length <= 1) return log;
  const prefix = chunks[0]?.startsWith("[codex-web]") ? "" : chunks.shift() ?? "";
  return [prefix, ...chunks.reverse()].filter(Boolean).join("").trimStart();
}

export function localUserMessage(content: string): SessionMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

export function attachmentListMarkdown(files: File[]) {
  if (!files.length) return "";
  return [
    "## Attachments",
    ...files.map((file, index) => `${index + 1}. ${file.name} (${formatBytes(file.size)})`),
  ].join("\n");
}

export function messageTextWithFiles(prompt: string, files: File[]) {
  const attachmentList = attachmentListMarkdown(files);
  return attachmentList ? `${prompt.trim()}\n\n${attachmentList}` : prompt.trim();
}

export function fileReferencesMarkdown(references: ComposerFileReference[]) {
  if (!references.length) return "";
  return [
    "## Referenced files and folders",
    ...references.map((item, index) => `${index + 1}. ${item.kind}: ${item.absolutePath}`),
  ].join("\n");
}

export function promptWithFileReferences(prompt: string, references: ComposerFileReference[]) {
  const referenceList = fileReferencesMarkdown(references);
  return referenceList ? `${prompt.trim()}\n\n${referenceList}` : prompt.trim();
}

export function messageTextWithContext(prompt: string, files: File[], references: ComposerFileReference[]) {
  return promptWithFileReferences(messageTextWithFiles(prompt, files), references);
}

export const maxComposerAttachmentFiles = 8;
export const maxComposerAttachmentBytes = 5 * 1024 * 1024;

export function fileToBase64(file: File) {
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

export async function filesToAttachmentInputs(files: File[]): Promise<UploadAttachmentInput[]> {
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    type: file.type || null,
    size: file.size,
    dataBase64: await fileToBase64(file),
  })));
}

export function mergeMessages(...groups: SessionMessage[][]) {
  const byId = new Map<string, SessionMessage>();
  const seenPersistedContent = new Set<string>();
  for (const message of groups.flat()) {
      const contentKey = `${message.role}:${message.content}`;
      if (message.id.startsWith("local-")) {
        if (seenPersistedContent.has(contentKey)) continue;
        seenPersistedContent.add(contentKey);
        byId.set(message.id, message);
        continue;
      }
      const current = byId.get(message.id);
      byId.set(message.id, current ? mergeMessage(current, message) : message);
      seenPersistedContent.add(contentKey);
  }
  return Array.from(byId.values())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function mergeMessage(current: SessionMessage, next: SessionMessage): SessionMessage {
  return {
    ...current,
    ...next,
    replyTo: next.replyTo ?? current.replyTo,
    usage: next.usage ?? current.usage,
  };
}

export function readableActivityStatus(status: string | undefined, kind: string, t: TFunction) {
  if (status === "in_progress") return t("session.activityInProgress");
  if (status === "completed") return t("session.activityCompleted");
  if (status === "failed") return t("session.activityFailed");
  return status || kind;
}

export function readableRunStatus(run: TaskRunSummary, t: TFunction) {
  if (run.stopRequested || run.status === "stopped") return t("session.runStopped");
  if (run.status === "running") return t("session.statusRunning");
  if (run.status === "done") return t("session.statusDone");
  if (run.status === "failed") return t("session.activityFailed");
  if (run.status === "interrupted") return t("session.statusInterrupted");
  return run.status;
}

export function activityFromSummary(item: TaskActivitySummary): ActivityItem {
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
