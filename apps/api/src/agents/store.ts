import type Database from "better-sqlite3";
import type {
  AgentCircleSummary,
  AgentGroupSummary,
  AgentRoleSummary,
  AgentSummary,
  ProjectSummary,
} from "@codex-web/protocol";
import { decodeOffsetCursor, decodePageCursor, offsetPageFromRows, pageFromRows } from "../pagination.js";
import type { agentPermissions, listenMode, permissionProfileId, projectAccessMode, roleSourceType, workspaceMode } from "./permissions.js";

type AgentStoreDeps = {
  db: Database.Database;
  getProjects: () => ProjectSummary[];
  jsonArray: (value: unknown) => string[];
  agentPermissions: typeof agentPermissions;
  listenMode: typeof listenMode;
  permissionProfileId: typeof permissionProfileId;
  projectAccessMode: typeof projectAccessMode;
  roleSourceType: typeof roleSourceType;
  workspaceMode: typeof workspaceMode;
};

export function createAgentStore(deps: AgentStoreDeps) {
  const { db, getProjects, jsonArray, agentPermissions, listenMode, permissionProfileId, projectAccessMode, roleSourceType, workspaceMode } = deps;

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
    const valid = new Set(getProjects().map((project) => project.id));
    return Array.from(new Set((ids ?? []).map(String).filter((id) => valid.has(id))));
  }

  function agentCanAccessProject(agent: AgentSummary, projectId?: string | null) {
    if (!projectId) return true;
    if (agent.projectAccessMode === "none") return false;
    if (agent.projectAccessMode === "all") return getProjects().some((project) => project.id === projectId);
    return agent.allowedProjectIds.includes(projectId);
  }

  function resolveAgentProject(agent: AgentSummary, requestedProjectId?: string | null) {
    const projectId = requestedProjectId !== undefined ? requestedProjectId : agent.defaultProjectId;
    if (!projectId) return null;
    if (!agentCanAccessProject(agent, projectId)) throw new Error("agent_project_access_denied");
    return getProjects().find((project) => project.id === projectId) ?? null;
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

  return {
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
  };
}
