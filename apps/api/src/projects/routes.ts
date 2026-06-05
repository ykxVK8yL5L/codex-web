import type { Hono } from "hono";
import { mkdirSync, rmSync, statSync } from "node:fs";
import type {
  CreateProjectRequest,
  ProjectGitOperationRequest,
  ProjectStatsSummary,
  ProjectSummary,
  RevertWorkspaceFileRequest,
  UpdateProjectRequest,
  WorkspaceGitFileRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows, parsePageLimit } from "../pagination.js";

type ProjectRoutesDeps = Record<string, any>;

export function registerProjectRoutes(app: Hono, deps: ProjectRoutesDeps) {
  app.get("/api/projects", async (c) => {
    const limitQuery = c.req.query("limit");
    if (!limitQuery && !c.req.query("cursor") && !c.req.query("q")) {
      const projects = await Promise.all(deps.appData.projects.map((project: ProjectSummary) => deps.refreshProjectGitStatus(project)));
      return c.json(projects);
    }
    const limit = parsePageLimit(limitQuery, 20);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const filtered = deps.appData.projects
      .filter((project: ProjectSummary) => !q || project.name.toLowerCase().includes(q) || project.workspacePath.toLowerCase().includes(q) || project.id.toLowerCase().includes(q))
      .filter((project: ProjectSummary) => !cursor || project.name > cursor.sortValue || (project.name === cursor.sortValue && project.id > cursor.id))
      .sort((a: ProjectSummary, b: ProjectSummary) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const pageItems = filtered.slice(0, limit + 1);
    await Promise.all(pageItems.slice(0, limit).map((project: ProjectSummary) => deps.refreshProjectGitStatus(project)));
    return c.json(pageFromRows(pageItems, limit, (item: any) => item.name));
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json<CreateProjectRequest>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: "invalid_project_name" }, 400);
    const id = deps.uniqueProjectId(name);
    const workspacePath = body.workspacePath?.trim()
      ? deps.resolveTerminalCwd(body.workspacePath)
      : deps.defaultProjectWorkspacePath(id);
    if (!body.workspacePath?.trim()) mkdirSync(workspacePath, { recursive: true });
    const project: ProjectSummary = { id, name, workspacePath, runner: "docker", changedFiles: 0, checkCommand: undefined };
    await deps.ensureGitRepositoryForProject(project.workspacePath);
    deps.writeProjectWorkspaceMetadata(project);
    await deps.refreshProjectGitStatus(project);
    deps.appData.projects.unshift(project);
    deps.saveAppData();
    return c.json(project, 201);
  });

  app.patch("/api/projects/:id", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const body = await c.req.json<UpdateProjectRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_project_update" }, 400);
    if (body.name !== undefined) project.name = body.name.trim() || project.name;
    if (body.workspacePath !== undefined) project.workspacePath = body.workspacePath.trim() || project.workspacePath;
    if (body.checkCommand !== undefined) project.checkCommand = body.checkCommand.trim() || undefined;
    deps.writeProjectWorkspaceMetadata(project);
    deps.upsertProject(project);
    return c.json(await deps.refreshProjectGitStatus(project));
  });

  app.get("/api/projects/:id/changes", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    try {
      return c.json(await deps.collectWorkspaceChangesForCwd(deps.resolveTerminalCwd(project.workspacePath)));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "project_changes_failed" }, 400);
    }
  });

  app.post("/api/projects/:id/changes/revert-file", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const body = await c.req.json<RevertWorkspaceFileRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "path_required" }, 400);
    const cwd = deps.resolveTerminalCwd(project.workspacePath);
    const changes = await deps.collectWorkspaceChangesForCwd(cwd);
    try {
      const { change, absolutePath } = deps.assertWorkspaceChangePath(changes, body.path);
      if (change.status === "??") {
        const stat = statSync(absolutePath);
        if (!stat.isFile()) return c.json({ error: "untracked_directories_not_supported" }, 400);
        rmSync(absolutePath);
      } else {
        const result = await deps.runGitCommand(cwd, ["checkout", "--", body.path]);
        if (result.exitCode !== 0) return c.json({ error: result.stderr || "git_checkout_failed" }, 400);
      }
      return c.json(await deps.collectWorkspaceChangesForCwd(cwd));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "revert_failed" }, 400);
    }
  });

  app.post("/api/projects/:id/changes/stage-file", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "path_required" }, 400);
    try {
      return c.json(await deps.applyWorkspaceGitFileAction(deps.resolveTerminalCwd(project.workspacePath), body.path, "stage"));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "git_stage_failed" }, 400);
    }
  });

  app.post("/api/projects/:id/changes/unstage-file", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const body = await c.req.json<WorkspaceGitFileRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "path_required" }, 400);
    try {
      return c.json(await deps.applyWorkspaceGitFileAction(deps.resolveTerminalCwd(project.workspacePath), body.path, "unstage"));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "git_unstage_failed" }, 400);
    }
  });

  app.get("/api/projects/:id/check-runs", (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    return c.json(deps.listProjectCheckRuns(project.id, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor")));
  });

  app.get("/api/projects/:id/git-operations", (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    return c.json(deps.listProjectGitOperations(project.id, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor")));
  });

  app.post("/api/projects/:id/git", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const body = await c.req.json<ProjectGitOperationRequest>().catch(() => null);
    if (!body?.operation) return c.json({ error: "git_operation_required" }, 400);
    try {
      const args = deps.projectGitArgs(body);
      const changes = await deps.collectWorkspaceChangesForCwd(deps.resolveTerminalCwd(project.workspacePath)).catch(() => null);
      const dirty = Boolean(changes?.summary.filesChanged);
      const needsApproval = body.operation === "push" || ((body.operation === "pull" || body.operation === "branch-checkout") && dirty);
      if (needsApproval && !deps.approvalAlwaysAllowed("project-git-operation", { projectId: project.id, operation: body.operation })) {
        const reason = body.operation === "push" ? "push changes to remote" : "workspace has uncommitted changes";
        const approval = deps.createProjectGitApproval(project, body.operation, args, reason);
        deps.saveProjectGitOperation(project.id, body.operation, args, { exitCode: null, stdout: "", stderr: `approval:${approval.id}` }, "approval_required");
        return c.json({ error: "approval_required", approval: deps.publicApproval(approval) }, 409);
      }
      const record = deps.runProjectGitOperation(project, body.operation, args);
      await deps.refreshProjectGitStatus(project);
      return c.json(record, record.status === "done" ? 200 : 400);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "project_git_failed" }, 400);
    }
  });

  app.get("/api/projects/:id/sessions", (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const limit = parsePageLimit(c.req.query("limit"), 20);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const status = c.req.query("status");
    const filtered = deps.appData.sessions
      .filter((session: any) => session.projectId === project.id)
      .filter((session: any) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
      .filter((session: any) => !status || session.status === status)
      .filter((session: any) => !cursor || session.updatedAt < cursor.sortValue || (session.updatedAt === cursor.sortValue && session.id < cursor.id))
      .sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return c.json(pageFromRows(filtered, limit, (item: any) => item.updatedAt));
  });

  app.get("/api/projects/:id/stats", (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const projectSessions = deps.appData.sessions.filter((session: any) => session.projectId === project.id);
    const latestCheck = deps.listProjectCheckRuns(project.id, 1).items[0];
    const previewStatusCounts = Array.from(deps.getPreviews().values())
      .filter((preview: any) => preview.scopeType === "project" && preview.scopeId === project.id)
      .reduce<Record<string, number>>((counts, preview: any) => {
        counts[preview.status] = (counts[preview.status] ?? 0) + 1;
        return counts;
      }, {});
    const response: ProjectStatsSummary = {
      projectId: project.id,
      totalSessions: projectSessions.length,
      runningSessions: projectSessions.filter((session: any) => session.status === "running").length,
      latestSessionUpdatedAt: projectSessions.map((session: any) => session.updatedAt).sort().at(-1) ?? null,
      latestCheckStatus: latestCheck?.status ?? null,
      previewStatusCounts,
    };
    return c.json(response);
  });

  app.post("/api/projects/:id/check", async (c) => {
    const project = deps.appData.projects.find((item: ProjectSummary) => item.id === c.req.param("id"));
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const body = await c.req.json<{ command?: string }>().catch(() => null);
    const command = body?.command?.trim() || deps.splitProjectCheckCommands(project.checkCommand)[0];
    if (!command) return c.json({ error: "check_command_missing" }, 400);
    try {
      const startedAt = new Date().toISOString();
      const result = await deps.runShellCommand(command, deps.resolveTerminalCwd(project.workspacePath));
      deps.saveProjectCheckRun(project.id, result, startedAt);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "project_check_failed" }, 400);
    }
  });

  app.delete("/api/projects/:id", async (c) => {
    const index = deps.appData.projects.findIndex((item: ProjectSummary) => item.id === c.req.param("id"));
    if (index === -1) return c.json({ error: "project_not_found" }, 404);

    const deleteFiles = c.req.query("deleteFiles") === "true";
    const project = deps.appData.projects[index];
    if (deleteFiles) {
      if (deps.approvalAlwaysAllowed("project-delete-files", { projectId: project.id, deleteFiles: true })) {
        return c.json(deps.deleteProjectRecord(project.id, true));
      }
      const approval = deps.createProjectDeleteApproval(project);
      return c.json({ error: "approval_required", approval: deps.publicApproval(approval) }, 409);
    }

    return c.json(deps.deleteProjectRecord(project.id, false));
  });
}
