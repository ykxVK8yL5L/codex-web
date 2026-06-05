import React, { useEffect, useRef, useState } from "react";
import { FolderGit2, GitPullRequest, Info, Pause, PanelLeftOpen, Play, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type {
  AgentListenMode,
  AgentRunSummary,
  AgentSummary,
  GoalDetailResponse,
  PageResponse,
  RoomAgentSummary,
  RoomArtifactSummary,
  RoomDecisionSummary,
  RoomEventSummary,
  RoomHandoffSummary,
  RoomRunDiffResponse,
  RoomRunMergeResponse,
  RoomScheduleSummary,
  SessionSummary,
  RoomSummary,
  RoomTaskSummary,
  UpdateRoomDecisionRequest,
  UpdateRoomHandoffRequest,
} from "@codex-web/protocol";
import { Button } from "@/components/ui/button";
import { IconText } from "@/components/IconText";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShortDate, prettyJson } from "@/lib/format";
import { listenModeOptions, readableGoalMode, readableGoalStatus, readableRoomArtifactKind, readableRoomDecisionStatus, readableRoomHandoffStatus, roomArtifactKinds, readableListenMode, type TFunction } from "@/features/sessions/utils";

type ToastTone = "info" | "success" | "error";

export type RoomConsoleUpdate = { roomId: string; event: RoomEventSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; version: number };

