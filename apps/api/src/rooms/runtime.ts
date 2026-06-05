import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AgentRunSummary,
  ApprovalRisk,
  GoalItemStatus,
  ProjectSummary,
  RoomRunMergeResponse,
  SessionSummary,
} from "@codex-web/protocol";

type RoomRuntimeDeps = Record<string, any>;

export function createRoomRuntimeService(deps: RoomRuntimeDeps) {
  const {
    agentFromRow,
    agentPermissionsForRun: resolveAgentPermissions,
    agentGroupFromRow,
    agentRoleFromRow,
    agentRunFromRow,
    allSessionMessages,
    appendCodexOutput,
    appendMessageCard,
    appData,
    appendSessionMessage,
    createGoalItem,
    createRoomDecision,
    createRoomArtifact,
    db,
    deleteSessionMessages,
    directAgentForSession,
    ensureRoomRunWorkspace,
    ensureRoomAgentWorkspace,
    ensureScratchSessionWorkspace,
    executionContextFromRow,
    finishTaskRun,
    finishTaskRunById,
    goalFromRow,
    getCodexTaskStopRequested,
    getDefaultAgentPermissions,
    groupContextForRoom,
    jsonPayload,
    latestRunningTaskRun,
    listRoomTasks,
    markTaskRunStopRequested,
    managedChildEnv,
    messageFromRow,
    orchestrateRoom,
    providerForAgent,
    publishTaskEvent,
    publicApproval,
    readCodexOutput,
    readRoomAgentThread,
    recentRoomContext,
    resolveAgentProject,
    resolveTerminalCwd,
    roomAgentsWithListenModes,
    roomEvent,
    roomFromRow,
    roomTaskFromRow,
    saveAppData,
    saveProjectCheckRun,
    scheduleSessionAutoCompaction,
    setTaskRunContext,
    splitProjectCheckCommands,
    startCodexTask,
    taskLogPath,
    toTerminalPath,
    updateGoalItem,
    upsertSession,
  } = deps;

function setRoomParentSessionStatus(roomId: string, status: SessionSummary["status"], updatedAt = new Date().toISOString()) {
  const room = db.prepare("select session_id from rooms where id = ?").get(roomId) as { session_id?: string | null } | undefined;
  if (!room?.session_id) return;
  const parentSession = appData.sessions.find((item: SessionSummary) => item.id === room.session_id);
  if (!parentSession || parentSession.status === status) return;
  parentSession.status = status;
  parentSession.updatedAt = updatedAt;
  upsertSession(parentSession);
  publishTaskEvent(parentSession.id, status === "running" ? { type: "started", session: parentSession } : { type: "done", session: parentSession, exitCode: null });
}

function mentionsRoomUser(value: string) {
  return /(^|\s)@user\b/i.test(value);
}

function roomTaskShouldNotifyUser(roomId?: string | null, taskId?: string | null, assistantContent = "") {
  if (!roomId || !taskId) return false;
  if (mentionsRoomUser(assistantContent)) return true;
  const task = db.prepare("select prompt, payload from room_tasks where room_id = ? and id = ?").get(roomId, taskId) as { prompt?: string; payload?: string | null } | undefined;
  const payload = jsonPayload(task?.payload) as { mentionsUser?: boolean };
  if (payload.mentionsUser === true || mentionsRoomUser(task?.prompt ?? "")) return true;
  const rows = db.prepare("select payload from room_events where room_id = ? order by created_at desc, id desc limit 80").all(roomId) as Array<{ payload?: string | null }>;
  return rows.some((row) => {
    const eventPayload = jsonPayload(row.payload) as { mentionsUser?: boolean; taskIds?: unknown[]; taskId?: unknown };
    if (eventPayload.mentionsUser !== true) return false;
    if (String(eventPayload.taskId ?? "") === taskId) return true;
    return Array.isArray(eventPayload.taskIds) && eventPayload.taskIds.map(String).includes(taskId);
  });
}

function finishAgentRun(sessionId: string, exitCode: number | null, stopped: boolean) {
  const status = stopped ? "stopped" : exitCode === 0 ? "done" : "failed";
  const now = new Date().toISOString();
  const run = db.prepare("select * from agent_runs where session_id = ? and status = 'running'").get(sessionId) as Record<string, unknown> | undefined;
  db.prepare(`
    update agent_runs
    set status = ?, exit_code = ?, finished_at = ?
    where session_id = ? and status = 'running'
  `).run(status, exitCode, now, sessionId);
  if (run?.task_id) {
    const taskStatus = status === "done" ? "done" : status === "stopped" ? "cancelled" : "failed";
    db.prepare("update room_tasks set status = ?, finished_at = ?, updated_at = ? where id = ?").run(taskStatus, now, now, String(run.task_id));
    const goalTask = db.prepare("select goal_item_id from room_tasks where id = ?").get(String(run.task_id)) as { goal_item_id?: string | null } | undefined;
    if (goalTask?.goal_item_id) {
      const goalItemStatusValue: GoalItemStatus = taskStatus === "done" ? "completed" : taskStatus === "cancelled" ? "cancelled" : "failed";
      const item = db.prepare("select goal_id from goal_items where id = ?").get(String(goalTask.goal_item_id)) as { goal_id?: string } | undefined;
      if (item?.goal_id) updateGoalItem(String(item.goal_id), String(goalTask.goal_item_id), { status: goalItemStatusValue }, "system");
    }
    const roomSession = db.prepare("select session_id from rooms where id = ?").get(String(run.room_id)) as { session_id?: string | null } | undefined;
    const agent = db.prepare("select name from agents where id = ?").get(String(run.agent_id)) as { name?: string } | undefined;
    const task = db.prepare("select payload from room_tasks where id = ?").get(String(run.task_id)) as { payload?: string | null } | undefined;
    let taskPayload: Record<string, unknown> = {};
    try {
      taskPayload = task?.payload ? JSON.parse(task.payload) as Record<string, unknown> : {};
    } catch {
      taskPayload = {};
    }
    const latestAssistant = db.prepare("select content from messages where session_id = ? and role = 'assistant' order by created_at desc, id desc limit 1").get(sessionId) as { content?: string } | undefined;
    if (status === "done" && roomSession?.session_id) {
      const agentName = agent?.name || String(run.agent_id);
      const content = latestAssistant?.content?.trim()
        ? `${agentName}:\n${latestAssistant.content.trim()}`
        : taskPayload.kind === "listen"
          ? `${agentName}:\n已收到，我会继续关注。`
          : "";
      if (content) {
        const message = appendSessionMessage(roomSession.session_id, "assistant", content);
        roomEvent(String(run.room_id), "agent.message", { runId: run.id, taskId: run.task_id, sessionId, messageId: message.id, content, agentId: run.agent_id }, String(run.agent_id));
        const parentSession = appData.sessions.find((item: SessionSummary) => item.id === roomSession.session_id);
        if (parentSession) {
          parentSession.updatedAt = message.createdAt;
          upsertSession(parentSession);
          publishTaskEvent(parentSession.id, { type: "message", message, session: parentSession });
          scheduleSessionAutoCompaction(parentSession, "room-agent-message");
        }
      }
    }
    if (status === "done") createRoomRunMergeCandidate(run);
    const eventType = status === "done" ? "agent.completed" : status === "stopped" ? "agent.stopped" : "agent.failed";
    roomEvent(String(run.room_id), eventType, { runId: run.id, taskId: run.task_id, exitCode }, null, String(run.agent_id));
    const activeRuns = db.prepare("select count(*) as count from agent_runs where room_id = ? and status = 'running'").get(String(run.room_id)) as { count?: number } | undefined;
    if (!activeRuns?.count) setRoomParentSessionStatus(String(run.room_id), "paused", now);
    orchestrateRoom(String(run.room_id), eventType);
  }
}

function stopOrphanRoomAgentRun(sessionId: string) {
  getCodexTaskStopRequested().add(sessionId);
  markTaskRunStopRequested(sessionId);
  finishTaskRun(sessionId, "stopped", null, "user_stopped");
  const session = appData.sessions.find((item: SessionSummary) => item.id === sessionId);
  if (session) {
    session.status = session.status === "running" ? "paused" : session.status;
    session.updatedAt = new Date().toISOString();
    appendCodexOutput(session.id, "\n[room task stopped]\n");
    saveAppData();
    publishTaskEvent(session.id, { type: "done", session, exitCode: null });
  }
  finishAgentRun(sessionId, null, true);
  getCodexTaskStopRequested().delete(sessionId);
}

function runGitSync(cwd: string, args: string[], input?: string) {
  const result = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function roomProject(roomId: string) {
  const row = db.prepare("select project_id from rooms where id = ?").get(roomId) as { project_id?: string } | undefined;
  return row?.project_id ? appData.projects.find((project: ProjectSummary) => project.id === row.project_id) ?? null : null;
}

function createRoomRunMergeCandidate(run: Record<string, unknown>) {
  const roomId = String(run.room_id);
  const project = roomProject(roomId);
  const workspacePath = run.workspace_path ? String(run.workspace_path) : "";
  if (!project || !workspacePath || !existsSync(workspacePath)) return;
  const diff = runGitSync(workspacePath, ["diff", "--"]);
  const status = runGitSync(workspacePath, ["status", "--short"]);
  if (!diff.stdout.trim() && !status.stdout.trim()) {
    db.prepare(`
      insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
      values (?, ?, ?, ?, 'merged', 'No workspace changes', ?, ?)
      on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at
    `).run(String(run.id), roomId, project.id, workspacePath, new Date().toISOString(), new Date().toISOString());
    return;
  }
  const check = diff.stdout.trim() ? runGitSync(resolveTerminalCwd(project.workspacePath), ["apply", "--check", "-"], diff.stdout) : { exitCode: 0, stdout: "", stderr: "" };
  const mergeStatus = check.exitCode === 0 ? "pending" : "conflict";
  const summary = runGitSync(workspacePath, ["diff", "--stat"]).stdout.trim() || status.stdout.trim();
  db.prepare(`
    insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at
  `).run(String(run.id), roomId, project.id, workspacePath, mergeStatus, summary, new Date().toISOString(), new Date().toISOString());
  const payload = { runId: String(run.id), taskId: run.task_id ? String(run.task_id) : null, status: mergeStatus, summary, workspacePath, projectId: project.id };
  createRoomArtifact(roomId, {
    agentId: run.agent_id ? String(run.agent_id) : null,
    kind: "file-change",
    title: mergeStatus === "pending" ? "Agent changes ready for review" : "Agent changes need conflict review",
    payload,
  });
  if (run.session_id) appendMessageCard(String(run.session_id), "file-change", mergeStatus === "pending" ? "Changes ready for review" : "Changes need conflict review", payload);
}

function latestExecutionContextForSession(sessionId: string) {
  const row = db.prepare(`
    select * from execution_contexts
    where session_id = ?
    order by created_at desc, id desc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
  return row ? executionContextFromRow(row) : null;
}

function agentPermissionsForRun(run: Record<string, unknown>) {
  const agentRow = db.prepare("select * from agents where id = ?").get(String(run.agent_id)) as Record<string, unknown> | undefined;
  return agentRow ? resolveAgentPermissions(agentFromRow(agentRow)) : getDefaultAgentPermissions();
}

function roomGroupForRoom(roomId: string) {
  const row = db.prepare(`
    select agent_groups.*
    from rooms
    join agent_groups on agent_groups.id = rooms.group_id
    where rooms.id = ?
  `).get(roomId) as Record<string, unknown> | undefined;
  return row ? agentGroupFromRow(row) : null;
}

function applyRoomRunMerge(roomId: string, runId: string): RoomRunMergeResponse {
  const run = db.prepare("select * from agent_runs where id = ? and room_id = ?").get(runId, roomId) as Record<string, unknown> | undefined;
  if (!run) throw new Error("agent_run_not_found");
  const project = roomProject(roomId);
  if (!project) throw new Error("room_project_not_found");
  const workspacePath = run.workspace_path ? String(run.workspace_path) : "";
  const diff = workspacePath ? runGitSync(workspacePath, ["diff", "--"]) : { exitCode: 1, stdout: "", stderr: "workspace_not_found" };
  if (diff.exitCode !== 0 || !diff.stdout.trim()) throw new Error(diff.stderr || "empty_diff");
  const projectPath = resolveTerminalCwd(project.workspacePath);
  const check = runGitSync(projectPath, ["apply", "--check", "-"], diff.stdout);
  if (check.exitCode !== 0) {
    db.prepare("update room_run_merges set status = 'conflict', summary = ?, updated_at = ? where run_id = ?").run(check.stderr || "merge conflict", new Date().toISOString(), runId);
    roomEvent(roomId, "audit.operation", { action: "merge-conflict", runId, error: check.stderr || "merge_conflict" }, run.agent_id ? String(run.agent_id) : null);
    return { run: agentRunFromRow(run), ok: false, message: check.stderr || "merge_conflict" };
  }
  const gateCommands = splitProjectCheckCommands(project.checkCommand);
  for (const gateCommand of gateCommands) {
    const startedAt = new Date().toISOString();
    const gate = spawnSync("/bin/zsh", ["-lc", gateCommand], { cwd: projectPath, env: managedChildEnv(), encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024 });
    const result = {
      command: gateCommand,
      cwd: toTerminalPath(projectPath),
      exitCode: gate.status,
      stdout: gate.stdout ?? "",
      stderr: gate.stderr ?? gate.error?.message ?? "",
      durationMs: 0,
      timedOut: gate.error?.message?.includes("ETIMEDOUT") ?? false,
    };
    const saved = saveProjectCheckRun(project.id, result, startedAt);
    if (saved.status !== "done") {
      createRoomDecision(roomId, {
        title: "Merge blocked by failed project check",
        status: "open",
        payload: { runId, projectId: project.id, checkRunId: saved.id, command: gateCommand, status: saved.status },
      });
      roomEvent(roomId, "audit.operation", { action: "merge-blocked-by-check", runId, checkRunId: saved.id, status: saved.status }, run.agent_id ? String(run.agent_id) : null);
      return { run: agentRunFromRow(run), ok: false, message: "project_check_failed_before_merge" };
    }
  }
  const apply = runGitSync(projectPath, ["apply", "-"], diff.stdout);
  const status = apply.exitCode === 0 ? "merged" : "error";
  db.prepare(`
    insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at
  `).run(runId, roomId, project.id, workspacePath, status, apply.stderr || "Applied patch to project workspace", new Date().toISOString(), new Date().toISOString());
  roomEvent(roomId, "audit.operation", { action: apply.exitCode === 0 ? "merge-applied" : "merge-failed", runId, status, error: apply.stderr || null }, run.agent_id ? String(run.agent_id) : null);
  createRoomDecision(roomId, {
    title: apply.exitCode === 0 ? "Merge applied" : "Merge failed",
    status: apply.exitCode === 0 ? "approved" : "open",
    payload: { runId, status, message: apply.stderr || null },
    resolvedAt: apply.exitCode === 0 ? new Date().toISOString() : null,
  });
  return { run: agentRunFromRow(run), ok: apply.exitCode === 0, message: apply.stderr || undefined };
}

function startRoomTaskRun(roomId: string, taskId: string) {
  const room = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!room) throw new Error("room_not_found");
  const task = db.prepare("select * from room_tasks where id = ? and room_id = ?").get(taskId, roomId) as Record<string, unknown> | undefined;
  if (!task) throw new Error("room_task_not_found");
  const taskStatus = String(task.status);
  if (taskStatus === "running" || taskStatus === "done") throw new Error("room_task_not_startable");
  if (task.depends_on_task_id) {
    const dependency = db.prepare("select status from room_tasks where id = ? and room_id = ?").get(String(task.depends_on_task_id), roomId) as { status?: string } | undefined;
    if (dependency?.status !== "done") throw new Error("room_task_dependency_pending");
  }
  const assignedAgentId = task.assigned_agent_id ? String(task.assigned_agent_id) : "";
  if (!assignedAgentId) throw new Error("room_task_unassigned");
  const membership = db.prepare("select agent_id from room_agents where room_id = ? and agent_id = ?").get(roomId, assignedAgentId);
  if (!membership) throw new Error("room_agent_not_member");
  const agentRow = db.prepare("select * from agents where id = ?").get(assignedAgentId) as Record<string, unknown> | undefined;
  if (!agentRow) throw new Error("agent_not_found");
  const agent = agentFromRow(agentRow);
  if (!agent.enabled) throw new Error("agent_disabled");
  const group = room.group_id ? db.prepare("select * from agent_groups where id = ?").get(String(room.group_id)) as Record<string, unknown> | undefined : undefined;
  if (group) {
    const runningRoomCount = db.prepare("select count(*) as count from agent_runs where room_id = ? and status = 'running'").get(roomId) as { count: number } | undefined;
    const maxConcurrentAgents = Math.max(1, Number(group.max_concurrent_agents ?? 1) || 1);
    if ((runningRoomCount?.count ?? 0) >= maxConcurrentAgents) throw new Error("room_concurrency_limit");
  }
  const runningCount = db.prepare("select count(*) as count from agent_runs where agent_id = ? and status = 'running'").get(agent.id) as { count: number } | undefined;
  if ((runningCount?.count ?? 0) >= agent.maxConcurrentRuns) throw new Error("agent_concurrency_limit");
  const roleRow = db.prepare("select * from agent_roles where id = ?").get(agent.roleId) as Record<string, unknown> | undefined;
  if (!roleRow) throw new Error("agent_role_not_found");
  const role = agentRoleFromRow(roleRow);
  const provider = agent.providerId ? appData.providers.find((item: { id: string; defaultModel?: string | null }) => item.id === agent.providerId) : appData.providers[0];
  const selectedModel = agent.model ?? provider?.defaultModel ?? null;
  const workspace = ensureRoomRunWorkspace(room, agent, taskId);
  const workspaceContext = [
    "Room/project workspace map:",
    room.project_id ? `- bound project id: ${String(room.project_id)}` : "- bound project: none. This is a no-project Room.",
    workspace.projectPath ? `- bound project directory: ${workspace.projectPath}` : "",
    `- current agent working directory: ${workspace.agentWorkspace}`,
    workspace.projectPath && resolve(workspace.agentWorkspace) !== resolve(workspace.projectPath)
      ? "- current agent working directory is an isolated git worktree for the bound project. Treat this worktree as the project workspace for code changes."
      : "",
    !room.project_id
      ? "- no real project directory is bound to this Room. Treat the current agent working directory as a scratch workspace, not as the Codex Web source repository."
      : "",
    room.project_id && !workspace.projectPath
      ? "- the bound project could not be mounted as an independent git worktree. Treat the current agent working directory as a fallback scratch workspace."
      : "",
    `- room shared workspace: ${workspace.shared}`,
    "- Use the current agent working directory for files you create or edit. Use the room shared workspace only for shared notes, plans, reports, handoffs, and decisions.",
    "- Do not treat any ancestor directory or parent Git repository as the project unless it is explicitly listed above as the bound project directory.",
  ].filter(Boolean).join("\n");
  const existingThread = readRoomAgentThread(roomId, agent.id);
  const existingThreadId = existingThread && (!existingThread.workspacePath || resolve(existingThread.workspacePath) === resolve(workspace.agentWorkspace)) ? existingThread.codexSessionId : null;
  const skippedThreadReason = existingThread && !existingThreadId ? `Previous Codex thread ${existingThread.codexSessionId} used workspace ${existingThread.workspacePath}; this run uses ${workspace.agentWorkspace}, so a new thread is started to avoid cwd confusion.` : "";
  const now = new Date().toISOString();
  const sessionId = `task-${randomUUID()}`;
  const session: SessionSummary = {
    id: sessionId,
    kind: room.project_id ? "project" : "scratch",
    conversationType: "agent",
    roomId,
    title: `${agent.name}: ${String(task.title)}`.slice(0, 80),
    projectId: room.project_id ? String(room.project_id) : null,
    workspacePath: workspace.agentWorkspace,
    providerId: provider?.id ?? null,
    model: selectedModel,
    codexSessionId: existingThreadId,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  appData.sessions.unshift(session);
  upsertSession(session);
  const runId = `agent-run-${randomUUID()}`;
  const taskGoal = task.goal_item_id
    ? db.prepare("select goal_id from goal_items where id = ?").get(String(task.goal_item_id)) as { goal_id?: string } | undefined
    : null;
  db.prepare(`
    insert into agent_runs (id, room_id, agent_id, task_id, goal_id, session_id, status, provider_id, model, workspace_path, started_at)
    values (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(runId, roomId, agent.id, taskId, taskGoal?.goal_id ?? null, sessionId, provider?.id ?? null, selectedModel, workspace.agentWorkspace, now);
  db.prepare("update room_tasks set status = 'running', started_at = ?, updated_at = ? where id = ?").run(now, now, taskId);
  setRoomParentSessionStatus(roomId, "running", now);
  roomEvent(roomId, "agent.started", { runId, taskId, sessionId }, null, agent.id);
  const prompt = [
    role.systemPrompt,
    agent.extraPrompt ? `\n\nAgent extra instructions:\n${agent.extraPrompt}` : "",
    groupContextForRoom(room),
    room.shared_context ? `Room shared context:\n${String(room.shared_context)}` : "",
    recentRoomContext(roomId),
    skippedThreadReason,
    `\n\n${workspaceContext}`,
    `\n\nTask:\n${String(task.prompt)}`,
  ].filter(Boolean).join("\n");
  deleteSessionMessages(session.id);
  const userMessage = appendSessionMessage(session.id, "user", String(task.prompt));
  startCodexTask(session, prompt, workspace.agentWorkspace, provider, selectedModel, !existingThreadId, [workspace.shared], {
    sourceType: "room-task",
    agentId: agent.id,
    roomId,
    createdBy: "system",
    permissionProfileId: agent.permissionProfileId ?? null,
    resolvedPermissions: resolveAgentPermissions(agent),
    currentMessageId: userMessage.id,
  });
  return { run: agentRunFromRow(db.prepare("select * from agent_runs where id = ?").get(runId) as Record<string, unknown>), session };
}


  return {
    agentPermissionsForRun,
    applyRoomRunMerge,
    finishAgentRun,
    latestExecutionContextForSession,
    mentionsRoomUser,
    roomGroupForRoom,
    roomProject,
    roomTaskShouldNotifyUser,
    runGitSync,
    setRoomParentSessionStatus,
    startRoomTaskRun,
    stopOrphanRoomAgentRun,
  };
}
