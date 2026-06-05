import type { NotificationEventType, StorageItemSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

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

const storageItemTypeLabels: Record<StorageItemSummary["type"], TranslationKey> = {
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

export function readableBackupManifestText(value: string, t: TFunction) {
  const key = backupManifestTextLabels[value];
  return key ? t(key) : value;
}
