import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import type {
  CodexTaskDetail,
  CodexTaskDiff,
  ContinueCodexTaskRequest,
  CreateCodexTaskRequest,
  CreateSessionCompactionRequest,
  CreateSessionRequest,
  GoalOwnerType,
  MessageCardSummary,
  QueueMessageRequest,
  RecoverCodexTaskRequest,
  ReorderQueuedMessagesRequest,
  RevertWorkspaceFileRequest,
  SessionSummary,
  ProjectSummary,
  ProviderSummary,
  TaskActivityResponse,
  TaskLogResponse,
  UpdateQueuedMessageRequest,
  UpdateSessionCompactionRequest,
  UpdateSessionRequest,
  WorkspaceGitFileRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows, parsePageLimit } from "../pagination.js";

type SavedSessionAttachment = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType?: string;
};

type TaskRoutesDeps = Record<string, any> & {
  appData: {
    sessions: SessionSummary[];
    projects: ProjectSummary[];
    providers: ProviderSummary[];
  };
};

export function registerTaskRoutes(app: Hono, deps: TaskRoutesDeps) {
  const {
    allSessionMessages,
    appendCodexErrorOutput,
    appendSessionMessage,
    applyWorkspaceGitFileAction,
    appData,
    assertWorkspaceChangePath,
    backfillRoomActivitiesFromAgentLogs,
    backfillSessionFromTaskLog,
    backfillTaskActivitiesFromLog,
    clearCodexTaskRuntime,
    collectWorkspaceChanges,
    collectWorkspaceChangesForCwd,
    conversationType,
    createGoal,
    createNotificationEphemeralRule,
    createSessionCompaction,
    db,
    deletePreview,
    deleteQueuedMessage,
    deleteRoomDatabaseRows,
    deleteSessionData,
    deleteSessionDatabaseRows,
    deleteSessionMessages,
    dismissMessageCard,
    enqueueMessage,
    ensureScratchSessionWorkspace,
    executionContextFromRow,
    getCodexTaskProcesses,
    getCodexTaskStopRequested,
    isProcessAlive,
    latestRunningTaskRun,
    latestSessionCompaction,
    listQueuedMessages,
    listRoomTaskContextFiles,
    listSessionCards,
    listSessionCompactions,
    listSessionMessages,
    listTaskActivities,
    listTaskContextFiles,
    listTaskRuns,
    listTaskRunsForSession,
    markTaskRunStopRequested,
    messageWithAttachments,
    promptForDirectAgentSession,
    promptWithAttachments,
    promptWithReplyContext,
    publicPreview,
    readCodexOutput,
    readRoomTaskContextFile,
    readRoomTaskLogContent,
    readTaskContextFile,
    readTaskErrorSummary,
    getReadTaskLogContent,
    reorderQueuedMessages,
    resolveSessionCwd,
    resolveTerminalCwd,
    resolveWorkspaceChangeActionCwd,
    restoreCodexSessionIdFromLog,
    restoreSessionCompaction,
    runGitCommand,
    saveAppData,
    saveSessionAttachments,
    sessionAttachmentsPath,
    sessionHasExistingAutomationOwner,
    startCodexTask,
    updateLatestSessionCompaction,
    updateQueuedMessage,
    upsertSession,
    writeSessionMetadata,
  } = deps;
  const codexTaskProcesses = getCodexTaskProcesses();
  const codexTaskStopRequested = getCodexTaskStopRequested();
  const previews = deps.getPreviews();
  const readTaskLogContent = getReadTaskLogContent();
  app.get("/api/sessions", (c) => {
    const limitQuery = c.req.query("limit");
    const includeAgentChildren = c.req.query("includeAgentChildren") === "true" || c.req.query("includeAgentChildren") === "1";
    const includeAutomations = c.req.query("includeAutomations") === "true" || c.req.query("includeAutomations") === "1";
    const visibleSessions = appData.sessions.filter((session) => {
      if (!includeAgentChildren && session.conversationType === "agent" && session.roomId) return false;
      if (!includeAutomations && session.conversationType === "automation" && sessionHasExistingAutomationOwner(session.id)) return false;
      return true;
    });
    if (!limitQuery && !c.req.query("cursor") && !c.req.query("q") && !c.req.query("projectId") && !c.req.query("status")) return c.json(visibleSessions);
    const limit = parsePageLimit(limitQuery, 30);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const projectId = c.req.query("projectId");
    const status = c.req.query("status");
    const filtered = visibleSessions
      .filter((session) => !q || session.title.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q) || session.id.toLowerCase().includes(q))
      .filter((session) => !projectId || (projectId === "scratch" ? !session.projectId : session.projectId === projectId))
      .filter((session) => !status || session.status === status)
      .filter((session) => !cursor || session.updatedAt < cursor.sortValue || (session.updatedAt === cursor.sortValue && session.id < cursor.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return c.json(pageFromRows(filtered, limit, (item) => item.updatedAt));
  });
  app.get("/api/sessions/:id", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    return c.json(session);
  });
  app.post("/api/sessions", async (c) => {
    const body = await c.req.json<CreateSessionRequest>();
    const requestedProjectId = body.projectId && body.projectId !== "scratch" ? body.projectId : null;
    const project = requestedProjectId ? appData.projects.find((item) => item.id === requestedProjectId) : null;
    if (requestedProjectId && !project) return c.json({ error: "project_not_found" }, 404);
    const id = `task-${randomUUID()}`;
    const session: SessionSummary = {
      id,
      kind: project ? "project" : "scratch",
      conversationType: conversationType(body.conversationType),
      roomId: body.roomId ?? null,
      title: body.title,
      projectId: project?.id ?? null,
      workspacePath: project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id),
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appData.sessions.unshift(session);
    if (body.goal?.text?.trim()) {
      const ownerType: GoalOwnerType = session.conversationType === "agent" ? "agent_session" : "session";
      session.goal = createGoal({ ...body.goal, ownerType, ownerId: session.id }, "user");
    }
    saveAppData();
    return c.json(session, 201);
  });
  app.patch("/api/sessions/:id", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    const body = await c.req.json<UpdateSessionRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_session_update" }, 400);
    if (body.title !== undefined) session.title = body.title.trim() || session.title;
    if (body.notificationsEnabled !== undefined) session.notificationsEnabled = body.notificationsEnabled !== false;
    if (body.showMessageUsage !== undefined) session.showMessageUsage = body.showMessageUsage === true;
    session.updatedAt = new Date().toISOString();
    upsertSession(session);
    return c.json(session);
  });
  app.delete("/api/sessions/:id", (c) => {
    const index = appData.sessions.findIndex((item) => item.id === c.req.param("id"));
    if (index === -1) return c.json({ error: "session_not_found" }, 404);
    const [session] = appData.sessions.splice(index, 1);
    const deleteWorkspace = c.req.query("deleteWorkspace") === "true";
    const deleteLogs = c.req.query("deleteLogs") === "true";
    clearCodexTaskRuntime(session.id, true);
    if (!deleteWorkspace) writeSessionMetadata(session);
    if (session.roomId) {
      const childSessions = appData.sessions.filter((item) => item.conversationType === "agent" && item.roomId === session.roomId);
      for (const childSession of childSessions) {
        clearCodexTaskRuntime(childSession.id, true);
        if (!deleteWorkspace) writeSessionMetadata(childSession);
        deleteSessionDatabaseRows(childSession.id);
        deleteSessionData(childSession, deleteWorkspace, deleteLogs);
      }
      appData.sessions = appData.sessions.filter((item) => !(item.conversationType === "agent" && item.roomId === session.roomId));
      deleteRoomDatabaseRows(session.roomId);
    }
    deleteSessionDatabaseRows(session.id);
    deleteSessionData(session, deleteWorkspace, deleteLogs);
    return c.json({ ok: true, id: session.id });
  });
  
  app.post("/api/codex/tasks", async (c) => {
    const body = await c.req.json<CreateCodexTaskRequest>().catch(() => null);
    if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
    const project = body.projectId ? appData.projects.find((item) => item.id === body.projectId) : null;
    const providerId = body.providerId ?? null;
    const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
    const selectedModel = body.model ?? provider?.defaultModel ?? null;
    const id = `task-${randomUUID()}`;
    const workspacePath = body.cwd
      ? resolveTerminalCwd(body.cwd)
      : project?.workspacePath ? resolveTerminalCwd(project.workspacePath) : ensureScratchSessionWorkspace(id);
    const cwd = workspacePath;
    const session: SessionSummary = {
      id,
      kind: project ? "project" : "scratch",
      conversationType: "codex",
      roomId: null,
      title: body.prompt.trim().slice(0, 60),
      projectId: project?.id ?? null,
      workspacePath,
      providerId: provider?.id ?? null,
      model: selectedModel,
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appData.sessions.unshift(session);
    deleteSessionMessages(session.id);
    let attachments: SavedSessionAttachment[] = [];
    try {
      attachments = saveSessionAttachments(session.id, body.attachments);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "attachment_upload_failed" }, 400);
    }
    const userMessage = appendSessionMessage(session.id, "user", messageWithAttachments(body.prompt, attachments));
    for (const notificationRule of body.ephemeralNotifications ?? []) {
      createNotificationEphemeralRule({
        scopeType: "session",
        scopeId: session.id,
        eventTypes: notificationRule.eventTypes,
        targets: notificationRule.targets,
        expireMode: notificationRule.expireMode,
      });
    }
    saveAppData();
    startCodexTask(session, promptWithAttachments(body.prompt, attachments), cwd, provider, selectedModel, true, attachments.length ? [sessionAttachmentsPath(session.id)] : [], { currentMessageId: userMessage.id });
    return c.json(session, 201);
  });
  app.get("/api/codex/tasks/:id", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    restoreCodexSessionIdFromLog(session);
    if (session.status !== "running") backfillSessionFromTaskLog(session);
    const output = readCodexOutput(session.id);
    const response: CodexTaskDetail = {
      session,
      messages: allSessionMessages(session.id),
      output: output.output,
      exitCode: output.exitCode,
      errorSummary: output.exitCode && output.exitCode !== 0 ? readTaskErrorSummary(session.id) : undefined,
    };
    return c.json(response);
  });
  app.get("/api/codex/tasks/:id/log", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const maxBytes = Math.min(Number(c.req.query("maxBytes") ?? 80_000), 300_000);
    let log = "";
    try {
      const content = session.conversationType === "room" ? readRoomTaskLogContent(session, maxBytes) : readTaskLogContent(session.id);
      log = content.length > maxBytes ? content.slice(content.length - maxBytes) : content;
    } catch {
      log = "";
    }
    const response: TaskLogResponse = { sessionId: session.id, log };
    return c.json(response);
  });
  app.get("/api/codex/tasks/:id/context", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    if (session.conversationType === "room") return c.json(listRoomTaskContextFiles(session));
    return c.json(listTaskContextFiles(session.id));
  });
  app.get("/api/codex/tasks/:id/context/:file", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    try {
      if (session.conversationType === "room") return c.json(readRoomTaskContextFile(session, c.req.param("file")));
      return c.json(readTaskContextFile(session.id, c.req.param("file")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "context_file_not_found" }, 404);
    }
  });
  app.get("/api/codex/tasks/:id/activity", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    if (!listTaskActivities(session.id, 1).items.length) backfillTaskActivitiesFromLog(session.id);
    if (!listTaskActivities(session.id, 1).items.length) backfillRoomActivitiesFromAgentLogs(session);
    const page = listTaskActivities(session.id, parsePageLimit(c.req.query("limit"), 30), c.req.query("cursor"));
    const response: TaskActivityResponse = {
      sessionId: session.id,
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
    return c.json(response);
  });
  app.get("/api/codex/tasks/:id/runs", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    return c.json(listTaskRunsForSession(session.id, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor")));
  });
  app.get("/api/task-runs", (c) => {
    const status = c.req.query("status");
    return c.json(listTaskRuns(status, parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor")));
  });
  app.get("/api/execution-contexts", (c) => {
    const sessionId = c.req.query("sessionId");
    const agentId = c.req.query("agentId");
    const limit = parsePageLimit(c.req.query("limit"), 50);
    const session = sessionId ? appData.sessions.find((item) => item.id === sessionId) : null;
    const rows = db.prepare(`
      select * from execution_contexts
      where (
          @sessionId is null
          or session_id = @sessionId
          or (@roomId is not null and room_id = @roomId)
        )
        and (@agentId is null or agent_id = @agentId)
      order by created_at desc, id desc
      limit @limit
    `).all({ sessionId: sessionId || null, roomId: session?.conversationType === "room" ? session.roomId : null, agentId: agentId || null, limit }) as Array<Record<string, unknown>>;
    return c.json(rows.map(executionContextFromRow));
  });
  app.get("/api/sessions/:id/messages", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    if (session.status !== "running") backfillSessionFromTaskLog(session);
    return c.json(listSessionMessages(session.id, Number(c.req.query("limit") ?? 20), c.req.query("before") || undefined));
  });
  app.get("/api/sessions/:id/compaction", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    const latest = latestSessionCompaction(session.id);
    if (!latest) return c.json({ compaction: null, summary: "" });
    const summary = existsSync(latest.filePath) ? readFileSync(latest.filePath, "utf8") : "";
    return c.json({ compaction: latest, summary });
  });
  app.get("/api/sessions/:id/compactions", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    return c.json(listSessionCompactions(session.id, Number(c.req.query("limit") ?? 20)));
  });
  app.patch("/api/sessions/:id/compaction", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    const body = await c.req.json<UpdateSessionCompactionRequest>().catch(() => null);
    try {
      return c.json(updateLatestSessionCompaction(session, String(body?.summary ?? "")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "session_compaction_update_failed" }, 400);
    }
  });
  app.post("/api/sessions/:id/compactions/:compactionId/restore", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    try {
      return c.json(restoreSessionCompaction(session, c.req.param("compactionId")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "session_compaction_restore_failed" }, 400);
    }
  });
  app.post("/api/sessions/:id/compact", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    const body = await c.req.json<CreateSessionCompactionRequest>().catch(() => null);
    try {
      return c.json(await createSessionCompaction(session, body));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "session_compaction_failed" }, 400);
    }
  });
  app.get("/api/sessions/:id/cards", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    return c.json(listSessionCards(session.id));
  });
  app.delete("/api/sessions/:id/cards/:cardId", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "session_not_found" }, 404);
    const cardId = c.req.param("cardId");
    if (cardId.startsWith("preview:")) {
      const previewId = cardId.slice("preview:".length);
      const preview = previews.get(previewId);
      if (!preview || preview.scopeType !== "session" || preview.scopeId !== session.id) return c.json({ error: "card_not_found" }, 404);
      dismissMessageCard(session.id, "preview", publicPreview(preview));
      deletePreview(previewId);
      db.prepare("delete from message_cards where session_id = ? and json_extract(payload, '$.previewId') = ?").run(session.id, previewId);
      return c.json({ ok: true, id: cardId });
    }
    const cardRow = db.prepare(`
      select type, payload
      from message_cards
      where id = ? and session_id = ?
    `).get(cardId, session.id) as { type: MessageCardSummary["type"]; payload: string } | undefined;
    if (!cardRow) return c.json({ error: "card_not_found" }, 404);
    let payload: unknown = {};
    try {
      payload = JSON.parse(cardRow.payload);
    } catch {
      payload = {};
    }
    dismissMessageCard(session.id, cardRow.type, payload);
    const result = db.prepare("delete from message_cards where id = ? and session_id = ?").run(cardId, session.id);
    if (!result.changes) return c.json({ error: "card_not_found" }, 404);
    return c.json({ ok: true, id: cardId });
  });
  app.get("/api/codex/tasks/:id/queue", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    return c.json(listQueuedMessages(session.id));
  });
  app.post("/api/codex/tasks/:id/queue", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<QueueMessageRequest>().catch(() => null);
    if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
    return c.json(enqueueMessage(session, body), 201);
  });
  app.patch("/api/codex/tasks/:id/queue/:queueId", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<UpdateQueuedMessageRequest>().catch(() => null);
    if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
    const item = updateQueuedMessage(session, c.req.param("queueId"), body);
    if (!item) return c.json({ error: "queued_message_not_found" }, 404);
    return c.json(item);
  });
  app.patch("/api/codex/tasks/:id/queue", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<ReorderQueuedMessagesRequest>().catch(() => null);
    if (!Array.isArray(body?.orderedIds)) return c.json({ error: "ordered_ids_required" }, 400);
    const queue = reorderQueuedMessages(session, body.orderedIds);
    if (!queue) return c.json({ error: "queued_message_order_mismatch" }, 409);
    return c.json(queue);
  });
  app.delete("/api/codex/tasks/:id/queue/:queueId", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    deleteQueuedMessage(session, c.req.param("queueId"));
    return c.json({ ok: true });
  });
  app.get("/api/codex/tasks/:id/diff", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const cwd = resolveSessionCwd(session);
    const status = await runGitCommand(cwd, ["status", "--short", "--", "."]);
    if (status.exitCode !== 0) {
      const response: CodexTaskDiff = { ok: false, cwd, status: "", stat: "", diff: "", error: status.stderr || "git_status_failed" };
      return c.json(response);
    }
    const stat = await runGitCommand(cwd, ["diff", "--relative", "--stat", "--", "."]);
    const diff = await runGitCommand(cwd, ["diff", "--", "."]);
    const response: CodexTaskDiff = {
      ok: true,
      cwd,
      status: status.stdout,
      stat: stat.stdout,
      diff: diff.stdout,
      error: stat.exitCode === 0 && diff.exitCode === 0 ? undefined : stat.stderr || diff.stderr || "git_diff_failed",
    };
    return c.json(response);
  });
  app.get("/api/codex/tasks/:id/changes", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    return c.json(await collectWorkspaceChanges(session));
  });
  app.post("/api/codex/tasks/:id/changes/revert-file", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<RevertWorkspaceFileRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "path_required" }, 400);
    try {
      const cwd = resolveWorkspaceChangeActionCwd(session, body.cwd);
      const changes = await collectWorkspaceChangesForCwd(cwd);
      const { change, absolutePath } = assertWorkspaceChangePath(changes, body.path);
      if (change.status === "??") {
        const stat = statSync(absolutePath);
        if (!stat.isFile()) return c.json({ error: "untracked_directories_not_supported" }, 400);
        rmSync(absolutePath);
      } else {
        const result = await runGitCommand(changes.cwd, ["checkout", "--", body.path]);
        if (result.exitCode !== 0) return c.json({ error: result.stderr || "git_checkout_failed" }, 400);
      }
      return c.json(await collectWorkspaceChanges(session));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "revert_failed" }, 400);
    }
  });
  app.post("/api/codex/tasks/:id/changes/stage-file", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "path_required" }, 400);
    try {
      await applyWorkspaceGitFileAction(resolveWorkspaceChangeActionCwd(session, body.cwd), body.path, "stage");
      return c.json(await collectWorkspaceChanges(session));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "git_stage_failed" }, 400);
    }
  });
  app.post("/api/codex/tasks/:id/changes/unstage-file", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "path_required" }, 400);
    try {
      await applyWorkspaceGitFileAction(resolveWorkspaceChangeActionCwd(session, body.cwd), body.path, "unstage");
      return c.json(await collectWorkspaceChanges(session));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "git_unstage_failed" }, 400);
    }
  });
  app.post("/api/codex/tasks/:id/stop", (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const child = codexTaskProcesses.get(session.id);
    const running = latestRunningTaskRun(session.id);
    const runnerPid = typeof running?.pid === "number" ? running.pid : null;
    if (!child && !isProcessAlive(runnerPid)) {
      session.status = session.status === "running" ? "paused" : session.status;
      session.updatedAt = new Date().toISOString();
      saveAppData();
      return c.json(session);
    }
    codexTaskStopRequested.add(session.id);
    markTaskRunStopRequested(session.id);
    if (child) child.kill("SIGTERM");
    else if (runnerPid) process.kill(runnerPid, "SIGTERM");
    session.status = "paused";
    session.updatedAt = new Date().toISOString();
    saveAppData();
    appendCodexErrorOutput(session, "\n[task stopped]\n");
    appendSessionMessage(session.id, "assistant", `用户主动停止任务。停止时间：${new Date().toISOString()}。待发送队列：${listQueuedMessages(session.id).length} 条。`);
    return c.json(session);
  });
  app.post("/api/codex/tasks/:id/recover", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    if (codexTaskProcesses.has(session.id) || session.status === "running") return c.json({ error: "task_running" }, 409);
    restoreCodexSessionIdFromLog(session);
    const body = await c.req.json<RecoverCodexTaskRequest>().catch(() => null);
    const prompt = body?.prompt?.trim() || "Recover the interrupted task from the current conversation, task log, workspace files, and Git changes. Summarize completed and pending work first, then continue with the next concrete step.";
    const providerId = body?.providerId ?? session.providerId ?? null;
    const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
    const selectedModel = body?.model ?? session.model ?? provider?.defaultModel ?? null;
    session.providerId = provider?.id ?? null;
    session.model = selectedModel;
    session.status = "running";
    session.updatedAt = new Date().toISOString();
    const userMessage = appendSessionMessage(session.id, "user", prompt);
    saveAppData();
    startCodexTask(session, prompt, resolveSessionCwd(session), provider, selectedModel, false, [], { currentMessageId: userMessage.id });
    const response: CodexTaskDetail = {
      session,
      messages: allSessionMessages(session.id),
      output: readCodexOutput(session.id).output,
      exitCode: null,
    };
    return c.json(response, 202);
  });
  app.post("/api/codex/tasks/:id/messages", async (c) => {
    const session = appData.sessions.find((item) => item.id === c.req.param("id"));
    if (!session) return c.json({ error: "task_not_found" }, 404);
    const body = await c.req.json<ContinueCodexTaskRequest>().catch(() => null);
    if (!body?.prompt?.trim()) return c.json({ error: "prompt_required" }, 400);
    restoreCodexSessionIdFromLog(session);
    if (codexTaskProcesses.has(session.id) || session.status === "running") {
      if (body.attachments?.length) return c.json({ error: "attachments_cannot_queue" }, 409);
      return c.json(enqueueMessage(session, body), 202);
    }
    const providerId = body.providerId ?? session.providerId ?? null;
    const provider = providerId ? appData.providers.find((item) => item.id === providerId) : appData.providers[0];
    const selectedModel = body.model ?? session.model ?? provider?.defaultModel ?? null;
    const cwd = resolveSessionCwd(session);
    session.providerId = provider?.id ?? null;
    session.model = selectedModel;
    session.status = "running";
    session.updatedAt = new Date().toISOString();
    let attachments: SavedSessionAttachment[] = [];
    try {
      attachments = saveSessionAttachments(session.id, body.attachments);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "attachment_upload_failed" }, 400);
    }
    const userMessage = appendSessionMessage(session.id, "user", messageWithAttachments(body.prompt, attachments), body.replyToMessageId);
    saveAppData();
    const prompt = promptWithReplyContext(session.id, promptWithAttachments(body.prompt, attachments), body.replyToMessageId);
    startCodexTask(session, promptForDirectAgentSession(session, prompt), cwd, provider, selectedModel, !session.codexSessionId, attachments.length ? [sessionAttachmentsPath(session.id)] : [], {
      currentMessageId: userMessage.id,
      replyToMessageId: body.replyToMessageId,
    });
    return c.json(session);
  });
}
