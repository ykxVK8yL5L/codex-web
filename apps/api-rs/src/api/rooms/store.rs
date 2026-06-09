use std::path::PathBuf;

use rusqlite::{params, OptionalExtension};

use crate::api::common::{timestamp, PageResponse};
use crate::db::Db;

use super::models::{
    AgentRunSummary, CreateRoomDecisionRequest, RoomAgentSummary, RoomArtifactSummary,
    RoomDecisionSummary, RoomEventSummary, RoomHandoffSummary, RoomScheduleSummary, RoomSummary,
    RoomTaskSummary,
};

pub fn list_rooms(
    db: &Db,
    status: Option<&str>,
    limit: usize,
) -> anyhow::Result<PageResponse<RoomSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "rooms")? {
        return Ok(page(Vec::new(), false));
    }
    let mut rows = if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
        let mut statement = connection.prepare(
            "select * from rooms where status = ? order by updated_at desc, id desc limit ?",
        )?;
        let rows = statement
            .query_map((status, limit as i64 + 1), |row| {
                room_from_row_with_goal(&connection, row)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let mut statement =
            connection.prepare("select * from rooms order by updated_at desc, id desc limit ?")?;
        let rows = statement
            .query_map([limit as i64 + 1], |row| {
                room_from_row_with_goal(&connection, row)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    Ok(page(rows, has_more))
}

pub fn get_room(db: &Db, id: &str) -> anyhow::Result<Option<RoomSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "rooms")? {
        return Ok(None);
    }
    connection
        .query_row("select * from rooms where id = ?", [id], |row| {
            room_from_row_with_goal(&connection, row)
        })
        .optional()
        .map_err(Into::into)
}

pub fn room_agents(db: &Db, room_id: &str) -> anyhow::Result<Vec<RoomAgentSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "room_agents")? {
        return Ok(Vec::new());
    }
    read_room_agents(&connection, room_id).map_err(anyhow::Error::from)
}

pub fn room_events(db: &Db, room_id: &str, limit: usize) -> anyhow::Result<Vec<RoomEventSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "room_events")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select * from room_events where room_id = ? order by created_at desc, id desc limit ?",
    )?;
    let items = statement
        .query_map((room_id, limit as i64), event_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn room_tasks(db: &Db, room_id: &str, limit: usize) -> anyhow::Result<Vec<RoomTaskSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "room_tasks")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select * from room_tasks where room_id = ? order by priority desc, updated_at desc, id desc limit ?")?;
    let items = statement
        .query_map((room_id, limit as i64), task_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn room_runs(db: &Db, room_id: &str, limit: usize) -> anyhow::Result<Vec<AgentRunSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "agent_runs")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select * from agent_runs where room_id = ? order by started_at desc, id desc limit ?",
    )?;
    let items = statement
        .query_map((room_id, limit as i64), run_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

// ===========================================================================
// Write paths (mirror apps/api/src/rooms/routes.ts + records.ts + runtime.ts).
// ===========================================================================

pub struct RoomError {
    pub status: u16,
    pub code: String,
}

impl RoomError {
    fn new(status: u16, code: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
        }
    }
}

type RoomResult<T> = Result<T, RoomError>;

pub struct RoomRunMergeApprovalRequest {
    pub approval: crate::api::approvals::models::ApprovalSummary,
}

fn bad(code: &str) -> RoomError {
    RoomError::new(400, code)
}
fn not_found(code: &str) -> RoomError {
    RoomError::new(404, code)
}
fn conflict(code: &str) -> RoomError {
    RoomError::new(409, code)
}

impl From<anyhow::Error> for RoomError {
    fn from(error: anyhow::Error) -> Self {
        RoomError::new(400, error.to_string())
    }
}
impl From<rusqlite::Error> for RoomError {
    fn from(error: rusqlite::Error) -> Self {
        RoomError::new(400, error.to_string())
    }
}

fn json_str(value: Option<&serde_json::Value>) -> String {
    serde_json::to_string(&value.cloned().unwrap_or_else(|| serde_json::json!({})))
        .unwrap_or_else(|_| "{}".to_string())
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn uuid() -> String {
    // Mirror randomUUID() shape (8-4-4-4-12) closely enough for unique ids.
    let hex = random_hex(16);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn listen_mode(value: Option<&str>) -> String {
    match value {
        Some("none") | Some("active") | Some("orchestrator") | Some("passive") => {
            value.unwrap().to_string()
        }
        _ => "passive".to_string(),
    }
}

fn room_status(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some(v @ ("running" | "paused" | "done" | "failed" | "draft")) => v.to_string(),
        _ => fallback.to_string(),
    }
}

fn handoff_status(value: Option<&str>) -> String {
    match value {
        Some(v @ ("accepted" | "returned" | "resolved" | "cancelled")) => v.to_string(),
        _ => "open".to_string(),
    }
}

fn decision_status(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some(v @ ("open" | "approved" | "rejected" | "resolved")) => v.to_string(),
        _ => fallback.to_string(),
    }
}

/// Mirror roomOrchestrationSettings() clamping/defaulting from rooms/index.ts.
fn orchestration_settings(
    stored: Option<&str>,
    override_value: Option<&serde_json::Value>,
) -> serde_json::Value {
    let parsed: serde_json::Value = stored
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let item = parsed.as_object().cloned().unwrap_or_default();
    let ov = override_value
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let get_bool = |key: &str, def: bool| -> bool {
        ov.get(key)
            .and_then(|v| v.as_bool())
            .or_else(|| item.get(key).and_then(|v| v.as_bool()))
            .unwrap_or(def)
    };
    let get_num = |key: &str, def: i64| -> i64 {
        ov.get(key)
            .and_then(|v| v.as_i64())
            .or_else(|| item.get(key).and_then(|v| v.as_i64()))
            .unwrap_or(def)
    };
    serde_json::json!({
        "autoStartTasks": get_bool("autoStartTasks", true),
        "autoCreateReviewTasks": get_bool("autoCreateReviewTasks", true),
        "autoListenAfterAgentEvents": get_bool("autoListenAfterAgentEvents", true),
        "notifyUserOnFailure": get_bool("notifyUserOnFailure", true),
        "maxAutoRetries": get_num("maxAutoRetries", 0).clamp(0, 10),
        "maxAutoListenChainDepth": get_num("maxAutoListenChainDepth", 1).clamp(0, 10),
        "maxAutoListenTasksPerEvent": get_num("maxAutoListenTasksPerEvent", 1).clamp(1, 20),
    })
}

fn record_room_event(
    connection: &rusqlite::Connection,
    room_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
    target_agent_id: Option<&str>,
    source_agent_id: Option<&str>,
) -> rusqlite::Result<()> {
    connection.execute(
        "insert into room_events (id, room_id, type, source_agent_id, target_agent_id, payload, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![
            format!("room-event-{}", uuid()),
            room_id,
            event_type,
            source_agent_id,
            target_agent_id,
            serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()),
            timestamp(),
        ],
    )?;
    Ok(())
}

fn exists(
    connection: &rusqlite::Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> rusqlite::Result<bool> {
    Ok(connection
        .query_row(sql, params, |_| Ok(()))
        .optional()?
        .is_some())
}

fn goal_table_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists goals (
          id text primary key,
          owner_type text not null,
          owner_id text not null,
          text text not null,
          mode text not null,
          status text not null,
          manager_agent_id text,
          coordinator_agent_id text,
          progress_summary text,
          created_at text not null,
          updated_at text not null,
          completed_at text,
          cancelled_at text
        );
        create table if not exists goal_focuses (
          id text primary key,
          goal_id text not null,
          text text not null,
          status text not null,
          owner_agent_id text,
          created_at text not null,
          updated_at text not null,
          completed_at text,
          cancelled_at text
        );
        create table if not exists goal_events (
          id text primary key,
          goal_id text not null,
          type text not null,
          actor_type text,
          actor_id text,
          payload text not null,
          created_at text not null
        );
        create table if not exists goal_items (
          id text primary key,
          goal_id text not null,
          room_task_id text,
          title text not null,
          description text,
          status text not null,
          assigned_agent_id text,
          priority integer not null default 0,
          depends_on_item_id text,
          created_at text not null,
          updated_at text not null,
          completed_at text,
          cancelled_at text
        );
        ",
    )?;
    Ok(())
}

fn goal_mode_for_room_create(value: Option<&str>) -> String {
    match value {
        Some("tracked") | Some("managed") | Some("orchestrated") | Some("reference") => {
            value.unwrap().to_string()
        }
        _ => "orchestrated".to_string(),
    }
}

fn create_room_goal_if_requested(
    connection: &rusqlite::Connection,
    room_id: &str,
    goal: Option<&serde_json::Value>,
) -> RoomResult<()> {
    let Some(goal) = goal.and_then(|value| value.as_object()) else {
        return Ok(());
    };
    let text = goal
        .get("text")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Ok(());
    }
    goal_table_schema(connection).map_err(RoomError::from)?;
    let now = timestamp();
    if let Some(existing) = connection
        .query_row(
            "select id from goals where owner_type = 'room' and owner_id = ? and status in ('active', 'paused') order by updated_at desc, id desc limit 1",
            [room_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        connection.execute("update goals set status = 'archived', updated_at = ? where id = ?", params![now, existing])?;
        record_goal_event_raw(connection, &existing, "goal.archived", &serde_json::json!({ "reason": "replaced", "replacementOwnerType": "room", "replacementOwnerId": room_id }))?;
    }
    let id = format!("goal-{}", random_hex(16));
    let mode = goal_mode_for_room_create(goal.get("mode").and_then(|value| value.as_str()));
    let manager_agent_id = goal
        .get("managerAgentId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let coordinator_agent_id = goal
        .get("coordinatorAgentId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    connection.execute(
        "insert into goals (id, owner_type, owner_id, text, mode, status, manager_agent_id, coordinator_agent_id, progress_summary, created_at, updated_at, completed_at, cancelled_at) values (?, 'room', ?, ?, ?, 'active', ?, ?, null, ?, ?, null, null)",
        params![id, room_id, text, mode, manager_agent_id, coordinator_agent_id, now, now],
    )?;
    record_goal_event_raw(
        connection,
        &id,
        "goal.created",
        &serde_json::json!({ "ownerType": "room", "ownerId": room_id, "text": text }),
    )?;
    if let Some(focus_text) = goal
        .get("focusText")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let focus_id = format!("goal-focus-{}", random_hex(16));
        let owner_agent_id = goal
            .get("focusOwnerAgentId")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        connection.execute(
            "insert into goal_focuses (id, goal_id, text, status, owner_agent_id, created_at, updated_at, completed_at, cancelled_at) values (?, ?, ?, 'active', ?, ?, ?, null, null)",
            params![focus_id, id, focus_text, owner_agent_id, now, now],
        )?;
        record_goal_event_raw(
            connection,
            &id,
            "focus.created",
            &serde_json::json!({ "focusId": focus_id, "text": focus_text, "ownerAgentId": owner_agent_id }),
        )?;
    }
    Ok(())
}

fn record_goal_event_raw(
    connection: &rusqlite::Connection,
    goal_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
) -> rusqlite::Result<()> {
    connection.execute(
        "insert into goal_events (id, goal_id, type, actor_type, actor_id, payload, created_at) values (?, ?, ?, 'user', null, ?, ?)",
        params![format!("goal-event-{}", random_hex(16)), goal_id, event_type, serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()), timestamp()],
    )?;
    Ok(())
}

