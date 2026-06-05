import type { Hono } from "hono";
import { basename } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  CreateAgentCircleRequest,
  CreateAgentGroupRequest,
  CreateAgentRequest,
  CreateAgentRoleFromTemplateRequest,
  CreateAgentRoleRequest,
  CreateAgentSessionRequest,
  UpdateAgentCircleRequest,
  UpdateAgentGroupRequest,
  UpdateAgentRequest,
  UpdateAgentRoleRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows, parsePageLimit } from "../pagination.js";

type AgentRoutesDeps = Record<string, any>;

export function registerAgentRoleRoutes(app: Hono, deps: AgentRoutesDeps) {
  app.get("/api/agent-roles", (c) => c.json(deps.listAgentRoles(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));

  app.get("/api/agent-role-templates", (c) => c.json(deps.listAgentRoleTemplates().map(deps.publicAgentRoleTemplate)));

  app.post("/api/agent-roles", async (c) => {
    const body = await c.req.json<CreateAgentRoleRequest>().catch(() => null);
    const markdownContent = body?.markdownContent?.trim() || body?.systemPrompt?.trim() || "";
    const description = body?.description?.trim() || deps.markdownDescription(markdownContent);
    const systemPrompt = deps.systemPromptWithRoleDescription(body?.systemPrompt?.trim() || markdownContent, description, Boolean(body?.includeDescriptionInPrompt));
    if (!body?.name?.trim() || !systemPrompt) return c.json({ error: "invalid_agent_role" }, 400);
    const now = new Date().toISOString();
    const idBase = deps.slugify(body.name);
    let id = idBase;
    let suffix = 2;
    while (deps.db.prepare("select id from agent_roles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
    deps.db.prepare(`
      insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name.trim(),
      description,
      deps.roleSourceType(body.sourceType),
      body.sourcePath?.trim() || null,
      body.sourceUrl?.trim() || null,
      markdownContent,
      systemPrompt,
      JSON.stringify(body.capabilities ?? []),
      deps.listenMode(body.defaultListenMode),
      JSON.stringify(body.defaultListenEvents ?? []),
      deps.workspaceMode(body.defaultWorkspaceMode),
      body.defaultSandboxMode ?? null,
      body.defaultApprovalPolicy ?? null,
      body.outputContract?.trim() || null,
      body.safetyNotes?.trim() || null,
      now,
      now,
    );
    return c.json(deps.agentRoleFromRow(deps.db.prepare("select * from agent_roles where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.post("/api/agent-roles/from-template", async (c) => {
    const body = await c.req.json<CreateAgentRoleFromTemplateRequest>().catch(() => null);
    if (!body?.templateId) return c.json({ error: "template_required" }, 400);
    const template = deps.listAgentRoleTemplates().find((item: any) => item.id === body.templateId);
    if (!template) return c.json({ error: "agent_role_template_not_found" }, 404);
    const now = new Date().toISOString();
    const roleName = body.name?.trim() || template.name;
    const description = body.description?.trim() || template.description;
    const systemPrompt = deps.systemPromptWithRoleDescription(template.markdownContent, description, Boolean(body.includeDescriptionInPrompt));
    const idBase = deps.slugify(roleName);
    let id = idBase;
    let suffix = 2;
    while (deps.db.prepare("select id from agent_roles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
    deps.db.prepare(`
      insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
      values (?, ?, ?, 'builtin-template', ?, ?, ?, ?, '[]', 'passive', '[]', 'isolated-worktree-with-shared-room', null, null, null, null, ?, ?)
    `).run(id, roleName, description, template.sourcePath, template.sourceUrl ?? null, template.markdownContent, systemPrompt, now, now);
    return c.json(deps.agentRoleFromRow(deps.db.prepare("select * from agent_roles where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.post("/api/agent-roles/import-file", async (c) => {
    const body = await c.req.json<{ path?: string; name?: string }>().catch(() => null);
    if (!body?.path?.trim()) return c.json({ error: "path_required" }, 400);
    try {
      const absolutePath = deps.resolveTerminalCwd(body.path);
      const stat = statSync(absolutePath);
      if (!stat.isFile() || stat.size > 1024 * 1024) return c.json({ error: "invalid_role_file" }, 400);
      const markdownContent = readFileSync(absolutePath, "utf8");
      const name = body.name?.trim() || deps.markdownTitle(markdownContent) || basename(absolutePath).replace(/\.(md|markdown)$/i, "");
      const request: CreateAgentRoleRequest = {
        name,
        description: deps.markdownDescription(markdownContent),
        sourceType: "file-import",
        sourcePath: absolutePath,
        markdownContent,
        systemPrompt: markdownContent,
      };
      const now = new Date().toISOString();
      const idBase = deps.slugify(request.name);
      let id = idBase;
      let suffix = 2;
      while (deps.db.prepare("select id from agent_roles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
      deps.db.prepare(`
        insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
        values (?, ?, ?, 'file-import', ?, null, ?, ?, '[]', 'passive', '[]', 'isolated-worktree-with-shared-room', null, null, null, null, ?, ?)
      `).run(id, request.name, request.description ?? "", absolutePath, markdownContent, markdownContent, now, now);
      return c.json(deps.agentRoleFromRow(deps.db.prepare("select * from agent_roles where id = ?").get(id) as Record<string, unknown>), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "role_import_failed" }, 400);
    }
  });

  app.patch("/api/agent-roles/:id", async (c) => {
    const current = deps.db.prepare("select * from agent_roles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "agent_role_not_found" }, 404);
    const body = await c.req.json<UpdateAgentRoleRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_agent_role_update" }, 400);
    const next = deps.agentRoleFromRow(current);
    const markdownContent = body.markdownContent?.trim() || next.markdownContent;
    const description = body.description !== undefined ? body.description?.trim() || null : next.description;
    const systemPrompt = deps.systemPromptWithRoleDescription(body.systemPrompt?.trim() || markdownContent || next.systemPrompt, description, Boolean(body.includeDescriptionInPrompt));
    deps.db.prepare(`
      update agent_roles set name = ?, description = ?, source_type = ?, source_path = ?, source_url = ?, markdown_content = ?, system_prompt = ?, capabilities = ?, default_listen_mode = ?, default_listen_events = ?, default_workspace_mode = ?, default_sandbox_mode = ?, default_approval_policy = ?, output_contract = ?, safety_notes = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || next.name,
      description,
      deps.roleSourceType(body.sourceType ?? next.sourceType),
      body.sourcePath !== undefined ? body.sourcePath?.trim() || null : next.sourcePath ?? null,
      body.sourceUrl !== undefined ? body.sourceUrl?.trim() || null : next.sourceUrl ?? null,
      markdownContent,
      systemPrompt,
      JSON.stringify(body.capabilities ?? next.capabilities),
      deps.listenMode(body.defaultListenMode, next.defaultListenMode),
      JSON.stringify(body.defaultListenEvents ?? next.defaultListenEvents),
      deps.workspaceMode(body.defaultWorkspaceMode, next.defaultWorkspaceMode),
      body.defaultSandboxMode !== undefined ? body.defaultSandboxMode : next.defaultSandboxMode ?? null,
      body.defaultApprovalPolicy !== undefined ? body.defaultApprovalPolicy : next.defaultApprovalPolicy ?? null,
      body.outputContract !== undefined ? body.outputContract?.trim() || null : next.outputContract ?? null,
      body.safetyNotes !== undefined ? body.safetyNotes?.trim() || null : next.safetyNotes ?? null,
      new Date().toISOString(),
      next.id,
    );
    return c.json(deps.agentRoleFromRow(deps.db.prepare("select * from agent_roles where id = ?").get(next.id) as Record<string, unknown>));
  });

  app.delete("/api/agent-roles/:id", (c) => {
    const roleId = c.req.param("id");
    const agents = deps.db.prepare("select count(*) as count from agents where role_id = ?").get(roleId) as { count: number } | undefined;
    if (agents && agents.count > 0) return c.json({ error: "agent_role_in_use" }, 409);
    deps.db.prepare("delete from agent_roles where id = ?").run(roleId);
    return c.json({ ok: true, id: roleId });
  });
}

export function registerAgentRoutes(app: Hono, deps: AgentRoutesDeps) {
  app.get("/api/agents", (c) => c.json(deps.listAgents(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));

  app.get("/api/permission-profiles", (c) => c.json(Object.entries(deps.getPermissionProfiles()).map(([id, permissions]) => ({
    id,
    permissions: { ...deps.getDefaultAgentPermissions(), ...(permissions as Record<string, unknown>) },
  }))));

  app.post("/api/agents/batch", async (c) => {
    const body = await c.req.json<{ ids?: string[]; enabled?: boolean }>().catch(() => null);
    const ids = [...new Set((body?.ids ?? []).map(String))];
    if (!ids.length || typeof body?.enabled !== "boolean") return c.json({ error: "invalid_agent_batch" }, 400);
    const now = new Date().toISOString();
    const update = deps.db.prepare("update agents set enabled = ?, updated_at = ? where id = ?");
    for (const id of ids) update.run(body.enabled ? 1 : 0, now, id);
    return c.json({ ok: true, ids, enabled: body.enabled });
  });

  app.get("/api/agents/:id/sessions", (c) => {
    const agentId = c.req.param("id");
    if (!deps.db.prepare("select id from agents where id = ?").get(agentId)) return c.json({ error: "agent_not_found" }, 404);
    const limit = parsePageLimit(c.req.query("limit"), 20);
    const cursor = decodePageCursor(c.req.query("cursor"));
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const status = c.req.query("status");
    const projectId = c.req.query("projectId");
    const rows = deps.db.prepare(`
      select sessions.*
      from sessions
      inner join agent_sessions on agent_sessions.session_id = sessions.id
      where agent_sessions.agent_id = @agentId
        ${status ? "and sessions.status = @status" : ""}
        ${projectId ? "and coalesce(sessions.project_id, '') = @projectId" : ""}
        ${cursor ? "and (sessions.updated_at < @cursorSort or (sessions.updated_at = @cursorSort and sessions.id < @cursorId))" : ""}
      order by sessions.updated_at desc, sessions.id desc
    `).all({ agentId, status, projectId: projectId === "scratch" ? "" : projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id }) as Array<Record<string, unknown>>;
    const projects = deps.appData.projects;
    const filtered = rows.map((row) => deps.sessionFromRow(row, projects))
      .filter((session: any) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
      .slice(0, limit + 1);
    return c.json(pageFromRows(filtered, limit, (item: any) => item.updatedAt));
  });

  app.get("/api/agents/:id/stats", (c) => {
    const agentId = c.req.param("id");
    if (!deps.db.prepare("select id from agents where id = ?").get(agentId)) return c.json({ error: "agent_not_found" }, 404);
    const runs = deps.db.prepare("select status, started_at, finished_at from agent_runs where agent_id = ?").all(agentId) as Array<{ status: string; started_at: string; finished_at?: string | null }>;
    const directSessions = deps.db.prepare("select count(*) as count from agent_sessions where agent_id = ?").get(agentId) as { count: number } | undefined;
    const completed = runs.filter((run) => run.finished_at);
    const durations = completed.map((run) => new Date(run.finished_at ?? run.started_at).getTime() - new Date(run.started_at).getTime()).filter((value) => Number.isFinite(value) && value >= 0);
    return c.json({
      agentId,
      totalRuns: runs.length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      successfulRuns: runs.filter((run) => run.status === "done").length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
      directSessions: directSessions?.count ?? 0,
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      latestRunAt: runs.map((run) => run.started_at).sort().at(-1) ?? null,
    });
  });

  app.post("/api/agents", async (c) => {
    const body = await c.req.json<CreateAgentRequest>().catch(() => null);
    if (!body?.name?.trim() || !body.roleId || !deps.db.prepare("select id from agent_roles where id = ?").get(body.roleId)) return c.json({ error: "invalid_agent" }, 400);
    const role = deps.agentRoleFromRow(deps.db.prepare("select * from agent_roles where id = ?").get(body.roleId) as Record<string, unknown>);
    const now = new Date().toISOString();
    const id = `agent-${randomUUID()}`;
    const accessMode = deps.projectAccessMode(body.projectAccessMode);
    const allowedProjectIds = deps.normalizeProjectIds(body.allowedProjectIds);
    const favoriteProjectIds = deps.normalizeProjectIds(body.favoriteProjectIds);
    const defaultProjectId = body.defaultProjectId && deps.agentCanAccessProject({
      ...deps.agentFromRow({
        id,
        name: body.name.trim(),
        role_id: body.roleId,
        workspace_mode: body.workspaceMode ?? role.defaultWorkspaceMode,
        permissions: "{}",
        max_concurrent_runs: 1,
        enabled: 1,
        created_at: now,
        updated_at: now,
        project_access_mode: accessMode,
        allowed_project_ids: JSON.stringify(allowedProjectIds),
        favorite_project_ids: JSON.stringify(favoriteProjectIds),
      }),
      projectAccessMode: accessMode,
      allowedProjectIds,
    }, body.defaultProjectId) ? body.defaultProjectId : null;
    deps.db.prepare(`
      insert into agents (id, name, role_id, description, extra_prompt, provider_id, model, listen_mode, listen_events, workspace_mode, default_project_id, favorite_project_ids, project_access_mode, allowed_project_ids, permission_profile_id, permissions, max_concurrent_runs, enabled, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name.trim(),
      body.roleId,
      body.description?.trim() || null,
      body.extraPrompt?.trim() || null,
      body.providerId || null,
      body.model?.trim() || null,
      role.defaultListenMode,
      JSON.stringify(role.defaultListenEvents),
      deps.workspaceMode(body.workspaceMode, role.defaultWorkspaceMode),
      defaultProjectId,
      JSON.stringify(favoriteProjectIds),
      accessMode,
      JSON.stringify(allowedProjectIds),
      deps.permissionProfileId(body.permissionProfileId),
      JSON.stringify(deps.agentPermissions({}, body.permissions)),
      Math.max(1, Math.min(10, Number(body.maxConcurrentRuns ?? 1) || 1)),
      body.enabled === false ? 0 : 1,
      now,
      now,
    );
    return c.json(deps.agentFromRow(deps.db.prepare("select * from agents where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.post("/api/agents/:id/sessions", async (c) => {
    const agentRow = deps.db.prepare("select * from agents where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!agentRow) return c.json({ error: "agent_not_found" }, 404);
    const agent = deps.agentFromRow(agentRow);
    if (!agent.enabled) return c.json({ error: "agent_disabled" }, 400);
    const body = await c.req.json<CreateAgentSessionRequest>().catch(() => null);
    let project = null;
    try {
      project = deps.resolveAgentProject(agent, body?.projectId);
    } catch {
      return c.json({ error: "agent_project_access_denied" }, 403);
    }
    const provider = agent.providerId ? deps.appData.providers.find((item: any) => item.id === agent.providerId) : deps.appData.providers[0];
    const now = new Date().toISOString();
    const id = `task-${randomUUID()}`;
    const session = {
      id,
      kind: project ? "project" : "scratch",
      conversationType: "agent",
      roomId: null,
      directAgentId: agent.id,
      title: agent.name,
      projectId: project?.id ?? null,
      workspacePath: project?.workspacePath ? deps.resolveTerminalCwd(project.workspacePath) : deps.ensureScratchSessionWorkspace(id),
      providerId: provider?.id ?? null,
      model: agent.model ?? provider?.defaultModel ?? null,
      status: "paused",
      createdAt: now,
      updatedAt: now,
    };
    deps.appData.sessions.unshift(session);
    deps.upsertSession(session);
    deps.db.prepare("insert into agent_sessions (session_id, agent_id, created_at) values (?, ?, ?)").run(session.id, agent.id, now);
    return c.json(session, 201);
  });

  app.patch("/api/agents/:id", async (c) => {
    const current = deps.db.prepare("select * from agents where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "agent_not_found" }, 404);
    const body = await c.req.json<UpdateAgentRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_agent_update" }, 400);
    const next = deps.agentFromRow(current);
    const roleId = body.roleId ?? next.roleId;
    if (!deps.db.prepare("select id from agent_roles where id = ?").get(roleId)) return c.json({ error: "agent_role_not_found" }, 404);
    const currentListenMode = deps.listenMode(current.listen_mode);
    const currentListenEvents = deps.jsonArray(current.listen_events);
    const accessMode = deps.projectAccessMode(body.projectAccessMode ?? next.projectAccessMode);
    const allowedProjectIds = deps.normalizeProjectIds(body.allowedProjectIds ?? next.allowedProjectIds);
    const favoriteProjectIds = deps.normalizeProjectIds(body.favoriteProjectIds ?? next.favoriteProjectIds);
    const requestedDefaultProjectId = body.defaultProjectId !== undefined ? body.defaultProjectId : next.defaultProjectId;
    const defaultProjectId = requestedDefaultProjectId && (accessMode === "all" || (accessMode === "selected" && allowedProjectIds.includes(requestedDefaultProjectId))) ? requestedDefaultProjectId : null;
    deps.db.prepare(`
      update agents set name = ?, role_id = ?, description = ?, extra_prompt = ?, provider_id = ?, model = ?, listen_mode = ?, listen_events = ?, workspace_mode = ?, default_project_id = ?, favorite_project_ids = ?, project_access_mode = ?, allowed_project_ids = ?, permission_profile_id = ?, permissions = ?, max_concurrent_runs = ?, enabled = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || next.name,
      roleId,
      body.description !== undefined ? body.description?.trim() || null : next.description ?? null,
      body.extraPrompt !== undefined ? body.extraPrompt?.trim() || null : next.extraPrompt ?? null,
      body.providerId !== undefined ? body.providerId || null : next.providerId ?? null,
      body.model !== undefined ? body.model?.trim() || null : next.model ?? null,
      currentListenMode,
      JSON.stringify(currentListenEvents),
      deps.workspaceMode(body.workspaceMode, next.workspaceMode),
      defaultProjectId,
      JSON.stringify(favoriteProjectIds),
      accessMode,
      JSON.stringify(allowedProjectIds),
      body.permissionProfileId !== undefined ? deps.permissionProfileId(body.permissionProfileId) : next.permissionProfileId ?? null,
      JSON.stringify(deps.agentPermissions(next.permissions, body.permissions)),
      Math.max(1, Math.min(10, Number(body.maxConcurrentRuns ?? next.maxConcurrentRuns) || 1)),
      body.enabled !== undefined ? body.enabled ? 1 : 0 : next.enabled ? 1 : 0,
      new Date().toISOString(),
      next.id,
    );
    return c.json(deps.agentFromRow(deps.db.prepare("select * from agents where id = ?").get(next.id) as Record<string, unknown>));
  });

  app.delete("/api/agents/:id", (c) => {
    const agentId = c.req.param("id");
    deps.db.prepare("delete from agent_group_members where agent_id = ?").run(agentId);
    deps.db.prepare("delete from room_agent_threads where agent_id = ?").run(agentId);
    deps.db.prepare("delete from agents where id = ?").run(agentId);
    return c.json({ ok: true, id: agentId });
  });
}

export function registerAgentGroupRoutes(app: Hono, deps: AgentRoutesDeps) {
  app.get("/api/agent-groups", (c) => c.json(deps.listAgentGroups(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor"))));

  app.post("/api/agent-groups", async (c) => {
    const body = await c.req.json<CreateAgentGroupRequest>().catch(() => null);
    if (!body?.name?.trim()) return c.json({ error: "invalid_agent_group" }, 400);
    const now = new Date().toISOString();
    const id = `group-${randomUUID()}`;
    deps.db.prepare(`
      insert into agent_groups (id, name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name.trim(),
      body.description?.trim() || null,
      body.collaborationRules?.trim() || "orchestrator-routed",
      body.eventRoutingRules?.trim() || "orchestrator listens to room events and assigns agents explicitly",
      Math.max(1, Math.min(20, Number(body.maxConcurrentAgents ?? 3) || 3)),
      body.approvalPolicy?.trim() || "approval-required-for-risk",
      body.mergeStrategy?.trim() || "isolated-worktree-review-then-approve",
      now,
      now,
    );
    deps.replaceGroupMembers(id, body.agentIds ?? [], body.memberListenModes ?? {});
    return c.json(deps.agentGroupFromRow(deps.db.prepare("select * from agent_groups where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/agent-groups/:id", async (c) => {
    const current = deps.db.prepare("select * from agent_groups where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "agent_group_not_found" }, 404);
    const body = await c.req.json<UpdateAgentGroupRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_agent_group_update" }, 400);
    const next = deps.agentGroupFromRow(current);
    deps.db.prepare(`
      update agent_groups set name = ?, description = ?, collaboration_rules = ?, event_routing_rules = ?, max_concurrent_agents = ?, approval_policy = ?, merge_strategy = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || next.name,
      body.description !== undefined ? body.description?.trim() || null : next.description ?? null,
      body.collaborationRules?.trim() || next.collaborationRules,
      body.eventRoutingRules?.trim() || next.eventRoutingRules,
      Math.max(1, Math.min(20, Number(body.maxConcurrentAgents ?? next.maxConcurrentAgents) || 3)),
      body.approvalPolicy?.trim() || next.approvalPolicy,
      body.mergeStrategy?.trim() || next.mergeStrategy,
      new Date().toISOString(),
      next.id,
    );
    if (body.agentIds) deps.replaceGroupMembers(next.id, body.agentIds, body.memberListenModes ?? next.memberListenModes ?? {});
    return c.json(deps.agentGroupFromRow(deps.db.prepare("select * from agent_groups where id = ?").get(next.id) as Record<string, unknown>));
  });

  app.delete("/api/agent-groups/:id", (c) => {
    const groupId = c.req.param("id");
    deps.db.prepare("delete from agent_group_members where group_id = ?").run(groupId);
    deps.db.prepare("delete from agent_groups where id = ?").run(groupId);
    return c.json({ ok: true, id: groupId });
  });

  app.get("/api/agent-groups/:id/rooms", (c) => listAgentCollectionRooms(c, deps, "group"));
}

export function registerAgentCircleRoutes(app: Hono, deps: AgentRoutesDeps) {
  app.get("/api/agent-circles", (c) => {
    if (c.req.query("limit") || c.req.query("cursor")) return c.json(deps.listAgentCircles(parsePageLimit(c.req.query("limit"), 50), c.req.query("cursor")));
    const rows = deps.db.prepare("select * from agent_circles order by builtin desc, name asc").all() as Array<Record<string, unknown>>;
    return c.json(rows.map(deps.agentCircleFromRow));
  });

  app.get("/api/agent-circles/:id/rooms", (c) => listAgentCollectionRooms(c, deps, "circle"));

  app.post("/api/agent-circles", async (c) => {
    const body = await c.req.json<CreateAgentCircleRequest>().catch(() => null);
    if (!body?.name?.trim()) return c.json({ error: "invalid_agent_circle" }, 400);
    const roleIds = [...new Set(body.roleIds ?? [])].filter((roleId) => deps.db.prepare("select id from agent_roles where id = ?").get(roleId));
    const now = new Date().toISOString();
    const idBase = `circle-${deps.slugify(body.name)}`;
    let id = idBase;
    let suffix = 2;
    while (deps.db.prepare("select id from agent_circles where id = ?").get(id)) id = `${idBase}-${suffix++}`;
    deps.db.prepare(`
      insert into agent_circles (id, name, description, group_template_id, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, builtin, created_at, updated_at)
      values (?, ?, ?, null, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      body.name.trim(),
      body.description?.trim() || null,
      body.collaborationRules?.trim() || "",
      body.eventRoutingRules?.trim() || "",
      Math.max(1, Math.min(10, Number(body.maxConcurrentAgents ?? 3) || 3)),
      body.approvalPolicy?.trim() || "bounded",
      body.mergeStrategy?.trim() || "approval-required",
      now,
      now,
    );
    const insertRole = deps.db.prepare("insert or ignore into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)");
    roleIds.forEach((roleId, index) => insertRole.run(id, roleId, index));
    return c.json(deps.agentCircleFromRow(deps.db.prepare("select * from agent_circles where id = ?").get(id) as Record<string, unknown>), 201);
  });

  app.patch("/api/agent-circles/:id", async (c) => {
    const current = deps.db.prepare("select * from agent_circles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: "agent_circle_not_found" }, 404);
    if (Number(current.builtin) === 1) return c.json({ error: "builtin_circle_locked" }, 409);
    const body = await c.req.json<UpdateAgentCircleRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_agent_circle_update" }, 400);
    const next = deps.agentCircleFromRow(current);
    deps.db.prepare(`
      update agent_circles set name = ?, description = ?, collaboration_rules = ?, event_routing_rules = ?, max_concurrent_agents = ?, approval_policy = ?, merge_strategy = ?, updated_at = ?
      where id = ?
    `).run(
      body.name?.trim() || next.name,
      body.description !== undefined ? body.description?.trim() || null : next.description ?? null,
      body.collaborationRules?.trim() || next.collaborationRules,
      body.eventRoutingRules?.trim() || next.eventRoutingRules,
      Math.max(1, Math.min(10, Number(body.maxConcurrentAgents ?? next.maxConcurrentAgents) || 3)),
      body.approvalPolicy?.trim() || next.approvalPolicy,
      body.mergeStrategy?.trim() || next.mergeStrategy,
      new Date().toISOString(),
      next.id,
    );
    if (body.roleIds) {
      deps.db.prepare("delete from agent_circle_roles where circle_id = ?").run(next.id);
      const insertRole = deps.db.prepare("insert or ignore into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)");
      [...new Set(body.roleIds)].filter((roleId) => deps.db.prepare("select id from agent_roles where id = ?").get(roleId)).forEach((roleId, index) => insertRole.run(next.id, roleId, index));
    }
    return c.json(deps.agentCircleFromRow(deps.db.prepare("select * from agent_circles where id = ?").get(next.id) as Record<string, unknown>));
  });

  app.post("/api/agent-circles/:id/groups", async (c) => {
    const circleRow = deps.db.prepare("select * from agent_circles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!circleRow) return c.json({ error: "agent_circle_not_found" }, 404);
    const circle = deps.agentCircleFromRow(circleRow);
    try {
      return c.json(deps.createAgentGroupFromCircle(circle), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "agent_circle_group_create_failed" }, 400);
    }
  });

  app.delete("/api/agent-circles/:id", (c) => {
    const circle = deps.db.prepare("select * from agent_circles where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!circle) return c.json({ error: "agent_circle_not_found" }, 404);
    if (Number(circle.builtin) === 1) return c.json({ error: "builtin_circle_locked" }, 409);
    deps.db.prepare("delete from agent_circle_roles where circle_id = ?").run(c.req.param("id"));
    deps.db.prepare("delete from agent_circles where id = ?").run(c.req.param("id"));
    return c.json({ ok: true, id: c.req.param("id") });
  });
}

function listAgentCollectionRooms(c: any, deps: AgentRoutesDeps, kind: "group" | "circle") {
  const id = c.req.param("id");
  const table = kind === "group" ? "agent_groups" : "agent_circles";
  const column = kind === "group" ? "group_id" : "circle_id";
  const error = kind === "group" ? "agent_group_not_found" : "agent_circle_not_found";
  if (!deps.db.prepare(`select id from ${table} where id = ?`).get(id)) return c.json({ error }, 404);
  const limit = parsePageLimit(c.req.query("limit"), 20);
  const cursor = decodePageCursor(c.req.query("cursor"));
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const rows = deps.db.prepare(`
    select sessions.*
    from rooms
    inner join sessions on sessions.id = rooms.session_id
    where rooms.${column} = @id
      ${status ? "and sessions.status = @status" : ""}
      ${projectId ? "and coalesce(sessions.project_id, '') = @projectId" : ""}
      ${cursor ? "and (sessions.updated_at < @cursorSort or (sessions.updated_at = @cursorSort and sessions.id < @cursorId))" : ""}
    order by sessions.updated_at desc, sessions.id desc
  `).all({ id, status, projectId: projectId === "scratch" ? "" : projectId, cursorSort: cursor?.sortValue, cursorId: cursor?.id }) as Array<Record<string, unknown>>;
  const filtered = rows.map((row) => deps.sessionFromRow(row, deps.appData.projects))
    .filter((session: any) => !q || session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q) || session.workspacePath.toLowerCase().includes(q))
    .slice(0, limit + 1);
  return c.json(pageFromRows(filtered, limit, (item: any) => item.updatedAt));
}
