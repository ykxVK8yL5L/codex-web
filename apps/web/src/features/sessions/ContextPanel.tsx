import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Check, Clock3, Copy, FolderGit2, FolderOpen, Globe, Info, RefreshCw, RotateCcw, Save, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import type { CodexTaskDetail, GoalDetailResponse, MessageCardSummary, PreviewSummary, QueuedMessage, SessionSummary, TaskActivityResponse, TokenUsageResponse, WorkspaceChangeFile, WorkspaceChanges } from "@codex-web/protocol";
import { useAppDialog } from "@/components/AppDialog";
import { IconText } from "@/components/IconText";
import { copyText } from "@/lib/clipboard";
import { sessionInfoRequestedEvent, taskActivityChangedEvent, workspaceChangedEvent } from "@/lib/events";
import { formatBytes, formatShortDate, formatTokens } from "@/lib/format";
import { openPreviewUrl } from "@/lib/previews";
import { ActivityPanel } from "@/features/sessions/ActivityPanel";
import { QueuedMessageRow } from "@/features/sessions/QueuedMessageRow";
import { activityFromSummary, readableActivityStatus, readableGoalMode, readableGoalStatus, readableStatus, type ActivityItem, type TFunction } from "@/features/sessions/utils";

type ToastTone = "info" | "success" | "error";
type BrowserRow = {
  id: string;
  label: string;
  detail: string;
  href: string;
  cardId: string | null;
};

