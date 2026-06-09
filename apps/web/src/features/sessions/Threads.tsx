import { X } from "lucide-react";
import type { ProjectSummary, ProviderSummary, SessionSummary } from "@codex-web/protocol";
import { formatShortDate } from "@/lib/format";
import { projectDisplayName, readableGitStatus, readableSessionType, readableStatus, type TFunction } from "@/features/sessions/utils";

export function Threads({
  sessions,
  projects,
  providers,
  unreadSessionIds,
  activeSessionId,
  onSelectSession,
  onNewTask,
  search,
  onSearch,
  projectFilter,
  onProjectFilter,
  statusFilter,
  onStatusFilter,
  hasMore,
  onLoadMore,
  onClose,
  t,
}: {
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  providers: ProviderSummary[];
  unreadSessionIds?: Set<string>;
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewTask: () => void;
  search: string;
  onSearch: (value: string) => void;
  projectFilter: string;
  onProjectFilter: (value: string) => void;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  onClose?: () => void;
  t: TFunction;
}) {
  const visibleSessions = sessions.filter((session) => !(session.conversationType === "agent" && session.roomId));
  const projectSession = sessions.find((session) => session.id === activeSessionId && session.projectId);
  const currentProject = projects.find((project) => project.id === projectSession?.projectId);
  const runningSessions = visibleSessions.filter((session) => session.status === "running");
  return (
    <aside className="threads">
      <header className="threads-header">
        <div>
          <div className="product">Codex Web</div>
        </div>
        <div className="threads-header-actions">
          <button className="new-task" onClick={onNewTask} title={t("session.newSession")}>+</button>
          {onClose && (
            <button className="drawer-close" type="button" onClick={onClose} title={t("action.close")}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>
      {currentProject && (
        <section className="project-card">
          <div className="project-row">
            <span className="live-dot" />
            <strong>{projectDisplayName(currentProject, projects)}</strong>
          </div>
          <div className="subtle">{currentProject.workspacePath} · {readableGitStatus(currentProject.gitStatus, currentProject.changedFiles, t)}</div>
        </section>
      )}
      {runningSessions.length > 0 && (
        <>
          <div className="thread-group-title">{t("session.runningTasks")}</div>
          {runningSessions.map((session) => (
            <button className={`thread running ${session.id === activeSessionId ? "active" : ""}`} key={`running-${session.id}`} onClick={() => onSelectSession(session.id)}>
              <span className="thread-title-row">
                <span className={`session-type-badge ${session.conversationType ?? "codex"}`}>{readableSessionType(session, t)}</span>
                <span className="thread-title">{session.title}</span>
                {unreadSessionIds?.has(session.id) && session.id !== activeSessionId && <span className="thread-unread-dot" title={t("session.newMessage")} />}
              </span>
              <span className="thread-meta">{projectDisplayName(projects.find((project) => project.id === session.projectId), projects) || t("session.noProject")} · {formatShortDate(session.updatedAt)}</span>
            </button>
          ))}
        </>
      )}
      <div className="thread-filters">
        <input name="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t("session.searchSessions")} />
        <div className="thread-filter-row">
          <select name="projectfilter" value={projectFilter} onChange={(event) => onProjectFilter(event.target.value)}>
            <option value="all">{t("session.allProjects")}</option>
            <option value="scratch">{t("session.noProject")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
          </select>
          <select name="statusfilter" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
            <option value="all">{t("session.allStatuses")}</option>
            <option value="running">{t("session.statusRunning")}</option>
            <option value="done">{t("session.statusDone")}</option>
            <option value="paused">{t("session.statusPaused")}</option>
            <option value="interrupted">{t("session.statusInterrupted")}</option>
          </select>
        </div>
      </div>
      <div className="thread-group-title">{t("session.recentSessions")}</div>
      {visibleSessions.map((session) => (
        <button className={`thread ${session.id === activeSessionId ? "active" : ""}`} key={session.id} onClick={() => onSelectSession(session.id)}>
          <span className="thread-title-row">
            <span className={`session-type-badge ${session.conversationType ?? "codex"}`}>{readableSessionType(session, t)}</span>
            <span className="thread-title">{session.title}</span>
            {unreadSessionIds?.has(session.id) && session.id !== activeSessionId && <span className="thread-unread-dot" title={t("session.newMessage")} />}
          </span>
          <span className="thread-meta">
            {readableStatus(session.status, t)} · {projectDisplayName(projects.find((project) => project.id === session.projectId), projects) || t("session.noProject")} · {providers.find((provider) => provider.id === session.providerId)?.name ?? t("session.noProvider")} / {session.model ?? t("session.noModel")} · {formatShortDate(session.updatedAt)}
          </span>
        </button>
      ))}
      {hasMore && <button className="ghost-button load-more" type="button" onClick={onLoadMore}>{t("session.loadMore")}</button>}
    </aside>
  );
}
