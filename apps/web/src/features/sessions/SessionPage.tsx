import React, { useEffect, useRef, useState } from "react";
import { Activity, Bell, Bot, Boxes, Check, Files, FolderGit2, Globe, History, Info, MoreHorizontal, Pencil, Play, Plus, RefreshCw, RotateCcw, Send, Square, Terminal as TerminalIcon, Trash2, Users, X } from "lucide-react";
import type {
  AgentRunSummary,
  AgentSummary,
  CodexTaskDetail,
  CreateCodexTaskRequest,
  CreatePreviewRequest,
  CreateRoomMessageResponse,
  ExecutionContextSummary,
  FileEntry,
  FileListResponse,
  GoalSummary,
  MessageCardSummary,
  NotificationEventType,
  NotificationRecipientSummary,
  NotificationSettingsResponse,
  PageResponse,
  PreviewAccess,
  PreviewSummary,
  ProjectSummary,
  ProviderModelsResponse,
  ProviderSummary,
  QueuedMessage,
  RoomEventSummary,
  RoomTaskSummary,
  SessionCompactionListResponse,
  SessionCompactionResponse,
  SessionMessage,
  SessionMessagesPage,
  SessionSummary,
  TaskContextFileResponse,
  TaskContextResponse,
  TaskLogResponse,
  TaskRunSummary,
  TokenUsageDisplaySettings,
  TokenUsageResponse,
  UpdateSessionCompactionRequest,
  UpdateSessionRequest,
  UploadAttachmentInput,
} from "@codex-web/protocol";
import { useAppDialog } from "@/components/AppDialog";
import { IconText } from "@/components/IconText";
import { NotificationCenterContext } from "@/components/PageHeader";
import { PreviewDirectoryPicker } from "@/components/PreviewDirectoryPicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/clipboard";
import { sessionInfoRequestedEvent, taskActivityChangedEvent, workspaceChangedEvent } from "@/lib/events";
import { formatBytes, formatShortDate, formatTokens, renderPreviewCommand } from "@/lib/format";
import { openPreviewUrl } from "@/lib/previews";
import { AutomationNotifyRuleDialog } from "@/components/automations";
import { FilesPage } from "@/features/files";
import { TerminalPage } from "@/features/terminal";
import { GoalPanel } from "@/features/goals/GoalPanel";
import { RoomConsole, type RoomConsoleUpdate } from "@/features/rooms/RoomConsole";
import { Bubble } from "@/features/sessions/Bubble";
import { ContextPanel } from "@/features/sessions/ContextPanel";
import { MessageCards } from "@/features/sessions/MessageCards";
import { MobileMainToggle, MobileSessionToggle } from "@/features/sessions/SessionChrome";
import { QueuedMessageRow } from "@/features/sessions/QueuedMessageRow";
import {
  createNotificationEphemeralRule,
  fetchNotificationSettings,
  notificationKindLabel,
  notificationSenderAccountsForKind as getNotificationSenderAccountsForKind,
} from "@/features/notifications";
import {
  filesToAttachmentInputs,
  localUserMessage,
  maxComposerAttachmentBytes,
  maxComposerAttachmentFiles,
  mergeMessages,
  messageTextWithContext,
  newestTaskRunsFirst,
  projectDisplayName,
  promptWithFileReferences,
  readLocalStorageValue,
  readableNotificationEvent,
  readableRunStatus,
  readableSessionType,
  readableStatus,
  type ComposerFileReference,
  type TFunction,
} from "@/features/sessions/utils";

type ToastTone = "info" | "success" | "error";
type ComposerTarget = "prompt" | "room";
type TaskEvent =
  | { type: "snapshot"; session: SessionSummary; messages: SessionMessage[]; queue: QueuedMessage[]; exitCode: number | null }
  | { type: "started"; session: SessionSummary }
  | { type: "output"; bytes: number; at: string }
  | { type: "activity"; id?: string; kind: "command" | "file" | "tool"; label: string; detail?: string; status?: string; at: string }
  | { type: "workspace"; session: SessionSummary; reason: "activity" | "done" | "revert"; at: string }
  | { type: "message"; message: SessionMessage; session: SessionSummary }
  | { type: "queue"; queue: QueuedMessage[]; session: SessionSummary }
  | { type: "done"; session: SessionSummary; exitCode: number | null }
  | { type: "error"; session: SessionSummary; error: string };
type RoomStreamEvent =
  | { type: "snapshot"; room: unknown; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; events: RoomEventSummary[]; messages: SessionMessage[] }
  | { type: "activity"; roomId: string; event?: RoomEventSummary; tasks: RoomTaskSummary[]; runs: AgentRunSummary[]; events: RoomEventSummary[]; messages: SessionMessage[] }
  | { type: "ping" };

function publishWorkspaceChanged(sessionId: string) {
  window.dispatchEvent(new CustomEvent(workspaceChangedEvent, { detail: { sessionId } }));
}

function publishTaskActivityChanged(sessionId: string) {
  window.dispatchEvent(new CustomEvent(taskActivityChangedEvent, { detail: { sessionId } }));
}

