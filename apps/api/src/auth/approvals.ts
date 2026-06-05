import { randomUUID } from "node:crypto";
import type {
  ApprovalActionType,
  ApprovalGrantSummary,
  ApprovalRisk,
  ApprovalStatus,
  ApprovalSummary,
  CodexRuntimeSettings,
  ProjectGitOperationType,
  ProjectSummary,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows } from "../pagination.js";

type ApprovalRecord = ApprovalSummary & { payload: unknown };
type PreviewApprovalRecord = {
  id: string;
  label: string;
  targetHost: string;
  port: number;
  command?: string | null;
  cwd?: string | null;
  scopeType?: string | null;
  scopeId?: string | null;
};

type ApprovalServiceDeps = {
  db: any;
  emitExternalNotification: (input: any) => void;
  saveCodexRuntimeSettings: (settings: CodexRuntimeSettings) => void;
  setCodexRuntimeSettings: (settings: CodexRuntimeSettings) => void;
};

export function createApprovalService(deps: ApprovalServiceDeps) {
  const { db, saveCodexRuntimeSettings, setCodexRuntimeSettings } = deps;

function approvalFromRow(row: Record<string, unknown>): ApprovalRecord {
  let payload: unknown = null;
  try {
    payload = JSON.parse(String(row.payload));
  } catch {
    payload = null;
  }
  return {
    id: String(row.id),
    actionType: String(row.action_type) as ApprovalActionType,
    risk: String(row.risk) as ApprovalRisk,
    status: String(row.status) as ApprovalStatus,
    title: String(row.title),
    description: String(row.description),
    details: String(row.details),
    payload,
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

function publicApproval(approval: ApprovalRecord): ApprovalSummary {
  const { payload, ...summary } = approval;
  return { ...summary, related: payload };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function approvalGrantKey(actionType: ApprovalActionType, payload: unknown) {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (actionType === "preview-command-run") {
    return stableJson({
      command: value.command,
      cwd: value.cwd,
      targetHost: value.targetHost,
      port: value.port,
      scopeType: value.scopeType,
      scopeId: value.scopeId,
    });
  }
  if (actionType === "project-git-operation") return stableJson({ projectId: value.projectId, operation: value.operation });
  if (actionType === "project-delete-files") return stableJson({ projectId: value.projectId, deleteFiles: true });
  if (actionType === "room-run-merge") return stableJson({ roomId: value.roomId });
  if (actionType === "codex-runtime-update") return stableJson(value);
  return stableJson(value);
}

function approvalAlwaysAllowed(actionType: ApprovalActionType, payload: unknown) {
  const grantKey = approvalGrantKey(actionType, payload);
  return Boolean(db.prepare("select id from approval_grants where action_type = ? and grant_key = ? and (expires_at is null or expires_at > ?)").get(actionType, grantKey, new Date().toISOString()));
}

function saveApprovalGrant(approval: ApprovalRecord, expiresAt: string | null = null) {
  const now = new Date().toISOString();
  db.prepare(`
    insert into approval_grants (id, action_type, grant_key, title, details, expires_at, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(action_type, grant_key) do update set
      title = excluded.title,
      details = excluded.details,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `).run(`approval-grant-${randomUUID()}`, approval.actionType, approvalGrantKey(approval.actionType, approval.payload), approval.title, approval.details, expiresAt, now);
}

function approvalGrantFromRow(row: Record<string, unknown>): ApprovalGrantSummary {
  return {
    id: String(row.id),
    actionType: String(row.action_type) as ApprovalActionType,
    title: String(row.title),
    details: String(row.details),
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}

function listApprovalGrants(limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const rows = db.prepare(`
    select * from approval_grants
    ${cursor ? "where (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(approvalGrantFromRow), limit, (item) => item.createdAt);
}

function listApprovals(status: string | undefined, archived: boolean, limit = 50, cursorValue?: string | null) {
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(status ? ["status = @status"] : []),
    archived ? "archived_at is not null" : "archived_at is null",
    ...(cursor ? ["(created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from approvals
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by created_at desc, id desc
    limit @limit
  `).all({ status, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 });
  return pageFromRows((rows as Array<Record<string, unknown>>).map(approvalFromRow), limit, (item) => item.createdAt);
}

function getApproval(id: string) {
  const row = db.prepare("select * from approvals where id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? approvalFromRow(row) : null;
}

function createApproval(input: Omit<ApprovalRecord, "id" | "status" | "createdAt" | "resolvedAt">) {
  const payload = JSON.stringify(input.payload);
  const existing = db.prepare(`
    select * from approvals
    where status = 'pending' and action_type = ? and payload = ?
    order by created_at desc
    limit 1
  `).get(input.actionType, payload) as Record<string, unknown> | undefined;
  if (existing) return approvalFromRow(existing);
  const approval: ApprovalRecord = {
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  db.prepare(`
    insert into approvals (id, action_type, risk, status, title, description, details, payload, created_at, resolved_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    approval.id,
    approval.actionType,
    approval.risk,
    approval.status,
    approval.title,
    approval.description,
    approval.details,
    payload,
    approval.createdAt,
    approval.resolvedAt,
  );
  deps.emitExternalNotification({
    eventType: "needs_approval",
    severity: approval.risk === "critical" || approval.risk === "high" ? "error" : "warning",
    title: approval.title,
    message: approval.description || approval.details,
    sourceType: "approval",
    sourceId: approval.id,
    metadata: { actionType: approval.actionType, risk: approval.risk },
  });
  return approval;
}

function resolveApproval(id: string, status: Extract<ApprovalStatus, "approved" | "denied">) {
  const resolvedAt = new Date().toISOString();
  db.prepare("update approvals set status = ?, resolved_at = ? where id = ?").run(status, resolvedAt, id);
  return getApproval(id);
}

function archiveApproval(id: string) {
  const archivedAt = new Date().toISOString();
  db.prepare("update approvals set archived_at = ? where id = ? and status != 'pending'").run(archivedAt, id);
  return getApproval(id);
}

function restoreApproval(id: string) {
  db.prepare("update approvals set archived_at = null where id = ?").run(id);
  return getApproval(id);
}

function codexRuntimeRisk(current: CodexRuntimeSettings, next: CodexRuntimeSettings): ApprovalRisk | null {
  if (next.bypassSandbox && !current.bypassSandbox) return "critical";
  if (next.sandboxMode === "danger-full-access" && current.sandboxMode !== "danger-full-access") return "high";
  return null;
}

function codexRuntimeDetails(next: CodexRuntimeSettings) {
  return [
    `sandboxMode=${next.sandboxMode}`,
    `approvalPolicy=${next.approvalPolicy}`,
    `bypassSandbox=${String(next.bypassSandbox)}`,
  ].join("\n");
}

function applyCodexRuntimeSettings(settings: CodexRuntimeSettings) {
  setCodexRuntimeSettings(settings);
  saveCodexRuntimeSettings(settings);
  return settings;
}

function previewCommandRisk(preview: PreviewApprovalRecord): ApprovalRisk | null {
  const command = preview.command?.toLowerCase() ?? "";
  if (!command) return null;
  if (preview.port > 0 && preview.port < 1024) return "high";
  if (/\b(sudo|su|launchctl|osascript)\b/.test(command)) return "critical";
  if (/\b(docker|podman|kubectl|systemctl|pm2)\b/.test(command)) return "high";
  if (/\brm\s+-[^&|;]*r[^&|;]*f\b/.test(command)) return "high";
  return null;
}

function previewApprovalDetails(preview: PreviewApprovalRecord) {
  return [
    `preview=${preview.label}`,
    `target=${preview.targetHost}:${preview.port}`,
    `cwd=${preview.cwd ?? "(workspace root)"}`,
    `command=${preview.command ?? ""}`,
  ].join("\n");
}

function createPreviewApproval(preview: PreviewApprovalRecord, risk: ApprovalRisk) {
  return createApproval({
    actionType: "preview-command-run",
    risk,
    title: "Preview command requires approval",
    description: "Run a preview command that crosses a configured risk boundary.",
    details: previewApprovalDetails(preview),
    payload: { previewId: preview.id, command: preview.command ?? "", cwd: preview.cwd ?? "", targetHost: preview.targetHost, port: preview.port, scopeType: preview.scopeType, scopeId: preview.scopeId },
  });
}

function projectDeleteApprovalDetails(project: ProjectSummary) {
  return [
    `project=${project.name}`,
    `id=${project.id}`,
    `workspacePath=${project.workspacePath}`,
  ].join("\n");
}

function createProjectDeleteApproval(project: ProjectSummary) {
  return createApproval({
    actionType: "project-delete-files",
    risk: "high",
    title: "Project file deletion requires approval",
    description: "Delete a project record and recursively remove its workspace directory.",
    details: projectDeleteApprovalDetails(project),
    payload: { projectId: project.id, deleteFiles: true },
  });
}

function createRoomRunMergeApproval(roomId: string, runId: string, risk: ApprovalRisk, reason: string) {
  return createApproval({
    actionType: "room-run-merge",
    risk,
    title: "Room run merge requires approval",
    description: "Apply an Agent run patch back into the project workspace.",
    details: [`room=${roomId}`, `run=${runId}`, `reason=${reason}`].join("\n"),
    payload: { roomId, runId },
  });
}

function createProjectGitApproval(project: ProjectSummary, operation: ProjectGitOperationType, args: string[], reason: string) {
  return createApproval({
    actionType: "project-git-operation",
    risk: operation === "push" ? "high" : "medium",
    title: "Project Git operation requires approval",
    description: `Run git ${operation} for project ${project.name}.`,
    details: [`project=${project.name}`, `id=${project.id}`, `workspacePath=${project.workspacePath}`, `operation=${operation}`, `args=${args.join(" ")}`, `reason=${reason}`].join("\n"),
    payload: { projectId: project.id, operation, args },
  });
}


  return {
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
  };
}