export function RoomConsole({ sessionToken, roomId, sessionWorkspacePath, projectWorkspacePath, reloadKey, recentUpdate, realtimeFallback, roomMessageMode, onRoomMessageModeChange, t, notify, onRoomName, onOpenSession }: { sessionToken: string; roomId: string; sessionWorkspacePath?: string | null; projectWorkspacePath?: string | null; reloadKey?: number; recentUpdate?: RoomConsoleUpdate | null; realtimeFallback?: boolean; roomMessageMode: "sse" | "polling"; onRoomMessageModeChange: (mode: "sse" | "polling") => void; t: TFunction; notify: (message: string, tone?: ToastTone) => void; onRoomName?: (name: string) => void; onOpenSession: (sessionId: string) => void }) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [roomGoalDetail, setRoomGoalDetail] = useState<GoalDetailResponse | null>(null);
  const [agents, setAgents] = useState<RoomAgentSummary[]>([]);
  const [allAgents, setAllAgents] = useState<AgentSummary[]>([]);
  const [tasks, setTasks] = useState<RoomTaskSummary[]>([]);
  const [schedules, setSchedules] = useState<RoomScheduleSummary[]>([]);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [events, setEvents] = useState<RoomEventSummary[]>([]);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [eventHasMore, setEventHasMore] = useState(false);
  const [artifacts, setArtifacts] = useState<RoomArtifactSummary[]>([]);
  const [decisions, setDecisions] = useState<RoomDecisionSummary[]>([]);
  const [handoffs, setHandoffs] = useState<RoomHandoffSummary[]>([]);
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactKind, setArtifactKind] = useState<RoomArtifactSummary["kind"]>("report");
  const [artifactPayload, setArtifactPayload] = useState("");
  const [decisionTitle, setDecisionTitle] = useState("");
  const [handoffFromAgentId, setHandoffFromAgentId] = useState("");
  const [handoffToAgentId, setHandoffToAgentId] = useState("");
  const [handoffSummary, setHandoffSummary] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskAgentId, setTaskAgentId] = useState("");
  const [scheduleAgentId, setScheduleAgentId] = useState("");
  const [newRoomAgentId, setNewRoomAgentId] = useState("");
  const [newRoomAgentListenMode, setNewRoomAgentListenMode] = useState<AgentListenMode>("passive");
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleRunAt, setScheduleRunAt] = useState("");
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [runDiffPanel, setRunDiffPanel] = useState<RoomRunDiffResponse | null>(null);
  const [roomDetailPreview, setRoomDetailPreview] = useState<{ title: string; content: string } | null>(null);
  const [roomListPages, setRoomListPages] = useState({
    tasks: { cursor: null as string | null, hasMore: false },
    schedules: { cursor: null as string | null, hasMore: false },
    runs: { cursor: null as string | null, hasMore: false },
    artifacts: { cursor: null as string | null, hasMore: false },
    decisions: { cursor: null as string | null, hasMore: false },
    handoffs: { cursor: null as string | null, hasMore: false },
  });
  const seenUserMentionRef = useRef("");
  const roomActivity = [
    ...runs.filter((run) => run.status === "running").map((run) => `${agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}: ${t("session.statusRunning")}`),
    ...tasks.filter((task) => task.status === "assigned" || task.status === "queued").slice(0, 3).map((task) => `${task.title}: ${task.status}`),
    ...events.filter((event) => event.type === "orchestrator.decision" || event.type === "user.attention").slice(0, 3).map((event) => event.type),
  ].slice(0, 6);
  const roomStatusCounts = {
    running: tasks.filter((task) => task.status === "running").length,
    waiting: tasks.filter((task) => task.status === "queued" || task.status === "assigned").length,
    done: tasks.filter((task) => task.status === "done").length,
    failed: tasks.filter((task) => task.status === "failed").length,
  };
  const roomAgentLoad = agents.reduce<Record<string, { running: number; waiting: number; latestRun?: AgentRunSummary }>>((items, agent) => {
    items[agent.id] = {
      running: tasks.filter((task) => task.assignedAgentId === agent.id && task.status === "running").length,
      waiting: tasks.filter((task) => task.assignedAgentId === agent.id && (task.status === "queued" || task.status === "assigned")).length,
      latestRun: runs.find((run) => run.agentId === agent.id),
    };
    return items;
  }, {});
  const latestDecision = decisions[0];
  const latestHandoff = handoffs[0];
  const roomParentDir = sessionWorkspacePath?.replace(/\/workspace\/?$/, "") ?? "";
  const dataRoot = roomParentDir.includes("/sessions/") ? roomParentDir.slice(0, roomParentDir.indexOf("/sessions/")) : "";
  const roomRootFromRun = runs.map((run) => run.workspacePath ?? "").find((path) => path.includes(`/rooms/${roomId}/`));
  const roomWorkspaceDir = dataRoot ? `${dataRoot}/rooms/${roomId}` : roomRootFromRun ? roomRootFromRun.slice(0, roomRootFromRun.indexOf(`/rooms/${roomId}/`) + `/rooms/${roomId}`.length) : "";
  const latestAgentWorkspaces = agents
    .map((agent) => ({ agent, run: roomAgentLoad[agent.id]?.latestRun }))
    .filter((item) => item.run?.workspacePath);
  const roomMessageEvents = events.filter((event) => event.type === "user.message" || event.type === "agent.mentioned");
  const roomBlackboardCount = artifacts.length + decisions.length + handoffs.length;
  const roomGoalItems = roomGoalDetail?.items ?? [];
  const roomGoalProposals = roomGoalDetail?.proposals.filter((proposal) => proposal.status === "pending") ?? [];
  const roomGoalColumns = [
    { id: "planned", label: t("goal.items"), items: roomGoalItems.filter((item) => item.status === "planned") },
    { id: "active", label: t("goal.active"), items: roomGoalItems.filter((item) => item.status === "active") },
    { id: "blocked", label: t("goal.blocked"), items: roomGoalItems.filter((item) => item.status === "blocked") },
    { id: "completed", label: t("goal.completed"), items: roomGoalItems.filter((item) => item.status === "completed") },
  ];
  const roomTimeline = [
    ...tasks.slice(0, 4).map((task) => ({ id: task.id, title: task.title, meta: `${t("room.tasks")} · ${task.status}` })),
    ...runs.slice(0, 4).map((run) => ({ id: run.id, title: agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId, meta: `${t("room.runs")} · ${run.status}` })),
    ...decisions.slice(0, 2).map((decision) => ({ id: decision.id, title: decision.title, meta: `${t("room.decision")} · ${readableRoomDecisionStatus(decision.status, t)}` })),
    ...handoffs.slice(0, 2).map((handoff) => ({ id: handoff.id, title: handoff.summary, meta: `${t("room.handoff")} · ${readableRoomHandoffStatus(handoff.status, t)}` })),
  ].slice(0, 8);
  const availableRoomAgents = allAgents.filter((agent) => !agents.some((member) => member.id === agent.id));
  const hasActiveRoomWork = tasks.some((task) => task.status === "running" || task.status === "assigned" || task.status === "queued")
    || runs.some((run) => run.status === "running" || run.status === "queued");

  function renderMentionContent(content?: string) {
    const parts = (content ?? "-").split(/(@"[^"]+"|@[^\s@]+)/g);
    return parts.map((part, index) => part.startsWith("@")
      ? <mark className="mention-token" key={`${part}-${index}`}>{part}</mark>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>);
  }

  async function fetchRoomPage<T>(path: string, cursor?: string | null) {
    const params = new URLSearchParams({ limit: "30" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/rooms/${roomId}/${path}?${params}`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return { items: [], nextCursor: null, hasMore: false } as PageResponse<T>;
    return response.json() as Promise<PageResponse<T>>;
  }

  async function loadRoom() {
    const headers = { authorization: `Bearer ${sessionToken}` };
    const [roomDetail, agentList, allAgentPage, taskPage, schedulePage, runPage, eventPage, artifactPage, decisionPage, handoffPage] = await Promise.all([
      fetch(`/api/rooms/${roomId}`, { headers }).then((response) => response.ok ? response.json() : null),
      fetch(`/api/rooms/${roomId}/agents`, { headers }).then((response) => response.ok ? response.json() : []),
      fetch("/api/agents?limit=100", { headers }).then((response) => response.ok ? response.json() : { items: [] }),
      fetchRoomPage<RoomTaskSummary>("tasks"),
      fetchRoomPage<RoomScheduleSummary>("schedules"),
      fetchRoomPage<AgentRunSummary>("runs"),
      fetch(`/api/rooms/${roomId}/events?limit=10`, { headers }).then((response) => response.ok ? response.json() : { items: [] }),
      fetchRoomPage<RoomArtifactSummary>("artifacts"),
      fetchRoomPage<RoomDecisionSummary>("decisions"),
      fetchRoomPage<RoomHandoffSummary>("handoffs"),
    ]) as [RoomSummary | null, RoomAgentSummary[], PageResponse<AgentSummary>, PageResponse<RoomTaskSummary>, PageResponse<RoomScheduleSummary>, PageResponse<AgentRunSummary>, PageResponse<RoomEventSummary>, PageResponse<RoomArtifactSummary>, PageResponse<RoomDecisionSummary>, PageResponse<RoomHandoffSummary>];
    setRoom(roomDetail);
    if (roomDetail?.goal?.id) {
      const goalResponse = await fetch(`/api/goals/${roomDetail.goal.id}`, { headers });
      setRoomGoalDetail(goalResponse.ok ? await goalResponse.json() as GoalDetailResponse : null);
    } else {
      setRoomGoalDetail(null);
    }
    if (roomDetail?.name) onRoomName?.(roomDetail.name);
    setAgents(agentList);
    setAllAgents(allAgentPage.items ?? []);
    setTasks(taskPage.items ?? []);
    setSchedules(schedulePage.items ?? []);
    setRuns(runPage.items ?? []);
    setEvents(eventPage.items ?? []);
    setEventCursor(eventPage.nextCursor);
    setEventHasMore(eventPage.hasMore);
    setArtifacts(artifactPage.items ?? []);
    setDecisions(decisionPage.items ?? []);
    setHandoffs(handoffPage.items ?? []);
    const currentRoomAgentIds = new Set(agentList.map((agent) => agent.id));
    setNewRoomAgentId((current) => current && !currentRoomAgentIds.has(current) ? current : (allAgentPage.items ?? []).find((agent) => !currentRoomAgentIds.has(agent.id))?.id ?? "");
    setRoomListPages({
      tasks: { cursor: taskPage.nextCursor, hasMore: taskPage.hasMore },
      schedules: { cursor: schedulePage.nextCursor, hasMore: schedulePage.hasMore },
      runs: { cursor: runPage.nextCursor, hasMore: runPage.hasMore },
      artifacts: { cursor: artifactPage.nextCursor, hasMore: artifactPage.hasMore },
      decisions: { cursor: decisionPage.nextCursor, hasMore: decisionPage.hasMore },
      handoffs: { cursor: handoffPage.nextCursor, hasMore: handoffPage.hasMore },
    });
    const userMention = (eventPage.items ?? []).find((event) => {
      const payload = event.payload as { mentionsUser?: boolean; content?: string } | null;
      return event.type === "user.message" && payload?.mentionsUser && event.id !== seenUserMentionRef.current;
    });
    if (userMention) {
      seenUserMentionRef.current = userMention.id;
      const payload = userMention.payload as { content?: string };
      notify(`${t("room.userMentioned")}：${payload.content ?? ""}`, "info");
    }
    setTaskAgentId((current) => current || agentList[0]?.id || "");
    setScheduleAgentId((current) => current || agentList[0]?.id || "");
  }

  async function loadRoomActivity() {
    const headers = { authorization: `Bearer ${sessionToken}` };
    const [taskPage, runPage, eventPage] = await Promise.all([
      fetchRoomPage<RoomTaskSummary>("tasks"),
      fetchRoomPage<AgentRunSummary>("runs"),
      fetch(`/api/rooms/${roomId}/events?limit=10`, { headers }).then((response) => response.ok ? response.json() : { items: [], nextCursor: null, hasMore: false }),
    ]) as [PageResponse<RoomTaskSummary>, PageResponse<AgentRunSummary>, PageResponse<RoomEventSummary>];
    setTasks(taskPage.items ?? []);
    setRuns(runPage.items ?? []);
    setEvents(eventPage.items ?? []);
    setEventCursor(eventPage.nextCursor);
    setEventHasMore(eventPage.hasMore);
    setRoomListPages((current) => ({
      ...current,
      tasks: { cursor: taskPage.nextCursor, hasMore: taskPage.hasMore },
      runs: { cursor: runPage.nextCursor, hasMore: runPage.hasMore },
    }));
  }

  useEffect(() => {
    void loadRoom();
  }, [roomId, sessionToken, reloadKey]);

  useEffect(() => {
    if (!recentUpdate || recentUpdate.roomId !== roomId) return;
    setEvents((current) => [recentUpdate.event, ...current.filter((event) => event.id !== recentUpdate.event.id)]);
    if (recentUpdate.tasks.length) {
      setTasks((current) => [...recentUpdate.tasks, ...current.filter((task) => !recentUpdate.tasks.some((item) => item.id === task.id))]);
    }
    if (recentUpdate.runs.length) {
      setRuns((current) => [...recentUpdate.runs, ...current.filter((run) => !recentUpdate.runs.some((item) => item.id === run.id))]);
    }
  }, [recentUpdate?.version, roomId]);

  const roomPollingFallbackEnabled = roomMessageMode === "polling";

  useEffect(() => {
    if (!roomPollingFallbackEnabled || !realtimeFallback || !hasActiveRoomWork) return;
    let stopped = false;
    async function refreshActiveRoom() {
      if (stopped) return;
      await loadRoomActivity();
      if (!stopped) window.setTimeout(refreshActiveRoom, 2000);
    }
    const timer = window.setTimeout(refreshActiveRoom, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [roomPollingFallbackEnabled, realtimeFallback, hasActiveRoomWork, roomId, sessionToken]);

  async function loadMoreRoomList(kind: keyof typeof roomListPages) {
    const cursor = roomListPages[kind].cursor;
    if (!cursor) return;
    if (kind === "tasks") {
      const page = await fetchRoomPage<RoomTaskSummary>("tasks", cursor);
      setTasks((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, tasks: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "schedules") {
      const page = await fetchRoomPage<RoomScheduleSummary>("schedules", cursor);
      setSchedules((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, schedules: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "runs") {
      const page = await fetchRoomPage<AgentRunSummary>("runs", cursor);
      setRuns((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, runs: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "artifacts") {
      const page = await fetchRoomPage<RoomArtifactSummary>("artifacts", cursor);
      setArtifacts((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, artifacts: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else if (kind === "decisions") {
      const page = await fetchRoomPage<RoomDecisionSummary>("decisions", cursor);
      setDecisions((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, decisions: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } else {
      const page = await fetchRoomPage<RoomHandoffSummary>("handoffs", cursor);
      setHandoffs((current) => [...current, ...page.items]);
      setRoomListPages((current) => ({ ...current, handoffs: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    }
  }

  async function loadMoreRoomEvents() {
    if (!eventCursor) return;
    const params = new URLSearchParams({ limit: "30", cursor: eventCursor });
    const response = await fetch(`/api/rooms/${roomId}/events?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<RoomEventSummary>;
    setEvents((current) => [...current, ...page.items]);
    setEventCursor(page.nextCursor);
    setEventHasMore(page.hasMore);
  }

  async function updateRoomAgentListenMode(agentId: string, listenMode: AgentListenMode) {
    setAgents((current) => current.map((agent) => agent.id === agentId ? { ...agent, listenMode } : agent));
    const response = await fetch(`/api/rooms/${roomId}/agents/${agentId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ listenMode }),
    });
    if (!response.ok) {
      notify(t("contacts.updateGroupFailed"), "error");
      await loadRoom();
      return;
    }
    setAgents((await response.json()) as RoomAgentSummary[]);
  }

  async function addRoomAgent(event: React.FormEvent) {
    event.preventDefault();
    if (!newRoomAgentId) return;
    const response = await fetch(`/api/rooms/${roomId}/agents`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ agentId: newRoomAgentId, listenMode: newRoomAgentListenMode }),
    });
    if (!response.ok) {
      notify(t("contacts.createAgentFailed"), "error");
      return;
    }
    setAgents((await response.json()) as RoomAgentSummary[]);
    await loadRoom();
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: taskTitle, prompt: taskPrompt, assignedAgentId: taskAgentId || null }),
    });
    if (!response.ok) return;
    setTaskTitle("");
    setTaskPrompt("");
    await loadRoom();
  }

  async function createSchedule(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/schedules`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ agentId: scheduleAgentId, taskPrompt: schedulePrompt, scheduleType: "once", runAt: scheduleRunAt || null }),
    });
    if (!response.ok) return;
    setSchedulePrompt("");
    setScheduleRunAt("");
    await loadRoom();
  }

  async function startTask(task: RoomTaskSummary) {
    setStartingTaskId(task.id);
    try {
      const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const result = await response.json() as { session?: SessionSummary };
      await loadRoom();
      if (result.session?.id) onOpenSession(result.session.id);
    } finally {
      setStartingTaskId(null);
    }
  }

  async function deleteRoomTask(task: RoomTaskSummary) {
    if (!window.confirm(t("room.deleteTaskConfirm"))) return;
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function deleteRoomSchedule(schedule: RoomScheduleSummary) {
    if (!window.confirm(t("room.deleteScheduleConfirm"))) return;
    const response = await fetch(`/api/rooms/${roomId}/schedules/${schedule.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function updateRoomSettings(patch: Partial<RoomSummary["orchestration"]>) {
    if (!room) return;
    const response = await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ orchestration: patch }),
    });
    if (response.ok) await loadRoom();
  }

  async function updateRoomTask(task: RoomTaskSummary, patch: Partial<RoomTaskSummary>) {
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (response.ok) await loadRoom();
  }

  async function cancelRoomTask(task: RoomTaskSummary) {
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function retryRoomTask(task: RoomTaskSummary) {
    const response = await fetch(`/api/rooms/${roomId}/tasks/${task.id}/retry`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadRoom();
  }

  async function retryFailedRoomTasks() {
    const response = await fetch(`/api/rooms/${roomId}/tasks/retry-failed`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await response.json().catch(() => null) as { retried?: number } | null;
    if (response.ok) {
      notify(t("room.retryFailedStarted").replace("{count}", String(result?.retried ?? 0)), "success");
      await loadRoom();
    }
  }

  async function openRunDiff(run: AgentRunSummary) {
    const response = await fetch(`/api/rooms/${roomId}/runs/${run.id}/diff`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setRunDiffPanel((await response.json()) as RoomRunDiffResponse);
  }

  async function mergeRun(run: AgentRunSummary) {
    const response = await fetch(`/api/rooms/${roomId}/runs/${run.id}/merge`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await response.json().catch(() => null) as RoomRunMergeResponse | { message?: string; error?: string } | null;
    if (response.status === 409 && result && "error" in result && result.error === "approval_required") {
      notify(t("approval.required"), "info");
      await loadRoom();
      return;
    }
    notify(response.ok ? t("room.mergeApplied") : `${t("room.mergeFailed")}: ${result && "message" in result ? result.message : result && "error" in result ? result.error : ""}`, response.ok ? "success" : "error");
    await loadRoom();
  }

  async function rejectRun(run: AgentRunSummary) {
    const response = await fetch(`/api/rooms/${roomId}/runs/${run.id}/reject`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) {
      notify(t("room.mergeRejected"), "success");
      await loadRoom();
    }
  }

  function parsePayloadText(value: string) {
    if (!value.trim()) return {};
    try {
      return JSON.parse(value);
    } catch {
      return { text: value.trim() };
    }
  }

  async function createArtifact(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/artifacts`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: artifactTitle, kind: artifactKind, payload: parsePayloadText(artifactPayload) }),
    });
    if (!response.ok) return;
    setArtifactTitle("");
    setArtifactPayload("");
    await loadRoom();
  }

  async function createDecision(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/decisions`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ title: decisionTitle, status: "open" }),
    });
    if (!response.ok) return;
    setDecisionTitle("");
    await loadRoom();
  }

  async function createHandoff(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/rooms/${roomId}/handoffs`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ fromAgentId: handoffFromAgentId || null, toAgentId: handoffToAgentId || null, summary: handoffSummary }),
    });
    if (!response.ok) return;
    setHandoffSummary("");
    await loadRoom();
  }

  function openRoomDetails(title: string, payload: unknown) {
    setRoomDetailPreview({ title, content: prettyJson(payload) });
  }

  async function updateDecision(decision: RoomDecisionSummary, patch: UpdateRoomDecisionRequest) {
    const response = await fetch(`/api/rooms/${roomId}/decisions/${decision.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      notify(t("room.updateDecisionFailed"), "error");
      return;
    }
    const updated = await response.json() as RoomDecisionSummary;
    setDecisions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function updateHandoff(handoff: RoomHandoffSummary, patch: UpdateRoomHandoffRequest) {
    const response = await fetch(`/api/rooms/${roomId}/handoffs/${handoff.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      notify(t("room.updateHandoffFailed"), "error");
      return;
    }
    const updated = await response.json() as RoomHandoffSummary;
    setHandoffs((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  return (
    <section className="room-console">
        <div className="room-console-head">
          <div>
            <strong>{room?.name ?? t("room.title")}</strong>
            <span>{room?.status ?? "draft"} · {agents.length} {t("room.members")}</span>
          </div>
          <div className="room-console-actions">
            <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadRoom()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
          </div>
      </div>
      <div className="room-activity-summary">
        <strong>{t("room.activitySummary")}</strong>
        <span>{t("room.runningTasks")}: {roomStatusCounts.running}</span>
        <span>{t("room.waitingTasks")}: {roomStatusCounts.waiting}</span>
        <span>{t("room.doneTasks")}: {roomStatusCounts.done}</span>
        <span>{t("room.failedTasks")}: {roomStatusCounts.failed}</span>
        {roomActivity.length ? roomActivity.map((item) => <span key={item}>{item}</span>) : <span>{t("room.noActivity")}</span>}
        {roomStatusCounts.failed > 0 && <button className="ghost-button" type="button" onClick={() => void retryFailedRoomTasks()}>{t("room.retryFailedTasks")}</button>}
      </div>
      <Tabs className="room-tabs" defaultValue="overview">
        <TabsList className="settings-tabs" aria-label={t("room.title")}>
          <TabsTrigger className="settings-tab" value="overview">{t("room.overview")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="goal">{t("room.goalBoard")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="messages">{t("room.messages")} {roomMessageEvents.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="members">{t("room.members")} {agents.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="tasks">{t("room.tasks")} {tasks.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="schedules">{t("room.schedules")} {schedules.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="runs">{t("room.runs")} {runs.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="artifacts">{t("room.artifacts")} {roomBlackboardCount}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="events">{t("room.events")} {events.length}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="settings">{t("room.settings")}</TabsTrigger>
        </TabsList>
        <TabsContent className="room-overview" value="overview">
          <div className="room-grid">
            {agents.map((agent) => (
              <article className="room-card" key={agent.id}>
                <strong>{agent.name}</strong>
                <span>{t("room.runningTasks")}: {roomAgentLoad[agent.id]?.running ?? 0} · {t("room.waitingTasks")}: {roomAgentLoad[agent.id]?.waiting ?? 0}</span>
                <span>{t("room.latestRun")}: {roomAgentLoad[agent.id]?.latestRun?.status ?? "-"}</span>
              </article>
            ))}
          </div>
          <div className="room-activity-summary">
            <strong>{t("room.collaborationBrief")}</strong>
            <span>{t("room.latestDecision")}: {latestDecision ? `${latestDecision.title} · ${readableRoomDecisionStatus(latestDecision.status, t)}` : "-"}</span>
            <span>{t("room.latestHandoff")}: {latestHandoff ? `${latestHandoff.summary} · ${readableRoomHandoffStatus(latestHandoff.status, t)}` : "-"}</span>
          </div>
          <div className="room-directory-terms">
            <strong>{t("room.directoryTerms")}</strong>
            {roomParentDir && <span>{t("room.parentSessionDirectory")}: <code>{roomParentDir}</code> · {t("room.parentSessionDirectoryHelp")}</span>}
            {roomWorkspaceDir && <span>{t("room.roomWorkspaceDirectory")}: <code>{roomWorkspaceDir}</code> · {t("room.roomWorkspaceDirectoryHelp")}</span>}
            {roomWorkspaceDir && <span>{t("room.roomSharedDirectory")}: <code>{`${roomWorkspaceDir}/shared`}</code> · {t("room.roomSharedDirectoryHelp")}</span>}
            <span>{t("room.boundProjectDirectory")}: {projectWorkspacePath ? <code>{projectWorkspacePath}</code> : t("room.noBoundProject")} · {projectWorkspacePath ? t("room.boundProjectDirectoryHelp") : t("room.noBoundProjectHelp")}</span>
            {latestAgentWorkspaces.map(({ agent, run }) => (
              <span key={agent.id}>{t("room.agentWorkspaceDirectory")} · {agent.name}: <code>{run?.workspacePath}</code> · {t("room.agentWorkspaceDirectoryHelp")}</span>
            ))}
            {!latestAgentWorkspaces.length && <span>{t("room.agentWorkspacePending")}</span>}
          </div>
          <div className="room-list room-overview-timeline">
            {roomTimeline.map((item) => (
              <div className="room-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </div>
              </div>
            ))}
            {!roomTimeline.length && <div className="empty-state">{t("room.noActivity")}</div>}
          </div>
        </TabsContent>
        <TabsContent className="room-goal-board" value="goal">
          {room?.goal ? (
            <>
              <div className="room-goal-board-head">
                <div>
                  <strong>{room.goal.text}</strong>
                  <span>{readableGoalMode(room.goal.mode, t)} · {readableGoalStatus(room.goal.status, t)}</span>
                </div>
                <div className="room-goal-board-stats">
                  <span>{t("goal.items")}: {room.goal.progress.totalItems}</span>
                  <span>{t("goal.active")}: {room.goal.progress.activeItems}</span>
                  <span>{t("goal.completed")}: {room.goal.progress.completedItems}</span>
                  <span>{t("goal.blocked")}: {room.goal.progress.blockedItems}</span>
                </div>
              </div>
              {room.goal.currentFocus && (
                <div className="room-goal-focus">
                  <strong>{t("progress.currentFocus")}</strong>
                  <span>{room.goal.currentFocus.text}</span>
                </div>
              )}
              {roomGoalProposals.length > 0 && (
                <div className="room-goal-proposals">
                  <strong>{t("goal.proposals")}</strong>
                  {roomGoalProposals.slice(0, 4).map((proposal) => (
                    <span key={proposal.id}>{proposal.title} · {proposal.kind} · {formatShortDate(proposal.createdAt)}</span>
                  ))}
                </div>
              )}
              <div className="room-goal-columns">
                {roomGoalColumns.map((column) => (
                  <section className="room-goal-column" key={column.id}>
                    <strong>{column.label}</strong>
                    {column.items.map((item) => {
                      const linkedTask = tasks.find((task) => task.goalItemId === item.id || task.id === item.roomTaskId);
                      return (
                        <article className="room-goal-card" key={item.id}>
                          <strong>{item.title}</strong>
                          <span>{item.assignedAgentId ? agents.find((agent) => agent.id === item.assignedAgentId)?.name ?? item.assignedAgentId : t("room.unassigned")}</span>
                          {linkedTask && <span>{t("room.tasks")}: {linkedTask.status}</span>}
                          {item.description && <code>{item.description}</code>}
                        </article>
                      );
                    })}
                    {!column.items.length && <div className="empty-state">{t("room.noTasks")}</div>}
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">{t("progress.noProgress")}</div>
          )}
        </TabsContent>
        <TabsContent className="room-list" value="messages">
          {roomMessageEvents.map((event) => {
            const payload = event.payload as { content?: string; mentionedAgentIds?: string[]; mentionsUser?: boolean; taskId?: string };
            return (
              <div className="room-row" key={event.id}>
                <div>
                  <strong>{event.type === "user.message" ? t("room.userMessage") : t("room.agentMentioned")}</strong>
                  <span>{renderMentionContent(payload.content)}</span>
                  <span>{formatShortDate(event.createdAt)}{payload.mentionsUser ? ` · @user` : ""}</span>
                </div>
              </div>
            );
          })}
          {eventHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomEvents()}>{t("session.loadMore")}</button>}
          {!roomMessageEvents.length && <div className="empty-state">{t("room.noMessages")}</div>}
        </TabsContent>
        <TabsContent className="room-list" value="members">
          <form className="room-mini-form room-member-add-form" onSubmit={addRoomAgent}>
            <strong>{t("room.addMember")}</strong>
            <select name="newroomagentid" value={newRoomAgentId} onChange={(event) => setNewRoomAgentId(event.target.value)} disabled={!availableRoomAgents.length}>
              <option value="">{availableRoomAgents.length ? t("contacts.selectRole") : t("room.noAvailableMembers")}</option>
              {availableRoomAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select name="newroomagentlistenmode" value={newRoomAgentListenMode} onChange={(event) => setNewRoomAgentListenMode(event.target.value as AgentListenMode)}>
              {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
            </select>
            <Button type="submit" disabled={!newRoomAgentId}>{t("action.create")}</Button>
          </form>
          <div className="room-grid">
          {agents.map((agent) => (
            <article className="room-card" key={agent.id}>
              <strong>{agent.name}</strong>
              <span>{agent.workspaceMode}</span>
              <code>{agent.model ?? t("session.noModel")}</code>
              <label className="room-member-mode">
                <span>{t("contacts.listenMode")}</span>
                <select name={`roomagent-${agent.id}-listenmode`} value={agent.listenMode} onChange={(event) => void updateRoomAgentListenMode(agent.id, event.target.value as AgentListenMode)}>
                  {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                </select>
              </label>
              <span>{t("room.runningTasks")}: {roomAgentLoad[agent.id]?.running ?? 0} · {t("room.waitingTasks")}: {roomAgentLoad[agent.id]?.waiting ?? 0}</span>
              {roomAgentLoad[agent.id]?.latestRun && <span>{t("room.latestRun")}: {roomAgentLoad[agent.id]?.latestRun?.status}</span>}
            </article>
          ))}
          </div>
          {!agents.length && <div className="empty-state">{t("contacts.noAgents")}</div>}
        </TabsContent>
        <TabsContent className="room-split" value="tasks">
          <form className="room-mini-form" onSubmit={createTask}>
            <input name="tasktitle" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder={t("room.taskTitle")} required />
            <select name="taskagentid" value={taskAgentId} onChange={(event) => setTaskAgentId(event.target.value)}>
              <option value="">{t("room.unassigned")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <textarea name="taskprompt" value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder={t("room.taskPrompt")} required />
            <Button>{t("room.assignTask")}</Button>
          </form>
          <div className="room-list">
            {tasks.map((task) => {
              const run = runs.find((item) => item.taskId === task.id);
              const canStart = Boolean(task.assignedAgentId) && (task.status === "queued" || task.status === "assigned" || task.status === "failed" || task.status === "cancelled");
              return (
                <div className="room-row" key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.status} · {agents.find((agent) => agent.id === task.assignedAgentId)?.name ?? t("room.unassigned")}</span>
                  </div>
                  <div className="row-actions">
                    {run?.sessionId && <button className="ghost-button icon-only" type="button" title={t("room.openSession")} aria-label={t("room.openSession")} onClick={() => run.sessionId && onOpenSession(run.sessionId)}><IconText icon={PanelLeftOpen}>{t("room.openSession")}</IconText></button>}
                    <select name="task-assignedagentid" value={task.assignedAgentId ?? ""} disabled={task.status === "running"} onChange={(event) => void updateRoomTask(task, { assignedAgentId: event.target.value || null })}>
                      <option value="">{t("room.unassigned")}</option>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                    <select name="task-dependsontaskid" value={task.dependsOnTaskId ?? ""} disabled={task.status === "running"} onChange={(event) => void updateRoomTask(task, { dependsOnTaskId: event.target.value || null })}>
                      <option value="">{t("room.noDependency")}</option>
                      {tasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                    </select>
                    <input name="task-priority" className="priority-input" type="number" value={task.priority} disabled={task.status === "running"} onChange={(event) => void updateRoomTask(task, { priority: Number(event.target.value) })} />
                    <button className="ghost-button icon-only" type="button" title={t("room.startTask")} aria-label={t("room.startTask")} disabled={!canStart || startingTaskId === task.id} onClick={() => void startTask(task)}><IconText icon={Play}>{t("room.startTask")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("room.retryTask")} aria-label={t("room.retryTask")} disabled={task.status === "running"} onClick={() => void retryRoomTask(task)}><IconText icon={RotateCcw}>{t("room.retryTask")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("room.cancelTask")} aria-label={t("room.cancelTask")} disabled={task.status === "done" || task.status === "cancelled"} onClick={() => void cancelRoomTask(task)}><IconText icon={Pause}>{t("room.cancelTask")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} disabled={task.status === "running"} onClick={() => void deleteRoomTask(task)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                  </div>
                </div>
              );
            })}
            {!tasks.length && <div className="empty-state">{t("room.noTasks")}</div>}
            {roomListPages.tasks.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("tasks")}>{t("session.loadMore")}</button>}
          </div>
        </TabsContent>
        <TabsContent className="room-split" value="schedules">
          <form className="room-mini-form" onSubmit={createSchedule}>
            <select name="scheduleagentid" value={scheduleAgentId} onChange={(event) => setScheduleAgentId(event.target.value)} required>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <input name="schedulerunat" value={scheduleRunAt} onChange={(event) => setScheduleRunAt(event.target.value)} placeholder={t("room.runAtPlaceholder")} />
            <textarea name="scheduleprompt" value={schedulePrompt} onChange={(event) => setSchedulePrompt(event.target.value)} placeholder={t("room.taskPrompt")} required />
            <Button>{t("room.scheduleTask")}</Button>
          </form>
          <div className="room-list">
            {schedules.map((schedule) => (
              <div className="room-row" key={schedule.id}>
                <div>
                  <strong>{agents.find((agent) => agent.id === schedule.agentId)?.name ?? schedule.agentId}</strong>
                  <span>{schedule.status} · {schedule.scheduleType} · {schedule.runAt ?? "-"}</span>
                </div>
                <button className="ghost-button danger-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteRoomSchedule(schedule)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
              </div>
            ))}
            {!schedules.length && <div className="empty-state">{t("room.noSchedules")}</div>}
            {roomListPages.schedules.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("schedules")}>{t("session.loadMore")}</button>}
          </div>
        </TabsContent>
        <TabsContent className="room-list" value="runs">
          {runs.map((run) => (
            <div className="room-row" key={run.id}>
              <div>
                <strong>{agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}</strong>
                <span>{run.status} · exit {run.exitCode ?? "null"} · merge {run.mergeStatus ?? "none"}</span>
                {run.workspacePath && <code>{run.workspacePath}</code>}
                {run.mergeSummary && <span>{run.mergeSummary}</span>}
              </div>
              <div className="row-actions">
                <button className="ghost-button icon-only" type="button" title={t("workspace.changes")} aria-label={t("workspace.changes")} onClick={() => void openRunDiff(run)}><IconText icon={FolderGit2}>{t("workspace.changes")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("room.mergeRun")} aria-label={t("room.mergeRun")} disabled={run.mergeStatus !== "pending"} onClick={() => void mergeRun(run)}><IconText icon={GitPullRequest}>{t("room.mergeRun")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("room.rejectRun")} aria-label={t("room.rejectRun")} disabled={run.mergeStatus !== "pending" && run.mergeStatus !== "conflict"} onClick={() => void rejectRun(run)}><IconText icon={X}>{t("room.rejectRun")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("room.openSession")} aria-label={t("room.openSession")} disabled={!run.sessionId} onClick={() => run.sessionId && onOpenSession(run.sessionId)}><IconText icon={PanelLeftOpen}>{t("room.openSession")}</IconText></button>
              </div>
            </div>
          ))}
          {!runs.length && <div className="empty-state">{t("room.noRuns")}</div>}
          {roomListPages.runs.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("runs")}>{t("session.loadMore")}</button>}
        </TabsContent>
        <TabsContent className="room-list" value="artifacts">
          <form className="room-mini-form" onSubmit={createArtifact}>
            <input name="artifacttitle" value={artifactTitle} onChange={(event) => setArtifactTitle(event.target.value)} placeholder={t("room.artifactTitle")} required />
            <select name="artifactkind" value={artifactKind} onChange={(event) => setArtifactKind(event.target.value as RoomArtifactSummary["kind"])}>
              {roomArtifactKinds.map((kind) => <option key={kind} value={kind}>{readableRoomArtifactKind(kind, t)}</option>)}
            </select>
            <textarea name="artifactpayload" value={artifactPayload} onChange={(event) => setArtifactPayload(event.target.value)} placeholder={t("room.artifactPayload")} />
            <Button>{t("room.createArtifact")}</Button>
          </form>
          <form className="room-mini-form" onSubmit={createDecision}>
            <input name="decisiontitle" value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} placeholder={t("room.decisionTitle")} required />
            <Button>{t("room.createDecision")}</Button>
          </form>
          <form className="room-mini-form" onSubmit={createHandoff}>
            <select name="handofffromagentid" value={handoffFromAgentId} onChange={(event) => setHandoffFromAgentId(event.target.value)}>
              <option value="">{t("room.system")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select name="handofftoagentid" value={handoffToAgentId} onChange={(event) => setHandoffToAgentId(event.target.value)}>
              <option value="">{t("room.system")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <textarea name="handoffsummary" value={handoffSummary} onChange={(event) => setHandoffSummary(event.target.value)} placeholder={t("room.handoffSummary")} required />
            <Button>{t("room.createHandoff")}</Button>
          </form>
          <div className="room-section-label"><strong>{t("room.artifacts")}</strong><span>{artifacts.length}</span></div>
          {artifacts.map((artifact) => (
            <div className="room-row" key={artifact.id}>
              <div>
                <strong>{artifact.title}</strong>
                <span>{readableRoomArtifactKind(artifact.kind, t)} · {agents.find((agent) => agent.id === artifact.agentId)?.name ?? t("room.system")}</span>
              </div>
              <div className="row-actions">
                <button className="ghost-button icon-only" type="button" title={t("room.artifactDetails")} aria-label={t("room.artifactDetails")} onClick={() => openRoomDetails(artifact.title, artifact.payload)}><IconText icon={Info}>{t("room.artifactDetails")}</IconText></button>
              </div>
            </div>
          ))}
          {roomListPages.artifacts.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("artifacts")}>{t("session.loadMore")}</button>}
          <div className="room-section-label"><strong>{t("room.decision")}</strong><span>{decisions.length}</span></div>
          {decisions.map((decision) => (
            <div className="room-row" key={decision.id}>
              <div>
                <strong>{decision.title}</strong>
                <span>{t("room.decision")} · {readableRoomDecisionStatus(decision.status, t)} · {formatShortDate(decision.createdAt)}</span>
              </div>
              <div className="row-actions room-state-actions">
                <select name={`room-decision-status-${decision.id}`} value={decision.status} aria-label={t("room.updateDecisionStatus")} onChange={(event) => void updateDecision(decision, { status: event.target.value as RoomDecisionSummary["status"] })}>
                  <option value="open">{t("room.decisionStatusOpen")}</option>
                  <option value="approved">{t("room.decisionStatusApproved")}</option>
                  <option value="rejected">{t("room.decisionStatusRejected")}</option>
                  <option value="resolved">{t("room.decisionStatusResolved")}</option>
                </select>
                <button className="ghost-button icon-only" type="button" title={t("room.decisionDetails")} aria-label={t("room.decisionDetails")} onClick={() => openRoomDetails(decision.title, decision.payload)}><IconText icon={Info}>{t("room.decisionDetails")}</IconText></button>
              </div>
            </div>
          ))}
          {roomListPages.decisions.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("decisions")}>{t("session.loadMore")}</button>}
          <div className="room-section-label"><strong>{t("room.handoff")}</strong><span>{handoffs.length}</span></div>
          {handoffs.map((handoff) => (
            <div className="room-row" key={handoff.id}>
              <div>
                <strong>{handoff.summary}</strong>
                <span>{agents.find((agent) => agent.id === handoff.fromAgentId)?.name ?? t("room.system")} → {agents.find((agent) => agent.id === handoff.toAgentId)?.name ?? t("room.system")}</span>
                <span>{t("room.handoff")} · {readableRoomHandoffStatus(handoff.status, t)} · {formatShortDate(handoff.createdAt)}</span>
              </div>
              <div className="row-actions room-state-actions">
                <select name={`room-handoff-status-${handoff.id}`} value={handoff.status} aria-label={t("room.updateHandoffStatus")} onChange={(event) => void updateHandoff(handoff, { status: event.target.value as RoomHandoffSummary["status"] })}>
                  <option value="open">{t("room.handoffStatusOpen")}</option>
                  <option value="accepted">{t("room.handoffStatusAccepted")}</option>
                  <option value="returned">{t("room.handoffStatusReturned")}</option>
                  <option value="resolved">{t("room.handoffStatusResolved")}</option>
                  <option value="cancelled">{t("room.handoffStatusCancelled")}</option>
                </select>
                <button className="ghost-button icon-only" type="button" title={t("room.handoffDetails")} aria-label={t("room.handoffDetails")} onClick={() => openRoomDetails(handoff.summary, handoff.payload)}><IconText icon={Info}>{t("room.handoffDetails")}</IconText></button>
              </div>
            </div>
          ))}
          {roomListPages.handoffs.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomList("handoffs")}>{t("session.loadMore")}</button>}
          {!artifacts.length && !decisions.length && !handoffs.length && <div className="empty-state">{t("room.noArtifacts")}</div>}
        </TabsContent>
        <TabsContent className="room-list" value="events">
          {events.map((event) => <div className="room-row" key={event.id}><div><strong>{event.type}</strong><span>{formatShortDate(event.createdAt)}</span><pre className="approval-details">{prettyJson(event.payload)}</pre></div></div>)}
          {eventHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreRoomEvents()}>{t("session.loadMore")}</button>}
          {!events.length && <div className="empty-state">{t("room.noEvents")}</div>}
        </TabsContent>
        <TabsContent className="room-list" value="settings">
          {room && (
            <div className="room-settings-grid">
              <label className="room-setting-row">
                <span>{t("room.autoStartTasks")}</span>
                <input name="room-orchestration-autostarttasks" type="checkbox" checked={room.orchestration.autoStartTasks} onChange={(event) => void updateRoomSettings({ autoStartTasks: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.autoCreateReviewTasks")}</span>
                <input name="room-orchestration-autocreatereviewtasks" type="checkbox" checked={room.orchestration.autoCreateReviewTasks} onChange={(event) => void updateRoomSettings({ autoCreateReviewTasks: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.autoListenAfterAgentEvents")}</span>
                <input name="room-orchestration-autolistenafteragentevents" type="checkbox" checked={room.orchestration.autoListenAfterAgentEvents} onChange={(event) => void updateRoomSettings({ autoListenAfterAgentEvents: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.notifyUserOnFailure")}</span>
                <input name="room-orchestration-notifyuseronfailure" type="checkbox" checked={room.orchestration.notifyUserOnFailure} onChange={(event) => void updateRoomSettings({ notifyUserOnFailure: event.target.checked })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.maxAutoRetries")}</span>
                <Input name="room-orchestration-maxautoretries" className="room-setting-number" type="number" min={0} max={10} value={room.orchestration.maxAutoRetries} onChange={(event) => void updateRoomSettings({ maxAutoRetries: Number(event.target.value) })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.maxAutoListenChainDepth")}</span>
                <Input name="room-orchestration-maxautolistenchaindepth" className="room-setting-number" type="number" min={0} max={10} value={room.orchestration.maxAutoListenChainDepth} onChange={(event) => void updateRoomSettings({ maxAutoListenChainDepth: Number(event.target.value) })} />
              </label>
              <label className="room-setting-row">
                <span>{t("room.maxAutoListenTasksPerEvent")}</span>
                <Input name="room-orchestration-maxautolistentasks" className="room-setting-number" type="number" min={1} max={20} value={room.orchestration.maxAutoListenTasksPerEvent} onChange={(event) => void updateRoomSettings({ maxAutoListenTasksPerEvent: Number(event.target.value) })} />
              </label>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {runDiffPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("workspace.changes")}</strong>
              <span>{runDiffPanel.workspacePath}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setRunDiffPanel(null)}>{t("action.close")}</button>
          </div>
          <pre className="task-log-viewer">{[runDiffPanel.status, runDiffPanel.stat, runDiffPanel.diff || runDiffPanel.error].filter(Boolean).join("\n\n") || t("workspace.noPatch")}</pre>
        </div>
      )}
      {roomDetailPreview && (
        <div className="dialog-layer" role="dialog" aria-modal="true">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setRoomDetailPreview(null)} />
          <div className="dialog-card room-detail-dialog">
            <div className="dialog-head">
              <div>
                <strong>{roomDetailPreview.title}</strong>
                <span>{t("room.details")}</span>
              </div>
              <button className="drawer-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setRoomDetailPreview(null)}>
                <X size={16} />
              </button>
            </div>
            <pre className="approval-details room-detail-json">{roomDetailPreview.content}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
