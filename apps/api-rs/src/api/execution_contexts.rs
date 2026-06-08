use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::{db::Db, state::AppState};

// Port of GET /api/execution-contexts from apps/api/src/tasks/routes.ts +
// apps/api/src/agents/execution-contexts.ts (executionContextFromRow).

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionContextSummary {
    pub id: String,
    pub source_type: String,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub room_id: Option<String>,
    pub project_id: Option<String>,
    pub workspace_path: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub permission_profile_id: Option<String>,
    pub resolved_permissions: serde_json::Value,
    pub sandbox_mode: String,
    pub approval_policy: String,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionContextQuery {
    session_id: Option<String>,
    agent_id: Option<String>,
    limit: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ExecutionContextQuery>,
) -> Json<Vec<ExecutionContextSummary>> {
    let limit = crate::api::common::parse_limit(query.limit.as_deref(), 50, 100);
    Json(
        list_contexts(
            &state.db,
            query.session_id.as_deref(),
            query.agent_id.as_deref(),
            limit,
        )
        .unwrap_or_default(),
    )
}

fn list_contexts(
    db: &Db,
    session_id: Option<&str>,
    agent_id: Option<&str>,
    limit: usize,
) -> anyhow::Result<Vec<ExecutionContextSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "execution_contexts")? {
        return Ok(Vec::new());
    }
    let session_id = session_id.filter(|value| !value.trim().is_empty());
    let agent_id = agent_id.filter(|value| !value.trim().is_empty());
    // Resolve the room id when filtering by a room session, matching the TS query.
    let room_id = session_id.and_then(|id| resolve_room_id(&connection, id));

    let mut statement = connection.prepare(
        "select id, source_type, session_id, agent_id, room_id, project_id, workspace_path, provider_id, model,
                permission_profile_id, resolved_permissions, sandbox_mode, approval_policy, created_by, created_at
         from execution_contexts
         where (
             ?1 is null
             or session_id = ?1
             or (?2 is not null and room_id = ?2)
           )
           and (?3 is null or agent_id = ?3)
         order by created_at desc, id desc
         limit ?4",
    )?;
    let rows = statement
        .query_map(
            rusqlite::params![session_id, room_id, agent_id, limit as i64],
            |row| {
                let permission_profile_id: Option<String> = row.get(9)?;
                let resolved_permissions_raw: Option<String> = row.get(10)?;
                Ok(ExecutionContextSummary {
                    id: row.get(0)?,
                    source_type: row.get(1)?,
                    session_id: row.get(2)?,
                    agent_id: row.get(3)?,
                    room_id: row.get(4)?,
                    project_id: row.get(5)?,
                    workspace_path: row.get(6)?,
                    provider_id: row.get(7)?,
                    model: row.get(8)?,
                    permission_profile_id: permission_profile_id
                        .filter(|value| is_known_profile(value)),
                    resolved_permissions: resolved_permissions_raw
                        .and_then(|value| serde_json::from_str(&value).ok())
                        .unwrap_or_else(|| serde_json::json!({})),
                    sandbox_mode: row.get(11)?,
                    approval_policy: row.get(12)?,
                    created_by: row.get(13)?,
                    created_at: row.get(14)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn resolve_room_id(connection: &rusqlite::Connection, session_id: &str) -> Option<String> {
    if !table_exists(connection, "sessions").unwrap_or(false) {
        return None;
    }
    let row: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            "select conversation_type, room_id from sessions where id = ? limit 1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    match row {
        Some((Some(conversation_type), room_id)) if conversation_type == "room" => room_id,
        _ => None,
    }
}

fn is_known_profile(value: &str) -> bool {
    matches!(
        value,
        "read-only" | "workspace-write" | "developer" | "maintainer" | "danger-full-access"
    )
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
