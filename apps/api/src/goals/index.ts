import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ConversationType,
  CreateGoalFocusRequest,
  CreateGoalItemRequest,
  CreateGoalRequest,
  GoalDetailResponse,
  GoalEventSummary,
  GoalFocusStatus,
  GoalFocusSummary,
  GoalItemStatus,
  GoalItemSummary,
  GoalMode,
  GoalOwnerType,
  GoalProposalKind,
  GoalProposalStatus,
  GoalProposalSummary,
  GoalStatus,
  GoalSummary,
  GoalFocusSummary as GoalFocus,
  GoalItemSummary as GoalItem,
  SessionSummary,
  UpdateGoalFocusRequest,
  UpdateGoalItemRequest,
  UpdateGoalRequest,
  PreviewAccess,
} from "@codex-web/protocol";

type GoalStoreDeps = {
  db: Database.Database;
  findSessionById: (sessionId: string) => SessionSummary | undefined;
};

let goalStoreDeps: GoalStoreDeps | null = null;

export function setGoalStoreDeps(nextDeps: GoalStoreDeps) {
  goalStoreDeps = nextDeps;
}

function deps() {
  if (!goalStoreDeps) throw new Error("goal_store_not_initialized");
  return goalStoreDeps;
}

function jsonPayload(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

export function goalMode(value: unknown, fallback: GoalMode = "reference"): GoalMode {
  return value === "tracked" || value === "managed" || value === "orchestrated" || value === "reference" ? value : fallback;
}

export function goalStatus(value: unknown, fallback: GoalStatus = "active"): GoalStatus {
  return value === "paused" || value === "completed" || value === "cancelled" || value === "archived" || value === "active" ? value : fallback;
}

export function goalFocusStatus(value: unknown, fallback: GoalFocusStatus = "active"): GoalFocusStatus {
  return value === "completed" || value === "cancelled" || value === "paused" || value === "active" ? value : fallback;
}

export function goalItemStatus(value: unknown, fallback: GoalItemStatus = "planned"): GoalItemStatus {
  return value === "active" || value === "blocked" || value === "completed" || value === "failed" || value === "cancelled" || value === "planned" ? value : fallback;
}

export function goalOwnerType(value: unknown): GoalOwnerType | null {
  return value === "session" || value === "agent_session" || value === "room" ? value : null;
}

export function goalFocusFromRow(row: Record<string, unknown>): GoalFocusSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    text: String(row.text),
    status: goalFocusStatus(row.status),
    ownerAgentId: row.owner_agent_id ? String(row.owner_agent_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

export function goalItemFromRow(row: Record<string, unknown>): GoalItemSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    roomTaskId: row.room_task_id ? String(row.room_task_id) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    status: goalItemStatus(row.status),
    assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    priority: Number(row.priority) || 0,
    dependsOnItemId: row.depends_on_item_id ? String(row.depends_on_item_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

export function goalEventFromRow(row: Record<string, unknown>): GoalEventSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    type: String(row.type),
    actorType: row.actor_type ? String(row.actor_type) : null,
    actorId: row.actor_id ? String(row.actor_id) : null,
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
  };
}

function goalProposalKind(value: unknown): GoalProposalKind {
  return value === "focus" || value === "item" || value === "plan" || value === "goal_update" ? value : "goal_update";
}

function goalProposalStatus(value: unknown): GoalProposalStatus {
  return value === "approved" || value === "rejected" || value === "pending" ? value : "pending";
}

export function goalProposalFromRow(row: Record<string, unknown>): GoalProposalSummary {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    kind: goalProposalKind(row.kind),
    status: goalProposalStatus(row.status),
    title: String(row.title),
    payload: jsonPayload(row.payload),
    proposedByAgentId: row.proposed_by_agent_id ? String(row.proposed_by_agent_id) : null,
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function goalProgress(goalId: string, progressSummary?: string | null): GoalSummary["progress"] {
  const { db } = deps();
  const rows = db.prepare("select status, updated_at from goal_items where goal_id = ?").all(goalId) as Array<{ status?: string; updated_at?: string }>;
  const activeStatuses = new Set(["planned", "active"]);
  return {
    totalItems: rows.length,
    activeItems: rows.filter((item) => activeStatuses.has(String(item.status))).length,
    completedItems: rows.filter((item) => item.status === "completed").length,
    failedItems: rows.filter((item) => item.status === "failed").length,
    blockedItems: rows.filter((item) => item.status === "blocked").length,
    latestSummary: progressSummary ?? null,
    updatedAt: rows.map((item) => item.updated_at ? String(item.updated_at) : "").filter(Boolean).sort().pop() ?? null,
  };
}

function currentGoalFocus(goalId: string) {
  const { db } = deps();
  const row = db.prepare(`
    select * from goal_focuses
    where goal_id = ? and status in ('active', 'paused')
    order by updated_at desc, id desc
    limit 1
  `).get(goalId) as Record<string, unknown> | undefined;
  return row ? goalFocusFromRow(row) : null;
}

export function goalFromRow(row: Record<string, unknown>): GoalSummary {
  return {
    id: String(row.id),
    ownerType: goalOwnerType(row.owner_type) ?? "session",
    ownerId: String(row.owner_id),
    text: String(row.text),
    mode: goalMode(row.mode),
    status: goalStatus(row.status),
    managerAgentId: row.manager_agent_id ? String(row.manager_agent_id) : null,
    coordinatorAgentId: row.coordinator_agent_id ? String(row.coordinator_agent_id) : null,
    currentFocus: currentGoalFocus(String(row.id)),
    progress: goalProgress(String(row.id), row.progress_summary ? String(row.progress_summary) : null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

export function activeGoalForOwner(ownerType: GoalOwnerType, ownerId?: string | null) {
  const { db } = deps();
  if (!ownerId) return null;
  const row = db.prepare(`
    select * from goals
    where owner_type = ? and owner_id = ? and status in ('active', 'paused')
    order by updated_at desc, id desc
    limit 1
  `).get(ownerType, ownerId) as Record<string, unknown> | undefined;
  return row ? goalFromRow(row) : null;
}

export function activeGoalForSession(session: Pick<SessionSummary, "id" | "conversationType" | "roomId" | "directAgentId">) {
  if (session.roomId) return activeGoalForOwner("room", session.roomId);
  if (session.conversationType === "agent" || session.directAgentId) return activeGoalForOwner("agent_session", session.id);
  return activeGoalForOwner("session", session.id);
}

function assertGoalOwner(ownerType: GoalOwnerType, ownerId: string) {
  const { db, findSessionById } = deps();
  if (ownerType === "room") {
    if (!db.prepare("select id from rooms where id = ?").get(ownerId)) throw new Error("room_not_found");
    return;
  }
  if (!findSessionById(ownerId)) throw new Error("session_not_found");
}

type GoalActor = { type: "user"; agentId: null } | { type: "agent"; agentId: string };

function canAgentManageGoal(goal: GoalSummary, agentId: string) {
  const { db } = deps();
  if (goal.managerAgentId === agentId || goal.coordinatorAgentId === agentId) return true;
  if (goal.ownerType !== "room") return false;
  const membership = db.prepare("select listen_mode from room_agents where room_id = ? and agent_id = ?").get(goal.ownerId, agentId) as { listen_mode?: string } | undefined;
  if (!membership) return false;
  if (membership.listen_mode === "orchestrator") return true;
  const agent = db.prepare("select name, role_id from agents where id = ?").get(agentId) as { name?: string; role_id?: string } | undefined;
  const roleId = agent?.role_id?.toLowerCase() ?? "";
  const name = agent?.name?.toLowerCase() ?? "";
  return roleId.includes("product") || roleId.includes("manager") || name.includes("pm") || name.includes("product");
}

export function assertCanManageGoal(goal: GoalSummary, actor: GoalActor) {
  if (actor.type === "user") return;
  if (canAgentManageGoal(goal, actor.agentId)) return;
  throw new Error("goal_agent_must_propose");
}

export function assertCanUpdateGoalItem(goalId: string, itemId: string, actor: GoalActor) {
  const { db } = deps();
  if (actor.type === "user") return;
  const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown>);
  if (canAgentManageGoal(goal, actor.agentId)) return;
  const item = db.prepare("select assigned_agent_id from goal_items where id = ? and goal_id = ?").get(itemId, goalId) as { assigned_agent_id?: string | null } | undefined;
  if (item?.assigned_agent_id === actor.agentId) return;
  throw new Error("goal_item_agent_not_assigned");
}

export function recordGoalEvent(goalId: string, type: string, payload: unknown = {}, actorType?: string | null, actorId?: string | null) {
  const { db } = deps();
  const now = new Date().toISOString();
  db.prepare(`
    insert into goal_events (id, goal_id, type, actor_type, actor_id, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(`goal-event-${randomUUID()}`, goalId, type, actorType ?? null, actorId ?? null, JSON.stringify(payload ?? {}), now);
}

function ownerDefaultGoalMode(ownerType: GoalOwnerType, requested?: GoalMode): GoalMode {
  if (requested) return requested;
  return ownerType === "room" ? "orchestrated" : "reference";
}

export function goalActorFromRequest(c: { req: { header: (name: string) => string | undefined } }, body?: Record<string, unknown> | null): GoalActor {
  const { db } = deps();
  const agentId = c.req.header("x-codex-agent-id")?.trim()
    || c.req.header("x-agent-id")?.trim()
    || (typeof body?.actorAgentId === "string" ? body.actorAgentId.trim() : "")
    || (typeof body?.proposedByAgentId === "string" ? body.proposedByAgentId.trim() : "");
  if (!agentId) return { type: "user", agentId: null };
  if (!db.prepare("select id from agents where id = ?").get(agentId)) throw new Error("agent_actor_not_found");
  return { type: "agent", agentId };
}

export function createGoal(input: CreateGoalRequest, actorType = "user", actorId?: string | null): GoalSummary {
  const { db } = deps();
  const ownerType = goalOwnerType(input.ownerType);
  const ownerId = String(input.ownerId ?? "");
  const text = String(input.text ?? "").trim();
  if (!ownerType || !ownerId || !text) throw new Error("invalid_goal");
  assertGoalOwner(ownerType, ownerId);
  const now = new Date().toISOString();
  const existing = activeGoalForOwner(ownerType, ownerId);
  if (existing) {
    db.prepare("update goals set status = 'archived', updated_at = ? where id = ?").run(now, existing.id);
    recordGoalEvent(existing.id, "goal.archived", { reason: "replaced", replacementOwnerType: ownerType, replacementOwnerId: ownerId }, actorType, actorId);
  }
  const id = `goal-${randomUUID()}`;
  db.prepare(`
    insert into goals (id, owner_type, owner_id, text, mode, status, manager_agent_id, coordinator_agent_id, progress_summary, created_at, updated_at, completed_at, cancelled_at)
    values (?, ?, ?, ?, ?, 'active', ?, ?, null, ?, ?, null, null)
  `).run(id, ownerType, ownerId, text, ownerDefaultGoalMode(ownerType, input.mode), input.managerAgentId ?? null, input.coordinatorAgentId ?? null, now, now);
  recordGoalEvent(id, "goal.created", { ownerType, ownerId, text }, actorType, actorId);
  if (input.focusText?.trim()) createGoalFocus(id, { text: input.focusText, ownerAgentId: input.focusOwnerAgentId ?? null }, actorType, actorId);
  return goalFromRow(db.prepare("select * from goals where id = ?").get(id) as Record<string, unknown>);
}

export function updateGoal(id: string, input: UpdateGoalRequest, actorType = "user", actorId?: string | null): GoalSummary {
  const { db } = deps();
  const current = db.prepare("select * from goals where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) throw new Error("goal_not_found");
  const now = new Date().toISOString();
  const nextStatus = input.status ? goalStatus(input.status, goalStatus(current.status)) : goalStatus(current.status);
  const completedAt = nextStatus === "completed" ? String(current.completed_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.completed_at ?? null);
  const cancelledAt = nextStatus === "cancelled" ? String(current.cancelled_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.cancelled_at ?? null);
  db.prepare(`
    update goals
    set text = ?, mode = ?, status = ?, manager_agent_id = ?, coordinator_agent_id = ?, progress_summary = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
    where id = ?
  `).run(
    input.text !== undefined ? String(input.text).trim() || String(current.text) : String(current.text),
    input.mode ? goalMode(input.mode, goalMode(current.mode)) : goalMode(current.mode),
    nextStatus,
    input.managerAgentId !== undefined ? input.managerAgentId : current.manager_agent_id ?? null,
    input.coordinatorAgentId !== undefined ? input.coordinatorAgentId : current.coordinator_agent_id ?? null,
    input.progressSummary !== undefined ? input.progressSummary?.trim() || null : current.progress_summary ?? null,
    completedAt,
    cancelledAt,
    now,
    id,
  );
  recordGoalEvent(id, "goal.updated", input, actorType, actorId);
  return goalFromRow(db.prepare("select * from goals where id = ?").get(id) as Record<string, unknown>);
}

export function createGoalFocus(goalId: string, input: CreateGoalFocusRequest, actorType = "user", actorId?: string | null): GoalFocusSummary {
  const { db } = deps();
  const goal = db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown> | undefined;
  if (!goal) throw new Error("goal_not_found");
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("invalid_goal_focus");
  const now = new Date().toISOString();
  db.prepare("update goal_focuses set status = 'completed', completed_at = coalesce(completed_at, ?), updated_at = ? where goal_id = ? and status in ('active', 'paused')").run(now, now, goalId);
  const id = `goal-focus-${randomUUID()}`;
  db.prepare(`
    insert into goal_focuses (id, goal_id, text, status, owner_agent_id, created_at, updated_at, completed_at, cancelled_at)
    values (?, ?, ?, 'active', ?, ?, ?, null, null)
  `).run(id, goalId, text, input.ownerAgentId ?? null, now, now);
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  recordGoalEvent(goalId, "focus.created", { focusId: id, text, ownerAgentId: input.ownerAgentId ?? null }, actorType, actorId);
  return goalFocusFromRow(db.prepare("select * from goal_focuses where id = ?").get(id) as Record<string, unknown>);
}

export function updateGoalFocus(goalId: string, focusId: string, input: UpdateGoalFocusRequest, actorType = "user", actorId?: string | null): GoalFocusSummary {
  const { db } = deps();
  const current = db.prepare("select * from goal_focuses where id = ? and goal_id = ?").get(focusId, goalId) as Record<string, unknown> | undefined;
  if (!current) throw new Error("goal_focus_not_found");
  const now = new Date().toISOString();
  const nextStatus = input.status ? goalFocusStatus(input.status, goalFocusStatus(current.status)) : goalFocusStatus(current.status);
  db.prepare(`
    update goal_focuses
    set text = ?, status = ?, owner_agent_id = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
    where id = ? and goal_id = ?
  `).run(
    input.text !== undefined ? String(input.text).trim() || String(current.text) : String(current.text),
    nextStatus,
    input.ownerAgentId !== undefined ? input.ownerAgentId : current.owner_agent_id ?? null,
    nextStatus === "completed" ? String(current.completed_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.completed_at ?? null),
    nextStatus === "cancelled" ? String(current.cancelled_at ?? now) : (nextStatus === "active" || nextStatus === "paused" ? null : current.cancelled_at ?? null),
    now,
    focusId,
    goalId,
  );
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  recordGoalEvent(goalId, "focus.updated", { focusId, ...input }, actorType, actorId);
  return goalFocusFromRow(db.prepare("select * from goal_focuses where id = ?").get(focusId) as Record<string, unknown>);
}

export function createGoalItem(goalId: string, input: CreateGoalItemRequest, actorType = "user", actorId?: string | null): GoalItemSummary {
  const { db } = deps();
  if (!db.prepare("select id from goals where id = ?").get(goalId)) throw new Error("goal_not_found");
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("invalid_goal_item");
  const now = new Date().toISOString();
  const id = `goal-item-${randomUUID()}`;
  db.prepare(`
    insert into goal_items (id, goal_id, room_task_id, title, description, status, assigned_agent_id, priority, depends_on_item_id, created_at, updated_at, completed_at, cancelled_at)
    values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, null, null)
  `).run(id, goalId, title, input.description?.trim() || null, goalItemStatus(input.status), input.assignedAgentId ?? null, Number(input.priority ?? 0) || 0, input.dependsOnItemId ?? null, now, now);
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  recordGoalEvent(goalId, "item.created", { itemId: id, title }, actorType, actorId);
  return goalItemFromRow(db.prepare("select * from goal_items where id = ?").get(id) as Record<string, unknown>);
}

export function updateGoalItem(goalId: string, itemId: string, input: UpdateGoalItemRequest, actorType = "user", actorId?: string | null): GoalItemSummary {
  const { db } = deps();
  const current = db.prepare("select * from goal_items where id = ? and goal_id = ?").get(itemId, goalId) as Record<string, unknown> | undefined;
  if (!current) throw new Error("goal_item_not_found");
  const now = new Date().toISOString();
  const nextStatus = input.status ? goalItemStatus(input.status, goalItemStatus(current.status)) : goalItemStatus(current.status);
  db.prepare(`
    update goal_items
    set room_task_id = ?, title = ?, description = ?, status = ?, assigned_agent_id = ?, priority = ?, depends_on_item_id = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
    where id = ? and goal_id = ?
  `).run(
    input.roomTaskId !== undefined ? input.roomTaskId : current.room_task_id ?? null,
    input.title !== undefined ? String(input.title).trim() || String(current.title) : String(current.title),
    input.description !== undefined ? input.description?.trim() || null : current.description ?? null,
    nextStatus,
    input.assignedAgentId !== undefined ? input.assignedAgentId : current.assigned_agent_id ?? null,
    input.priority !== undefined ? Number(input.priority) || 0 : Number(current.priority ?? 0) || 0,
    input.dependsOnItemId !== undefined ? input.dependsOnItemId : current.depends_on_item_id ?? null,
    nextStatus === "completed" ? String(current.completed_at ?? now) : (nextStatus === "planned" || nextStatus === "active" || nextStatus === "blocked" ? null : current.completed_at ?? null),
    nextStatus === "cancelled" ? String(current.cancelled_at ?? now) : (nextStatus === "planned" || nextStatus === "active" || nextStatus === "blocked" ? null : current.cancelled_at ?? null),
    now,
    itemId,
    goalId,
  );
  db.prepare("update goals set updated_at = ? where id = ?").run(now, goalId);
  if (input.roomTaskId !== undefined) db.prepare("update room_tasks set goal_item_id = ? where id = ?").run(itemId, input.roomTaskId);
  recordGoalEvent(goalId, "item.updated", { itemId, ...input }, actorType, actorId);
  if ((nextStatus === "blocked" || nextStatus === "failed") && String(current.status) !== nextStatus) {
    createReplanProposal(goalId, itemId, nextStatus, actorType, actorId);
  }
  return goalItemFromRow(db.prepare("select * from goal_items where id = ?").get(itemId) as Record<string, unknown>);
}

export function listGoalProposals(goalId: string) {
  const { db } = deps();
  return (db.prepare("select * from goal_proposals where goal_id = ? order by status asc, created_at desc, id desc").all(goalId) as Array<Record<string, unknown>>).map(goalProposalFromRow);
}

export function createGoalProposal(goalId: string, input: { kind?: unknown; title?: unknown; payload?: unknown; proposedByAgentId?: unknown }, actorType = "agent", actorId?: string | null) {
  const { db } = deps();
  if (!db.prepare("select id from goals where id = ?").get(goalId)) throw new Error("goal_not_found");
  const kind = goalProposalKind(input.kind);
  const title = String(input.title ?? "").trim() || kind;
  const id = `goal-proposal-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    insert into goal_proposals (id, goal_id, kind, status, title, payload, proposed_by_agent_id, created_at, resolved_at)
    values (?, ?, ?, 'pending', ?, ?, ?, ?, null)
  `).run(id, goalId, kind, title, JSON.stringify(input.payload ?? {}), input.proposedByAgentId ? String(input.proposedByAgentId) : actorId ?? null, now);
  recordGoalEvent(goalId, "proposal.created", { proposalId: id, kind, title }, actorType, actorId);
  return goalProposalFromRow(db.prepare("select * from goal_proposals where id = ?").get(id) as Record<string, unknown>);
}

export function applyGoalProposal(goalId: string, proposalId: string, actorType = "user", actorId?: string | null) {
  const { db } = deps();
  const row = db.prepare("select * from goal_proposals where id = ? and goal_id = ?").get(proposalId, goalId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("goal_proposal_not_found");
  const proposal = goalProposalFromRow(row);
  if (proposal.status !== "pending") return proposal;
  const payload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload as Record<string, unknown> : {};
  if (proposal.kind === "goal_update") {
    updateGoal(goalId, {
      text: typeof payload.text === "string" ? payload.text : undefined,
      mode: payload.mode === "reference" || payload.mode === "tracked" || payload.mode === "managed" || payload.mode === "orchestrated" ? payload.mode : undefined,
      progressSummary: typeof payload.progressSummary === "string" ? payload.progressSummary : undefined,
    }, actorType, actorId);
  } else if (proposal.kind === "focus") {
    createGoalFocus(goalId, { text: String(payload.text ?? proposal.title), ownerAgentId: typeof payload.ownerAgentId === "string" ? payload.ownerAgentId : null }, actorType, actorId);
  } else if (proposal.kind === "item") {
    createGoalItem(goalId, {
      title: String(payload.title ?? proposal.title),
      description: typeof payload.description === "string" ? payload.description : null,
      assignedAgentId: typeof payload.assignedAgentId === "string" ? payload.assignedAgentId : null,
      priority: Number(payload.priority ?? 0) || 0,
    }, actorType, actorId);
  } else if (proposal.kind === "plan") {
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    for (const rawItem of rawItems.slice(0, 20)) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const title = String(item.title ?? "").trim();
      if (!title) continue;
      createGoalItem(goalId, {
        title,
        description: typeof item.description === "string" ? item.description : null,
        assignedAgentId: typeof item.assignedAgentId === "string" ? item.assignedAgentId : null,
        priority: Number(item.priority ?? 0) || 0,
      }, actorType, actorId);
    }
  }
  const now = new Date().toISOString();
  db.prepare("update goal_proposals set status = 'approved', resolved_at = ? where id = ? and goal_id = ?").run(now, proposalId, goalId);
  recordGoalEvent(goalId, "proposal.approved", { proposalId, kind: proposal.kind }, actorType, actorId);
  return goalProposalFromRow(db.prepare("select * from goal_proposals where id = ?").get(proposalId) as Record<string, unknown>);
}

export function rejectGoalProposal(goalId: string, proposalId: string, actorType = "user", actorId?: string | null) {
  const { db } = deps();
  const row = db.prepare("select * from goal_proposals where id = ? and goal_id = ?").get(proposalId, goalId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("goal_proposal_not_found");
  const now = new Date().toISOString();
  db.prepare("update goal_proposals set status = 'rejected', resolved_at = ? where id = ? and goal_id = ? and status = 'pending'").run(now, proposalId, goalId);
  recordGoalEvent(goalId, "proposal.rejected", { proposalId }, actorType, actorId);
  return goalProposalFromRow(db.prepare("select * from goal_proposals where id = ?").get(proposalId) as Record<string, unknown>);
}

export function createDefaultGoalPlan(goalId: string, actorType = "user", actorId?: string | null) {
  const { db } = deps();
  const goal = goalFromRow(db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown>);
  const existing = (db.prepare("select * from goal_items where goal_id = ? and status not in ('cancelled')").all(goalId) as Array<Record<string, unknown>>).map(goalItemFromRow);
  if (existing.length) return existing;
  const roomAgents = goal.ownerType === "room"
    ? (db.prepare("select agent_id from room_agents where room_id = ? order by joined_at asc").all(goal.ownerId) as Array<{ agent_id: string }>).map((row) => row.agent_id)
    : [];
  const templates = [
    { title: "需求澄清与范围确认", description: goal.text, priority: 50, assignedAgentId: roomAgents[0] ?? null },
    { title: "方案设计与任务拆解", description: goal.currentFocus?.text ?? goal.text, priority: 40, assignedAgentId: roomAgents[1] ?? roomAgents[0] ?? null },
    { title: "实现与验证", description: goal.text, priority: 30, assignedAgentId: roomAgents[2] ?? roomAgents[0] ?? null },
    { title: "审查、修正与交付总结", description: goal.text, priority: 20, assignedAgentId: roomAgents[3] ?? roomAgents[0] ?? null },
  ];
  const items = templates.map((item) => createGoalItem(goalId, { ...item, status: "planned" }, actorType, actorId));
  recordGoalEvent(goalId, "goal.planned", { itemIds: items.map((item) => item.id) }, actorType, actorId);
  return items;
}

export function createReplanProposal(goalId: string, itemId: string, status: "blocked" | "failed", actorType = "system", actorId?: string | null) {
  const { db } = deps();
  const item = goalItemFromRow(db.prepare("select * from goal_items where id = ? and goal_id = ?").get(itemId, goalId) as Record<string, unknown>);
  const duplicate = (db.prepare(`
    select id from goal_proposals
    where goal_id = ? and status = 'pending' and kind = 'plan' and json_extract(payload, '$.sourceItemId') = ?
    limit 1
  `).get(goalId, itemId) as { id?: string } | undefined);
  if (duplicate) return null;
  const title = status === "blocked" ? `重新规划阻塞项：${item.title}` : `重新规划失败项：${item.title}`;
  const payload = {
    sourceItemId: item.id,
    sourceStatus: status,
    reason: status === "blocked" ? "Goal item was marked blocked" : "Goal item or linked Room task failed",
    items: [
      {
        title: `诊断并解除阻塞：${item.title}`,
        description: item.description || item.title,
        assignedAgentId: item.assignedAgentId ?? null,
        priority: item.priority + 10,
      },
      {
        title: `验证替代方案：${item.title}`,
        description: "确认重新规划后的方案可以继续推进，并更新 Goal item 状态。",
        assignedAgentId: item.assignedAgentId ?? null,
        priority: item.priority + 5,
      },
    ],
  };
  return createGoalProposal(goalId, { kind: "plan", title, payload, proposedByAgentId: actorType === "agent" ? actorId : null }, actorType, actorId);
}

export function goalDetail(goalId: string): GoalDetailResponse {
  const { db } = deps();
  const row = db.prepare("select * from goals where id = ?").get(goalId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("goal_not_found");
  const focuses = (db.prepare("select * from goal_focuses where goal_id = ? order by updated_at desc, id desc").all(goalId) as Array<Record<string, unknown>>).map(goalFocusFromRow);
  const items = (db.prepare("select * from goal_items where goal_id = ? order by priority desc, updated_at desc, id desc").all(goalId) as Array<Record<string, unknown>>).map(goalItemFromRow);
  const events = (db.prepare("select * from goal_events where goal_id = ? order by created_at desc, id desc limit 80").all(goalId) as Array<Record<string, unknown>>).map(goalEventFromRow);
  const proposals = listGoalProposals(goalId);
  return { goal: goalFromRow(row), focuses, items, events, proposals };
}
