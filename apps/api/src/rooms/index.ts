import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AgentRunSummary,
  RoomEventSummary,
  RoomOrchestrationSettings,
  RoomScheduleSummary,
  RoomStatus,
  RoomSummary,
  RoomTaskSummary,
  SessionMessage,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows } from "../pagination.js";

type RoomStoreDeps = {
  db: Database.Database;
  activeGoalForOwner: (ownerType: "session" | "agent_session" | "room", ownerId?: string | null) => unknown;
  allSessionMessages: (sessionId: string) => SessionMessage[];
};

let roomStoreDeps: RoomStoreDeps | null = null;
const roomEventSubscribers = new Map<string, Set<(event: RoomStreamEvent) => void>>();

export type RoomStreamEvent =
  | { type: "snapshot"; room: RoomSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; events: RoomEventSummary[]; messages: SessionMessage[] }
  | { type: "activity"; roomId: string; event?: RoomEventSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; events: RoomEventSummary[]; messages: SessionMessage[] }
  | { type: "ping" };

export function setRoomStoreDeps(nextDeps: RoomStoreDeps) {
  roomStoreDeps = nextDeps;
}

function deps() {
  if (!roomStoreDeps) throw new Error("room_store_not_initialized");
  return roomStoreDeps;
}

function jsonPayload(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

export function roomStatus(value: unknown, fallback: RoomStatus = "draft"): RoomStatus {
  return value === "running" || value === "paused" || value === "done" || value === "failed" || value === "draft" ? value : fallback;
}

const defaultRoomOrchestration: RoomOrchestrationSettings = {
  autoStartTasks: true,
  autoCreateReviewTasks: true,
  autoListenAfterAgentEvents: true,
  notifyUserOnFailure: true,
  maxAutoRetries: 0,
  maxAutoListenChainDepth: 1,
  maxAutoListenTasksPerEvent: 1,
};

export function roomOrchestrationSettings(value: unknown, override?: Partial<RoomOrchestrationSettings>): RoomOrchestrationSettings {
  const parsed = typeof value === "string" ? jsonPayload(value) : value;
  const item = parsed && typeof parsed === "object" ? parsed as Partial<RoomOrchestrationSettings> : {};
  return {
    autoStartTasks: override?.autoStartTasks ?? item.autoStartTasks ?? defaultRoomOrchestration.autoStartTasks,
    autoCreateReviewTasks: override?.autoCreateReviewTasks ?? item.autoCreateReviewTasks ?? defaultRoomOrchestration.autoCreateReviewTasks,
    autoListenAfterAgentEvents: override?.autoListenAfterAgentEvents ?? item.autoListenAfterAgentEvents ?? defaultRoomOrchestration.autoListenAfterAgentEvents,
    notifyUserOnFailure: override?.notifyUserOnFailure ?? item.notifyUserOnFailure ?? defaultRoomOrchestration.notifyUserOnFailure,
    maxAutoRetries: Math.max(0, Math.min(10, Number(override?.maxAutoRetries ?? item.maxAutoRetries ?? defaultRoomOrchestration.maxAutoRetries) || 0)),
    maxAutoListenChainDepth: Math.max(0, Math.min(10, Number(override?.maxAutoListenChainDepth ?? item.maxAutoListenChainDepth ?? defaultRoomOrchestration.maxAutoListenChainDepth) || 0)),
    maxAutoListenTasksPerEvent: Math.max(1, Math.min(20, Number(override?.maxAutoListenTasksPerEvent ?? item.maxAutoListenTasksPerEvent ?? defaultRoomOrchestration.maxAutoListenTasksPerEvent) || 1)),
  };
}

export function roomFromRow(row: Record<string, unknown>): RoomSummary {
  const { activeGoalForOwner } = deps();
  return {
    id: String(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    name: String(row.name),
    groupId: row.group_id ? String(row.group_id) : null,
    circleId: row.circle_id ? String(row.circle_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    status: roomStatus(row.status),
    sharedContext: row.shared_context ? String(row.shared_context) : null,
    goal: activeGoalForOwner("room", String(row.id)) as RoomSummary["goal"],
    orchestration: roomOrchestrationSettings(row.orchestration_settings),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function roomEventFromRow(row: Record<string, unknown>): RoomEventSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    type: String(row.type),
    sourceAgentId: row.source_agent_id ? String(row.source_agent_id) : null,
    targetAgentId: row.target_agent_id ? String(row.target_agent_id) : null,
    payload: jsonPayload(row.payload),
    createdAt: String(row.created_at),
  };
}

export function roomTaskFromRow(row: Record<string, unknown>): RoomTaskSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    goalItemId: row.goal_item_id ? String(row.goal_item_id) : null,
    title: String(row.title),
    prompt: String(row.prompt ?? ""),
    assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    status: String(row.status) as RoomTaskSummary["status"],
    priority: Number(row.priority) || 0,
    dependsOnTaskId: row.depends_on_task_id ? String(row.depends_on_task_id) : null,
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function roomScheduleFromRow(row: Record<string, unknown>): RoomScheduleSummary {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    agentId: String(row.agent_id),
    taskPrompt: String(row.task_prompt),
    scheduleType: row.schedule_type === "hourly" || row.schedule_type === "daily" ? row.schedule_type : "once",
    runAt: row.run_at ? String(row.run_at) : null,
    status: row.status === "paused" || row.status === "done" ? row.status : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listRooms(status?: string, limit = 50, cursorValue?: string | null) {
  const { db } = deps();
  const cursor = decodePageCursor(cursorValue);
  const where = [
    ...(status ? ["status = @status"] : []),
    ...(cursor ? ["(updated_at < @cursorSort or (updated_at = @cursorSort and id < @cursorId))"] : []),
  ];
  const rows = db.prepare(`
    select * from rooms
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by updated_at desc, id desc
    limit @limit
  `).all({ status, cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return pageFromRows(rows.map(roomFromRow), limit, (item) => item.updatedAt);
}

export function agentRunFromRow(row: Record<string, unknown>): AgentRunSummary {
  const { db } = deps();
  const merge = db.prepare("select status, summary from room_run_merges where run_id = ?").get(String(row.id)) as { status?: string; summary?: string } | undefined;
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    agentId: String(row.agent_id),
    taskId: row.task_id ? String(row.task_id) : null,
    goalId: row.goal_id ? String(row.goal_id) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
    status: String(row.status) as AgentRunSummary["status"],
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    workspacePath: row.workspace_path ? String(row.workspace_path) : null,
    mergeStatus: merge?.status ? merge.status as AgentRunSummary["mergeStatus"] : "none",
    mergeSummary: merge?.summary ?? null,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
  };
}

export function roomActivitySnapshot(roomId: string) {
  const { db, allSessionMessages } = deps();
  const roomRow = db.prepare("select * from rooms where id = ?").get(roomId) as Record<string, unknown> | undefined;
  if (!roomRow) return null;
  const room = roomFromRow(roomRow);
  const tasks = (db.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit 30").all(roomId) as Array<Record<string, unknown>>).map(roomTaskFromRow);
  const runs = (db.prepare("select * from agent_runs where room_id = ? order by started_at desc, id desc limit 30").all(roomId) as Array<Record<string, unknown>>).map(agentRunFromRow);
  const events = (db.prepare("select * from room_events where room_id = ? order by created_at desc, id desc limit 10").all(roomId) as Array<Record<string, unknown>>).map(roomEventFromRow);
  const messages = room.sessionId ? allSessionMessages(room.sessionId) : [];
  return { room, tasks, runs, events, messages };
}

export function publishRoomEvent(roomId: string, event?: RoomEventSummary) {
  const snapshot = roomActivitySnapshot(roomId);
  if (!snapshot) return;
  const payload: RoomStreamEvent = { type: "activity", roomId, event, tasks: snapshot.tasks, runs: snapshot.runs, events: snapshot.events, messages: snapshot.messages };
  const subscribers = roomEventSubscribers.get(roomId);
  if (!subscribers) return;
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(payload);
    } catch {
      subscribers.delete(subscriber);
    }
  }
  if (!subscribers.size) roomEventSubscribers.delete(roomId);
}

export function subscribeRoomEvents(roomId: string, subscriber: (event: RoomStreamEvent) => void) {
  const subscribers = roomEventSubscribers.get(roomId) ?? new Set<(event: RoomStreamEvent) => void>();
  subscribers.add(subscriber);
  roomEventSubscribers.set(roomId, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) roomEventSubscribers.delete(roomId);
  };
}
