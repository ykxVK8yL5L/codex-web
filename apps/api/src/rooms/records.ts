import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { RoomArtifactSummary, RoomDecisionSummary, RoomEventSummary, RoomHandoffSummary } from "@codex-web/protocol";

type RoomRecordServiceDeps = {
  db: Database.Database;
  jsonPayload: (value: unknown) => unknown;
  roomEvent: (roomId: string, type: string, payload: unknown, targetAgentId?: string | null, sourceAgentId?: string | null) => RoomEventSummary;
};

export function createRoomRecordService(deps: RoomRecordServiceDeps) {
  const { db, jsonPayload, roomEvent } = deps;

  function roomArtifactFromRow(row: Record<string, unknown>): RoomArtifactSummary {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      agentId: row.agent_id ? String(row.agent_id) : null,
      kind: String(row.kind) as RoomArtifactSummary["kind"],
      title: String(row.title),
      payload: jsonPayload(row.payload),
      createdAt: String(row.created_at),
    };
  }

  function createRoomArtifact(roomId: string, input: Omit<RoomArtifactSummary, "id" | "roomId" | "createdAt">) {
    const artifact: RoomArtifactSummary = {
      ...input,
      id: `artifact-${randomUUID()}`,
      roomId,
      createdAt: new Date().toISOString(),
    };
    db.prepare(`
      insert into room_artifacts (id, room_id, agent_id, kind, title, payload, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(artifact.id, artifact.roomId, artifact.agentId ?? null, artifact.kind, artifact.title, JSON.stringify(artifact.payload ?? {}), artifact.createdAt);
    roomEvent(roomId, "artifact.created", { artifactId: artifact.id, kind: artifact.kind, title: artifact.title }, artifact.agentId ?? null);
    return artifact;
  }

  function roomDecisionFromRow(row: Record<string, unknown>): RoomDecisionSummary {
    const status = ["open", "approved", "rejected", "resolved"].includes(String(row.status)) ? String(row.status) as RoomDecisionSummary["status"] : "open";
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      title: String(row.title),
      status,
      payload: jsonPayload(row.payload),
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    };
  }

  function createRoomDecision(roomId: string, input: Omit<RoomDecisionSummary, "id" | "roomId" | "createdAt" | "resolvedAt"> & { resolvedAt?: string | null }) {
    const decision: RoomDecisionSummary = {
      ...input,
      id: `decision-${randomUUID()}`,
      roomId,
      createdAt: new Date().toISOString(),
      resolvedAt: input.resolvedAt ?? null,
    };
    db.prepare(`
      insert into room_decisions (id, room_id, title, status, payload, created_at, resolved_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(decision.id, decision.roomId, decision.title, decision.status, JSON.stringify(decision.payload ?? {}), decision.createdAt, decision.resolvedAt ?? null);
    roomEvent(roomId, "decision.created", { decisionId: decision.id, title: decision.title, status: decision.status });
    return decision;
  }

  function roomHandoffStatus(value: unknown): RoomHandoffSummary["status"] {
    return value === "accepted" || value === "returned" || value === "resolved" || value === "cancelled" ? value : "open";
  }

  function roomHandoffFromRow(row: Record<string, unknown>): RoomHandoffSummary {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      fromAgentId: row.from_agent_id ? String(row.from_agent_id) : null,
      toAgentId: row.to_agent_id ? String(row.to_agent_id) : null,
      summary: String(row.summary),
      status: roomHandoffStatus(row.status),
      payload: jsonPayload(row.payload),
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    };
  }

  function createRoomHandoff(roomId: string, input: Omit<RoomHandoffSummary, "id" | "roomId" | "createdAt" | "resolvedAt" | "status"> & { status?: RoomHandoffSummary["status"]; resolvedAt?: string | null }) {
    const handoff: RoomHandoffSummary = {
      ...input,
      status: roomHandoffStatus(input.status),
      id: `handoff-${randomUUID()}`,
      roomId,
      createdAt: new Date().toISOString(),
      resolvedAt: input.resolvedAt ?? null,
    };
    db.prepare(`
      insert into room_handoffs (id, room_id, from_agent_id, to_agent_id, summary, status, payload, created_at, resolved_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(handoff.id, handoff.roomId, handoff.fromAgentId ?? null, handoff.toAgentId ?? null, handoff.summary, handoff.status, JSON.stringify(handoff.payload ?? {}), handoff.createdAt, handoff.resolvedAt ?? null);
    roomEvent(roomId, "handoff.created", { handoffId: handoff.id, summary: handoff.summary, status: handoff.status, toAgentId: handoff.toAgentId }, handoff.toAgentId ?? null, handoff.fromAgentId ?? null);
    return handoff;
  }

  return {
    createRoomArtifact,
    createRoomDecision,
    createRoomHandoff,
    roomArtifactFromRow,
    roomDecisionFromRow,
    roomHandoffFromRow,
    roomHandoffStatus,
  };
}
