import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type {
  CreateGoalFocusRequest,
  CreateGoalItemRequest,
  CreateGoalRequest,
  RoomTaskSummary,
  UpdateGoalFocusRequest,
  UpdateGoalItemRequest,
  UpdateGoalRequest,
} from "@codex-web/protocol";
import { parsePageLimit } from "../pagination.js";

type GoalRoutesDeps = Record<string, any>;

export function registerGoalRoutes(app: Hono, deps: GoalRoutesDeps) {
  app.get("/api/goals", (c) => {
    const ownerType = deps.goalOwnerType(c.req.query("ownerType"));
    const ownerId = c.req.query("ownerId")?.trim();
    const status = c.req.query("status");
    const limit = parsePageLimit(c.req.query("limit"), 30);
    const rows = deps.db.prepare(`
      select * from goals
      where (@ownerType is null or owner_type = @ownerType)
        and (@ownerId is null or owner_id = @ownerId)
        and (@status is null or status = @status)
      order by updated_at desc, id desc
      limit @limit
    `).all({ ownerType, ownerId: ownerId || null, status: status || null, limit }) as Array<Record<string, unknown>>;
    return c.json(rows.map(deps.goalFromRow));
  });

  app.post("/api/goals", async (c) => {
    const body = await c.req.json<CreateGoalRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body as unknown as Record<string, unknown>);
      if (actor.type === "agent") return c.json({ error: "goal_agent_must_propose" }, 403);
      return c.json(deps.createGoal(body, actor.type, actor.agentId), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_create_failed";
      return c.json({ error: message }, message.endsWith("_not_found") ? 404 : 400);
    }
  });

  app.get("/api/goals/:id", (c) => {
    try {
      return c.json(deps.goalDetail(c.req.param("id")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "goal_not_found" }, 404);
    }
  });

  app.patch("/api/goals/:id", async (c) => {
    const body = await c.req.json<UpdateGoalRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal_update" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body as unknown as Record<string, unknown>);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.updateGoal(c.req.param("id"), body, actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_update_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.delete("/api/goals/:id", (c) => {
    try {
      const actor = deps.goalActorFromRequest(c);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.updateGoal(c.req.param("id"), { status: "cancelled" }, actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_cancel_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.get("/api/goals/:id/events", (c) => {
    const rows = deps.db.prepare("select * from goal_events where goal_id = ? order by created_at desc, id desc limit ?").all(c.req.param("id"), parsePageLimit(c.req.query("limit"), 80)) as Array<Record<string, unknown>>;
    return c.json(rows.map(deps.goalEventFromRow));
  });

  app.post("/api/goals/:id/focuses", async (c) => {
    const body = await c.req.json<CreateGoalFocusRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal_focus" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body as unknown as Record<string, unknown>);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.createGoalFocus(c.req.param("id"), body, actor.type, actor.agentId), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_focus_create_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 400);
    }
  });

  app.patch("/api/goals/:id/focuses/:focusId", async (c) => {
    const body = await c.req.json<UpdateGoalFocusRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal_focus_update" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body as unknown as Record<string, unknown>);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.updateGoalFocus(c.req.param("id"), c.req.param("focusId"), body, actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_focus_update_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.get("/api/goals/:id/items", (c) => {
    const rows = deps.db.prepare("select * from goal_items where goal_id = ? order by priority desc, updated_at desc, id desc").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(deps.goalItemFromRow));
  });

  app.post("/api/goals/:id/items", async (c) => {
    const body = await c.req.json<CreateGoalItemRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal_item" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body as unknown as Record<string, unknown>);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.createGoalItem(c.req.param("id"), body, actor.type, actor.agentId), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_item_create_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 400);
    }
  });

  app.patch("/api/goals/:id/items/:itemId", async (c) => {
    const body = await c.req.json<UpdateGoalItemRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal_item_update" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body as unknown as Record<string, unknown>);
      deps.assertCanUpdateGoalItem(c.req.param("id"), c.req.param("itemId"), actor);
      return c.json(deps.updateGoalItem(c.req.param("id"), c.req.param("itemId"), body, actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_item_update_failed";
      return c.json({ error: message }, message === "goal_item_agent_not_assigned" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.delete("/api/goals/:id/items/:itemId", (c) => {
    try {
      const actor = deps.goalActorFromRequest(c);
      deps.assertCanUpdateGoalItem(c.req.param("id"), c.req.param("itemId"), actor);
      return c.json(deps.updateGoalItem(c.req.param("id"), c.req.param("itemId"), { status: "cancelled" }, actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_item_cancel_failed";
      return c.json({ error: message }, message === "goal_item_agent_not_assigned" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.get("/api/goals/:id/proposals", (c) => {
    return c.json(deps.listGoalProposals(c.req.param("id")));
  });

  app.post("/api/goals/:id/proposals", async (c) => {
    const body = await c.req.json<{ kind?: unknown; title?: unknown; payload?: unknown; proposedByAgentId?: unknown }>().catch(() => null);
    if (!body) return c.json({ error: "invalid_goal_proposal" }, 400);
    try {
      const actor = deps.goalActorFromRequest(c, body);
      return c.json(deps.createGoalProposal(c.req.param("id"), body, actor.type === "agent" ? "agent" : "user", actor.agentId), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_proposal_create_failed";
      return c.json({ error: message }, message === "agent_actor_not_found" ? 403 : 400);
    }
  });

  app.post("/api/goals/:id/proposals/:proposalId/approve", (c) => {
    try {
      const actor = deps.goalActorFromRequest(c);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.applyGoalProposal(c.req.param("id"), c.req.param("proposalId"), actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_proposal_approve_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.post("/api/goals/:id/proposals/:proposalId/reject", (c) => {
    try {
      const actor = deps.goalActorFromRequest(c);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      return c.json(deps.rejectGoalProposal(c.req.param("id"), c.req.param("proposalId"), actor.type, actor.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_proposal_reject_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 404);
    }
  });

  app.post("/api/goals/:id/plan", (c) => {
    try {
      const actor = deps.goalActorFromRequest(c);
      const goal = deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>);
      deps.assertCanManageGoal(goal, actor);
      const items = deps.createDefaultGoalPlan(c.req.param("id"), actor.type, actor.agentId);
      return c.json({ goal: deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown>), items }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_plan_failed";
      return c.json({ error: message }, message === "goal_agent_must_propose" || message === "agent_actor_not_found" ? 403 : 400);
    }
  });

  app.post("/api/goals/:id/orchestrate", (c) => {
    const goalRow = deps.db.prepare("select * from goals where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!goalRow) return c.json({ error: "goal_not_found" }, 404);
    const goal = deps.goalFromRow(goalRow);
    try {
      deps.assertCanManageGoal(goal, deps.goalActorFromRequest(c));
    } catch (error) {
      const message = error instanceof Error ? error.message : "goal_orchestrate_forbidden";
      return c.json({ error: message }, 403);
    }
    if (goal.ownerType !== "room") return c.json({ error: "goal_owner_not_room" }, 400);
    const room = deps.db.prepare("select * from rooms where id = ?").get(goal.ownerId) as Record<string, unknown> | undefined;
    if (!room) return c.json({ error: "room_not_found" }, 404);
    let items = (deps.db.prepare("select * from goal_items where goal_id = ? and room_task_id is null and status not in ('completed', 'cancelled') order by priority desc, updated_at asc").all(goal.id) as Array<Record<string, unknown>>).map(deps.goalItemFromRow) as any[];
    if (!items.length) {
      items = [deps.createGoalItem(goal.id, {
        title: goal.currentFocus?.text || goal.text.slice(0, 120),
        description: goal.currentFocus ? goal.text : null,
        status: "planned",
        assignedAgentId: goal.coordinatorAgentId ?? goal.managerAgentId ?? null,
        priority: 1,
      }, "system")];
    }
    const now = new Date().toISOString();
    const created: RoomTaskSummary[] = [];
    for (const item of items) {
      const assignedAgentId = item.assignedAgentId && deps.db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(goal.ownerId, item.assignedAgentId)
        ? item.assignedAgentId
        : goal.coordinatorAgentId ?? goal.managerAgentId ?? null;
      const taskId = `room-task-${randomUUID()}`;
      deps.db.prepare(`
        insert into room_tasks (id, room_id, goal_item_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?)
      `).run(
        taskId,
        goal.ownerId,
        item.id,
        item.title,
        [item.description, "", `Goal: ${goal.text}`, goal.currentFocus ? `Current focus: ${goal.currentFocus.text}` : ""].filter(Boolean).join("\n"),
        assignedAgentId ? "assigned" : "queued",
        assignedAgentId,
        item.priority,
        JSON.stringify({ source: "goal-orchestrated", goalId: goal.id, goalItemId: item.id }),
        now,
        now,
      );
      deps.updateGoalItem(goal.id, item.id, { roomTaskId: taskId, status: "active", assignedAgentId }, "system");
      const task = deps.roomTaskFromRow(deps.db.prepare("select * from room_tasks where id = ?").get(taskId) as Record<string, unknown>);
      created.push(task);
      deps.roomEvent(goal.ownerId, "goal.task.created", { goalId: goal.id, goalItemId: item.id, taskId, title: item.title }, assignedAgentId);
    }
    deps.recordGoalEvent(goal.id, "goal.orchestrated", { roomId: goal.ownerId, taskIds: created.map((task) => task.id) }, "system");
    if (created.length) deps.orchestrateRoom(goal.ownerId, "goal.orchestrated");
    return c.json({ goal: deps.goalFromRow(deps.db.prepare("select * from goals where id = ?").get(goal.id) as Record<string, unknown>), tasks: created }, 201);
  });
}
