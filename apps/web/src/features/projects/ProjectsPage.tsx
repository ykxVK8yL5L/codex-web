import React, { useEffect, useMemo, useState } from "react";
import { Activity, Bot, Copy, Download, Files, FolderGit2, FolderOpen, GitPullRequest, Globe, Info, MoreHorizontal, Pencil, Play, RefreshCw, RotateCcw, Save, Send, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDialog } from "@/components/AppDialog";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { PreviewDetailRow } from "@/components/PreviewDetailRow";
import { PreviewDirectoryPicker } from "@/components/PreviewDirectoryPicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilesPage } from "@/features/files";
import { formatBytes, formatShortDate, prettyJson, projectDisplayName, renderPreviewCommand } from "@/lib/format";
import { readableGitStatus, readableStatus } from "@/features/projects/utils";
import type { TranslationKey } from "@/lib/i18n";
import { openPreviewUrl } from "@/lib/previews";
import { copyText } from "@/lib/utils";
import type { ApprovalSummary, CreatePreviewRequest, CreateProjectRequest, PageResponse, PreviewAccess, PreviewSummary, ProjectCheckRunSummary, ProjectGitOperationRequest, ProjectGitOperationSummary, ProjectStatsSummary, ProjectSummary, SessionSummary, TerminalCommandResponse, UpdateProjectRequest, WorkspaceChangeFile, WorkspaceChanges } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";

