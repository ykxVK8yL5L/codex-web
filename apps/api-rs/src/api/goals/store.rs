use rusqlite::{params, OptionalExtension};

use crate::db::Db;

use super::models::{
    GoalDetailResponse, GoalEventSummary, GoalFocusSummary, GoalItemSummary, GoalProgress,
    GoalProposalSummary, GoalSummary,
};

// ---------------------------------------------------------------------------
// Actor / authorization helpers (mirrors apps/api/src/goals/index.ts)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub enum GoalActor {
    User,
    Agent(String),
}

impl GoalActor {
    pub fn is_agent(&self) -> bool {
        matches!(self, GoalActor::Agent(_))
    }

    pub fn actor_type(&self) -> &'static str {
        match self {
            GoalActor::User => "user",
            GoalActor::Agent(_) => "agent",
        }
    }

    pub fn actor_id(&self) -> Option<&str> {
        match self {
            GoalActor::User => None,
            GoalActor::Agent(id) => Some(id.as_str()),
        }
    }
}

/// Resolve the acting actor from request headers + body fields.
/// Mirrors goalActorFromRequest: prefers x-codex-agent-id / x-agent-id headers,
/// then body actorAgentId / proposedByAgentId. Errors with agent_actor_not_found
/// when an agent id is provided but does not exist in the agents table.
pub fn goal_actor(
    db: &Db,
    header_agent_id: Option<&str>,
    body_actor_agent_id: Option<&str>,
    body_proposed_by_agent_id: Option<&str>,
) -> anyhow::Result<GoalActor> {
    let agent_id = [
        header_agent_id,
        body_actor_agent_id,
        body_proposed_by_agent_id,
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .find(|value| !value.is_empty());
    let Some(agent_id) = agent_id else {
        return Ok(GoalActor::User);
    };
    let Some(connection) = db.open_read_only()? else {
        anyhow::bail!("agent_actor_not_found");
    };
    if !table_exists(&connection, "agents")? || !agent_exists(&connection, agent_id)? {
        anyhow::bail!("agent_actor_not_found");
    }
    Ok(GoalActor::Agent(agent_id.to_string()))
}

fn agent_exists(connection: &rusqlite::Connection, agent_id: &str) -> anyhow::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from agents where id = ? limit 1",
            [agent_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn can_agent_manage_goal(
    connection: &rusqlite::Connection,
    goal: &GoalSummary,
    agent_id: &str,
) -> anyhow::Result<bool> {
    if goal.manager_agent_id.as_deref() == Some(agent_id)
        || goal.coordinator_agent_id.as_deref() == Some(agent_id)
    {
        return Ok(true);
    }
    if goal.owner_type != "room" {
        return Ok(false);
    }
    if !table_exists(connection, "room_agents")? {
        return Ok(false);
    }
    let listen_mode: Option<Option<String>> = connection
        .query_row(
            "select listen_mode from room_agents where room_id = ? and agent_id = ?",
            params![&goal.owner_id, agent_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    let Some(listen_mode) = listen_mode else {
        return Ok(false);
    };
    if listen_mode.as_deref() == Some("orchestrator") {
        return Ok(true);
    }
    let (name, role_id) = if table_exists(connection, "agents")? {
        connection
            .query_row(
                "select name, role_id from agents where id = ?",
                [agent_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()?
            .unwrap_or((None, None))
    } else {
        (None, None)
    };
    let role_id = role_id.unwrap_or_default().to_lowercase();
    let name = name.unwrap_or_default().to_lowercase();
    Ok(role_id.contains("product")
        || role_id.contains("manager")
        || name.contains("pm")
        || name.contains("product"))
}

/// Mirrors assertCanManageGoal: users always allowed; agents must manage or propose.
pub fn assert_can_manage_goal(
    db: &Db,
    goal: &GoalSummary,
    actor: &GoalActor,
) -> anyhow::Result<()> {
    let GoalActor::Agent(agent_id) = actor else {
        return Ok(());
    };
    let connection = db.open_read_write()?;
    if can_agent_manage_goal(&connection, goal, agent_id)? {
        return Ok(());
    }
    anyhow::bail!("goal_agent_must_propose")
}

/// Mirrors assertCanUpdateGoalItem.
pub fn assert_can_update_goal_item(
    db: &Db,
    goal_id: &str,
    item_id: &str,
    actor: &GoalActor,
) -> anyhow::Result<()> {
    let GoalActor::Agent(agent_id) = actor else {
        return Ok(());
    };
    let connection = db.open_read_write()?;
    let Some(goal) = connection
        .query_row("select * from goals where id = ?", [goal_id], |row| {
            goal_summary_from_row(&connection, row)
        })
        .optional()?
    else {
        anyhow::bail!("goal_not_found");
    };
    if can_agent_manage_goal(&connection, &goal, agent_id)? {
        return Ok(());
    }
    let assigned: Option<Option<String>> = connection
        .query_row(
            "select assigned_agent_id from goal_items where id = ? and goal_id = ?",
            params![item_id, goal_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    if assigned.flatten().as_deref() == Some(agent_id) {
        return Ok(());
    }
    anyhow::bail!("goal_item_agent_not_assigned")
}

/// Fetch a goal summary (read-write connection variant) for authorization checks.
pub fn get_goal(db: &Db, goal_id: &str) -> anyhow::Result<Option<GoalSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection
        .query_row("select * from goals where id = ?", [goal_id], |row| {
            goal_summary_from_row(&connection, row)
        })
        .optional()?)
}

pub fn list_goals(
    db: &Db,
    owner_type: Option<&str>,
    owner_id: Option<&str>,
    status: Option<&str>,
    limit: usize,
) -> anyhow::Result<Vec<GoalSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "goals")? {
        return Ok(Vec::new());
    }
    let mut statement =
        connection.prepare("select * from goals order by updated_at desc, id desc")?;
    let mut goals = Vec::new();
    for item in statement.query_map([], |row| goal_summary_from_row(&connection, row))? {
        let goal = item?;
        if owner_type.is_some_and(|value| goal.owner_type != value) {
            continue;
        }
        if owner_id.is_some_and(|value| goal.owner_id != value) {
            continue;
        }
        if status.is_some_and(|value| goal.status != value) {
            continue;
        }
        goals.push(goal);
        if goals.len() >= limit {
            break;
        }
    }
    Ok(goals)
}

pub fn detail(db: &Db, id: &str) -> anyhow::Result<Option<GoalDetailResponse>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "goals")? {
        return Ok(None);
    }
    let Some(goal) = connection
        .query_row("select * from goals where id = ?", [id], |row| {
            goal_summary_from_row(&connection, row)
        })
        .optional()?
    else {
        return Ok(None);
    };
    Ok(Some(GoalDetailResponse {
        focuses: focuses_with_connection(&connection, id, 200)?,
        items: items_with_connection(&connection, id)?,
        proposals: proposals_with_connection(&connection, id, 100)?,
        events: events_with_connection(&connection, id, 100)?,
        goal,
    }))
}

pub fn events(db: &Db, goal_id: &str, limit: usize) -> anyhow::Result<Vec<GoalEventSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    events_with_connection(&connection, goal_id, limit)
}

pub fn focuses(db: &Db, goal_id: &str, limit: usize) -> anyhow::Result<Vec<GoalFocusSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    focuses_with_connection(&connection, goal_id, limit)
}

