import React, { useEffect, useState } from "react";
import { Activity, ChevronDown, Copy, FilePlus2, FolderGit2, History, Info, MessageSquare, MoreHorizontal, PanelLeftOpen, Pencil, Plus, RefreshCw, Trash2, Users, X } from "lucide-react";
import type {
  AgentCircleSummary,
  AgentGroupSummary,
  AgentListenMode,
  AgentProjectAccessMode,
  AgentRoleSummary,
  AgentRoleTemplateSummary,
  AgentSummary,
  PageResponse,
  PermissionProfileId,
  ProjectSummary,
  ProviderSummary,
  RoomSummary,
  SessionSummary,
} from "@codex-web/protocol";
import { Button } from "@/components/ui/button";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copyText } from "@/lib/clipboard";
import { formatShortDate, prettyJson } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { fetchContactsOverview, fetchContactsPage, fetchProviderModelsForContact } from "@/features/contacts/api";
import type { ContactPageKind, ContactTab } from "@/features/contacts/types";
import { listenModeOptions, projectDisplayName, readableAgentWorkspaceMode, readableListenMode, readablePermissionProfile, readableStatus, type TFunction } from "@/features/sessions/utils";

type ToastTone = "info" | "success" | "error";

export function ContactsPage({ sessionToken, t, locale, notify, providers, projects, onOpenSession, onOpenMainNav }: { sessionToken: string; t: TFunction; locale: Locale; notify: (message: string, tone?: ToastTone) => void; providers: ProviderSummary[]; projects: ProjectSummary[]; onOpenSession: (sessionId: string) => void; onOpenMainNav?: () => void }) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [groups, setGroups] = useState<AgentGroupSummary[]>([]);
  const [roles, setRoles] = useState<AgentRoleSummary[]>([]);
  const [roleTemplates, setRoleTemplates] = useState<AgentRoleTemplateSummary[]>([]);
  const [circles, setCircles] = useState<AgentCircleSummary[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<Array<{ id: string; permissions: unknown }>>([]);
  const [loading, setLoading] = useState(false);
  const [contactTab, setContactTab] = useState<ContactTab>("agents");
  const [contactSearch, setContactSearch] = useState("");
  const [contactCreatePanelOpen, setContactCreatePanelOpen] = useState(false);
  const [detailContact, setDetailContact] = useState<
    | { kind: "agent"; item: AgentSummary }
    | { kind: "group"; item: AgentGroupSummary }
    | { kind: "role"; item: AgentRoleSummary }
    | { kind: "circle"; item: AgentCircleSummary }
    | null
  >(null);
  const [agentSessionsPanel, setAgentSessionsPanel] = useState<{ agent: AgentSummary; sessions: SessionSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [contactSessionFilter, setContactSessionFilter] = useState({ q: "", status: "", projectId: "" });
  const [roomSessionsPanel, setRoomSessionsPanel] = useState<{ kind: "group" | "circle"; id: string; name: string; sessions: SessionSummary[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [agentSessionDialog, setAgentSessionDialog] = useState<{ agent: AgentSummary; projectId: string } | null>(null);
  const [roomSessionDialog, setRoomSessionDialog] = useState<{ kind: "group" | "circle"; id: string; name: string; projectId: string } | null>(null);
  const [agentStatsPanel, setAgentStatsPanel] = useState<{ agent: AgentSummary; stats: unknown | null } | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleDescriptionInPrompt, setRoleDescriptionInPrompt] = useState(false);
  const [rolePrompt, setRolePrompt] = useState("");
  const [roleSourceType, setRoleSourceType] = useState<"builtin-template" | "custom-markdown" | "file-import">("builtin-template");
  const [roleSourcePath, setRoleSourcePath] = useState("");
  const [roleTemplateId, setRoleTemplateId] = useState("");
  const [editingRoleId, setEditingRoleId] = useState("");
  const [editingRoleName, setEditingRoleName] = useState("");
  const [editingRoleDescription, setEditingRoleDescription] = useState("");
  const [editingRolePrompt, setEditingRolePrompt] = useState("");
  const [editingRoleDescriptionInPrompt, setEditingRoleDescriptionInPrompt] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentRoleId, setAgentRoleId] = useState("");
  const [agentProviderId, setAgentProviderId] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [agentCustomModel, setAgentCustomModel] = useState(false);
  const [discoveringAgentModels, setDiscoveringAgentModels] = useState(false);
  const [agentDescription, setAgentDescription] = useState("");
  const [agentExtraPrompt, setAgentExtraPrompt] = useState("");
  const [agentDefaultProjectId, setAgentDefaultProjectId] = useState("");
  const [agentProjectAccessMode, setAgentProjectAccessMode] = useState<AgentProjectAccessMode>("all");
  const [agentAllowedProjectIds, setAgentAllowedProjectIds] = useState<string[]>([]);
  const [agentFavoriteProjectIds, setAgentFavoriteProjectIds] = useState<string[]>([]);
  const [agentPermissionProfileId, setAgentPermissionProfileId] = useState<PermissionProfileId>("developer");
  const [editingAgentId, setEditingAgentId] = useState("");
  const [editingAgentName, setEditingAgentName] = useState("");
  const [editingAgentRoleId, setEditingAgentRoleId] = useState("");
  const [editingAgentProviderId, setEditingAgentProviderId] = useState("");
  const [editingAgentModel, setEditingAgentModel] = useState("");
  const [editingAgentModels, setEditingAgentModels] = useState<string[]>([]);
  const [editingAgentCustomModel, setEditingAgentCustomModel] = useState(false);
  const [discoveringEditingAgentModels, setDiscoveringEditingAgentModels] = useState(false);
  const [editingAgentDescription, setEditingAgentDescription] = useState("");
  const [editingAgentExtraPrompt, setEditingAgentExtraPrompt] = useState("");
  const [editingAgentWorkspaceMode, setEditingAgentWorkspaceMode] = useState<AgentSummary["workspaceMode"]>("isolated-worktree-with-shared-room");
  const [editingAgentEnabled, setEditingAgentEnabled] = useState(true);
  const [editingAgentDefaultProjectId, setEditingAgentDefaultProjectId] = useState("");
  const [editingAgentProjectAccessMode, setEditingAgentProjectAccessMode] = useState<AgentProjectAccessMode>("all");
  const [editingAgentAllowedProjectIds, setEditingAgentAllowedProjectIds] = useState<string[]>([]);
  const [editingAgentFavoriteProjectIds, setEditingAgentFavoriteProjectIds] = useState<string[]>([]);
  const [editingAgentPermissionProfileId, setEditingAgentPermissionProfileId] = useState<PermissionProfileId>("developer");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupAgentIds, setGroupAgentIds] = useState<string[]>([]);
  const [groupMemberListenModes, setGroupMemberListenModes] = useState<Record<string, AgentListenMode>>({});
  const [editingGroupId, setEditingGroupId] = useState("");
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupDescription, setEditingGroupDescription] = useState("");
  const [editingGroupAgentIds, setEditingGroupAgentIds] = useState<string[]>([]);
  const [editingGroupMemberListenModes, setEditingGroupMemberListenModes] = useState<Record<string, AgentListenMode>>({});
  const [circleName, setCircleName] = useState("");
  const [circleDescription, setCircleDescription] = useState("");
  const [circleRoleIds, setCircleRoleIds] = useState<string[]>([]);
  const [circleRules, setCircleRules] = useState("");
  const [editingCircleId, setEditingCircleId] = useState("");
  const [editingCircleName, setEditingCircleName] = useState("");
  const [editingCircleDescription, setEditingCircleDescription] = useState("");
  const [editingCircleRoleIds, setEditingCircleRoleIds] = useState<string[]>([]);
  const [editingCircleRules, setEditingCircleRules] = useState("");
  const [contactPages, setContactPages] = useState({
    agents: { cursor: null as string | null, hasMore: false },
    groups: { cursor: null as string | null, hasMore: false },
    roles: { cursor: null as string | null, hasMore: false },
    circles: { cursor: null as string | null, hasMore: false },
  });

  async function loadContacts() {
    setLoading(true);
    try {
      const { agentsPage, groupsPage, rolesPage, templatesList, circlesPage, profilesList } = await fetchContactsOverview(sessionToken);
      setAgents(agentsPage.items ?? []);
      setGroups(groupsPage.items ?? []);
      setRoles(rolesPage.items ?? []);
      setContactPages({
        agents: { cursor: agentsPage.nextCursor, hasMore: agentsPage.hasMore },
        groups: { cursor: groupsPage.nextCursor, hasMore: groupsPage.hasMore },
        roles: { cursor: rolesPage.nextCursor, hasMore: rolesPage.hasMore },
        circles: { cursor: circlesPage.nextCursor, hasMore: circlesPage.hasMore },
      });
      setRoleTemplates(Array.isArray(templatesList) ? templatesList : []);
      setCircles(circlesPage.items ?? []);
      setPermissionProfiles(Array.isArray(profilesList) ? profilesList : []);
    } catch {
      notify(t("contacts.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContacts();
  }, [sessionToken]);

  async function loadMoreContacts(kind: ContactPageKind) {
    const cursor = contactPages[kind].cursor;
    if (!cursor) return;
    try {
      const result = await fetchContactsPage(kind, cursor, sessionToken);
      const page = result.page;
      if (result.kind === "agents") {
        setAgents((current) => [...current, ...(page.items as AgentSummary[])]);
      } else if (result.kind === "groups") {
        setGroups((current) => [...current, ...(page.items as AgentGroupSummary[])]);
      } else if (result.kind === "circles") {
        setCircles((current) => [...current, ...(page.items as AgentCircleSummary[])]);
      } else {
        setRoles((current) => [...current, ...(page.items as AgentRoleSummary[])]);
      }
      setContactPages((current) => ({ ...current, [result.kind]: { cursor: page.nextCursor, hasMore: page.hasMore } }));
    } catch {
      notify(t("contacts.loadFailed"), "error");
    }
  }

  useEffect(() => {
    if (!agentRoleId && roles[0]) setAgentRoleId(roles[0].id);
  }, [agentRoleId, roles]);

  useEffect(() => {
    if (!roleTemplateId && roleTemplates[0]) setRoleTemplateId(roleTemplates[0].id);
  }, [roleTemplateId, roleTemplates]);

  function templateName(template?: AgentRoleTemplateSummary) {
    return template?.localizedNames?.[locale]?.name || template?.localizedNames?.[locale.split("-")[0]]?.name || template?.name || "";
  }

  function templateDescription(template?: AgentRoleTemplateSummary) {
    return template?.localizedNames?.[locale]?.description || template?.localizedNames?.[locale.split("-")[0]]?.description || template?.description || "";
  }

  useEffect(() => {
    if (!agentProviderId && providers[0]) {
      setAgentProviderId(providers[0].id);
      setAgentModel(providers[0].defaultModel);
      setAgentModels(providers[0].defaultModel ? [providers[0].defaultModel] : []);
    }
  }, [agentProviderId, providers]);

  async function discoverAgentModels(providerId = agentProviderId, refresh = false) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      setAgentModels([]);
      return;
    }
    if (!refresh) {
      const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
      setAgentModels(models);
      if (!agentCustomModel && (!agentModel || !models.includes(agentModel))) setAgentModel(models[0] ?? provider.defaultModel ?? "");
      return;
    }
    setDiscoveringAgentModels(true);
    try {
      const result = await fetchProviderModelsForContact(sessionToken, provider.id);
      const models = result?.models?.length ? result.models : provider.defaultModel ? [provider.defaultModel] : [];
      setAgentModels(models);
      if (!agentCustomModel && (!agentModel || !models.includes(agentModel))) setAgentModel(models[0] ?? provider.defaultModel ?? "");
    } finally {
      setDiscoveringAgentModels(false);
    }
  }

  async function discoverEditingAgentModels(providerId = editingAgentProviderId, refresh = false) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      setEditingAgentModels(editingAgentModel ? [editingAgentModel] : []);
      return;
    }
    if (!refresh) {
      const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
      setEditingAgentModels(models);
      setEditingAgentCustomModel(Boolean(editingAgentModel && !models.includes(editingAgentModel)));
      if (!editingAgentModel && models[0]) setEditingAgentModel(models[0]);
      return;
    }
    setDiscoveringEditingAgentModels(true);
    try {
      const result = await fetchProviderModelsForContact(sessionToken, provider.id);
      const models = result?.models?.length ? result.models : provider.defaultModel ? [provider.defaultModel] : [];
      setEditingAgentModels(models);
      setEditingAgentCustomModel(Boolean(editingAgentModel && !models.includes(editingAgentModel)));
      if (!editingAgentModel && models[0]) setEditingAgentModel(models[0]);
    } finally {
      setDiscoveringEditingAgentModels(false);
    }
  }

  useEffect(() => {
    if (agentProviderId) void discoverAgentModels(agentProviderId);
  }, [agentProviderId, providers]);

  useEffect(() => {
    if (editingAgentId && editingAgentProviderId) void discoverEditingAgentModels(editingAgentProviderId);
  }, [editingAgentId, editingAgentProviderId, providers]);

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    const response = roleSourceType === "builtin-template" ? await fetch("/api/agent-roles/from-template", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        templateId: roleTemplateId,
        name: roleName || templateName(roleTemplates.find((template) => template.id === roleTemplateId)) || undefined,
        description: roleDescription || templateDescription(roleTemplates.find((template) => template.id === roleTemplateId)) || undefined,
        includeDescriptionInPrompt: roleDescriptionInPrompt,
      }),
    }) : roleSourceType === "file-import" ? await fetch("/api/agent-roles/import-file", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ path: roleSourcePath, name: roleName || undefined }),
    }) : await fetch("/api/agent-roles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: roleName, description: roleDescription, includeDescriptionInPrompt: roleDescriptionInPrompt, sourceType: "custom-markdown", markdownContent: rolePrompt, systemPrompt: rolePrompt }),
    });
    if (!response.ok) {
      notify(t("contacts.createRoleFailed"), "error");
      return;
    }
    setRoleName("");
    setRoleDescription("");
    setRoleDescriptionInPrompt(false);
    setRolePrompt("");
    setRoleSourcePath("");
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: agentName,
        roleId: agentRoleId,
        providerId: agentProviderId || null,
        model: agentModel || null,
        description: agentDescription,
        extraPrompt: agentExtraPrompt,
        defaultProjectId: agentDefaultProjectId || null,
        projectAccessMode: agentProjectAccessMode,
        allowedProjectIds: agentAllowedProjectIds,
        favoriteProjectIds: agentFavoriteProjectIds,
        permissionProfileId: agentPermissionProfileId,
      }),
    });
    if (!response.ok) {
      notify(t("contacts.createAgentFailed"), "error");
      return;
    }
    setAgentName("");
    setAgentDescription("");
    setAgentExtraPrompt("");
    setAgentDefaultProjectId("");
    setAgentAllowedProjectIds([]);
    setAgentFavoriteProjectIds([]);
    setAgentProjectAccessMode("all");
    setAgentPermissionProfileId("developer");
    setAgentModel(providers.find((provider) => provider.id === agentProviderId)?.defaultModel ?? "");
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  function startEditAgent(agent: AgentSummary) {
    const provider = providers.find((item) => item.id === agent.providerId);
    const models = provider?.models?.length ? provider.models : provider?.defaultModel ? [provider.defaultModel] : [];
    setEditingAgentId(agent.id);
    setEditingAgentName(agent.name);
    setEditingAgentRoleId(agent.roleId);
    setEditingAgentProviderId(agent.providerId ?? "");
    setEditingAgentModel(agent.model ?? "");
    setEditingAgentModels(models);
    setEditingAgentCustomModel(Boolean(agent.model && !models.includes(agent.model)));
    setEditingAgentDescription(agent.description ?? "");
    setEditingAgentExtraPrompt(agent.extraPrompt ?? "");
    setEditingAgentWorkspaceMode(agent.workspaceMode);
    setEditingAgentEnabled(agent.enabled);
    setEditingAgentDefaultProjectId(agent.defaultProjectId ?? "");
    setEditingAgentProjectAccessMode(agent.projectAccessMode);
    setEditingAgentAllowedProjectIds(agent.allowedProjectIds ?? []);
    setEditingAgentFavoriteProjectIds(agent.favoriteProjectIds ?? []);
    setEditingAgentPermissionProfileId(agent.permissionProfileId ?? "developer");
  }

  async function updateAgent(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agents/${editingAgentId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingAgentName,
        roleId: editingAgentRoleId,
        providerId: editingAgentProviderId || null,
        model: editingAgentModel || null,
        description: editingAgentDescription,
        extraPrompt: editingAgentExtraPrompt,
        workspaceMode: editingAgentWorkspaceMode,
        enabled: editingAgentEnabled,
        defaultProjectId: editingAgentDefaultProjectId || null,
        projectAccessMode: editingAgentProjectAccessMode,
        allowedProjectIds: editingAgentAllowedProjectIds,
        favoriteProjectIds: editingAgentFavoriteProjectIds,
        permissionProfileId: editingAgentPermissionProfileId,
      }),
    });
    if (!response.ok) {
      notify(t("contacts.updateAgentFailed"), "error");
      return;
    }
    setEditingAgentId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  function agentProjectOptions(agent: AgentSummary) {
    if (agent.projectAccessMode === "none") return [];
    if (agent.projectAccessMode === "selected") return projects.filter((project) => agent.allowedProjectIds.includes(project.id));
    return projects;
  }

  function openAgentSessionDialog(agent: AgentSummary) {
    const options = agentProjectOptions(agent);
    const defaultProjectId = agent.defaultProjectId && options.some((project) => project.id === agent.defaultProjectId) ? agent.defaultProjectId : "";
    setAgentSessionDialog({ agent, projectId: defaultProjectId });
  }

  async function startAgentSession(agent: AgentSummary, projectId?: string | null) {
    const response = await fetch(`/api/agents/${agent.id}/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: projectId === undefined ? agent.defaultProjectId ?? null : projectId || null }),
    });
    if (!response.ok) {
      notify(t("contacts.startAgentSessionFailed"), "error");
      return;
    }
    const session = (await response.json()) as SessionSummary;
    setAgentSessionDialog(null);
    onOpenSession(session.id);
    notify(t("contacts.agentSessionStarted"), "success");
  }

  async function openAgentSessions(agent: AgentSummary, older = false) {
    if (!older) setAgentSessionsPanel({ agent, sessions: null });
    const cursor = older && agentSessionsPanel?.agent.id === agent.id ? agentSessionsPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    if (contactSessionFilter.q.trim()) params.set("q", contactSessionFilter.q.trim());
    if (contactSessionFilter.status) params.set("status", contactSessionFilter.status);
    if (contactSessionFilter.projectId) params.set("projectId", contactSessionFilter.projectId);
    const response = await fetch(`/api/agents/${agent.id}/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("contacts.sessionsReadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<SessionSummary>;
    setAgentSessionsPanel((current) => ({
      agent,
      sessions: older && current?.agent.id === agent.id ? [...(current.sessions ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function continueLatestAgentSession(agent: AgentSummary) {
    const params = new URLSearchParams({ limit: "1" });
    const response = await fetch(`/api/agents/${agent.id}/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return notify(t("contacts.sessionsReadFailed"), "error");
    const page = (await response.json()) as PageResponse<SessionSummary>;
    if (page.items[0]) {
      onOpenSession(page.items[0].id);
      return;
    }
    await startAgentSession(agent);
  }

  async function openRoomSessions(kind: "group" | "circle", id: string, name: string, older = false) {
    if (!older) setRoomSessionsPanel({ kind, id, name, sessions: null });
    const current = older && roomSessionsPanel?.id === id ? roomSessionsPanel : null;
    const params = new URLSearchParams({ limit: "10" });
    if (current?.cursor) params.set("cursor", current.cursor);
    if (contactSessionFilter.q.trim()) params.set("q", contactSessionFilter.q.trim());
    if (contactSessionFilter.status) params.set("status", contactSessionFilter.status);
    if (contactSessionFilter.projectId) params.set("projectId", contactSessionFilter.projectId);
    const path = kind === "group" ? "agent-groups" : "agent-circles";
    const response = await fetch(`/api/${path}/${id}/rooms?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return notify(t("contacts.sessionsReadFailed"), "error");
    const page = (await response.json()) as PageResponse<SessionSummary>;
    setRoomSessionsPanel((panel) => ({
      kind,
      id,
      name,
      sessions: older && panel?.id === id ? [...(panel.sessions ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function openAgentStats(agent: AgentSummary) {
    setAgentStatsPanel({ agent, stats: null });
    const response = await fetch(`/api/agents/${agent.id}/stats`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return notify(t("contacts.statsReadFailed"), "error");
    setAgentStatsPanel({ agent, stats: await response.json() });
  }

  function sessionOriginLabel(session: SessionSummary) {
    const projectName = projectDisplayName(projects.find((project) => project.id === session.projectId), projects);
    const projectLabel = projectName || (session.projectId ? session.projectId : t("session.noProject"));
    const providerLabel = providers.find((provider) => provider.id === session.providerId)?.name ?? t("session.noProvider");
    const parts = [
      readableStatus(session.status, t),
      session.conversationType ?? "codex",
      projectLabel,
      `${providerLabel} / ${session.model ?? t("session.noModel")}`,
      formatShortDate(session.updatedAt),
    ];
    return parts.join(" · ");
  }

  function contactSessionFilters(onRefresh: () => void, options: { showProject?: boolean } = {}) {
    return (
      <div className="project-list-filters">
        <input name="contactsessionfilter-q"
          value={contactSessionFilter.q}
          onChange={(event) => setContactSessionFilter((filter) => ({ ...filter, q: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRefresh();
          }}
          placeholder={t("contacts.sessionSearch")}
        />
        <select name="contactsessionfilter-status" value={contactSessionFilter.status} onChange={(event) => setContactSessionFilter((filter) => ({ ...filter, status: event.target.value }))}>
          <option value="">{t("contacts.allStatuses")}</option>
          <option value="running">{t("session.statusRunning")}</option>
          <option value="done">{t("session.statusDone")}</option>
          <option value="paused">{t("session.statusPaused")}</option>
          <option value="interrupted">{t("session.statusInterrupted")}</option>
        </select>
        {options.showProject !== false && (
          <select name="contactsessionfilter-projectid" value={contactSessionFilter.projectId} onChange={(event) => setContactSessionFilter((filter) => ({ ...filter, projectId: event.target.value }))}>
            <option value="">{t("contacts.allProjects")}</option>
            <option value="scratch">{t("contacts.scratchSessions")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
          </select>
        )}
        <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={onRefresh}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
      </div>
    );
  }

  async function batchSetAgents(enabled: boolean) {
    const response = await fetch("/api/agents/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedAgentIds, enabled }),
    });
    if (!response.ok) return notify(t("contacts.batchFailed"), "error");
    setSelectedAgentIds([]);
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  async function duplicateRole(role: AgentRoleSummary) {
    const response = await fetch("/api/agent-roles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: `${role.name} Copy`,
        description: role.description,
        sourceType: "custom-markdown",
        markdownContent: role.markdownContent,
        systemPrompt: role.systemPrompt,
        capabilities: role.capabilities,
        defaultListenMode: role.defaultListenMode,
        defaultListenEvents: role.defaultListenEvents,
        defaultWorkspaceMode: role.defaultWorkspaceMode,
        defaultSandboxMode: role.defaultSandboxMode,
        defaultApprovalPolicy: role.defaultApprovalPolicy,
        outputContract: role.outputContract,
        safetyNotes: role.safetyNotes,
      }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  async function duplicateAgent(agent: AgentSummary) {
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...agent, name: `${agent.name} Copy`, enabled: false }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  async function duplicateGroup(group: AgentGroupSummary) {
    const response = await fetch("/api/agent-groups", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...group, name: `${group.name} Copy` }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  function startEditGroup(group: AgentGroupSummary) {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setEditingGroupDescription(group.description ?? "");
    setEditingGroupAgentIds(group.agentIds);
    setEditingGroupMemberListenModes(group.memberListenModes ?? {});
  }

  async function updateGroup(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agent-groups/${editingGroupId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingGroupName,
        description: editingGroupDescription,
        agentIds: editingGroupAgentIds,
        memberListenModes: editingGroupMemberListenModes,
      }),
    });
    if (!response.ok) return notify(t("contacts.updateGroupFailed"), "error");
    setEditingGroupId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  async function duplicateCircle(circle: AgentCircleSummary) {
    const response = await fetch("/api/agent-circles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...circle, name: `${circle.name} Copy`, builtin: false }),
    });
    if (!response.ok) return notify(t("contacts.duplicateFailed"), "error");
    await loadContacts();
    notify(t("contacts.duplicated"), "success");
  }

  function startEditCircle(circle: AgentCircleSummary) {
    setEditingCircleId(circle.id);
    setEditingCircleName(circle.name);
    setEditingCircleDescription(circle.description ?? "");
    setEditingCircleRoleIds(circle.roleIds);
    setEditingCircleRules(circle.collaborationRules ?? "");
  }

  async function updateCircle(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agent-circles/${editingCircleId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingCircleName,
        description: editingCircleDescription,
        roleIds: editingCircleRoleIds,
        collaborationRules: editingCircleRules,
      }),
    });
    if (!response.ok) return notify(t("contacts.updateCircleFailed"), "error");
    setEditingCircleId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agent-groups", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: groupName, description: groupDescription, agentIds: groupAgentIds, memberListenModes: groupMemberListenModes }),
    });
    if (!response.ok) {
      notify(t("contacts.createGroupFailed"), "error");
      return;
    }
    setGroupName("");
    setGroupDescription("");
    setGroupAgentIds([]);
    setGroupMemberListenModes({});
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  async function createCircle(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agent-circles", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: circleName, description: circleDescription, roleIds: circleRoleIds, collaborationRules: circleRules }),
    });
    if (!response.ok) {
      notify(t("contacts.createCircleFailed"), "error");
      return;
    }
    setCircleName("");
    setCircleDescription("");
    setCircleRoleIds([]);
    setCircleRules("");
    setContactCreatePanelOpen(false);
    await loadContacts();
    notify(t("contacts.created"), "success");
  }

  async function createGroupFromCircle(circle: AgentCircleSummary) {
    const response = await fetch(`/api/agent-circles/${circle.id}/groups`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("contacts.createGroupFailed"), "error");
      return null;
    }
    const group = (await response.json()) as AgentGroupSummary;
    await loadContacts();
    notify(t("contacts.created"), "success");
    return group;
  }

  async function deleteContact(kind: "agent" | "group" | "role" | "circle", id: string) {
    const path = kind === "agent" ? "agents" : kind === "group" ? "agent-groups" : kind === "circle" ? "agent-circles" : "agent-roles";
    const response = await fetch(`/api/${path}/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("contacts.deleteFailed"), "error");
      return;
    }
    await loadContacts();
    notify(t("contacts.deleted"), "success");
  }

  async function copyRoleContent(role: AgentRoleSummary) {
    const copied = await copyText(role.systemPrompt || role.markdownContent);
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  function startEditRole(role: AgentRoleSummary) {
    setEditingRoleId(role.id);
    setEditingRoleName(role.name);
    setEditingRoleDescription(role.description ?? "");
    setEditingRolePrompt(role.systemPrompt || role.markdownContent);
    setEditingRoleDescriptionInPrompt(role.systemPrompt.includes("## Role Extension Description"));
  }

  async function updateRole(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/agent-roles/${editingRoleId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: editingRoleName,
        description: editingRoleDescription,
        systemPrompt: editingRolePrompt,
        markdownContent: editingRolePrompt,
        includeDescriptionInPrompt: editingRoleDescriptionInPrompt,
      }),
    });
    if (!response.ok) {
      notify(t("contacts.updateRoleFailed"), "error");
      return;
    }
    setEditingRoleId("");
    await loadContacts();
    notify(t("contacts.updated"), "success");
  }

  function roleTemplateName(role: AgentRoleSummary) {
    if (role.sourceType !== "builtin-template" || !role.sourcePath) return "";
    const template = roleTemplates.find((item) => item.sourcePath === role.sourcePath);
    return templateName(template) || role.sourcePath.split("/").pop()?.replace(/\.md$/i, "") || "";
  }

  function toggleGroupAgent(agentId: string) {
    setGroupAgentIds((items) => items.includes(agentId) ? items.filter((item) => item !== agentId) : [...items, agentId]);
    setGroupMemberListenModes((items) => ({ ...items, [agentId]: items[agentId] ?? "passive" }));
  }

  function toggleEditingGroupAgent(agentId: string) {
    setEditingGroupAgentIds((items) => items.includes(agentId) ? items.filter((item) => item !== agentId) : [...items, agentId]);
    setEditingGroupMemberListenModes((items) => ({ ...items, [agentId]: items[agentId] ?? "passive" }));
  }

  function toggleString(items: string[], value: string) {
    return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
  }

  function toggleCircleRole(roleId: string) {
    setCircleRoleIds((items) => items.includes(roleId) ? items.filter((item) => item !== roleId) : [...items, roleId]);
  }

  function openRoomSessionDialog(input: { kind: "group" | "circle"; id: string; name: string }) {
    setRoomSessionDialog({ ...input, projectId: "" });
  }

  async function startRoom(input: { name: string; groupId?: string; circleId?: string; projectId?: string | null }) {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      notify(t("contacts.startRoomFailed"), "error");
      return;
    }
    const room = (await response.json()) as RoomSummary;
    setRoomSessionDialog(null);
    if (room.sessionId) onOpenSession(room.sessionId);
    notify(t("contacts.roomStarted"), "success");
  }

  async function startRoomFromDialog() {
    if (!roomSessionDialog) return;
    const projectId = roomSessionDialog.projectId || null;
    if (roomSessionDialog.kind === "group") {
      await startRoom({ name: roomSessionDialog.name, groupId: roomSessionDialog.id, projectId });
      return;
    }
    const circle = circles.find((item) => item.id === roomSessionDialog.id);
    if (!circle) return notify(t("contacts.startRoomFailed"), "error");
    const group = await createGroupFromCircle(circle);
    if (group) await startRoom({ name: roomSessionDialog.name, groupId: group.id, circleId: circle.id, projectId });
  }

  const searchText = contactSearch.trim().toLowerCase();
  const matchesSearch = (...values: Array<string | null | undefined>) => !searchText || values.some((value) => value?.toLowerCase().includes(searchText));
  const filteredAgents = agents.filter((agent) => matchesSearch(agent.name, agent.description, agent.model, agent.providerId, agent.permissionProfileId, agent.projectAccessMode));
  const filteredGroups = groups.filter((group) => matchesSearch(group.name, group.description, group.approvalPolicy, group.mergeStrategy));
  const filteredRoles = roles.filter((role) => matchesSearch(role.name, role.description, role.sourceType, roleTemplateName(role)));
  const filteredCircles = circles.filter((circle) => matchesSearch(circle.name, circle.description, circle.collaborationRules, circle.mergeStrategy));

  return (
    <main className="management-page contacts-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.contacts")}`} title={t("page.contacts")} action={loading ? t("session.loading") : t("action.refresh")} onAction={() => void loadContacts()} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.contacts")} />
      <FilterToolbar>
        <FilterSearchInput value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder={t("contacts.searchContacts")} />
      </FilterToolbar>
      <Tabs className="approvals-root" value={contactTab} onValueChange={(value) => setContactTab(value as ContactTab)}>
        <TabsList className="settings-tabs" aria-label={t("page.contacts")}>
          <TabsTrigger className="settings-tab" value="agents">{t("contacts.agents")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="groups">{t("contacts.groups")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="roles">{t("contacts.roles")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="circles">{t("contacts.circles")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="permissions">{t("contacts.permissionProfiles")}</TabsTrigger>
        </TabsList>
        <TabsContent className="extension-list contact-tab-content" value="agents">
          <div className="contact-content-toolbar">
            <span>{filteredAgents.length} {t("contacts.agents")}</span>
            <div className="row-actions">
              <Button variant="outline" size="sm" type="button" disabled={!filteredAgents.length} onClick={() => {
                const filteredIds = filteredAgents.map((agent) => agent.id);
                const allSelected = filteredIds.every((id) => selectedAgentIds.includes(id));
                setSelectedAgentIds(allSelected ? [] : filteredIds);
              }}>{filteredAgents.length && filteredAgents.every((agent) => selectedAgentIds.includes(agent.id)) ? t("contacts.clearSelectedAgents") : t("contacts.selectAllAgents")}</Button>
              <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createAgent")} aria-label={t("contacts.createAgent")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
            </div>
          </div>
          {selectedAgentIds.length > 0 && (
            <div className="settings-actions">
              <span className="subtle">{selectedAgentIds.length} {t("contacts.selectedAgents")}</span>
              <Button variant="outline" size="sm" type="button" onClick={() => void batchSetAgents(true)}>{t("contacts.enableSelected")}</Button>
              <Button variant="outline" size="sm" type="button" onClick={() => void batchSetAgents(false)}>{t("contacts.disableSelected")}</Button>
            </div>
          )}
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createAgent}>
            <strong>{t("contacts.createAgent")}</strong>
            <input name="agentname" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder={t("contacts.agentName")} required />
            <select name="agentroleid" value={agentRoleId} onChange={(event) => setAgentRoleId(event.target.value)} required>
              <option value="">{t("contacts.selectRole")}</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <select name="agentproviderid" value={agentProviderId} onChange={(event) => {
              const provider = providers.find((item) => item.id === event.target.value);
              setAgentProviderId(event.target.value);
              setAgentModel(provider?.defaultModel ?? "");
              setAgentModels(provider?.defaultModel ? [provider.defaultModel] : []);
              setAgentCustomModel(false);
            }}>
              <option value="">{t("contacts.defaultProvider")}</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
            <div className="inline-field-with-action">
              <select name="agentcustommodel" value={agentCustomModel || !agentModels.includes(agentModel) ? "__custom" : agentModel} onChange={(event) => {
                if (event.target.value === "__custom") {
                  setAgentCustomModel(true);
                  return;
                }
                setAgentCustomModel(false);
                setAgentModel(event.target.value);
              }}>
                {agentModels.map((model) => <option key={model} value={model}>{model}</option>)}
                <option value="__custom">{t("contacts.customModel")}</option>
              </select>
              <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!agentProviderId || discoveringAgentModels} onClick={() => void discoverAgentModels(agentProviderId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
            </div>
            {(agentCustomModel || !agentModels.length || !agentModels.includes(agentModel)) && <input name="agentmodel" value={agentModel} onChange={(event) => setAgentModel(event.target.value)} placeholder={t("contacts.agentModel")} />}
            <input name="agentdescription" value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} placeholder={t("contacts.description")} />
            <textarea name="agentextraprompt" value={agentExtraPrompt} onChange={(event) => setAgentExtraPrompt(event.target.value)} placeholder={t("contacts.extraPrompt")} />
            <select name="agentpermissionprofileid" value={agentPermissionProfileId} onChange={(event) => setAgentPermissionProfileId(event.target.value as PermissionProfileId)}>
              {(["read-only", "workspace-write", "developer", "maintainer", "danger-full-access"] as PermissionProfileId[]).map((profile) => <option key={profile} value={profile}>{readablePermissionProfile(profile, t)}</option>)}
            </select>
            <select name="agentprojectaccessmode" value={agentProjectAccessMode} onChange={(event) => setAgentProjectAccessMode(event.target.value as AgentProjectAccessMode)}>
              <option value="none">{t("contacts.projectAccessNone")}</option>
              <option value="selected">{t("contacts.projectAccessSelected")}</option>
              <option value="all">{t("contacts.projectAccessAll")}</option>
            </select>
            <select name="agentdefaultprojectid" value={agentDefaultProjectId} onChange={(event) => setAgentDefaultProjectId(event.target.value)}>
              <option value="">{t("session.noProject")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="agentallowedprojectids-includes-project-id" type="checkbox" checked={agentAllowedProjectIds.includes(project.id)} onChange={() => setAgentAllowedProjectIds((items) => toggleString(items, project.id))} />
                  <span>{projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="agentfavoriteprojectids-includes-project-id" type="checkbox" checked={agentFavoriteProjectIds.includes(project.id)} onChange={() => setAgentFavoriteProjectIds((items) => toggleString(items, project.id))} />
                  <span>{t("contacts.favoriteProject")}: {projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <Button disabled={!roles.length}>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredAgents.map((agent) => (
              <article className="provider-card" key={agent.id}>
              <div className="project-list-title">
                <strong><input name="selectedagentids-includes-agent-id" type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => setSelectedAgentIds((items) => toggleString(items, agent.id))} /> {agent.name}</strong>
                <span className={`pill ${agent.enabled ? "" : "warm"}`}>{agent.enabled ? t("contacts.enabled") : t("contacts.disabled")}</span>
              </div>
              {agent.description && <span className="subtle">{agent.description}</span>}
              <div className="project-list-meta">
                <span>{t("contacts.workspaceMode")}: {readableAgentWorkspaceMode(agent.workspaceMode, t)}</span>
                <span>{providers.find((provider) => provider.id === agent.providerId)?.name ?? t("contacts.defaultProvider")} · {agent.model ?? t("session.noModel")}</span>
                <span>{t("contacts.projectAccess")}: {agent.projectAccessMode} · {projectDisplayName(projects.find((project) => project.id === agent.defaultProjectId), projects) || t("session.noProject")}</span>
                <span>{t("contacts.permissionProfile")}: {readablePermissionProfile(agent.permissionProfileId ?? "custom", t)}</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.startAgentSession")} aria-label={t("contacts.startAgentSession")} onClick={() => openAgentSessionDialog(agent)}><IconText icon={MessageSquare}>{t("contacts.startAgentSession")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.continueLatest")} aria-label={t("contacts.continueLatest")} onClick={() => void continueLatestAgentSession(agent)}><IconText icon={PanelLeftOpen}>{t("contacts.continueLatest")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.sessions")} aria-label={t("contacts.sessions")} onClick={() => void openAgentSessions(agent)}><IconText icon={History}>{t("contacts.sessions")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "agent", item: agent })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void openAgentStats(agent)}><IconText icon={Activity}>{t("contacts.stats")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void duplicateAgent(agent)}><IconText icon={Copy}>{t("contacts.duplicate")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => startEditAgent(agent)}><IconText icon={Pencil}>{t("action.edit")}</IconText></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="danger-menu-item" onSelect={() => void deleteContact("agent", agent.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              </article>
            ))}
          </div>
          {contactPages.agents.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("agents")}>{t("session.loadMore")}</button>}
          {!agents.length && <div className="empty-state">{t("contacts.noAgents")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="groups">
          <div className="contact-content-toolbar">
            <span>{filteredGroups.length} {t("contacts.groups")}</span>
            <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createGroup")} aria-label={t("contacts.createGroup")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
          </div>
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createGroup}>
            <strong>{t("contacts.createGroup")}</strong>
            <input name="groupname" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("contacts.groupName")} required />
            <input name="groupdescription" value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input name="groupagentids-includes-agent-id" type="checkbox" checked={groupAgentIds.includes(agent.id)} onChange={() => toggleGroupAgent(agent.id)} />
                  <span>{agent.name}</span>
                  {groupAgentIds.includes(agent.id) && (
                    <select name="groupmemberlistenmodes-agent-id" value={groupMemberListenModes[agent.id] ?? "passive"} onChange={(event) => setGroupMemberListenModes((items) => ({ ...items, [agent.id]: event.target.value as AgentListenMode }))}>
                      {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                    </select>
                  )}
                </label>
              ))}
              {!agents.length && <span className="subtle">{t("contacts.noAgents")}</span>}
            </div>
            <Button>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredGroups.map((group) => (
              <article className="provider-card" key={group.id}>
              <div className="project-list-title">
                <strong>{group.name}</strong>
                <span className="pill">{group.agentIds.length} {t("contacts.members")}</span>
              </div>
              {group.description && <span className="subtle">{group.description}</span>}
              <code>{group.mergeStrategy}</code>
              <div className="project-list-meta">
                <span>{group.approvalPolicy}</span>
                <span>{group.maxConcurrentAgents} max</span>
                <span>{Object.entries(group.memberListenModes ?? {}).map(([agentId, mode]) => `${agents.find((agent) => agent.id === agentId)?.name ?? agentId}: ${mode}`).join(", ") || "-"}</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.startRoom")} aria-label={t("contacts.startRoom")} onClick={() => openRoomSessionDialog({ kind: "group", id: group.id, name: group.name })}><IconText icon={MessageSquare}>{t("contacts.startRoom")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.sessions")} aria-label={t("contacts.sessions")} onClick={() => void openRoomSessions("group", group.id, group.name)}><IconText icon={History}>{t("contacts.sessions")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "group", item: group })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.duplicate")} aria-label={t("contacts.duplicate")} onClick={() => void duplicateGroup(group)}><IconText icon={Copy}>{t("contacts.duplicate")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.edit")} aria-label={t("action.edit")} onClick={() => startEditGroup(group)}><IconText icon={Pencil}>{t("action.edit")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteContact("group", group.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>
              </div>
              </article>
            ))}
          </div>
          {contactPages.groups.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("groups")}>{t("session.loadMore")}</button>}
          {!filteredGroups.length && <div className="empty-state">{t("contacts.noGroups")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="roles">
          <div className="contact-content-toolbar">
            <span>{filteredRoles.length} {t("contacts.roles")}</span>
            <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createRole")} aria-label={t("contacts.createRole")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
          </div>
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createRole}>
            <strong>{t("contacts.createRole")}</strong>
            <select name="rolesourcetype" value={roleSourceType} onChange={(event) => setRoleSourceType(event.target.value as "builtin-template" | "custom-markdown" | "file-import")}>
              <option value="builtin-template">{t("contacts.builtinTemplate")}</option>
              <option value="custom-markdown">{t("contacts.customMarkdown")}</option>
              <option value="file-import">{t("contacts.fileImport")}</option>
            </select>
            <input name="rolename" value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder={roleSourceType === "builtin-template" ? t("contacts.roleNameOptional") : t("contacts.roleName")} required={roleSourceType === "custom-markdown"} />
            <input name="roledescription" value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <label className="inline-check">
              <input name="roledescriptioninprompt" type="checkbox" checked={roleDescriptionInPrompt} onChange={(event) => setRoleDescriptionInPrompt(event.target.checked)} />
              <span>{t("contacts.descriptionInPrompt")}</span>
            </label>
            {roleSourceType === "builtin-template" ? (
              <>
                <select name="roletemplateid" value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)} required>
                  <option value="">{t("contacts.selectTemplate")}</option>
                  {roleTemplates.map((template) => <option key={template.id} value={template.id}>{template.group} / {templateName(template)}</option>)}
                </select>
                {roleTemplates.find((template) => template.id === roleTemplateId) && (
                  <div className="template-preview">
                    <strong>{templateName(roleTemplates.find((template) => template.id === roleTemplateId))}</strong>
                    <span>{templateDescription(roleTemplates.find((template) => template.id === roleTemplateId))}</span>
                    <code>{roleTemplates.find((template) => template.id === roleTemplateId)?.sourcePath}</code>
                  </div>
                )}
              </>
            ) : roleSourceType === "file-import" ? (
              <input name="rolesourcepath" value={roleSourcePath} onChange={(event) => setRoleSourcePath(event.target.value)} placeholder={t("contacts.roleFilePath")} required />
            ) : (
              <textarea name="roleprompt" value={rolePrompt} onChange={(event) => setRolePrompt(event.target.value)} placeholder={t("contacts.systemPrompt")} required />
            )}
            <Button>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredRoles.map((role) => (
              <article className="provider-card" key={role.id}>
              <div className="project-list-title">
                <strong>{role.name}</strong>
                <span className="pill">{role.sourceType}</span>
              </div>
              <span className="subtle">{role.description}</span>
              <div className="project-list-meta">
                {roleTemplateName(role) && <span>{t("contacts.selectedTemplate")}: {roleTemplateName(role)}</span>}
                <span>{role.defaultListenMode}</span>
                <span>{role.defaultWorkspaceMode}</span>
                <span>{role.capabilities.join(", ") || "-"}</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyRoleContent(role)}><IconText icon={Copy}>{t("action.copy")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "role", item: role })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.duplicate")} aria-label={t("contacts.duplicate")} onClick={() => void duplicateRole(role)}><IconText icon={FilePlus2}>{t("contacts.duplicate")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.edit")} aria-label={t("action.edit")} onClick={() => startEditRole(role)}><IconText icon={Pencil}>{t("action.edit")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteContact("role", role.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>
              </div>
              </article>
            ))}
          </div>
          {contactPages.roles.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("roles")}>{t("session.loadMore")}</button>}
          {!filteredRoles.length && <div className="empty-state">{t("contacts.noRoles")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="circles">
          <div className="contact-content-toolbar">
            <span>{filteredCircles.length} {t("contacts.circles")}</span>
            <Button className="automation-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("contacts.createCircle")} aria-label={t("contacts.createCircle")} onClick={() => setContactCreatePanelOpen(true)}><Plus size={16} /></Button>
          </div>
          <form className="management-form inline-management-form contact-inline-create-form" onSubmit={createCircle}>
            <strong>{t("contacts.createCircle")}</strong>
            <input name="circlename" value={circleName} onChange={(event) => setCircleName(event.target.value)} placeholder={t("contacts.circleName")} required />
            <input name="circledescription" value={circleDescription} onChange={(event) => setCircleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {roles.map((role) => (
                <label key={role.id}>
                  <input name="circleroleids-includes-role-id" type="checkbox" checked={circleRoleIds.includes(role.id)} onChange={() => toggleCircleRole(role.id)} />
                  <span>{role.name}</span>
                </label>
              ))}
              {!roles.length && <span className="subtle">{t("contacts.noRoles")}</span>}
            </div>
            <textarea name="circlerules" value={circleRules} onChange={(event) => setCircleRules(event.target.value)} placeholder={t("contacts.collaborationRules")} />
            <Button>{t("action.create")}</Button>
          </form>
          <div className="contact-card-grid">
            {filteredCircles.map((circle) => (
              <article className="provider-card" key={circle.id}>
              <div className="project-list-title">
                <strong>{circle.name}</strong>
                {circle.builtin && <span className="pill">{t("contacts.builtin")}</span>}
              </div>
              {circle.description && <span className="subtle">{circle.description}</span>}
              <div className="project-list-meta">
                <span>{circle.roleIds.length} {t("contacts.roles")}</span>
                <span>{t("contacts.members")}: {circle.maxConcurrentAgents} max</span>
              </div>
              <div className="project-list-actions">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.createGroupFromCircle")} aria-label={t("contacts.createGroupFromCircle")} onClick={() => void createGroupFromCircle(circle)}><IconText icon={Users}>{t("contacts.createGroupFromCircle")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.sessions")} aria-label={t("contacts.sessions")} onClick={() => void openRoomSessions("circle", circle.id, circle.name)}><IconText icon={History}>{t("contacts.sessions")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailContact({ kind: "circle", item: circle })}><IconText icon={Info}>{t("preview.details")}</IconText></Button>
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.duplicate")} aria-label={t("contacts.duplicate")} onClick={() => void duplicateCircle(circle)}><IconText icon={Copy}>{t("contacts.duplicate")}</IconText></Button>
                {!circle.builtin && <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.edit")} aria-label={t("action.edit")} onClick={() => startEditCircle(circle)}><IconText icon={Pencil}>{t("action.edit")}</IconText></Button>}
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.startRoom")} aria-label={t("contacts.startRoom")} onClick={() => openRoomSessionDialog({ kind: "circle", id: circle.id, name: circle.name })}><IconText icon={MessageSquare}>{t("contacts.startRoom")}</IconText></Button>
                {!circle.builtin && <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteContact("circle", circle.id)}><IconText icon={Trash2}>{t("action.delete")}</IconText></Button>}
              </div>
              </article>
            ))}
          </div>
          {contactPages.circles.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadMoreContacts("circles")}>{t("session.loadMore")}</button>}
          {!filteredCircles.length && <div className="empty-state">{t("contacts.noCircles")}</div>}
        </TabsContent>
        <TabsContent className="extension-list contact-tab-content" value="permissions">
          <div className="contact-content-toolbar">
            <span>{permissionProfiles.length} {t("contacts.permissionProfiles")}</span>
          </div>
          <div className="contact-card-grid">
            {permissionProfiles.map((profile) => (
              <article className="provider-card" key={profile.id}>
              <div className="project-list-title">
                <strong>{readablePermissionProfile(profile.id as PermissionProfileId, t)}</strong>
                <span className="pill">{t("contacts.permissionProfile")}</span>
              </div>
              <pre className="approval-details">{prettyJson(profile.permissions)}</pre>
              </article>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      {contactCreatePanelOpen && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{contactTab === "agents" ? t("contacts.createAgent") : contactTab === "groups" ? t("contacts.createGroup") : contactTab === "roles" ? t("contacts.createRole") : t("contacts.createCircle")}</strong>
              <span>{t("page.contacts")}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setContactCreatePanelOpen(false)}><X size={16} /></button>
          </div>
          {contactTab === "agents" && (
            <form className="management-form" onSubmit={createAgent}>
              <input name="modal-agentname" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder={t("contacts.agentName")} required />
              <select name="modal-agentroleid" value={agentRoleId} onChange={(event) => setAgentRoleId(event.target.value)} required>
                <option value="">{t("contacts.selectRole")}</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              <select name="modal-agentproviderid" value={agentProviderId} onChange={(event) => {
                const provider = providers.find((item) => item.id === event.target.value);
                setAgentProviderId(event.target.value);
                setAgentModel(provider?.defaultModel ?? "");
                setAgentModels(provider?.defaultModel ? [provider.defaultModel] : []);
                setAgentCustomModel(false);
              }}>
                <option value="">{t("contacts.defaultProvider")}</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
              <div className="inline-field-with-action">
                <select name="modal-agentcustommodel" value={agentCustomModel || !agentModels.includes(agentModel) ? "__custom" : agentModel} onChange={(event) => {
                  if (event.target.value === "__custom") {
                    setAgentCustomModel(true);
                    return;
                  }
                  setAgentCustomModel(false);
                  setAgentModel(event.target.value);
                }}>
                  {agentModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  <option value="__custom">{t("contacts.customModel")}</option>
                </select>
                <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!agentProviderId || discoveringAgentModels} onClick={() => void discoverAgentModels(agentProviderId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
              </div>
              {(agentCustomModel || !agentModels.length || !agentModels.includes(agentModel)) && <input name="modal-agentmodel" value={agentModel} onChange={(event) => setAgentModel(event.target.value)} placeholder={t("contacts.agentModel")} />}
              <input name="modal-agentdescription" value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} placeholder={t("contacts.description")} />
              <textarea name="modal-agentextraprompt" value={agentExtraPrompt} onChange={(event) => setAgentExtraPrompt(event.target.value)} placeholder={t("contacts.extraPrompt")} />
              <select name="modal-agentpermissionprofileid" value={agentPermissionProfileId} onChange={(event) => setAgentPermissionProfileId(event.target.value as PermissionProfileId)}>
                {(["read-only", "workspace-write", "developer", "maintainer", "danger-full-access"] as PermissionProfileId[]).map((profile) => <option key={profile} value={profile}>{readablePermissionProfile(profile, t)}</option>)}
              </select>
              <select name="modal-agentprojectaccessmode" value={agentProjectAccessMode} onChange={(event) => setAgentProjectAccessMode(event.target.value as AgentProjectAccessMode)}>
                <option value="none">{t("contacts.projectAccessNone")}</option>
                <option value="selected">{t("contacts.projectAccessSelected")}</option>
                <option value="all">{t("contacts.projectAccessAll")}</option>
              </select>
              <select name="modal-agentdefaultprojectid" value={agentDefaultProjectId} onChange={(event) => setAgentDefaultProjectId(event.target.value)}>
                <option value="">{t("session.noProject")}</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
              </select>
              <div className="checkbox-grid">
                {projects.map((project) => (
                  <label key={project.id} className="inline-check">
                    <input name="modal-agentallowedprojectids-includes-project-id" type="checkbox" checked={agentAllowedProjectIds.includes(project.id)} onChange={() => setAgentAllowedProjectIds((items) => toggleString(items, project.id))} />
                    <span>{projectDisplayName(project, projects)}</span>
                  </label>
                ))}
              </div>
              <div className="checkbox-grid">
                {projects.map((project) => (
                  <label key={project.id} className="inline-check">
                    <input name="modal-agentfavoriteprojectids-includes-project-id" type="checkbox" checked={agentFavoriteProjectIds.includes(project.id)} onChange={() => setAgentFavoriteProjectIds((items) => toggleString(items, project.id))} />
                    <span>{t("contacts.favoriteProject")}: {projectDisplayName(project, projects)}</span>
                  </label>
                ))}
              </div>
              <Button disabled={!roles.length}>{t("action.create")}</Button>
            </form>
          )}
          {contactTab === "groups" && (
            <form className="management-form" onSubmit={createGroup}>
              <input name="modal-groupname" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("contacts.groupName")} required />
              <input name="modal-groupdescription" value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder={t("contacts.description")} />
              <div className="checkbox-grid">
                {agents.map((agent) => (
                  <label key={agent.id}>
                    <input name="modal-groupagentids-includes-agent-id" type="checkbox" checked={groupAgentIds.includes(agent.id)} onChange={() => toggleGroupAgent(agent.id)} />
                    <span>{agent.name}</span>
                    {groupAgentIds.includes(agent.id) && (
                      <select name="modal-groupmemberlistenmodes-agent-id" value={groupMemberListenModes[agent.id] ?? "passive"} onChange={(event) => setGroupMemberListenModes((items) => ({ ...items, [agent.id]: event.target.value as AgentListenMode }))}>
                        {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                      </select>
                    )}
                  </label>
                ))}
                {!agents.length && <span className="subtle">{t("contacts.noAgents")}</span>}
              </div>
              <Button>{t("action.create")}</Button>
            </form>
          )}
          {contactTab === "roles" && (
            <form className="management-form" onSubmit={createRole}>
              <select name="modal-rolesourcetype" value={roleSourceType} onChange={(event) => setRoleSourceType(event.target.value as "builtin-template" | "custom-markdown" | "file-import")}>
                <option value="builtin-template">{t("contacts.builtinTemplate")}</option>
                <option value="custom-markdown">{t("contacts.customMarkdown")}</option>
                <option value="file-import">{t("contacts.fileImport")}</option>
              </select>
              <input name="modal-rolename" value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder={roleSourceType === "builtin-template" ? t("contacts.roleNameOptional") : t("contacts.roleName")} required={roleSourceType === "custom-markdown"} />
              <input name="modal-roledescription" value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} placeholder={t("contacts.description")} />
              <label className="inline-check">
                <input name="modal-roledescriptioninprompt" type="checkbox" checked={roleDescriptionInPrompt} onChange={(event) => setRoleDescriptionInPrompt(event.target.checked)} />
                <span>{t("contacts.descriptionInPrompt")}</span>
              </label>
              {roleSourceType === "builtin-template" ? (
                <>
                  <select name="modal-roletemplateid" value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)} required>
                    <option value="">{t("contacts.selectTemplate")}</option>
                    {roleTemplates.map((template) => <option key={template.id} value={template.id}>{template.group} / {templateName(template)}</option>)}
                  </select>
                  {roleTemplates.find((template) => template.id === roleTemplateId) && (
                    <div className="template-preview">
                      <strong>{templateName(roleTemplates.find((template) => template.id === roleTemplateId))}</strong>
                      <span>{templateDescription(roleTemplates.find((template) => template.id === roleTemplateId))}</span>
                      <code>{roleTemplates.find((template) => template.id === roleTemplateId)?.sourcePath}</code>
                    </div>
                  )}
                </>
              ) : roleSourceType === "file-import" ? (
                <input name="modal-rolesourcepath" value={roleSourcePath} onChange={(event) => setRoleSourcePath(event.target.value)} placeholder={t("contacts.roleFilePath")} required />
              ) : (
                <textarea name="modal-roleprompt" value={rolePrompt} onChange={(event) => setRolePrompt(event.target.value)} placeholder={t("contacts.systemPrompt")} required />
              )}
              <Button>{t("action.create")}</Button>
            </form>
          )}
          {contactTab === "circles" && (
            <form className="management-form" onSubmit={createCircle}>
              <input name="modal-circlename" value={circleName} onChange={(event) => setCircleName(event.target.value)} placeholder={t("contacts.circleName")} required />
              <input name="modal-circledescription" value={circleDescription} onChange={(event) => setCircleDescription(event.target.value)} placeholder={t("contacts.description")} />
              <div className="checkbox-grid">
                {roles.map((role) => (
                  <label key={role.id}>
                    <input name="modal-circleroleids-includes-role-id" type="checkbox" checked={circleRoleIds.includes(role.id)} onChange={() => toggleCircleRole(role.id)} />
                    <span>{role.name}</span>
                  </label>
                ))}
                {!roles.length && <span className="subtle">{t("contacts.noRoles")}</span>}
              </div>
              <textarea name="modal-circlerules" value={circleRules} onChange={(event) => setCircleRules(event.target.value)} placeholder={t("contacts.collaborationRules")} />
              <Button>{t("action.create")}</Button>
            </form>
          )}
        </div>
      )}
      {editingAgentId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.editAgent")}</strong>
              <span>{editingAgentName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingAgentId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateAgent}>
            <input name="modal-editingagentname" value={editingAgentName} onChange={(event) => setEditingAgentName(event.target.value)} placeholder={t("contacts.agentName")} required />
            <select name="modal-editingagentroleid" value={editingAgentRoleId} onChange={(event) => setEditingAgentRoleId(event.target.value)} required>
              <option value="">{t("contacts.selectRole")}</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <select name="modal-editingagentproviderid" value={editingAgentProviderId} onChange={(event) => {
              const provider = providers.find((item) => item.id === event.target.value);
              setEditingAgentProviderId(event.target.value);
              const models = provider?.models?.length ? provider.models : provider?.defaultModel ? [provider.defaultModel] : [];
              setEditingAgentModels(models);
              setEditingAgentCustomModel(false);
              setEditingAgentModel(models[0] ?? provider?.defaultModel ?? "");
            }}>
              <option value="">{t("contacts.defaultProvider")}</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
            <div className="inline-field-with-action">
              <select name="modal-editingagentcustommodel" value={editingAgentCustomModel || !editingAgentModels.includes(editingAgentModel) ? "__custom" : editingAgentModel} onChange={(event) => {
                if (event.target.value === "__custom") {
                  setEditingAgentCustomModel(true);
                  return;
                }
                setEditingAgentCustomModel(false);
                setEditingAgentModel(event.target.value);
              }}>
                {editingAgentModels.map((model) => <option key={model} value={model}>{model}</option>)}
                <option value="__custom">{t("contacts.customModel")}</option>
              </select>
              <button className="ghost-button icon-only" type="button" title={t("provider.detectModels")} aria-label={t("provider.detectModels")} disabled={!editingAgentProviderId || discoveringEditingAgentModels} onClick={() => void discoverEditingAgentModels(editingAgentProviderId, true)}><IconText icon={RefreshCw}>{t("provider.detectModels")}</IconText></button>
            </div>
            {(editingAgentCustomModel || !editingAgentModels.length || !editingAgentModels.includes(editingAgentModel)) && <input name="modal-editingagentmodel" value={editingAgentModel} onChange={(event) => setEditingAgentModel(event.target.value)} placeholder={t("contacts.agentModel")} />}
            <select name="modal-editingagentworkspacemode" value={editingAgentWorkspaceMode} onChange={(event) => setEditingAgentWorkspaceMode(event.target.value as AgentSummary["workspaceMode"])}>
              {(["shared-readonly", "isolated-worktree", "isolated-worktree-with-shared-room", "shared-write", "merge-workspace"] as AgentSummary["workspaceMode"][]).map((mode) => (
                <option key={mode} value={mode}>{readableAgentWorkspaceMode(mode, t)}</option>
              ))}
            </select>
            <input name="modal-editingagentdescription" value={editingAgentDescription} onChange={(event) => setEditingAgentDescription(event.target.value)} placeholder={t("contacts.description")} />
            <textarea name="modal-editingagentextraprompt" value={editingAgentExtraPrompt} onChange={(event) => setEditingAgentExtraPrompt(event.target.value)} placeholder={t("contacts.extraPrompt")} />
            <select name="modal-editingagentpermissionprofileid" value={editingAgentPermissionProfileId} onChange={(event) => setEditingAgentPermissionProfileId(event.target.value as PermissionProfileId)}>
              {(["read-only", "workspace-write", "developer", "maintainer", "danger-full-access"] as PermissionProfileId[]).map((profile) => <option key={profile} value={profile}>{readablePermissionProfile(profile, t)}</option>)}
            </select>
            <select name="modal-editingagentprojectaccessmode" value={editingAgentProjectAccessMode} onChange={(event) => setEditingAgentProjectAccessMode(event.target.value as AgentProjectAccessMode)}>
              <option value="none">{t("contacts.projectAccessNone")}</option>
              <option value="selected">{t("contacts.projectAccessSelected")}</option>
              <option value="all">{t("contacts.projectAccessAll")}</option>
            </select>
            <select name="modal-editingagentdefaultprojectid" value={editingAgentDefaultProjectId} onChange={(event) => setEditingAgentDefaultProjectId(event.target.value)}>
              <option value="">{t("session.noProject")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
            </select>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="modal-editingagentallowedprojectids-includes-project-id" type="checkbox" checked={editingAgentAllowedProjectIds.includes(project.id)} onChange={() => setEditingAgentAllowedProjectIds((items) => toggleString(items, project.id))} />
                  <span>{projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <div className="checkbox-grid">
              {projects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input name="modal-editingagentfavoriteprojectids-includes-project-id" type="checkbox" checked={editingAgentFavoriteProjectIds.includes(project.id)} onChange={() => setEditingAgentFavoriteProjectIds((items) => toggleString(items, project.id))} />
                  <span>{t("contacts.favoriteProject")}: {projectDisplayName(project, projects)}</span>
                </label>
              ))}
            </div>
            <label className="inline-check">
              <input name="modal-editingagentenabled" type="checkbox" checked={editingAgentEnabled} onChange={(event) => setEditingAgentEnabled(event.target.checked)} />
              <span>{editingAgentEnabled ? t("contacts.enabled") : t("contacts.disabled")}</span>
            </label>
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingAgentId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {editingGroupId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("action.edit")} {t("contacts.groups")}</strong>
              <span>{editingGroupName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingGroupId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateGroup}>
            <input name="modal-editinggroupname" value={editingGroupName} onChange={(event) => setEditingGroupName(event.target.value)} placeholder={t("contacts.groupName")} required />
            <input name="modal-editinggroupdescription" value={editingGroupDescription} onChange={(event) => setEditingGroupDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input name="modal-editinggroupagentids-includes-agent-id" type="checkbox" checked={editingGroupAgentIds.includes(agent.id)} onChange={() => toggleEditingGroupAgent(agent.id)} />
                  <span>{agent.name}</span>
                  {editingGroupAgentIds.includes(agent.id) && (
                    <select name="modal-editinggroupmemberlistenmodes-agent-id" value={editingGroupMemberListenModes[agent.id] ?? "passive"} onChange={(event) => setEditingGroupMemberListenModes((items) => ({ ...items, [agent.id]: event.target.value as AgentListenMode }))}>
                      {listenModeOptions.map((mode) => <option key={mode} value={mode}>{readableListenMode(mode, t)}</option>)}
                    </select>
                  )}
                </label>
              ))}
            </div>
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingGroupId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {editingRoleId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.editRole")}</strong>
              <span>{editingRoleName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingRoleId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateRole}>
            <input name="modal-editingrolename" value={editingRoleName} onChange={(event) => setEditingRoleName(event.target.value)} placeholder={t("contacts.roleName")} required />
            <input name="modal-editingroledescription" value={editingRoleDescription} onChange={(event) => setEditingRoleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <label className="inline-check">
              <input name="modal-editingroledescriptioninprompt" type="checkbox" checked={editingRoleDescriptionInPrompt} onChange={(event) => setEditingRoleDescriptionInPrompt(event.target.checked)} />
              <span>{t("contacts.descriptionInPrompt")}</span>
            </label>
            <textarea name="modal-editingroleprompt" value={editingRolePrompt} onChange={(event) => setEditingRolePrompt(event.target.value)} placeholder={t("contacts.systemPrompt")} required />
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingRoleId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {editingCircleId && (
        <div className="workspace-modal compact-modal contact-form-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("action.edit")} {t("contacts.circles")}</strong>
              <span>{editingCircleName}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setEditingCircleId("")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={updateCircle}>
            <input name="modal-editingcirclename" value={editingCircleName} onChange={(event) => setEditingCircleName(event.target.value)} placeholder={t("contacts.circleName")} required />
            <input name="modal-editingcircledescription" value={editingCircleDescription} onChange={(event) => setEditingCircleDescription(event.target.value)} placeholder={t("contacts.description")} />
            <div className="checkbox-grid">
              {roles.map((role) => (
                <label key={role.id}>
                  <input name="modal-editingcircleroleids-includes-role-id" type="checkbox" checked={editingCircleRoleIds.includes(role.id)} onChange={() => setEditingCircleRoleIds((items) => toggleString(items, role.id))} />
                  <span>{role.name}</span>
                </label>
              ))}
              {!roles.length && <span className="subtle">{t("contacts.noRoles")}</span>}
            </div>
            <textarea name="modal-editingcirclerules" value={editingCircleRules} onChange={(event) => setEditingCircleRules(event.target.value)} placeholder={t("contacts.collaborationRules")} />
            <div className="row-actions">
              <Button>{t("action.save")}</Button>
              <Button variant="outline" type="button" onClick={() => setEditingCircleId("")}>{t("action.cancel")}</Button>
            </div>
          </form>
        </div>
      )}
      {detailContact && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("preview.details")}</strong>
              <span>{detailContact.kind}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setDetailContact(null)}><X size={16} /></button>
          </div>
          <div className="preview-detail">
            <pre className="approval-details">{prettyJson(detailContact.item)}</pre>
          </div>
        </div>
      )}
      {agentSessionDialog && (
        <div className="workspace-modal compact-modal session-start-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.startAgentSession")}</strong>
              <span>{agentSessionDialog.agent.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setAgentSessionDialog(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail session-project-dialog">
            <label className="project-select-label">
              <span>{t("contacts.sessionProject")}</span>
              <div className="project-select-field">
                <FolderGit2 size={16} />
                <select name="agentsessiondialog-projectid" value={agentSessionDialog.projectId} onChange={(event) => setAgentSessionDialog((current) => current ? { ...current, projectId: event.target.value } : current)}>
                  <option value="">{t("session.noProject")}</option>
                  {agentProjectOptions(agentSessionDialog.agent).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.id === agentSessionDialog.agent.defaultProjectId ? `${projectDisplayName(project, projects)} · ${t("contacts.defaultProject")}` : projectDisplayName(project, projects)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <div className="session-dialog-facts">
              <code>{projects.find((project) => project.id === agentSessionDialog.projectId)?.workspacePath ?? t("session.noProject")}</code>
              <span>{t("contacts.projectAccess")}: {agentSessionDialog.agent.projectAccessMode}</span>
              <span>{t("contacts.permissionProfile")}: {readablePermissionProfile(agentSessionDialog.agent.permissionProfileId ?? "custom", t)}</span>
              <span>{providers.find((provider) => provider.id === agentSessionDialog.agent.providerId)?.name ?? t("contacts.defaultProvider")} / {agentSessionDialog.agent.model ?? t("session.noModel")}</span>
            </div>
            {agentSessionDialog.agent.favoriteProjectIds.length > 0 && (
              <div className="room-mention-bar">
                {agentSessionDialog.agent.favoriteProjectIds
                  .map((projectId) => projects.find((project) => project.id === projectId))
                  .filter((project): project is ProjectSummary => Boolean(project))
                  .map((project) => (
                    <button className="ghost-button" type="button" key={project.id} onClick={() => setAgentSessionDialog((current) => current ? { ...current, projectId: project.id } : current)}>{projectDisplayName(project, projects)}</button>
                  ))}
              </div>
            )}
            <div className="row-actions">
              <Button type="button" onClick={() => void startAgentSession(agentSessionDialog.agent, agentSessionDialog.projectId || null)}>{t("contacts.startAgentSession")}</Button>
              <Button variant="outline" type="button" onClick={() => setAgentSessionDialog(null)}>{t("action.cancel")}</Button>
            </div>
          </div>
        </div>
      )}
      {roomSessionDialog && (
        <div className="workspace-modal compact-modal session-start-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.startRoom")}</strong>
              <span>{roomSessionDialog.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setRoomSessionDialog(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail session-project-dialog">
            <label className="project-select-label">
              <span>{t("contacts.sessionProject")}</span>
              <div className="project-select-field">
                <FolderGit2 size={16} />
                <select name="roomsessiondialog-projectid" value={roomSessionDialog.projectId} onChange={(event) => setRoomSessionDialog((current) => current ? { ...current, projectId: event.target.value } : current)}>
                  <option value="">{t("session.noProject")}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, projects)}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <div className="session-dialog-facts">
              <span>{roomSessionDialog.kind === "group" ? t("contacts.groups") : t("contacts.circles")}</span>
              <code>{projects.find((project) => project.id === roomSessionDialog.projectId)?.workspacePath ?? t("session.noProject")}</code>
            </div>
            <div className="row-actions">
              <Button type="button" onClick={() => void startRoomFromDialog()}>{t("contacts.startRoom")}</Button>
              <Button variant="outline" type="button" onClick={() => setRoomSessionDialog(null)}>{t("action.cancel")}</Button>
            </div>
          </div>
        </div>
      )}
      {agentSessionsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.sessions")}</strong>
              <span>{agentSessionsPanel.agent.name}</span>
            </div>
            <Button className="icon-only" variant="outline" size="sm" type="button" title={t("contacts.continueLatest")} aria-label={t("contacts.continueLatest")} onClick={() => void continueLatestAgentSession(agentSessionsPanel.agent)}><IconText icon={PanelLeftOpen}>{t("contacts.continueLatest")}</IconText></Button>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setAgentSessionsPanel(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail">
            <strong>{t("contacts.sessionFilters")}</strong>
            {contactSessionFilters(() => void openAgentSessions(agentSessionsPanel.agent))}
            {!agentSessionsPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
            {agentSessionsPanel.sessions?.map((session) => (
              <button className="file-list-item" key={session.id} type="button" onClick={() => onOpenSession(session.id)}>
                <span>{session.title}</span>
                <em>{sessionOriginLabel(session)}</em>
              </button>
            ))}
            {agentSessionsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openAgentSessions(agentSessionsPanel.agent, true)}>{t("session.loadMore")}</button>}
            {agentSessionsPanel.sessions && !agentSessionsPanel.sessions.length && <div className="empty-state">{t("contacts.noSessions")}</div>}
          </div>
        </div>
      )}
      {roomSessionsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.roomSessions")}</strong>
              <span>{roomSessionsPanel.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setRoomSessionsPanel(null)}><X size={16} /></button>
          </div>
          <div className="extension-detail">
            <strong>{t("contacts.sessionFilters")}</strong>
            {contactSessionFilters(() => void openRoomSessions(roomSessionsPanel.kind, roomSessionsPanel.id, roomSessionsPanel.name))}
            {!roomSessionsPanel.sessions && <div className="subtle">{t("session.loading")}</div>}
            {roomSessionsPanel.sessions?.map((session) => (
              <button className="file-list-item" key={session.id} type="button" onClick={() => onOpenSession(session.id)}>
                <span>{session.title}</span>
                <em>{sessionOriginLabel(session)}</em>
              </button>
            ))}
            {roomSessionsPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openRoomSessions(roomSessionsPanel.kind, roomSessionsPanel.id, roomSessionsPanel.name, true)}>{t("session.loadMore")}</button>}
            {roomSessionsPanel.sessions && !roomSessionsPanel.sessions.length && <div className="empty-state">{t("contacts.noSessions")}</div>}
          </div>
        </div>
      )}
      {agentStatsPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("contacts.stats")}</strong>
              <span>{agentStatsPanel.agent.name}</span>
            </div>
            <button className="modal-head-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => setAgentStatsPanel(null)}><X size={16} /></button>
          </div>
          <div className="preview-detail">
            <pre className="approval-details">{prettyJson(agentStatsPanel.stats)}</pre>
          </div>
        </div>
      )}
    </main>
  );
}
