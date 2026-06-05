import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { GoalDetailResponse, GoalFocusStatus, GoalItemStatus, GoalMode, GoalStatus, GoalSummary } from "@codex-web/protocol";
import { formatShortDate } from "@/lib/format";
import { readableGoalMode, readableGoalStatus, type TFunction } from "@/features/sessions/utils";

type ToastTone = "info" | "success" | "error";

export function GoalPanel({
  sessionToken,
  goal,
  ownerType,
  ownerId,
  t,
  notify,
  onGoalChange,
  agents = [],
  compact = false,
  expandSignal = 0,
}: {
  sessionToken: string;
  goal?: GoalSummary | null;
  ownerType: "session" | "agent_session" | "room";
  ownerId: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onGoalChange: (goal: GoalSummary | null) => void;
  agents?: Array<{ id: string; name: string }>;
  compact?: boolean;
  expandSignal?: number;
}) {
  const [text, setText] = useState(goal?.text ?? "");
  const [mode, setMode] = useState<GoalMode>(goal?.mode ?? (ownerType === "room" ? "orchestrated" : "reference"));
  const [focusText, setFocusText] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemAgentId, setItemAgentId] = useState("");
  const [managerAgentId, setManagerAgentId] = useState(goal?.managerAgentId ?? "");
  const [coordinatorAgentId, setCoordinatorAgentId] = useState(goal?.coordinatorAgentId ?? "");
  const [detail, setDetail] = useState<GoalDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expandSignal > 0) setExpanded(true);
  }, [expandSignal]);
  useEffect(() => {
    setText(goal?.text ?? "");
    setMode(goal?.mode ?? (ownerType === "room" ? "orchestrated" : "reference"));
    setManagerAgentId(goal?.managerAgentId ?? "");
    setCoordinatorAgentId(goal?.coordinatorAgentId ?? "");
  }, [goal?.id, goal?.text, goal?.mode, goal?.managerAgentId, goal?.coordinatorAgentId, ownerType]);
  useEffect(() => {
    if (!goal?.id) {
      setDetail(null);
      return;
    }
    const goalId = goal.id;
    let cancelled = false;
    async function loadGoalDetail() {
      const response = await fetch(`/api/goals/${goalId}`, { headers: { authorization: `Bearer ${sessionToken}` } });
      if (!response.ok || cancelled) return;
      setDetail(await response.json() as GoalDetailResponse);
    }
    void loadGoalDetail();
    return () => {
      cancelled = true;
    };
  }, [goal?.id, sessionToken]);
  const items = detail?.items ?? [];
  const focuses = detail?.focuses ?? [];
  const events = detail?.events ?? [];
  const proposals = detail?.proposals ?? [];
  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  async function refreshGoal(goalId: string) {
    const response = await fetch(`/api/goals/${goalId}`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return;
    const next = await response.json() as GoalDetailResponse;
    setDetail(next);
    onGoalChange(next.goal);
  }
  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    const nextText = text.trim();
    if (!nextText) return;
    setBusy(true);
    try {
      const response = await fetch(goal ? `/api/goals/${goal.id}` : "/api/goals", {
        method: goal ? "PATCH" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(goal
          ? { text: nextText, mode, managerAgentId: managerAgentId || null, coordinatorAgentId: coordinatorAgentId || null }
          : { ownerType, ownerId, text: nextText, mode, managerAgentId: managerAgentId || null, coordinatorAgentId: coordinatorAgentId || null }),
      });
      if (!response.ok) throw new Error("goal_save_failed");
      const next = await response.json() as GoalSummary;
      onGoalChange(next);
      notify(t(goal ? "goal.updated" : "goal.created"), "success");
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function updateGoalStatus(status: GoalStatus) {
    if (!goal) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("goal_status_failed");
      onGoalChange(await response.json() as GoalSummary);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function createFocus(event: React.FormEvent) {
    event.preventDefault();
    if (!goal?.id || !focusText.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/focuses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ text: focusText.trim() }),
      });
      if (!response.ok) throw new Error("goal_focus_failed");
      setFocusText("");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function createItem(event: React.FormEvent) {
    event.preventDefault();
    if (!goal?.id || !itemTitle.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ title: itemTitle.trim(), assignedAgentId: itemAgentId || null, status: "planned" }),
      });
      if (!response.ok) throw new Error("goal_item_failed");
      setItemTitle("");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function updateFocusStatus(focusId: string, status: GoalFocusStatus) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/focuses/${focusId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("goal_focus_update_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function updateItemStatus(itemId: string, status: GoalItemStatus) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("goal_item_update_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function approveProposal(proposalId: string) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_proposal_approve_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function rejectProposal(proposalId: string) {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/proposals/${proposalId}/reject`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_proposal_reject_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function planGoal() {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/plan`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_plan_failed");
      await refreshGoal(goal.id);
    } catch {
      notify(t("goal.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  async function orchestrateGoal() {
    if (!goal?.id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/goals/${goal.id}/orchestrate`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("goal_orchestrate_failed");
      const result = await response.json() as { goal: GoalSummary; tasks: unknown[] };
      onGoalChange(result.goal);
      notify(t("goal.orchestrated").replace("{count}", String(result.tasks.length)), "success");
      await refreshGoal(result.goal.id);
    } catch {
      notify(t("goal.orchestrateFailed"), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`goal-panel ${compact ? "compact" : ""}`}>
      <div className="goal-panel-head">
        <div>
          <strong>{t("goal.title")}</strong>
          <span>{goal ? `${readableGoalMode(goal.mode, t)} · ${readableGoalStatus(goal.status, t)}` : t("goal.optional")}</span>
        </div>
        <button className={`ghost-button icon-only goal-toggle ${expanded ? "open" : ""}`} type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? t("action.collapse") : t("action.details")} aria-label={expanded ? t("action.collapse") : t("action.details")}>
          <ChevronDown size={16} />
        </button>
      </div>
      {expanded && <form className="goal-form" onSubmit={saveGoal}>
        <textarea name="goal-text" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("goal.placeholder")} rows={compact ? 2 : 3} />
        <div className="goal-form-row">
          <select name="goal-mode" value={mode} onChange={(event) => setMode(event.target.value as GoalMode)}>
            <option value="reference">{t("goal.modeReference")}</option>
            <option value="tracked">{t("goal.modeTracked")}</option>
            <option value="managed">{t("goal.modeManaged")}</option>
            <option value="orchestrated">{t("goal.modeOrchestrated")}</option>
          </select>
          <button className="ghost-button" type="submit" disabled={busy || !text.trim()}>{goal ? t("goal.update") : t("goal.create")}</button>
        </div>
        {agents.length > 0 && (
          <div className="goal-form-row">
            <select name="goal-manager-agent-id" value={managerAgentId} onChange={(event) => setManagerAgentId(event.target.value)}>
              <option value="">{t("goal.noManager")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{t("goal.manager")}: {agent.name}</option>)}
            </select>
            <select name="goal-coordinator-agent-id" value={coordinatorAgentId} onChange={(event) => setCoordinatorAgentId(event.target.value)}>
              <option value="">{t("goal.noCoordinator")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{t("goal.coordinator")}: {agent.name}</option>)}
            </select>
          </div>
        )}
      </form>}
      {expanded && goal && (
        <>
          <div className="goal-panel-actions">
            <button className="ghost-button" type="button" disabled={busy} onClick={() => void planGoal()}>{t("goal.plan")}</button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateGoalStatus("completed")}>{t("goal.complete")}</button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateGoalStatus("cancelled")}>{t("goal.cancel")}</button>
            {ownerType === "room" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void orchestrateGoal()}>{t("goal.orchestrate")}</button>}
          </div>
          <div className="goal-progress">
            <span>{t("goal.items")}: {goal.progress.totalItems}</span>
            <span>{t("goal.active")}: {goal.progress.activeItems}</span>
            <span>{t("goal.completed")}: {goal.progress.completedItems}</span>
            <span>{t("goal.blocked")}: {goal.progress.blockedItems}</span>
            <span>{t("goal.failed")}: {goal.progress.failedItems}</span>
          </div>
          {goal.currentFocus && (
            <div className="goal-current-focus">
              <div>
                <strong>{t("progress.currentFocus")}</strong>
                <span>{goal.currentFocus.text}</span>
              </div>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateFocusStatus(goal.currentFocus!.id, "completed")}>{t("goal.complete")}</button>
            </div>
          )}
          <form className="goal-form inline" onSubmit={createFocus}>
            <input name="goal-focus-text" value={focusText} onChange={(event) => setFocusText(event.target.value)} placeholder={goal.currentFocus?.text ?? t("goal.focusPlaceholder")} />
            <button className="ghost-button" type="submit" disabled={busy || !focusText.trim()}>{t("goal.setFocus")}</button>
          </form>
          {pendingProposals.length > 0 && (
            <div className="goal-proposal-list">
              <strong>{t("goal.proposals")}</strong>
              {pendingProposals.slice(0, 6).map((proposal) => (
                <div className="goal-proposal" key={proposal.id}>
                  <div>
                    <strong>{proposal.title}</strong>
                    <span>{proposal.kind} · {proposal.proposedByAgentId ?? "agent"} · {formatShortDate(proposal.createdAt)}</span>
                  </div>
                  <div className="goal-item-actions">
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void approveProposal(proposal.id)}>{t("goal.approveProposal")}</button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void rejectProposal(proposal.id)}>{t("goal.rejectProposal")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {focuses.length > 1 && (
            <details className="goal-history">
              <summary>{t("goal.focusHistory")} · {focuses.length}</summary>
              <div className="goal-item-list">
                {focuses.slice(0, 6).map((focus) => (
                  <div className="goal-item" key={focus.id}>
                    <strong>{focus.text}</strong>
                    <span>{readableGoalStatus(focus.status, t)} · {formatShortDate(focus.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <form className="goal-form inline" onSubmit={createItem}>
            <input name="goal-item-title" value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} placeholder={t("goal.itemPlaceholder")} />
            {agents.length > 0 && (
              <select name="goal-item-agent-id" value={itemAgentId} onChange={(event) => setItemAgentId(event.target.value)}>
                <option value="">{t("room.unassigned")}</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            )}
            <button className="ghost-button" type="submit" disabled={busy || !itemTitle.trim()}>{t("goal.addItem")}</button>
          </form>
          {items.length > 0 && (
            <div className="goal-item-list">
              {items.slice(0, compact ? 4 : 8).map((item) => (
                <div className="goal-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.status}{item.assignedAgentId ? ` · ${agents.find((agent) => agent.id === item.assignedAgentId)?.name ?? item.assignedAgentId}` : ""}{item.roomTaskId ? ` · ${item.roomTaskId}` : ""}</span>
                  <div className="goal-item-actions">
                    {item.status !== "completed" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateItemStatus(item.id, "completed")}>{t("goal.complete")}</button>}
                    {item.status !== "blocked" && item.status !== "completed" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateItemStatus(item.id, "blocked")}>{t("goal.blocked")}</button>}
                    {item.status === "blocked" && <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateItemStatus(item.id, "active")}>{t("goal.active")}</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {events.length > 0 && (
            <details className="goal-history">
              <summary>{t("goal.events")} · {events.length}</summary>
              <div className="goal-event-list">
                {events.slice(0, 8).map((event) => (
                  <div className="goal-event" key={event.id}>
                    <strong>{event.type}</strong>
                    <span>{event.actorType ?? "system"} · {formatShortDate(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
