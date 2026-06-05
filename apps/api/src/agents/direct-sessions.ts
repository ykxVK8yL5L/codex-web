import type Database from "better-sqlite3";
import type { AgentRoleSummary, AgentSummary, SessionSummary } from "@codex-web/protocol";

type DirectAgentSessionDeps = {
  db: Database.Database;
  agentFromRow: (row: Record<string, unknown>) => AgentSummary;
  agentRoleFromRow: (row: Record<string, unknown>) => AgentRoleSummary;
};

export function createDirectAgentSessionService(deps: DirectAgentSessionDeps) {
  const { db, agentFromRow, agentRoleFromRow } = deps;

  function directAgentForSession(sessionId: string) {
    const link = db.prepare("select agent_id from agent_sessions where session_id = ?").get(sessionId) as { agent_id?: string } | undefined;
    if (!link?.agent_id) return null;
    const agentRow = db.prepare("select * from agents where id = ?").get(link.agent_id) as Record<string, unknown> | undefined;
    if (!agentRow) return null;
    const agent = agentFromRow(agentRow);
    const roleRow = db.prepare("select * from agent_roles where id = ?").get(agent.roleId) as Record<string, unknown> | undefined;
    if (!roleRow) return null;
    return { agent, role: agentRoleFromRow(roleRow) };
  }

  function promptForDirectAgentSession(session: SessionSummary, prompt: string) {
    if (session.conversationType !== "agent" || session.roomId || session.codexSessionId) return prompt;
    const directAgent = directAgentForSession(session.id);
    if (!directAgent) return prompt;
    return [
      directAgent.role.systemPrompt,
      directAgent.agent.extraPrompt ? `\n\nAgent extra instructions:\n${directAgent.agent.extraPrompt}` : "",
      `\n\nUser message:\n${prompt}`,
    ].join("");
  }

  return { directAgentForSession, promptForDirectAgentSession };
}