export function ContextPanel({
  sessionToken,
  session,
  taskDetail,
  queuedMessages = [],
  onUpdateQueuedMessage,
  onReorderQueuedMessages,
  onDeleteQueuedMessage,
  t,
  onOpenFile,
  initialPanel = "progress",
  modal = false,
}: {
  sessionToken: string;
  session?: SessionSummary;
  taskDetail?: CodexTaskDetail;
  queuedMessages?: QueuedMessage[];
  onUpdateQueuedMessage?: (sessionId: string, queueId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null) => Promise<void>;
  onReorderQueuedMessages?: (sessionId: string, orderedIds: string[]) => Promise<void>;
  onDeleteQueuedMessage?: (sessionId: string, queueId: string) => Promise<void>;
  t: TFunction;
  onOpenFile: (path: string) => void;
  initialPanel?: "progress" | "changes" | "activity";
  modal?: boolean;
}) {
  const dialog = useAppDialog(t);
  const [activePanel, setActivePanel] = useState<"progress" | "changes" | "activity">(initialPanel);
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
  const [goalDetail, setGoalDetail] = useState<GoalDetailResponse | null>(null);
  const [previews, setPreviews] = useState<PreviewSummary[]>([]);
  const [browserCards, setBrowserCards] = useState<MessageCardSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [message, setMessage] = useState("");
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [usageOverview, setUsageOverview] = useState<TokenUsageResponse | null>(null);
  const [usageDelta, setUsageDelta] = useState(0);
  const [contextDraggedQueueId, setContextDraggedQueueId] = useState<string | null>(null);
  const activityRefreshTimerRef = useRef<number | null>(null);
  const changesRefreshTimerRef = useRef<number | null>(null);
  const usageTotalRef = useRef(0);
  const usageDeltaTimerRef = useRef<number | null>(null);
  const selectedFile = changes?.files.find((item) => item.path === selectedPath) ?? changes?.files[0] ?? null;
  const goal = goalDetail?.goal ?? session?.goal ?? null;
  const goalItems = goalDetail?.items ?? [];
  const latestActivity = activityItems[0] ?? null;
  const previewIds = new Set(previews.map((preview) => preview.id));
  const browserRows = uniqueBrowserRows([
    ...previews.map((preview) => ({
      id: `preview:${preview.id}`,
      label: preview.label,
      detail: `${t("project.preview")} · ${preview.status}`,
      href: preview.url,
      cardId: null as string | null,
    })),
    ...browserCards.flatMap((card) => {
      const payload = (card.payload && typeof card.payload === "object" ? card.payload : {}) as Record<string, unknown>;
      const previewId = typeof payload.previewId === "string" ? payload.previewId : null;
      if (previewId && previewIds.has(previewId)) return [];
      const href = typeof payload.url === "string" ? payload.url : null;
      if (!href) return [];
      return [{
        id: card.id,
        label: card.title || href,
        detail: card.type,
        href,
        cardId: card.id,
      }];
    }),
  ]).slice(0, 6);
  const progressSteps = [
    ...(goal ? [{ id: goal.id, label: goal.text, meta: `${readableGoalMode(goal.mode, t)} · ${readableGoalStatus(goal.status, t)}`, done: goal.status === "completed" }] : []),
    ...(goal?.currentFocus ? [{ id: goal.currentFocus.id, label: goal.currentFocus.text, meta: t("progress.currentFocus"), done: goal.currentFocus.status === "completed" }] : []),
    ...goalItems.slice(0, 5).map((item) => ({
      id: item.id,
      label: item.title,
      meta: [item.status, item.assignedAgentId].filter(Boolean).join(" · "),
      done: item.status === "completed",
    })),
    ...activityItems.slice(0, Math.max(0, goalItems.length ? 3 : 6)).map((item) => ({
      id: item.id ?? `${item.kind}-${item.at}`,
      label: item.label,
      meta: readableActivityStatus(item.status, item.kind, t),
      done: item.status === "completed",
    })),
  ].slice(0, 8);

  useEffect(() => {
    setActivePanel(initialPanel);
  }, [initialPanel]);

  const loadChanges = useCallback(async () => {
    if (!session?.id) {
      setChanges(null);
      return;
    }
    const response = await fetch(`/api/codex/tasks/${session.id}/changes`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextChanges = (await response.json()) as WorkspaceChanges;
    setChanges(nextChanges);
    setSelectedPath((current) => current && nextChanges.files.some((item) => item.path === current) ? current : nextChanges.files[0]?.path ?? "");
  }, [session?.id, sessionToken]);

  const scheduleLoadChanges = useCallback(() => {
    if (changesRefreshTimerRef.current !== null) window.clearTimeout(changesRefreshTimerRef.current);
    changesRefreshTimerRef.current = window.setTimeout(() => {
      changesRefreshTimerRef.current = null;
      void loadChanges();
    }, 900);
  }, [loadChanges]);

  const loadGoalDetail = useCallback(async () => {
    if (!session?.goal?.id) {
      setGoalDetail(null);
      return;
    }
    const response = await fetch(`/api/goals/${session.goal.id}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setGoalDetail((await response.json()) as GoalDetailResponse);
  }, [session?.goal?.id, sessionToken]);

  const loadPreviews = useCallback(async () => {
    if (!session?.id) {
      setPreviews([]);
      return;
    }
    const params = new URLSearchParams({ scopeType: "session", scopeId: session.id });
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setPreviews((await response.json()) as PreviewSummary[]);
  }, [session?.id, sessionToken]);

  const loadBrowserCards = useCallback(async () => {
    if (!session?.id) {
      setBrowserCards([]);
      return;
    }
    const response = await fetch(`/api/sessions/${session.id}/cards`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setBrowserCards((await response.json()) as MessageCardSummary[]);
  }, [session?.id, sessionToken]);

  const loadActivity = useCallback(async (older = false) => {
    if (!session?.id) {
      setActivityItems([]);
      setActivityCursor(null);
      setActivityHasMore(false);
      return;
    }
    const params = new URLSearchParams({ limit: "20" });
    if (older && activityCursor) params.set("cursor", activityCursor);
    const response = await fetch(`/api/codex/tasks/${session.id}/activity?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TaskActivityResponse;
    const items = result.items.map(activityFromSummary);
    setActivityItems((current) => older ? [...current, ...items] : items);
    setActivityCursor(result.nextCursor);
    setActivityHasMore(result.hasMore);
  }, [activityCursor, session?.id, sessionToken]);

  const loadUsageOverview = useCallback(async () => {
    if (!session?.id) {
      setUsageOverview(null);
      setUsageDelta(0);
      usageTotalRef.current = 0;
      return;
    }
    const params = new URLSearchParams({ sessionId: session.id, limit: "1" });
    const response = await fetch(`/api/usage?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextUsage = (await response.json()) as TokenUsageResponse;
    const previousTotal = usageTotalRef.current;
    const nextTotal = nextUsage.summary.totalTokens;
    if (previousTotal > 0 && nextTotal > previousTotal) {
      setUsageDelta(nextTotal - previousTotal);
      if (usageDeltaTimerRef.current !== null) window.clearTimeout(usageDeltaTimerRef.current);
      usageDeltaTimerRef.current = window.setTimeout(() => {
        usageDeltaTimerRef.current = null;
        setUsageDelta(0);
      }, 1400);
    }
    usageTotalRef.current = nextTotal;
    setUsageOverview(nextUsage);
  }, [session?.id, sessionToken]);

  const scheduleLoadActivity = useCallback(() => {
    if (activityRefreshTimerRef.current !== null) window.clearTimeout(activityRefreshTimerRef.current);
    activityRefreshTimerRef.current = window.setTimeout(() => {
      activityRefreshTimerRef.current = null;
      void loadActivity();
    }, 350);
  }, [loadActivity]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  useEffect(() => {
    void loadGoalDetail();
  }, [loadGoalDetail]);

  useEffect(() => {
    void loadPreviews();
  }, [loadPreviews]);

  useEffect(() => {
    void loadBrowserCards();
  }, [loadBrowserCards]);

  useEffect(() => {
    setActivityItems([]);
    setActivityCursor(null);
    setActivityHasMore(false);
    if (activePanel === "activity" || activePanel === "progress") void loadActivity();
    if (activePanel === "progress") void Promise.all([loadPreviews(), loadBrowserCards(), loadUsageOverview()]);
  }, [activePanel, loadBrowserCards, loadPreviews, loadUsageOverview, session?.id, sessionToken]);

  useEffect(() => {
    usageTotalRef.current = 0;
    setUsageDelta(0);
    setUsageOverview(null);
    if (usageDeltaTimerRef.current !== null) {
      window.clearTimeout(usageDeltaTimerRef.current);
      usageDeltaTimerRef.current = null;
    }
  }, [session?.id]);

  useEffect(() => () => {
    if (usageDeltaTimerRef.current !== null) window.clearTimeout(usageDeltaTimerRef.current);
  }, []);

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!session?.id || detail?.sessionId !== session.id) return;
      scheduleLoadChanges();
    }
    window.addEventListener(workspaceChangedEvent, handleWorkspaceChanged);
    return () => {
      window.removeEventListener(workspaceChangedEvent, handleWorkspaceChanged);
      if (changesRefreshTimerRef.current !== null) {
        window.clearTimeout(changesRefreshTimerRef.current);
        changesRefreshTimerRef.current = null;
      }
    };
  }, [scheduleLoadChanges, session?.id]);

  useEffect(() => {
    function handleTaskActivityChanged(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!session?.id || detail?.sessionId !== session.id) return;
      if (activePanel !== "activity" && activePanel !== "progress") return;
      scheduleLoadActivity();
      if (activePanel === "progress") void Promise.all([loadBrowserCards(), loadUsageOverview()]);
    }
    window.addEventListener(taskActivityChangedEvent, handleTaskActivityChanged);
    return () => {
      window.removeEventListener(taskActivityChangedEvent, handleTaskActivityChanged);
      if (activityRefreshTimerRef.current !== null) {
        window.clearTimeout(activityRefreshTimerRef.current);
        activityRefreshTimerRef.current = null;
      }
    };
  }, [activePanel, loadBrowserCards, loadUsageOverview, scheduleLoadActivity, session?.id]);

  async function copyPatch(file?: WorkspaceChangeFile | null) {
    const value = file ? file.patch || file.newContent || "" : changes?.raw.diff ?? "";
    if (!value) return;
    await copyText(value);
    setMessage(t("workspace.copyDiff"));
    window.setTimeout(() => setMessage(""), 1200);
  }

  async function revertFile(file: WorkspaceChangeFile) {
    if (!session?.id) return;
    const confirmed = await dialog.confirm({
      title: t("workspace.revertTitle"),
      message: file.path,
      confirmLabel: t("workspace.revert"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/changes/revert-file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: file.sourcePath ?? file.path, cwd: file.sourceCwd }),
    });
    if (!response.ok) {
      setMessage(t("workspace.revertFailed"));
      return;
    }
    setChanges((await response.json()) as WorkspaceChanges);
    setMessage(t("workspace.reverted"));
    window.setTimeout(() => setMessage(""), 1200);
  }

  async function gitFileAction(file: WorkspaceChangeFile, action: "stage" | "unstage") {
    if (!session?.id) return;
    const response = await fetch(`/api/codex/tasks/${session.id}/changes/${action}-file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: file.sourcePath ?? file.path, cwd: file.sourceCwd }),
    });
    if (!response.ok) {
      setMessage(action === "stage" ? t("workspace.stageFailed") : t("workspace.unstageFailed"));
      return;
    }
    setChanges((await response.json()) as WorkspaceChanges);
    setMessage(action === "stage" ? t("workspace.staged") : t("workspace.unstaged"));
    window.setTimeout(() => setMessage(""), 1200);
  }

  function openSessionGoalSettings() {
    if (!session?.id) return;
    window.dispatchEvent(new CustomEvent(sessionInfoRequestedEvent, { detail: { sessionId: session.id, expandGoal: true } }));
  }

  function reorderContextQueue(dragId: string | null, dropId: string) {
    if (!session?.id || !onReorderQueuedMessages || !dragId || dragId === dropId) return;
    const dragIndex = queuedMessages.findIndex((item) => item.id === dragId);
    const dropIndex = queuedMessages.findIndex((item) => item.id === dropId);
    if (dragIndex < 0 || dropIndex < 0) return;
    const nextQueue = [...queuedMessages];
    const [moved] = nextQueue.splice(dragIndex, 1);
    nextQueue.splice(dropIndex, 0, moved);
    setContextDraggedQueueId(null);
    void onReorderQueuedMessages(session.id, nextQueue.map((item) => item.id));
  }

  async function dismissBrowserCard(cardId: string | null) {
    if (!session?.id || !cardId) return;
    const response = await fetch(`/api/sessions/${session.id}/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) await loadBrowserCards();
  }

  return (
    <aside className={`context-panel ${modal ? "mobile-context-panel" : ""}`}>
      {dialog.node}
      <header className="context-header">
        <div className="context-tabs" role="tablist" aria-label={t("session.infoTitle")}>
          <button className="context-tab" type="button" role="tab" aria-selected={activePanel === "progress"} data-state={activePanel === "progress" ? "active" : "inactive"} onClick={() => setActivePanel("progress")} title={t("progress.title")}>
            <IconText icon={Check}>{t("progress.title")}</IconText>
          </button>
          <button className="context-tab" type="button" role="tab" aria-selected={activePanel === "changes"} data-state={activePanel === "changes" ? "active" : "inactive"} onClick={() => setActivePanel("changes")} title={t("workspace.changes")}>
            <IconText icon={FolderGit2}>{t("workspace.changes")}</IconText>
          </button>
          <button className="context-tab" type="button" role="tab" aria-selected={activePanel === "activity"} data-state={activePanel === "activity" ? "active" : "inactive"} onClick={() => setActivePanel("activity")} title={t("session.activityTitle")}>
            <IconText icon={Activity}>{t("session.activityTitle")}</IconText>
          </button>
        </div>
        <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => activePanel === "changes" ? void loadChanges() : activePanel === "progress" ? void Promise.all([loadActivity(), loadGoalDetail(), loadPreviews(), loadBrowserCards(), loadUsageOverview()]) : void loadActivity()} disabled={!session}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
      </header>
      <section className={`panel progress-panel ${activePanel === "progress" ? "active" : ""}`}>
        <div className="progress-usage-card">
          <div className="progress-usage-main">
            <span>{t("usage.currentSession")}</span>
            <strong>{formatTokens(usageOverview?.summary.totalTokens ?? 0)}</strong>
            <em>{t("usage.totalTokens")}</em>
          </div>
          {usageDelta > 0 && <span className="progress-usage-delta">+{formatTokens(usageDelta)}</span>}
          <div className="progress-usage-breakdown" title={`${t("usage.inputTokens")} ${formatTokens(usageOverview?.summary.inputTokens ?? 0)} · ${t("usage.outputTokens")} ${formatTokens(usageOverview?.summary.outputTokens ?? 0)} · ${t("usage.cachedInputTokens")} ${formatTokens(usageOverview?.summary.cachedInputTokens ?? 0)} · ${t("usage.reasoningTokens")} ${formatTokens(usageOverview?.summary.reasoningOutputTokens ?? 0)}`}>
            <span>{t("usage.inputTokens")} {formatTokens(usageOverview?.summary.inputTokens ?? 0)}</span>
            <span>{t("usage.outputTokens")} {formatTokens(usageOverview?.summary.outputTokens ?? 0)}</span>
          </div>
        </div>
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("progress.title")}</strong>
            <button className="ghost-button compact-action" type="button" disabled={!session} onClick={openSessionGoalSettings}>
              {goal ? t("goal.update") : t("goal.create")}
            </button>
          </div>
          <div className="progress-step-list">
            {progressSteps.map((step) => (
              <div className="progress-step" key={step.id}>
                <span className={`progress-check ${step.done ? "done" : ""}`}><Check size={12} /></span>
                <div>
                  <strong>{step.label}</strong>
                  {step.meta && <span>{step.meta}</span>}
                </div>
              </div>
            ))}
            {!progressSteps.length && <div className="empty-state">{session ? t("progress.noProgress") : t("workspace.noSession")}</div>}
          </div>
        </div>
        <div className="progress-divider" />
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("progress.execution")}</strong>
            <Activity size={15} />
          </div>
          <div className="progress-meta-list">
            <div className="progress-meta-row"><Clock3 size={15} /><span>{t("session.infoStatus")}</span><strong>{readableStatus(session?.status, t)}</strong></div>
            <div className="progress-meta-row"><Activity size={15} /><span>{t("progress.latestActivity")}</span><strong>{latestActivity ? readableActivityStatus(latestActivity.status, latestActivity.kind, t) : "-"}</strong></div>
            {latestActivity && <div className="progress-meta-row wide"><Info size={15} /><span>{latestActivity.label}</span><strong>{formatShortDate(latestActivity.at)}</strong></div>}
            {taskDetail?.exitCode !== undefined && taskDetail.exitCode !== null && <div className="progress-meta-row"><TerminalIcon size={15} /><span>{t("project.exitCode")}</span><strong>{taskDetail.exitCode}</strong></div>}
          </div>
        </div>
        <div className="progress-divider" />
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("session.queueTitle")}</strong>
            <span>{queuedMessages.length} {t("session.queueUnit")}</span>
          </div>
          <div className="context-queue-list">
            {queuedMessages.slice(0, 6).map((item, index) => (
              <QueuedMessageRow
                key={item.id}
                item={item}
                index={index}
                dragging={contextDraggedQueueId === item.id}
                onDragStart={() => setContextDraggedQueueId(item.id)}
                onDragEnd={() => setContextDraggedQueueId(null)}
                onDropOn={() => reorderContextQueue(contextDraggedQueueId, item.id)}
                onSave={(nextPrompt) => session && onUpdateQueuedMessage
                  ? onUpdateQueuedMessage(session.id, item.id, nextPrompt, item.providerId ?? session.providerId ?? null, item.model ?? session.model ?? null, item.replyToMessageId ?? null)
                  : Promise.resolve()}
                onDelete={() => session && onDeleteQueuedMessage ? onDeleteQueuedMessage(session.id, item.id) : Promise.resolve()}
                t={t}
              />
            ))}
            {!queuedMessages.length && <div className="empty-state">{t("progress.noQueuedInput")}</div>}
          </div>
        </div>
        <div className="progress-divider" />
        <div className="progress-section">
          <div className="progress-section-head">
            <strong>{t("progress.browser")}</strong>
            <Globe size={15} />
          </div>
          <div className="progress-meta-list">
            {browserRows.map((row) => (
              <div className="progress-browser-row" key={row.id}>
                <a className="progress-meta-row progress-link-row" href={row.href} target="_blank" rel="noreferrer">
                  <Globe size={15} />
                  <span>{row.label}</span>
                  <strong>{row.detail}</strong>
                </a>
                <button className="ghost-button icon-only" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyText(row.href)}><IconText icon={Copy}>{t("action.copy")}</IconText></button>
                {row.cardId && <button className="ghost-button icon-only" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void dismissBrowserCard(row.cardId)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>}
              </div>
            ))}
            {!browserRows.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      </section>
      <section className={`panel ${activePanel === "changes" ? "active" : ""}`}>
        <div className="diff-summary">
          <strong>{changes ? `${changes.summary.filesChanged} ${t("workspace.filesChanged")}` : t("workspace.noSession")}</strong>
          <span className="pill warm">+{changes?.summary.additions ?? 0} -{changes?.summary.deletions ?? 0}</span>
        </div>
        {message && <div className="subtle">{message}</div>}
        {changes && !changes.isGitRepo && <div className="empty-state">{changes.error ?? t("workspace.notGitRepo")}</div>}
        {changes?.files.map((file) => (
          <button className={`change-row ${file.path === selectedFile?.path ? "active" : ""}`} key={file.path} onClick={() => setSelectedPath(file.path)}>
            <span className="pill">{file.status}</span>
            <strong>{file.path}</strong>
            {file.sourceLabel && <small>{file.sourceLabel}</small>}
            <em>+{file.additions} -{file.deletions}</em>
          </button>
        ))}
        {selectedFile && (
          <div className="diff-file">
            <div className="diff-file-head">
              <span>{selectedFile.path}</span>
              <button className="ghost-button icon-only" type="button" title={t("project.openFile")} aria-label={t("project.openFile")} disabled={Boolean(selectedFile.sourceCwd)} onClick={() => onOpenFile(selectedFile.path)}><IconText icon={FolderOpen}>{t("project.openFile")}</IconText></button>
            </div>
            <pre>{selectedFile.patch || selectedFile.newContent || (selectedFile.binary ? t("workspace.binaryFile") : t("workspace.noPatch"))}</pre>
            <div className="change-actions">
              <button className="ghost-button icon-only" type="button" title={t("workspace.stageFile")} aria-label={t("workspace.stageFile")} onClick={() => void gitFileAction(selectedFile, "stage")}><IconText icon={Save}>{t("workspace.stageFile")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("workspace.unstageFile")} aria-label={t("workspace.unstageFile")} onClick={() => void gitFileAction(selectedFile, "unstage")}><IconText icon={RotateCcw}>{t("workspace.unstageFile")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("workspace.copyPatch")} aria-label={t("workspace.copyPatch")} onClick={() => void copyPatch(selectedFile)}><IconText icon={Copy}>{t("workspace.copyPatch")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("workspace.copyAll")} aria-label={t("workspace.copyAll")} onClick={() => void copyPatch()}><IconText icon={Copy}>{t("workspace.copyAll")}</IconText></button>
              <button className="ghost-button danger-button icon-only" type="button" title={t("workspace.revertFile")} aria-label={t("workspace.revertFile")} onClick={() => void revertFile(selectedFile)}><IconText icon={RotateCcw}>{t("workspace.revertFile")}</IconText></button>
            </div>
          </div>
        )}
      </section>
      <section className={`panel ${activePanel === "activity" ? "active" : ""}`}>
        <ActivityPanel items={activityItems} hasMore={activityHasMore} onLoadMore={() => void loadActivity(true)} t={t} />
        {!activityItems.length && <div className="empty-state">{session ? t("room.noActivity") : t("workspace.noSession")}</div>}
      </section>
    </aside>
  );
}

function uniqueBrowserRows(rows: BrowserRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
