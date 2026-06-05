import type {
  AgentCircleSummary,
  AgentGroupSummary,
  AgentRoleSummary,
  AgentRoleTemplateSummary,
  AgentSummary,
  PageResponse,
  ProviderModelsResponse,
} from "@codex-web/protocol";
import type { ContactPageKind } from "./types";

function authHeaders(sessionToken: string) {
  return { authorization: `Bearer ${sessionToken}` };
}

function jsonPage<T>(response: Response) {
  return response.json() as Promise<PageResponse<T>>;
}

export async function fetchContactsOverview(sessionToken: string) {
  const headers = authHeaders(sessionToken);
  const [agentsPage, groupsPage, rolesPage, templatesList, circlesPage, profilesList] = await Promise.all([
    fetch("/api/agents?limit=50", { headers }).then(jsonPage<AgentSummary>),
    fetch("/api/agent-groups?limit=50", { headers }).then(jsonPage<AgentGroupSummary>),
    fetch("/api/agent-roles?limit=50", { headers }).then(jsonPage<AgentRoleSummary>),
    fetch("/api/agent-role-templates", { headers }).then((response) => response.json() as Promise<AgentRoleTemplateSummary[]>),
    fetch("/api/agent-circles?limit=50", { headers }).then(jsonPage<AgentCircleSummary>),
    fetch("/api/permission-profiles", { headers }).then((response) => response.json() as Promise<Array<{ id: string; permissions: unknown }>>),
  ]);
  return { agentsPage, groupsPage, rolesPage, templatesList, circlesPage, profilesList };
}

export async function fetchContactsPage(kind: ContactPageKind, cursor: string, sessionToken: string) {
  const endpoint = kind === "agents" ? "agents" : kind === "groups" ? "agent-groups" : kind === "roles" ? "agent-roles" : "agent-circles";
  const response = await fetch(`/api/${endpoint}?limit=50&cursor=${encodeURIComponent(cursor)}`, { headers: authHeaders(sessionToken) });
  if (!response.ok) throw new Error("contacts_page_failed");
  if (kind === "agents") return { kind, page: await jsonPage<AgentSummary>(response) };
  if (kind === "groups") return { kind, page: await jsonPage<AgentGroupSummary>(response) };
  if (kind === "roles") return { kind, page: await jsonPage<AgentRoleSummary>(response) };
  return { kind, page: await jsonPage<AgentCircleSummary>(response) };
}

export async function fetchProviderModelsForContact(sessionToken: string, providerId: string) {
  const response = await fetch(`/api/providers/${providerId}/models?refresh=1`, {
    headers: authHeaders(sessionToken),
  });
  return response.ok ? ((await response.json()) as ProviderModelsResponse) : null;
}
