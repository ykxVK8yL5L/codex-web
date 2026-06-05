import type {
  ApiKeyPermission,
  ApiKeyPermissionGroup,
  ApiKeyPreset,
} from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export function apiKeyModuleLabel(t: TFunction, moduleId: string) {
  const labels: Record<string, string> = {
    auth: t("settings.apiKeyModuleAuth"),
    sessions: t("settings.apiKeyModuleSessions"),
    rooms: t("settings.apiKeyModuleRooms"),
    agents: t("settings.apiKeyModuleAgents"),
    automations: t("settings.apiKeyModuleAutomations"),
    goals: t("settings.apiKeyModuleGoals"),
    projects: t("settings.apiKeyModuleProjects"),
    previews: t("settings.apiKeyModulePreviews"),
    files: t("settings.apiKeyModuleFiles"),
    terminal: t("settings.apiKeyModuleTerminal"),
    providers: t("settings.apiKeyModuleProviders"),
    extensions: t("settings.apiKeyModuleExtensions"),
    environment: t("settings.apiKeyModuleEnvironment"),
    notifications: t("settings.apiKeyModuleNotifications"),
    approvals: t("settings.apiKeyModuleApprovals"),
    settings: t("settings.apiKeyModuleSettings"),
    storage: t("settings.apiKeyModuleStorage"),
    backup: t("settings.apiKeyModuleBackup"),
  };
  return labels[moduleId] ?? moduleId;
}

export function apiKeyActionLabel(t: TFunction, actionId: string) {
  const labels: Record<string, string> = {
    read: t("settings.apiKeyActionRead"),
    manage: t("settings.apiKeyActionManage"),
    run: t("settings.apiKeyActionRun"),
    git: t("settings.apiKeyActionGit"),
    write: t("settings.apiKeyActionWrite"),
    exec: t("settings.apiKeyActionExec"),
    install: t("settings.apiKeyActionInstall"),
    restore: t("settings.apiKeyActionRestore"),
    decide: t("settings.apiKeyActionDecide"),
  };
  return labels[actionId] ?? actionId;
}

export function apiKeyPresetLabel(t: TFunction, preset: ApiKeyPreset) {
  const labels: Record<string, string> = {
    "read-only": t("settings.apiKeyPresetReadOnly"),
    "automation-runner": t("settings.apiKeyPresetAutomationRunner"),
    "environment-restore": t("settings.apiKeyPresetEnvironmentRestore"),
    "project-ops": t("settings.apiKeyPresetProjectOps"),
    "full-access": t("settings.apiKeyPresetFullAccess"),
  };
  return labels[preset.id] ?? preset.label;
}

export function apiKeyPermissionLabel(t: TFunction, permission: ApiKeyPermission) {
  const [moduleId, actionId] = permission.split(".");
  if (!moduleId || !actionId) return permission;
  return `${apiKeyModuleLabel(t, moduleId)}${apiKeyActionLabel(t, actionId)}`;
}

export function apiKeyGroupLabel(t: TFunction, groupId: string) {
  return apiKeyModuleLabel(t, groupId);
}

export function apiKeyPermissionOptionLabel(t: TFunction, permission: ApiKeyPermission) {
  const [moduleId, actionId] = permission.split(".");
  if (!moduleId || !actionId) return permission;
  return `${apiKeyActionLabel(t, actionId)}${apiKeyModuleLabel(t, moduleId)}`;
}

export function apiKeyPermissionOptionTitle(t: TFunction, permission: ApiKeyPermission) {
  const [moduleId, actionId] = permission.split(".");
  if (!moduleId || !actionId) return permission;
  return `${apiKeyModuleLabel(t, moduleId)} · ${apiKeyActionLabel(t, actionId)}`;
}

export function apiKeyPermissionGroupDescription(t: TFunction, group: ApiKeyPermissionGroup) {
  return group.permissions.map((permission) => apiKeyActionLabel(t, permission.id.split(".")[1] ?? permission.id)).join(" / ");
}

export function apiKeyPermissionGroupLabel(t: TFunction, permission: { id: ApiKeyPermission; label: string }) {
  return apiKeyPermissionOptionLabel(t, permission.id);
}

export function apiKeyPermissionGroupTitle(t: TFunction, permission: { id: ApiKeyPermission; label: string }) {
  return apiKeyPermissionOptionTitle(t, permission.id);
}
