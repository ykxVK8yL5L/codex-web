import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { CodexApprovalPolicy, CodexSandboxMode, ExecutionContextSummary } from "@codex-web/protocol";
import type { agentPermissions, permissionProfileId } from "./permissions.js";

type ExecutionContextStoreDeps = {
  db: Database.Database;
  agentPermissions: typeof agentPermissions;
  permissionProfileId: typeof permissionProfileId;
};

export function createExecutionContextStore(deps: ExecutionContextStoreDeps) {
  const { db, agentPermissions, permissionProfileId } = deps;

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

  return { executionContextFromRow, recordExecutionContext };
}