export function ProjectsPage({
  sessionToken,
  projects,
  sessions,
  onOpenSession,
  onNewProjectSession,
  onAnalyzeProjectCheck,
  onChange,
  t,
  notify,
  onOpenMainNav,
  TerminalComponent,
}: {
  sessionToken: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onNewProjectSession: (projectId: string) => void;
  onAnalyzeProjectCheck: (project: ProjectSummary, result: TerminalCommandResponse) => Promise<void>;
  onChange: () => Promise<void>;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
  TerminalComponent: React.ComponentType<{ sessionToken: string; t: TFunction; initialCwd?: string; embedded?: boolean }>;
}) {
  const dialog = useAppDialog();
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [showWorkspacePathInput, setShowWorkspacePathInput] = useState(false);
  const [message, setMessage] = useState("");
  const [projectItems, setProjectItems] = useState<ProjectSummary[]>(projects);
  const [projectCursor, setProjectCursor] = useState<string | null>(null);
  const [projectHasMore, setProjectHasMore] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [workspacePanel, setWorkspacePanel] = useState<{ mode: "files" | "terminal"; project: ProjectSummary } | null>(null);
  const [changesPanel, setChangesPanel] = useState<{ project: ProjectSummary; changes: WorkspaceChanges | null; selectedFile?: WorkspaceChangeFile } | null>(null);
  const [detailPanel, setDetailPanel] = useState<{ project: ProjectSummary; stats: ProjectStatsSummary | null; sessions: SessionSummary[] | null; sessionsCursor?: string | null; sessionsHasMore?: boolean; checks: ProjectCheckRunSummary[] | null; gitOps?: ProjectGitOperationSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [sessionsPanel, setSessionsPanel] = useState<{ project: ProjectSummary; sessions: SessionSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [checkResult, setCheckResult] = useState<{ project: ProjectSummary; result: TerminalCommandResponse | null } | null>(null);
  const [previewPanel, setPreviewPanel] = useState<{ project: ProjectSummary; previews: PreviewSummary[] | null } | null>(null);
  const [previewCommand, setPreviewCommand] = useState("python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}");
  const [previewPort, setPreviewPort] = useState("4179");
  const [previewDirectory, setPreviewDirectory] = useState("preview-demo");
  const [previewAccess, setPreviewAccess] = useState<PreviewAccess>("private");

  function showError(value: string) {
    setMessage(value);
    notify(value, "error");
  }

  useEffect(() => {
    setProjectItems(projects);
  }, [projects]);

  useEffect(() => {
    void loadProjects(true);
  }, [sessionToken]);

  async function loadProjects(reset = false, search = projectSearch) {
    const params = new URLSearchParams({ limit: "20" });
    if (!reset && projectCursor) params.set("cursor", projectCursor);
    if (search.trim()) params.set("q", search.trim());
    const response = await fetch(`/api/projects?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<ProjectSummary>;
    setProjectItems((items) => reset ? page.items : [...items, ...page.items.filter((project) => !items.some((item) => item.id === project.id))]);
    setProjectCursor(page.nextCursor);
    setProjectHasMore(page.hasMore);
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const body: CreateProjectRequest = {
      name,
    };
    if (workspacePath.trim()) body.workspacePath = workspacePath.trim();
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("project.createFailed"));
      return;
    }
    setName("");
    setWorkspacePath("");
    setShowWorkspacePathInput(false);
    await onChange();
    await loadProjects(true);
    notify(t("project.created"), "success");
  }

  async function deleteProject(project: ProjectSummary) {
    const decision = await dialog.confirmWithCheckbox({
      title: t("project.deleteProject"),
      message: t("project.deleteProjectMessage").replace("{name}", project.name).replace("{path}", project.workspacePath),
      confirmLabel: t("project.deleteProject"),
      checkboxLabel: t("project.deleteProjectFilesCheckbox"),
      checkboxDefaultChecked: false,
      danger: true,
    });
    if (!decision.confirmed) return;
    const deleteFiles = decision.checked;
    setMessage("");
    const response = await fetch(`/api/projects/${project.id}?${new URLSearchParams({ deleteFiles: String(deleteFiles) })}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        notify(t("approval.required"), "info");
        return;
      }
      showError(deleteFiles ? t("project.deleteFailedProtected") : t("project.deleteFailed"));
      return;
    }
    await onChange();
    await loadProjects(true);
    notify(t("project.deleted"), "success");
  }

  async function updateProject(project: ProjectSummary, input: UpdateProjectRequest) {
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      showError(t("project.updateFailed"));
      return null;
    }
    await onChange();
    await loadProjects(true);
    notify(t("project.updated"), "success");
    return (await response.json()) as ProjectSummary;
  }

  async function editCheckCommand(project: ProjectSummary) {
    const checkCommand = await dialog.prompt({
      title: t("project.checkCommand"),
      message: project.name,
      defaultValue: project.checkCommand ?? "pnpm run check",
      placeholder: t("project.checkPlaceholder"),
      confirmLabel: t("action.save"),
    });
    if (checkCommand === null) return;
    await updateProject(project, { checkCommand });
  }

  async function editProject(project: ProjectSummary) {
    const name = await dialog.prompt({
      title: t("project.editName"),
      defaultValue: project.name,
      placeholder: t("form.projectName"),
      confirmLabel: t("file.next"),
    });
    if (!name) return;
    const workspacePath = await dialog.prompt({
      title: t("project.editWorkspace"),
      message: name,
      defaultValue: project.workspacePath,
      placeholder: t("form.workspacePath"),
      confirmLabel: t("action.save"),
    });
    if (!workspacePath) return;
    await updateProject(project, { name, workspacePath });
  }

  async function runProjectCheck(project: ProjectSummary) {
    setCheckResult({ project, result: null });
    const response = await fetch(`/api/projects/${project.id}/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.checkRunFailed"));
      return;
    }
    setCheckResult({ project, result: (await response.json()) as TerminalCommandResponse });
  }

  async function runProjectCheckCommand(project: ProjectSummary, command: string) {
    setCheckResult({ project, result: null });
    const response = await fetch(`/api/projects/${project.id}/check`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!response.ok) {
      showError(t("project.checkRunFailed"));
      return;
    }
    setCheckResult({ project, result: (await response.json()) as TerminalCommandResponse });
  }

  async function runProjectGit(project: ProjectSummary, operation: ProjectGitOperationRequest["operation"]) {
    let body: ProjectGitOperationRequest = { operation };
    if (operation === "commit") {
      const messageValue = await dialog.prompt({ title: t("project.gitCommit"), message: project.name, placeholder: t("project.gitCommitMessage"), confirmLabel: t("project.gitCommit") });
      if (!messageValue) return;
      body = { operation, message: messageValue };
    }
    if (operation === "branch-create" || operation === "branch-checkout") {
      const branch = await dialog.prompt({ title: operation === "branch-create" ? t("project.gitBranchCreate") : t("project.gitBranchCheckout"), message: project.name, placeholder: t("project.gitBranchName"), confirmLabel: t("action.save") });
      if (!branch) return;
      body = { operation, branch };
    }
    const response = await fetch(`/api/projects/${project.id}/git`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as ProjectGitOperationSummary | { error?: string; approval?: ApprovalSummary } | null;
    if (response.status === 409 && result && "error" in result && result.error === "approval_required") {
      notify(t("approval.required"), "info");
      return;
    }
    if (!response.ok) {
      showError(result && "error" in result && result.error ? result.error : t("project.gitOperationFailed"));
      return;
    }
    notify(t("project.gitOperationDone"), "success");
    await onChange();
    await loadProjects(true);
    if (detailPanel?.project.id === project.id) void loadProjectGitOperations(project);
  }

  async function openProjectChanges(project: ProjectSummary) {
    setChangesPanel({ project, changes: null });
    await loadProjectChanges(project);
  }

  async function loadProjectChanges(project: ProjectSummary, selectedPath?: string) {
    const response = await fetch(`/api/projects/${project.id}/changes`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.changesReadFailed"));
      return;
    }
    const changes = (await response.json()) as WorkspaceChanges;
    const selectedFile = selectedPath ? changes.files.find((file) => file.path === selectedPath) : undefined;
    setChangesPanel({ project, changes, selectedFile });
  }

  async function copyProjectPatch(file?: WorkspaceChangeFile) {
    const value = file ? file.patch || file.newContent || "" : changesPanel?.changes?.raw.diff ?? "";
    if (!value) return;
    await copyText(value);
    notify(t("workspace.copyDiff"), "success");
  }

  async function revertProjectFile(file: WorkspaceChangeFile) {
    if (!changesPanel) return;
    const confirmed = await dialog.confirm({
      title: t("workspace.revertTitle"),
      message: file.path,
      confirmLabel: t("workspace.revert"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/projects/${changesPanel.project.id}/changes/revert-file`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    });
    if (!response.ok) {
      showError(t("workspace.revertFailed"));
      return;
    }
    const changes = (await response.json()) as WorkspaceChanges;
    setChangesPanel({ project: changesPanel.project, changes });
    notify(t("workspace.reverted"), "success");
  }

  async function projectGitFileAction(file: WorkspaceChangeFile, action: "stage" | "unstage") {
    if (!changesPanel) return;
    const response = await fetch(`/api/projects/${changesPanel.project.id}/changes/${action}-file`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    });
    if (!response.ok) {
      showError(action === "stage" ? t("workspace.stageFailed") : t("workspace.unstageFailed"));
      return;
    }
    const changes = (await response.json()) as WorkspaceChanges;
    setChangesPanel({ project: changesPanel.project, changes, selectedFile: changes.files.find((item) => item.path === file.path) });
    notify(action === "stage" ? t("workspace.staged") : t("workspace.unstaged"), "success");
  }

  async function openProjectDetail(project: ProjectSummary) {
    setDetailPanel({ project, stats: null, sessions: null, checks: null, gitOps: null });
    void loadProjectStats(project);
    void loadProjectSessions(project, false, "detail");
    void loadProjectGitOperations(project);
    await loadProjectCheckRuns(project, false);
  }

  async function loadProjectStats(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/stats`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const stats = (await response.json()) as ProjectStatsSummary;
    setDetailPanel((current) => current?.project.id === project.id ? { ...current, stats } : current);
  }

  async function loadProjectSessions(project: ProjectSummary, older: boolean, target: "detail" | "panel") {
    const currentCursor = older
      ? target === "detail" && detailPanel?.project.id === project.id
        ? detailPanel.sessionsCursor
        : target === "panel" && sessionsPanel?.project.id === project.id
          ? sessionsPanel.cursor
          : null
      : null;
    const params = new URLSearchParams({ limit: "10" });
    if (currentCursor) params.set("cursor", currentCursor);
    const response = await fetch(`/api/projects/${project.id}/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.sessionsReadFailed"));
      return;
    }
    const page = (await response.json()) as PageResponse<SessionSummary>;
    if (target === "detail") {
      setDetailPanel((panel) => panel?.project.id === project.id ? {
        ...panel,
        sessions: older ? [...(panel.sessions ?? []), ...page.items] : page.items,
        sessionsCursor: page.nextCursor,
        sessionsHasMore: page.hasMore,
      } : panel);
      return;
    }
    setSessionsPanel((panel) => panel?.project.id === project.id ? {
      project,
      sessions: older ? [...(panel.sessions ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    } : { project, sessions: page.items, cursor: page.nextCursor, hasMore: page.hasMore });
  }

  async function loadProjectGitOperations(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/git-operations?${new URLSearchParams({ limit: "10" })}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<ProjectGitOperationSummary>;
    setDetailPanel((current) => current?.project.id === project.id ? { ...current, gitOps: page.items } : current);
  }

  async function loadProjectCheckRuns(project: ProjectSummary, older: boolean) {
    const currentCursor = older && detailPanel?.project.id === project.id ? detailPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (currentCursor) params.set("cursor", currentCursor);
    const response = await fetch(`/api/projects/${project.id}/check-runs?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.checkHistoryReadFailed"));
      return;
    }
    const page = (await response.json()) as PageResponse<ProjectCheckRunSummary>;
    setDetailPanel((current) => ({
      project,
      stats: current?.project.id === project.id ? current.stats : null,
      sessions: current?.project.id === project.id ? current.sessions : null,
      sessionsCursor: current?.project.id === project.id ? current.sessionsCursor : null,
      sessionsHasMore: current?.project.id === project.id ? current.sessionsHasMore : false,
      gitOps: current?.project.id === project.id ? current.gitOps : null,
      checks: older && current?.project.id === project.id ? [...(current.checks ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function openProjectPreviews(project: ProjectSummary) {
    setPreviewPanel({ project, previews: null });
    await loadProjectPreviews(project);
  }

  async function loadProjectPreviews(project: ProjectSummary) {
    const params = new URLSearchParams({ scopeType: "project", scopeId: project.id });
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.previewReadFailed"));
      return;
    }
    setPreviewPanel({ project, previews: (await response.json()) as PreviewSummary[] });
  }

  useEffect(() => {
    if (!previewPanel?.previews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadProjectPreviews(previewPanel.project), 1500);
    return () => window.clearTimeout(timer);
  }, [previewPanel, sessionToken]);

  async function openProjectSessions(project: ProjectSummary) {
    setSessionsPanel({ project, sessions: null });
    await loadProjectSessions(project, false, "panel");
  }

  async function createProjectPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!previewPanel) return;
    const body: CreatePreviewRequest = {
      scopeType: "project",
      scopeId: previewPanel.project.id,
      label: `${previewPanel.project.name}:${previewPort}`,
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
        showError(t("approval.required"));
        await openProjectPreviews(previewPanel.project);
        return;
      }
      showError(result?.error ? `${t("project.previewStartFailed")}：${result.error}` : t("project.previewStartFailed"));
      return;
    }
    const preview = (await response.json()) as PreviewSummary;
    setPreviewPanel((current) => current ? { ...current, previews: [preview, ...(current.previews ?? []).filter((item) => item.id !== preview.id)] } : current);
    notify(t("project.previewStarted"), "success");
  }

  async function stopProjectPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviewPanel((current) => current ? {
      ...current,
      previews: (current.previews ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item),
    } : current);
  }

  async function deleteProjectPreview(preview: PreviewSummary) {
    const confirmed = await dialog.confirm({
      title: t("project.deletePreview"),
      message: `${preview.label}\n${preview.targetHost}:${preview.port}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      showError(t("project.previewDeleteFailed"));
      return;
    }
    setPreviewPanel((current) => current ? {
      ...current,
      previews: (current.previews ?? []).filter((item) => item.id !== preview.id),
    } : current);
    notify(t("project.previewDeleted"), "success");
  }

  async function renameProjectPreview(preview: PreviewSummary) {
    const label = await dialog.prompt({
      title: t("preview.rename"),
      message: `${preview.targetHost}:${preview.port}`,
      placeholder: preview.label,
      defaultValue: preview.label,
      confirmLabel: t("action.save"),
    });
    if (label === null) return;
    const nextLabel = label.trim();
    if (!nextLabel || nextLabel === preview.label) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ label: nextLabel }),
    });
    if (!response.ok) {
      showError(t("preview.renameFailed"));
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviewPanel((current) => current ? {
      ...current,
      previews: (current.previews ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item),
    } : current);
    notify(t("preview.renamed"), "success");
  }

  return (
    <main className="projects-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.projects")}`} title={t("page.projects")} action={t("action.refresh")} onAction={() => void loadProjects(true)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.projects")} />
      <section className="management-layout">
        <form className="management-form" onSubmit={createProject}>
          <strong>{t("project.createTitle")}</strong>
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.projectName")} required />
          {showWorkspacePathInput ? (
            <>
              <input name="workspacepath" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder={t("form.workspacePathOptional")} />
              <span className="subtle">{t("project.workspacePathAutoHint")}</span>
            </>
          ) : (
            <button className="ghost-button" type="button" onClick={() => setShowWorkspacePathInput(true)}><IconText icon={FolderOpen}>{t("project.useCustomWorkspacePath")}</IconText></button>
          )}
          {message && <span className="form-error">{message}</span>}
          <Button>{t("project.create")}</Button>
        </form>
        <section className="project-list-pane">
          <div className="project-list-head">
            <strong>{t("project.listTitle")}</strong>
            <span>{projectItems.length} {t("project.countSuffix")}</span>
          </div>
          <div className="thread-filters project-search-row">
            <input name="projectsearch" value={projectSearch} onChange={(event) => {
              const value = event.target.value;
              setProjectSearch(value);
              void loadProjects(true, value);
            }} placeholder={t("project.searchProjects")} />
          </div>
          <div className="project-list">
            {projectItems.map((project) => (
              <article className="project-list-card" key={project.id}>
                <div className="project-list-title">
                  <strong>{projectDisplayName(project, projectItems)}</strong>
                </div>
                <code>{project.workspacePath}</code>
                <div className="project-list-meta">
                  <span>{readableGitStatus(project.gitStatus, project.changedFiles, t)}</span>
                  <span>{t("project.gitBreakdown").replace("{staged}", String(project.stagedFiles ?? 0)).replace("{modified}", String(project.modifiedFiles ?? 0)).replace("{untracked}", String(project.untrackedFiles ?? 0))}</span>
                  <span>{project.gitBranch ? `branch: ${project.gitBranch}` : "no branch"}</span>
                  <span>{project.gitRemoteStatus ?? "no remote"}</span>
                  <span>{project.checkCommand ? `check: ${project.checkCommand}` : "no check command"}</span>
                  <span>{project.id}</span>
                </div>
                <div className="project-list-actions">
                  <button className="ghost-button icon-only" type="button" title={t("nav.files")} aria-label={t("nav.files")} onClick={() => setWorkspacePanel({ mode: "files", project })}><IconText icon={Files}>{t("nav.files")}</IconText></button>
                  <button className="ghost-button icon-only" type="button" title={t("nav.terminal")} aria-label={t("nav.terminal")} onClick={() => setWorkspacePanel({ mode: "terminal", project })}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
                  <button className="ghost-button icon-only" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => void openProjectDetail(project)}><IconText icon={Info}>{t("preview.details")}</IconText></button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="ghost-button icon-only" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void openProjectSessions(project)}><IconText icon={Bot}>{t("project.sessions")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onNewProjectSession(project.id)}><IconText icon={Send}>{t("session.newSession")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void openProjectChanges(project)}><IconText icon={Activity}>{t("project.changes")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void openProjectPreviews(project)}><IconText icon={Globe}>{t("project.preview")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void editProject(project)}><IconText icon={Pencil}>{t("action.edit")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void editCheckCommand(project)}><IconText icon={Save}>{t("project.setCheck")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem disabled={!project.checkCommand} onSelect={() => void runProjectCheck(project)}><IconText icon={Play}>{t("project.runCheck")}</IconText></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "pull")}><IconText icon={Download}>{t("project.gitPull")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "commit")}><IconText icon={Save}>{t("project.gitCommit")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "branch-create")}><IconText icon={FolderGit2}>{t("project.gitBranchCreate")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "branch-checkout")}><IconText icon={GitPullRequest}>{t("project.gitBranchCheckout")}</IconText></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runProjectGit(project, "push")}><IconText icon={Globe}>{t("project.gitPush")}</IconText></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-red-700 focus:bg-red-50 focus:text-red-800" onSelect={() => deleteProject(project)}><IconText icon={Trash2}>{t("project.deleteProject")}</IconText></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            ))}
            {projectHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjects(false)}>{t("session.loadMore")}</button>}
            {!projectItems.length && <div className="empty-state">{t("project.noProjects")}</div>}
          </div>
        </section>
      </section>
      {workspacePanel && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{workspacePanel.mode === "files" ? t("workspace.projectFiles") : t("workspace.projectTerminal")}</strong>
              <span>{workspacePanel.project.workspacePath}</span>
            </div>
            <div className="workspace-modal-controls">
              <div className="workspace-modal-actions">
                <button className={`ghost-button icon-only ${workspacePanel.mode === "files" ? "active" : ""}`} type="button" title={t("nav.files")} aria-label={t("nav.files")} onClick={() => setWorkspacePanel({ ...workspacePanel, mode: "files" })}><IconText icon={Files}>{t("nav.files")}</IconText></button>
                <button className={`ghost-button icon-only ${workspacePanel.mode === "terminal" ? "active" : ""}`} type="button" title={t("nav.terminal")} aria-label={t("nav.terminal")} onClick={() => setWorkspacePanel({ ...workspacePanel, mode: "terminal" })}><IconText icon={TerminalIcon}>{t("nav.terminal")}</IconText></button>
              </div>
              <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setWorkspacePanel(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="workspace-modal-body">
            {workspacePanel.mode === "files" && (
              <FilesPage sessionToken={sessionToken} t={t} initialRootPath={workspacePanel.project.workspacePath} initialMountName={workspacePanel.project.name} embedded TerminalComponent={TerminalComponent} />
            )}
            {workspacePanel.mode === "terminal" && (
              <TerminalComponent sessionToken={sessionToken} t={t} initialCwd={workspacePanel.project.workspacePath} embedded />
            )}
          </div>
        </div>
      )}
      {detailPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{projectDisplayName(detailPanel.project, projectItems)}</strong>
              <span>{detailPanel.project.workspacePath}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setDetailPanel(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="preview-detail">
            <PreviewDetailRow label={t("project.projectId")} value={detailPanel.project.id} />
            <PreviewDetailRow label={t("project.git")} value={`${readableGitStatus(detailPanel.project.gitStatus, detailPanel.project.changedFiles, t)} · ${t("project.gitBreakdown").replace("{staged}", String(detailPanel.project.stagedFiles ?? 0)).replace("{modified}", String(detailPanel.project.modifiedFiles ?? 0)).replace("{untracked}", String(detailPanel.project.untrackedFiles ?? 0))}`} />
            <PreviewDetailRow label={t("project.branch")} value={detailPanel.project.gitBranch ?? "-"} />
            <PreviewDetailRow label={t("project.remote")} value={detailPanel.project.gitRemoteStatus ?? "-"} />
            <PreviewDetailRow label={t("project.checkCommand")} value={detailPanel.project.checkCommand ?? t("project.unconfigured")} />
            {Boolean(detailPanel.project.checkCommands?.length) && (
              <div className="preview-detail-row">
                <span>{t("project.checkCommands")}</span>
                <div className="detail-stack">
                  {detailPanel.project.checkCommands?.map((command) => (
                    <button className="file-list-item" key={command} type="button" onClick={() => void runProjectCheckCommand(detailPanel.project, command)}>
                      <span>{command}</span>
                      <em>{t("project.runCheck")}</em>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="project-stat-grid">
              <div><strong>{detailPanel.stats?.totalSessions ?? "-"}</strong><span>{t("project.totalSessions")}</span></div>
              <div><strong>{detailPanel.stats?.runningSessions ?? "-"}</strong><span>{t("project.runningSessions")}</span></div>
              <div><strong>{detailPanel.stats?.latestCheckStatus ?? "-"}</strong><span>{t("project.latestCheck")}</span></div>
              <div><strong>{Object.entries(detailPanel.stats?.previewStatusCounts ?? {}).map(([status, count]) => `${status}:${count}`).join(" · ") || "-"}</strong><span>{t("project.previewSummary")}</span></div>
            </div>
            <div className="preview-detail-row">
              <span>{t("project.sessions")}</span>
              <div className="detail-stack">
                {!detailPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
                {detailPanel.sessions?.map((session) => (
                  <button className="file-list-item" key={session.id} type="button" onClick={() => onOpenSession(session.id)}>
                    <span>{session.title}</span>
                    <em>{readableStatus(session.status, t)} · {formatShortDate(session.updatedAt)}</em>
                  </button>
                ))}
                {detailPanel.sessionsHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjectSessions(detailPanel.project, true, "detail")}>{t("session.loadMore")}</button>}
                {detailPanel.sessions && !detailPanel.sessions.length && <div className="empty-state">{t("project.noProjectSessions")}</div>}
              </div>
            </div>
            <div className="preview-detail-row">
              <span>{t("project.checkHistory")}</span>
              <div className="detail-stack">
                {!detailPanel.checks && <div className="subtle">{t("project.checkHistoryLoading")}</div>}
                {detailPanel.checks?.map((run) => (
                  <details className="check-run-detail" key={run.id}>
                    <summary>{run.status} · exit {run.exitCode ?? "null"} · {run.durationMs}ms · {formatShortDate(run.finishedAt ?? run.startedAt)}</summary>
                    <code>{run.command}</code>
                    <pre className="preview-logs">{[run.stdout, run.stderr].filter(Boolean).join("\n") || t("project.noOutput")}</pre>
                  </details>
                ))}
                {detailPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjectCheckRuns(detailPanel.project, true)}>{t("session.loadMore")}</button>}
                {detailPanel.checks && !detailPanel.checks.length && <div className="empty-state">{t("project.noCheckHistory")}</div>}
              </div>
            </div>
            <div className="preview-detail-row">
              <span>{t("project.gitHistory")}</span>
              <div className="detail-stack">
                {!detailPanel.gitOps && <div className="subtle">{t("session.loading")}</div>}
                {detailPanel.gitOps?.map((op) => (
                  <details className="check-run-detail" key={op.id}>
                    <summary>{op.operation} · {op.status} · exit {op.exitCode ?? "null"} · {formatShortDate(op.createdAt)}</summary>
                    <code>git {op.args.join(" ")}</code>
                    <pre className="preview-logs">{[op.stdout, op.stderr].filter(Boolean).join("\n") || t("project.noOutput")}</pre>
                  </details>
                ))}
                {detailPanel.gitOps && !detailPanel.gitOps.length && <div className="empty-state">{t("project.noGitHistory")}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
      {changesPanel && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.changes")}</strong>
              <span>{changesPanel.project.workspacePath}</span>
            </div>
            <div className="workspace-modal-controls">
              <div className="workspace-modal-actions">
                <button className="ghost-button icon-only" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadProjectChanges(changesPanel.project, changesPanel.selectedFile?.path)}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
                <button className="ghost-button icon-only" type="button" title={t("workspace.copyAll")} aria-label={t("workspace.copyAll")} disabled={!changesPanel.changes?.raw.diff} onClick={() => void copyProjectPatch()}><IconText icon={Copy}>{t("workspace.copyAll")}</IconText></button>
              </div>
              <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setChangesPanel(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="project-changes-layout">
            <aside className="project-change-files">
              {!changesPanel.changes && <div className="subtle">{t("project.loadingChanges")}</div>}
              {changesPanel.changes && !changesPanel.changes.isGitRepo && <div className="empty-state">{t("project.notGitRepo")}</div>}
              {changesPanel.changes?.files.map((file) => (
                <button className={`file-list-item ${changesPanel.selectedFile?.path === file.path ? "active" : ""}`} key={file.path} type="button" onClick={() => setChangesPanel({ ...changesPanel, selectedFile: file })}>
                  <span>{file.status} {file.path}</span>
                  <em>+{file.additions} -{file.deletions}</em>
                </button>
              ))}
              {changesPanel.changes?.isGitRepo && !changesPanel.changes.files.length && <div className="empty-state">{t("project.noChanges")}</div>}
            </aside>
            <section className="project-change-diff">
              <div className="file-preview-head">
                <div>
                  <strong>{changesPanel.selectedFile?.path ?? t("project.selectChangedFile")}</strong>
                  <div className="subtle">{changesPanel.changes ? `${changesPanel.changes.summary.filesChanged} files · +${changesPanel.changes.summary.additions} -${changesPanel.changes.summary.deletions}` : ""}</div>
                </div>
                {changesPanel.selectedFile && (
                  <div className="workspace-modal-actions">
                    <button className="ghost-button icon-only" type="button" title={t("project.openFile")} aria-label={t("project.openFile")} onClick={() => setWorkspacePanel({ mode: "files", project: changesPanel.project })}><IconText icon={FolderOpen}>{t("project.openFile")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("workspace.stageFile")} aria-label={t("workspace.stageFile")} onClick={() => changesPanel.selectedFile && void projectGitFileAction(changesPanel.selectedFile, "stage")}><IconText icon={Save}>{t("workspace.stageFile")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("workspace.unstageFile")} aria-label={t("workspace.unstageFile")} onClick={() => changesPanel.selectedFile && void projectGitFileAction(changesPanel.selectedFile, "unstage")}><IconText icon={RotateCcw}>{t("workspace.unstageFile")}</IconText></button>
                    <button className="ghost-button icon-only" type="button" title={t("workspace.copyPatch")} aria-label={t("workspace.copyPatch")} onClick={() => void copyProjectPatch(changesPanel.selectedFile)}><IconText icon={Copy}>{t("workspace.copyPatch")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" title={t("workspace.revertFile")} aria-label={t("workspace.revertFile")} onClick={() => changesPanel.selectedFile && void revertProjectFile(changesPanel.selectedFile)}><IconText icon={RotateCcw}>{t("workspace.revertFile")}</IconText></button>
                  </div>
                )}
              </div>
              <pre className="large-code diff-view">{changesPanel.selectedFile?.patch || changesPanel.changes?.raw.status || t("project.waitingChangedFile")}</pre>
            </section>
          </div>
        </div>
      )}
      {sessionsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.sessions")}</strong>
              <span>{projectDisplayName(sessionsPanel.project, projectItems)}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSessionsPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {!sessionsPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
            {sessionsPanel.sessions?.map((session) => (
              <button className="file-list-item" key={session.id} type="button" onClick={() => {
                setSessionsPanel(null);
                onOpenSession(session.id);
              }}>
                <span>{session.title}</span>
                <em>{readableStatus(session.status, t)} · {formatShortDate(session.updatedAt)}</em>
              </button>
            ))}
            {sessionsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadProjectSessions(sessionsPanel.project, true, "panel")}>{t("session.loadMore")}</button>}
            {sessionsPanel.sessions && !sessionsPanel.sessions.length && <div className="empty-state">{t("project.noProjectSessions")}</div>}
          </div>
        </div>
      )}
      {previewPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.preview")}</strong>
              <span>{projectDisplayName(previewPanel.project, projectItems)}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setPreviewPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            <form className="preview-form" onSubmit={createProjectPreview}>
              <label>
                <span>{t("project.previewCommand")}</span>
                <input name="previewcommand-2" value={previewCommand} onChange={(event) => setPreviewCommand(event.target.value)} placeholder="python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}" required />
              </label>
              <label>
                <span>{t("project.previewDirectory")}</span>
                <PreviewDirectoryPicker sessionToken={sessionToken} rootPath={previewPanel.project.workspacePath} value={previewDirectory} onChange={setPreviewDirectory} placeholder="preview-demo" t={t} />
              </label>
              <label>
                <span>{t("project.previewPort")}</span>
                <input name="previewport-2" value={previewPort} onChange={(event) => setPreviewPort(event.target.value)} inputMode="numeric" placeholder="4179" required />
              </label>
              <label>
                <span>{t("preview.access")}</span>
                <select name="previewaccess-2" value={previewAccess} onChange={(event) => setPreviewAccess(event.target.value as PreviewAccess)}>
                  <option value="private">{t("preview.private")}</option>
                  <option value="public">{t("preview.public")}</option>
                </select>
              </label>
              <button className="ghost-button" type="submit"><IconText icon={Play}>{t("project.startPreview")}</IconText></button>
            </form>
            {!previewPanel.previews && <div className="subtle">{t("project.loadingPreviews")}</div>}
            {previewPanel.previews?.map((preview) => (
              <div className="preview-row" key={preview.id}>
                <div>
                  <strong>{preview.label}</strong>
                  <span>{preview.status} · {preview.access} · {preview.targetHost}:{preview.port}</span>
                  {preview.command && <code>{preview.command}</code>}
                </div>
                <div className="preview-actions">
                  <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, notify, t)}>{t("project.openPreview")}</button>
                  <button className="ghost-button" type="button" onClick={() => void renameProjectPreview(preview)}>{t("action.rename")}</button>
                  <button className="ghost-button" type="button" disabled={preview.status !== "running" && preview.status !== "starting"} onClick={() => void stopProjectPreview(preview)}>{t("action.disconnect")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteProjectPreview(preview)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {previewPanel.previews && !previewPanel.previews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      )}
      {checkResult && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.projectCheck")}</strong>
              <span>{checkResult.project.checkCommand ?? t("project.unconfigured")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setCheckResult(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {!checkResult.result && <div className="subtle">{t("project.checkRunning")}</div>}
            {checkResult.result && (
              <>
                <code>{checkResult.result.cwd} · {t("project.exitCode")} {checkResult.result.exitCode ?? "null"} · {checkResult.result.durationMs}ms</code>
                <button className="ghost-button" type="button" onClick={() => checkResult.result && void onAnalyzeProjectCheck(checkResult.project, checkResult.result)}><IconText icon={Bot}>{t("project.analyzeWithCodex")}</IconText></button>
                <pre className="extension-detail-content">{[checkResult.result.stdout, checkResult.result.stderr].filter(Boolean).join("\n") || t("project.noOutput")}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
