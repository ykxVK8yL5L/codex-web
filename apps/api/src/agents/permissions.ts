import type {
  AgentListenMode,
  AgentPermissionSettings,
  AgentProjectAccessMode,
  AgentRoleSourceType,
  AgentSummary,
  AgentWorkspaceMode,
  ConversationType,
  PermissionProfileId,
  PreviewAccess,
} from "@codex-web/protocol";

export const defaultAgentPermissions: AgentPermissionSettings = {
  canWriteFiles: true,
  canRunCommands: true,
  canUseTerminal: true,
  canCreatePreview: true,
  canWriteSharedWorkspace: true,
  canRequestApproval: true,
  canTriggerAgents: false,
  canMergeChanges: false,
};

export const permissionProfiles: Record<string, Partial<AgentPermissionSettings>> = {
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

export function permissionProfileId(value: unknown): PermissionProfileId | null {
  return typeof value === "string" && value in permissionProfiles ? value as PermissionProfileId : null;
}

export function agentPermissions(value: unknown, override?: Partial<AgentPermissionSettings>): AgentPermissionSettings {
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

export function resolvedAgentPermissions(agent: Pick<AgentSummary, "permissions" | "permissionProfileId">) {
  return agentPermissions(agent.permissions, agent.permissionProfileId ? permissionProfiles[agent.permissionProfileId] : undefined);
}

export function projectAccessMode(value: unknown): AgentProjectAccessMode {
  return value === "none" || value === "selected" || value === "all" ? value : "all";
}

export function roleSourceType(value: unknown): AgentRoleSourceType {
  return value === "file-import" || value === "builtin-template" ? value : "custom-markdown";
}

export function listenMode(value: unknown, fallback: AgentListenMode = "passive"): AgentListenMode {
  return value === "none" || value === "active" || value === "orchestrator" || value === "passive" ? value : fallback;
}

export function workspaceMode(value: unknown, fallback: AgentWorkspaceMode = "isolated-worktree-with-shared-room"): AgentWorkspaceMode {
  return value === "shared-readonly"
    || value === "shared-write"
    || value === "merge-workspace"
    || value === "isolated-worktree"
    || value === "isolated-worktree-with-shared-room"
    ? value
    : fallback;
}

export function conversationType(value: unknown, fallback: ConversationType = "codex"): ConversationType {
  return value === "agent" || value === "room" || value === "codex" || value === "automation" ? value : fallback;
}

export function previewAccess(value: unknown, fallback: PreviewAccess = "private"): PreviewAccess {
  return value === "public" || value === "private" ? value : fallback;
}