pub fn items(db: &Db, goal_id: &str) -> anyhow::Result<Vec<GoalItemSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    items_with_connection(&connection, goal_id)
}

pub fn proposals(db: &Db, goal_id: &str, limit: usize) -> anyhow::Result<Vec<GoalProposalSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    proposals_with_connection(&connection, goal_id, limit)
}

pub(crate) fn goal_summary_from_row(
    connection: &rusqlite::Connection,
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<GoalSummary> {
    let id: String = row.get("id")?;
    Ok(GoalSummary {
        id: id.clone(),
        owner_type: row.get("owner_type")?,
        owner_id: row.get("owner_id")?,
        text: row.get("text")?,
        mode: row.get("mode")?,
        status: row.get("status")?,
        manager_agent_id: row.get("manager_agent_id")?,
        coordinator_agent_id: row.get("coordinator_agent_id")?,
        current_focus: current_focus_summary(connection, &id).unwrap_or(None),
        progress: goal_progress(connection, &id, row.get("progress_summary")?)
            .unwrap_or_else(|_| empty_progress(None)),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
        cancelled_at: row.get("cancelled_at")?,
    })
}

fn current_focus_summary(
    connection: &rusqlite::Connection,
    goal_id: &str,
) -> anyhow::Result<Option<GoalFocusSummary>> {
    if !table_exists(connection, "goal_focuses")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select * from goal_focuses where goal_id = ? and status in ('active', 'paused') order by updated_at desc, id desc limit 1",
            [goal_id],
            focus_from_row,
        )
        .optional()?)
}