export function SessionPage({
  sessionToken,
  t,
  notify,
  session,
  project,
  projects,
  draftProjectId,
  onDraftProjectId,
  providers,
  selectedProviderId,
  onSelectProvider,
  taskDetail,
  optimisticMessages,
  queuedMessages,
  onQueueChange,
  onTaskDetail,
  onSubmitTask,
  onContinueTask,
  onRecoverTask,
  onUpdateQueuedMessage,
  onReorderQueuedMessages,
  onDeleteQueuedMessage,
  onStopTask,
  onDeleteSession,
  onSessionUpdated,
  onOpenSession,
  onOpenMainNav,
  onOpenSessionNav,
}: {
  sessionToken: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  session?: SessionSummary;
  project?: ProjectSummary;
  projects: ProjectSummary[];
  draftProjectId: string | null;
  onDraftProjectId: (projectId: string | null) => void;
  providers: ProviderSummary[];
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
  taskDetail?: CodexTaskDetail;
  optimisticMessages: SessionMessage[];
  queuedMessages: QueuedMessage[];
  onQueueChange: (sessionId: string, queue: QueuedMessage[]) => void;
  onTaskDetail: (detail: CodexTaskDetail) => void;
  onSubmitTask: (prompt: string, projectId: string | null, providerId: string | null, model: string | null, ephemeralNotifications?: CreateCodexTaskRequest["ephemeralNotifications"], attachments?: UploadAttachmentInput[], displayPrompt?: string) => Promise<void>;
  onContinueTask: (sessionId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null, attachments?: UploadAttachmentInput[], displayPrompt?: string) => Promise<void>;
  onRecoverTask: (sessionId: string, prompt: string, providerId: string | null, model: string | null) => Promise<void>;
  onUpdateQueuedMessage: (sessionId: string, queueId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null) => Promise<void>;
  onReorderQueuedMessages: (sessionId: string, orderedIds: string[]) => Promise<void>;
  onDeleteQueuedMessage: (sessionId: string, queueId: string) => Promise<void>;
  onStopTask: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onSessionUpdated: (session: SessionSummary) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenMainNav?: () => void;
  onOpenSessionNav?: () => void;
}) {
  const dialog = useAppDialog(t);
  const [prompt, setPrompt] = useState("");
  const [draftModel, setDraftModel] = useState(providers[0]?.defaultModel ?? "");
  const [draftModels, setDraftModels] = useState<string[]>(providers[0]?.defaultModel ? [providers[0].defaultModel] : []);
  const [providerModelOverrides, setProviderModelOverrides] = useState<Record<string, string[]>>({});
  const [draftSubmittedMessages, setDraftSubmittedMessages] = useState<SessionMessage[]>([]);
  const [messagePage, setMessagePage] = useState<SessionMessagesPage>({ items: [], nextCursor: null, hasMore: false });
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [eventStreamNotice, setEventStreamNotice] = useState("");
  const [lastOutputAt, setLastOutputAt] = useState("");
  const lastOutputAtRef = useRef("");
  const loadingProviderModelsRef = useRef(new Set<string>());
  const [taskRuns, setTaskRuns] = useState<TaskRunSummary[]>([]);
  const [taskRunCursor, setTaskRunCursor] = useState<string | null>(null);
  const [taskRunHasMore, setTaskRunHasMore] = useState(false);
  const [sessionUsage, setSessionUsage] = useState<TokenUsageResponse | null>(null);
  const [usageDisplay, setUsageDisplay] = useState<TokenUsageDisplaySettings | null>(null);
  const [executionContexts, setExecutionContexts] = useState<ExecutionContextSummary[]>([]);
  const [messageCards, setMessageCards] = useState<MessageCardSummary[]>([]);
  const [workspacePanel, setWorkspacePanel] = useState<"files" | "terminal" | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [goalInfoExpandSignal, setGoalInfoExpandSignal] = useState(0);
  const [mobileContextPanel, setMobileContextPanel] = useState<"progress" | "changes" | "activity" | null>(null);
  const [changeFileBrowser, setChangeFileBrowser] = useState<{ path: string } | null>(null);
  const [roomConsoleOpen, setRoomConsoleOpen] = useState(false);
  const [taskLogPanel, setTaskLogPanel] = useState<{ log: string } | null>(null);
  const [taskContextPanel, setTaskContextPanel] = useState<{ files: TaskContextResponse["files"]; selectedName: string; content: string } | null>(null);
  const [previewPanelOpen, setPreviewPanelOpen] = useState(false);
  const [sessionPreviews, setSessionPreviews] = useState<PreviewSummary[] | null>(null);
  const [previewCommand, setPreviewCommand] = useState("python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}");
  const [previewPort, setPreviewPort] = useState("4179");
  const [previewDirectory, setPreviewDirectory] = useState(".");
  const [previewAccess, setPreviewAccess] = useState<PreviewAccess>("private");
  const [roomMessage, setRoomMessage] = useState("");
  const [roomMentionAgents, setRoomMentionAgents] = useState<AgentSummary[]>([]);
  const [roomActiveAgentIds, setRoomActiveAgentIds] = useState<string[]>([]);
  const [roomRefreshKey, setRoomRefreshKey] = useState(0);
  const [roomConsoleUpdate, setRoomConsoleUpdate] = useState<RoomConsoleUpdate | null>(null);
  const [roomFollowupUntil, setRoomFollowupUntil] = useState(0);
  const [roomEventStreamNotice, setRoomEventStreamNotice] = useState("");
  const [roomMessageMode, setRoomMessageMode] = useState<"sse" | "polling">(() => readLocalStorageValue("codex-web-room-message-mode", "sse") === "polling" ? "polling" : "sse");
  const [roomDisplayName, setRoomDisplayName] = useState("");
  const [replyTarget, setReplyTarget] = useState<SessionMessage | null>(null);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [compactingMemory, setCompactingMemory] = useState(false);
  const [slashMenuTarget, setSlashMenuTarget] = useState<"prompt" | "room" | null>(null);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [slashMenuQuery, setSlashMenuQuery] = useState("");
  const [slashTokenRange, setSlashTokenRange] = useState<{ target: "prompt" | "room"; start: number; end: number } | null>(null);
  const [promptAttachments, setPromptAttachments] = useState<File[]>([]);
  const [roomAttachments, setRoomAttachments] = useState<File[]>([]);
  const [promptFileReferences, setPromptFileReferences] = useState<ComposerFileReference[]>([]);
  const [roomFileReferences, setRoomFileReferences] = useState<ComposerFileReference[]>([]);
  const [fileReferencePicker, setFileReferencePicker] = useState<{
    target: ComposerTarget;
    rootPath: string;
    sourceLabel: string;
    list: FileListResponse | null;
  } | null>(null);
  const [taskTemplateTarget, setTaskTemplateTarget] = useState<ComposerTarget | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [notifyBuilderOpen, setNotifyBuilderOpen] = useState(false);
  const [mobileModelPickerOpen, setMobileModelPickerOpen] = useState(false);
  const [notifySettings, setNotifySettings] = useState<NotificationSettingsResponse | null>(null);
  const [notifyEventType, setNotifyEventType] = useState<NotificationEventType>("task_completed");
  const [notifyChannelKind, setNotifyChannelKind] = useState<NotificationRecipientSummary["kind"]>("email");
  const [notifyRecipientId, setNotifyRecipientId] = useState("");
  const [notifySenderAccountId, setNotifySenderAccountId] = useState("");
  const [sessionNotifyRules, setSessionNotifyRules] = useState<Array<{ id: string; eventType: NotificationEventType; recipientName: string; recipientId: string; senderAccountId?: string; persisted: boolean }>>([]);
  const promptFileInputRef = useRef<HTMLInputElement | null>(null);
  const roomFileInputRef = useRef<HTMLInputElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const roomTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("codex-web-room-message-mode", roomMessageMode);
    } catch {
      // ignore storage failures
    }
  }, [roomMessageMode]);
  useEffect(() => {
    setSessionNotifyRules([]);
    setPromptFileReferences([]);
    setRoomFileReferences([]);
    setFileReferencePicker(null);
  }, [draftProjectId, session?.id]);

  useEffect(() => {
    fetch("/api/settings/token-usage-display", {
      headers: { authorization: `Bearer ${sessionToken}` },
    })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: TokenUsageDisplaySettings | null) => {
        if (settings) setUsageDisplay(settings);
      })
      .catch(() => undefined);
  }, [sessionToken]);

  const timelineRef = useRef<HTMLElement | null>(null);
  const skipNextTimelineScrollRef = useRef(false);
  const onQueueChangeRef = useRef(onQueueChange);
  const onTaskDetailRef = useRef(onTaskDetail);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const sessionProvider = providers.find((provider) => provider.id === session?.providerId) ?? selectedProvider;
  const composerProjectId = session ? (session.projectId ?? "scratch") : (draftProjectId ?? "scratch");
  const selectedComposerProject = projects.find((item) => item.id === composerProjectId);
  const fallbackSessionProjectId = session?.projectId && !selectedComposerProject ? session.projectId : "";
  const composerProjectName = project ? projectDisplayName(project, projects) : selectedComposerProject ? projectDisplayName(selectedComposerProject, projects) : (session?.projectId ? session.workspacePath || session.projectId : t("session.noProject"));
  const sessionProviderModelLabel = session
    ? `${sessionProvider?.name ?? (session.providerId ? session.providerId : t("session.noProvider"))} / ${session.model ?? t("session.noModel")}`
    : selectedProvider
      ? `${selectedProvider.name} / ${draftModel || selectedProvider.defaultModel || t("session.noModel")}`
      : t("session.noProvider");
  const composerModels = draftModel && !draftModels.includes(draftModel) ? [draftModel, ...draftModels] : draftModels;
  const isRoomSession = session?.conversationType === "room";
  const roomHasActiveAgents = isRoomSession && roomActiveAgentIds.length > 0;
  const effectiveSessionStatus = isRoomSession ? (roomHasActiveAgents ? "running" : "paused") : session?.status;
  const taskRunning = isRoomSession ? roomHasActiveAgents : effectiveSessionStatus === "running";
  const shouldConnectTaskEvents = Boolean(session?.id && !isRoomSession && session.status === "running");
  const assistantDisplayName = session?.conversationType === "agent"
    ? (session.title.includes(":") ? session.title.split(":")[0]?.trim() || session.title : session.title)
    : "C";
  const pageSessionTitle = session?.title;
  const goalOwnerType: "session" | "agent_session" | "room" = session?.roomId
    ? "room"
    : session?.conversationType === "agent"
      ? "agent_session"
      : "session";
  const goalOwnerId = goalOwnerType === "room" ? session?.roomId ?? "" : session?.id ?? "";
  const taskFailed = session?.status === "paused" && typeof taskDetail?.exitCode === "number" && taskDetail.exitCode !== 0;
  const taskInterrupted = session?.status === "interrupted";
  const realtimeNotice = isRoomSession ? roomEventStreamNotice : eventStreamNotice;
  const fallbackMessages = session ? [{ id: session.id, role: "user" as const, content: pageSessionTitle ?? session.title, createdAt: session.createdAt ?? session.updatedAt }] : [];
  const persistedMessages = mergeMessages(messagePage.items, taskDetail?.messages ?? []);
  const visibleMessages = session
    ? mergeMessages(persistedMessages.length ? persistedMessages : fallbackMessages, optimisticMessages)
    : draftSubmittedMessages;
  const messageUsageVisible = session?.showMessageUsage ?? (usageDisplay?.showMessageUsage === true);
  useEffect(() => {
    function handleSessionInfoRequested(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string; expandGoal?: boolean }>).detail;
      if (!session?.id || detail?.sessionId !== session.id) return;
      setInfoOpen(true);
      if (detail?.expandGoal) setGoalInfoExpandSignal((value) => value + 1);
    }
    window.addEventListener(sessionInfoRequestedEvent, handleSessionInfoRequested);
    return () => window.removeEventListener(sessionInfoRequestedEvent, handleSessionInfoRequested);
  }, [session?.id]);
  const notifyRecipients = (notifySettings?.recipients ?? []).filter((recipient) => recipient.enabled);
  const notifyRecipientKinds = [...new Set(notifyRecipients.map((recipient) => recipient.kind))];
  const notifyRecipientsForKind = (kind: NotificationRecipientSummary["kind"]) => notifyRecipients.filter((recipient) => recipient.kind === kind);
  const filteredNotifyRecipients = notifyRecipientsForKind(notifyChannelKind);
  function defaultNotifySenderId(recipient?: NotificationRecipientSummary | null) {
    if (!recipient) return "";
    return recipient.senderAccountId ?? getNotificationSenderAccountsForKind(notifySettings?.accounts ?? [], recipient.kind)[0]?.id ?? "";
  }
  function displayMessage(message: SessionMessage) {
    if (isRoomSession && message.role === "assistant") {
      const match = message.content.match(/^([^:\n]{1,80}):\n([\s\S]*)$/);
      if (match) return { who: match[1].trim(), text: match[2].trim() };
    }
    return {
      who: message.role === "user" ? t("session.user") : assistantDisplayName,
      text: message.content,
    };
  }

  function startReply(message: SessionMessage) {
    setReplyTarget(message);
    if (!isRoomSession || message.role !== "assistant") return;
    const sender = displayMessage(message).who;
    if (!sender || sender === assistantDisplayName) return;
    const mention = roomMentionToken(sender);
    setRoomMessage((current) => current.includes(mention) ? current : `${mention} ${current}`);
  }

  function handleSessionGoalChange(goal: GoalSummary | null) {
    if (!session) return;
    onSessionUpdated({ ...session, goal, updatedAt: new Date().toISOString() });
    if (session.roomId) setRoomRefreshKey((current) => current + 1);
  }
  const sessionInfoItems = [
    { label: t("session.infoTitleLabel"), value: pageSessionTitle ?? t("session.untitled") },
    ...(isRoomSession && roomDisplayName ? [{ label: t("room.title"), value: roomDisplayName }] : []),
    { label: t("session.infoProject"), value: composerProjectName },
    { label: t("session.infoKind"), value: session?.kind ?? "session" },
    { label: t("session.infoWorkspace"), value: session?.workspacePath ?? selectedComposerProject?.workspacePath ?? t("session.workspacePending"), code: true },
    { label: t("session.infoCreated"), value: formatShortDate(session?.createdAt) },
    { label: t("session.infoUpdated"), value: formatShortDate(session?.updatedAt) },
    { label: t("session.infoStatus"), value: readableStatus(effectiveSessionStatus, t) },
    { label: t("session.infoProvider"), value: sessionProvider?.name ?? t("session.notSelected") },
    { label: t("session.infoModel"), value: session?.model ?? draftModel ?? t("session.notSelected") },
  ];

  useEffect(() => {
    onQueueChangeRef.current = onQueueChange;
    onTaskDetailRef.current = onTaskDetail;
  }, [onQueueChange, onTaskDetail]);

  useEffect(() => {
    const provider = selectedProvider;
    if (!provider) return;
    const overrideModels = providerModelOverrides[provider.id] ?? [];
    const models = overrideModels.length ? overrideModels : provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
    setDraftModels(models);
    setDraftModel((current) => current && models.includes(current) ? current : models[0] ?? provider.defaultModel);
  }, [selectedProvider?.id, selectedProvider?.defaultModel, selectedProvider?.models, providerModelOverrides]);

  useEffect(() => {
    const provider = selectedProvider;
    if (!provider || provider.modelsCachedAt || provider.models?.length || loadingProviderModelsRef.current.has(provider.id)) return;
    const providerId = provider.id;
    loadingProviderModelsRef.current.add(providerId);
    let cancelled = false;
    async function loadProviderModels() {
      const response = await fetch(`/api/providers/${providerId}/models`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = response.ok ? await response.json() as ProviderModelsResponse : null;
      if (!cancelled && result?.models?.length) {
        setProviderModelOverrides((current) => ({ ...current, [providerId]: result.models }));
      }
      loadingProviderModelsRef.current.delete(providerId);
    }
    void loadProviderModels().catch(() => {
      loadingProviderModelsRef.current.delete(providerId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider?.id, selectedProvider?.modelsCachedAt, selectedProvider?.models, sessionToken]);

  useEffect(() => {
    if (session) setDraftSubmittedMessages([]);
    setSessionNotifyRules([]);
    setRoomDisplayName("");
    setReplyTarget(null);
  }, [session?.id]);

  useEffect(() => {
    setMessagePage({ items: [], nextCursor: null, hasMore: false });
    setLiveStatus("");
    lastOutputAtRef.current = "";
    setLastOutputAt("");
    setTaskRuns([]);
    setTaskRunCursor(null);
    setTaskRunHasMore(false);
    setSessionUsage(null);
    setExecutionContexts([]);
    setMessageCards([]);
    setEventStreamNotice("");
    if (!session?.id) return;
    void loadMessages(false, true);
    if (session.conversationType === "room" && session.roomId) {
      void loadRoomActiveRuns();
    }
    void loadQueue();
    void loadTaskRuns();
    void loadSessionUsage();
    void loadExecutionContexts();
    void loadMessageCards();
  }, [session?.id, sessionToken]);

  async function loadMessages(older: boolean, force = false) {
    if (!session?.id || (!force && loadingMessages)) return;
    setLoadingMessages(true);
    if (older) skipNextTimelineScrollRef.current = true;
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (older && messagePage.nextCursor) params.set("before", messagePage.nextCursor);
      const response = await fetch(`/api/sessions/${session.id}/messages?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return;
      const page = (await response.json()) as SessionMessagesPage;
      setMessagePage((current) => ({
        items: older ? [...page.items, ...current.items] : page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      }));
    } finally {
      setLoadingMessages(false);
    }
  }

  async function loadRoomActiveRuns() {
    if (!session?.roomId) {
      setRoomActiveAgentIds([]);
      return [] as string[];
    }
    const response = await fetch(`/api/rooms/${session.roomId}/runs?limit=20`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return roomActiveAgentIds;
    const page = (await response.json()) as PageResponse<AgentRunSummary>;
    const activeIds = [...new Set(page.items.filter((run) => run.status === "running").map((run) => run.agentId))];
    setRoomActiveAgentIds(activeIds);
    return activeIds;
  }

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    if (skipNextTimelineScrollRef.current) {
      skipNextTimelineScrollRef.current = false;
      return;
    }
    window.requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
    });
  }, [session?.id, visibleMessages.length, taskRunning, liveStatus, queuedMessages.length]);

  useEffect(() => {
    if (!session?.roomId || roomMessageMode !== "polling" || !roomEventStreamNotice || (!roomFollowupUntil && !roomActiveAgentIds.length)) return;
    let stopped = false;
    async function refreshRoomFollowups() {
      if (stopped) return;
      const [, activeIds] = await Promise.all([loadMessages(false, true), loadRoomActiveRuns()]);
      if (!stopped && (Date.now() < roomFollowupUntil || activeIds.length > 0)) {
        window.setTimeout(refreshRoomFollowups, 2000);
      }
    }
    void refreshRoomFollowups();
    return () => {
      stopped = true;
    };
  }, [roomEventStreamNotice, roomFollowupUntil, roomActiveAgentIds.length, roomMessageMode, session?.roomId, sessionToken]);

  useEffect(() => {
    if (!session?.roomId || !isRoomSession || !sessionToken) {
      setRoomEventStreamNotice("");
      return;
    }
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let noticeTimer: number | null = null;
    let reconnectDelay = 2500;
    let closed = false;
    const roomId = session.roomId;
    const eventUrl = `/api/rooms/${encodeURIComponent(roomId)}/events/stream?${new URLSearchParams({ token: sessionToken })}`;
    const markRoomStreamHealthy = () => {
      reconnectDelay = 2500;
      if (noticeTimer !== null) {
        window.clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      setRoomEventStreamNotice("");
    };
    const applyRoomStream = (data: Extract<RoomStreamEvent, { type: "snapshot" | "activity" }>) => {
      const activeIds = [...new Set(data.runs.filter((run) => run.status === "running").map((run) => run.agentId))];
      setRoomActiveAgentIds(activeIds);
      setRoomFollowupUntil(activeIds.length ? Date.now() + 45_000 : 0);
      if (data.messages.length) setMessagePage((current) => ({ ...current, items: mergeMessages(current.items, data.messages) }));
      const event = data.type === "activity" ? data.event ?? data.events[0] : data.events[0];
      if (event) setRoomConsoleUpdate({ roomId, event, tasks: data.tasks, runs: data.runs, version: Date.now() });
      publishTaskActivityChanged(session.id);
      publishWorkspaceChanged(session.id);
    };
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(eventUrl);
      source.onopen = () => {
        markRoomStreamHealthy();
      };
      const handleEvent = (event: MessageEvent) => {
        markRoomStreamHealthy();
        const data = JSON.parse(event.data) as RoomStreamEvent;
        if (data.type === "snapshot" || data.type === "activity") applyRoomStream(data);
      };
      source.addEventListener("snapshot", handleEvent);
      source.addEventListener("activity", handleEvent);
      source.addEventListener("ping", markRoomStreamHealthy);
      source.onerror = () => {
        if (closed) return;
        source?.close();
        if (noticeTimer === null) {
          noticeTimer = window.setTimeout(() => {
            if (!closed) {
              setRoomEventStreamNotice(roomMessageMode === "polling" ? t("session.roomPollingNotice") : t("room.sseDisconnected"));
            }
            noticeTimer = null;
          }, 12000);
        }
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15_000);
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (noticeTimer !== null) window.clearTimeout(noticeTimer);
      source?.close();
    };
  }, [isRoomSession, roomMessageMode, session?.roomId, sessionToken, t]);

  async function loadQueue() {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/queue`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    onQueueChange(session.id, (await response.json()) as QueuedMessage[]);
  }

  async function loadTaskRuns(older = false) {
    if (!session?.id) return;
    const params = new URLSearchParams({ limit: "10" });
    if (older && taskRunCursor) params.set("cursor", taskRunCursor);
    const response = await fetch(`/api/codex/tasks/${session.id}/runs?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as PageResponse<TaskRunSummary>;
    setTaskRuns((current) => older ? [...current, ...result.items] : result.items);
    setTaskRunCursor(result.nextCursor);
    setTaskRunHasMore(result.hasMore);
  }

  async function loadSessionUsage() {
    if (!session?.id) return;
    const params = new URLSearchParams({ sessionId: session.id, limit: "5" });
    const response = await fetch(`/api/usage?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setSessionUsage((await response.json()) as TokenUsageResponse);
  }

  async function loadExecutionContexts() {
    if (!session?.id) return;
    const params = new URLSearchParams({ sessionId: session.id, limit: "5" });
    const response = await fetch(`/api/execution-contexts?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setExecutionContexts((await response.json()) as ExecutionContextSummary[]);
  }

  async function loadMessageCards() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/cards`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setMessageCards((await response.json()) as MessageCardSummary[]);
    window.dispatchEvent(new CustomEvent(taskActivityChangedEvent, { detail: { sessionId: session.id } }));
  }

  async function deleteMessageCard(cardId: string) {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setMessageCards((items) => items.filter((item) => item.id !== cardId));
    void loadMessageCards();
  }

  useEffect(() => {
    if (!session) return;
    if (session.providerId) onSelectProvider(session.providerId);
    if (session.model) setDraftModel(session.model);
  }, [onSelectProvider, session?.id, session?.model, session?.providerId]);

  useEffect(() => {
    if (!session?.id) return;
    if (isRoomSession) {
      setEventStreamNotice("");
      return;
    }
    if (shouldConnectTaskEvents) return;
    if (session.status === "running") setEventStreamNotice(t("session.eventStreamFallback"));
    const sessionId = session.id;
    let stopped = false;
    async function loadTaskDetail() {
      const response = await fetch(`/api/codex/tasks/${sessionId}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok || stopped) return;
      const detail = (await response.json()) as CodexTaskDetail;
      onTaskDetail(detail);
      setMessagePage((current) => {
        const merged = mergeMessages(current.items, detail.messages);
        if (merged.length === current.items.length && merged.every((message, index) => message === current.items[index])) return current;
        return { ...current, items: merged };
      });
      if (detail.session.status === "running" && !stopped && !shouldConnectTaskEvents) {
        window.setTimeout(loadTaskDetail, 1400);
      }
    }
    void loadTaskDetail();
    return () => {
      stopped = true;
    };
  }, [isRoomSession, onTaskDetail, session?.id, session?.status, session?.updatedAt, sessionToken, shouldConnectTaskEvents]);

  useEffect(() => {
    if (!session?.id || !shouldConnectTaskEvents) return;
    if (!sessionToken) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 2500;
    let closed = false;
    const eventUrl = `/api/codex/tasks/${encodeURIComponent(session.id)}/events?${new URLSearchParams({ token: sessionToken })}`;
    const mergeDetail = (nextSession: SessionSummary, messages: SessionMessage[] = [], exitCode: number | null = taskDetail?.exitCode ?? null) => {
      onTaskDetailRef.current({
        session: nextSession,
        messages,
        output: taskDetail?.output ?? "",
        exitCode,
      });
      if (messages.length) {
        setMessagePage((current) => ({ ...current, items: mergeMessages(current.items, messages) }));
      }
    };
    const handleEvent = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as TaskEvent;
      if (data.type === "snapshot") {
        setLiveStatus(data.session.status === "running" ? t("session.processing") : "");
        mergeDetail(data.session, data.messages, data.exitCode);
        onQueueChangeRef.current(data.session.id, data.queue);
      }
      if (data.type === "started") {
        setLiveStatus(t("session.started"));
        mergeDetail(data.session);
      }
      if (data.type === "output") {
        lastOutputAtRef.current = data.at;
        setLastOutputAt(data.at);
        setLiveStatus(`${t("session.outputting")} ${formatShortDate(data.at)}`);
      }
      if (data.type === "activity") {
        lastOutputAtRef.current = data.at;
        setLastOutputAt(data.at);
        setLiveStatus(data.detail ? `${data.label}：${data.detail}` : data.label);
        publishTaskActivityChanged(session.id);
        if ((data.kind === "file" || data.kind === "command") && (data.status === "completed" || data.status === "failed")) {
          publishWorkspaceChanged(session.id);
        }
      }
      if (data.type === "workspace") {
        publishWorkspaceChanged(data.session.id);
      }
      if (data.type === "message") {
        setLiveStatus(t("session.replied"));
        mergeDetail(data.session, [data.message]);
        void loadMessageCards();
      }
      if (data.type === "queue") {
        onQueueChangeRef.current(data.session.id, data.queue);
      }
      if (data.type === "done") {
        setLiveStatus("");
        publishWorkspaceChanged(data.session.id);
        publishTaskActivityChanged(data.session.id);
        void loadTaskRuns();
        void loadSessionUsage();
        void loadMessages(false, true);
        setSessionNotifyRules((items) => items.filter((rule) => rule.eventType !== (data.exitCode === 0 ? "task_completed" : "task_failed")));
        mergeDetail(data.session, [], data.exitCode);
      }
      if (data.type === "error") {
        setLiveStatus(`${t("session.failed")}：${data.error}`);
        publishTaskActivityChanged(data.session.id);
        void loadTaskRuns();
        void loadSessionUsage();
        void loadMessages(false, true);
        setSessionNotifyRules((items) => items.filter((rule) => rule.eventType !== "task_failed"));
        mergeDetail(data.session);
      }
    };
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(eventUrl);
      for (const name of ["snapshot", "started", "output", "activity", "workspace", "message", "queue", "done", "error", "task-error"]) {
        source.addEventListener(name, handleEvent);
      }
      source.onopen = () => {
        reconnectDelay = 2500;
        setEventStreamNotice("");
      };
      source.onerror = () => {
        const lastAt = lastOutputAtRef.current;
        setLiveStatus(lastAt ? `${t("session.reconnecting")} ${formatShortDate(lastAt)}` : t("session.connectingEvents"));
        setEventStreamNotice(t("session.eventStreamReconnecting"));
        source?.close();
        if (closed) return;
        const delay = reconnectDelay;
        reconnectDelay = Math.min(Math.round(reconnectDelay * 1.6), 15_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [session?.id, session?.status, sessionToken, shouldConnectTaskEvents]);

  useEffect(() => {
    if (!session?.roomId || !isRoomSession) {
      setRoomMentionAgents([]);
      setRoomActiveAgentIds([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/rooms/${session.roomId}/agents`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    })
      .then((response) => response.ok ? response.json() : [])
      .then((items: AgentSummary[]) => {
        if (!cancelled) setRoomMentionAgents(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isRoomSession, session?.roomId, sessionToken]);

  function roomMentionToken(value: string) {
    return /\s/.test(value) ? `@"${value.replace(/"/g, '\\"')}"` : `@${value}`;
  }

  function insertRoomMention(value: string) {
    setRoomMessage((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${roomMentionToken(value)} `);
  }

  function insertComposerText(target: ComposerTarget, text: string) {
    const update = (current: string) => `${current}${current.trim() ? "\n\n" : ""}${text}`;
    if (target === "room") setRoomMessage(update);
    else setPrompt(update);
    window.setTimeout(() => {
      const node = target === "room" ? roomTextareaRef.current : promptTextareaRef.current;
      node?.focus();
      const value = target === "room" ? roomTextareaRef.current?.value ?? "" : promptTextareaRef.current?.value ?? "";
      node?.setSelectionRange(value.length, value.length);
    }, 0);
  }

  const taskTemplates = [
    { id: "fix", title: t("session.taskTemplateFix"), prompt: t("session.taskTemplateFixPrompt") },
    { id: "review", title: t("session.taskTemplateReview"), prompt: t("session.taskTemplateReviewPrompt") },
    { id: "test", title: t("session.taskTemplateTest"), prompt: t("session.taskTemplateTestPrompt") },
    { id: "refactor", title: t("session.taskTemplateRefactor"), prompt: t("session.taskTemplateRefactorPrompt") },
    { id: "docs", title: t("session.taskTemplateDocs"), prompt: t("session.taskTemplateDocsPrompt") },
  ];

  function insertTaskTemplate(template: { prompt: string }) {
    if (!taskTemplateTarget) return;
    insertComposerText(taskTemplateTarget, template.prompt);
    setTaskTemplateTarget(null);
  }

  function composerReferenceRoot() {
    if (session?.workspacePath) {
      return { rootPath: session.workspacePath, sourceLabel: pageSessionTitle ?? session.title };
    }
    const projectRoot = project?.workspacePath ?? selectedComposerProject?.workspacePath;
    if (projectRoot) {
      return { rootPath: projectRoot, sourceLabel: composerProjectName };
    }
    return null;
  }

  async function loadFileReferencePicker(path = ".", target: ComposerTarget = fileReferencePicker?.target ?? "prompt") {
    const root = fileReferencePicker && fileReferencePicker.target === target
      ? { rootPath: fileReferencePicker.rootPath, sourceLabel: fileReferencePicker.sourceLabel }
      : composerReferenceRoot();
    if (!root) {
      notify(t("session.commandFileNeedsWorkspace"), "error");
      return;
    }
    setFileReferencePicker((current) => ({
      target,
      rootPath: root.rootPath,
      sourceLabel: root.sourceLabel,
      list: current?.rootPath === root.rootPath && current.target === target ? current.list : null,
    }));
    const response = await fetch(`/api/files?${new URLSearchParams({ rootPath: root.rootPath, path })}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("session.commandFileReadFailed"), "error");
      return;
    }
    const list = (await response.json()) as FileListResponse;
    setFileReferencePicker({ target, rootPath: root.rootPath, sourceLabel: root.sourceLabel, list });
  }

  function openFileReferencePicker(target: ComposerTarget) {
    void loadFileReferencePicker(".", target);
  }

  function addFileReference(entry?: FileEntry) {
    if (!fileReferencePicker?.list) return;
    const list = fileReferencePicker.list;
    const itemPath = entry?.path ?? list.path;
    const kind = entry?.kind ?? "directory";
    const name = entry?.name ?? (itemPath === "." ? fileReferencePicker.sourceLabel : itemPath.split("/").at(-1) ?? itemPath);
    const absolutePath = itemPath === "."
      ? fileReferencePicker.rootPath
      : `${fileReferencePicker.rootPath.replace(/\/+$/, "")}/${itemPath.replace(/^\/+/, "")}`;
    const reference: ComposerFileReference = {
      id: `${fileReferencePicker.rootPath}:${itemPath}:${Date.now()}`,
      name,
      path: itemPath,
      absolutePath,
      kind,
      sourceLabel: fileReferencePicker.sourceLabel,
    };
    const update = (items: ComposerFileReference[]) => items.some((item) => item.absolutePath === reference.absolutePath)
      ? items
      : [...items, reference];
    if (fileReferencePicker.target === "room") setRoomFileReferences(update);
    else setPromptFileReferences(update);
    setFileReferencePicker(null);
  }

  async function loadNotifySettings() {
    const settings = await fetchNotificationSettings(sessionToken);
    if (!settings) return null;
    setNotifySettings(settings);
    const firstRecipient = settings.recipients.find((recipient) => recipient.enabled);
    if (firstRecipient) {
      setNotifyChannelKind(firstRecipient.kind);
      setNotifyRecipientId(firstRecipient.id);
      setNotifySenderAccountId(defaultNotifySenderId(firstRecipient));
    }
    return settings;
  }

  async function openNotifyBuilder() {
    const settings = notifySettings ?? await loadNotifySettings();
    const firstRecipient = settings?.recipients.find((recipient) => recipient.enabled);
    if (!firstRecipient) {
      notify(t("session.commandNotifyNoRecipients"), "error");
      return;
    }
    setNotifyChannelKind(firstRecipient.kind);
    setNotifyRecipientId(firstRecipient.id);
    setNotifySenderAccountId(defaultNotifySenderId(firstRecipient));
    setNotifyBuilderOpen(true);
  }

  async function createNotifyRule(event: React.FormEvent) {
    event.preventDefault();
    if (!notifyRecipientId) return;
    const recipient = notifyRecipients.find((item) => item.id === notifyRecipientId);
    let persisted = false;
    let id = `local-${Date.now()}`;
    if (session?.id) {
      const result = await createNotificationEphemeralRule(sessionToken, {
        scopeType: "session",
        scopeId: session.id,
        eventTypes: [notifyEventType],
        targets: [{ recipientId: notifyRecipientId, senderAccountId: notifySenderAccountId || undefined }],
        expireMode: "after_trigger",
      });
      if (!result) {
        notify(t("session.commandNotifyCreateFailed"), "error");
        return;
      }
      id = result?.id ?? id;
      persisted = true;
    }
    setSessionNotifyRules((items) => [
      ...items,
      { id, eventType: notifyEventType, recipientName: recipient?.name ?? notifyRecipientId, recipientId: notifyRecipientId, senderAccountId: notifySenderAccountId || undefined, persisted },
    ]);
    setNotifyBuilderOpen(false);
    notify(t("session.commandNotifyCreated"), "success");
  }

  const slashCommands = [
    {
      id: "file",
      command: "/file",
      icon: Files,
      title: t("session.commandFile"),
      description: t("session.commandFileHelp"),
      disabled: !composerReferenceRoot(),
      run: (target: ComposerTarget) => {
        openFileReferencePicker(target);
      },
    },
    {
      id: "preview",
      command: "/preview",
      icon: Globe,
      title: t("session.commandPreview"),
      description: t("session.commandPreviewHelp"),
      disabled: !session,
      run: () => {
        void openSessionPreviews();
      },
    },
    {
      id: "task",
      command: "/task",
      icon: Send,
      title: t("session.commandTask"),
      description: t("session.commandTaskHelp"),
      run: (target: ComposerTarget) => {
        setTaskTemplateTarget(target);
      },
    },
    {
      id: "context",
      command: "/context",
      icon: FolderGit2,
      title: t("session.commandContext"),
      description: t("session.commandContextHelp"),
      disabled: !session,
      run: () => {
        void openTaskContext();
      },
    },
    {
      id: "agent",
      command: "/agent",
      icon: Bot,
      title: t("session.commandAgent"),
      description: t("session.commandAgentHelp"),
      disabled: !isRoomSession,
      run: () => {
        setAgentPickerOpen(true);
      },
    },
    {
      id: "notify",
      command: "/notify",
      icon: Bell,
      title: t("session.commandNotify"),
      description: t("session.commandNotifyHelp"),
      run: () => {
        void openNotifyBuilder();
      },
    },
    {
      id: "stop",
      command: "/stop",
      icon: Square,
      title: t("session.commandStop"),
      description: t("session.commandStopHelp"),
      disabled: !session || !taskRunning,
      run: () => {
        if (session) void onStopTask(session.id);
      },
    },
    {
      id: "new",
      command: "/new",
      icon: RotateCcw,
      title: t("session.commandNew"),
      description: t("session.commandNewHelp"),
      run: (target: "prompt" | "room") => {
        if (target === "room") setRoomMessage("");
        else setPrompt("");
        setReplyTarget(null);
      },
    },
    {
      id: "compact",
      command: "/compact",
      icon: Boxes,
      title: t("session.commandCompact"),
      description: t("session.commandCompactHelp"),
      disabled: !session || compactingMemory,
      run: () => {
        void compactSessionMemory();
      },
    },
  ];

  function commandMatches(value: string) {
    const query = value.toLowerCase();
    if (!query.startsWith("/")) return [];
    return slashCommands.filter((item) => item.command.toLowerCase().startsWith(query) || item.title.toLowerCase().includes(query.slice(1)));
  }

  function activeSlashCommands(target: "prompt" | "room") {
    return slashMenuTarget === target ? commandMatches(slashMenuQuery) : [];
  }

  function closeSlashMenu() {
    setSlashMenuTarget(null);
    setSlashMenuIndex(0);
    setSlashMenuQuery("");
    setSlashTokenRange(null);
  }

  function replaceActiveSlashToken(target: "prompt" | "room", replacement = "") {
    if (!slashTokenRange || slashTokenRange.target !== target) return;
    const value = target === "room" ? roomMessage : prompt;
    const before = value.slice(0, slashTokenRange.start);
    const after = value.slice(slashTokenRange.end);
    const next = `${before}${replacement}${after}`.replace(/[ \t]{2,}/g, " ");
    if (target === "room") setRoomMessage(next);
    else setPrompt(next);
    window.setTimeout(() => {
      const node = target === "room" ? roomTextareaRef.current : promptTextareaRef.current;
      const cursor = Math.max(0, before.length + replacement.length);
      node?.focus();
      node?.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function runSlashCommand(target: "prompt" | "room", command = activeSlashCommands(target)[slashMenuIndex]) {
    if (!command || command.disabled) return;
    replaceActiveSlashToken(target, "");
    command.run(target);
    closeSlashMenu();
  }

  function handleSlashKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, target: "prompt" | "room") {
    const commands = slashMenuTarget === target ? activeSlashCommands(target) : [];
    if (!commands.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashMenuIndex((index) => Math.min(commands.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashMenuIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runSlashCommand(target, commands[slashMenuIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
    }
  }

  function updateComposerValue(target: "prompt" | "room", value: string, cursor = value.length) {
    if (target === "room") setRoomMessage(value);
    else setPrompt(value);
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)(\/[^\s]*)$/);
    if (!match || match.index === undefined) {
      if (slashMenuTarget === target) closeSlashMenu();
      return;
    }
    const query = match[2] ?? "";
    const start = match.index + (match[1]?.length ?? 0);
    setSlashMenuTarget(target);
    setSlashMenuQuery(query);
    setSlashTokenRange({ target, start, end: cursor });
    setSlashMenuIndex(0);
  }

  function addComposerFiles(target: "prompt" | "room", files: FileList | null) {
    const current = target === "room" ? roomAttachments : promptAttachments;
    const next = Array.from(files ?? []).filter((file) => {
      if (file.size <= maxComposerAttachmentBytes) return true;
      notify(t("session.attachmentTooLarge").replace("{name}", file.name).replace("{size}", formatBytes(maxComposerAttachmentBytes)), "error");
      return false;
    });
    if (!next.length) return;
    if (current.length + next.length > maxComposerAttachmentFiles) {
      notify(t("session.attachmentTooMany").replace("{count}", String(maxComposerAttachmentFiles)), "error");
      next.splice(Math.max(0, maxComposerAttachmentFiles - current.length));
    }
    if (!next.length) return;
    if (target === "room") setRoomAttachments((current) => [...current, ...next]);
    else setPromptAttachments((current) => [...current, ...next]);
  }

  function removeComposerFile(target: "prompt" | "room", index: number) {
    const removeAt = (items: File[]) => items.filter((_, itemIndex) => itemIndex !== index);
    if (target === "room") setRoomAttachments(removeAt);
    else setPromptAttachments(removeAt);
  }

  function removeFileReference(target: ComposerTarget, id: string) {
    const remove = (items: ComposerFileReference[]) => items.filter((item) => item.id !== id);
    if (target === "room") setRoomFileReferences(remove);
    else setPromptFileReferences(remove);
  }

  function renderComposerAttachments(target: "prompt" | "room") {
    const files = target === "room" ? roomAttachments : promptAttachments;
    const references = target === "room" ? roomFileReferences : promptFileReferences;
    if (!files.length && !references.length && !sessionNotifyRules.length) return null;
    return (
      <div className="composer-attachments">
        {sessionNotifyRules.map((rule) => (
          <span className="composer-attachment notification-intent-chip" key={rule.id}>
            <Bell size={14} />
            <span>{readableNotificationEvent(rule.eventType, t)}{" -> "}{rule.recipientName}</span>
          </span>
        ))}
        {files.map((file, index) => (
          <span className="composer-attachment" key={`${file.name}-${file.size}-${index}`}>
            <span>{file.name}</span>
            <small>{formatBytes(file.size)}</small>
            <button className="icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => removeComposerFile(target, index)}><X size={14} /></button>
          </span>
        ))}
        {references.map((reference) => (
          <span className="composer-attachment file-reference-chip" key={reference.id} title={reference.absolutePath}>
            <Files size={14} />
            <span>{reference.name}</span>
            <small>{reference.kind === "directory" ? t("file.directoryShort") : reference.sourceLabel}</small>
            <button className="icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => removeFileReference(target, reference.id)}><X size={14} /></button>
          </span>
        ))}
      </div>
    );
  }

  function renderSlashCommandMenu(target: "prompt" | "room") {
    const commands = activeSlashCommands(target);
    if (slashMenuTarget !== target || !commands.length) return null;
    return (
      <div className="slash-command-menu" role="listbox" aria-label={t("session.commandMenuTitle")}>
        <div className="slash-command-title">{t("session.commandMenuTitle")}</div>
        {commands.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              className={`slash-command-item ${index === slashMenuIndex ? "active" : ""}`}
              type="button"
              disabled={item.disabled}
              key={item.id}
              onMouseEnter={() => setSlashMenuIndex(index)}
              onClick={() => runSlashCommand(target, item)}
            >
              <span className="slash-command-icon"><Icon size={18} /></span>
              <span className="slash-command-copy">
                <strong>{item.command}</strong>
                <span>{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function replaceActiveRoomMention(value: string) {
    setRoomMessage((current) => {
      const match = current.match(/(^|\s)@(?:"([^"]*)|([^\s@]*))$/);
      if (!match || match.index === undefined) return `${current}${current && !current.endsWith(" ") ? " " : ""}${roomMentionToken(value)} `;
      const prefix = current.slice(0, match.index) + match[1];
      return `${prefix}${roomMentionToken(value)} `;
    });
  }

  function activeRoomMentionQuery() {
    const match = roomMessage.match(/(^|\s)@(?:"([^"]*)|([^\s@]*))$/);
    return match ? (match[2] ?? match[3] ?? "").toLowerCase() : null;
  }

  async function submitRoomMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.roomId || (!roomMessage.trim() && !roomAttachments.length && !roomFileReferences.length)) return;
    const content = promptWithFileReferences(roomMessage.trim() || t("session.attachmentOnlyPrompt"), roomFileReferences);
    const attachments = await filesToAttachmentInputs(roomAttachments).catch(() => null);
    if (roomAttachments.length && !attachments) {
      notify(t("session.attachmentReadFailed"), "error");
      return;
    }
    const response = await fetch(`/api/rooms/${session.roomId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ content, sessionId: session.id, replyToMessageId: replyTarget?.id ?? null, attachments: attachments ?? undefined }),
    });
    if (!response.ok) {
      notify(t("session.attachmentUploadFailed"), "error");
      return;
    }
    const result = (await response.json()) as CreateRoomMessageResponse;
    const displayContent = messageTextWithContext(roomMessage.trim() || t("session.attachmentOnlyPrompt"), roomAttachments, roomFileReferences);
    const nextMessage = result.message
      ? { ...result.message, replyTo: replyTarget ? { id: replyTarget.id, role: replyTarget.role, content: replyTarget.content } : result.message.replyTo }
      : { ...localUserMessage(displayContent), replyToMessageId: replyTarget?.id ?? null, replyTo: replyTarget ? { id: replyTarget.id, role: replyTarget.role, content: replyTarget.content } : null };
    setRoomMessage("");
    setRoomAttachments([]);
    setRoomFileReferences([]);
    setReplyTarget(null);
    setMessagePage((current) => ({ ...current, items: mergeMessages(current.items, [nextMessage]) }));
    if (result.session) onSessionUpdated(result.session);
    setRoomConsoleUpdate({ roomId: session.roomId, event: result.event, tasks: result.tasks, runs: result.runs, version: Date.now() });
    if (result.runs.length) setRoomActiveAgentIds([...new Set(result.runs.filter((run) => run.status === "running" || run.status === "queued").map((run) => run.agentId))]);
    if (result.tasks.length || result.runs.length) setRoomFollowupUntil(Date.now() + 45_000);
    if (result.tasks.length && /(^|\s)@(?:user\b|"[^"]+"|[^\s@]+)/i.test(content)) {
      notify(t("room.mentionTaskCreated").replace("{count}", String(result.tasks.length)), "success");
    }
  }

  async function renameSessionTitle() {
    if (!session) return;
    const title = await dialog.prompt({
      title: t("session.renameTitle"),
      message: t("session.renameTitleHint"),
      defaultValue: session.title,
      placeholder: t("session.infoTitleLabel"),
      confirmLabel: t("action.rename"),
    });
    if (!title?.trim() || title.trim() === session.title) return;
    const body: UpdateSessionRequest = { title: title.trim() };
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      notify(t("session.renameTitleFailed"), "error");
      return;
    }
    const nextSession = (await response.json()) as SessionSummary;
    onSessionUpdated(nextSession);
    notify(t("session.renameTitleUpdated"), "success");
  }

  async function updateSessionNotifications(enabled: boolean) {
    if (!session) return;
    const body: UpdateSessionRequest = { notificationsEnabled: enabled };
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      notify(t("session.notificationToggleFailed"), "error");
      return;
    }
    const nextSession = (await response.json()) as SessionSummary;
    onSessionUpdated(nextSession);
    notify(enabled ? t("session.notificationEnabled") : t("session.notificationDisabled"), "success");
  }

  async function updateSessionShowMessageUsage(enabled: boolean | null) {
    if (!session) return;
    const body: UpdateSessionRequest = { showMessageUsage: enabled };
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      notify(t("session.showMessageUsageToggleFailed"), "error");
      return;
    }
    const nextSession = (await response.json()) as SessionSummary;
    onSessionUpdated(nextSession);
  }

  async function submitTask(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() && !promptAttachments.length && !promptFileReferences.length) return;
    if (taskRunning && promptAttachments.length) {
      notify(t("session.attachmentsCannotQueue"), "error");
      return;
    }
    const basePrompt = prompt.trim() || t("session.attachmentOnlyPrompt");
    const nextPrompt = promptWithFileReferences(basePrompt, promptFileReferences);
    const nextAttachments = promptAttachments;
    const attachmentInputs = await filesToAttachmentInputs(nextAttachments).catch(() => null);
    if (nextAttachments.length && !attachmentInputs) {
      notify(t("session.attachmentReadFailed"), "error");
      return;
    }
    const displayPrompt = messageTextWithContext(basePrompt, nextAttachments, promptFileReferences);
    const replyToMessageId = replyTarget?.id ?? null;
    setPrompt("");
    setPromptAttachments([]);
    setPromptFileReferences([]);
    setReplyTarget(null);
    if (session) {
      await onContinueTask(session.id, nextPrompt, selectedProviderId || null, draftModel || null, replyToMessageId, attachmentInputs ?? undefined, displayPrompt);
    } else {
      setDraftSubmittedMessages([localUserMessage(displayPrompt)]);
      const pendingNotifications = sessionNotifyRules
        .filter((rule) => !rule.persisted)
        .map((rule) => ({
          eventTypes: [rule.eventType],
          targets: [{ recipientId: rule.recipientId, senderAccountId: rule.senderAccountId }],
          expireMode: "after_trigger" as const,
        }));
      await onSubmitTask(nextPrompt, draftProjectId ?? null, selectedProviderId || null, draftModel || null, pendingNotifications.length ? pendingNotifications : undefined, attachmentInputs ?? undefined, displayPrompt);
    }
  }

  function reorderQueuedMessage(dragId: string | null, dropId: string) {
    if (!session?.id || !dragId || dragId === dropId) return;
    const dragIndex = queuedMessages.findIndex((item) => item.id === dragId);
    const dropIndex = queuedMessages.findIndex((item) => item.id === dropId);
    if (dragIndex < 0 || dropIndex < 0) return;
    const nextQueue = [...queuedMessages];
    const [moved] = nextQueue.splice(dragIndex, 1);
    nextQueue.splice(dropIndex, 0, moved);
    setDraggedQueueId(null);
    void onReorderQueuedMessages(session.id, nextQueue.map((item) => item.id));
  }

  function openWorkspaceFiles() {
    if (!session?.workspacePath) return;
    setWorkspacePanel("files");
  }

  function openWorkspaceTerminal() {
    if (!session?.workspacePath) return;
    setWorkspacePanel("terminal");
  }

  async function openSessionPreviews() {
    if (!session?.id) return;
    setPreviewPanelOpen(true);
    await loadSessionPreviews(true);
  }

  async function loadSessionPreviews(showLoading = false) {
    if (!session?.id) return;
    if (showLoading) setSessionPreviews(null);
    const params = new URLSearchParams({ scopeType: "session", scopeId: session.id });
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) setSessionPreviews((await response.json()) as PreviewSummary[]);
    else setSessionPreviews([]);
  }

  useEffect(() => {
    if (!previewPanelOpen || !sessionPreviews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadSessionPreviews(false), 1500);
    return () => window.clearTimeout(timer);
  }, [previewPanelOpen, sessionPreviews, session?.id, sessionToken]);

  async function createSessionPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.id) return;
    const body: CreatePreviewRequest = {
      scopeType: "session",
      scopeId: session.id,
      label: `${pageSessionTitle ?? session.title}:${previewPort}`,
      targetHost: "127.0.0.1",
      port: Number(previewPort),
      command: renderPreviewCommand(previewCommand, previewPort, previewDirectory),
      access: previewAccess,
      autoStart: true,
    };
    const response = await fetch("/api/previews", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        setLiveStatus(t("approval.required"));
        void openSessionPreviews();
        return;
      }
      setLiveStatus(result?.error ? `${t("project.previewStartFailed")}：${result.error}` : t("project.previewStartFailed"));
      return;
    }
    const preview = (await response.json()) as PreviewSummary;
    setSessionPreviews((items) => [preview, ...(items ?? []).filter((item) => item.id !== preview.id)]);
    void loadMessageCards();
  }

  async function stopSessionPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setSessionPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    void loadMessageCards();
  }

  async function deleteSessionPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setSessionPreviews((items) => (items ?? []).filter((item) => item.id !== preview.id));
    void loadMessageCards();
  }

  async function openTaskLog() {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/log`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskLogResponse;
    setTaskLogPanel({ log: result.log ? newestTaskRunsFirst(result.log) : t("session.noTaskLog") });
  }

  async function loadTaskContextFile(fileName: string, files = taskContextPanel?.files ?? []) {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/context/${encodeURIComponent(fileName)}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskContextFileResponse;
    setTaskContextPanel({ files, selectedName: result.name, content: result.content || t("session.noTaskContext") });
  }

  async function openTaskContext() {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/context`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskContextResponse;
    const first = result.files.find((file) => file.name === "context-pack.md") ?? result.files[0];
    if (!first) {
      setTaskContextPanel({ files: [], selectedName: "", content: t("session.noTaskContext") });
      return;
    }
    await loadTaskContextFile(first.name, result.files);
  }

  async function compactSessionMemory() {
    if (!session?.id || compactingMemory) return;
    setCompactingMemory(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/compact`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => null) as (SessionCompactionResponse & { error?: string }) | null;
      if (!response.ok || !result?.compaction) {
        notify(result?.error ? `${t("session.compactMemoryFailed")}：${result.error}` : t("session.compactMemoryFailed"), "error");
        return;
      }
      notify(`${t("session.compactMemoryDone")} · ${result.compaction.sourceMessageCount}`, "success");
      setTaskContextPanel({
        files: [],
        selectedName: "latest-summary.md",
        content: result.summary || t("session.noTaskContext"),
      });
    } finally {
      setCompactingMemory(false);
    }
  }

  async function openSessionMemory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compaction`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as (Partial<SessionCompactionResponse> & { compaction?: SessionCompactionResponse["compaction"] | null });
    if (!result.compaction) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    setTaskContextPanel({
      files: [],
      selectedName: "latest-summary.md",
      content: result.summary || t("session.noTaskContext"),
    });
  }

  async function editSessionMemory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compaction`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const current = (await response.json()) as (Partial<SessionCompactionResponse> & { compaction?: SessionCompactionResponse["compaction"] | null });
    if (!current.compaction) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    const summary = await dialog.prompt({
      title: t("session.editMemory"),
      message: t("session.editMemoryHint"),
      defaultValue: current.summary ?? "",
      confirmLabel: t("action.save"),
      multiline: true,
    });
    if (summary === null) return;
    const body: UpdateSessionCompactionRequest = { summary };
    const update = await fetch(`/api/sessions/${session.id}/compaction`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await update.json().catch(() => null) as (SessionCompactionResponse & { error?: string }) | null;
    if (!update.ok || !result?.compaction) {
      notify(result?.error ? `${t("session.editMemoryFailed")}：${result.error}` : t("session.editMemoryFailed"), "error");
      return;
    }
    notify(t("session.editMemoryDone"), "success");
    setTaskContextPanel({ files: [], selectedName: "latest-summary.md", content: result.summary });
  }

  async function openSessionMemoryHistory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compactions?limit=30`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as SessionCompactionListResponse;
    if (!result.items.length) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    const content = [
      "# Session Memory History",
      "",
      ...result.items.map((item, index) => [
        `## ${index === 0 ? t("session.latestMemory") : item.id}`,
        `- id: ${item.id}`,
        `- created: ${formatShortDate(item.createdAt)}`,
        `- source messages: ${item.sourceMessageCount}`,
        `- source chars: ${item.sourceChars}`,
        `- provider: ${item.providerId ?? "-"}`,
        `- model: ${item.model ?? "-"}`,
        `- supersedes: ${item.supersedesId ?? "-"}`,
        `- file: ${item.filePath}`,
      ].join("\n")),
    ].join("\n\n");
    setTaskContextPanel({ files: [], selectedName: "memory-history.md", content });
  }

  async function restoreSessionMemory() {
    if (!session?.id) return;
    const response = await fetch(`/api/sessions/${session.id}/compactions?limit=30`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const history = (await response.json()) as SessionCompactionListResponse;
    if (!history.items.length) {
      notify(t("session.noSessionMemory"), "info");
      return;
    }
    const defaultValue = history.items[1]?.id ?? history.items[0]?.id ?? "";
    const compactionId = await dialog.prompt({
      title: t("session.restoreMemory"),
      message: t("session.restoreMemoryHint"),
      defaultValue,
      placeholder: "compaction-...",
      confirmLabel: t("session.restoreMemory"),
    });
    if (!compactionId?.trim()) return;
    const restore = await fetch(`/api/sessions/${session.id}/compactions/${encodeURIComponent(compactionId.trim())}/restore`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const result = await restore.json().catch(() => null) as (SessionCompactionResponse & { error?: string }) | null;
    if (!restore.ok || !result?.compaction) {
      notify(result?.error ? `${t("session.restoreMemoryFailed")}：${result.error}` : t("session.restoreMemoryFailed"), "error");
      return;
    }
    notify(t("session.restoreMemoryDone"), "success");
    setTaskContextPanel({ files: [], selectedName: "latest-summary.md", content: result.summary });
  }

  const roomMentionQuery = isRoomSession ? activeRoomMentionQuery() : null;
  const roomMentionSuggestions = roomMentionQuery === null ? [] : [
    { id: "user", label: "user" },
    ...roomMentionAgents.map((agent) => ({ id: agent.id, label: agent.name })),
  ].filter((item) => item.label.toLowerCase().includes(roomMentionQuery)).slice(0, 8);
  const notificationCenter = React.useContext(NotificationCenterContext);

  return (
    <>
      <main className="conversation">
        <header className="task-header page-header">
          <div className="header-title-row">
            <MobileMainToggle label={t("nav.sessions")} onClick={onOpenMainNav} />
            <div className="session-heading-block">
              <div className="session-title-line">
                {session && <span className={`session-type-badge ${session.conversationType ?? "codex"}`}>{readableSessionType(session, t)}</span>}
                <h1 title={pageSessionTitle ?? t("session.untitled")}>{pageSessionTitle ?? t("session.untitled")}</h1>
              </div>
              <div className="task-path">{session ? `${readableStatus(effectiveSessionStatus, t)} · ${sessionProviderModelLabel}` : selectedComposerProject ? projectDisplayName(selectedComposerProject, projects) : t("session.noProject")}</div>
            </div>
          </div>
          <div className="header-actions session-actions">
            {notificationCenter}
            <button className="ghost-button icon-only session-secondary-action" title={t("session.infoTitle")} aria-label={t("session.infoTitle")} onClick={() => setInfoOpen(true)}><IconText icon={Info}>{t("session.infoTitle")}</IconText></button>
            <button className="ghost-button icon-only session-primary-action" title={t("nav.files")} aria-label={t("nav.files")} disabled={!session} onClick={openWorkspaceFiles}><IconText icon={Files}>{t("nav.files")}</IconText></button>
            <button className="ghost-button icon-only session-primary-action" title={t("nav.terminal")} aria-label={t("nav.terminal")} disabled={!session} onClick={openWorkspaceTerminal}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
            <button className="ghost-button icon-only session-mobile-progress" type="button" title={t("progress.title")} aria-label={t("progress.title")} disabled={!session} onClick={() => setMobileContextPanel("progress")}><IconText icon={Check}>{t("progress.title")}</IconText></button>
            <button className="ghost-button icon-only session-secondary-action" title={t("project.preview")} aria-label={t("project.preview")} disabled={!session} onClick={() => void openSessionPreviews()}><IconText icon={Globe}>{t("project.preview")}</IconText></button>
            <button className="ghost-button icon-only session-secondary-action" title={t("preview.stop")} aria-label={t("preview.stop")} disabled={!session || session.status !== "running"} onClick={() => session && onStopTask(session.id)}><IconText icon={Square}>{t("preview.stop")}</IconText></button>
            <button className="ghost-button danger-button icon-only session-delete-action" title={t("action.delete")} aria-label={t("action.delete")} disabled={!session} onClick={() => session && onDeleteSession(session.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ghost-button icon-only session-mobile-more" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setInfoOpen(true)}><IconText icon={Info}>{t("session.infoTitle")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => setMobileContextPanel("activity")}><IconText icon={Activity}>{t("session.activityTitle")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => setMobileContextPanel("changes")}><IconText icon={FolderGit2}>{t("workspace.changes")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session} onSelect={() => void openSessionPreviews()}><IconText icon={Globe}>{t("project.preview")}</IconText></DropdownMenuItem>
                <DropdownMenuItem disabled={!session || session.status !== "running"} onSelect={() => session && void onStopTask(session.id)}><IconText icon={Square}>{t("preview.stop")}</IconText></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="mobile-session-bar">
          <MobileSessionToggle label={pageSessionTitle ?? t("session.sessionList")} meta={sessionProviderModelLabel} onClick={onOpenSessionNav} />
        </div>
        <div className={`realtime-notice-slot ${realtimeNotice ? "active" : ""}`} aria-live="polite">
          {realtimeNotice && <><Info size={14} /><span>{realtimeNotice}</span></>}
        </div>
        <section className="timeline" ref={timelineRef}>
          {session?.conversationType === "room" && (
            <div className="room-console-chat-entry">
              <button className="ghost-button icon-only" type="button" title={t("room.title")} aria-label={t("room.title")} onClick={() => setRoomConsoleOpen(true)}>
                <IconText icon={Users}>{t("room.title")}</IconText>
              </button>
            </div>
          )}
          {!session && <Bubble who="C" text={t("session.chooseProjectHint")} t={t} />}
          {session && messagePage.hasMore && (
            <button className="ghost-button load-more" type="button" disabled={loadingMessages} onClick={() => void loadMessages(true)}>
              {loadingMessages ? t("session.loading") : t("session.loadMore")}
            </button>
          )}
          {visibleMessages.map((message) => {
            const display = displayMessage(message);
            return (
              <Bubble
                who={display.who}
                text={display.text}
                user={message.role === "user"}
                t={t}
                replyTo={message.replyTo}
                usage={messageUsageVisible ? message.usage : null}
                onReply={() => startReply(message)}
                key={message.id}
              />
            );
          })}
          {messageCards.length > 0 && <MessageCards items={messageCards} sessionToken={sessionToken} t={t} notify={notify} onDelete={(cardId) => void deleteMessageCard(cardId)} />}
          {isRoomSession && roomActiveAgentIds.map((agentId) => {
            const agent = roomMentionAgents.find((item) => item.id === agentId);
            return <Bubble who={agent?.name ?? "Agent"} text={t("session.thinking")} t={t} key={`thinking-${agentId}`} />;
          })}
          {!isRoomSession && taskRunning && <Bubble who={assistantDisplayName} text={liveStatus || t("session.processing")} t={t} />}
          {taskFailed && <Bubble who={assistantDisplayName} text={`${t("session.pausedWithExit")} ${taskDetail?.exitCode}。${t("session.pausedHint")}${taskDetail?.errorSummary ? `\n\n${taskDetail.errorSummary}` : ""}`} t={t} />}
          {taskInterrupted && <Bubble who={assistantDisplayName} text={t("session.interruptedHint")} t={t} />}
          {taskInterrupted && (
            <div className="message-actions recovery-actions">
              <button className="ghost-button" type="button" onClick={() => setPrompt(t("session.recoveryPrompt"))}>{t("session.prepareRecoveryPrompt")}</button>
              {session && <button className="dark-button" type="button" onClick={() => void onRecoverTask(session.id, t("session.recoveryPrompt"), selectedProviderId || null, draftModel || null)}>{t("session.recoverNow")}</button>}
            </div>
          )}
          {session && queuedMessages.length > 0 && (
            <section className="message-queue">
              <div className="queue-head">
                <strong>{t("session.queueTitle")}</strong>
                <span>{queuedMessages.length} {t("session.queueUnit")}</span>
              </div>
              {queuedMessages.map((item, index) => (
                <QueuedMessageRow
                  key={item.id}
                  item={item}
                  index={index}
                  dragging={draggedQueueId === item.id}
                  onDragStart={() => setDraggedQueueId(item.id)}
                  onDragEnd={() => setDraggedQueueId(null)}
                  onDropOn={() => reorderQueuedMessage(draggedQueueId, item.id)}
                  onSave={(nextPrompt) => onUpdateQueuedMessage(
                    session.id,
                    item.id,
                    nextPrompt,
                    item.providerId ?? (selectedProviderId || null),
                    item.model ?? (draftModel || null),
                  )}
                  onDelete={() => onDeleteQueuedMessage(session.id, item.id)}
                  t={t}
                />
              ))}
            </section>
          )}
        </section>
        {isRoomSession ? (
          <form className="composer" onSubmit={submitRoomMessage}>
            {replyTarget && (
              <div className="reply-composer">
                <span>{t("session.replyingTo")}: {replyTarget.content.slice(0, 120)}</span>
                <button className="ghost-button icon-only" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setReplyTarget(null)}><IconText icon={X}>{t("action.close")}</IconText></button>
              </div>
            )}
            <div className="room-mention-bar composer-mention-bar">
              <button className="ghost-button mention-chip" type="button" onClick={() => insertRoomMention("user")}>@user</button>
              {roomMentionAgents.map((agent) => (
                <button className={`ghost-button mention-chip ${roomActiveAgentIds.includes(agent.id) ? "active" : ""}`} key={agent.id} type="button" onClick={() => insertRoomMention(agent.name)}>
                  <span className="mention-status-dot" />
                  @{agent.name}
                </button>
              ))}
            </div>
            <div className="mention-composer-wrap">
              {renderComposerAttachments("room")}
              <div className="composer-input-row">
                <button className="composer-upload-button" type="button" title={t("session.addAttachment")} aria-label={t("session.addAttachment")} onClick={() => roomFileInputRef.current?.click()}><Plus size={20} /></button>
                <input ref={roomFileInputRef} name="roomattachments" type="file" multiple hidden onChange={(event) => { addComposerFiles("room", event.currentTarget.files); event.currentTarget.value = ""; }} />
                <textarea ref={roomTextareaRef} name="roommessage" rows={2} value={roomMessage} onChange={(event) => updateComposerValue("room", event.target.value, event.currentTarget.selectionStart)} onClick={(event) => updateComposerValue("room", event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={(event) => handleSlashKeyDown(event, "room")} placeholder={t("room.messagePlaceholder")} />
              </div>
              {renderSlashCommandMenu("room")}
              {!replyTarget && slashMenuTarget !== "room" && roomMentionSuggestions.length > 0 && (
                <div className="mention-suggestions">
                  {roomMentionSuggestions.map((item) => (
                    <button type="button" key={item.id} onClick={() => replaceActiveRoomMention(item.label)}>@{item.label}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-actions">
              <button type="submit" className="dark-button"><IconText icon={Send}>{t("session.send")}</IconText></button>
            </div>
          </form>
        ) : <form className="composer" onSubmit={submitTask}>
          {replyTarget && (
            <div className="reply-composer">
              <span>{t("session.replyingTo")}: {replyTarget.content.slice(0, 120)}</span>
              <button className="ghost-button icon-only" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setReplyTarget(null)}><IconText icon={X}>{t("action.close")}</IconText></button>
            </div>
          )}
          <div className="mention-composer-wrap">
            {renderComposerAttachments("prompt")}
            <div className="composer-input-row">
              <button className="composer-upload-button" type="button" title={t("session.addAttachment")} aria-label={t("session.addAttachment")} onClick={() => promptFileInputRef.current?.click()}><Plus size={20} /></button>
              <input ref={promptFileInputRef} name="promptattachments" type="file" multiple hidden onChange={(event) => { addComposerFiles("prompt", event.currentTarget.files); event.currentTarget.value = ""; }} />
              <textarea ref={promptTextareaRef} name="prompt" rows={2} value={prompt} onChange={(event) => updateComposerValue("prompt", event.target.value, event.currentTarget.selectionStart)} onClick={(event) => updateComposerValue("prompt", event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={(event) => handleSlashKeyDown(event, "prompt")} placeholder={t("form.composerPrompt")} />
            </div>
            {renderSlashCommandMenu("prompt")}
          </div>
          <div className="composer-actions">
            <button className="model-select mobile-model-picker-trigger" type="button" onClick={() => setMobileModelPickerOpen(true)} disabled={!providers.length} title={sessionProviderModelLabel}>
              <span>{selectedProvider?.name ?? t("session.noProvider")}</span>
              <small>{draftModel || selectedProvider?.defaultModel || t("session.noModel")}</small>
            </button>
            <select name="draftprovider" className="model-select desktop-composer-select" value={selectedProviderId} onChange={(event) => onSelectProvider(event.target.value)}>
              <option value="">{t("session.noProvider")}</option>
              {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
            </select>
            <select name="draftmodel" className="model-select desktop-composer-select" value={draftModel} onChange={(event) => setDraftModel(event.target.value)}>
              <option value="">{t("session.noModel")}</option>
              {composerModels.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
            {session ? (
              <div className="model-select readonly-model-select" title={session.workspacePath}>{composerProjectName}</div>
            ) : (
              <select name="composerprojectid" className="model-select" value={composerProjectId} onChange={(event) => onDraftProjectId(event.target.value === "scratch" ? null : event.target.value)}>
                <option value="scratch">{t("session.noProject")}</option>
                {projects.map((item) => <option value={item.id} key={item.id}>{t("page.projects")}：{item.name}</option>)}
              </select>
            )}
            <button type="submit" className="dark-button"><IconText icon={Send}>{taskRunning ? t("session.queue") : t("session.send")}</IconText></button>
          </div>
        </form>}
      </main>
      {mobileModelPickerOpen && (
        <div className="mobile-model-picker-layer" role="dialog" aria-modal="true">
          <button className="drawer-backdrop" type="button" aria-label={t("action.close")} onClick={() => setMobileModelPickerOpen(false)} />
          <div className="mobile-model-picker-card">
            <div>
              <strong>{t("session.infoProvider")}</strong>
              <span>{selectedProvider?.name ?? t("session.noProvider")} / {draftModel || selectedProvider?.defaultModel || t("session.noModel")}</span>
            </div>
            <label>
              <span>{t("session.infoProvider")}</span>
              <select className="model-select" value={selectedProviderId} onChange={(event) => onSelectProvider(event.target.value)}>
                <option value="">{t("session.noProvider")}</option>
                {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t("session.infoModel")}</span>
              <select className="model-select" value={draftModel} onChange={(event) => setDraftModel(event.target.value)}>
                <option value="">{t("session.noModel")}</option>
                {composerModels.map((model) => <option value={model} key={model}>{model}</option>)}
              </select>
            </label>
            <button className="dark-button" type="button" onClick={() => setMobileModelPickerOpen(false)}>{t("action.close")}</button>
          </div>
        </div>
      )}
      {session && workspacePanel && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{workspacePanel === "files" ? t("workspace.sessionFiles") : t("workspace.sessionTerminal")}</strong>
              <span>{pageSessionTitle}</span>
            </div>
            <div className="workspace-modal-controls">
              <div className="workspace-modal-actions">
                <button className={`ghost-button icon-only ${workspacePanel === "files" ? "active" : ""}`} type="button" title={t("nav.files")} aria-label={t("nav.files")} onClick={() => setWorkspacePanel("files")}><IconText icon={Files}>{t("nav.files")}</IconText></button>
                <button className={`ghost-button icon-only ${workspacePanel === "terminal" ? "active" : ""}`} type="button" title={t("nav.terminal")} aria-label={t("nav.terminal")} onClick={() => setWorkspacePanel("terminal")}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
              </div>
              <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setWorkspacePanel(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="workspace-modal-body">
            {workspacePanel === "files" && (
              <FilesPage sessionToken={sessionToken} t={t} initialRootPath={session.workspacePath} initialMountName={session.title || "Session Workspace"} embedded TerminalComponent={TerminalPage} />
            )}
            {workspacePanel === "terminal" && (
              <TerminalPage sessionToken={sessionToken} t={t} initialCwd={session.workspacePath} embedded />
            )}
          </div>
        </div>
      )}
      {previewPanelOpen && session && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.preview")}</strong>
              <span>{pageSessionTitle}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setPreviewPanelOpen(false)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            <form className="preview-form" onSubmit={createSessionPreview}>
              <label>
                <span>{t("project.previewCommand")}</span>
                <input name="previewcommand" value={previewCommand} onChange={(event) => setPreviewCommand(event.target.value)} placeholder="python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}" required />
              </label>
              <label>
                <span>{t("project.previewDirectory")}</span>
                <PreviewDirectoryPicker sessionToken={sessionToken} rootPath={session.workspacePath} value={previewDirectory} onChange={setPreviewDirectory} placeholder="." t={t} />
              </label>
              <label>
                <span>{t("project.previewPort")}</span>
                <input name="previewport" value={previewPort} onChange={(event) => setPreviewPort(event.target.value)} inputMode="numeric" placeholder="4179" required />
              </label>
              <label>
                <span>{t("preview.access")}</span>
                <select name="previewaccess" value={previewAccess} onChange={(event) => setPreviewAccess(event.target.value as PreviewAccess)}>
                  <option value="private">{t("preview.private")}</option>
                  <option value="public">{t("preview.public")}</option>
                </select>
              </label>
              <button className="ghost-button" type="submit"><IconText icon={Play}>{t("project.startPreview")}</IconText></button>
            </form>
            {!sessionPreviews && <div className="subtle">{t("project.loadingPreviews")}</div>}
            {sessionPreviews?.map((preview) => (
              <div className="preview-row" key={preview.id}>
                <div>
                  <strong>{preview.label}</strong>
                  <span>{preview.status} · {preview.access} · {preview.targetHost}:{preview.port}</span>
                  {preview.command && <code>{preview.command}</code>}
                </div>
                <div className="preview-actions">
                  <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, notify, t)}>{t("project.openPreview")}</button>
                  <button className="ghost-button" type="button" disabled={preview.status !== "running" && preview.status !== "starting"} onClick={() => void stopSessionPreview(preview)}>{t("action.disconnect")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteSessionPreview(preview)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {sessionPreviews && !sessionPreviews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      )}
      {mobileContextPanel && session && (
        <div className="dialog-layer mobile-context-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setMobileContextPanel(null)} />
          <section className="dialog-card mobile-context-card" role="dialog" aria-modal="true">
            <div className="dialog-head">
              <div>
                <strong>{mobileContextPanel === "progress" ? t("progress.title") : mobileContextPanel === "activity" ? t("session.activityTitle") : t("workspace.changes")}</strong>
                <p>{pageSessionTitle ?? t("session.untitled")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setMobileContextPanel(null)} title={t("action.close")}>
                <X size={16} />
              </button>
            </div>
            <ContextPanel
              sessionToken={sessionToken}
              session={session}
              taskDetail={taskDetail}
              queuedMessages={queuedMessages}
              onUpdateQueuedMessage={onUpdateQueuedMessage}
              onReorderQueuedMessages={onReorderQueuedMessages}
              onDeleteQueuedMessage={onDeleteQueuedMessage}
              t={t}
              initialPanel={mobileContextPanel}
              modal
              onOpenFile={(path) => {
                setMobileContextPanel(null);
                setChangeFileBrowser({ path });
              }}
            />
          </section>
        </div>
      )}
      {changeFileBrowser && session && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{changeFileBrowser.path}</strong>
              <span>{t("nav.files")}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setChangeFileBrowser(null)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <FilesPage sessionToken={sessionToken} t={t} initialRootPath={session.workspacePath} initialMountName={session.title || "Session Workspace"} initialPath={changeFileBrowser.path} embedded TerminalComponent={TerminalPage} />
        </div>
      )}
      {infoOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setInfoOpen(false)} />
          <section className="dialog-card session-info-card" role="dialog" aria-modal="true" aria-labelledby="session-info-title">
            <div className="dialog-head">
              <div>
                <strong id="session-info-title">{t("session.infoTitle")}</strong>
                <p>{session?.title ?? t("session.untitled")}</p>
              </div>
              <div className="dialog-head-actions">
                <button className="drawer-close" type="button" onClick={() => setInfoOpen(false)} title={t("action.close")}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="session-info-grid">
              {sessionInfoItems.map((item, index) => (
                <div className="session-info-row" key={item.label}>
                  <span>{item.label}</span>
                  {index === 0 ? (
                    <div className="session-info-value-action">
                      <strong>{item.value}</strong>
                      {session && <button className="ghost-button icon-only session-title-action" type="button" onClick={() => void renameSessionTitle()} title={t("session.renameTitle")} aria-label={t("session.renameTitle")}><Pencil size={14} /></button>}
                    </div>
                  ) : item.code ? <code>{item.value}</code> : <strong>{item.value}</strong>}
                </div>
              ))}
            </div>
            {session && (
              <div className="room-settings-grid">
                <label className="room-setting-row">
                  <span>{t("session.notifications")}</span>
                  <Switch checked={session.notificationsEnabled !== false} onCheckedChange={(checked) => void updateSessionNotifications(checked)} />
                </label>
                <span className="subtle">{t("session.notificationsHelp")}</span>
                <div className="room-setting-row">
                  <span>{t("session.showMessageUsage")}</span>
                  <div className="settings-actions compact-actions">
                    <button className={`ghost-button${session.showMessageUsage == null ? " active" : ""}`} type="button" onClick={() => void updateSessionShowMessageUsage(null)}>{t("session.showMessageUsageFollowGlobal")}</button>
                    <button className={`ghost-button${session.showMessageUsage === true ? " active" : ""}`} type="button" onClick={() => void updateSessionShowMessageUsage(true)}>{t("action.on")}</button>
                    <button className={`ghost-button${session.showMessageUsage === false ? " active" : ""}`} type="button" onClick={() => void updateSessionShowMessageUsage(false)}>{t("action.off")}</button>
                  </div>
                </div>
                <span className="subtle">{t("session.showMessageUsageHelp")}</span>
              </div>
            )}
            {session && goalOwnerId && (
              <div className="session-info-goal">
                <GoalPanel
                  sessionToken={sessionToken}
                  goal={session.goal}
                  ownerType={goalOwnerType}
                  ownerId={goalOwnerId}
                  t={t}
                  notify={notify}
                  onGoalChange={handleSessionGoalChange}
                  agents={roomMentionAgents}
                  expandSignal={goalInfoExpandSignal}
                />
              </div>
            )}
            {session?.conversationType === "room" && (
              <div className="room-settings-grid">
                <label className="room-setting-row room-message-mode-row">
                  <span>{t("room.messageMode")}</span>
                  <div className="room-switch-row" title={t("room.messageModeHelp")}>
                    <span className={roomMessageMode === "sse" ? "active" : ""}>{t("room.messageModeSse")}</span>
                    <Switch checked={roomMessageMode === "polling"} onCheckedChange={(checked) => setRoomMessageMode(checked ? "polling" : "sse")} />
                    <span className={roomMessageMode === "polling" ? "active" : ""}>{t("room.messageModePolling")}</span>
                  </div>
                </label>
                <span className="subtle">{t("room.messageModeHelp")}</span>
              </div>
            )}
            <div className="session-run-list">
              <div className="item-row">
                <strong>{t("usage.title")}</strong>
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} disabled={!session} onClick={() => void loadSessionUsage()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
              </div>
              {sessionUsage && sessionUsage.summary.records > 0 ? (
                <div className="session-info-grid">
                  <div className="session-info-row"><span>{t("usage.totalTokens")}</span><strong>{formatTokens(sessionUsage.summary.totalTokens)}</strong></div>
                  <div className="session-info-row"><span>{t("usage.inputTokens")}</span><strong>{formatTokens(sessionUsage.summary.inputTokens)}</strong></div>
                  <div className="session-info-row"><span>{t("usage.outputTokens")}</span><strong>{formatTokens(sessionUsage.summary.outputTokens)}</strong></div>
                  <div className="session-info-row"><span>{t("usage.cachedInputTokens")}</span><strong>{formatTokens(sessionUsage.summary.cachedInputTokens)}</strong></div>
                  <div className="session-info-row"><span>{t("usage.reasoningTokens")}</span><strong>{formatTokens(sessionUsage.summary.reasoningOutputTokens)}</strong></div>
                  <div className="session-info-row"><span>{t("usage.records")}</span><strong>{sessionUsage.summary.records}</strong></div>
                </div>
              ) : <div className="empty-state">{t("usage.empty")}</div>}
            </div>
            <div className="session-run-list">
              <div className="item-row">
                <strong>{t("session.runHistory")}</strong>
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} disabled={!session} onClick={() => void loadTaskRuns()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
              </div>
              {taskRuns.map((run) => (
                <div className="session-run-item" key={run.id}>
                  <strong>{readableRunStatus(run, t)}</strong>
                  <span>{formatShortDate(run.startedAt)} · {run.endedAt ? formatShortDate(run.endedAt) : t("session.statusRunning")} · exit {run.exitCode ?? "null"}</span>
                  {(run.promptChars || run.promptHash) && <span>{t("session.promptMeta")} · {run.promptChars ?? "-"} chars · {run.promptHash ?? "-"}</span>}
                  {run.interruptedReason && <code>{run.interruptedReason}</code>}
                </div>
              ))}
              {taskRunHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadTaskRuns(true)}>{t("session.loadMore")}</button>}
              {!taskRuns.length && <div className="empty-state">{t("session.noRunHistory")}</div>}
            </div>
            <div className="session-run-list">
              <div className="item-row">
                <strong>{t("session.executionContext")}</strong>
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} disabled={!session} onClick={() => void loadExecutionContexts()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
              </div>
              {executionContexts.map((context) => (
                <div className="session-run-item" key={context.id}>
                  <strong>{context.sourceType} · {context.createdBy}</strong>
                  <span>{context.providerId ?? "-"} / {context.model ?? "-"} · {context.sandboxMode} / {context.approvalPolicy}</span>
                  <code>{context.workspacePath}</code>
                </div>
              ))}
              {!executionContexts.length && <div className="empty-state">{t("session.noExecutionContext")}</div>}
            </div>
            <div className="settings-actions">
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openTaskLog()}>{t("session.viewTaskLog")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openTaskContext()}>{t("session.viewTaskContext")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openSessionMemory()}>{t("session.viewMemory")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void openSessionMemoryHistory()}>{t("session.memoryHistory")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void editSessionMemory()}>{t("session.editMemory")}</button>
              <button className="ghost-button" type="button" disabled={!session} onClick={() => void restoreSessionMemory()}>{t("session.restoreMemory")}</button>
              <button className="ghost-button" type="button" disabled={!session || compactingMemory} onClick={() => void compactSessionMemory()}>{compactingMemory ? t("session.compactingMemory") : t("session.compactMemory")}</button>
            </div>
          </section>
        </div>
      )}
      {roomConsoleOpen && session?.conversationType === "room" && session.roomId && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setRoomConsoleOpen(false)} />
          <section className="dialog-card room-info-card" role="dialog" aria-modal="true" aria-labelledby="room-console-title">
            <div className="dialog-head">
              <div>
                <strong id="room-console-title">{t("room.title")}</strong>
                <p>{roomDisplayName || session.title}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setRoomConsoleOpen(false)} title={t("action.close")}>
                <X size={16} />
              </button>
            </div>
            <RoomConsole sessionToken={sessionToken} roomId={session.roomId} sessionWorkspacePath={session.workspacePath} projectWorkspacePath={project?.workspacePath ?? null} reloadKey={roomRefreshKey} recentUpdate={roomConsoleUpdate} realtimeFallback={Boolean(roomEventStreamNotice)} roomMessageMode={roomMessageMode} onRoomMessageModeChange={setRoomMessageMode} t={t} notify={notify} onRoomName={setRoomDisplayName} onOpenSession={onOpenSession} />
          </section>
        </div>
      )}
      {taskLogPanel && (
        <div className="dialog-layer task-log-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setTaskLogPanel(null)} />
          <div className="workspace-modal compact-modal task-log-modal" role="dialog" aria-modal="true">
            <div className="workspace-modal-head">
              <div>
                <strong>{t("session.taskLog")}</strong>
                <span>{session?.id}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setTaskLogPanel(null)}>{t("action.close")}</button>
            </div>
            <pre className="task-log-viewer">{taskLogPanel.log}</pre>
          </div>
        </div>
      )}
      {taskContextPanel && (
        <div className="dialog-layer task-log-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setTaskContextPanel(null)} />
          <div className="workspace-modal compact-modal task-log-modal" role="dialog" aria-modal="true">
            <div className="workspace-modal-head">
              <div>
                <strong>{t("session.taskContext")}</strong>
                <span>{taskContextPanel.selectedName || session?.id}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setTaskContextPanel(null)}>{t("action.close")}</button>
            </div>
            <div className="context-file-tabs">
              {taskContextPanel.files.map((file) => (
                <button className={`ghost-button ${file.name === taskContextPanel.selectedName ? "active" : ""}`} type="button" key={file.name} onClick={() => void loadTaskContextFile(file.name)}>
                  {file.name}
                </button>
              ))}
            </div>
            <pre className="task-log-viewer">{taskContextPanel.content}</pre>
          </div>
        </div>
      )}
      {taskTemplateTarget && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setTaskTemplateTarget(null)} />
          <div className="dialog-card command-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="task-template-title">
            <div className="dialog-head">
              <div>
                <strong id="task-template-title">{t("session.commandTask")}</strong>
                <p>{t("session.commandTaskHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setTaskTemplateTarget(null)} title={t("action.close")}><X size={16} /></button>
            </div>
            <div className="command-picker-list">
              {taskTemplates.map((template) => (
                <button className="file-list-item" type="button" key={template.id} onClick={() => insertTaskTemplate(template)}>
                  <span>{template.title}</span>
                  <em>{template.prompt}</em>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {agentPickerOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setAgentPickerOpen(false)} />
          <div className="dialog-card command-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-picker-title">
            <div className="dialog-head">
              <div>
                <strong id="agent-picker-title">{t("session.commandAgent")}</strong>
                <p>{t("session.commandAgentHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setAgentPickerOpen(false)} title={t("action.close")}><X size={16} /></button>
            </div>
            <div className="command-picker-list">
              <button className="file-list-item" type="button" onClick={() => { insertRoomMention("user"); setAgentPickerOpen(false); }}>
                <span>@user</span>
                <em>{t("session.user")}</em>
              </button>
              {roomMentionAgents.map((agent) => (
                <button className="file-list-item" type="button" key={agent.id} onClick={() => { insertRoomMention(agent.name); setAgentPickerOpen(false); }}>
                  <span>@{agent.name}</span>
                  <em>{agent.description ?? agent.id}</em>
                </button>
              ))}
              {!roomMentionAgents.length && <div className="empty-state">{t("contacts.noAgents")}</div>}
            </div>
          </div>
        </div>
      )}
      {fileReferencePicker && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setFileReferencePicker(null)} />
          <div className="dialog-card file-reference-dialog" role="dialog" aria-modal="true" aria-labelledby="file-reference-title">
            <div className="dialog-head">
              <div>
                <strong id="file-reference-title">{t("session.commandFile")}</strong>
                <p>{fileReferencePicker.sourceLabel}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setFileReferencePicker(null)} title={t("action.close")}><X size={16} /></button>
            </div>
            <div className="file-reference-toolbar">
              <strong>{fileReferencePicker.list?.path ?? "."}</strong>
              <button className="ghost-button" type="button" disabled={!fileReferencePicker.list} onClick={() => addFileReference()}>{t("session.commandFileUseCurrent")}</button>
            </div>
            <div className="file-reference-list">
              {!fileReferencePicker.list && <div className="subtle">{t("file.loadingFiles")}</div>}
              {fileReferencePicker.list?.parentPath && (
                <button className="file-list-item" type="button" onClick={() => void loadFileReferencePicker(fileReferencePicker.list?.parentPath ?? ".", fileReferencePicker.target)}>
                  <span>↩ {t("file.parentDirectory")}</span>
                  <em>{fileReferencePicker.list.parentPath}</em>
                </button>
              )}
              {fileReferencePicker.list?.entries.map((entry) => (
                <div className="file-reference-row" key={entry.path}>
                  <button className="file-list-item" type="button" onClick={() => entry.kind === "directory" ? void loadFileReferencePicker(entry.path, fileReferencePicker.target) : addFileReference(entry)}>
                    <span>{entry.kind === "directory" ? "▸" : "◇"} {entry.name}</span>
                    <em>{entry.kind === "directory" ? t("file.directoryShort") : t("file.sizeKb").replace("{size}", String(Math.ceil(entry.size / 1024)))}</em>
                  </button>
                  {entry.kind === "directory" && (
                    <button className="ghost-button" type="button" onClick={() => addFileReference(entry)}>{t("session.commandFileAdd")}</button>
                  )}
                </div>
              ))}
              {fileReferencePicker.list && !fileReferencePicker.list.entries.length && <div className="empty-state">{t("project.noDirectories")}</div>}
            </div>
          </div>
        </div>
      )}
      {notifyBuilderOpen && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setNotifyBuilderOpen(false)} />
          <form className="dialog-card notify-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="notify-builder-title" onSubmit={createNotifyRule}>
            <div className="dialog-head">
              <div>
                <strong id="notify-builder-title">{t("session.commandNotify")}</strong>
                <p>{t("session.commandNotifyBuilderHelp")}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setNotifyBuilderOpen(false)} title={t("action.close")}><X size={16} /></button>
            </div>
            <label>
              <span>{t("settings.notificationEvents")}</span>
              <select name="notify-event-type" value={notifyEventType} onChange={(event) => setNotifyEventType(event.target.value as NotificationEventType)}>
                <option value="task_completed">{t("session.notifyEventCompleted")}</option>
                <option value="task_failed">{t("session.notifyEventFailed")}</option>
                <option value="needs_approval">{t("session.notifyEventApproval")}</option>
              </select>
            </label>
            <label>
              <span>{t("settings.notificationRecipientKind")}</span>
              <select name="notify-channel-kind" value={notifyChannelKind} onChange={(event) => {
                const kind = event.target.value as NotificationRecipientSummary["kind"];
                const nextRecipients = notifyRecipientsForKind(kind);
                setNotifyChannelKind(kind);
                setNotifyRecipientId((current) => nextRecipients.some((recipient) => recipient.id === current) ? current : nextRecipients[0]?.id ?? "");
                setNotifySenderAccountId(defaultNotifySenderId(nextRecipients[0] ?? null));
              }}>
                {notifyRecipientKinds.map((kind) => <option value={kind} key={kind}>{notificationKindLabel(t, kind)}</option>)}
              </select>
            </label>
            <label>
              <span>{t("settings.notificationRecipientName")}</span>
              <select name="notify-recipient-id" value={notifyRecipientId} onChange={(event) => {
                const nextRecipient = filteredNotifyRecipients.find((recipient) => recipient.id === event.target.value) ?? null;
                setNotifyRecipientId(event.target.value);
                setNotifySenderAccountId(defaultNotifySenderId(nextRecipient));
              }}>
                {filteredNotifyRecipients.map((recipient) => <option value={recipient.id} key={recipient.id}>{recipient.name}</option>)}
              </select>
            </label>
            <div className="dialog-actions">
              <button className="ghost-button" type="button" onClick={() => setNotifyBuilderOpen(false)}>{t("action.cancel")}</button>
              <button className="dark-button" type="submit" disabled={!notifyRecipientId}>{t("action.create")}</button>
            </div>
          </form>
        </div>
      )}
      {dialog.node}
    </>
  );
}