fn propagate_goal_item_status_for_task(
    connection: &rusqlite::Connection,
    goal_item_id: Option<&str>,
    status: &str,
) -> RoomResult<()> {
    let Some(goal_item_id) = goal_item_id.filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    if !table_exists(connection, "goal_items").map_err(RoomError::from)? {
        return Ok(());
    }
    goal_table_schema(connection).map_err(RoomError::from)?;
    let goal_id: Option<String> = connection
        .query_row(
            "select goal_id from goal_items where id = ?",
            [goal_item_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let Some(goal_id) = goal_id else {
        return Ok(());
    };
    let now = timestamp();
    let completed_at: Option<String> = if status == "completed" {
        Some(now.clone())
    } else {
        None
    };
    let cancelled_at: Option<String> = if status == "cancelled" {
        Some(now.clone())
    } else {
        None
    };
    connection.execute(
        "update goal_items set status = ?, completed_at = case when ? = 'completed' then coalesce(completed_at, ?) when ? in ('planned', 'active', 'blocked') then null else completed_at end, cancelled_at = case when ? = 'cancelled' then coalesce(cancelled_at, ?) when ? in ('planned', 'active', 'blocked') then null else cancelled_at end, updated_at = ? where id = ? and goal_id = ?",
        params![status, status, completed_at, status, status, cancelled_at, status, now, goal_item_id, goal_id],
    )?;
    connection.execute(
        "update goals set updated_at = ? where id = ?",
        params![now, goal_id],
    )?;
    record_goal_event_raw(
        connection,
        &goal_id,
        "item.updated",
        &serde_json::json!({ "itemId": goal_item_id, "status": status }),
    )
    .map_err(RoomError::from)?;
    Ok(())
}

fn materialize_agent_group_from_circle(
    connection: &rusqlite::Connection,
    circle_id: &str,
) -> RoomResult<Option<String>> {
    let circle = connection
        .query_row(
            "select name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy from agent_circles where id = ?",
            [circle_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((
        name,
        description,
        collaboration_rules,
        event_routing_rules,
        max_concurrent_agents,
        approval_policy,
        merge_strategy,
    )) = circle
    else {
        return Ok(None);
    };
    let role_ids: Vec<String> = {
        let mut statement = connection.prepare("select role_id from agent_circle_roles where circle_id = ? order by position asc, role_id asc")?;
        let rows = statement.query_map([circle_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if role_ids.is_empty() {
        return Err(bad("agent_circle_has_no_roles"));
    }
    let mut agents: Vec<(String, String)> = Vec::new();
    for role_id in role_ids {
        let role = connection
            .query_row(
                "select name, description, default_listen_mode, default_listen_events, default_workspace_mode from agent_roles where id = ?",
                [&role_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?)),
            )
            .optional()?;
        let Some((
            role_name,
            role_description,
            default_listen_mode,
            default_listen_events,
            default_workspace_mode,
        )) = role
        else {
            continue;
        };
        let agent_id = ensure_agent_for_circle_role(
            connection,
            &role_id,
            &role_name,
            role_description.as_deref(),
            &default_listen_mode,
            &default_listen_events,
            &default_workspace_mode,
        )?;
        agents.push((agent_id, default_listen_mode));
    }
    if agents.is_empty() {
        return Err(bad("agent_circle_has_no_roles"));
    }
    let now = timestamp();
    let group_id = format!("agent-group-{}", uuid());
    connection.execute(
        "insert into agent_groups (id, name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![group_id, name, description, collaboration_rules.unwrap_or_default(), event_routing_rules.unwrap_or_default(), max_concurrent_agents.unwrap_or(3), approval_policy.unwrap_or_else(|| "bounded".to_string()), merge_strategy.unwrap_or_else(|| "approval-required".to_string()), now, now],
    )?;
    for (index, (agent_id, mode)) in agents.iter().enumerate() {
        let member_mode = if index == 0 {
            "orchestrator".to_string()
        } else {
            listen_mode(Some(mode))
        };
        connection.execute("insert or ignore into agent_group_members (group_id, agent_id, listen_mode) values (?, ?, ?)", params![group_id, agent_id, member_mode])?;
    }
    Ok(Some(group_id))
}

fn ensure_agent_for_circle_role(
    connection: &rusqlite::Connection,
    role_id: &str,
    role_name: &str,
    role_description: Option<&str>,
    default_listen_mode: &str,
    default_listen_events: &str,
    default_workspace_mode: &str,
) -> RoomResult<String> {
    if let Some(existing) = connection
        .query_row(
            "select id from agents where role_id = ? order by created_at asc limit 1",
            [role_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(existing);
    }
    let now = timestamp();
    let agent_id = format!("agent-{}", uuid());
    let permissions = serde_json::json!({
        "canWriteFiles": true,
        "canRunCommands": true,
        "canUseTerminal": true,
        "canCreatePreview": true,
        "canWriteSharedWorkspace": true,
        "canRequestApproval": true,
        "canTriggerAgents": false,
        "canMergeChanges": false
    });
    connection.execute(
        "insert into agents (id, name, role_id, description, extra_prompt, provider_id, model, listen_mode, listen_events, workspace_mode, default_project_id, favorite_project_ids, project_access_mode, allowed_project_ids, permission_profile_id, permissions, max_concurrent_runs, enabled, created_at, updated_at) values (?, ?, ?, ?, null, null, null, ?, ?, ?, null, '[]', 'all', '[]', 'developer', ?, 1, 1, ?, ?)",
        params![agent_id, role_name, role_id, role_description, listen_mode(Some(default_listen_mode)), default_listen_events, default_workspace_mode, serde_json::to_string(&permissions).unwrap_or_else(|_| "{}".to_string()), now, now],
    )?;
    Ok(agent_id)
}

// ----- rooms create/update --------------------------------------------------

pub fn create_room(db: &Db, body: super::models::CreateRoomRequest) -> RoomResult<RoomSummary> {
    let name = body.name.as_deref().unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err(bad("invalid_room"));
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if let Some(group_id) = body.group_id.as_deref().filter(|g| !g.is_empty()) {
        if !exists(
            &connection,
            "select id from agent_groups where id = ?",
            [group_id],
        )? {
            return Err(not_found("agent_group_not_found"));
        }
    }
    if let Some(circle_id) = body.circle_id.as_deref().filter(|c| !c.is_empty()) {
        if !exists(
            &connection,
            "select id from agent_circles where id = ?",
            [circle_id],
        )? {
            return Err(not_found("agent_circle_not_found"));
        }
    }
    // Resolve group: explicit groupId, else circle.group_template_id when present.
    let mut group_id = body.group_id.clone().filter(|g| !g.is_empty());
    if group_id.is_none() {
        if let Some(circle_id) = body.circle_id.as_deref().filter(|c| !c.is_empty()) {
            group_id = connection
                .query_row(
                    "select group_template_id from agent_circles where id = ?",
                    [circle_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
            if group_id
                .as_deref()
                .filter(|value| !value.is_empty())
                .is_none()
            {
                group_id = materialize_agent_group_from_circle(&connection, circle_id)?;
            }
        }
    }
    let now = timestamp();
    let id = format!("room-{}", uuid());
    let session_id = format!("task-{}", uuid());
    let project_id = body.project_id.clone().filter(|p| !p.is_empty());
    let workspace_path = if let Some(project_id) = project_id.as_deref() {
        connection
            .query_row(
                "select workspace_path from projects where id = ?",
                [project_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
            .unwrap_or_else(|| ensure_room_scratch_workspace(db, &session_id))
    } else {
        ensure_room_scratch_workspace(db, &session_id)
    };
    // Mirror TS room creation: create the linked room SessionSummary immediately. Without this,
    // the frontend opens /api/sessions/<room.sessionId> and gets 404 after POST /api/rooms.
    connection.execute_batch(
        "
        create table if not exists sessions (
          id text primary key,
          kind text not null,
          conversation_type text not null default 'codex',
          room_id text,
          title text not null,
          project_id text,
          workspace_path text not null,
          provider_id text,
          model text,
          codex_session_id text,
          notifications_enabled integer not null default 1,
          show_message_usage integer,
          status text not null,
          created_at text not null,
          updated_at text not null
        );
        ",
    )?;
    connection.execute(
        "insert or ignore into sessions (id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at) values (?, ?, 'room', ?, ?, ?, ?, null, null, null, 1, null, 'paused', ?, ?)",
        params![session_id, if project_id.is_some() { "project" } else { "scratch" }, id, name, project_id.as_deref(), workspace_path, now, now],
    )?;
    let shared_context = body
        .shared_context
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let orchestration = orchestration_settings(None, body.orchestration.as_ref());
    connection.execute(
        "insert into rooms (id, session_id, name, group_id, circle_id, project_id, status, shared_context, orchestration_settings, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)",
        params![
            id,
            session_id,
            name,
            group_id,
            body.circle_id.clone().filter(|c| !c.is_empty()),
            project_id,
            shared_context,
            serde_json::to_string(&orchestration).unwrap_or_else(|_| "{}".to_string()),
            now,
            now,
        ],
    )?;
    create_room_goal_if_requested(&connection, &id, body.goal.as_ref())?;
    // Seed room_agents from group membership (mirror group?.agentIds loop).
    if let Some(group_id) = group_id.as_deref() {
        if exists(
            &connection,
            "select id from agent_groups where id = ?",
            [group_id],
        )? {
            let members: Vec<(String, Option<String>)> = {
                // agent_group_members has no position column (TS orders group members by agent_id).
                let mut statement = connection.prepare("select agent_id, listen_mode from agent_group_members where group_id = ? order by agent_id asc")?;
                let rows = statement
                    .query_map([group_id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            for (agent_id, mode) in members {
                connection.execute(
                    "insert or ignore into room_agents (room_id, agent_id, listen_mode) values (?, ?, ?)",
                    params![id, agent_id, listen_mode(mode.as_deref())],
                )?;
            }
        }
    }
    record_room_event(
        &connection,
        &id,
        "room.created",
        &serde_json::json!({ "name": name }),
        None,
        None,
    )?;
    let room = connection.query_row("select * from rooms where id = ?", [&id], |row| {
        room_from_row_with_goal(&connection, row)
    })?;
    Ok(room)
}

pub fn update_room(
    db: &Db,
    id: &str,
    body: super::models::UpdateRoomRequest,
) -> RoomResult<RoomSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row("select * from rooms where id = ?", [id], |row| {
            room_from_row_with_goal(&connection, row)
        })
        .optional()?;
    let Some(current) = current else {
        return Err(not_found("room_not_found"));
    };
    let stored_orchestration: Option<String> = connection
        .query_row(
            "select orchestration_settings from rooms where id = ?",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let orchestration =
        orchestration_settings(stored_orchestration.as_deref(), body.orchestration.as_ref());
    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(current.name);
    let status = room_status(body.status.as_deref(), &current.status);
    let shared_context = match body.shared_context {
        Some(value) => value.and_then(|v| {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        None => current.shared_context,
    };
    connection.execute(
        "update rooms set name = ?, status = ?, shared_context = ?, orchestration_settings = ?, updated_at = ? where id = ?",
        params![
            name,
            status,
            shared_context,
            serde_json::to_string(&orchestration).unwrap_or_else(|_| "{}".to_string()),
            timestamp(),
            id,
        ],
    )?;
    Ok(
        connection.query_row("select * from rooms where id = ?", [id], |row| {
            room_from_row_with_goal(&connection, row)
        })?,
    )
}

// ----- room agents ----------------------------------------------------------

fn read_room_agents(
    connection: &rusqlite::Connection,
    room_id: &str,
) -> rusqlite::Result<Vec<RoomAgentSummary>> {
    let mut statement = connection.prepare(
        "select agents.id, agents.name, agents.role_id, agents.description, agents.extra_prompt, agents.provider_id, agents.model,
                agents.workspace_mode, agents.default_project_id, agents.favorite_project_ids, agents.project_access_mode,
                agents.allowed_project_ids, agents.permission_profile_id, agents.permissions, agents.max_concurrent_runs,
                agents.enabled, agents.created_at, agents.updated_at, room_agents.listen_mode
         from room_agents
         join agents on agents.id = room_agents.agent_id
         where room_agents.room_id = ?
         order by agents.name asc, agents.id asc"
    )?;
    let rows = statement
        .query_map([room_id], room_agent_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn room_agent_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomAgentSummary> {
    Ok(RoomAgentSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        role_id: row.get(2)?,
        description: row.get(3)?,
        extra_prompt: row.get(4)?,
        provider_id: row.get(5)?,
        model: row.get(6)?,
        workspace_mode: row.get(7)?,
        default_project_id: row.get(8)?,
        favorite_project_ids: parse_string_array(row.get::<_, String>(9)?.as_str()),
        project_access_mode: row.get(10)?,
        allowed_project_ids: parse_string_array(row.get::<_, String>(11)?.as_str()),
        permission_profile_id: row.get(12)?,
        permissions: serde_json::from_str(&row.get::<_, String>(13)?)
            .unwrap_or_else(|_| serde_json::json!({})),
        max_concurrent_runs: row.get(14)?,
        enabled: row.get::<_, i64>(15)? != 0,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        listen_mode: row.get(18)?,
    })
}

fn parse_string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

pub fn add_room_agent(
    db: &Db,
    room_id: &str,
    body: super::models::AddRoomAgentRequest,
) -> RoomResult<Vec<RoomAgentSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let agent_id = body.agent_id.as_deref().unwrap_or("").trim().to_string();
    if agent_id.is_empty()
        || !exists(
            &connection,
            "select id from agents where id = ?",
            [&agent_id],
        )?
    {
        return Err(not_found("agent_not_found"));
    }
    let mode = listen_mode(body.listen_mode.as_deref());
    connection.execute(
        "insert into room_agents (room_id, agent_id, listen_mode) values (?, ?, ?) on conflict(room_id, agent_id) do update set listen_mode = excluded.listen_mode",
        params![room_id, agent_id, mode],
    )?;
    record_room_event(
        &connection,
        room_id,
        "room.agent.added",
        &serde_json::json!({ "agentId": agent_id, "listenMode": mode }),
        Some(&agent_id),
        None,
    )?;
    Ok(read_room_agents(&connection, room_id)?)
}

pub fn update_room_agent(
    db: &Db,
    room_id: &str,
    agent_id: &str,
    body: super::models::UpdateRoomAgentRequest,
) -> RoomResult<Vec<RoomAgentSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let mode = listen_mode(body.listen_mode.as_deref());
    let changed = connection.execute(
        "update room_agents set listen_mode = ? where room_id = ? and agent_id = ?",
        params![mode, room_id, agent_id],
    )?;
    if changed == 0 {
        return Err(not_found("room_agent_not_found"));
    }
    record_room_event(
        &connection,
        room_id,
        "room.agent.listen_mode.updated",
        &serde_json::json!({ "agentId": agent_id, "listenMode": mode }),
        Some(agent_id),
        None,
    )?;
    Ok(read_room_agents(&connection, room_id)?)
}

// ----- artifacts ------------------------------------------------------------

pub fn list_artifacts(db: &Db, room_id: &str) -> RoomResult<Vec<RoomArtifactSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let mut statement = connection.prepare("select * from room_artifacts where room_id = ? order by created_at desc, id desc limit 100")?;
    let rows = statement
        .query_map([room_id], artifact_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create_artifact(
    db: &Db,
    room_id: &str,
    body: super::models::CreateRoomArtifactRequest,
) -> RoomResult<RoomArtifactSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let title = body.title.as_deref().unwrap_or("").trim().to_string();
    let kind = body.kind.as_deref().unwrap_or("").to_string();
    if title.is_empty() || kind.is_empty() {
        return Err(bad("invalid_room_artifact"));
    }
    if let Some(agent_id) = body.agent_id.as_deref().filter(|a| !a.is_empty()) {
        if !exists(
            &connection,
            "select agent_id from room_agents where room_id = ? and agent_id = ?",
            params![room_id, agent_id],
        )? {
            return Err(bad("agent_not_in_room"));
        }
    }
    let id = format!("artifact-{}", uuid());
    let created_at = timestamp();
    let payload = json_str(body.payload.as_ref());
    let agent_id = body.agent_id.clone().filter(|a| !a.is_empty());
    connection.execute(
        "insert into room_artifacts (id, room_id, agent_id, kind, title, payload, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![id, room_id, agent_id, kind, title, payload, created_at],
    )?;
    record_room_event(
        &connection,
        room_id,
        "artifact.created",
        &serde_json::json!({ "artifactId": id, "kind": kind, "title": title }),
        agent_id.as_deref(),
        None,
    )?;
    Ok(connection.query_row(
        "select * from room_artifacts where id = ?",
        [&id],
        artifact_from_row,
    )?)
}

// ----- decisions ------------------------------------------------------------

pub fn list_decisions(db: &Db, room_id: &str) -> RoomResult<Vec<RoomDecisionSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let mut statement = connection.prepare("select * from room_decisions where room_id = ? order by created_at desc, id desc limit 100")?;
    let rows = statement
        .query_map([room_id], decision_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create_decision(
    db: &Db,
    room_id: &str,
    body: super::models::CreateRoomDecisionRequest,
) -> RoomResult<RoomDecisionSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let title = body.title.as_deref().unwrap_or("").trim().to_string();
    if title.is_empty() {
        return Err(bad("invalid_room_decision"));
    }
    let status = decision_status(body.status.as_deref(), "open");
    let resolved_at = if status != "open" {
        Some(timestamp())
    } else {
        None
    };
    let id = format!("decision-{}", uuid());
    let created_at = timestamp();
    let payload = json_str(body.payload.as_ref());
    connection.execute(
        "insert into room_decisions (id, room_id, title, status, payload, created_at, resolved_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![id, room_id, title, status, payload, created_at, resolved_at],
    )?;
    record_room_event(
        &connection,
        room_id,
        "decision.created",
        &serde_json::json!({ "decisionId": id, "title": title, "status": status }),
        None,
        None,
    )?;
    Ok(connection.query_row(
        "select * from room_decisions where id = ?",
        [&id],
        decision_from_row,
    )?)
}

pub fn update_decision(
    db: &Db,
    room_id: &str,
    decision_id: &str,
    body: super::models::UpdateRoomDecisionRequest,
) -> RoomResult<RoomDecisionSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row(
            "select * from room_decisions where room_id = ? and id = ?",
            params![room_id, decision_id],
            decision_from_row,
        )
        .optional()?;
    let Some(current) = current else {
        return Err(not_found("decision_not_found"));
    };
    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or(current.title);
    if title.is_empty() {
        return Err(bad("invalid_room_decision"));
    }
    let status = decision_status(body.status.as_deref(), &current.status);
    let resolved_at = if status == "open" {
        None
    } else {
        current.resolved_at.clone().or_else(|| Some(timestamp()))
    };
    let payload = match body.payload {
        Some(value) => serde_json::to_string(&value.unwrap_or_else(|| serde_json::json!({})))
            .unwrap_or_else(|_| "{}".to_string()),
        None => serde_json::to_string(&current.payload).unwrap_or_else(|_| "{}".to_string()),
    };
    connection.execute(
        "update room_decisions set title = ?, status = ?, payload = ?, resolved_at = ? where room_id = ? and id = ?",
        params![title, status, payload, resolved_at, room_id, decision_id],
    )?;
    record_room_event(
        &connection,
        room_id,
        "decision.updated",
        &serde_json::json!({ "decisionId": decision_id, "title": title, "status": status }),
        None,
        None,
    )?;
    Ok(connection.query_row(
        "select * from room_decisions where room_id = ? and id = ?",
        params![room_id, decision_id],
        decision_from_row,
    )?)
}

// ----- handoffs -------------------------------------------------------------

pub fn list_handoffs(db: &Db, room_id: &str) -> RoomResult<Vec<RoomHandoffSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let mut statement = connection.prepare(
        "select * from room_handoffs where room_id = ? order by created_at desc, id desc limit 100",
    )?;
    let rows = statement
        .query_map([room_id], handoff_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create_handoff(
    db: &Db,
    room_id: &str,
    body: super::models::CreateRoomHandoffRequest,
) -> RoomResult<RoomHandoffSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let summary = body.summary.as_deref().unwrap_or("").trim().to_string();
    if summary.is_empty() {
        return Err(bad("invalid_room_handoff"));
    }
    let status = handoff_status(body.status.as_deref());
    let resolved_at = if status != "open" {
        Some(timestamp())
    } else {
        None
    };
    let id = format!("handoff-{}", uuid());
    let created_at = timestamp();
    let payload = json_str(body.payload.as_ref());
    let from_agent_id = body.from_agent_id.clone().filter(|a| !a.is_empty());
    let to_agent_id = body.to_agent_id.clone().filter(|a| !a.is_empty());
    connection.execute(
        "insert into room_handoffs (id, room_id, from_agent_id, to_agent_id, summary, status, payload, created_at, resolved_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, room_id, from_agent_id, to_agent_id, summary, status, payload, created_at, resolved_at],
    )?;
    record_room_event(
        &connection,
        room_id,
        "handoff.created",
        &serde_json::json!({ "handoffId": id, "summary": summary, "status": status, "toAgentId": to_agent_id }),
        to_agent_id.as_deref(),
        from_agent_id.as_deref(),
    )?;
    Ok(connection.query_row(
        "select * from room_handoffs where id = ?",
        [&id],
        handoff_from_row,
    )?)
}

pub fn update_handoff(
    db: &Db,
    room_id: &str,
    handoff_id: &str,
    body: super::models::UpdateRoomHandoffRequest,
) -> RoomResult<RoomHandoffSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row(
            "select * from room_handoffs where room_id = ? and id = ?",
            params![room_id, handoff_id],
            handoff_from_row,
        )
        .optional()?;
    let Some(current) = current else {
        return Err(not_found("handoff_not_found"));
    };
    let summary = body
        .summary
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or(current.summary);
    if summary.is_empty() {
        return Err(bad("invalid_room_handoff"));
    }
    let status = if body.status.is_some() {
        handoff_status(body.status.as_deref())
    } else {
        current.status
    };
    let resolved_at = if status == "open" {
        None
    } else {
        current.resolved_at.clone().or_else(|| Some(timestamp()))
    };
    let from_agent_id = match body.from_agent_id {
        Some(value) => value.filter(|v| !v.is_empty()),
        None => current.from_agent_id,
    };
    let to_agent_id = match body.to_agent_id {
        Some(value) => value.filter(|v| !v.is_empty()),
        None => current.to_agent_id,
    };
    let payload = match body.payload {
        Some(value) => serde_json::to_string(&value.unwrap_or_else(|| serde_json::json!({})))
            .unwrap_or_else(|_| "{}".to_string()),
        None => serde_json::to_string(&current.payload).unwrap_or_else(|_| "{}".to_string()),
    };
    connection.execute(
        "update room_handoffs set from_agent_id = ?, to_agent_id = ?, summary = ?, status = ?, payload = ?, resolved_at = ? where room_id = ? and id = ?",
        params![from_agent_id, to_agent_id, summary, status, payload, resolved_at, room_id, handoff_id],
    )?;
    record_room_event(
        &connection,
        room_id,
        "handoff.updated",
        &serde_json::json!({ "handoffId": handoff_id, "status": status }),
        None,
        None,
    )?;
    Ok(connection.query_row(
        "select * from room_handoffs where room_id = ? and id = ?",
        params![room_id, handoff_id],
        handoff_from_row,
    )?)
}

// ----- tasks ----------------------------------------------------------------

pub fn create_task(
    db: &Db,
    room_id: &str,
    body: super::models::CreateRoomTaskRequest,
) -> RoomResult<RoomTaskSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let title = body.title.as_deref().unwrap_or("").trim().to_string();
    let prompt = body.prompt.as_deref().unwrap_or("").trim().to_string();
    if title.is_empty() || prompt.is_empty() {
        return Err(bad("invalid_room_task"));
    }
    if let Some(agent_id) = body.assigned_agent_id.as_deref().filter(|a| !a.is_empty()) {
        if !exists(
            &connection,
            "select agent_id from room_agents where room_id = ? and agent_id = ?",
            params![room_id, agent_id],
        )? {
            return Err(bad("agent_not_in_room"));
        }
    }
    let now = timestamp();
    let id = format!("room-task-{}", uuid());
    let assigned = body.assigned_agent_id.clone().filter(|a| !a.is_empty());
    let status = if assigned.is_some() {
        "assigned"
    } else {
        "queued"
    };
    connection.execute(
        "insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            room_id,
            title,
            prompt,
            status,
            assigned,
            body.priority.unwrap_or(0),
            body.depends_on_task_id.clone().filter(|d| !d.is_empty()),
            body.scheduled_at.clone().filter(|s| !s.is_empty()),
            "{}",
            now,
            now,
        ],
    )?;
    record_room_event(
        &connection,
        room_id,
        "task.created",
        &serde_json::json!({ "taskId": id, "title": title, "scheduledAt": body.scheduled_at }),
        assigned.as_deref(),
        None,
    )?;
    // Runtime orchestration is invoked by the async route after this DB-only insert.
    Ok(connection.query_row(
        "select * from room_tasks where id = ?",
        [&id],
        task_from_row,
    )?)
}

pub fn retry_failed_tasks(db: &Db, room_id: &str) -> RoomResult<i64> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let now = timestamp();
    let tasks: Vec<(String, Option<String>, Option<String>)> = {
        let mut statement = connection.prepare(
            "select id, assigned_agent_id, goal_item_id from room_tasks where room_id = ? and assigned_agent_id is not null and status in ('failed', 'cancelled') order by priority desc, updated_at desc",
        )?;
        let rows = statement
            .query_map([room_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for (task_id, agent_id, goal_item_id) in &tasks {
        connection.execute(
            "update room_tasks set status = 'assigned', started_at = null, finished_at = null, updated_at = ? where id = ?",
            params![now, task_id],
        )?;
        propagate_goal_item_status_for_task(&connection, goal_item_id.as_deref(), "active")?;
        record_room_event(
            &connection,
            room_id,
            "task.retry",
            &serde_json::json!({ "taskId": task_id, "batch": true }),
            agent_id.as_deref(),
            None,
        )?;
    }
    // Runtime orchestration is invoked by the async route after this DB-only update.
    Ok(tasks.len() as i64)
}

pub fn update_task(
    db: &Db,
    room_id: &str,
    task_id: &str,
    body: super::models::UpdateRoomTaskRequest,
) -> RoomResult<RoomTaskSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row(
            "select * from room_tasks where id = ? and room_id = ?",
            params![task_id, room_id],
            task_from_row,
        )
        .optional()?;
    let Some(current) = current else {
        return Err(not_found("room_task_not_found"));
    };
    if current.status == "running" && body.status.as_deref() != Some("cancelled") {
        return Err(conflict("room_task_running"));
    }
    if let Some(agent_id) = body
        .assigned_agent_id
        .as_ref()
        .and_then(|v| v.as_deref())
        .filter(|a| !a.is_empty())
    {
        if !exists(
            &connection,
            "select agent_id from room_agents where room_id = ? and agent_id = ?",
            params![room_id, agent_id],
        )? {
            return Err(bad("agent_not_in_room"));
        }
    }
    if let Some(dep) = body
        .depends_on_task_id
        .as_ref()
        .and_then(|v| v.as_deref())
        .filter(|d| !d.is_empty())
    {
        if !exists(
            &connection,
            "select id from room_tasks where room_id = ? and id = ?",
            params![room_id, dep],
        )? {
            return Err(bad("dependency_not_found"));
        }
    }
    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(current.title);
    let prompt = body
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(current.prompt);
    // assignedAgentId precedence mirrors TS: explicit value or null.
    let assigned = match &body.assigned_agent_id {
        Some(value) => value.clone().filter(|v| !v.is_empty()),
        None => current.assigned_agent_id.clone(),
    };
    // nextStatus = body.status ?? (assignedAgentId set+truthy ? "assigned" : current.status)
    let next_status = match body.status.clone() {
        Some(s) => s,
        None => match &body.assigned_agent_id {
            Some(v) if v.as_deref().map(|x| !x.is_empty()).unwrap_or(false) => {
                "assigned".to_string()
            }
            _ => current.status.clone(),
        },
    };
    let priority = body.priority.unwrap_or(current.priority);
    let depends_on = match &body.depends_on_task_id {
        Some(value) => value.clone().filter(|v| !v.is_empty()),
        None => current.depends_on_task_id.clone(),
    };
    connection.execute(
        "update room_tasks set title = ?, prompt = ?, assigned_agent_id = ?, status = ?, priority = ?, depends_on_task_id = ?, updated_at = ? where id = ? and room_id = ?",
        params![title, prompt, assigned, next_status, priority, depends_on, timestamp(), task_id, room_id],
    )?;
    if matches!(next_status.as_str(), "done" | "failed" | "cancelled") {
        let goal_status = match next_status.as_str() {
            "done" => "completed",
            "cancelled" => "cancelled",
            _ => "failed",
        };
        propagate_goal_item_status_for_task(
            &connection,
            current.goal_item_id.as_deref(),
            goal_status,
        )?;
    }
    let event_target = match &body.assigned_agent_id {
        Some(value) => value.clone().filter(|v| !v.is_empty()),
        None => current.assigned_agent_id.clone(),
    };
    record_room_event(
        &connection,
        room_id,
        "task.updated",
        &serde_json::json!({ "taskId": task_id, "status": next_status }),
        event_target.as_deref(),
        None,
    )?;
    // Runtime orchestration is invoked by the async route after this DB-only update.
    Ok(connection.query_row(
        "select * from room_tasks where id = ?",
        [task_id],
        task_from_row,
    )?)
}

pub fn running_task_session_id(
    db: &Db,
    room_id: &str,
    task_id: &str,
) -> anyhow::Result<Option<String>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let session_id = connection
        .query_row(
            "select session_id from agent_runs where room_id = ? and task_id = ? and status = 'running' order by started_at desc, id desc limit 1",
            params![room_id, task_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    Ok(session_id)
}

pub fn cancel_task(db: &Db, room_id: &str, task_id: &str) -> RoomResult<RoomTaskSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row("select id, assigned_agent_id, goal_item_id from room_tasks where id = ? and room_id = ?", params![task_id, room_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?))
        })
        .optional()?;
    let Some((_, assigned_agent_id, goal_item_id)) = current else {
        return Err(not_found("room_task_not_found"));
    };
    // Find any running run for this task to record the event runId.
    let run_id: Option<String> = connection
        .query_row(
            "select id from agent_runs where task_id = ? and status = 'running'",
            [task_id],
            |row| row.get(0),
        )
        .optional()?;
    let now = timestamp();
    connection.execute(
        "update room_tasks set status = 'cancelled', finished_at = ?, updated_at = ? where id = ?",
        params![now, now, task_id],
    )?;
    propagate_goal_item_status_for_task(&connection, goal_item_id.as_deref(), "cancelled")?;
    record_room_event(
        &connection,
        room_id,
        "task.cancelled",
        &serde_json::json!({ "taskId": task_id }),
        assigned_agent_id.as_deref(),
        None,
    )?;
    record_room_event(
        &connection,
        room_id,
        "audit.operation",
        &serde_json::json!({ "action": "task-cancelled", "taskId": task_id, "runId": run_id }),
        assigned_agent_id.as_deref(),
        None,
    )?;
    Ok(connection.query_row(
        "select * from room_tasks where id = ?",
        [task_id],
        task_from_row,
    )?)
}

pub fn retry_task(db: &Db, room_id: &str, task_id: &str) -> RoomResult<RoomTaskSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row("select id, assigned_agent_id, goal_item_id from room_tasks where id = ? and room_id = ?", params![task_id, room_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?))
        })
        .optional()?;
    let Some((_, assigned_agent_id, goal_item_id)) = current else {
        return Err(not_found("room_task_not_found"));
    };
    let Some(agent_id) = assigned_agent_id.filter(|a| !a.is_empty()) else {
        return Err(bad("room_task_unassigned"));
    };
    connection.execute(
        "update room_tasks set status = 'assigned', started_at = null, finished_at = null, updated_at = ? where id = ?",
        params![timestamp(), task_id],
    )?;
    propagate_goal_item_status_for_task(&connection, goal_item_id.as_deref(), "active")?;
    record_room_event(
        &connection,
        room_id,
        "task.retry",
        &serde_json::json!({ "taskId": task_id }),
        Some(&agent_id),
        None,
    )?;
    record_room_event(
        &connection,
        room_id,
        "audit.operation",
        &serde_json::json!({ "action": "task-retry", "taskId": task_id }),
        Some(&agent_id),
        None,
    )?;
    // Runtime orchestration is invoked by the async route after this DB-only update.
    Ok(connection.query_row(
        "select * from room_tasks where id = ?",
        [task_id],
        task_from_row,
    )?)
}

pub fn delete_task(db: &Db, room_id: &str, task_id: &str) -> RoomResult<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row(
            "select status, title, assigned_agent_id from room_tasks where id = ? and room_id = ?",
            params![task_id, room_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((status, title, assigned_agent_id)) = current else {
        return Err(not_found("room_task_not_found"));
    };
    if status == "running" {
        return Err(conflict("room_task_running"));
    }
    connection.execute("delete from room_tasks where id = ?", [task_id])?;
    connection.execute(
        "delete from agent_runs where task_id = ? and status != 'running'",
        [task_id],
    )?;
    record_room_event(
        &connection,
        room_id,
        "task.deleted",
        &serde_json::json!({ "taskId": task_id, "title": title }),
        assigned_agent_id.as_deref(),
        None,
    )?;
    Ok(())
}

// ----- runs (diff / merge / reject) -----------------------------------------

fn read_run(
    connection: &rusqlite::Connection,
    room_id: &str,
    run_id: &str,
) -> rusqlite::Result<Option<AgentRunSummary>> {
    connection
        .query_row(
            "select * from agent_runs where id = ? and room_id = ?",
            params![run_id, room_id],
            run_from_row,
        )
        .optional()
}

pub fn maybe_create_run_merge_approval(
    state: &crate::state::AppState,
    room_id: &str,
    run_id: &str,
) -> RoomResult<Option<RoomRunMergeApprovalRequest>> {
    let connection = state.db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(run) = read_run(&connection, room_id, run_id)? else {
        return Err(not_found("agent_run_not_found"));
    };

    let merge_strategy: Option<String> = connection
        .query_row(
            "select agent_groups.merge_strategy from rooms join agent_groups on agent_groups.id = rooms.group_id where rooms.id = ?",
            [room_id],
            |row| row.get(0),
        )
        .optional()?;
    let strategy_requires_approval = merge_strategy
        .as_deref()
        .map(|value| value.to_lowercase().contains("approval"))
        .unwrap_or(false);
    let agent_requires_approval = !agent_can_merge_changes(&connection, &run.agent_id)?;
    if !strategy_requires_approval && !agent_requires_approval {
        return Ok(None);
    }

    let payload = serde_json::json!({ "roomId": room_id, "runId": run_id });
    if crate::api::approvals::store::approval_always_allowed(&state.db, "room-run-merge", &payload)?
    {
        return Ok(None);
    }

    let reason = if agent_requires_approval {
        "agent permission does not allow direct merge".to_string()
    } else {
        format!(
            "group merge strategy is {}",
            merge_strategy.unwrap_or_else(|| "approval-required".to_string())
        )
    };
    let risk = if agent_requires_approval {
        "high"
    } else {
        "medium"
    };
    let approval = crate::api::approvals::store::create_approval_with_notification(
        state,
        "room-run-merge",
        risk,
        "Room run merge requires approval",
        "Apply an Agent run patch back into the project workspace.",
        &format!("room={room_id}\nrun={run_id}\nreason={reason}"),
        &payload,
    )?;
    record_room_event(
        &connection,
        room_id,
        "audit.operation",
        &serde_json::json!({
            "action": "merge-approval-requested",
            "runId": run_id,
            "approvalId": approval.id.clone(),
            "reason": reason
        }),
        Some(&run.agent_id),
        None,
    )?;
    let _ = create_decision(
        &state.db,
        room_id,
        CreateRoomDecisionRequest {
            title: Some("Merge approval requested".to_string()),
            status: Some("open".to_string()),
            payload: Some(serde_json::json!({
                "approvalId": approval.id.clone(),
                "runId": run_id,
                "reason": reason
            })),
        },
    );
    if let Some(session_id) = run.session_id.as_deref() {
        let _ = append_message_card(
            &connection,
            session_id,
            None,
            "approval",
            "Merge approval requested",
            &serde_json::json!({
                "approvalId": approval.id.clone(),
                "roomId": room_id,
                "runId": run_id,
                "reason": reason,
                "risk": approval.risk.clone()
            }),
        );
    }
    Ok(Some(RoomRunMergeApprovalRequest { approval }))
}

fn agent_can_merge_changes(
    connection: &rusqlite::Connection,
    agent_id: &str,
) -> rusqlite::Result<bool> {
    let row: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            "select permissions, permission_profile_id from agents where id = ?",
            [agent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((permissions_raw, profile_id)) = row else {
        return Ok(false);
    };
    let permissions = resolved_agent_permissions(permissions_raw.as_deref(), profile_id.as_deref());
    Ok(permissions
        .get("canMergeChanges")
        .and_then(|value| value.as_bool())
        .unwrap_or(false))
}

fn resolved_agent_permissions(
    permissions_raw: Option<&str>,
    profile_id: Option<&str>,
) -> serde_json::Value {
    let mut result = serde_json::json!({
        "canWriteFiles": true,
        "canRunCommands": true,
        "canUseTerminal": true,
        "canCreatePreview": true,
        "canWriteSharedWorkspace": true,
        "canRequestApproval": true,
        "canTriggerAgents": false,
        "canMergeChanges": false
    });
    merge_permissions(&mut result, permissions_raw.and_then(parse_json_object));
    let profile = match profile_id {
        Some("read-only") => Some(serde_json::json!({
            "canWriteFiles": false,
            "canRunCommands": false,
            "canUseTerminal": false,
            "canCreatePreview": false,
            "canWriteSharedWorkspace": false,
            "canRequestApproval": true,
            "canTriggerAgents": false,
            "canMergeChanges": false
        })),
        Some("workspace-write") => Some(serde_json::json!({
            "canWriteFiles": true,
            "canRunCommands": false,
            "canUseTerminal": false,
            "canCreatePreview": false,
            "canWriteSharedWorkspace": true,
            "canRequestApproval": true,
            "canTriggerAgents": false,
            "canMergeChanges": false
        })),
        Some("developer") => Some(serde_json::json!({
            "canWriteFiles": true,
            "canRunCommands": true,
            "canUseTerminal": true,
            "canCreatePreview": true,
            "canWriteSharedWorkspace": true,
            "canRequestApproval": true,
            "canTriggerAgents": false,
            "canMergeChanges": false
        })),
        Some("maintainer") => Some(serde_json::json!({
            "canWriteFiles": true,
            "canRunCommands": true,
            "canUseTerminal": true,
            "canCreatePreview": true,
            "canWriteSharedWorkspace": true,
            "canRequestApproval": true,
            "canTriggerAgents": true,
            "canMergeChanges": true
        })),
        Some("danger-full-access") => Some(serde_json::json!({})),
        _ => None,
    };
    merge_permissions(&mut result, profile);
    result
}

fn parse_json_object(text: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .filter(|value| value.is_object())
}

fn merge_permissions(target: &mut serde_json::Value, source: Option<serde_json::Value>) {
    let Some(source) = source else { return };
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
}

/// Mirror TS finishAgentRun (subset): close the running agent_run for `session_id` and propagate
/// the derived status to its room_task. Used by the codex runner completion hook. Best-effort.
pub fn finish_agent_run_for_session(
    db: &Db,
    session_id: &str,
    exit_code: Option<i64>,
    stopped: bool,
) -> anyhow::Result<Option<String>> {
    let connection = db.open_read_write()?;
    if !table_exists_rt(&connection, "agent_runs")? {
        return Ok(None);
    }
    let status = if stopped {
        "stopped"
    } else if exit_code == Some(0) {
        "done"
    } else {
        "failed"
    };
    let now = timestamp();
    let run_info: Option<(Option<String>, String, String, String)> = connection
        .query_row(
            "select task_id, room_id, agent_id, id from agent_runs where session_id = ? and status = 'running' order by started_at desc, id desc limit 1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    connection.execute(
        "update agent_runs set status = ?, exit_code = ?, finished_at = ? where session_id = ? and status = 'running'",
        params![status, exit_code, now, session_id],
    )?;
    let mut finished_room_id: Option<String> = None;
    if let Some((task_id, room_id_for_message, agent_id_for_message, run_id_for_message)) = run_info
    {
        if status != "stopped" {
            append_room_agent_message_from_child_session(
                &connection,
                &room_id_for_message,
                &agent_id_for_message,
                &run_id_for_message,
                task_id.as_deref(),
                session_id,
                &now,
            )?;
        }
        record_room_event(
            &connection,
            &room_id_for_message,
            match status {
                "done" => "agent.completed",
                "stopped" => "agent.stopped",
                _ => "agent.failed",
            },
            &serde_json::json!({
                "runId": run_id_for_message,
                "taskId": task_id,
                "exitCode": exit_code
            }),
            Some(&agent_id_for_message),
            None,
        )?;
        if let Some(task_id) = task_id {
            let task_status = match status {
                "done" => "done",
                "stopped" => "cancelled",
                _ => "failed",
            };
            connection.execute(
                "update room_tasks set status = ?, finished_at = ?, updated_at = ? where id = ?",
                params![task_status, now, now, task_id],
            )?;
            let goal_status = match task_status {
                "done" => "completed",
                "cancelled" => "cancelled",
                _ => "failed",
            };
            let goal_item_id: Option<String> = connection
                .query_row(
                    "select goal_item_id from room_tasks where id = ?",
                    [&task_id],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            propagate_goal_item_status_for_task(&connection, goal_item_id.as_deref(), goal_status)
                .map_err(|error| anyhow::anyhow!(error.code))?;
        }
        // When no more runs are active for the room, pause the room parent session (mirror TS).
        let active: i64 = connection
            .query_row(
                "select count(*) from agent_runs where room_id = ? and status = 'running'",
                [&room_id_for_message],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);
        if active == 0 {
            set_room_parent_session_status(&connection, &room_id_for_message, "paused", &now)?;
        }
        finished_room_id = Some(room_id_for_message);
    }
    Ok(finished_room_id)
}

fn append_room_agent_message_from_child_session(
    connection: &rusqlite::Connection,
    room_id: &str,
    agent_id: &str,
    run_id: &str,
    task_id: Option<&str>,
    child_session_id: &str,
    now: &str,
) -> rusqlite::Result<()> {
    let room_session_id: Option<String> = connection
        .query_row(
            "select session_id from rooms where id = ?",
            [room_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let Some(room_session_id) = room_session_id else {
        return Ok(());
    };
    let agent_name = connection
        .query_row("select name from agents where id = ?", [agent_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()?
        .unwrap_or_else(|| agent_id.to_string());
    let latest_assistant: Option<String> = connection
        .query_row(
            "select content from messages where session_id = ? and role = 'assistant' order by created_at desc, id desc limit 1",
            [child_session_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(text) = latest_assistant
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    else {
        return Ok(());
    };
    connection.execute_batch(
        "create table if not exists messages (
          id text primary key,
          session_id text not null,
          role text not null,
          content text not null,
          reply_to_message_id text,
          created_at text not null
        );",
    )?;
    let content = format!(
        "{}:
{}",
        agent_name, text
    );
    let message_id = format!("msg-{}", uuid());
    connection.execute(
        "insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, 'assistant', ?, null, ?)",
        params![message_id, room_session_id, content, now],
    )?;
    connection.execute(
        "update sessions set updated_at = ? where id = ?",
        params![now, room_session_id],
    )?;
    record_room_event(
        connection,
        room_id,
        "agent.message",
        &serde_json::json!({ "runId": run_id, "taskId": task_id, "sessionId": child_session_id, "messageId": message_id, "content": content, "agentId": agent_id }),
        Some(agent_id),
        None,
    )?;
    Ok(())
}

fn append_message_card(
    connection: &rusqlite::Connection,
    session_id: &str,
    message_id: Option<&str>,
    card_type: &str,
    title: &str,
    payload: &serde_json::Value,
) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        create table if not exists message_cards (
          id text primary key,
          session_id text not null,
          message_id text,
          type text not null,
          title text not null,
          payload text not null,
          created_at text not null
        );
        create index if not exists message_cards_session_created_idx on message_cards(session_id, created_at desc, id desc);
        ",
    )?;
    let id = format!("card-{}", uuid());
    connection.execute(
        "insert into message_cards (id, session_id, message_id, type, title, payload, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            session_id,
            message_id,
            card_type,
            title,
            serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()),
            timestamp()
        ],
    )?;
    Ok(())
}

fn table_exists_rt(connection: &rusqlite::Connection, table: &str) -> rusqlite::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub fn run_workspace_path(
    db: &Db,
    room_id: &str,
    run_id: &str,
) -> RoomResult<(AgentRunSummary, Option<String>)> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let run = read_run(&connection, room_id, run_id)?;
    let Some(run) = run else {
        return Err(not_found("agent_run_not_found"));
    };
    let workspace = run.workspace_path.clone();
    Ok((run, workspace))
}

/// Reject a run merge (DB-only; mirrors POST /runs/:runId/reject).
pub fn reject_run_merge(db: &Db, room_id: &str, run_id: &str) -> RoomResult<AgentRunSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let run = read_run(&connection, room_id, run_id)?;
    let Some(run) = run else {
        return Err(not_found("agent_run_not_found"));
    };
    let project_id: Option<String> = connection
        .query_row(
            "select project_id from rooms where id = ?",
            [room_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let now = timestamp();
    connection.execute(
        "insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at)
         values (?, ?, ?, ?, 'rejected', 'Rejected by user', ?, ?)
         on conflict(run_id) do update set status = 'rejected', summary = excluded.summary, updated_at = excluded.updated_at",
        params![run_id, room_id, project_id, run.workspace_path.clone().unwrap_or_default(), now, now],
    )?;
    record_room_event(
        &connection,
        room_id,
        "audit.operation",
        &serde_json::json!({ "action": "merge-rejected", "runId": run_id }),
        Some(run.agent_id.as_str()),
        None,
    )?;
    Ok(run)
}

// ----- room run engine (start + merge) --------------------------------------

/// Synchronous git invocation mirroring runGitSync(). Returns (exit_code, stdout, stderr).
fn git_sync(cwd: &str, args: &[&str], input: Option<&str>) -> (Option<i32>, String, String) {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return (None, String::new(), error.to_string()),
    };
    if let Some(input) = input {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(input.as_bytes());
        }
    }
    // Drop stdin so git sees EOF.
    drop(child.stdin.take());
    match child.wait_with_output() {
        Ok(output) => (
            output.status.code(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        ),
        Err(error) => (None, String::new(), error.to_string()),
    }
}

fn set_room_parent_session_status(
    connection: &rusqlite::Connection,
    room_id: &str,
    status: &str,
    now: &str,
) -> rusqlite::Result<()> {
    let session_id: Option<String> = connection
        .query_row(
            "select session_id from rooms where id = ?",
            [room_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if let Some(session_id) = session_id {
        if table_exists_rt(connection, "sessions")? {
            connection.execute(
                "update sessions set status = ?, updated_at = ? where id = ?",
                params![status, now, session_id],
            )?;
        }
    }
    Ok(())
}

/// Outcome of preparing a room task run: everything the async handler needs to launch codex.
pub struct RoomRunLaunch {
    pub run: AgentRunSummary,
    pub session: crate::api::sessions::models::SessionSummary,
    pub prompt: String,
    pub cwd: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reset_output: bool,
    pub task_prompt: String,
}

struct RoomRunWorkspace {
    #[allow(dead_code)]
    root: String,
    shared: String,
    agent_workspace: String,
    project_path: Option<String>,
}

/// Mirror ensureRoomRunWorkspace(): isolated agent workspace + shared room workspace, optionally a
/// git worktree of the bound project. The root matches TS roomWorkspaceDataPath():
/// `data_dir/sessions/<room-parent-session>/room` when the room has a parent session,
/// falling back to legacy `data_dir/rooms/<roomId>`.

fn room_workspace_data_path(db: &Db, room_id: &str) -> std::path::PathBuf {
    if let Ok(connection) = db.open_read_write() {
        if let Ok(Some(session_id)) = connection
            .query_row(
                "select session_id from rooms where id = ?",
                [room_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(|value| value.flatten())
        {
            if !session_id.is_empty() {
                return db.data_dir.join("sessions").join(session_id).join("room");
            }
        }
    }
    db.data_dir.join("rooms").join(room_id)
}

fn copy_dir_missing(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ty = entry.file_type()?;
        if to.exists() {
            continue;
        }
        if ty.is_dir() {
            copy_dir_missing(&from, &to)?;
        } else if ty.is_file() {
            std::fs::copy(&from, &to)?;
        } else if ty.is_symlink() {
            #[cfg(unix)]
            {
                let target = std::fs::read_link(&from)?;
                let _ = std::os::unix::fs::symlink(target, &to);
            }
        }
    }
    Ok(())
}

fn migrate_legacy_room_workspace(db: &Db, room_id: &str, target: &std::path::Path) {
    let source = db.data_dir.join("rooms").join(room_id);
    if source == target || !source.exists() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut migrated = false;
    if !target.exists() {
        match std::fs::rename(&source, target) {
            Ok(()) => migrated = true,
            Err(_) => {
                if copy_dir_missing(&source, target).is_ok() {
                    migrated = true;
                }
            }
        }
    } else if copy_dir_missing(&source, target).is_ok() {
        migrated = true;
    }
    if !migrated {
        return;
    }
    let old_prefix = format!("{}/", source.display());
    let new_prefix = format!("{}/", target.display());
    if let Ok(connection) = db.open_read_write() {
        if table_exists_rt(&connection, "agent_runs").unwrap_or(false) {
            if let Ok(mut statement) = connection.prepare("select id, workspace_path from agent_runs where room_id = ? and workspace_path is not null and workspace_path != ''") {
                if let Ok(rows) = statement.query_map([room_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
                    for row in rows.flatten() {
                        let (id, path) = row;
                        let next = if PathBuf::from(&path) == source { Some(target.display().to_string()) } else if path.starts_with(&old_prefix) { Some(format!("{}{}", new_prefix, &path[old_prefix.len()..])) } else { None };
                        if let Some(next) = next { let _ = connection.execute("update agent_runs set workspace_path = ? where id = ?", params![next, id]); }
                    }
                }
            }
        }
        if table_exists_rt(&connection, "room_agent_threads").unwrap_or(false) {
            if let Ok(mut statement) = connection.prepare("select agent_id, workspace_path from room_agent_threads where room_id = ? and workspace_path is not null and workspace_path != ''") {
                if let Ok(rows) = statement.query_map([room_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
                    let now = timestamp();
                    for row in rows.flatten() {
                        let (agent_id, path) = row;
                        let next = if PathBuf::from(&path) == source { Some(target.display().to_string()) } else if path.starts_with(&old_prefix) { Some(format!("{}{}", new_prefix, &path[old_prefix.len()..])) } else { None };
                        if let Some(next) = next { let _ = connection.execute("update room_agent_threads set workspace_path = ?, updated_at = ? where room_id = ? and agent_id = ?", params![next, now, room_id, agent_id]); }
                    }
                }
            }
        }
        if table_exists_rt(&connection, "sessions").unwrap_or(false) {
            if let Ok(mut statement) = connection.prepare("select id, workspace_path from sessions where room_id = ? and workspace_path is not null and workspace_path != ''") {
                if let Ok(rows) = statement.query_map([room_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
                    let now = timestamp();
                    for row in rows.flatten() {
                        let (id, path) = row;
                        let next = if PathBuf::from(&path) == source { Some(target.display().to_string()) } else if path.starts_with(&old_prefix) { Some(format!("{}{}", new_prefix, &path[old_prefix.len()..])) } else { None };
                        if let Some(next) = next { let _ = connection.execute("update sessions set workspace_path = ?, updated_at = ? where id = ?", params![next, now, id]); }
                    }
                }
            }
        }
    }
}

fn ensure_room_run_workspace(
    db: &Db,
    room_id: &str,
    agent_id: &str,
    workspace_mode: &str,
    task_id: &str,
    project_path: Option<&str>,
) -> std::io::Result<RoomRunWorkspace> {
    let root = room_workspace_data_path(db, room_id);
    migrate_legacy_room_workspace(db, room_id, &root);
    let shared = root.join("shared");
    let agent_workspace = root.join("agents").join(agent_id);
    std::fs::create_dir_all(&shared)?;
    std::fs::create_dir_all(&agent_workspace)?;
    let agent_workspace_str = agent_workspace.display().to_string();
    // Initialize a git repo in the isolated agent workspace so diffs work even without a project.
    if !agent_workspace.join(".git").exists() {
        let _ = git_sync(&agent_workspace_str, &["init", "-q"], None);
    }
    let mut workspace = RoomRunWorkspace {
        root: root.display().to_string(),
        shared: shared.display().to_string(),
        agent_workspace: agent_workspace_str.clone(),
        project_path: None,
    };
    let Some(project_path) = project_path.filter(|value| !value.is_empty()) else {
        return Ok(workspace);
    };
    // Confirm the project path is a git toplevel.
    let (code, stdout, _) = git_sync(project_path, &["rev-parse", "--show-toplevel"], None);
    let toplevel = stdout.trim();
    if code != Some(0) || std::path::Path::new(toplevel) != std::path::Path::new(project_path) {
        // Not a clean git toplevel; fall back to the isolated workspace.
        return Ok(workspace);
    }
    workspace.project_path = Some(project_path.to_string());
    let use_worktree = workspace_mode != "shared-write" && workspace_mode != "merge-workspace";
    if !use_worktree {
        return Ok(workspace);
    }
    let worktree = root.join("worktrees").join(format!("{agent_id}-{task_id}"));
    if !worktree.exists() {
        if let Some(parent) = worktree.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let branch = format!(
            "codex-room/{}/{}/{}",
            &room_id.chars().take(12).collect::<String>(),
            &agent_id.chars().take(18).collect::<String>(),
            task_id
                .chars()
                .rev()
                .take(8)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>(),
        );
        let worktree_str = worktree.display().to_string();
        let (code, _, _) = git_sync(
            project_path,
            &["worktree", "add", "-B", &branch, &worktree_str, "HEAD"],
            None,
        );
        if code != Some(0) {
            return Ok(workspace);
        }
    }
    workspace.agent_workspace = worktree.display().to_string();
    Ok(workspace)
}

fn group_context_for_room(connection: &rusqlite::Connection, group_id: Option<&str>) -> String {
    let Some(group_id) = group_id.filter(|value| !value.is_empty()) else {
        return String::new();
    };
    let row = connection
        .query_row(
            "select name, description, collaboration_rules, event_routing_rules, approval_policy, merge_strategy from agent_groups where id = ?",
            [group_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let Some((name, description, collaboration, routing, approval, merge)) = row else {
        return String::new();
    };
    let mut lines = vec!["Group context:".to_string(), format!("- group: {name}")];
    if let Some(description) = description.filter(|v| !v.trim().is_empty()) {
        lines.push(format!("- description: {description}"));
    }
    if let Some(collaboration) = collaboration.filter(|v| !v.trim().is_empty()) {
        lines.push(format!("- collaboration rules: {collaboration}"));
    }
    if let Some(routing) = routing.filter(|v| !v.trim().is_empty()) {
        lines.push(format!("- event routing rules: {routing}"));
    }
    lines.push(format!(
        "- approval policy: {}",
        approval.unwrap_or_else(|| "bounded".to_string())
    ));
    lines.push(format!(
        "- merge strategy: {}",
        merge.unwrap_or_else(|| "approval-required".to_string())
    ));
    lines.join("\n")
}

fn recent_room_context(connection: &rusqlite::Connection, room_id: &str) -> String {
    let mut statement = match connection.prepare("select type, payload, created_at from room_events where room_id = ? order by created_at desc, id desc limit 8") {
        Ok(statement) => statement,
        Err(_) => return String::new(),
    };
    let rows: Vec<(String, Option<String>, String)> =
        match statement.query_map([room_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))) {
            Ok(rows) => rows.collect::<Result<Vec<_>, _>>().unwrap_or_default(),
            Err(_) => return String::new(),
        };
    if rows.is_empty() {
        return String::new();
    }
    let mut lines = vec!["Recent room events:".to_string()];
    for (event_type, payload, created_at) in rows.into_iter().rev() {
        let payload: serde_json::Value = payload
            .and_then(|p| serde_json::from_str(&p).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let detail = payload
            .get("content")
            .and_then(|v| v.as_str())
            .or_else(|| payload.get("title").and_then(|v| v.as_str()))
            .or_else(|| payload.get("taskId").and_then(|v| v.as_str()))
            .map(str::to_string)
            .unwrap_or(created_at);
        lines.push(format!("- {event_type}: {detail}"));
    }
    lines.join("\n")
}

fn read_room_agent_thread(
    connection: &rusqlite::Connection,
    room_id: &str,
    agent_id: &str,
) -> Option<(String, Option<String>)> {
    if !table_exists_rt(connection, "room_agent_threads").unwrap_or(false) {
        return None;
    }
    connection
        .query_row(
            "select codex_session_id, workspace_path from room_agent_threads where room_id = ? and agent_id = ?",
            params![room_id, agent_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|(codex, workspace)| codex.map(|codex| (codex, workspace)))
}

/// Port of startRoomTaskRun() through the DB-write boundary. Validates the task/agent/role,
/// builds the workspace + prompt, inserts the agent_runs row, flips the task to running, records
/// the agent.started event, and returns everything the async handler needs to launch codex.
pub fn start_room_task(db: &Db, room_id: &str, task_id: &str) -> RoomResult<RoomRunLaunch> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;

    // room
    let room = connection
        .query_row(
            "select id, group_id, project_id, shared_context from rooms where id = ?",
            [room_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((_room_id, group_id, project_id, shared_context)) = room else {
        return Err(not_found("room_not_found"));
    };

    // task
    let task = connection
        .query_row(
            "select status, assigned_agent_id, depends_on_task_id, goal_item_id, title, prompt from room_tasks where id = ? and room_id = ?",
            params![task_id, room_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((task_status, assigned_agent_id, depends_on, goal_item_id, task_title, task_prompt)) =
        task
    else {
        return Err(not_found("room_task_not_found"));
    };
    if task_status == "running" || task_status == "done" {
        return Err(bad("room_task_not_startable"));
    }
    if let Some(dependency) = depends_on.filter(|value| !value.is_empty()) {
        let dep_status: Option<String> = connection
            .query_row(
                "select status from room_tasks where id = ? and room_id = ?",
                params![dependency, room_id],
                |row| row.get(0),
            )
            .optional()?;
        if dep_status.as_deref() != Some("done") {
            return Err(bad("room_task_dependency_pending"));
        }
    }
    let Some(assigned_agent_id) = assigned_agent_id.filter(|value| !value.is_empty()) else {
        return Err(bad("room_task_unassigned"));
    };
    if !exists(
        &connection,
        "select agent_id from room_agents where room_id = ? and agent_id = ?",
        params![room_id, assigned_agent_id],
    )? {
        return Err(bad("room_agent_not_member"));
    }

    // agent
    let agent = connection
        .query_row(
            "select role_id, extra_prompt, provider_id, model, workspace_mode, permissions, permission_profile_id, max_concurrent_runs, enabled, name from agents where id = ?",
            [&assigned_agent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;
    let Some((
        role_id,
        extra_prompt,
        agent_provider_id,
        agent_model,
        workspace_mode,
        _permissions,
        _permission_profile_id,
        max_concurrent_runs,
        enabled,
        agent_name,
    )) = agent
    else {
        return Err(not_found("agent_not_found"));
    };
    if enabled != 1 {
        return Err(bad("agent_disabled"));
    }
    let workspace_mode =
        workspace_mode.unwrap_or_else(|| "isolated-worktree-with-shared-room".to_string());

    // concurrency: per-room (group.max_concurrent_agents) and per-agent (agent.maxConcurrentRuns)
    if let Some(group_id) = group_id.as_deref().filter(|value| !value.is_empty()) {
        let max_agents: i64 = connection
            .query_row(
                "select max_concurrent_agents from agent_groups where id = ?",
                [group_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten()
            .unwrap_or(1)
            .max(1);
        let running_room: i64 = connection
            .query_row(
                "select count(*) from agent_runs where room_id = ? and status = 'running'",
                [room_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);
        if running_room >= max_agents {
            return Err(conflict("room_concurrency_limit"));
        }
    }
    let max_runs = max_concurrent_runs.unwrap_or(1).max(1);
    let running_agent: i64 = connection
        .query_row(
            "select count(*) from agent_runs where agent_id = ? and status = 'running'",
            [&assigned_agent_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    if running_agent >= max_runs {
        return Err(conflict("agent_concurrency_limit"));
    }

    // role
    let system_prompt: Option<String> = connection
        .query_row(
            "select system_prompt from agent_roles where id = ?",
            [&role_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(system_prompt) = system_prompt else {
        return Err(not_found("agent_role_not_found"));
    };

    // provider/model selection (mirror TS: agent provider or first provider)
    let provider_id = match agent_provider_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        Some(provider_id) => Some(provider_id.to_string()),
        None => connection
            .query_row(
                "select id from providers order by name asc, id asc limit 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten(),
    };
    let provider_default_model: Option<String> = match provider_id.as_deref() {
        Some(provider_id) => connection
            .query_row(
                "select default_model from providers where id = ?",
                [provider_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten(),
        None => None,
    };
    let selected_model = agent_model
        .filter(|value| !value.trim().is_empty())
        .or(provider_default_model.filter(|value| !value.trim().is_empty()));

    // project path for worktree
    let project_path: Option<String> = match project_id.as_deref().filter(|value| !value.is_empty())
    {
        Some(project_id) => connection
            .query_row(
                "select workspace_path from projects where id = ?",
                [project_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten(),
        None => None,
    };

    // workspace
    let workspace = ensure_room_run_workspace(
        db,
        room_id,
        &assigned_agent_id,
        &workspace_mode,
        task_id,
        project_path.as_deref(),
    )
    .map_err(|error| RoomError::new(500, error.to_string()))?;

    // existing codex thread (only reuse if workspace matches)
    let existing_thread = read_room_agent_thread(&connection, room_id, &assigned_agent_id);
    let existing_thread_id = existing_thread
        .as_ref()
        .and_then(|(codex, workspace_path)| match workspace_path {
            Some(path)
                if std::path::Path::new(path)
                    != std::path::Path::new(&workspace.agent_workspace) =>
            {
                None
            }
            _ => Some(codex.clone()),
        });
    let skipped_thread_reason = match (&existing_thread, &existing_thread_id) {
        (Some((codex, Some(path))), None) => format!(
            "Previous Codex thread {codex} used workspace {path}; this run uses {}, so a new thread is started to avoid cwd confusion.",
            workspace.agent_workspace
        ),
        _ => String::new(),
    };

    // session row (conversation_type=agent, bound to room)
    let now = timestamp();
    let session_id = format!("task-{}", uuid());
    let kind = if project_id.as_deref().filter(|v| !v.is_empty()).is_some() {
        "project"
    } else {
        "scratch"
    };
    let title: String = format!("{agent_name}: {task_title}")
        .chars()
        .take(80)
        .collect();
    if !table_exists_rt(&connection, "sessions")? {
        return Err(RoomError::new(500, "sessions_table_missing"));
    }
    connection.execute(
        "insert into sessions (id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at) values (?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?, 1, null, 'running', ?, ?)",
        params![
            session_id,
            kind,
            room_id,
            title,
            project_id.clone().filter(|v| !v.is_empty()),
            workspace.agent_workspace,
            provider_id,
            selected_model,
            existing_thread_id,
            now,
            now,
        ],
    )?;

    // agent_runs row
    let run_id = format!("agent-run-{}", uuid());
    let goal_id: Option<String> = match goal_item_id.as_deref().filter(|value| !value.is_empty()) {
        Some(goal_item_id) => connection
            .query_row(
                "select goal_id from goal_items where id = ?",
                [goal_item_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten(),
        None => None,
    };
    connection.execute(
        "insert into agent_runs (id, room_id, agent_id, task_id, goal_id, session_id, status, provider_id, model, workspace_path, started_at) values (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)",
        params![run_id, room_id, assigned_agent_id, task_id, goal_id, session_id, provider_id, selected_model, workspace.agent_workspace, now],
    )?;
    connection.execute(
        "update room_tasks set status = 'running', started_at = ?, updated_at = ? where id = ?",
        params![now, now, task_id],
    )?;
    set_room_parent_session_status(&connection, room_id, "running", &now)?;
    record_room_event(
        &connection,
        room_id,
        "agent.started",
        &serde_json::json!({ "runId": run_id, "taskId": task_id, "sessionId": session_id }),
        None,
        Some(&assigned_agent_id),
    )?;

    // workspace context block (mirror TS)
    let is_worktree = workspace
        .project_path
        .as_deref()
        .map(|p| std::path::Path::new(p) != std::path::Path::new(&workspace.agent_workspace))
        .unwrap_or(false);
    let mut workspace_lines = vec!["Room/project workspace map:".to_string()];
    match project_id.as_deref().filter(|v| !v.is_empty()) {
        Some(project_id) => workspace_lines.push(format!("- bound project id: {project_id}")),
        None => {
            workspace_lines.push("- bound project: none. This is a no-project Room.".to_string())
        }
    }
    if let Some(project_path) = workspace.project_path.as_deref() {
        workspace_lines.push(format!("- bound project directory: {project_path}"));
    }
    workspace_lines.push(format!(
        "- current agent working directory: {}",
        workspace.agent_workspace
    ));
    if is_worktree {
        workspace_lines.push("- current agent working directory is an isolated git worktree for the bound project. Treat this worktree as the project workspace for code changes.".to_string());
    }
    if project_id.as_deref().filter(|v| !v.is_empty()).is_none() {
        workspace_lines.push("- no real project directory is bound to this Room. Treat the current agent working directory as a scratch workspace, not as the Codex Web source repository.".to_string());
    }
    if project_id.as_deref().filter(|v| !v.is_empty()).is_some() && workspace.project_path.is_none()
    {
        workspace_lines.push("- the bound project could not be mounted as an independent git worktree. Treat the current agent working directory as a fallback scratch workspace.".to_string());
    }
    workspace_lines.push(format!("- room shared workspace: {}", workspace.shared));
    workspace_lines.push("- Use the current agent working directory for files you create or edit. Use the room shared workspace only for shared notes, plans, reports, handoffs, and decisions.".to_string());
    workspace_lines.push("- Do not treat any ancestor directory or parent Git repository as the project unless it is explicitly listed above as the bound project directory.".to_string());
    let workspace_context = workspace_lines.join("\n");

    // prompt assembly (mirror TS join order, dropping empty parts)
    let group_context = group_context_for_room(&connection, group_id.as_deref());
    let recent_context = recent_room_context(&connection, room_id);
    let mut parts: Vec<String> = Vec::new();
    parts.push(system_prompt);
    if let Some(extra) = extra_prompt.filter(|value| !value.trim().is_empty()) {
        parts.push(format!("\n\nAgent extra instructions:\n{extra}"));
    }
    if !group_context.is_empty() {
        parts.push(group_context);
    }
    if let Some(shared) = shared_context.filter(|value| !value.trim().is_empty()) {
        parts.push(format!("Room shared context:\n{shared}"));
    }
    if !recent_context.is_empty() {
        parts.push(recent_context);
    }
    if !skipped_thread_reason.is_empty() {
        parts.push(skipped_thread_reason);
    }
    parts.push(format!("\n\n{workspace_context}"));
    parts.push(format!("\n\nTask:\n{task_prompt}"));
    let prompt = parts
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    let run = read_run(&connection, room_id, &run_id)?
        .ok_or_else(|| RoomError::new(500, "agent_run_create_failed"))?;
    let session = crate::api::sessions::models::SessionSummary {
        id: session_id,
        kind: kind.to_string(),
        conversation_type: "agent".to_string(),
        room_id: Some(room_id.to_string()),
        direct_agent_id: Some(assigned_agent_id),
        title,
        project_id: project_id.filter(|v| !v.is_empty()),
        workspace_path: workspace.agent_workspace.clone(),
        provider_id: run.provider_id.clone(),
        model: run.model.clone(),
        codex_session_id: existing_thread_id.clone(),
        notifications_enabled: true,
        show_message_usage: None,
        status: "running".to_string(),
        created_at: Some(now.clone()),
        updated_at: now,
        goal: None,
    };
    Ok(RoomRunLaunch {
        run,
        session,
        prompt,
        cwd: workspace.agent_workspace,
        provider_id,
        model: selected_model,
        reset_output: existing_thread_id.is_none(),
        task_prompt,
    })
}

/// Port of applyRoomRunMerge(): git-apply the agent worktree diff back to the bound project,
/// gated by the optional project check-command. Mirrors the TS error codes and return shape.
pub fn apply_run_merge(
    db: &Db,
    room_id: &str,
    run_id: &str,
) -> RoomResult<super::models::RoomRunMergeResponse> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let run = read_run(&connection, room_id, run_id)?;
    let Some(run) = run else {
        return Err(not_found("agent_run_not_found"));
    };
    // bound project
    let project_id: Option<String> = connection
        .query_row(
            "select project_id from rooms where id = ?",
            [room_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let Some(project_id) = project_id.filter(|value| !value.is_empty()) else {
        return Err(bad("room_project_not_found"));
    };
    let project = connection
        .query_row(
            "select workspace_path, check_command from projects where id = ?",
            [&project_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?;
    let Some((project_workspace, check_command)) = project else {
        return Err(bad("room_project_not_found"));
    };
    let project_path = project_workspace.unwrap_or_default();
    let workspace_path = run.workspace_path.clone().unwrap_or_default();

    // collect the worktree diff
    let (diff_code, diff_out, diff_err) = if workspace_path.is_empty() {
        (Some(1), String::new(), "workspace_not_found".to_string())
    } else {
        git_sync(&workspace_path, &["diff", "--"], None)
    };
    if diff_code != Some(0) || diff_out.trim().is_empty() {
        let message = if diff_err.trim().is_empty() {
            "empty_diff".to_string()
        } else {
            diff_err
        };
        return Err(bad_with_message(&message));
    }

    // pre-flight check apply
    let (check_code, _check_out, check_err) =
        git_sync(&project_path, &["apply", "--check", "-"], Some(&diff_out));
    let now = timestamp();
    if check_code != Some(0) {
        let summary = if check_err.trim().is_empty() {
            "merge conflict".to_string()
        } else {
            check_err.clone()
        };
        connection.execute(
            "update room_run_merges set status = 'conflict', summary = ?, updated_at = ? where run_id = ?",
            params![summary, now, run_id],
        )?;
        let message = if check_err.trim().is_empty() {
            "merge_conflict".to_string()
        } else {
            check_err
        };
        record_room_event(
            &connection,
            room_id,
            "audit.operation",
            &serde_json::json!({ "action": "merge-conflict", "runId": run_id, "error": message }),
            Some(run.agent_id.as_str()),
            None,
        )?;
        return Ok(super::models::RoomRunMergeResponse {
            run,
            ok: false,
            message: Some(message),
        });
    }

    // project check-command gate (spawn /bin/zsh -lc, 30s timeout)
    for gate_command in split_check_commands(check_command.as_deref()) {
        let gate = run_check_gate(&project_path, &gate_command);
        let passed = gate.timed_out == false && gate.exit_code == Some(0);
        if !passed {
            let gate_status = if gate.timed_out {
                "timed_out"
            } else {
                "failed"
            };
            create_run_decision(
                &connection,
                room_id,
                "Merge blocked by failed project check",
                "open",
                &serde_json::json!({ "runId": run_id, "projectId": project_id, "command": gate_command, "status": gate_status }),
                None,
                &now,
            )?;
            record_room_event(
                &connection,
                room_id,
                "audit.operation",
                &serde_json::json!({ "action": "merge-blocked-by-check", "runId": run_id, "status": gate_status }),
                Some(run.agent_id.as_str()),
                None,
            )?;
            return Ok(super::models::RoomRunMergeResponse {
                run,
                ok: false,
                message: Some("project_check_failed_before_merge".to_string()),
            });
        }
    }

    // apply the patch
    let (apply_code, _apply_out, apply_err) =
        git_sync(&project_path, &["apply", "-"], Some(&diff_out));
    let ok = apply_code == Some(0);
    let status = if ok { "merged" } else { "error" };
    let summary = if apply_err.trim().is_empty() {
        "Applied patch to project workspace".to_string()
    } else {
        apply_err.clone()
    };
    connection.execute(
        "insert into room_run_merges (run_id, room_id, project_id, workspace_path, status, summary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict(run_id) do update set status = excluded.status, summary = excluded.summary, updated_at = excluded.updated_at",
        params![run_id, room_id, project_id, workspace_path, status, summary, now, now],
    )?;
    record_room_event(
        &connection,
        room_id,
        "audit.operation",
        &serde_json::json!({ "action": if ok { "merge-applied" } else { "merge-failed" }, "runId": run_id, "status": status, "error": (!apply_err.trim().is_empty()).then(|| apply_err.clone()) }),
        Some(run.agent_id.as_str()),
        None,
    )?;
    create_run_decision(
        &connection,
        room_id,
        if ok { "Merge applied" } else { "Merge failed" },
        if ok { "approved" } else { "open" },
        &serde_json::json!({ "runId": run_id, "status": status, "message": (!apply_err.trim().is_empty()).then(|| apply_err.clone()) }),
        if ok { Some(&now) } else { None },
        &now,
    )?;
    let message = if apply_err.trim().is_empty() {
        None
    } else {
        Some(apply_err)
    };
    Ok(super::models::RoomRunMergeResponse { run, ok, message })
}

#[derive(Clone, Debug)]
struct SavedAttachment {
    name: String,
    r#type: String,
    size: usize,
    path: String,
    relative_path: String,
    text_preview: Option<String>,
}

const MAX_ATTACHMENT_FILES: usize = 8;
const MAX_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_PREVIEW_CHARS: usize = 16_000;

fn safe_attachment_name(name: &str) -> String {
    let base_name = std::path::Path::new(if name.is_empty() { "attachment" } else { name })
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let sanitized: String = base_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric()
                || matches!(ch, '_' | '.' | '-' | ' ' | '(' | ')' | '[' | ']')
                || ('\u{4e00}'..='\u{9fff}').contains(&ch)
            {
                ch
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "attachment".to_string()
    } else {
        sanitized
    }
}

fn session_data_path(
    db: &Db,
    connection: &rusqlite::Connection,
    session_id: &str,
) -> std::path::PathBuf {
    let row: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            "select conversation_type, room_id from sessions where id = ?",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    if let Some((Some(conversation_type), Some(room_id))) = row {
        if conversation_type == "agent" {
            let parent_session: Option<String> = connection
                .query_row(
                    "select session_id from rooms where id = ?",
                    [&room_id],
                    |row| row.get(0),
                )
                .optional()
                .ok()
                .flatten()
                .flatten();
            if let Some(parent_session) = parent_session.filter(|value| value != session_id) {
                return db
                    .data_dir
                    .join("sessions")
                    .join(parent_session)
                    .join("room")
                    .join("agent-sessions")
                    .join(session_id);
            }
        }
    }
    db.data_dir.join("sessions").join(session_id)
}

fn session_attachments_path(
    db: &Db,
    connection: &rusqlite::Connection,
    session_id: &str,
) -> std::path::PathBuf {
    session_data_path(db, connection, session_id).join("attachments")
}

fn readable_attachment_bytes(size: usize) -> String {
    if size < 1024 {
        format!("{size} B")
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", size as f64 / 1024.0 / 1024.0)
    }
}

fn attachment_text_preview(buffer: &[u8], content_type: &str, name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    let looks_text = content_type.starts_with("text/")
        || [
            ".txt", ".md", ".json", ".csv", ".tsv", ".log", ".xml", ".html", ".css", ".js", ".jsx",
            ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".sh", ".yml",
            ".yaml", ".toml", ".ini", ".env",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix));
    if !looks_text {
        return None;
    }
    let mut text = String::from_utf8_lossy(buffer).replace('\0', "");
    if text.chars().count() > MAX_ATTACHMENT_TEXT_PREVIEW_CHARS {
        text = text
            .chars()
            .take(MAX_ATTACHMENT_TEXT_PREVIEW_CHARS)
            .collect::<String>();
        text.push_str("\n... [truncated]");
    }
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn save_session_attachments(
    db: &Db,
    connection: &rusqlite::Connection,
    session_id: &str,
    inputs: Option<&[super::models::UploadAttachmentInput]>,
) -> RoomResult<Vec<SavedAttachment>> {
    let Some(inputs) = inputs else {
        return Ok(Vec::new());
    };
    let root = session_attachments_path(db, connection, session_id);
    let mut saved = Vec::new();
    for item in inputs
        .iter()
        .filter(|item| {
            item.data_base64.as_deref().is_some_and(|v| !v.is_empty())
                && item.name.as_deref().is_some_and(|v| !v.is_empty())
        })
        .take(MAX_ATTACHMENT_FILES)
    {
        let name = safe_attachment_name(item.name.as_deref().unwrap_or("attachment"));
        let r#type = item
            .r#type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("application/octet-stream")
            .to_string();
        use base64::Engine;
        let buffer = base64::engine::general_purpose::STANDARD
            .decode(item.data_base64.as_deref().unwrap_or_default())
            .map_err(|_| bad("invalid_attachment_data"))?;
        if buffer.len() > MAX_ATTACHMENT_BYTES {
            return Err(bad("attachment_too_large"));
        }
        std::fs::create_dir_all(&root)
            .map_err(|error| RoomError::new(400, format!("attachment_upload_failed: {error}")))?;
        let id = format!("attachment-{}", uuid());
        let filename = format!("{id}-{name}");
        let target = root.join(&filename);
        if !target.starts_with(&root) {
            return Err(bad("invalid_attachment_path"));
        }
        std::fs::write(&target, &buffer)
            .map_err(|error| RoomError::new(400, format!("attachment_upload_failed: {error}")))?;
        let text_preview = attachment_text_preview(&buffer, &r#type, &name);
        saved.push(SavedAttachment {
            name,
            r#type,
            size: buffer.len(),
            path: target.display().to_string(),
            relative_path: format!("attachments/{filename}"),
            text_preview,
        });
    }
    Ok(saved)
}

fn attachment_markdown(attachments: &[SavedAttachment], include_preview: bool) -> String {
    if attachments.is_empty() {
        return String::new();
    }
    let mut lines = vec!["## Attachments".to_string()];
    for (index, attachment) in attachments.iter().enumerate() {
        lines.push(format!("{}. {}", index + 1, attachment.name));
        lines.push(format!("   - path: {}", attachment.path));
        lines.push(format!("   - session path: {}", attachment.relative_path));
        lines.push(format!("   - type: {}", attachment.r#type));
        lines.push(format!(
            "   - size: {}",
            readable_attachment_bytes(attachment.size)
        ));
        if include_preview {
            if let Some(preview) = attachment.text_preview.as_deref() {
                lines.push("   - text preview:".to_string());
                lines.push(
                    preview
                        .lines()
                        .map(|line| format!("     {line}"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
        }
    }
    lines.join("\n")
}

fn prompt_with_attachments(prompt: &str, attachments: &[SavedAttachment]) -> String {
    let block = attachment_markdown(attachments, true);
    if block.is_empty() {
        prompt.trim().to_string()
    } else {
        format!("{}\n\n{}", prompt.trim(), block)
    }
}

fn message_with_attachments(prompt: &str, attachments: &[SavedAttachment]) -> String {
    let block = attachment_markdown(attachments, false);
    if block.is_empty() {
        prompt.trim().to_string()
    } else {
        format!("{}\n\n{}", prompt.trim(), block)
    }
}

// ---------------------------------------------------------------------------
// Room messaging + orchestration scheduler (port of POST /messages,
// orchestrateRoom / startEligibleRoomTasks + mention/auto-listen helpers from
// apps/api/src/index.ts + rooms/routes.ts).
// ---------------------------------------------------------------------------

/// Public helper to detect an `@user` mention (used by the handler to pick the
/// orchestrate reason before consuming the request body).
pub fn message_mentions_user(content: Option<&str>) -> bool {
    content.map(mentions_room_user).unwrap_or(false)
}

/// Synchronous outcome of POST /api/rooms/:id/messages: the persisted message + the
/// tasks created for mentioned/auto-listen agents. The async handler then runs
/// orchestrate_room() to start the codex runner for the eligible tasks.
pub struct RoomMessageOutcome {
    pub event: RoomEventSummary,
    pub message: Option<serde_json::Value>,
    pub session: Option<serde_json::Value>,
    pub tasks: Vec<RoomTaskSummary>,
}

/// Port of the POST /api/rooms/:id/messages handler. Persists the user message to the
/// room parent session, resolves @mentions to room agents, queues mention/auto-listen
/// tasks, and records the room events. Returns the persisted artifacts; the caller
/// invokes orchestrate_room() to actually launch the eligible tasks.
pub fn create_room_message(
    db: &Db,
    room_id: &str,
    body: super::models::CreateRoomMessageRequest,
) -> RoomResult<RoomMessageOutcome> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let room = connection
        .query_row(
            "select session_id from rooms where id = ?",
            [room_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    let Some(linked_session_id) = room else {
        return Err(not_found("room_not_found"));
    };

    let content = body.content.as_deref().unwrap_or("").trim().to_string();
    if content.is_empty() {
        return Err(bad("message_required"));
    }

    // Resolve the target session: requested (must belong to room) -> linked parent -> any
    // session bound to the room. Mirrors requestedSession ?? linkedSession ?? fallbackSession.
    let session_id: Option<String> = if !table_exists_rt(&connection, "sessions")? {
        None
    } else if let Some(requested) = body.session_id.as_deref().filter(|s| !s.is_empty()) {
        connection
            .query_row(
                "select id from sessions where id = ? and room_id = ?",
                params![requested, room_id],
                |row| row.get(0),
            )
            .optional()?
    } else {
        None
    }
    .or_else(|| {
        linked_session_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|sid| {
                connection
                    .query_row("select id from sessions where id = ?", [sid], |row| {
                        row.get(0)
                    })
                    .optional()
                    .ok()
                    .flatten()
            })
    })
    .or_else(|| {
        connection
            .query_row(
                "select id from sessions where room_id = ? order by updated_at desc limit 1",
                [room_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    });

    // Persist upload-style attachments exactly like TS saveSessionAttachments(): write up to 8
    // base64 payloads under the selected session's data dir and append attachment metadata to
    // the stored message (without previews) and agent prompt (with text previews).
    let attachments = if let Some(session_id) = session_id.as_deref() {
        save_session_attachments(db, &connection, session_id, body.attachments.as_deref())?
    } else {
        Vec::new()
    };
    let content_with_attachments = message_with_attachments(&content, &attachments);
    let prompt_content = prompt_with_attachments(&content, &attachments);

    // Persist the user message into the room parent session (appendSessionMessage).
    let now = timestamp();
    let mut message_value: Option<serde_json::Value> = None;
    let mut session_value: Option<serde_json::Value> = None;
    if let Some(session_id) = session_id.as_deref() {
        let message_id = random_hex(16);
        connection.execute(
            "insert into messages (id, session_id, role, content, reply_to_message_id, created_at) values (?, ?, 'user', ?, ?, ?)",
            params![message_id, session_id, content_with_attachments, body.reply_to_message_id.as_deref(), now],
        )?;
        connection.execute(
            "update sessions set updated_at = ? where id = ?",
            params![now, session_id],
        )?;
        if linked_session_id.as_deref() != Some(session_id) {
            connection.execute(
                "update rooms set session_id = ?, updated_at = ? where id = ?",
                params![session_id, now, room_id],
            )?;
        }
        message_value = Some(
            serde_json::json!({ "id": message_id, "role": "user", "content": content_with_attachments, "createdAt": now }),
        );
        session_value = Some(serde_json::json!({ "id": session_id }));
    }

    // Resolve mentions / auto-listen targets (mentionableAgents = listenMode != none).
    let members = room_agents_with_listen_modes(&connection, room_id)?;
    let mentionable: Vec<RoomMember> = members
        .iter()
        .filter(|m| m.listen_mode != "none")
        .map(|m| RoomMember {
            agent_id: m.agent_id.clone(),
            name: m.name.clone(),
            enabled: m.enabled,
            listen_mode: m.listen_mode.clone(),
        })
        .collect();
    let mentioned = mentioned_room_agents(&content, &mentionable);
    let mentions_user = mentions_room_user(&content);

    let settings = orchestration_settings(
        connection
            .query_row(
                "select orchestration_settings from rooms where id = ?",
                [room_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
            .as_deref(),
        None,
    );
    let max_auto_listen = settings
        .get("maxAutoListenTasksPerEvent")
        .and_then(|v| v.as_i64())
        .unwrap_or(1);

    let mut tasks: Vec<RoomTaskSummary> = Vec::new();
    let mut mentioned_ids: Vec<String> = Vec::new();
    for agent in &mentioned {
        mentioned_ids.push(agent.agent_id.clone());
        let payload = serde_json::json!({ "kind": "mention", "reason": "user.mentioned", "mentionsUser": mentions_user });
        let title = format!("@{}", agent.name);
        tasks.push(insert_room_task(
            &connection,
            room_id,
            &title,
            &prompt_content,
            Some(&agent.agent_id),
            1,
            &payload,
        )?);
    }

    // Auto-listen only when there were no explicit mentions and no @user.
    let mut auto_listen_ids: Vec<String> = Vec::new();
    if mentioned.is_empty() && !mentions_user {
        let active: Vec<&RoomMember> = members
            .iter()
            .filter(|m| m.enabled && m.listen_mode != "none" && m.listen_mode != "passive")
            .collect();
        let orchestrators: Vec<&RoomMember> = active
            .iter()
            .copied()
            .filter(|m| m.listen_mode == "orchestrator")
            .collect();
        let pool: Vec<&RoomMember> = if !orchestrators.is_empty() {
            orchestrators
        } else {
            active
                .iter()
                .copied()
                .filter(|m| m.listen_mode == "active")
                .collect()
        };
        for member in pool.into_iter().take(max_auto_listen.max(1) as usize) {
            auto_listen_ids.push(member.agent_id.clone());
            let is_orchestrator = member.listen_mode == "orchestrator";
            let title: String = if is_orchestrator {
                format!("Orchestrate: {content}")
                    .chars()
                    .take(120)
                    .collect()
            } else {
                format!("Respond: {content}").chars().take(120).collect()
            };
            let prompt = [
                "Room event: user.message".to_string(),
                String::new(),
                prompt_content.clone(),
                String::new(),
                if is_orchestrator {
                    "As the orchestrator, decide whether the room needs follow-up work and summarize the next step.".to_string()
                } else {
                    "You are an active listener in this room. Reply to the room in one concise message. If no action is needed, acknowledge briefly and say you will keep listening.".to_string()
                },
            ]
            .join("\n");
            let payload = serde_json::json!({ "kind": "listen", "reason": "user.message", "mentionsUser": mentions_user });
            let priority = if is_orchestrator { 2 } else { 1 };
            tasks.push(insert_room_task(
                &connection,
                room_id,
                &title,
                &prompt,
                Some(&member.agent_id),
                priority,
                &payload,
            )?);
        }
    }

    // Record the user.message event + per-task agent.mentioned events (mirrors TS).
    let event = {
        record_room_event(
            &connection,
            room_id,
            "user.message",
            &serde_json::json!({
                "content": content_with_attachments,
                "messageId": message_value.as_ref().and_then(|m| m.get("id").cloned()),
                "sessionId": session_id,
                "replyToMessageId": body.reply_to_message_id,
                "mentionsUser": mentions_user,
                "mentionedAgentIds": mentioned_ids,
                "autoListenAgentIds": auto_listen_ids,
                "taskIds": tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
            }),
            None,
            None,
        )?;
        // record_room_event does not return the event; re-read the latest user.message.
        connection.query_row(
            "select * from room_events where room_id = ? and type = 'user.message' order by created_at desc, id desc limit 1",
            [room_id],
            event_from_row,
        )?
    };
    for task in &tasks {
        record_room_event(
            &connection,
            room_id,
            "agent.mentioned",
            &serde_json::json!({ "content": prompt_content, "taskId": task.id }),
            task.assigned_agent_id.as_deref(),
            None,
        )?;
    }

    Ok(RoomMessageOutcome {
        event,
        message: message_value,
        session: session_value,
        tasks,
    })
}

// ---------------------------------------------------------------------------
// Room orchestration scheduler (port of orchestrateRoom / startEligibleRoomTasks
// + mention/auto-listen helpers from apps/api/src/index.ts + rooms/routes.ts).
// ---------------------------------------------------------------------------
/// and the launches that still need the async codex runner started by the handler.
pub struct OrchestrateResult {
    pub tasks: Vec<RoomTaskSummary>,
    pub launches: Vec<RoomRunLaunch>,
}

/// A room member with its effective listen mode (room_agents.listen_mode falls back to
/// the group membership listen_mode, then 'passive'). Mirrors roomAgentsWithListenModes().
struct RoomMember {
    agent_id: String,
    name: String,
    enabled: bool,
    listen_mode: String,
}

fn room_agents_with_listen_modes(
    connection: &rusqlite::Connection,
    room_id: &str,
) -> rusqlite::Result<Vec<RoomMember>> {
    let group_id: Option<String> = connection
        .query_row(
            "select group_id from rooms where id = ?",
            [room_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let mut statement = connection.prepare(
        "select agents.id, agents.name, agents.enabled,
                coalesce(room_agents.listen_mode, agent_group_members.listen_mode, 'passive') as member_listen_mode
         from agents
         inner join room_agents on room_agents.agent_id = agents.id
         left join agent_group_members on agent_group_members.agent_id = agents.id and agent_group_members.group_id = ?
         where room_agents.room_id = ?
         order by agents.name asc",
    )?;
    let rows = statement
        .query_map(params![group_id.unwrap_or_default(), room_id], |row| {
            Ok(RoomMember {
                agent_id: row.get(0)?,
                name: row.get(1)?,
                enabled: row.get::<_, i64>(2)? == 1,
                listen_mode: listen_mode(Some(&row.get::<_, String>(3)?)),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Port of mentionsRoomUser: matches `@user` (word boundary, case-insensitive).
fn mentions_room_user(value: &str) -> bool {
    let lower = value.to_lowercase();
    let bytes = lower.as_bytes();
    let mut idx = 0;
    while let Some(found) = lower[idx..].find("@user") {
        let at = idx + found;
        let before_ok = at == 0 || bytes[at - 1].is_ascii_whitespace();
        let after = at + 5;
        let after_ok =
            after >= bytes.len() || !(bytes[after].is_ascii_alphanumeric() || bytes[after] == b'_');
        if before_ok && after_ok {
            return true;
        }
        idx = at + 5;
    }
    false
}

/// Port of mentionedRoomAgents: an agent is mentioned if `@name` / `@"name"` / `@id`
/// appears in the (lowercased) content.
fn mentioned_room_agents<'a>(content: &str, agents: &'a [RoomMember]) -> Vec<&'a RoomMember> {
    let normalized = content.to_lowercase();
    agents
        .iter()
        .filter(|agent| {
            [agent.name.as_str(), agent.agent_id.as_str()]
                .iter()
                .any(|candidate| {
                    let value = candidate.to_lowercase();
                    normalized.contains(&format!("@{value}"))
                        || normalized.contains(&format!("@\"{value}\""))
                })
        })
        .collect()
}

/// Port of insertRoomTask: insert a queued/assigned room task and return its summary.
fn insert_room_task(
    connection: &rusqlite::Connection,
    room_id: &str,
    title: &str,
    prompt: &str,
    assigned_agent_id: Option<&str>,
    priority: i64,
    payload: &serde_json::Value,
) -> rusqlite::Result<RoomTaskSummary> {
    let now = timestamp();
    let id = format!("room-task-{}", uuid());
    let status = if assigned_agent_id.is_some() {
        "assigned"
    } else {
        "queued"
    };
    connection.execute(
        "insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?)",
        params![id, room_id, title.trim(), prompt.trim(), status, assigned_agent_id, priority, payload.to_string(), now, now],
    )?;
    connection.query_row(
        "select * from room_tasks where id = ?",
        [&id],
        task_from_row,
    )
}

/// Port of createListenTasksForRoomEvent: pick orchestrator (or active) listeners and
/// queue a listen/orchestrate task for each.
fn create_listen_tasks_for_room_event(
    connection: &rusqlite::Connection,
    room_id: &str,
    reason: &str,
    content: &str,
    exclude_agent_id: Option<&str>,
    source_task_id: Option<&str>,
    limit: i64,
) -> rusqlite::Result<Vec<RoomTaskSummary>> {
    let members: Vec<RoomMember> = room_agents_with_listen_modes(connection, room_id)?
        .into_iter()
        .filter(|m| {
            m.enabled
                && m.listen_mode != "none"
                && m.listen_mode != "passive"
                && Some(m.agent_id.as_str()) != exclude_agent_id
        })
        .collect();
    let orchestrators: Vec<&RoomMember> = members
        .iter()
        .filter(|m| m.listen_mode == "orchestrator")
        .collect();
    let pool: Vec<&RoomMember> = if !orchestrators.is_empty() {
        orchestrators
    } else {
        members
            .iter()
            .filter(|m| m.listen_mode == "active")
            .collect()
    };
    let cap = limit.max(1) as usize;
    let mut created = Vec::new();
    for member in pool.into_iter().take(cap) {
        let is_orchestrator = member.listen_mode == "orchestrator";
        let title = if is_orchestrator {
            format!("Orchestrate: {reason}")
        } else {
            format!("Listen: {reason}")
        };
        let prompt = [
            format!("Room event: {reason}"),
            source_task_id.map(|id| format!("Source task id: {id}")).unwrap_or_default(),
            String::new(),
            content.to_string(),
            String::new(),
            if is_orchestrator {
                "As the orchestrator, decide the next useful action for the room. Create or recommend follow-up work only when it is necessary.".to_string()
            } else {
                "You are an active listener in this room. Reply to the room in one concise message. If no action is needed, acknowledge briefly and say you will keep listening.".to_string()
            },
        ]
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
        let payload = serde_json::json!({ "kind": "listen", "reason": reason, "sourceTaskId": source_task_id });
        let priority = if is_orchestrator { 2 } else { 1 };
        created.push(insert_room_task(
            connection,
            room_id,
            &title,
            &prompt,
            Some(&member.agent_id),
            priority,
            &payload,
        )?);
    }
    Ok(created)
}

/// Port of roomTaskAutoListenDepth: walk the listen-task chain via payload.sourceTaskId.
fn room_task_auto_listen_depth(
    connection: &rusqlite::Connection,
    room_id: &str,
    task_id: Option<&str>,
) -> i64 {
    let mut depth = 0;
    let mut current = task_id.map(str::to_string);
    let mut seen = std::collections::HashSet::new();
    while let Some(id) = current.clone() {
        if !seen.insert(id.clone()) {
            break;
        }
        let payload: Option<String> = connection
            .query_row(
                "select payload from room_tasks where room_id = ? and id = ?",
                params![room_id, id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        let Some(payload) = payload else { break };
        let parsed: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::json!({}));
        if parsed.get("kind").and_then(|v| v.as_str()) != Some("listen") {
            break;
        }
        depth += 1;
        current = parsed
            .get("sourceTaskId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
    }
    depth
}

/// Port of findRoomReviewer: a room member whose name/role hints review/QA.
fn find_room_reviewer(
    connection: &rusqlite::Connection,
    room_id: &str,
    exclude_agent_id: Option<&str>,
) -> Option<(String, String)> {
    let mut statement = connection
        .prepare(
            "select agents.id, agents.name, coalesce(agent_roles.name, ''), coalesce(agent_roles.description, '')
             from agents
             inner join room_agents on room_agents.agent_id = agents.id
             left join agent_roles on agent_roles.id = agents.role_id
             where room_agents.room_id = ?",
        )
        .ok()?;
    let rows: Vec<(String, String, String, String)> = statement
        .query_map([room_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .ok()?
        .filter_map(|r| r.ok())
        .collect();
    for (id, name, role_name, role_desc) in rows {
        if exclude_agent_id == Some(id.as_str()) {
            continue;
        }
        let haystack = format!("{name} {role_name} {role_desc}").to_lowercase();
        if haystack.contains("review")
            || haystack.contains("审查")
            || haystack.contains("质量")
            || haystack.contains("qa")
        {
            return Some((id, name));
        }
    }
    None
}

/// Port of hasReviewTask: a review task already exists for the source task.
fn has_review_task(connection: &rusqlite::Connection, room_id: &str, source_task_id: &str) -> bool {
    let mut statement = match connection
        .prepare("select payload, depends_on_task_id, title from room_tasks where room_id = ?")
    {
        Ok(s) => s,
        Err(_) => return false,
    };
    let rows: Vec<(Option<String>, Option<String>, String)> =
        match statement.query_map([room_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))) {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => return false,
        };
    rows.iter().any(|(payload, depends_on, title)| {
        let title_lower = title.to_lowercase();
        if depends_on.as_deref() == Some(source_task_id)
            && (title_lower.contains("review")
                || title_lower.contains("审查")
                || title_lower.contains("复核"))
        {
            return true;
        }
        let parsed: serde_json::Value = payload
            .as_deref()
            .and_then(|p| serde_json::from_str(p).ok())
            .unwrap_or(serde_json::json!({}));
        parsed.get("sourceTaskId").and_then(|v| v.as_str()) == Some(source_task_id)
            && parsed.get("kind").and_then(|v| v.as_str()) == Some("auto-review")
    })
}

/// Port of createAutoReviewTask: queue a reviewer task depending on a completed task.
fn create_auto_review_task(
    connection: &rusqlite::Connection,
    room_id: &str,
    completed_task_id: &str,
    completed_title: &str,
    completed_priority: i64,
    completed_payload: &serde_json::Value,
    source_agent_id: Option<&str>,
) -> rusqlite::Result<Option<RoomTaskSummary>> {
    let kind = completed_payload.get("kind").and_then(|v| v.as_str());
    if kind == Some("listen") || kind == Some("auto-review") {
        return Ok(None);
    }
    let title_lower = completed_title.to_lowercase();
    if title_lower.contains("review")
        || title_lower.contains("审查")
        || title_lower.contains("复核")
        || has_review_task(connection, room_id, completed_task_id)
    {
        return Ok(None);
    }
    let Some((reviewer_id, _reviewer_name)) =
        find_room_reviewer(connection, room_id, source_agent_id)
    else {
        return Ok(None);
    };
    let now = timestamp();
    let id = format!("room-task-{}", uuid());
    let prompt = [
        format!("Review the completed room task: {completed_title}"),
        format!("Source task id: {completed_task_id}"),
        String::new(),
        "Focus on correctness, regressions, missing tests, and actionable follow-up.".to_string(),
        "If changes are needed, summarize them clearly for the user and the responsible Agent."
            .to_string(),
    ]
    .join("\n");
    let review_title: String = format!("Review: {completed_title}")
        .chars()
        .take(120)
        .collect();
    let payload = serde_json::json!({ "kind": "auto-review", "sourceTaskId": completed_task_id });
    connection.execute(
        "insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
         values (?, ?, ?, ?, 'assigned', ?, ?, ?, null, ?, ?, ?)",
        params![id, room_id, review_title, prompt, reviewer_id, completed_priority, completed_task_id, payload.to_string(), now, now],
    )?;
    record_room_event(
        connection,
        room_id,
        "orchestrator.decision",
        &serde_json::json!({ "action": "create-review-task", "taskId": id, "sourceTaskId": completed_task_id, "reviewerId": reviewer_id }),
        Some(&reviewer_id),
        None,
    )?;
    Ok(Some(connection.query_row(
        "select * from room_tasks where id = ?",
        [&id],
        task_from_row,
    )?))
}

/// Port of startEligibleRoomTasks: scan pending assigned tasks (respecting dependencies +
/// concurrency) and prepare a `RoomRunLaunch` for each via start_room_task(). The async
/// handler then starts the codex runner for every returned launch.
fn start_eligible_room_tasks(db: &Db, room_id: &str) -> RoomResult<Vec<RoomRunLaunch>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let room = connection
        .query_row(
            "select group_id, orchestration_settings from rooms where id = ?",
            [room_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?;
    let Some((group_id, settings_raw)) = room else {
        return Ok(Vec::new());
    };
    let settings = orchestration_settings(settings_raw.as_deref(), None);
    if !settings
        .get("autoStartTasks")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
    {
        return Ok(Vec::new());
    }
    let max_concurrent_agents = match group_id.as_deref().filter(|v| !v.is_empty()) {
        Some(group_id) => connection
            .query_row(
                "select max_concurrent_agents from agent_groups where id = ?",
                [group_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten()
            .unwrap_or(1)
            .max(1),
        None => 1,
    };
    let mut running_room_count: i64 = connection
        .query_row(
            "select count(*) from agent_runs where room_id = ? and status = 'running'",
            [room_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let tasks: Vec<(String, Option<String>, Option<String>)> = {
        let mut statement = connection.prepare(
            "select id, depends_on_task_id, assigned_agent_id from room_tasks
             where room_id = ? and status in ('assigned', 'queued', 'failed') and assigned_agent_id is not null
             order by priority desc, created_at asc, id asc limit 20",
        )?;
        let rows = statement
            .query_map([room_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    // Drop the listing connection before start_room_task opens its own write connection.
    drop(connection);
    let mut launches = Vec::new();
    for (task_id, depends_on, assigned_agent_id) in tasks {
        if running_room_count >= max_concurrent_agents {
            break;
        }
        if let Some(dependency) = depends_on.filter(|d| !d.is_empty()) {
            let dep_connection = db.open_read_write()?;
            let dep_status: Option<String> = dep_connection
                .query_row(
                    "select status from room_tasks where id = ? and room_id = ?",
                    params![dependency, room_id],
                    |row| row.get(0),
                )
                .optional()?;
            if dep_status.as_deref() != Some("done") {
                continue;
            }
        }
        match start_room_task(db, room_id, &task_id) {
            Ok(launch) => {
                let run_id = launch.run.id.clone();
                running_room_count += 1;
                launches.push(launch);
                let event_connection = db.open_read_write()?;
                let _ = record_room_event(
                    &event_connection,
                    room_id,
                    "orchestrator.decision",
                    &serde_json::json!({ "action": "start-task", "taskId": task_id, "runId": run_id }),
                    assigned_agent_id.as_deref(),
                    None,
                );
            }
            Err(error) => {
                let code = error.code.clone();
                if code != "room_concurrency_limit"
                    && code != "agent_concurrency_limit"
                    && code != "room_task_dependency_pending"
                {
                    let event_connection = db.open_read_write()?;
                    let _ = record_room_event(
                        &event_connection,
                        room_id,
                        "orchestrator.decision",
                        &serde_json::json!({ "action": "start-task-failed", "taskId": task_id, "error": code }),
                        assigned_agent_id.as_deref(),
                        None,
                    );
                }
            }
        }
    }
    Ok(launches)
}

/// Port of orchestrateRoom(roomId, reason). Creates auto-review / auto-listen follow-up
/// tasks for the latest completed task, handles task.created listen fan-out + failure
/// notifications, then schedules eligible tasks. Returns created tasks + launches; the
/// async handler is responsible for starting the codex runner for each launch.
pub fn orchestrate_room(db: &Db, room_id: &str, reason: &str) -> RoomResult<OrchestrateResult> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let room = connection
        .query_row(
            "select orchestration_settings from rooms where id = ?",
            [room_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    let Some(settings_raw) = room else {
        return Ok(OrchestrateResult {
            tasks: Vec::new(),
            launches: Vec::new(),
        });
    };
    let settings = orchestration_settings(settings_raw.as_deref(), None);
    let mut created_tasks: Vec<RoomTaskSummary> = Vec::new();

    // Latest completed/failed task (joined to its run agent), mirroring TS.
    let latest_completed: Option<(String, String, i64, String, Option<String>, Option<String>)> = connection
        .query_row(
            "select room_tasks.id, room_tasks.status, room_tasks.priority, room_tasks.title, room_tasks.payload, agent_runs.agent_id
             from room_tasks
             left join agent_runs on agent_runs.task_id = room_tasks.id
             where room_tasks.room_id = ? and room_tasks.status in ('done', 'failed')
             order by room_tasks.finished_at desc, room_tasks.updated_at desc limit 1",
            [room_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .optional()?;

    if settings
        .get("autoCreateReviewTasks")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
        && reason == "agent.completed"
    {
        if let Some((id, status, priority, title, payload, agent_id)) = &latest_completed {
            if status == "done" {
                let payload_value: serde_json::Value = payload
                    .as_deref()
                    .and_then(|p| serde_json::from_str(p).ok())
                    .unwrap_or(serde_json::json!({}));
                if let Some(task) = create_auto_review_task(
                    &connection,
                    room_id,
                    id,
                    title,
                    *priority,
                    &payload_value,
                    agent_id.as_deref(),
                )? {
                    created_tasks.push(task);
                }
            }
        }
    }

    if settings
        .get("autoListenAfterAgentEvents")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
        && (reason == "agent.completed" || reason == "agent.failed")
    {
        if let Some((id, status, _priority, title, payload, agent_id)) = &latest_completed {
            let payload_value: serde_json::Value = payload
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok())
                .unwrap_or(serde_json::json!({}));
            let kind = payload_value.get("kind").and_then(|v| v.as_str());
            let depth = room_task_auto_listen_depth(&connection, room_id, Some(id));
            let max_depth = settings
                .get("maxAutoListenChainDepth")
                .and_then(|v| v.as_i64())
                .unwrap_or(1);
            if kind != Some("listen") || depth < max_depth {
                let content = format!("Agent task \"{title}\" finished with status {status}.");
                let limit = settings
                    .get("maxAutoListenTasksPerEvent")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(1);
                created_tasks.extend(create_listen_tasks_for_room_event(
                    &connection,
                    room_id,
                    reason,
                    &content,
                    agent_id.as_deref(),
                    Some(id),
                    limit,
                )?);
            } else {
                record_room_event(
                    &connection,
                    room_id,
                    "orchestrator.decision",
                    &serde_json::json!({ "action": "skip-auto-listen", "reason": reason, "taskId": id, "depth": depth, "maxDepth": max_depth }),
                    None,
                    None,
                )?;
            }
        }
    }

    if reason == "task.created" {
        let latest_task: Option<(String, Option<String>, String, Option<String>)> = connection
            .query_row(
                "select id, assigned_agent_id, title, payload from room_tasks where room_id = ? order by created_at desc, id desc limit 1",
                [room_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        if let Some((id, assigned, title, payload)) = latest_task {
            let payload_value: serde_json::Value = payload
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok())
                .unwrap_or(serde_json::json!({}));
            if assigned.as_deref().filter(|v| !v.is_empty()).is_none()
                && payload_value.get("kind").and_then(|v| v.as_str()) != Some("listen")
            {
                let content = format!("A new unassigned room task was created: {title}.");
                let limit = settings
                    .get("maxAutoListenTasksPerEvent")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(1);
                created_tasks.extend(create_listen_tasks_for_room_event(
                    &connection,
                    room_id,
                    reason,
                    &content,
                    None,
                    Some(&id),
                    limit,
                )?);
            }
        }
    }

    if settings
        .get("notifyUserOnFailure")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
        && reason == "agent.failed"
    {
        record_room_event(
            &connection,
            room_id,
            "user.attention",
            &serde_json::json!({ "reason": "agent_failed", "message": "A Room Agent task failed and needs review." }),
            None,
            None,
        )?;
    }

    // Drop the connection before start_eligible_room_tasks opens its own write connections.
    drop(connection);
    let launches = start_eligible_room_tasks(db, room_id)?;
    Ok(OrchestrateResult {
        tasks: created_tasks,
        launches,
    })
}

fn bad_with_message(message: &str) -> RoomError {
    RoomError::new(400, message.to_string())
}

struct GateResult {
    exit_code: Option<i32>,
    timed_out: bool,
}

/// Run a single project check command via `/bin/zsh -lc <cmd>` with a 30s wall-clock timeout.
fn run_check_gate(cwd: &str, command: &str) -> GateResult {
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;
    let mut child = match Command::new("/bin/zsh")
        .args(["-lc", command])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            return GateResult {
                exit_code: None,
                timed_out: false,
            }
        }
    };
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = tx.send(status.ok().and_then(|status| status.code()));
    });
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(code) => GateResult {
            exit_code: code,
            timed_out: false,
        },
        Err(_) => {
            // Best-effort kill of the timed-out gate process.
            #[cfg(unix)]
            unsafe {
                libc_kill(pid as i32);
            }
            GateResult {
                exit_code: None,
                timed_out: true,
            }
        }
    }
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32) {
    // SIGTERM via the `kill` binary to avoid a libc dependency.
    let _ = std::process::Command::new("kill")
        .arg(pid.to_string())
        .status();
}

fn split_check_commands(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or("")
        .split('\n')
        .map(|item| item.trim_end_matches('\r').trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn create_run_decision(
    connection: &rusqlite::Connection,
    room_id: &str,
    title: &str,
    status: &str,
    payload: &serde_json::Value,
    resolved_at: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    let id = format!("decision-{}", uuid());
    connection.execute(
        "insert into room_decisions (id, room_id, title, status, payload, created_at, resolved_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![id, room_id, title, status, serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()), now, resolved_at],
    )?;
    Ok(())
}

// ----- schedules ------------------------------------------------------------

/// Port of checkDueRoomSchedules(): create queued room_tasks for due active one-shot
/// schedules, mark schedules done, and prepare launches for the async runtime.
pub fn trigger_due_room_schedules(db: &Db, limit: usize) -> RoomResult<Vec<RoomRunLaunch>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = timestamp();
    let schedules: Vec<(String, String, String, String, Option<String>)> = {
        let mut statement = connection.prepare(
            "select id, room_id, agent_id, task_prompt, run_at from room_schedules
             where status = 'active' and schedule_type = 'once' and run_at is not null
             order by run_at asc, id asc limit ?",
        )?;
        let rows = statement.query_map([limit.max(1).min(100) as i64], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut task_ids: Vec<(String, String)> = Vec::new();
    for (schedule_id, room_id, agent_id, task_prompt, run_at) in schedules {
        let Some(run_at_value) = run_at.as_deref().filter(|value| !value.is_empty()) else {
            continue;
        };
        if run_at_value > now.as_str() {
            continue;
        }
        let task_id = format!("room-task-{}", uuid());
        let title = task_prompt
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().chars().take(80).collect::<String>())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Scheduled room task".to_string());
        let result: rusqlite::Result<()> = (|| {
            connection.execute(
                "insert into room_tasks (id, room_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
                 values (?, ?, ?, ?, 'queued', ?, 0, null, ?, '{}', ?, ?)",
                params![task_id, room_id, title, task_prompt, agent_id, run_at, now, now],
            )?;
            connection.execute(
                "update room_schedules set status = 'done', updated_at = ? where id = ?",
                params![now, schedule_id],
            )?;
            record_room_event(
                &connection,
                &room_id,
                "schedule.triggered",
                &serde_json::json!({ "scheduleId": schedule_id, "taskId": task_id }),
                Some(&agent_id),
                None,
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => task_ids.push((room_id, task_id)),
            Err(error) => {
                let _ = record_room_event(
                    &connection,
                    &room_id,
                    "schedule.failed",
                    &serde_json::json!({ "scheduleId": schedule_id, "taskId": task_id, "error": error.to_string() }),
                    Some(&agent_id),
                    None,
                );
            }
        }
    }
    drop(connection);
    let mut launches = Vec::new();
    for (room_id, task_id) in task_ids {
        if let Ok(launch) = start_room_task(db, &room_id, &task_id) {
            launches.push(launch);
        }
    }
    Ok(launches)
}

pub fn list_schedules(db: &Db, room_id: &str) -> RoomResult<Vec<RoomScheduleSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let mut statement = connection.prepare("select * from room_schedules where room_id = ? order by updated_at desc, id desc limit 100")?;
    let rows = statement
        .query_map([room_id], schedule_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create_schedule(
    db: &Db,
    room_id: &str,
    body: super::models::CreateRoomScheduleRequest,
) -> RoomResult<RoomScheduleSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if !exists(&connection, "select id from rooms where id = ?", [room_id])? {
        return Err(not_found("room_not_found"));
    }
    let agent_id = body.agent_id.as_deref().unwrap_or("").to_string();
    let task_prompt = body.task_prompt.as_deref().unwrap_or("").trim().to_string();
    if agent_id.is_empty() || task_prompt.is_empty() {
        return Err(bad("invalid_room_schedule"));
    }
    if !exists(
        &connection,
        "select agent_id from room_agents where room_id = ? and agent_id = ?",
        params![room_id, agent_id],
    )? {
        return Err(bad("agent_not_in_room"));
    }
    let schedule_type = match body.schedule_type.as_deref() {
        Some("hourly") => "hourly",
        Some("daily") => "daily",
        _ => "once",
    };
    let now = timestamp();
    let id = format!("room-schedule-{}", uuid());
    connection.execute(
        "insert into room_schedules (id, room_id, agent_id, task_prompt, schedule_type, run_at, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
        params![id, room_id, agent_id, task_prompt, schedule_type, body.run_at.clone().filter(|r| !r.is_empty()), now, now],
    )?;
    record_room_event(
        &connection,
        room_id,
        "schedule.created",
        &serde_json::json!({ "scheduleId": id, "scheduleType": schedule_type, "runAt": body.run_at }),
        Some(&agent_id),
        None,
    )?;
    // The Rust runtime checks due one-shot schedules periodically and creates/starts room tasks.
    Ok(connection.query_row(
        "select * from room_schedules where id = ?",
        [&id],
        schedule_from_row,
    )?)
}

pub fn delete_schedule(db: &Db, room_id: &str, schedule_id: &str) -> RoomResult<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let agent_id: Option<String> = connection
        .query_row(
            "select agent_id from room_schedules where id = ? and room_id = ?",
            params![schedule_id, room_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(agent_id) = agent_id else {
        return Err(not_found("room_schedule_not_found"));
    };
    connection.execute("delete from room_schedules where id = ?", [schedule_id])?;
    record_room_event(
        &connection,
        room_id,
        "schedule.deleted",
        &serde_json::json!({ "scheduleId": schedule_id }),
        Some(&agent_id),
        None,
    )?;
    Ok(())
}

// ----- row mappers for new tables -------------------------------------------

fn artifact_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomArtifactSummary> {
    Ok(RoomArtifactSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        agent_id: row.get("agent_id")?,
        kind: row.get("kind")?,
        title: row.get("title")?,
        payload: json_value(
            row.get::<_, Option<String>>("payload")?,
            serde_json::json!({}),
        ),
        created_at: row.get("created_at")?,
    })
}

fn decision_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomDecisionSummary> {
    let status: String = row.get("status")?;
    let status = if matches!(
        status.as_str(),
        "open" | "approved" | "rejected" | "resolved"
    ) {
        status
    } else {
        "open".to_string()
    };
    Ok(RoomDecisionSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        title: row.get("title")?,
        status,
        payload: json_value(
            row.get::<_, Option<String>>("payload")?,
            serde_json::json!({}),
        ),
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

fn handoff_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomHandoffSummary> {
    let status: String = row.get("status")?;
    let status = if matches!(
        status.as_str(),
        "accepted" | "returned" | "resolved" | "cancelled"
    ) {
        status
    } else {
        "open".to_string()
    };
    Ok(RoomHandoffSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        from_agent_id: row.get("from_agent_id")?,
        to_agent_id: row.get("to_agent_id")?,
        summary: row.get("summary")?,
        status,
        payload: json_value(
            row.get::<_, Option<String>>("payload")?,
            serde_json::json!({}),
        ),
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

fn schedule_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomScheduleSummary> {
    let schedule_type: String = row.get("schedule_type")?;
    let schedule_type = if matches!(schedule_type.as_str(), "hourly" | "daily") {
        schedule_type
    } else {
        "once".to_string()
    };
    let status: String = row.get("status")?;
    let status = if matches!(status.as_str(), "paused" | "done") {
        status
    } else {
        "active".to_string()
    };
    Ok(RoomScheduleSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        agent_id: row.get("agent_id")?,
        task_prompt: row.get("task_prompt")?,
        schedule_type,
        run_at: row.get("run_at")?,
        status,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ----- schema bootstrap (mirrors apps/api/src/index.ts room* table defs) ----

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists rooms (
          id text primary key,
          session_id text,
          name text not null,
          group_id text,
          circle_id text,
          project_id text,
          status text not null,
          shared_context text,
          orchestration_settings text not null default '{}',
          created_at text not null,
          updated_at text not null
        );
        create index if not exists rooms_status_updated_idx on rooms(status, updated_at desc, id desc);
        create table if not exists room_agents (
          room_id text not null,
          agent_id text not null,
          listen_mode text not null default 'passive',
          primary key (room_id, agent_id)
        );
        create table if not exists room_events (
          id text primary key,
          room_id text not null,
          type text not null,
          source_agent_id text,
          target_agent_id text,
          payload text not null,
          created_at text not null
        );
        create index if not exists room_events_room_created_idx on room_events(room_id, created_at desc, id desc);
        create table if not exists room_tasks (
          id text primary key,
          room_id text not null,
          goal_item_id text,
          title text not null,
          prompt text not null default '',
          status text not null,
          assigned_agent_id text,
          priority integer not null default 0,
          depends_on_task_id text,
          scheduled_at text,
          started_at text,
          finished_at text,
          payload text not null,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists room_schedules (
          id text primary key,
          room_id text not null,
          agent_id text not null,
          task_prompt text not null,
          schedule_type text not null,
          run_at text,
          status text not null,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists room_artifacts (
          id text primary key,
          room_id text not null,
          agent_id text,
          kind text not null,
          title text not null,
          payload text not null,
          created_at text not null
        );
        create table if not exists room_handoffs (
          id text primary key,
          room_id text not null,
          from_agent_id text,
          to_agent_id text,
          summary text not null,
          status text not null default 'open',
          payload text not null,
          created_at text not null,
          resolved_at text
        );
        create table if not exists room_decisions (
          id text primary key,
          room_id text not null,
          title text not null,
          status text not null,
          payload text not null,
          created_at text not null,
          resolved_at text
        );
        create table if not exists agent_runs (
          id text primary key,
          room_id text not null,
          agent_id text not null,
          task_id text,
          goal_id text,
          session_id text,
          status text not null,
          provider_id text,
          model text,
          workspace_path text,
          started_at text not null,
          finished_at text,
          exit_code integer
        );
        create index if not exists agent_runs_room_started_idx on agent_runs(room_id, started_at desc, id desc);
        create table if not exists room_run_merges (
          run_id text primary key,
          room_id text not null,
          project_id text,
          workspace_path text not null,
          status text not null,
          summary text,
          created_at text not null,
          updated_at text not null
        );
        ",
    )?;
    ensure_session_show_message_usage_column(connection)?;
    Ok(())
}

fn ensure_session_show_message_usage_column(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    if !table_exists(connection, "sessions")? {
        return Ok(());
    }
    let mut statement = connection.prepare("pragma table_info(sessions)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|item| item == "show_message_usage") {
        connection.execute("alter table sessions add column show_message_usage integer", [])?;
    }
    Ok(())
}

fn room_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomSummary> {
    let room_id: String = row.get("id")?;
    Ok(RoomSummary {
        id: room_id.clone(),
        session_id: row.get("session_id")?,
        name: row.get("name")?,
        group_id: row.get("group_id")?,
        circle_id: row.get("circle_id")?,
        project_id: row.get("project_id")?,
        status: row.get("status")?,
        shared_context: row.get("shared_context")?,
        goal: None,
        orchestration: json_value(
            row.get::<_, Option<String>>("orchestration_settings")?,
            serde_json::json!({}),
        ),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn active_goal_for_room(
    connection: &rusqlite::Connection,
    room_id: &str,
) -> anyhow::Result<Option<serde_json::Value>> {
    if !table_exists(connection, "goals")? {
        return Ok(None);
    }
    let goal = connection
        .query_row(
            "select * from goals where owner_type = 'room' and owner_id = ? and status in ('active', 'paused') order by updated_at desc, id desc limit 1",
            [room_id],
            |row| crate::api::goals::store::goal_summary_from_row(connection, row),
        )
        .optional()?;
    match goal {
        Some(goal) => Ok(Some(serde_json::to_value(goal)?)),
        None => Ok(None),
    }
}

fn room_from_row_with_goal(
    connection: &rusqlite::Connection,
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<RoomSummary> {
    let mut room = room_from_row(row)?;
    room.goal = active_goal_for_room(connection, &room.id).ok().flatten();
    Ok(room)
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomEventSummary> {
    Ok(RoomEventSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        r#type: row.get("type")?,
        source_agent_id: row.get("source_agent_id")?,
        target_agent_id: row.get("target_agent_id")?,
        payload: json_value(
            row.get::<_, Option<String>>("payload")?,
            serde_json::json!({}),
        ),
        created_at: row.get("created_at")?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoomTaskSummary> {
    Ok(RoomTaskSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        goal_item_id: row.get("goal_item_id")?,
        title: row.get("title")?,
        prompt: row.get("prompt")?,
        assigned_agent_id: row.get("assigned_agent_id")?,
        status: row.get("status")?,
        priority: row.get("priority")?,
        depends_on_task_id: row.get("depends_on_task_id")?,
        scheduled_at: row.get("scheduled_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRunSummary> {
    Ok(AgentRunSummary {
        id: row.get("id")?,
        room_id: row.get("room_id")?,
        agent_id: row.get("agent_id")?,
        task_id: row.get("task_id")?,
        goal_id: row.get("goal_id")?,
        session_id: row.get("session_id")?,
        status: row.get("status")?,
        provider_id: row.get("provider_id")?,
        model: row.get("model")?,
        workspace_path: row.get("workspace_path")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        exit_code: row.get("exit_code")?,
    })
}

fn table_exists(connection: &rusqlite::Connection, table: &str) -> anyhow::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn json_value(value: Option<String>, fallback: serde_json::Value) -> serde_json::Value {
    value
        .and_then(|item| serde_json::from_str(&item).ok())
        .unwrap_or(fallback)
}

fn page<T>(items: Vec<T>, has_more: bool) -> PageResponse<T> {
    PageResponse {
        items,
        next_cursor: None,
        has_more,
    }
}

fn ensure_room_scratch_workspace(db: &Db, session_id: &str) -> String {
    let path = db
        .data_dir
        .join("sessions")
        .join(session_id)
        .join("workspace");
    let _ = std::fs::create_dir_all(&path);
    path.display().to_string()
}