fn goal_progress(
    connection: &rusqlite::Connection,
    goal_id: &str,
    latest_summary: Option<String>,
) -> anyhow::Result<GoalProgress> {
    if !table_exists(connection, "goal_items")? {
        return Ok(empty_progress(latest_summary));
    }
    let mut statement =
        connection.prepare("select status, updated_at from goal_items where goal_id = ?")?;
    let rows = statement
        .query_map([goal_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GoalProgress {
        total_items: rows.len() as i64,
        active_items: rows
            .iter()
            .filter(|(status, _)| matches!(status.as_str(), "planned" | "active"))
            .count() as i64,
        completed_items: rows
            .iter()
            .filter(|(status, _)| status == "completed")
            .count() as i64,
        failed_items: rows.iter().filter(|(status, _)| status == "failed").count() as i64,
        blocked_items: rows
            .iter()
            .filter(|(status, _)| status == "blocked")
            .count() as i64,
        latest_summary,
        updated_at: rows
            .into_iter()
            .filter_map(|(_, updated_at)| updated_at)
            .max(),
    })
}

fn focuses_with_connection(
    connection: &rusqlite::Connection,
    goal_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<GoalFocusSummary>> {
    if !table_exists(connection, "goal_focuses")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select * from goal_focuses where goal_id = ? order by updated_at desc, id desc limit ?",
    )?;
    let items = statement
        .query_map((goal_id, limit as i64), focus_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn items_with_connection(
    connection: &rusqlite::Connection,
    goal_id: &str,
) -> anyhow::Result<Vec<GoalItemSummary>> {
    if !table_exists(connection, "goal_items")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select * from goal_items where goal_id = ? order by priority desc, updated_at desc, id desc")?;
    let items = statement
        .query_map([goal_id], item_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn events_with_connection(
    connection: &rusqlite::Connection,
    goal_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<GoalEventSummary>> {
    if !table_exists(connection, "goal_events")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select * from goal_events where goal_id = ? order by created_at desc, id desc limit ?",
    )?;
    let items = statement
        .query_map((goal_id, limit as i64), event_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn proposals_with_connection(
    connection: &rusqlite::Connection,
    goal_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<GoalProposalSummary>> {
    if !table_exists(connection, "goal_proposals")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select * from goal_proposals where goal_id = ? order by status asc, created_at desc, id desc limit ?")?;
    let items = statement
        .query_map((goal_id, limit as i64), proposal_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn focus_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalFocusSummary> {
    Ok(GoalFocusSummary {
        id: row.get("id")?,
        goal_id: row.get("goal_id")?,
        text: row.get("text")?,
        status: row.get("status")?,
        owner_agent_id: row.get("owner_agent_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
        cancelled_at: row.get("cancelled_at")?,
    })
}

fn item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalItemSummary> {
    Ok(GoalItemSummary {
        id: row.get("id")?,
        goal_id: row.get("goal_id")?,
        room_task_id: row.get("room_task_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status: row.get("status")?,
        assigned_agent_id: row.get("assigned_agent_id")?,
        priority: row.get("priority")?,
        depends_on_item_id: row.get("depends_on_item_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
        cancelled_at: row.get("cancelled_at")?,
    })
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalEventSummary> {
    Ok(GoalEventSummary {
        id: row.get("id")?,
        goal_id: row.get("goal_id")?,
        r#type: row.get("type")?,
        actor_type: row.get("actor_type")?,
        actor_id: row.get("actor_id")?,
        payload: json_value(
            row.get::<_, Option<String>>("payload")?,
            serde_json::json!({}),
        ),
        created_at: row.get("created_at")?,
    })
}

fn proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalProposalSummary> {
    Ok(GoalProposalSummary {
        id: row.get("id")?,
        goal_id: row.get("goal_id")?,
        kind: row.get("kind")?,
        status: row.get("status")?,
        title: row.get("title")?,
        payload: json_value(
            row.get::<_, Option<String>>("payload")?,
            serde_json::json!({}),
        ),
        proposed_by_agent_id: row.get("proposed_by_agent_id")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
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

fn empty_progress(latest_summary: Option<String>) -> GoalProgress {
    GoalProgress {
        total_items: 0,
        active_items: 0,
        completed_items: 0,
        failed_items: 0,
        blocked_items: 0,
        latest_summary,
        updated_at: None,
    }
}

// ---------------------------------------------------------------------------
// Write operations (mirror apps/api/src/goals/index.ts + routes.ts)
// ---------------------------------------------------------------------------

use super::models::{
    CreateGoalFocusRequest, CreateGoalItemRequest, CreateGoalProposalRequest, CreateGoalRequest,
    UpdateGoalFocusRequest, UpdateGoalItemRequest, UpdateGoalRequest,
};

fn goal_mode(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some("tracked") | Some("managed") | Some("orchestrated") | Some("reference") => {
            value.unwrap().to_string()
        }
        _ => fallback.to_string(),
    }
}

fn goal_status(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some("paused") | Some("completed") | Some("cancelled") | Some("archived")
        | Some("active") => value.unwrap().to_string(),
        _ => fallback.to_string(),
    }
}

fn goal_focus_status(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some("completed") | Some("cancelled") | Some("paused") | Some("active") => {
            value.unwrap().to_string()
        }
        _ => fallback.to_string(),
    }
}

fn goal_item_status(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some("active") | Some("blocked") | Some("completed") | Some("failed")
        | Some("cancelled") | Some("planned") => value.unwrap().to_string(),
        _ => fallback.to_string(),
    }
}

fn goal_owner_type(value: Option<&str>) -> Option<String> {
    match value {
        Some("session") | Some("agent_session") | Some("room") => Some(value.unwrap().to_string()),
        _ => None,
    }
}

fn goal_proposal_kind(value: Option<&str>) -> String {
    match value {
        Some("focus") | Some("item") | Some("plan") | Some("goal_update") => {
            value.unwrap().to_string()
        }
        _ => "goal_update".to_string(),
    }
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn record_goal_event(
    connection: &rusqlite::Connection,
    goal_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
    actor_type: Option<&str>,
    actor_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = crate::api::common::timestamp();
    connection.execute(
        "insert into goal_events (id, goal_id, type, actor_type, actor_id, payload, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        params![
            format!("goal-event-{}", random_hex(16)),
            goal_id,
            event_type,
            actor_type,
            actor_id,
            serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()),
            now,
        ],
    )?;
    Ok(())
}

fn assert_goal_owner(
    connection: &rusqlite::Connection,
    owner_type: &str,
    owner_id: &str,
) -> anyhow::Result<()> {
    if owner_type == "room" {
        let exists = table_exists(connection, "rooms")?
            && connection
                .query_row("select 1 from rooms where id = ?", [owner_id], |_| Ok(()))
                .optional()?
                .is_some();
        if !exists {
            anyhow::bail!("room_not_found");
        }
        return Ok(());
    }
    let exists = table_exists(connection, "sessions")?
        && connection
            .query_row(
                "select 1 from sessions where id = ?",
                [owner_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
    if !exists {
        anyhow::bail!("session_not_found");
    }
    Ok(())
}

fn active_goal_id_for_owner(
    connection: &rusqlite::Connection,
    owner_type: &str,
    owner_id: &str,
) -> anyhow::Result<Option<String>> {
    Ok(connection
        .query_row(
            "select id from goals where owner_type = ? and owner_id = ? and status in ('active', 'paused') order by updated_at desc, id desc limit 1",
            params![owner_type, owner_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn owner_default_goal_mode(owner_type: &str, requested: Option<&str>) -> String {
    if let Some(requested) = goal_owner_type_mode(requested) {
        return requested;
    }
    if owner_type == "room" {
        "orchestrated".to_string()
    } else {
        "reference".to_string()
    }
}

fn goal_owner_type_mode(value: Option<&str>) -> Option<String> {
    match value {
        Some("tracked") | Some("managed") | Some("orchestrated") | Some("reference") => {
            Some(value.unwrap().to_string())
        }
        _ => None,
    }
}

pub fn create_goal(
    db: &Db,
    input: CreateGoalRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let owner_type = goal_owner_type(input.owner_type.as_deref());
    let owner_id = input.owner_id.unwrap_or_default();
    let text = input.text.unwrap_or_default().trim().to_string();
    let (Some(owner_type), false, false) = (owner_type, owner_id.is_empty(), text.is_empty())
    else {
        anyhow::bail!("invalid_goal");
    };
    assert_goal_owner(&connection, &owner_type, &owner_id)?;
    let now = crate::api::common::timestamp();
    let actor_type = actor.actor_type();
    let actor_id = actor.actor_id();
    if let Some(existing) = active_goal_id_for_owner(&connection, &owner_type, &owner_id)? {
        connection.execute(
            "update goals set status = 'archived', updated_at = ? where id = ?",
            params![now, existing],
        )?;
        record_goal_event(
            &connection,
            &existing,
            "goal.archived",
            &serde_json::json!({ "reason": "replaced", "replacementOwnerType": owner_type, "replacementOwnerId": owner_id }),
            Some(actor_type),
            actor_id,
        )?;
    }
    let id = format!("goal-{}", random_hex(16));
    let mode = owner_default_goal_mode(&owner_type, input.mode.as_deref());
    connection.execute(
        "insert into goals (id, owner_type, owner_id, text, mode, status, manager_agent_id, coordinator_agent_id, progress_summary, created_at, updated_at, completed_at, cancelled_at)
         values (?, ?, ?, ?, ?, 'active', ?, ?, null, ?, ?, null, null)",
        params![id, owner_type, owner_id, text, mode, input.manager_agent_id, input.coordinator_agent_id, now, now],
    )?;
    record_goal_event(
        &connection,
        &id,
        "goal.created",
        &serde_json::json!({ "ownerType": owner_type, "ownerId": owner_id, "text": text }),
        Some(actor_type),
        actor_id,
    )?;
    if let Some(focus_text) = input
        .focus_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        create_goal_focus_inner(
            &connection,
            &id,
            &CreateGoalFocusRequest {
                text: Some(focus_text.to_string()),
                owner_agent_id: input.focus_owner_agent_id.clone(),
            },
            actor_type,
            actor_id,
        )?;
    }
    connection
        .query_row("select * from goals where id = ?", [&id], |row| {
            goal_summary_from_row(&connection, row)
        })
        .map_err(Into::into)
}

pub fn update_goal(
    db: &Db,
    id: &str,
    input: UpdateGoalRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    update_goal_inner(
        &connection,
        id,
        &input,
        actor.actor_type(),
        actor.actor_id(),
    )
}

fn update_goal_inner(
    connection: &rusqlite::Connection,
    id: &str,
    input: &UpdateGoalRequest,
    actor_type: &str,
    actor_id: Option<&str>,
) -> anyhow::Result<GoalSummary> {
    let current = connection
        .query_row(
            "select text, mode, status, manager_agent_id, coordinator_agent_id, progress_summary, completed_at, cancelled_at from goals where id = ?",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        cur_text,
        cur_mode,
        cur_status,
        cur_manager,
        cur_coordinator,
        cur_progress,
        cur_completed,
        cur_cancelled,
    )) = current
    else {
        anyhow::bail!("goal_not_found");
    };
    let now = crate::api::common::timestamp();
    let next_status = match input.status.as_deref() {
        Some(value) => goal_status(Some(value), &goal_status(Some(&cur_status), "active")),
        None => goal_status(Some(&cur_status), "active"),
    };
    let completed_at = match next_status.as_str() {
        "completed" => Some(cur_completed.clone().unwrap_or_else(|| now.clone())),
        "active" | "paused" => None,
        _ => cur_completed.clone(),
    };
    let cancelled_at = match next_status.as_str() {
        "cancelled" => Some(cur_cancelled.clone().unwrap_or_else(|| now.clone())),
        "active" | "paused" => None,
        _ => cur_cancelled.clone(),
    };
    let next_text = match input.text.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                cur_text.clone()
            } else {
                trimmed.to_string()
            }
        }
        None => cur_text.clone(),
    };
    let next_mode = match input.mode.as_deref() {
        Some(value) => goal_mode(Some(value), &goal_mode(Some(&cur_mode), "reference")),
        None => goal_mode(Some(&cur_mode), "reference"),
    };
    let next_manager = match &input.manager_agent_id {
        Some(value) => value.clone(),
        None => cur_manager.clone(),
    };
    let next_coordinator = match &input.coordinator_agent_id {
        Some(value) => value.clone(),
        None => cur_coordinator.clone(),
    };
    let next_progress = match &input.progress_summary {
        Some(value) => value
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string),
        None => cur_progress.clone(),
    };
    connection.execute(
        "update goals set text = ?, mode = ?, status = ?, manager_agent_id = ?, coordinator_agent_id = ?, progress_summary = ?, completed_at = ?, cancelled_at = ?, updated_at = ? where id = ?",
        params![next_text, next_mode, next_status, next_manager, next_coordinator, next_progress, completed_at, cancelled_at, now, id],
    )?;
    let event_payload = update_goal_event_payload(input);
    record_goal_event(
        connection,
        id,
        "goal.updated",
        &event_payload,
        Some(actor_type),
        actor_id,
    )?;
    connection
        .query_row("select * from goals where id = ?", [id], |row| {
            goal_summary_from_row(connection, row)
        })
        .map_err(Into::into)
}

fn update_goal_event_payload(input: &UpdateGoalRequest) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if let Some(text) = &input.text {
        map.insert("text".into(), serde_json::json!(text));
    }
    if let Some(mode) = &input.mode {
        map.insert("mode".into(), serde_json::json!(mode));
    }
    if let Some(status) = &input.status {
        map.insert("status".into(), serde_json::json!(status));
    }
    if let Some(value) = &input.manager_agent_id {
        map.insert("managerAgentId".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.coordinator_agent_id {
        map.insert("coordinatorAgentId".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.progress_summary {
        map.insert("progressSummary".into(), serde_json::json!(value));
    }
    serde_json::Value::Object(map)
}

pub fn create_goal_focus(
    db: &Db,
    goal_id: &str,
    input: CreateGoalFocusRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalFocusSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    create_goal_focus_inner(
        &connection,
        goal_id,
        &input,
        actor.actor_type(),
        actor.actor_id(),
    )
}

fn create_goal_focus_inner(
    connection: &rusqlite::Connection,
    goal_id: &str,
    input: &CreateGoalFocusRequest,
    actor_type: &str,
    actor_id: Option<&str>,
) -> anyhow::Result<GoalFocusSummary> {
    if connection
        .query_row("select 1 from goals where id = ?", [goal_id], |_| Ok(()))
        .optional()?
        .is_none()
    {
        anyhow::bail!("goal_not_found");
    }
    let text = input.text.clone().unwrap_or_default().trim().to_string();
    if text.is_empty() {
        anyhow::bail!("invalid_goal_focus");
    }
    let now = crate::api::common::timestamp();
    connection.execute(
        "update goal_focuses set status = 'completed', completed_at = coalesce(completed_at, ?), updated_at = ? where goal_id = ? and status in ('active', 'paused')",
        params![now, now, goal_id],
    )?;
    let id = format!("goal-focus-{}", random_hex(16));
    connection.execute(
        "insert into goal_focuses (id, goal_id, text, status, owner_agent_id, created_at, updated_at, completed_at, cancelled_at)
         values (?, ?, ?, 'active', ?, ?, ?, null, null)",
        params![id, goal_id, text, input.owner_agent_id, now, now],
    )?;
    connection.execute(
        "update goals set updated_at = ? where id = ?",
        params![now, goal_id],
    )?;
    record_goal_event(
        connection,
        goal_id,
        "focus.created",
        &serde_json::json!({ "focusId": id, "text": text, "ownerAgentId": input.owner_agent_id }),
        Some(actor_type),
        actor_id,
    )?;
    connection
        .query_row(
            "select * from goal_focuses where id = ?",
            [&id],
            focus_from_row,
        )
        .map_err(Into::into)
}

pub fn update_goal_focus(
    db: &Db,
    goal_id: &str,
    focus_id: &str,
    input: UpdateGoalFocusRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalFocusSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let current = connection
        .query_row(
            "select text, status, owner_agent_id, completed_at, cancelled_at from goal_focuses where id = ? and goal_id = ?",
            params![focus_id, goal_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((cur_text, cur_status, cur_owner, cur_completed, cur_cancelled)) = current else {
        anyhow::bail!("goal_focus_not_found");
    };
    let now = crate::api::common::timestamp();
    let next_status = match input.status.as_deref() {
        Some(value) => {
            goal_focus_status(Some(value), &goal_focus_status(Some(&cur_status), "active"))
        }
        None => goal_focus_status(Some(&cur_status), "active"),
    };
    let next_text = match input.text.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                cur_text.clone()
            } else {
                trimmed.to_string()
            }
        }
        None => cur_text.clone(),
    };
    let next_owner = match &input.owner_agent_id {
        Some(value) => value.clone(),
        None => cur_owner.clone(),
    };
    let completed_at = match next_status.as_str() {
        "completed" => Some(cur_completed.clone().unwrap_or_else(|| now.clone())),
        "active" | "paused" => None,
        _ => cur_completed.clone(),
    };
    let cancelled_at = match next_status.as_str() {
        "cancelled" => Some(cur_cancelled.clone().unwrap_or_else(|| now.clone())),
        "active" | "paused" => None,
        _ => cur_cancelled.clone(),
    };
    connection.execute(
        "update goal_focuses set text = ?, status = ?, owner_agent_id = ?, completed_at = ?, cancelled_at = ?, updated_at = ? where id = ? and goal_id = ?",
        params![next_text, next_status, next_owner, completed_at, cancelled_at, now, focus_id, goal_id],
    )?;
    connection.execute(
        "update goals set updated_at = ? where id = ?",
        params![now, goal_id],
    )?;
    let mut payload = serde_json::Map::new();
    payload.insert("focusId".into(), serde_json::json!(focus_id));
    if let Some(text) = &input.text {
        payload.insert("text".into(), serde_json::json!(text));
    }
    if let Some(status) = &input.status {
        payload.insert("status".into(), serde_json::json!(status));
    }
    if let Some(value) = &input.owner_agent_id {
        payload.insert("ownerAgentId".into(), serde_json::json!(value));
    }
    record_goal_event(
        &connection,
        goal_id,
        "focus.updated",
        &serde_json::Value::Object(payload),
        Some(actor.actor_type()),
        actor.actor_id(),
    )?;
    connection
        .query_row(
            "select * from goal_focuses where id = ?",
            [focus_id],
            focus_from_row,
        )
        .map_err(Into::into)
}

pub fn create_goal_item(
    db: &Db,
    goal_id: &str,
    input: CreateGoalItemRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalItemSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    create_goal_item_inner(
        &connection,
        goal_id,
        &input,
        actor.actor_type(),
        actor.actor_id(),
    )
}

fn create_goal_item_inner(
    connection: &rusqlite::Connection,
    goal_id: &str,
    input: &CreateGoalItemRequest,
    actor_type: &str,
    actor_id: Option<&str>,
) -> anyhow::Result<GoalItemSummary> {
    if connection
        .query_row("select 1 from goals where id = ?", [goal_id], |_| Ok(()))
        .optional()?
        .is_none()
    {
        anyhow::bail!("goal_not_found");
    }
    let title = input.title.clone().unwrap_or_default().trim().to_string();
    if title.is_empty() {
        anyhow::bail!("invalid_goal_item");
    }
    let now = crate::api::common::timestamp();
    let id = format!("goal-item-{}", random_hex(16));
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let status = goal_item_status(input.status.as_deref(), "planned");
    let priority = input.priority.unwrap_or(0);
    connection.execute(
        "insert into goal_items (id, goal_id, room_task_id, title, description, status, assigned_agent_id, priority, depends_on_item_id, created_at, updated_at, completed_at, cancelled_at)
         values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, null, null)",
        params![id, goal_id, title, description, status, input.assigned_agent_id, priority, input.depends_on_item_id, now, now],
    )?;
    connection.execute(
        "update goals set updated_at = ? where id = ?",
        params![now, goal_id],
    )?;
    record_goal_event(
        connection,
        goal_id,
        "item.created",
        &serde_json::json!({ "itemId": id, "title": title }),
        Some(actor_type),
        actor_id,
    )?;
    connection
        .query_row(
            "select * from goal_items where id = ?",
            [&id],
            item_from_row,
        )
        .map_err(Into::into)
}

pub fn update_goal_item(
    db: &Db,
    goal_id: &str,
    item_id: &str,
    input: UpdateGoalItemRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalItemSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    update_goal_item_inner(
        &connection,
        goal_id,
        item_id,
        &input,
        actor.actor_type(),
        actor.actor_id(),
    )
}

fn update_goal_item_inner(
    connection: &rusqlite::Connection,
    goal_id: &str,
    item_id: &str,
    input: &UpdateGoalItemRequest,
    actor_type: &str,
    actor_id: Option<&str>,
) -> anyhow::Result<GoalItemSummary> {
    let current = connection
        .query_row(
            "select room_task_id, title, description, status, assigned_agent_id, priority, depends_on_item_id, completed_at, cancelled_at from goal_items where id = ? and goal_id = ?",
            params![item_id, goal_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()?;
    let Some((
        cur_task,
        cur_title,
        cur_desc,
        cur_status,
        cur_assigned,
        cur_priority,
        cur_depends,
        cur_completed,
        cur_cancelled,
    )) = current
    else {
        anyhow::bail!("goal_item_not_found");
    };
    let now = crate::api::common::timestamp();
    let next_status = match input.status.as_deref() {
        Some(value) => {
            goal_item_status(Some(value), &goal_item_status(Some(&cur_status), "planned"))
        }
        None => goal_item_status(Some(&cur_status), "planned"),
    };
    let next_task = match &input.room_task_id {
        Some(value) => value.clone(),
        None => cur_task.clone(),
    };
    let next_title = match input.title.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                cur_title.clone()
            } else {
                trimmed.to_string()
            }
        }
        None => cur_title.clone(),
    };
    let next_desc = match &input.description {
        Some(value) => value
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string),
        None => cur_desc.clone(),
    };
    let next_assigned = match &input.assigned_agent_id {
        Some(value) => value.clone(),
        None => cur_assigned.clone(),
    };
    let next_priority = match input.priority {
        Some(value) => value,
        None => cur_priority,
    };
    let next_depends = match &input.depends_on_item_id {
        Some(value) => value.clone(),
        None => cur_depends.clone(),
    };
    let completed_at = match next_status.as_str() {
        "completed" => Some(cur_completed.clone().unwrap_or_else(|| now.clone())),
        "planned" | "active" | "blocked" => None,
        _ => cur_completed.clone(),
    };
    let cancelled_at = match next_status.as_str() {
        "cancelled" => Some(cur_cancelled.clone().unwrap_or_else(|| now.clone())),
        "planned" | "active" | "blocked" => None,
        _ => cur_cancelled.clone(),
    };
    connection.execute(
        "update goal_items set room_task_id = ?, title = ?, description = ?, status = ?, assigned_agent_id = ?, priority = ?, depends_on_item_id = ?, completed_at = ?, cancelled_at = ?, updated_at = ? where id = ? and goal_id = ?",
        params![next_task, next_title, next_desc, next_status, next_assigned, next_priority, next_depends, completed_at, cancelled_at, now, item_id, goal_id],
    )?;
    connection.execute(
        "update goals set updated_at = ? where id = ?",
        params![now, goal_id],
    )?;
    if let Some(room_task_id) = &input.room_task_id {
        if let Some(room_task_id) = room_task_id {
            if table_exists(connection, "room_tasks")? {
                let _ = connection.execute(
                    "update room_tasks set goal_item_id = ? where id = ?",
                    params![item_id, room_task_id],
                );
            }
        }
    }
    let mut payload = serde_json::Map::new();
    payload.insert("itemId".into(), serde_json::json!(item_id));
    if let Some(value) = &input.room_task_id {
        payload.insert("roomTaskId".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.title {
        payload.insert("title".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.description {
        payload.insert("description".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.status {
        payload.insert("status".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.assigned_agent_id {
        payload.insert("assignedAgentId".into(), serde_json::json!(value));
    }
    if let Some(value) = input.priority {
        payload.insert("priority".into(), serde_json::json!(value));
    }
    if let Some(value) = &input.depends_on_item_id {
        payload.insert("dependsOnItemId".into(), serde_json::json!(value));
    }
    record_goal_event(
        connection,
        goal_id,
        "item.updated",
        &serde_json::Value::Object(payload),
        Some(actor_type),
        actor_id,
    )?;
    if (next_status == "blocked" || next_status == "failed") && cur_status != next_status {
        create_replan_proposal(
            connection,
            goal_id,
            item_id,
            &next_status,
            actor_type,
            actor_id,
        )?;
    }
    connection
        .query_row(
            "select * from goal_items where id = ?",
            [item_id],
            item_from_row,
        )
        .map_err(Into::into)
}

fn create_replan_proposal(
    connection: &rusqlite::Connection,
    goal_id: &str,
    item_id: &str,
    status: &str,
    actor_type: &str,
    actor_id: Option<&str>,
) -> anyhow::Result<()> {
    let item = connection
        .query_row(
            "select * from goal_items where id = ? and goal_id = ?",
            params![item_id, goal_id],
            item_from_row,
        )
        .optional()?;
    let Some(item) = item else {
        return Ok(());
    };
    let duplicate = table_exists(connection, "goal_proposals")?
        && connection
            .query_row(
                "select id from goal_proposals where goal_id = ? and status = 'pending' and kind = 'plan' and json_extract(payload, '$.sourceItemId') = ? limit 1",
                params![goal_id, item_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some();
    if duplicate {
        return Ok(());
    }
    let title = if status == "blocked" {
        format!("重新规划阻塞项：{}", item.title)
    } else {
        format!("重新规划失败项：{}", item.title)
    };
    let reason = if status == "blocked" {
        "Goal item was marked blocked"
    } else {
        "Goal item or linked Room task failed"
    };
    let description = item
        .description
        .clone()
        .unwrap_or_else(|| item.title.clone());
    let payload = serde_json::json!({
        "sourceItemId": item.id,
        "sourceStatus": status,
        "reason": reason,
        "items": [
            {
                "title": format!("诊断并解除阻塞：{}", item.title),
                "description": description,
                "assignedAgentId": item.assigned_agent_id,
                "priority": item.priority + 10,
            },
            {
                "title": format!("验证替代方案：{}", item.title),
                "description": "确认重新规划后的方案可以继续推进，并更新 Goal item 状态。",
                "assignedAgentId": item.assigned_agent_id,
                "priority": item.priority + 5,
            }
        ],
    });
    let proposed_by = if actor_type == "agent" {
        actor_id
    } else {
        None
    };
    create_goal_proposal_inner(
        connection,
        goal_id,
        "plan",
        &title,
        &payload,
        proposed_by,
        actor_type,
        actor_id,
    )?;
    Ok(())
}

pub fn create_goal_proposal(
    db: &Db,
    goal_id: &str,
    input: CreateGoalProposalRequest,
    actor: &GoalActor,
) -> anyhow::Result<GoalProposalSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if connection
        .query_row("select 1 from goals where id = ?", [goal_id], |_| Ok(()))
        .optional()?
        .is_none()
    {
        anyhow::bail!("goal_not_found");
    }
    let kind = goal_proposal_kind(input.kind.as_deref());
    let title_input = input.title.unwrap_or_default();
    let title = {
        let trimmed = title_input.trim();
        if trimmed.is_empty() {
            kind.clone()
        } else {
            trimmed.to_string()
        }
    };
    let payload = input.payload.unwrap_or_else(|| serde_json::json!({}));
    // Route maps actor.type "agent" -> "agent", everything else -> "user".
    let actor_type = if actor.is_agent() { "agent" } else { "user" };
    let actor_id = actor.actor_id();
    let proposed_by = input.proposed_by_agent_id.as_deref().or(actor_id);
    create_goal_proposal_inner(
        &connection,
        goal_id,
        &kind,
        &title,
        &payload,
        proposed_by,
        actor_type,
        actor_id,
    )
}

fn create_goal_proposal_inner(
    connection: &rusqlite::Connection,
    goal_id: &str,
    kind: &str,
    title: &str,
    payload: &serde_json::Value,
    proposed_by_agent_id: Option<&str>,
    actor_type: &str,
    actor_id: Option<&str>,
) -> anyhow::Result<GoalProposalSummary> {
    let id = format!("goal-proposal-{}", random_hex(16));
    let now = crate::api::common::timestamp();
    connection.execute(
        "insert into goal_proposals (id, goal_id, kind, status, title, payload, proposed_by_agent_id, created_at, resolved_at)
         values (?, ?, ?, 'pending', ?, ?, ?, ?, null)",
        params![id, goal_id, kind, title, serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()), proposed_by_agent_id, now],
    )?;
    record_goal_event(
        connection,
        goal_id,
        "proposal.created",
        &serde_json::json!({ "proposalId": id, "kind": kind, "title": title }),
        Some(actor_type),
        actor_id,
    )?;
    connection
        .query_row(
            "select * from goal_proposals where id = ?",
            [&id],
            proposal_from_row,
        )
        .map_err(Into::into)
}

pub fn apply_goal_proposal(
    db: &Db,
    goal_id: &str,
    proposal_id: &str,
    actor: &GoalActor,
) -> anyhow::Result<GoalProposalSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let actor_type = actor.actor_type();
    let actor_id = actor.actor_id();
    let proposal = connection
        .query_row(
            "select * from goal_proposals where id = ? and goal_id = ?",
            params![proposal_id, goal_id],
            proposal_from_row,
        )
        .optional()?;
    let Some(proposal) = proposal else {
        anyhow::bail!("goal_proposal_not_found");
    };
    if proposal.status != "pending" {
        return Ok(proposal);
    }
    let payload = proposal.payload.as_object().cloned().unwrap_or_default();
    match proposal.kind.as_str() {
        "goal_update" => {
            let mode = payload
                .get("mode")
                .and_then(|v| v.as_str())
                .filter(|v| matches!(*v, "reference" | "tracked" | "managed" | "orchestrated"))
                .map(str::to_string);
            let update = UpdateGoalRequest {
                text: payload
                    .get("text")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                mode,
                status: None,
                manager_agent_id: None,
                coordinator_agent_id: None,
                progress_summary: payload
                    .get("progressSummary")
                    .and_then(|v| v.as_str())
                    .map(|v| Some(v.to_string())),
            };
            update_goal_inner(&connection, goal_id, &update, actor_type, actor_id)?;
        }
        "focus" => {
            let text = payload
                .get("text")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| proposal.title.clone());
            let owner = payload
                .get("ownerAgentId")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            create_goal_focus_inner(
                &connection,
                goal_id,
                &CreateGoalFocusRequest {
                    text: Some(text),
                    owner_agent_id: owner,
                },
                actor_type,
                actor_id,
            )?;
        }
        "item" => {
            let item = CreateGoalItemRequest {
                title: Some(
                    payload
                        .get("title")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| proposal.title.clone()),
                ),
                description: payload
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                status: None,
                assigned_agent_id: payload
                    .get("assignedAgentId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                priority: Some(
                    payload
                        .get("priority")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                ),
                depends_on_item_id: None,
            };
            create_goal_item_inner(&connection, goal_id, &item, actor_type, actor_id)?;
        }
        "plan" => {
            if let Some(items) = payload.get("items").and_then(|v| v.as_array()) {
                for raw in items.iter().take(20) {
                    let Some(obj) = raw.as_object() else { continue };
                    let title = obj
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if title.is_empty() {
                        continue;
                    }
                    let item = CreateGoalItemRequest {
                        title: Some(title),
                        description: obj
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        status: None,
                        assigned_agent_id: obj
                            .get("assignedAgentId")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        priority: Some(obj.get("priority").and_then(|v| v.as_i64()).unwrap_or(0)),
                        depends_on_item_id: None,
                    };
                    create_goal_item_inner(&connection, goal_id, &item, actor_type, actor_id)?;
                }
            }
        }
        _ => {}
    }
    let now = crate::api::common::timestamp();
    connection.execute("update goal_proposals set status = 'approved', resolved_at = ? where id = ? and goal_id = ?", params![now, proposal_id, goal_id])?;
    record_goal_event(
        &connection,
        goal_id,
        "proposal.approved",
        &serde_json::json!({ "proposalId": proposal_id, "kind": proposal.kind }),
        Some(actor_type),
        actor_id,
    )?;
    connection
        .query_row(
            "select * from goal_proposals where id = ?",
            [proposal_id],
            proposal_from_row,
        )
        .map_err(Into::into)
}

pub fn reject_goal_proposal(
    db: &Db,
    goal_id: &str,
    proposal_id: &str,
    actor: &GoalActor,
) -> anyhow::Result<GoalProposalSummary> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if connection
        .query_row(
            "select 1 from goal_proposals where id = ? and goal_id = ?",
            params![proposal_id, goal_id],
            |_| Ok(()),
        )
        .optional()?
        .is_none()
    {
        anyhow::bail!("goal_proposal_not_found");
    }
    let now = crate::api::common::timestamp();
    connection.execute(
        "update goal_proposals set status = 'rejected', resolved_at = ? where id = ? and goal_id = ? and status = 'pending'",
        params![now, proposal_id, goal_id],
    )?;
    record_goal_event(
        &connection,
        goal_id,
        "proposal.rejected",
        &serde_json::json!({ "proposalId": proposal_id }),
        Some(actor.actor_type()),
        actor.actor_id(),
    )?;
    connection
        .query_row(
            "select * from goal_proposals where id = ?",
            [proposal_id],
            proposal_from_row,
        )
        .map_err(Into::into)
}

pub fn create_default_goal_plan(
    db: &Db,
    goal_id: &str,
    actor: &GoalActor,
) -> anyhow::Result<Vec<GoalItemSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let actor_type = actor.actor_type();
    let actor_id = actor.actor_id();
    let goal = connection
        .query_row("select * from goals where id = ?", [goal_id], |row| {
            goal_summary_from_row(&connection, row)
        })
        .optional()?;
    let Some(goal) = goal else {
        anyhow::bail!("goal_not_found");
    };
    // Existing non-cancelled items short-circuit (mirrors createDefaultGoalPlan).
    {
        let mut statement = connection.prepare("select * from goal_items where goal_id = ? and status not in ('cancelled') order by priority desc, updated_at desc, id desc")?;
        let existing = statement
            .query_map([goal_id], item_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        if !existing.is_empty() {
            return Ok(existing);
        }
    }
    let current_focus = current_focus_text(&connection, goal_id)?;
    let room_agents: Vec<String> = if goal.owner_type == "room"
        && table_exists(&connection, "room_agents")?
    {
        let mut statement = connection
            .prepare("select agent_id from room_agents where room_id = ? order by joined_at asc")?;
        let rows = statement
            .query_map([&goal.owner_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        Vec::new()
    };
    let pick = |index: usize| -> Option<String> {
        room_agents
            .get(index)
            .cloned()
            .or_else(|| room_agents.first().cloned())
    };
    let templates: Vec<(&str, String, i64, Option<String>)> = vec![
        (
            "需求澄清与范围确认",
            goal.text.clone(),
            50,
            room_agents.first().cloned(),
        ),
        (
            "方案设计与任务拆解",
            current_focus.clone().unwrap_or_else(|| goal.text.clone()),
            40,
            pick(1),
        ),
        ("实现与验证", goal.text.clone(), 30, pick(2)),
        ("审查、修正与交付总结", goal.text.clone(), 20, pick(3)),
    ];
    let mut items = Vec::new();
    for (title, description, priority, assigned) in templates {
        let item = create_goal_item_inner(
            &connection,
            goal_id,
            &CreateGoalItemRequest {
                title: Some(title.to_string()),
                description: Some(description),
                status: Some("planned".to_string()),
                assigned_agent_id: assigned,
                priority: Some(priority),
                depends_on_item_id: None,
            },
            actor_type,
            actor_id,
        )?;
        items.push(item);
    }
    let item_ids: Vec<String> = items.iter().map(|item| item.id.clone()).collect();
    record_goal_event(
        &connection,
        goal_id,
        "goal.planned",
        &serde_json::json!({ "itemIds": item_ids }),
        Some(actor_type),
        actor_id,
    )?;
    Ok(items)
}

fn current_focus_text(
    connection: &rusqlite::Connection,
    goal_id: &str,
) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "goal_focuses")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select text from goal_focuses where goal_id = ? and status in ('active', 'paused') order by updated_at desc, id desc limit 1",
            [goal_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

// ---------------------------------------------------------------------------
// Orchestrate (mirrors POST /api/goals/:id/orchestrate). Creates linked room tasks,
// records goal/room events, and the route triggers the Rust room orchestrator.
// ---------------------------------------------------------------------------

pub struct OrchestrateOutcome {
    pub goal: GoalSummary,
    pub tasks: Vec<crate::api::rooms::models::RoomTaskSummary>,
}

pub fn orchestrate_goal(
    db: &Db,
    goal_id: &str,
    actor: &GoalActor,
) -> anyhow::Result<OrchestrateOutcome> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let goal = connection
        .query_row("select * from goals where id = ?", [goal_id], |row| {
            goal_summary_from_row(&connection, row)
        })
        .optional()?;
    let Some(goal) = goal else {
        anyhow::bail!("goal_not_found");
    };
    // Authorization (assertCanManageGoal) — caller handles 403 mapping.
    if let GoalActor::Agent(agent_id) = actor {
        if !can_agent_manage_goal(&connection, &goal, agent_id)? {
            anyhow::bail!("goal_agent_must_propose");
        }
    }
    if goal.owner_type != "room" {
        anyhow::bail!("goal_owner_not_room");
    }
    let room_exists = table_exists(&connection, "rooms")?
        && connection
            .query_row("select 1 from rooms where id = ?", [&goal.owner_id], |_| {
                Ok(())
            })
            .optional()?
            .is_some();
    if !room_exists {
        anyhow::bail!("room_not_found");
    }
    let actor_type = "system";
    // Pending items lacking a room task.
    let mut items: Vec<GoalItemSummary> = {
        let mut statement = connection.prepare(
            "select * from goal_items where goal_id = ? and room_task_id is null and status not in ('completed', 'cancelled') order by priority desc, updated_at asc",
        )?;
        let rows = statement
            .query_map([goal_id], item_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if items.is_empty() {
        let focus = current_focus_text(&connection, goal_id)?;
        let title = focus
            .clone()
            .unwrap_or_else(|| goal.text.chars().take(120).collect());
        let description = if focus.is_some() {
            Some(goal.text.clone())
        } else {
            None
        };
        let assigned = goal
            .coordinator_agent_id
            .clone()
            .or_else(|| goal.manager_agent_id.clone());
        let item = create_goal_item_inner(
            &connection,
            goal_id,
            &CreateGoalItemRequest {
                title: Some(title),
                description,
                status: Some("planned".to_string()),
                assigned_agent_id: assigned,
                priority: Some(1),
                depends_on_item_id: None,
            },
            actor_type,
            None,
        )?;
        items.push(item);
    }
    let now = crate::api::common::timestamp();
    let focus_text = current_focus_text(&connection, goal_id)?;
    let mut created: Vec<crate::api::rooms::models::RoomTaskSummary> = Vec::new();
    for item in &items {
        // Validate assigned agent is a room member, else fall back to coordinator/manager.
        let assigned_agent_id = match &item.assigned_agent_id {
            Some(agent_id)
                if table_exists(&connection, "room_agents")?
                    && connection
                        .query_row(
                            "select agent_id from room_agents where room_id = ? and agent_id = ?",
                            params![&goal.owner_id, agent_id],
                            |_| Ok(()),
                        )
                        .optional()?
                        .is_some() =>
            {
                Some(agent_id.clone())
            }
            _ => goal
                .coordinator_agent_id
                .clone()
                .or_else(|| goal.manager_agent_id.clone()),
        };
        let task_id = format!("room-task-{}", random_hex(16));
        // Mirror TS: [description, "", `Goal: ...`, focus?].filter(Boolean).join("\n").
        let prompt = {
            let mut parts: Vec<String> = Vec::new();
            if let Some(desc) = &item.description {
                if !desc.is_empty() {
                    parts.push(desc.clone());
                }
            }
            parts.push(format!("Goal: {}", goal.text));
            if let Some(focus) = &focus_text {
                parts.push(format!("Current focus: {focus}"));
            }
            parts.join("\n")
        };
        let status = if assigned_agent_id.is_some() {
            "assigned"
        } else {
            "queued"
        };
        let payload = serde_json::json!({ "source": "goal-orchestrated", "goalId": goal.id, "goalItemId": item.id });
        connection.execute(
            "insert into room_tasks (id, room_id, goal_item_id, title, prompt, status, assigned_agent_id, priority, depends_on_task_id, scheduled_at, payload, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?)",
            params![
                task_id,
                goal.owner_id,
                item.id,
                item.title,
                prompt,
                status,
                assigned_agent_id,
                item.priority,
                serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string()),
                now,
                now,
            ],
        )?;
        update_goal_item_inner(
            &connection,
            goal_id,
            &item.id,
            &UpdateGoalItemRequest {
                title: None,
                description: None,
                status: Some("active".to_string()),
                assigned_agent_id: Some(assigned_agent_id.clone()),
                priority: None,
                depends_on_item_id: None,
                room_task_id: Some(Some(task_id.clone())),
            },
            actor_type,
            None,
        )?;
        let task = connection.query_row(
            "select * from room_tasks where id = ?",
            [&task_id],
            room_task_from_row,
        )?;
        created.push(task);
        // Mirror roomEvent(goal.ownerId, "goal.task.created", ...).
        record_room_event(
            &connection,
            &goal.owner_id,
            "goal.task.created",
            &serde_json::json!({ "goalId": goal.id, "goalItemId": item.id, "taskId": task_id, "title": item.title }),
            assigned_agent_id.as_deref(),
        )?;
    }
    let task_ids: Vec<String> = created.iter().map(|task| task.id.clone()).collect();
    record_goal_event(
        &connection,
        goal_id,
        "goal.orchestrated",
        &serde_json::json!({ "roomId": goal.owner_id, "taskIds": task_ids }),
        Some("system"),
        None,
    )?;
    let goal = connection.query_row("select * from goals where id = ?", [goal_id], |row| {
        goal_summary_from_row(&connection, row)
    })?;
    Ok(OrchestrateOutcome {
        goal,
        tasks: created,
    })
}

fn room_task_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<crate::api::rooms::models::RoomTaskSummary> {
    Ok(crate::api::rooms::models::RoomTaskSummary {
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

fn record_room_event(
    connection: &rusqlite::Connection,
    room_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
    source_agent_id: Option<&str>,
) -> anyhow::Result<()> {
    if !table_exists(connection, "room_events")? {
        return Ok(());
    }
    let now = crate::api::common::timestamp();
    connection.execute(
        "insert into room_events (id, room_id, type, source_agent_id, target_agent_id, payload, created_at) values (?, ?, ?, ?, null, ?, ?)",
        params![
            format!("room-event-{}", random_hex(16)),
            room_id,
            event_type,
            source_agent_id,
            serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()),
            now,
        ],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Schema bootstrap (mirrors apps/api/src/index.ts goal* table definitions).
// ---------------------------------------------------------------------------

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
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
        create index if not exists goals_owner_updated_idx on goals(owner_type, owner_id, updated_at desc, id desc);
        create table if not exists goal_events (
          id text primary key,
          goal_id text not null,
          type text not null,
          actor_type text,
          actor_id text,
          payload text not null,
          created_at text not null
        );
        create index if not exists goal_events_goal_created_idx on goal_events(goal_id, created_at desc, id desc);
        create table if not exists goal_proposals (
          id text primary key,
          goal_id text not null,
          kind text not null,
          status text not null,
          title text not null,
          payload text not null,
          proposed_by_agent_id text,
          created_at text not null,
          resolved_at text
        );
        create index if not exists goal_proposals_goal_status_created_idx on goal_proposals(goal_id, status, created_at desc, id desc);
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
        create index if not exists goal_focuses_goal_updated_idx on goal_focuses(goal_id, updated_at desc, id desc);
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
        create index if not exists goal_items_goal_updated_idx on goal_items(goal_id, updated_at desc, id desc);
        ",
    )?;
    Ok(())
}
