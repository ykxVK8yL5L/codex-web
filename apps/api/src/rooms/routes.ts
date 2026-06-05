import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  AgentListenMode,
  AgentSummary,
  CreateRoomArtifactRequest,
  CreateRoomDecisionRequest,
  CreateRoomHandoffRequest,
  CreateRoomMessageRequest,
  CreateRoomRequest,
  CreateRoomScheduleRequest,
  CreateRoomTaskRequest,
  GoalItemStatus,
  RoomDecisionSummary,
  RoomEventSummary,
  RoomRunDiffResponse,
  RoomRunMergeResponse,
  SessionSummary,
  ProjectSummary,
  UpdateRoomDecisionRequest,
  UpdateRoomHandoffRequest,
  UpdateRoomRequest,
  UpdateRoomTaskRequest,
} from "@codex-web/protocol";
import { decodeOffsetCursor, decodePageCursor, offsetPageFromRows, pageFromRows, parsePageLimit } from "../pagination.js";

type SavedSessionAttachment = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType?: string;
};

type RoomMemberWithListenMode = { agent: AgentSummary; listenMode: AgentListenMode };

type RoomRoutesDeps = Record<string, any> & {
  appData: {
    sessions: SessionSummary[];
    projects: ProjectSummary[];
  };
  autoListenAgentsForRoomMessage: (roomId: string, limit?: number) => AgentSummary[];
  mentionedRoomAgents: (content: string, agents: AgentSummary[]) => AgentSummary[];
  roomAgentsWithListenModes: (roomId: string) => RoomMemberWithListenMode[];
  roomEventFromRow: (row: Record<string, unknown>) => RoomEventSummary;
};

