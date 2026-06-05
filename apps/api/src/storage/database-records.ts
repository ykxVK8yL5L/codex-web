import type Database from "better-sqlite3";
import type { GoalOwnerType } from "@codex-web/protocol";

type DatabaseRecordDeletionDeps = {
  db: Database.Database;
  deletePreviewsForScope: (scopeType: "session" | "project" | "folder", scopeId: string) => number;
  deleteSessionMessages: (sessionId: string) => void;
};

export function createDatabaseRecordDeletionService(deps: DatabaseRecordDeletionDeps) {
  const { db, deletePreviewsForScope, deleteSessionMessages } = deps;

  function deleteGoalsForOwner(ownerType: GoalOwnerType, ownerId: string) {
    const rows = db.prepare("select id from goals where owner_type = ? and owner_id = ?").all(ownerType, ownerId) as Array<{ id: string }>;
    let deleted = 0;
    for (const row of rows) {
      deleted += db.prepare("delete from goal_events where goal_id = ?").run(row.id).changes;
      deleted += db.prepare("delete from goal_proposals where goal_id = ?").run(row.id).changes;
      deleted += db.prepare("delete from goal_focuses where goal_id = ?").run(row.id).changes;
      deleted += db.prepare("delete from goal_items where goal_id = ?").run(row.id).changes;
      deleted += db.prepare("delete from goals where id = ?").run(row.id).changes;
    }
    return deleted;
  }

  function deleteSessionDatabaseRows(sessionId: string) {
    const taskRunRows = db.prepare("select id from task_runs where session_id = ?").all(sessionId) as Array<{ id: string }>;
    deletePreviewsForScope("session", sessionId);
    deleteSessionMessages(sessionId);
    deleteGoalsForOwner("session", sessionId);
    deleteGoalsForOwner("agent_session", sessionId);
    db.prepare("delete from notification_ephemeral_rules where scope_type = 'session' and scope_id = ?").run(sessionId);
    for (const row of taskRunRows) {
      db.prepare("delete from notification_ephemeral_rules where scope_type = 'task' and scope_id = ?").run(row.id);
    }
    db.prepare("delete from message_queue where session_id = ?").run(sessionId);
    db.prepare("delete from task_activities where session_id = ?").run(sessionId);
    db.prepare("delete from execution_contexts where session_id = ?").run(sessionId);
    db.prepare("delete from session_compactions where session_id = ?").run(sessionId);
    db.prepare("delete from agent_sessions where session_id = ?").run(sessionId);
    db.prepare("delete from agent_runs where session_id = ?").run(sessionId);
    db.prepare("delete from sessions where id = ?").run(sessionId);
  }

  function deleteRoomDatabaseRows(roomId: string) {
    let deleted = 0;
    deleted += deleteGoalsForOwner("room", roomId);
    for (const table of [
      "room_agents",
      "room_events",
      "room_tasks",
      "room_artifacts",
      "room_handoffs",
      "room_decisions",
      "room_schedules",
      "room_run_merges",
      "room_agent_threads",
      "agent_runs",
    ]) {
      deleted += db.prepare(`delete from ${table} where room_id = ?`).run(roomId).changes;
    }
    deleted += db.prepare("delete from execution_contexts where room_id = ?").run(roomId).changes;
    deleted += db.prepare("delete from rooms where id = ?").run(roomId).changes;
    return deleted;
  }

  return {
    deleteGoalsForOwner,
    deleteRoomDatabaseRows,
    deleteSessionDatabaseRows,
  };
}