export function registerRoomRoutes(app: Hono, deps: RoomRoutesDeps) {
  const {
    agentCircleFromRow,
    agentGroupFromRow,
    agentPermissionsForRun,
    agentRunFromRow,
    appData,
    appendMessageCard,
    appendSessionMessage,
    applyRoomRunMerge,
    approvalAlwaysAllowed,
    autoListenAgentsForRoomMessage,
    createAgentGroupFromCircle,
    createGoal,
    createRoomArtifact,
    createRoomDecision,
    createRoomHandoff,
    createRoomRunMergeApproval,
    db,
    ensureScratchSessionWorkspace,
    getCodexTaskProcesses,
    getCodexTaskStopRequested,
    insertRoomTask,
    isProcessAlive,
    listenMode,
    listRooms,
    markTaskRunStopRequested,
    mentionedRoomAgents,
    mentionsRoomUser,
    messageWithAttachments,
    orchestrateRoom,
    promptWithAttachments,
    publicApproval,
    resolveTerminalCwd,
    roomAgentsWithListenModes,
    roomArtifactFromRow,
    roomDecisionFromRow,
    roomEvent,
    roomEventFromRow,
    roomFromRow,
    roomGroupForRoom,
    roomHandoffFromRow,
    roomHandoffStatus,
    roomOrchestrationSettings,
    roomProject,
    roomScheduleFromRow,
    roomStatus,
    roomTaskFromRow,
    runGitSync,
    saveSessionAttachments,
    startRoomTaskRun,
    stopOrphanRoomAgentRun,
    upsertSession,
    updateGoalItem,
  } = deps;
  const codexTaskProcesses = getCodexTaskProcesses();
  const codexTaskStopRequested = getCodexTaskStopRequested();
  app.get("/api/rooms", (c) => c.json(listRooms(c.req.query("status"), parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));
  app.get("/api/rooms/:id", (c) => {
    const row = db.prepare("select * from rooms where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row) return c.json({ error: "room_not_found" }, 404);
    return c.json(roomFromRow(row));
  });
  app.post("/api/rooms", async (c) => {
    const body = await c.req.json<CreateRoomRequest>().catch(() => null);
    if (!body?.name?.trim()) return c.json({ error: "invalid_room" }, 400);
    if (body.groupId && !db.prepare("select id from agent_groups where id = ?").get(body.groupId)) return c.json({ error: "agent_group_not_found" }, 404);
    const circle = body.circleId ? db.prepare("select * from agent_circles where id = ?").get(body.circleId) as Record<string, unknown> | undefined : null;
    if (body.circleId && !circle) return c.json({ error: "agent_circle_not_found" }, 404);
    let groupId = body.groupId ?? (circle?.group_template_id ? String(circle.group_template_id) : null);
    if (!groupId && circle) {
      try {
        groupId = createAgentGroupFromCircle(agentCircleFromRow(circle)).id;
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "agent_circle_group_create_failed" }, 400);
      }
    }
    const now = new Date().toISOString();
    const id = `room-${randomUUID()}`;
    const project = body.projectId ? appData.projects.find((item) => item.id === body.projectId) : null;
    const sessionId = `task-${randomUUID()}`;
    const session: SessionSummary = {
      id: sessionId,
      kind: project ? "project" : "scratch",
      conversationType: "room",
      roomId: id,
      title: body.name.trim(),
      projectId: project?.id ?? null,
      workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(sessionId),
      status: "paused",
      createdAt: now,
      updatedAt: now,
    };
    appData.sessions.unshift(session);
    upsertSession(session);
    db.prepare(`
      insert into rooms (id, session_id, name, group_id, circle_id, project_id, status, shared_context, orchestration_settings, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(id, sessionId, body.name.trim(), groupId, body.circleId ?? null, project?.id ?? null, body.sharedContext?.trim() || null, JSON.stringify(roomOrchestrationSettings({})), now, now);
    if (body.goal?.text?.trim()) {
      session.goal = createGoal({ ...body.goal, ownerType: "room", ownerId: id, mode: body.goal.mode ?? "orchestrated" }, "user");
    }
    const group = groupId ? agentGroupFromRow(db.prepare("select * from agent_groups where id = ?").get(groupId) as Record<string, unknown>) : null;
    const insertRoomAgent = db.prepare("insert or ignore into room_agents (room_id, agent_id, listen_mode) values (?, ?, ?)");
    for (const agentId of group?.agentIds ?? []) insertRoomAgent.run(id, agentId, listenMode(group?.memberListenModes?.[agentId]));
    roomEvent(id, "room.created", { name: body.name });
    return c.json(roomFromRow(db.prepare("select * from rooms where id = ?").get(id) as Record<string, unknown>), 201);
  });
  app.patch("/api/rooms/:id", async (c) => {
    const current = db.prepare("select * from rooms where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<UpdateRoomRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_room_update" }, 400);
    const next = roomFromRow(current);
    const orchestration = roomOrchestrationSettings(current.orchestration_settings, body.orchestration);
    db.prepare("update rooms set name = ?, status = ?, shared_context = ?, orchestration_settings = ?, updated_at = ? where id = ?").run(
      body.name?.trim() || next.name,
      roomStatus(body.status, next.status),
      body.sharedContext !== undefined ? body.sharedContext?.trim() || null : next.sharedContext ?? null,
      JSON.stringify(orchestration),
      new Date().toISOString(),
      next.id,
    );
    return c.json(roomFromRow(db.prepare("select * from rooms where id = ?").get(next.id) as Record<string, unknown>));
  });
  app.get("/api/rooms/:id/agents", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    return c.json(roomAgentsWithListenModes(c.req.param("id")).map((member) => ({ ...member.agent, listenMode: member.listenMode })));
  });
  app.post("/api/rooms/:id/agents", async (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<{ agentId?: string; listenMode?: AgentListenMode }>().catch(() => null);
    const agentId = body?.agentId?.trim() ?? "";
    if (!agentId || !db.prepare("select id from agents where id = ?").get(agentId)) return c.json({ error: "agent_not_found" }, 404);
    const mode = listenMode(body?.listenMode);
    db.prepare("insert into room_agents (room_id, agent_id, listen_mode) values (?, ?, ?) on conflict(room_id, agent_id) do update set listen_mode = excluded.listen_mode").run(c.req.param("id"), agentId, mode);
    roomEvent(c.req.param("id"), "room.agent.added", { agentId, listenMode: mode }, agentId);
    return c.json(roomAgentsWithListenModes(c.req.param("id")).map((member) => ({ ...member.agent, listenMode: member.listenMode })), 201);
  });
  app.patch("/api/rooms/:id/agents/:agentId", async (c) => {
    const body = await c.req.json<{ listenMode?: AgentListenMode }>().catch(() => null);
    const mode = listenMode(body?.listenMode);
    const result = db.prepare("update room_agents set listen_mode = ? where room_id = ? and agent_id = ?").run(mode, c.req.param("id"), c.req.param("agentId"));
    if (!result.changes) return c.json({ error: "room_agent_not_found" }, 404);
    roomEvent(c.req.param("id"), "room.agent.listen_mode.updated", { agentId: c.req.param("agentId"), listenMode: mode }, c.req.param("agentId"));
    return c.json(roomAgentsWithListenModes(c.req.param("id")).map((member) => ({ ...member.agent, listenMode: member.listenMode })));
  });
  app.get("/api/rooms/:id/events", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const limit = parsePageLimit(c.req.query("limit"), 50);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const rows = db.prepare(`
      select * from room_events
      where room_id = @roomId
        ${cursor ? "and (created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))" : ""}
      order by created_at desc, id desc
      limit @limit
    `).all({ roomId: c.req.param("id"), cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
    return c.json(pageFromRows(rows.map(roomEventFromRow), limit, (item) => item.createdAt));
  });
  app.get("/api/rooms/:id/artifacts", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    if (c.req.query("limit") || c.req.query("cursor")) {
      const limit = parsePageLimit(c.req.query("limit"), 30);
      const offset = decodeOffsetCursor(c.req.query("cursor"));
      const rows = db.prepare("select * from room_artifacts where room_id = ? order by created_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
      return c.json(offsetPageFromRows(rows.map(roomArtifactFromRow), limit, offset));
    }
    const rows = db.prepare("select * from room_artifacts where room_id = ? order by created_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(roomArtifactFromRow));
  });
  app.post("/api/rooms/:id/artifacts", async (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<CreateRoomArtifactRequest>().catch(() => null);
    if (!body?.title?.trim() || !body.kind) return c.json({ error: "invalid_room_artifact" }, 400);
    if (body.agentId && !db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.agentId)) {
      return c.json({ error: "agent_not_in_room" }, 400);
    }
    return c.json(createRoomArtifact(c.req.param("id"), {
      agentId: body.agentId ?? null,
      kind: body.kind,
      title: body.title.trim(),
      payload: body.payload ?? {},
    }), 201);
  });
  app.get("/api/rooms/:id/decisions", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    if (c.req.query("limit") || c.req.query("cursor")) {
      const limit = parsePageLimit(c.req.query("limit"), 30);
      const offset = decodeOffsetCursor(c.req.query("cursor"));
      const rows = db.prepare("select * from room_decisions where room_id = ? order by created_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
      return c.json(offsetPageFromRows(rows.map(roomDecisionFromRow), limit, offset));
    }
    const rows = db.prepare("select * from room_decisions where room_id = ? order by created_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(roomDecisionFromRow));
  });
  app.post("/api/rooms/:id/decisions", async (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<CreateRoomDecisionRequest>().catch(() => null);
    if (!body?.title?.trim()) return c.json({ error: "invalid_room_decision" }, 400);
    const status = ["open", "approved", "rejected", "resolved"].includes(String(body.status)) ? body.status as RoomDecisionSummary["status"] : "open";
    return c.json(createRoomDecision(c.req.param("id"), {
      title: body.title.trim(),
      status,
      payload: body.payload ?? {},
      resolvedAt: status !== "open" ? new Date().toISOString() : null,
    }), 201);
  });
  app.patch("/api/rooms/:id/decisions/:decisionId", async (c) => {
    const roomId = c.req.param("id");
    const decisionId = c.req.param("decisionId");
    const current = db.prepare("select * from room_decisions where room_id = ? and id = ?").get(roomId, decisionId) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "decision_not_found" }, 404);
    const body = await c.req.json<UpdateRoomDecisionRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_room_decision" }, 400);
    const currentDecision = roomDecisionFromRow(current);
    const title = typeof body.title === "string" ? body.title.trim() : currentDecision.title;
    if (!title) return c.json({ error: "invalid_room_decision" }, 400);
    const status = body.status && ["open", "approved", "rejected", "resolved"].includes(body.status) ? body.status : currentDecision.status;
    const resolvedAt = status === "open" ? null : (currentDecision.resolvedAt ?? new Date().toISOString());
    const payload = Object.prototype.hasOwnProperty.call(body, "payload") ? body.payload : currentDecision.payload;
    db.prepare("update room_decisions set title = ?, status = ?, payload = ?, resolved_at = ? where room_id = ? and id = ?")
      .run(title, status, JSON.stringify(payload ?? {}), resolvedAt, roomId, decisionId);
    roomEvent(roomId, "decision.updated", { decisionId, title, status });
    const updated = db.prepare("select * from room_decisions where room_id = ? and id = ?").get(roomId, decisionId) as Record<string, unknown>;
    return c.json(roomDecisionFromRow(updated));
  });
  app.get("/api/rooms/:id/handoffs", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    if (c.req.query("limit") || c.req.query("cursor")) {
      const limit = parsePageLimit(c.req.query("limit"), 30);
      const offset = decodeOffsetCursor(c.req.query("cursor"));
      const rows = db.prepare("select * from room_handoffs where room_id = ? order by created_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
      return c.json(offsetPageFromRows(rows.map(roomHandoffFromRow), limit, offset));
    }
    const rows = db.prepare("select * from room_handoffs where room_id = ? order by created_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(roomHandoffFromRow));
  });
  app.post("/api/rooms/:id/handoffs", async (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<CreateRoomHandoffRequest>().catch(() => null);
    if (!body?.summary?.trim()) return c.json({ error: "invalid_room_handoff" }, 400);
    const status = roomHandoffStatus(body.status);
    return c.json(createRoomHandoff(c.req.param("id"), {
      fromAgentId: body.fromAgentId ?? null,
      toAgentId: body.toAgentId ?? null,
      summary: body.summary.trim(),
      status,
      payload: body.payload ?? {},
      resolvedAt: status !== "open" ? new Date().toISOString() : null,
    }), 201);
  });
  app.patch("/api/rooms/:id/handoffs/:handoffId", async (c) => {
    const roomId = c.req.param("id");
    const handoffId = c.req.param("handoffId");
    const current = db.prepare("select * from room_handoffs where room_id = ? and id = ?").get(roomId, handoffId) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "handoff_not_found" }, 404);
    const body = await c.req.json<UpdateRoomHandoffRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_room_handoff" }, 400);
    const currentHandoff = roomHandoffFromRow(current);
    const summary = typeof body.summary === "string" ? body.summary.trim() : currentHandoff.summary;
    if (!summary) return c.json({ error: "invalid_room_handoff" }, 400);
    const status = body.status ? roomHandoffStatus(body.status) : currentHandoff.status;
    const resolvedAt = status === "open" ? null : (currentHandoff.resolvedAt ?? new Date().toISOString());
    const payload = Object.prototype.hasOwnProperty.call(body, "payload") ? body.payload : currentHandoff.payload;
    db.prepare(`
      update room_handoffs
      set from_agent_id = ?, to_agent_id = ?, summary = ?, status = ?, payload = ?, resolved_at = ?
      where room_id = ? and id = ?
    `).run(
      Object.prototype.hasOwnProperty.call(body, "fromAgentId") ? body.fromAgentId ?? null : currentHandoff.fromAgentId ?? null,
      Object.prototype.hasOwnProperty.call(body, "toAgentId") ? body.toAgentId ?? null : currentHandoff.toAgentId ?? null,
      summary,
      status,
      JSON.stringify(payload ?? {}),
      resolvedAt,
      roomId,
      handoffId,
    );
    roomEvent(roomId, "handoff.updated", { handoffId, status });
    const updated = db.prepare("select * from room_handoffs where room_id = ? and id = ?").get(roomId, handoffId) as Record<string, unknown>;
    return c.json(roomHandoffFromRow(updated));
  });
  app.post("/api/rooms/:id/messages", async (c) => {
    const room = db.prepare("select id, session_id from rooms where id = ?").get(c.req.param("id")) as { id: string; session_id?: string | null } | undefined;
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<CreateRoomMessageRequest>().catch(() => null);
    const content = body?.content?.trim() ?? "";
    if (!content) return c.json({ error: "message_required" }, 400);
    const roomId = c.req.param("id");
    const requestedSession = body?.sessionId ? appData.sessions.find((item) => item.id === body.sessionId && item.roomId === roomId) : null;
    const linkedSession = room.session_id ? appData.sessions.find((item) => item.id === room.session_id) : null;
    const fallbackSession = appData.sessions.find((item) => item.roomId === roomId) ?? null;
    const session = requestedSession ?? linkedSession ?? fallbackSession;
    let attachments: SavedSessionAttachment[] = [];
    if (session) {
      try {
        attachments = saveSessionAttachments(session.id, body?.attachments);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "attachment_upload_failed" }, 400);
      }
    }
    const contentWithAttachments = messageWithAttachments(content, attachments);
    const promptContent = promptWithAttachments(content, attachments);
    const message = session ? appendSessionMessage(session.id, "user", contentWithAttachments, body?.replyToMessageId ?? null) : null;
    if (session) {
      session.updatedAt = message?.createdAt ?? new Date().toISOString();
      upsertSession(session);
      if (room.session_id !== session.id) db.prepare("update rooms set session_id = ?, updated_at = ? where id = ?").run(session.id, session.updatedAt, roomId);
    }
    const members = roomAgentsWithListenModes(roomId);
    const mentionableAgents = members.filter((member) => member.listenMode !== "none").map((member) => member.agent);
    const mentionedAgents = mentionedRoomAgents(content, mentionableAgents);
    const mentionsUser = mentionsRoomUser(content);
    const orchestration = roomOrchestrationSettings((db.prepare("select orchestration_settings from rooms where id = ?").get(roomId) as { orchestration_settings?: string } | undefined)?.orchestration_settings);
    const autoListenAgents = !mentionedAgents.length && !mentionsUser ? autoListenAgentsForRoomMessage(roomId, orchestration.maxAutoListenTasksPerEvent) : [];
    const tasks = [
      ...mentionedAgents.map((agent) => insertRoomTask(roomId, `@${agent.name}`, promptContent, agent.id, 1, null, { kind: "mention", reason: "user.mentioned", mentionsUser })),
      ...autoListenAgents.map((agent) => insertRoomTask(
        roomId,
        members.find((member) => member.agent.id === agent.id)?.listenMode === "orchestrator" ? `Orchestrate: ${content}`.slice(0, 120) : `Respond: ${content}`.slice(0, 120),
        [
          "Room event: user.message",
          "",
          promptContent,
          "",
          members.find((member) => member.agent.id === agent.id)?.listenMode === "orchestrator"
            ? "As the orchestrator, decide whether the room needs follow-up work and summarize the next step."
            : "You are an active listener in this room. Reply to the room in one concise message. If no action is needed, acknowledge briefly and say you will keep listening.",
        ].join("\n"),
        agent.id,
        members.find((member) => member.agent.id === agent.id)?.listenMode === "orchestrator" ? 2 : 1,
        null,
        { kind: "listen", reason: "user.message", mentionsUser },
      )),
    ];
    const runs = [];
    for (const task of tasks) {
      try {
        runs.push(startRoomTaskRun(roomId, task.id).run);
      } catch {
        // Keep the assigned task visible even if the Agent cannot start immediately.
      }
    }
    const event = roomEvent(roomId, "user.message", { content: contentWithAttachments, messageId: message?.id ?? null, sessionId: session?.id ?? null, replyToMessageId: body?.replyToMessageId ?? null, mentionsUser, mentionedAgentIds: mentionedAgents.map((agent) => agent.id), autoListenAgentIds: autoListenAgents.map((agent) => agent.id), taskIds: tasks.map((task) => task.id) });
    for (const task of tasks) {
      roomEvent(roomId, "agent.mentioned", { content: promptContent, taskId: task.id }, task.assignedAgentId ?? null);
    }
    const routed = orchestrateRoom(roomId, mentionsUser ? "user.mentioned" : "user.message");
    return c.json({ event, message, session: session ?? null, tasks: [...tasks, ...routed.tasks], runs: [...runs, ...routed.runs] }, 201);
  });
  app.get("/api/rooms/:id/runs", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    if (c.req.query("limit") || c.req.query("cursor")) {
      const limit = parsePageLimit(c.req.query("limit"), 30);
      const offset = decodeOffsetCursor(c.req.query("cursor"));
      const rows = db.prepare("select * from agent_runs where room_id = ? order by started_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
      return c.json(offsetPageFromRows(rows.map(agentRunFromRow), limit, offset));
    }
    const rows = db.prepare("select * from agent_runs where room_id = ? order by started_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(agentRunFromRow));
  });
  app.get("/api/rooms/:id/runs/:runId/diff", (c) => {
    const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(c.req.param("runId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!run) return c.json({ error: "agent_run_not_found" }, 404);
    const workspacePath = run.workspace_path ? String(run.workspace_path) : "";
    if (!workspacePath || !existsSync(workspacePath)) return c.json({ error: "workspace_not_found" }, 404);
    const status = runGitSync(workspacePath, ["status", "--short"]);
    const stat = runGitSync(workspacePath, ["diff", "--stat"]);
    const diff = runGitSync(workspacePath, ["diff", "--"]);
    const response: RoomRunDiffResponse = {
      runId: String(run.id),
      ok: status.exitCode === 0 && stat.exitCode === 0 && diff.exitCode === 0,
      workspacePath,
      status: status.stdout,
      stat: stat.stdout,
      diff: diff.stdout,
      error: status.stderr || stat.stderr || diff.stderr || undefined,
    };
    return c.json(response);
  });
  app.post("/api/rooms/:id/runs/:runId/merge", (c) => {
    const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(c.req.param("runId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!run) return c.json({ error: "agent_run_not_found" }, 404);
    const group = roomGroupForRoom(c.req.param("id"));
    const permissions = agentPermissionsForRun(run);
    const strategyRequiresApproval = group?.mergeStrategy.toLowerCase().includes("approval") ?? false;
    const agentRequiresApproval = !permissions.canMergeChanges;
    if ((strategyRequiresApproval || agentRequiresApproval) && !approvalAlwaysAllowed("room-run-merge", { roomId: c.req.param("id") })) {
      const reason = agentRequiresApproval ? "agent permission does not allow direct merge" : `group merge strategy is ${group?.mergeStrategy}`;
      const approval = createRoomRunMergeApproval(c.req.param("id"), c.req.param("runId"), agentRequiresApproval ? "high" : "medium", reason);
      roomEvent(c.req.param("id"), "audit.operation", { action: "merge-approval-requested", runId: c.req.param("runId"), approvalId: approval.id, reason }, run.agent_id ? String(run.agent_id) : null);
      createRoomDecision(c.req.param("id"), {
        title: "Merge approval requested",
        status: "open",
        payload: { approvalId: approval.id, runId: c.req.param("runId"), reason },
      });
      if (run.session_id) {
        appendMessageCard(String(run.session_id), "approval", "Merge approval requested", {
          approvalId: approval.id,
          roomId: c.req.param("id"),
          runId: c.req.param("runId"),
          reason,
          risk: approval.risk,
        });
      }
      return c.json({ error: "approval_required", approval: publicApproval(approval) }, 409);
    }
    try {
      const response = applyRoomRunMerge(c.req.param("id"), c.req.param("runId"));
      return c.json(response, response.ok ? 200 : 409);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "merge_failed" }, 400);
    }
  });
  app.post("/api/rooms/:id/runs/:runId/reject", (c) => {
    const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(c.req.param("runId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!run) return c.json({ error: "agent_run_not_found" }, 404);
    db.prepare(`
      insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
      values (?, ?, ?, ?, 'rejected', 'Rejected by user', ?, ?)
      on conflict(run_id) do update set status = 'rejected', summary = excluded.summary, updated_at = excluded.updated_at
    `).run(c.req.param("runId"), c.req.param("id"), roomProject(c.req.param("id"))?.id ?? null, run.workspace_path ? String(run.workspace_path) : "", new Date().toISOString(), new Date().toISOString());
    roomEvent(c.req.param("id"), "audit.operation", { action: "merge-rejected", runId: c.req.param("runId") }, run.agent_id ? String(run.agent_id) : null);
    const response: RoomRunMergeResponse = { run: agentRunFromRow(run), ok: true };
    return c.json(response);
  });
  app.get("/api/rooms/:id/tasks", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    if (c.req.query("limit") || c.req.query("cursor")) {
      const limit = parsePageLimit(c.req.query("limit"), 30);
      const offset = decodeOffsetCursor(c.req.query("cursor"));
      const rows = db.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
      return c.json(offsetPageFromRows(rows.map(roomTaskFromRow), limit, offset));
    }
    const rows = db.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(roomTaskFromRow));
  });
  app.post("/api/rooms/:id/tasks", async (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<CreateRoomTaskRequest>().catch(() => null);
    if (!body?.title?.trim() || !body.prompt?.trim()) return c.json({ error: "invalid_room_task" }, 400);
    if (body.assignedAgentId && !db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.assignedAgentId)) {
      return c.json({ error: "agent_not_in_room" }, 400);
    }
    const now = new Date().toISOString();
    const id = `room-task-${randomUUID()}`;
    db.prepare(`
      insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      c.req.param("id"),
      body.title.trim(),
      body.prompt.trim(),
      body.assignedAgentId ? "assigned" : "queued",
      body.assignedAgentId ?? null,
      Number(body.priority ?? 0) || 0,
      body.dependsOnTaskId ?? null,
      body.scheduledAt ?? null,
      JSON.stringify({}),
      now,
      now,
    );
    roomEvent(c.req.param("id"), "task.created", { taskId: id, title: body.title, scheduledAt: body.scheduledAt ?? null }, body.assignedAgentId ?? null);
    orchestrateRoom(c.req.param("id"), "task.created");
    return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(id) as Record<string, unknown>), 201);
  });
  app.post("/api/rooms/:id/tasks/retry-failed", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const now = new Date().toISOString();
    const tasks = db.prepare(`
      select * from room_tasks
      where room_id = ? and assigned_agent_id is not null and status in ('failed', 'cancelled')
      order by priority desc, updated_at desc
    `).all(c.req.param("id")) as Array<Record<string, unknown>>;
    for (const task of tasks) {
      db.prepare("update room_tasks set status = 'assigned', started_at = null, finished_at = null, updated_at = ? where id = ?").run(now, String(task.id));
      if (task.goal_item_id) {
        const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
        if (item?.goal_id) updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status: "active" }, "system");
      }
      roomEvent(c.req.param("id"), "task.retry", { taskId: String(task.id), batch: true }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
    }
    if (tasks.length) orchestrateRoom(c.req.param("id"), "task.retry");
    return c.json({ ok: true, retried: tasks.length });
  });
  app.patch("/api/rooms/:id/tasks/:taskId", async (c) => {
    const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!task) return c.json({ error: "room_task_not_found" }, 404);
    const body = await c.req.json<UpdateRoomTaskRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_room_task_update" }, 400);
    if (String(task.status) === "running" && body.status !== "cancelled") return c.json({ error: "room_task_running" }, 409);
    if (body.assignedAgentId && !db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.assignedAgentId)) {
      return c.json({ error: "agent_not_in_room" }, 400);
    }
    if (body.dependsOnTaskId && !db.prepare("select id from room_tasks where room_id = ? and id = ?").get(c.req.param("id"), body.dependsOnTaskId)) {
      return c.json({ error: "dependency_not_found" }, 400);
    }
    const nextStatus = body.status ?? (body.assignedAgentId !== undefined && body.assignedAgentId ? "assigned" : String(task.status));
    db.prepare(`
      update room_tasks
      set title = ?, prompt = ?, assigned_agent_id = ?, status = ?, priority = ?, depends_on_task_id = ?, updated_at = ?
      where id = ? and room_id = ?
    `).run(
      body.title?.trim() || String(task.title),
      body.prompt?.trim() || String(task.prompt ?? ""),
      body.assignedAgentId !== undefined ? body.assignedAgentId || null : task.assigned_agent_id ?? null,
      nextStatus,
      Number(body.priority ?? task.priority ?? 0) || 0,
      body.dependsOnTaskId !== undefined ? body.dependsOnTaskId || null : task.depends_on_task_id ?? null,
      new Date().toISOString(),
      c.req.param("taskId"),
      c.req.param("id"),
    );
    if (task.goal_item_id && (nextStatus === "done" || nextStatus === "failed" || nextStatus === "cancelled")) {
      const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
      if (item?.goal_id) {
        const status: GoalItemStatus = nextStatus === "done" ? "completed" : nextStatus === "cancelled" ? "cancelled" : "failed";
        updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status }, "system");
      }
    }
    roomEvent(c.req.param("id"), "task.updated", { taskId: c.req.param("taskId"), status: nextStatus }, body.assignedAgentId !== undefined ? body.assignedAgentId : task.assigned_agent_id ? String(task.assigned_agent_id) : null);
    orchestrateRoom(c.req.param("id"), "task.updated");
    return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(c.req.param("taskId")) as Record<string, unknown>));
  });
  app.post("/api/rooms/:id/tasks/:taskId/cancel", (c) => {
    const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!task) return c.json({ error: "room_task_not_found" }, 404);
    const run = db.prepare("select * from agent_runs where task_id = ? and status = 'running'").get(c.req.param("taskId")) as Record<string, unknown> | undefined;
    if (run?.session_id) {
      const sessionId = String(run.session_id);
      const child = codexTaskProcesses.get(sessionId);
      codexTaskStopRequested.add(sessionId);
      markTaskRunStopRequested(sessionId);
      if (child) {
        child.kill("SIGTERM");
      } else if (isProcessAlive(run.pid === null || run.pid === undefined ? null : Number(run.pid))) {
        process.kill(Number(run.pid), "SIGTERM");
      } else {
        stopOrphanRoomAgentRun(sessionId);
      }
    }
    const now = new Date().toISOString();
    db.prepare("update room_tasks set status = 'cancelled', finished_at = ?, updated_at = ? where id = ?").run(now, now, c.req.param("taskId"));
    if (task.goal_item_id) {
      const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
      if (item?.goal_id) updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status: "cancelled" }, "system");
    }
    roomEvent(c.req.param("id"), "task.cancelled", { taskId: c.req.param("taskId") }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
    roomEvent(c.req.param("id"), "audit.operation", { action: "task-cancelled", taskId: c.req.param("taskId"), runId: run?.id ?? null }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
    return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(c.req.param("taskId")) as Record<string, unknown>));
  });
  app.post("/api/rooms/:id/tasks/:taskId/retry", (c) => {
    const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!task) return c.json({ error: "room_task_not_found" }, 404);
    if (!task.assigned_agent_id) return c.json({ error: "room_task_unassigned" }, 400);
    db.prepare("update room_tasks set status = 'assigned', started_at = null, finished_at = null, updated_at = ? where id = ?").run(new Date().toISOString(), c.req.param("taskId"));
    if (task.goal_item_id) {
      const item = db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined;
      if (item?.goal_id) updateGoalItem(String(item.goal_id), String(task.goal_item_id), { status: "active" }, "system");
    }
    roomEvent(c.req.param("id"), "task.retry", { taskId: c.req.param("taskId") }, String(task.assigned_agent_id));
    roomEvent(c.req.param("id"), "audit.operation", { action: "task-retry", taskId: c.req.param("taskId") }, String(task.assigned_agent_id));
    orchestrateRoom(c.req.param("id"), "task.retry");
    return c.json(roomTaskFromRow(db.prepare("select * from room_tasks where id = ?").get(c.req.param("taskId")) as Record<string, unknown>));
  });
  app.post("/api/rooms/:id/tasks/:taskId/start", (c) => {
    try {
      return c.json(startRoomTaskRun(c.req.param("id"), c.req.param("taskId")), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "room_task_start_failed";
      const status = message === "room_not_found" || message === "room_task_not_found" || message === "agent_not_found" || message === "agent_role_not_found" ? 404
        : message === "room_task_not_startable" ? 409
          : 400;
      return c.json({ error: message }, status);
    }
  });
  app.delete("/api/rooms/:id/tasks/:taskId", (c) => {
    const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(c.req.param("taskId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!task) return c.json({ error: "room_task_not_found" }, 404);
    if (String(task.status) === "running") return c.json({ error: "room_task_running" }, 409);
    db.prepare("delete from room_tasks where id = ?").run(c.req.param("taskId"));
    db.prepare("delete from agent_runs where task_id = ? and status != 'running'").run(c.req.param("taskId"));
    roomEvent(c.req.param("id"), "task.deleted", { taskId: c.req.param("taskId"), title: task.title }, task.assigned_agent_id ? String(task.assigned_agent_id) : null);
    return c.json({ ok: true, id: c.req.param("taskId") });
  });
  app.get("/api/rooms/:id/schedules", (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    if (c.req.query("limit") || c.req.query("cursor")) {
      const limit = parsePageLimit(c.req.query("limit"), 30);
      const offset = decodeOffsetCursor(c.req.query("cursor"));
      const rows = db.prepare("select * from room_schedules where room_id = ? order by updated_at desc, id desc limit ? offset ?").all(c.req.param("id"), limit + 1, offset) as Array<Record<string, unknown>>;
      return c.json(offsetPageFromRows(rows.map(roomScheduleFromRow), limit, offset));
    }
    const rows = db.prepare("select * from room_schedules where room_id = ? order by updated_at desc, id desc limit 100").all(c.req.param("id")) as Array<Record<string, unknown>>;
    return c.json(rows.map(roomScheduleFromRow));
  });
  app.post("/api/rooms/:id/schedules", async (c) => {
    const room = db.prepare("select id from rooms where id = ?").get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const body = await c.req.json<CreateRoomScheduleRequest>().catch(() => null);
    if (!body?.agentId || !body.taskPrompt?.trim()) return c.json({ error: "invalid_room_schedule" }, 400);
    if (!db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(c.req.param("id"), body.agentId)) return c.json({ error: "agent_not_in_room" }, 400);
    const now = new Date().toISOString();
    const id = `room-schedule-${randomUUID()}`;
    db.prepare(`
      insert into room_schedules (id, room_id, agent_id, task_prompt, schedule_type, run_at, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, c.req.param("id"), body.agentId, body.taskPrompt.trim(), body.scheduleType, body.runAt ?? null, now, now);
    roomEvent(c.req.param("id"), "schedule.created", { scheduleId: id, scheduleType: body.scheduleType, runAt: body.runAt ?? null }, body.agentId);
    return c.json(roomScheduleFromRow(db.prepare("select * from room_schedules where id = ?").get(id) as Record<string, unknown>), 201);
  });
  app.delete("/api/rooms/:id/schedules/:scheduleId", (c) => {
    const schedule = db.prepare("select * from room_schedules where id = ? and room_id = ?").get(c.req.param("scheduleId"), c.req.param("id")) as Record<string, unknown> | undefined;
    if (!schedule) return c.json({ error: "room_schedule_not_found" }, 404);
    db.prepare("delete from room_schedules where id = ?").run(c.req.param("scheduleId"));
    roomEvent(c.req.param("id"), "schedule.deleted", { scheduleId: c.req.param("scheduleId") }, String(schedule.agent_id));
    return c.json({ ok: true, id: c.req.param("scheduleId") });
  });
}
