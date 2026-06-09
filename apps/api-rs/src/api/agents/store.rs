use rusqlite::{params, OptionalExtension};

use crate::api::common::PageResponse;
use crate::api::sessions::models::SessionSummary;
use crate::db::Db;

use super::models::{
    AgentBatchRequest, AgentCircleSummary, AgentGroupSummary, AgentRoleSummary, AgentStats,
    AgentSummary, CreateAgentCircleRequest, CreateAgentGroupRequest, CreateAgentRequest,
    CreateAgentRoleFromTemplateRequest, CreateAgentRoleRequest, CreateAgentSessionRequest,
    ImportRoleFileRequest, PermissionProfileSummary, UpdateAgentCircleRequest,
    UpdateAgentGroupRequest, UpdateAgentRequest, UpdateAgentRoleRequest,
};
use super::role_templates;

pub fn list_roles(db: &Db, limit: usize) -> anyhow::Result<PageResponse<AgentRoleSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "agent_roles")? {
        return Ok(page(Vec::new(), false));
    }
    let mut statement = connection
        .prepare("select * from agent_roles order by updated_at desc, id desc limit ?")?;
    let mut items = statement
        .query_map([limit as i64 + 1], role_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    Ok(page(items, has_more))
}

pub fn list_agents(db: &Db, limit: usize) -> anyhow::Result<PageResponse<AgentSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "agents")? {
        return Ok(page(Vec::new(), false));
    }
    let mut statement =
        connection.prepare("select * from agents order by updated_at desc, id desc limit ?")?;
    let mut items = statement
        .query_map([limit as i64 + 1], agent_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    Ok(page(items, has_more))
}

pub fn list_groups(db: &Db, limit: usize) -> anyhow::Result<PageResponse<AgentGroupSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "agent_groups")? {
        return Ok(page(Vec::new(), false));
    }
    let mut statement = connection
        .prepare("select * from agent_groups order by updated_at desc, id desc limit ?")?;
    let mut groups = Vec::new();
    for row in statement.query_map([limit as i64 + 1], |row| group_from_row(&connection, row))? {
        groups.push(row?);
    }
    let has_more = groups.len() > limit;
    groups.truncate(limit);
    Ok(page(groups, has_more))
}

pub fn list_circles(db: &Db, limit: usize) -> anyhow::Result<PageResponse<AgentCircleSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "agent_circles")? {
        return Ok(page(Vec::new(), false));
    }
    let mut statement = connection
        .prepare("select * from agent_circles order by builtin desc, name asc, id desc limit ?")?;
    let mut circles = Vec::new();
    for row in statement.query_map([limit as i64 + 1], |row| circle_from_row(&connection, row))? {
        circles.push(row?);
    }
    let has_more = circles.len() > limit;
    circles.truncate(limit);
    Ok(page(circles, has_more))
}

pub fn permission_profiles() -> Vec<PermissionProfileSummary> {
    vec![
        PermissionProfileSummary {
            id: "default".to_string(),
            permissions: serde_json::json!({
                "canReadFiles": true,
                "canWriteFiles": true,
                "canRunCommands": true,
                "canCreatePreview": true
            }),
        },
        PermissionProfileSummary {
            id: "read-only".to_string(),
            permissions: serde_json::json!({
                "canReadFiles": true,
                "canWriteFiles": false,
                "canRunCommands": false,
                "canCreatePreview": false
            }),
        },
    ]
}

pub fn list_role_templates(
    template_dir: &std::path::Path,
) -> Vec<role_templates::AgentRoleTemplateSummary> {
    role_templates::list_agent_role_templates(template_dir)
        .into_iter()
        .map(|record| record.summary)
        .collect()
}

fn role_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRoleSummary> {
    Ok(AgentRoleSummary {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        source_type: row.get("source_type")?,
        source_path: row.get("source_path")?,
        source_url: row.get("source_url")?,
        markdown_content: row.get("markdown_content")?,
        system_prompt: row.get("system_prompt")?,
        capabilities: json_array(row.get::<_, Option<String>>("capabilities")?),
        default_listen_mode: normalize_listen_mode(
            row.get::<_, Option<String>>("default_listen_mode")?
                .as_deref(),
            "passive",
        ),
        default_listen_events: json_array(row.get::<_, Option<String>>("default_listen_events")?),
        default_workspace_mode: row
            .get::<_, Option<String>>("default_workspace_mode")?
            .unwrap_or_else(|| "isolated-worktree-with-shared-room".to_string()),
        default_sandbox_mode: row.get("default_sandbox_mode")?,
        default_approval_policy: row.get("default_approval_policy")?,
        output_contract: row.get("output_contract")?,
        safety_notes: row.get("safety_notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn agent_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSummary> {
    Ok(AgentSummary {
        id: row.get("id")?,
        name: row.get("name")?,
        role_id: row.get("role_id")?,
        description: row.get("description")?,
        extra_prompt: row.get("extra_prompt")?,
        provider_id: row.get("provider_id")?,
        model: row.get("model")?,
        workspace_mode: row
            .get::<_, Option<String>>("workspace_mode")?
            .unwrap_or_else(|| "isolated-worktree-with-shared-room".to_string()),
        default_project_id: row.get("default_project_id")?,
        favorite_project_ids: json_array(row.get::<_, Option<String>>("favorite_project_ids")?),
        project_access_mode: row
            .get::<_, Option<String>>("project_access_mode")?
            .unwrap_or_else(|| "all".to_string()),
        allowed_project_ids: json_array(row.get::<_, Option<String>>("allowed_project_ids")?),
        permission_profile_id: row.get("permission_profile_id")?,
        permissions: json_value(
            row.get::<_, Option<String>>("permissions")?,
            serde_json::json!({}),
        ),
        max_concurrent_runs: row
            .get::<_, Option<i64>>("max_concurrent_runs")?
            .unwrap_or(1)
            .max(1),
        enabled: row.get::<_, i64>("enabled")? == 1,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn group_from_row(
    connection: &rusqlite::Connection,
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentGroupSummary> {
    let id: String = row.get("id")?;
    let members = if table_exists(connection, "agent_group_members").unwrap_or(false) {
        let mut statement = connection.prepare("select agent_id, listen_mode from agent_group_members where group_id = ? order by agent_id asc")?;
        let members = statement
            .query_map([&id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    normalize_listen_mode(row.get::<_, Option<String>>(1)?.as_deref(), "passive"),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        members
    } else {
        Vec::new()
    };
    Ok(AgentGroupSummary {
        id,
        name: row.get("name")?,
        description: row.get("description")?,
        agent_ids: members
            .iter()
            .map(|(agent_id, _)| agent_id.clone())
            .collect(),
        member_listen_modes: serde_json::Value::Object(
            members
                .into_iter()
                .map(|(agent_id, mode)| (agent_id, serde_json::Value::String(mode)))
                .collect(),
        ),
        collaboration_rules: row
            .get::<_, Option<String>>("collaboration_rules")?
            .unwrap_or_default(),
        event_routing_rules: row
            .get::<_, Option<String>>("event_routing_rules")?
            .unwrap_or_default(),
        max_concurrent_agents: row
            .get::<_, Option<i64>>("max_concurrent_agents")?
            .unwrap_or(1)
            .max(1),
        approval_policy: row
            .get::<_, Option<String>>("approval_policy")?
            .unwrap_or_else(|| "bounded".to_string()),
        merge_strategy: row
            .get::<_, Option<String>>("merge_strategy")?
            .unwrap_or_else(|| "approval-required".to_string()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn circle_from_row(
    connection: &rusqlite::Connection,
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentCircleSummary> {
    let id: String = row.get("id")?;
    let role_ids = if table_exists(connection, "agent_circle_roles").unwrap_or(false) {
        let mut statement = connection.prepare("select role_id from agent_circle_roles where circle_id = ? order by position asc, role_id asc")?;
        let role_ids = statement
            .query_map([&id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        role_ids
    } else {
        Vec::new()
    };
    Ok(AgentCircleSummary {
        id,
        name: row.get("name")?,
        description: row.get("description")?,
        role_ids,
        collaboration_rules: row
            .get::<_, Option<String>>("collaboration_rules")?
            .unwrap_or_default(),
        event_routing_rules: row
            .get::<_, Option<String>>("event_routing_rules")?
            .unwrap_or_default(),
        max_concurrent_agents: row
            .get::<_, Option<i64>>("max_concurrent_agents")?
            .unwrap_or(3)
            .max(1),
        approval_policy: row
            .get::<_, Option<String>>("approval_policy")?
            .unwrap_or_else(|| "bounded".to_string()),
        merge_strategy: row
            .get::<_, Option<String>>("merge_strategy")?
            .unwrap_or_else(|| "approval-required".to_string()),
        group_template_id: row.get("group_template_id")?,
        builtin: row.get::<_, i64>("builtin")? == 1,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
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

fn json_array(value: Option<String>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&value).unwrap_or_default()
}

fn json_value(value: Option<String>, fallback: serde_json::Value) -> serde_json::Value {
    value
        .and_then(|item| serde_json::from_str(&item).ok())
        .unwrap_or(fallback)
}

fn normalize_listen_mode(value: Option<&str>, fallback: &str) -> String {
    match value.unwrap_or(fallback) {
        "active" => "active".to_string(),
        _ => "passive".to_string(),
    }
}

fn page<T>(items: Vec<T>, has_more: bool) -> PageResponse<T> {
    PageResponse {
        items,
        next_cursor: None,
        has_more,
    }
}

// ---------------------------------------------------------------------------
// Schema bootstrap (mirrors apps/api/src/agents schema columns used by routes)
// ---------------------------------------------------------------------------

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists agent_roles (
          id text primary key,
          name text not null,
          description text,
          source_type text not null default 'custom-markdown',
          source_path text,
          source_url text,
          markdown_content text,
          system_prompt text not null,
          capabilities text not null default '[]',
          default_listen_mode text not null default 'passive',
          default_listen_events text not null default '[]',
          default_workspace_mode text not null default 'isolated-worktree-with-shared-room',
          default_sandbox_mode text,
          default_approval_policy text,
          output_contract text,
          safety_notes text,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists agents (
          id text primary key,
          name text not null,
          role_id text not null,
          description text,
          extra_prompt text,
          provider_id text,
          model text,
          listen_mode text not null default 'passive',
          listen_events text not null default '[]',
          workspace_mode text not null default 'isolated-worktree-with-shared-room',
          default_project_id text,
          favorite_project_ids text not null default '[]',
          project_access_mode text not null default 'all',
          allowed_project_ids text not null default '[]',
          permission_profile_id text,
          permissions text not null default '{}',
          max_concurrent_runs integer not null default 1,
          enabled integer not null default 1,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists agent_groups (
          id text primary key,
          name text not null,
          description text,
          collaboration_rules text,
          event_routing_rules text,
          max_concurrent_agents integer not null default 3,
          approval_policy text,
          merge_strategy text,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists agent_group_members (
          group_id text not null,
          agent_id text not null,
          listen_mode text,
          primary key (group_id, agent_id)
        );
        create table if not exists agent_circles (
          id text primary key,
          name text not null,
          description text,
          group_template_id text,
          collaboration_rules text,
          event_routing_rules text,
          max_concurrent_agents integer not null default 3,
          approval_policy text,
          merge_strategy text,
          builtin integer not null default 0,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists agent_circle_roles (
          circle_id text not null,
          role_id text not null,
          position integer not null default 0,
          primary key (circle_id, role_id)
        );
        create table if not exists agent_sessions (
          session_id text primary key,
          agent_id text not null,
          created_at text not null
        );
        ",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Agent role write routes
// ---------------------------------------------------------------------------

pub fn create_role(db: &Db, body: CreateAgentRoleRequest) -> anyhow::Result<AgentRoleSummary> {
    let markdown_content = trim_or_empty(body.markdown_content.as_deref())
        .or_else(|| trim_or_empty(body.system_prompt.as_deref()))
        .unwrap_or_default();
    let description = trim_or_empty(body.description.as_deref())
        .unwrap_or_else(|| role_templates::markdown_description(&markdown_content));
    let base_prompt =
        trim_or_empty(body.system_prompt.as_deref()).unwrap_or_else(|| markdown_content.clone());
    let system_prompt = role_templates::system_prompt_with_role_description(
        &base_prompt,
        Some(&description),
        body.include_description_in_prompt.unwrap_or(false),
    );
    if body.name.as_deref().map(str::trim).unwrap_or("").is_empty() || system_prompt.is_empty() {
        anyhow::bail!("invalid_agent_role");
    }
    let name = body.name.as_deref().unwrap().trim().to_string();
    let now = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let id = unique_id(&connection, "agent_roles", &slugify(&name))?;
    connection.execute(
        "insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &id,
            &name,
            &description,
            role_source_type(body.source_type.as_deref()),
            trim_or_empty(body.source_path.as_deref()),
            trim_or_empty(body.source_url.as_deref()),
            &markdown_content,
            &system_prompt,
            serde_json::to_string(&body.capabilities.unwrap_or_default())?,
            listen_mode(body.default_listen_mode.as_deref(), "passive"),
            serde_json::to_string(&body.default_listen_events.unwrap_or_default())?,
            workspace_mode(body.default_workspace_mode.as_deref(), "isolated-worktree-with-shared-room"),
            body.default_sandbox_mode.as_deref(),
            body.default_approval_policy.as_deref(),
            trim_or_empty(body.output_contract.as_deref()),
            trim_or_empty(body.safety_notes.as_deref()),
            &now,
            &now,
        ],
    )?;
    read_role(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("invalid_agent_role"))
}

pub fn create_role_from_template(
    db: &Db,
    template_dir: &std::path::Path,
    body: CreateAgentRoleFromTemplateRequest,
) -> anyhow::Result<AgentRoleSummary> {
    let template_id = body
        .template_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(template_id) = template_id else {
        anyhow::bail!("template_required");
    };
    let templates = role_templates::list_agent_role_templates(template_dir);
    let Some(template) = templates
        .into_iter()
        .find(|item| item.summary.id == template_id)
    else {
        anyhow::bail!("agent_role_template_not_found");
    };
    let now = crate::api::common::timestamp();
    let role_name =
        trim_or_empty(body.name.as_deref()).unwrap_or_else(|| template.summary.name.clone());
    let description = trim_or_empty(body.description.as_deref())
        .unwrap_or_else(|| template.summary.description.clone());
    let system_prompt = role_templates::system_prompt_with_role_description(
        &template.markdown_content,
        Some(&description),
        body.include_description_in_prompt.unwrap_or(false),
    );
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let id = unique_id(&connection, "agent_roles", &slugify(&role_name))?;
    connection.execute(
        "insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at) values (?, ?, ?, 'builtin-template', ?, ?, ?, ?, '[]', 'passive', '[]', 'isolated-worktree-with-shared-room', null, null, null, null, ?, ?)",
        params![
            &id,
            &role_name,
            &description,
            &template.summary.source_path,
            template.summary.source_url.as_deref(),
            &template.markdown_content,
            &system_prompt,
            &now,
            &now,
        ],
    )?;
    read_role(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("agent_role_template_not_found"))
}

pub fn import_role_file(db: &Db, body: ImportRoleFileRequest) -> anyhow::Result<AgentRoleSummary> {
    let path = body
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(path) = path else {
        anyhow::bail!("path_required");
    };
    let absolute_path = resolve_terminal_cwd(path);
    let metadata =
        std::fs::metadata(&absolute_path).map_err(|_| anyhow::anyhow!("invalid_role_file"))?;
    if !metadata.is_file() || metadata.len() > 1024 * 1024 {
        anyhow::bail!("invalid_role_file");
    }
    let markdown_content = std::fs::read_to_string(&absolute_path)
        .map_err(|_| anyhow::anyhow!("invalid_role_file"))?;
    let base_name = std::path::Path::new(&absolute_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let stripped = {
        let lower = base_name.to_ascii_lowercase();
        if lower.ends_with(".markdown") {
            base_name[..base_name.len() - ".markdown".len()].to_string()
        } else if lower.ends_with(".md") {
            base_name[..base_name.len() - ".md".len()].to_string()
        } else {
            base_name.clone()
        }
    };
    let name = trim_or_empty(body.name.as_deref())
        .or_else(|| {
            let title = role_templates::markdown_title(&markdown_content);
            if title.is_empty() {
                None
            } else {
                Some(title)
            }
        })
        .unwrap_or(stripped);
    let description = role_templates::markdown_description(&markdown_content);
    let now = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let id = unique_id(&connection, "agent_roles", &slugify(&name))?;
    connection.execute(
        "insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at) values (?, ?, ?, 'file-import', ?, null, ?, ?, '[]', 'passive', '[]', 'isolated-worktree-with-shared-room', null, null, null, null, ?, ?)",
        params![&id, &name, &description, &absolute_path, &markdown_content, &markdown_content, &now, &now],
    )?;
    read_role(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("role_import_failed"))
}

pub fn update_role(
    db: &Db,
    id: &str,
    body: UpdateAgentRoleRequest,
) -> anyhow::Result<Option<AgentRoleSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(next) = read_role(&connection, id)? else {
        return Ok(None);
    };
    let markdown_content = body
        .markdown_content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| next.markdown_content.clone());
    let description: Option<String> = match &body.description {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.description_option(),
    };
    let base_prompt = body
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if markdown_content.is_empty() {
                next.system_prompt.clone()
            } else {
                markdown_content.clone()
            }
        });
    let system_prompt = role_templates::system_prompt_with_role_description(
        &base_prompt,
        description.as_deref(),
        body.include_description_in_prompt.unwrap_or(false),
    );
    let source_path: Option<String> = match &body.source_path {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.source_path.clone(),
    };
    let source_url: Option<String> = match &body.source_url {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.source_url.clone(),
    };
    let default_sandbox_mode: Option<String> = match &body.default_sandbox_mode {
        Some(inner) => inner.clone(),
        None => next.default_sandbox_mode.clone(),
    };
    let default_approval_policy: Option<String> = match &body.default_approval_policy {
        Some(inner) => inner.clone(),
        None => next.default_approval_policy.clone(),
    };
    let output_contract: Option<String> = match &body.output_contract {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.output_contract.clone(),
    };
    let safety_notes: Option<String> = match &body.safety_notes {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.safety_notes.clone(),
    };
    let now = crate::api::common::timestamp();
    connection.execute(
        "update agent_roles set name = ?, description = ?, source_type = ?, source_path = ?, source_url = ?, markdown_content = ?, system_prompt = ?, capabilities = ?, default_listen_mode = ?, default_listen_events = ?, default_workspace_mode = ?, default_sandbox_mode = ?, default_approval_policy = ?, output_contract = ?, safety_notes = ?, updated_at = ? where id = ?",
        params![
            trim_or_empty(body.name.as_deref()).unwrap_or_else(|| next.name.clone()),
            description.as_deref(),
            role_source_type(body.source_type.as_deref().or(Some(&next.source_type))),
            source_path.as_deref(),
            source_url.as_deref(),
            &markdown_content,
            &system_prompt,
            serde_json::to_string(&body.capabilities.unwrap_or_else(|| next.capabilities.clone()))?,
            listen_mode(body.default_listen_mode.as_deref(), &next.default_listen_mode),
            serde_json::to_string(&body.default_listen_events.unwrap_or_else(|| next.default_listen_events.clone()))?,
            workspace_mode(body.default_workspace_mode.as_deref(), &next.default_workspace_mode),
            default_sandbox_mode.as_deref(),
            default_approval_policy.as_deref(),
            output_contract.as_deref(),
            safety_notes.as_deref(),
            &now,
            id,
        ],
    )?;
    read_role(&connection, id)
}

pub fn delete_role(db: &Db, id: &str) -> anyhow::Result<Result<(), &'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let in_use: i64 = connection
        .query_row(
            "select count(*) from agents where role_id = ?",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    if in_use > 0 {
        return Ok(Err("agent_role_in_use"));
    }
    connection.execute("delete from agent_roles where id = ?", [id])?;
    Ok(Ok(()))
}

// ---------------------------------------------------------------------------
// Agent write routes
// ---------------------------------------------------------------------------

pub fn create_agent(db: &Db, body: CreateAgentRequest) -> anyhow::Result<AgentSummary> {
    let name = body.name.as_deref().map(str::trim).unwrap_or("");
    let role_id = body.role_id.as_deref().unwrap_or("");
    if name.is_empty() || role_id.is_empty() {
        anyhow::bail!("invalid_agent");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(role) = read_role(&connection, role_id)? else {
        anyhow::bail!("invalid_agent");
    };
    let now = crate::api::common::timestamp();
    let id = format!("agent-{}", random_hex(16));
    let access_mode = project_access_mode(body.project_access_mode.as_deref());
    let project_ids = project_ids(&connection);
    let allowed_project_ids =
        normalize_project_ids(body.allowed_project_ids.as_ref(), &project_ids);
    let favorite_project_ids =
        normalize_project_ids(body.favorite_project_ids.as_ref(), &project_ids);
    let default_project_id = body
        .default_project_id
        .as_deref()
        .filter(|value| can_access_project(access_mode, &allowed_project_ids, &project_ids, value))
        .map(str::to_string);
    let permissions = agent_permissions(&serde_json::json!({}), body.permissions.as_ref());
    let max_runs = clamp_concurrent(value_to_i64(body.max_concurrent_runs.as_ref(), 1), 1, 10);
    connection.execute(
        "insert into agents (id, name, role_id, description, extra_prompt, provider_id, model, listen_mode, listen_events, workspace_mode, default_project_id, favorite_project_ids, project_access_mode, allowed_project_ids, permission_profile_id, permissions, max_concurrent_runs, enabled, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &id,
            name,
            role_id,
            trim_or_empty(body.description.as_deref()),
            trim_or_empty(body.extra_prompt.as_deref()),
            body.provider_id.as_deref().filter(|value| !value.is_empty()),
            trim_or_empty(body.model.as_deref()),
            &role.default_listen_mode,
            serde_json::to_string(&role.default_listen_events)?,
            workspace_mode(body.workspace_mode.as_deref(), &role.default_workspace_mode),
            default_project_id.as_deref(),
            serde_json::to_string(&favorite_project_ids)?,
            access_mode,
            serde_json::to_string(&allowed_project_ids)?,
            permission_profile_id(body.permission_profile_id.as_deref()),
            serde_json::to_string(&permissions)?,
            max_runs,
            if body.enabled == Some(false) { 0 } else { 1 },
            &now,
            &now,
        ],
    )?;
    read_agent(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("invalid_agent"))
}

pub fn batch_update_agents(
    db: &Db,
    body: AgentBatchRequest,
) -> anyhow::Result<Result<(Vec<String>, bool), &'static str>> {
    let mut ids = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in body.ids.unwrap_or_default() {
        if seen.insert(id.clone()) {
            ids.push(id);
        }
    }
    let Some(enabled) = body.enabled else {
        return Ok(Err("invalid_agent_batch"));
    };
    if ids.is_empty() {
        return Ok(Err("invalid_agent_batch"));
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = crate::api::common::timestamp();
    for id in &ids {
        connection.execute(
            "update agents set enabled = ?, updated_at = ? where id = ?",
            params![if enabled { 1 } else { 0 }, &now, id],
        )?;
    }
    Ok(Ok((ids, enabled)))
}

pub fn update_agent(
    db: &Db,
    id: &str,
    body: UpdateAgentRequest,
) -> anyhow::Result<Result<Option<AgentSummary>, &'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(next) = read_agent(&connection, id)? else {
        return Ok(Ok(None));
    };
    let role_id = body.role_id.clone().unwrap_or_else(|| next.role_id.clone());
    if read_role(&connection, &role_id)?.is_none() {
        return Ok(Err("agent_role_not_found"));
    }
    // Listen mode/events come from the current row unchanged (mirrors TS).
    let current_listen_mode: String = connection
        .query_row("select listen_mode from agents where id = ?", [id], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()?
        .flatten()
        .map(|value| listen_mode(Some(&value), "passive"))
        .unwrap_or_else(|| "passive".to_string());
    let current_listen_events: Vec<String> = connection
        .query_row(
            "select listen_events from agents where id = ?",
            [id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten()
        .map(|value| serde_json::from_str::<Vec<String>>(&value).unwrap_or_default())
        .unwrap_or_default();
    let access_mode = project_access_mode(
        body.project_access_mode
            .as_deref()
            .or(Some(&next.project_access_mode)),
    );
    let project_ids = project_ids(&connection);
    let allowed_project_ids = normalize_project_ids(
        body.allowed_project_ids
            .as_ref()
            .or(Some(&next.allowed_project_ids)),
        &project_ids,
    );
    let favorite_project_ids = normalize_project_ids(
        body.favorite_project_ids
            .as_ref()
            .or(Some(&next.favorite_project_ids)),
        &project_ids,
    );
    let requested_default = match &body.default_project_id {
        Some(inner) => inner.clone(),
        None => next.default_project_id.clone(),
    };
    let default_project_id = requested_default.filter(|value| {
        access_mode == "all"
            || (access_mode == "selected" && allowed_project_ids.iter().any(|id| id == value))
    });
    let description: Option<String> = match &body.description {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.description.clone(),
    };
    let extra_prompt: Option<String> = match &body.extra_prompt {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.extra_prompt.clone(),
    };
    let provider_id: Option<String> = match &body.provider_id {
        Some(inner) => inner.clone().filter(|value| !value.is_empty()),
        None => next.provider_id.clone(),
    };
    let model: Option<String> = match &body.model {
        Some(inner) => inner
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        None => next.model.clone(),
    };
    let permission_profile: Option<String> = match &body.permission_profile_id {
        Some(inner) => permission_profile_id(inner.as_deref()),
        None => next.permission_profile_id.clone(),
    };
    let permissions = agent_permissions(&next.permissions, body.permissions.as_ref());
    let max_runs = clamp_concurrent(
        value_to_i64(body.max_concurrent_runs.as_ref(), next.max_concurrent_runs),
        1,
        10,
    );
    let enabled = body.enabled.unwrap_or(next.enabled);
    let now = crate::api::common::timestamp();
    connection.execute(
        "update agents set name = ?, role_id = ?, description = ?, extra_prompt = ?, provider_id = ?, model = ?, listen_mode = ?, listen_events = ?, workspace_mode = ?, default_project_id = ?, favorite_project_ids = ?, project_access_mode = ?, allowed_project_ids = ?, permission_profile_id = ?, permissions = ?, max_concurrent_runs = ?, enabled = ?, updated_at = ? where id = ?",
        params![
            trim_or_empty(body.name.as_deref()).unwrap_or_else(|| next.name.clone()),
            &role_id,
            description.as_deref(),
            extra_prompt.as_deref(),
            provider_id.as_deref(),
            model.as_deref(),
            &current_listen_mode,
            serde_json::to_string(&current_listen_events)?,
            workspace_mode(body.workspace_mode.as_deref(), &next.workspace_mode),
            default_project_id.as_deref(),
            serde_json::to_string(&favorite_project_ids)?,
            access_mode,
            serde_json::to_string(&allowed_project_ids)?,
            permission_profile.as_deref(),
            serde_json::to_string(&permissions)?,
            max_runs,
            if enabled { 1 } else { 0 },
            &now,
            id,
        ],
    )?;
    Ok(Ok(read_agent(&connection, id)?))
}

pub fn delete_agent(db: &Db, id: &str) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if table_exists(&connection, "agent_group_members")? {
        let _ = connection.execute("delete from agent_group_members where agent_id = ?", [id]);
    }
    if table_exists(&connection, "room_agent_threads")? {
        let _ = connection.execute("delete from room_agent_threads where agent_id = ?", [id]);
    }
    connection.execute("delete from agents where id = ?", [id])?;
    Ok(())
}

pub fn agent_exists(db: &Db, id: &str) -> anyhow::Result<bool> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(false);
    };
    if !table_exists(&connection, "agents")? {
        return Ok(false);
    }
    Ok(connection
        .query_row("select 1 from agents where id = ?", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

pub fn agent_sessions(
    db: &Db,
    agent_id: &str,
    limit: usize,
    q: Option<&str>,
    status: Option<&str>,
    project_id: Option<&str>,
) -> anyhow::Result<PageResponse<SessionSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "sessions")? || !table_exists(&connection, "agent_sessions")? {
        return Ok(page(Vec::new(), false));
    }
    let mut sql = "select sessions.id, sessions.kind, sessions.conversation_type, sessions.room_id, sessions.title, sessions.project_id, sessions.workspace_path, sessions.provider_id, sessions.model, sessions.codex_session_id, sessions.notifications_enabled, sessions.show_message_usage, sessions.status, sessions.created_at, sessions.updated_at from sessions inner join agent_sessions on agent_sessions.session_id = sessions.id where agent_sessions.agent_id = ?".to_string();
    if status.is_some() {
        sql.push_str(" and sessions.status = ?");
    }
    let project_filter = project_id.map(|value| {
        if value == "scratch" {
            String::new()
        } else {
            value.to_string()
        }
    });
    if project_filter.is_some() {
        sql.push_str(" and coalesce(sessions.project_id, '') = ?");
    }
    sql.push_str(" order by sessions.updated_at desc, sessions.id desc");
    let mut statement = connection.prepare(&sql)?;
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&agent_id];
    if let Some(status) = status.as_ref() {
        params.push(status);
    }
    if let Some(project_filter) = project_filter.as_ref() {
        params.push(project_filter);
    }
    let rows = statement
        .query_map(params.as_slice(), session_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let needle = q
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let mut filtered = rows
        .into_iter()
        .filter(|session| match &needle {
            Some(needle) => {
                session.title.to_lowercase().contains(needle.as_str())
                    || session.id.to_lowercase().contains(needle.as_str())
                    || session
                        .workspace_path
                        .to_lowercase()
                        .contains(needle.as_str())
            }
            None => true,
        })
        .collect::<Vec<_>>();
    let has_more = filtered.len() > limit;
    filtered.truncate(limit);
    Ok(page(filtered, has_more))
}

pub fn agent_stats(db: &Db, agent_id: &str) -> anyhow::Result<AgentStats> {
    let mut total_runs = 0i64;
    let mut running_runs = 0i64;
    let mut successful_runs = 0i64;
    let mut failed_runs = 0i64;
    let mut direct_sessions = 0i64;
    let mut durations: Vec<i64> = Vec::new();
    let mut started_ats: Vec<String> = Vec::new();
    if let Some(connection) = db.open_read_only()? {
        if table_exists(&connection, "agent_runs")? {
            let mut statement = connection.prepare(
                "select status, started_at, finished_at from agent_runs where agent_id = ?",
            )?;
            let rows = statement
                .query_map([agent_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            total_runs = rows.len() as i64;
            for (status, started_at, finished_at) in &rows {
                if status == "running" {
                    running_runs += 1;
                }
                if status == "done" {
                    successful_runs += 1;
                }
                if status == "failed" {
                    failed_runs += 1;
                }
                started_ats.push(started_at.clone());
                if let Some(finished_at) = finished_at {
                    if let (Some(start), Some(end)) =
                        (parse_millis(started_at), parse_millis(finished_at))
                    {
                        let delta = end - start;
                        if delta >= 0 {
                            durations.push(delta);
                        }
                    }
                }
            }
        }
        if table_exists(&connection, "agent_sessions")? {
            direct_sessions = connection
                .query_row(
                    "select count(*) from agent_sessions where agent_id = ?",
                    [agent_id],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(0);
        }
    }
    let average_duration_ms = if durations.is_empty() {
        0
    } else {
        let sum: i64 = durations.iter().sum();
        (sum as f64 / durations.len() as f64).round() as i64
    };
    started_ats.sort();
    let latest_run_at = started_ats.last().cloned();
    Ok(AgentStats {
        agent_id: agent_id.to_string(),
        total_runs,
        running_runs,
        successful_runs,
        failed_runs,
        direct_sessions,
        average_duration_ms,
        latest_run_at,
    })
}

pub fn create_agent_session(
    db: &Db,
    agent_id: &str,
    body: CreateAgentSessionRequest,
) -> anyhow::Result<Result<SessionSummary, &'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(agent) = read_agent(&connection, agent_id)? else {
        return Ok(Err("agent_not_found"));
    };
    if !agent.enabled {
        return Ok(Err("agent_disabled"));
    }
    // Resolve agent project (TS resolveAgentProject): requested or default project id
    let requested = body
        .project_id
        .clone()
        .or_else(|| agent.default_project_id.clone());
    let project_ids = project_ids(&connection);
    let project = match requested.filter(|value| !value.is_empty()) {
        Some(project_id) => {
            if !can_access_project(
                &agent.project_access_mode,
                &agent.allowed_project_ids,
                &project_ids,
                &project_id,
            ) {
                return Ok(Err("agent_project_access_denied"));
            }
            read_project_row(&connection, &project_id)?
        }
        None => None,
    };
    let now = crate::api::common::timestamp();
    let id = format!("task-{}", random_hex(16));
    let kind = if project.is_some() {
        "project"
    } else {
        "scratch"
    };
    let workspace_path = match project.as_ref().and_then(|p| p.workspace_path.clone()) {
        Some(path) => resolve_terminal_cwd(&path),
        None => std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| ".".to_string()),
    };
    let project_db_id = project.as_ref().map(|p| p.id.clone());
    let model = agent.model.clone();
    connection.execute(
        "insert into sessions (id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at) values (?, ?, 'agent', null, ?, ?, ?, ?, ?, null, 1, 0, 'paused', ?, ?)",
        params![
            &id,
            kind,
            &agent.name,
            project_db_id.as_deref(),
            &workspace_path,
            agent.provider_id.as_deref(),
            model.as_deref(),
            &now,
            &now,
        ],
    )?;
    connection.execute(
        "insert into agent_sessions (session_id, agent_id, created_at) values (?, ?, ?)",
        params![&id, agent_id, &now],
    )?;
    let session =
        read_session(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("session_create_failed"))?;
    Ok(Ok(session))
}

// ---------------------------------------------------------------------------
// Agent group write routes
// ---------------------------------------------------------------------------

pub fn create_group(db: &Db, body: CreateAgentGroupRequest) -> anyhow::Result<AgentGroupSummary> {
    let name = body.name.as_deref().map(str::trim).unwrap_or("");
    if name.is_empty() {
        anyhow::bail!("invalid_agent_group");
    }
    let now = crate::api::common::timestamp();
    let id = format!("group-{}", random_hex(16));
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "insert into agent_groups (id, name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &id,
            name,
            trim_or_empty(body.description.as_deref()),
            trim_or_default(body.collaboration_rules.as_deref(), "orchestrator-routed"),
            trim_or_default(body.event_routing_rules.as_deref(), "orchestrator listens to room events and assigns agents explicitly"),
            clamp_concurrent(value_to_i64(body.max_concurrent_agents.as_ref(), 3), 1, 20),
            trim_or_default(body.approval_policy.as_deref(), "approval-required-for-risk"),
            trim_or_default(body.merge_strategy.as_deref(), "isolated-worktree-review-then-approve"),
            &now,
            &now,
        ],
    )?;
    replace_group_members(
        &connection,
        &id,
        body.agent_ids.as_ref(),
        body.member_listen_modes.as_ref(),
    )?;
    group_summary(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("invalid_agent_group"))
}

pub fn update_group(
    db: &Db,
    id: &str,
    body: UpdateAgentGroupRequest,
) -> anyhow::Result<Option<AgentGroupSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(next) = group_summary(&connection, id)? else {
        return Ok(None);
    };
    let now = crate::api::common::timestamp();
    connection.execute(
        "update agent_groups set name = ?, description = ?, collaboration_rules = ?, event_routing_rules = ?, max_concurrent_agents = ?, approval_policy = ?, merge_strategy = ?, updated_at = ? where id = ?",
        params![
            trim_or_empty(body.name.as_deref()).unwrap_or_else(|| next.name.clone()),
            match &body.description {
                Some(inner) => inner.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string),
                None => next.description.clone(),
            }
            .as_deref(),
            trim_or_default(body.collaboration_rules.as_deref(), &next.collaboration_rules),
            trim_or_default(body.event_routing_rules.as_deref(), &next.event_routing_rules),
            clamp_concurrent(value_to_i64(body.max_concurrent_agents.as_ref(), next.max_concurrent_agents), 1, 20),
            trim_or_default(body.approval_policy.as_deref(), &next.approval_policy),
            trim_or_default(body.merge_strategy.as_deref(), &next.merge_strategy),
            &now,
            id,
        ],
    )?;
    if body.agent_ids.is_some() {
        let modes = body
            .member_listen_modes
            .clone()
            .or(Some(next.member_listen_modes.clone()));
        replace_group_members(&connection, id, body.agent_ids.as_ref(), modes.as_ref())?;
    }
    group_summary(&connection, id)
}

pub fn delete_group(db: &Db, id: &str) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute("delete from agent_group_members where group_id = ?", [id])?;
    connection.execute("delete from agent_groups where id = ?", [id])?;
    Ok(())
}

pub fn group_exists(db: &Db, id: &str) -> anyhow::Result<bool> {
    collection_exists(db, "agent_groups", id)
}

pub fn group_rooms(
    db: &Db,
    group_id: &str,
    limit: usize,
    q: Option<&str>,
    status: Option<&str>,
    project_id: Option<&str>,
) -> anyhow::Result<PageResponse<SessionSummary>> {
    collection_rooms(db, "group_id", group_id, limit, q, status, project_id)
}

// ---------------------------------------------------------------------------
// Agent circle write routes
// ---------------------------------------------------------------------------

pub fn create_circle(
    db: &Db,
    body: CreateAgentCircleRequest,
) -> anyhow::Result<AgentCircleSummary> {
    let name = body.name.as_deref().map(str::trim).unwrap_or("");
    if name.is_empty() {
        anyhow::bail!("invalid_agent_circle");
    }
    let now = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let role_ids = dedup_existing_roles(&connection, body.role_ids.as_ref())?;
    let id = unique_id(
        &connection,
        "agent_circles",
        &format!("circle-{}", slugify(name)),
    )?;
    connection.execute(
        "insert into agent_circles (id, name, description, group_template_id, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, builtin, created_at, updated_at) values (?, ?, ?, null, ?, ?, ?, ?, ?, 0, ?, ?)",
        params![
            &id,
            name,
            trim_or_empty(body.description.as_deref()),
            trim_or_default(body.collaboration_rules.as_deref(), ""),
            trim_or_default(body.event_routing_rules.as_deref(), ""),
            clamp_concurrent(value_to_i64(body.max_concurrent_agents.as_ref(), 3), 1, 10),
            trim_or_default(body.approval_policy.as_deref(), "bounded"),
            trim_or_default(body.merge_strategy.as_deref(), "approval-required"),
            &now,
            &now,
        ],
    )?;
    for (index, role_id) in role_ids.iter().enumerate() {
        connection.execute("insert or ignore into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)", params![&id, role_id, index as i64])?;
    }
    circle_summary(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("invalid_agent_circle"))
}

pub fn update_circle(
    db: &Db,
    id: &str,
    body: UpdateAgentCircleRequest,
) -> anyhow::Result<Result<Option<AgentCircleSummary>, &'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(next) = circle_summary(&connection, id)? else {
        return Ok(Ok(None));
    };
    if next.builtin {
        return Ok(Err("builtin_circle_locked"));
    }
    let now = crate::api::common::timestamp();
    connection.execute(
        "update agent_circles set name = ?, description = ?, collaboration_rules = ?, event_routing_rules = ?, max_concurrent_agents = ?, approval_policy = ?, merge_strategy = ?, updated_at = ? where id = ?",
        params![
            trim_or_empty(body.name.as_deref()).unwrap_or_else(|| next.name.clone()),
            match &body.description {
                Some(inner) => inner.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string),
                None => next.description.clone(),
            }
            .as_deref(),
            trim_or_default(body.collaboration_rules.as_deref(), &next.collaboration_rules),
            trim_or_default(body.event_routing_rules.as_deref(), &next.event_routing_rules),
            clamp_concurrent(value_to_i64(body.max_concurrent_agents.as_ref(), next.max_concurrent_agents), 1, 10),
            trim_or_default(body.approval_policy.as_deref(), &next.approval_policy),
            trim_or_default(body.merge_strategy.as_deref(), &next.merge_strategy),
            &now,
            id,
        ],
    )?;
    if body.role_ids.is_some() {
        connection.execute("delete from agent_circle_roles where circle_id = ?", [id])?;
        let role_ids = dedup_existing_roles(&connection, body.role_ids.as_ref())?;
        for (index, role_id) in role_ids.iter().enumerate() {
            connection.execute("insert or ignore into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)", params![id, role_id, index as i64])?;
        }
    }
    Ok(Ok(circle_summary(&connection, id)?))
}

pub fn delete_circle(db: &Db, id: &str) -> anyhow::Result<Result<Option<()>, &'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(circle) = circle_summary(&connection, id)? else {
        return Ok(Ok(None));
    };
    if circle.builtin {
        return Ok(Err("builtin_circle_locked"));
    }
    connection.execute("delete from agent_circle_roles where circle_id = ?", [id])?;
    connection.execute("delete from agent_circles where id = ?", [id])?;
    Ok(Ok(Some(())))
}

pub fn circle_exists(db: &Db, id: &str) -> anyhow::Result<bool> {
    collection_exists(db, "agent_circles", id)
}

pub fn circle_rooms(
    db: &Db,
    circle_id: &str,
    limit: usize,
    q: Option<&str>,
    status: Option<&str>,
    project_id: Option<&str>,
) -> anyhow::Result<PageResponse<SessionSummary>> {
    collection_rooms(db, "circle_id", circle_id, limit, q, status, project_id)
}

pub fn create_group_from_circle(
    db: &Db,
    circle_id: &str,
) -> anyhow::Result<Result<AgentGroupSummary, &'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(circle) = circle_summary(&connection, circle_id)? else {
        return Ok(Err("agent_circle_not_found"));
    };
    if circle.role_ids.is_empty() {
        return Ok(Err("agent_circle_has_no_roles"));
    }
    let mut roles = Vec::new();
    for role_id in &circle.role_ids {
        if let Some(role) = read_role(&connection, role_id)? {
            roles.push(role);
        }
    }
    if roles.is_empty() {
        return Ok(Err("agent_circle_has_no_roles"));
    }
    let now = crate::api::common::timestamp();
    // Ensure an agent per role (reuse the first existing agent by role).
    let mut agents = Vec::new();
    for role in &roles {
        agents.push(ensure_agent_for_role(&connection, role, &now)?);
    }
    let group_id = format!("agent-group-{}", random_hex(16));
    connection.execute(
        "insert into agent_groups (id, name, description, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &group_id,
            &circle.name,
            circle.description.as_deref(),
            &circle.collaboration_rules,
            &circle.event_routing_rules,
            circle.max_concurrent_agents,
            &circle.approval_policy,
            &circle.merge_strategy,
            &now,
            &now,
        ],
    )?;
    for (index, (agent_id, role)) in agents.iter().zip(roles.iter()).enumerate() {
        let mode = if index == 0 {
            "orchestrator".to_string()
        } else {
            listen_mode(Some(&role.default_listen_mode), "passive")
        };
        connection.execute("insert or ignore into agent_group_members (group_id, agent_id, listen_mode) values (?, ?, ?)", params![&group_id, agent_id, &mode])?;
    }
    let summary = group_summary(&connection, &group_id)?
        .ok_or_else(|| anyhow::anyhow!("agent_circle_group_create_failed"))?;
    Ok(Ok(summary))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn collection_exists(db: &Db, table: &str, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let sql = format!("select 1 from {table} where id = ?");
    Ok(connection
        .query_row(&sql, [id], |_| Ok(()))
        .optional()?
        .is_some())
}

fn collection_rooms(
    db: &Db,
    column: &str,
    id: &str,
    limit: usize,
    q: Option<&str>,
    status: Option<&str>,
    project_id: Option<&str>,
) -> anyhow::Result<PageResponse<SessionSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(page(Vec::new(), false));
    };
    if !table_exists(&connection, "rooms")? || !table_exists(&connection, "sessions")? {
        return Ok(page(Vec::new(), false));
    }
    let mut sql = format!(
        "select sessions.id, sessions.kind, sessions.conversation_type, sessions.room_id, sessions.title, sessions.project_id, sessions.workspace_path, sessions.provider_id, sessions.model, sessions.codex_session_id, sessions.notifications_enabled, sessions.show_message_usage, sessions.status, sessions.created_at, sessions.updated_at from rooms inner join sessions on sessions.id = rooms.session_id where rooms.{column} = ?"
    );
    if status.is_some() {
        sql.push_str(" and sessions.status = ?");
    }
    let project_filter = project_id.map(|value| {
        if value == "scratch" {
            String::new()
        } else {
            value.to_string()
        }
    });
    if project_filter.is_some() {
        sql.push_str(" and coalesce(sessions.project_id, '') = ?");
    }
    sql.push_str(" order by sessions.updated_at desc, sessions.id desc");
    let mut statement = connection.prepare(&sql)?;
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&id];
    if let Some(status) = status.as_ref() {
        params.push(status);
    }
    if let Some(project_filter) = project_filter.as_ref() {
        params.push(project_filter);
    }
    let rows = statement
        .query_map(params.as_slice(), session_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let needle = q
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let mut filtered = rows
        .into_iter()
        .filter(|session| match &needle {
            Some(needle) => {
                session.title.to_lowercase().contains(needle.as_str())
                    || session.id.to_lowercase().contains(needle.as_str())
                    || session
                        .workspace_path
                        .to_lowercase()
                        .contains(needle.as_str())
            }
            None => true,
        })
        .collect::<Vec<_>>();
    let has_more = filtered.len() > limit;
    filtered.truncate(limit);
    Ok(page(filtered, has_more))
}

fn ensure_agent_for_role(
    connection: &rusqlite::Connection,
    role: &AgentRoleSummary,
    now: &str,
) -> anyhow::Result<String> {
    if let Some(existing) = connection
        .query_row(
            "select id from agents where role_id = ? order by created_at asc limit 1",
            [&role.id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(existing);
    }
    let agent_id = format!("agent-{}", random_hex(16));
    connection.execute(
        "insert into agents (id, name, role_id, description, extra_prompt, provider_id, model, listen_mode, listen_events, workspace_mode, default_project_id, favorite_project_ids, project_access_mode, allowed_project_ids, permission_profile_id, permissions, max_concurrent_runs, enabled, created_at, updated_at) values (?, ?, ?, ?, null, null, null, ?, ?, ?, null, '[]', 'all', '[]', 'developer', ?, 1, 1, ?, ?)",
        params![
            &agent_id,
            &role.name,
            &role.id,
            role.description_option().as_deref(),
            &role.default_listen_mode,
            serde_json::to_string(&role.default_listen_events)?,
            &role.default_workspace_mode,
            serde_json::to_string(&default_agent_permissions())?,
            now,
            now,
        ],
    )?;
    Ok(agent_id)
}

fn replace_group_members(
    connection: &rusqlite::Connection,
    group_id: &str,
    agent_ids: Option<&Vec<String>>,
    modes: Option<&serde_json::Value>,
) -> anyhow::Result<()> {
    connection.execute(
        "delete from agent_group_members where group_id = ?",
        [group_id],
    )?;
    let Some(agent_ids) = agent_ids else {
        return Ok(());
    };
    let mut seen = std::collections::HashSet::new();
    for agent_id in agent_ids {
        if !seen.insert(agent_id.clone()) {
            continue;
        }
        // Only insert members that reference existing agents.
        if connection
            .query_row("select 1 from agents where id = ?", [agent_id], |_| Ok(()))
            .optional()?
            .is_none()
        {
            continue;
        }
        let mode = modes
            .and_then(|value| value.get(agent_id))
            .and_then(|value| value.as_str())
            .map(|value| listen_mode(Some(value), "passive"))
            .unwrap_or_else(|| "passive".to_string());
        connection.execute("insert or ignore into agent_group_members (group_id, agent_id, listen_mode) values (?, ?, ?)", params![group_id, agent_id, &mode])?;
    }
    Ok(())
}

fn dedup_existing_roles(
    connection: &rusqlite::Connection,
    role_ids: Option<&Vec<String>>,
) -> anyhow::Result<Vec<String>> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let Some(role_ids) = role_ids else {
        return Ok(out);
    };
    for role_id in role_ids {
        if !seen.insert(role_id.clone()) {
            continue;
        }
        if connection
            .query_row("select 1 from agent_roles where id = ?", [role_id], |_| {
                Ok(())
            })
            .optional()?
            .is_some()
        {
            out.push(role_id.clone());
        }
    }
    Ok(out)
}

fn read_role(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<AgentRoleSummary>> {
    Ok(connection
        .query_row(
            "select * from agent_roles where id = ?",
            [id],
            role_from_row,
        )
        .optional()?)
}

fn read_agent(connection: &rusqlite::Connection, id: &str) -> anyhow::Result<Option<AgentSummary>> {
    Ok(connection
        .query_row("select * from agents where id = ?", [id], agent_from_row)
        .optional()?)
}

fn group_summary(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<AgentGroupSummary>> {
    Ok(connection
        .query_row("select * from agent_groups where id = ?", [id], |row| {
            group_from_row(connection, row)
        })
        .optional()?)
}

fn circle_summary(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<AgentCircleSummary>> {
    Ok(connection
        .query_row("select * from agent_circles where id = ?", [id], |row| {
            circle_from_row(connection, row)
        })
        .optional()?)
}

struct ProjectRow {
    id: String,
    workspace_path: Option<String>,
}

fn read_project_row(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> anyhow::Result<Option<ProjectRow>> {
    if !table_exists(connection, "projects")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select id, workspace_path from projects where id = ? limit 1",
            [project_id],
            |row| {
                Ok(ProjectRow {
                    id: row.get(0)?,
                    workspace_path: row.get(1)?,
                })
            },
        )
        .optional()?)
}

fn project_ids(connection: &rusqlite::Connection) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    if table_exists(connection, "projects").unwrap_or(false) {
        if let Ok(mut statement) = connection.prepare("select id from projects") {
            if let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) {
                for row in rows.flatten() {
                    ids.insert(row);
                }
            }
        }
    }
    ids
}

fn read_session(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<SessionSummary>> {
    let mut statement = connection.prepare("select id, kind, conversation_type, room_id, title, project_id, workspace_path, provider_id, model, codex_session_id, notifications_enabled, show_message_usage, status, created_at, updated_at from sessions where id = ?")?;
    let mut session = statement.query_row([id], session_from_row).optional()?;
    if let Some(session) = session.as_mut() {
        session.direct_agent_id = connection
            .query_row(
                "select agent_id from agent_sessions where session_id = ? limit 1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
    }
    Ok(session)
}

fn session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    let conversation_type = match row.get::<_, Option<String>>(2)?.as_deref() {
        Some("agent") => "agent",
        Some("group") => "group",
        Some("room") => "room",
        Some("automation") => "automation",
        _ => "codex",
    }
    .to_string();
    Ok(SessionSummary {
        id: row.get(0)?,
        kind: row.get(1)?,
        conversation_type,
        room_id: row.get(3)?,
        direct_agent_id: None,
        title: row.get(4)?,
        project_id: row.get(5)?,
        workspace_path: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        provider_id: row.get(7)?,
        model: row.get(8)?,
        codex_session_id: row.get(9)?,
        notifications_enabled: row.get::<_, Option<i64>>(10)?.unwrap_or(1) != 0,
        show_message_usage: row.get::<_, Option<i64>>(11)?.unwrap_or(0) != 0,
        status: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        goal: None,
    })
}

fn unique_id(connection: &rusqlite::Connection, table: &str, base: &str) -> anyhow::Result<String> {
    let base = if base.is_empty() {
        "role".to_string()
    } else {
        base.to_string()
    };
    let sql = format!("select 1 from {table} where id = ?");
    let mut id = base.clone();
    let mut suffix = 2;
    while connection
        .query_row(&sql, [&id], |_| Ok(()))
        .optional()?
        .is_some()
    {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }
    Ok(id)
}

fn slugify(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    let mut result = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch);
            prev_dash = false;
        } else if !prev_dash && !result.is_empty() {
            result.push('-');
            prev_dash = true;
        }
    }
    let trimmed = result.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "role".to_string()
    } else {
        trimmed
    }
}

fn trim_or_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn trim_or_default(value: Option<&str>, default: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default.to_string())
}

fn role_source_type(value: Option<&str>) -> String {
    match value {
        Some("file-import") => "file-import",
        Some("builtin-template") => "builtin-template",
        _ => "custom-markdown",
    }
    .to_string()
}

fn project_access_mode(value: Option<&str>) -> &'static str {
    match value {
        Some("none") => "none",
        Some("selected") => "selected",
        _ => "all",
    }
}

fn permission_profile_id(value: Option<&str>) -> Option<String> {
    match value {
        Some(value)
            if matches!(
                value,
                "read-only" | "workspace-write" | "developer" | "maintainer" | "danger-full-access"
            ) =>
        {
            Some(value.to_string())
        }
        _ => None,
    }
}

fn normalize_project_ids(
    ids: Option<&Vec<String>>,
    valid: &std::collections::HashSet<String>,
) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let Some(ids) = ids else {
        return out;
    };
    for id in ids {
        if valid.contains(id) && seen.insert(id.clone()) {
            out.push(id.clone());
        }
    }
    out
}

fn can_access_project(
    access_mode: &str,
    allowed: &[String],
    valid: &std::collections::HashSet<String>,
    project_id: &str,
) -> bool {
    if project_id.is_empty() {
        return true;
    }
    match access_mode {
        "none" => false,
        "all" => valid.contains(project_id),
        _ => allowed.iter().any(|id| id == project_id),
    }
}

fn clamp_concurrent(value: i64, min: i64, max: i64) -> i64 {
    let value = if value == 0 { min } else { value };
    value.clamp(min, max)
}

fn value_to_i64(value: Option<&serde_json::Value>, fallback: i64) -> i64 {
    match value {
        Some(serde_json::Value::Number(num)) => num
            .as_i64()
            .or_else(|| num.as_f64().map(|f| f as i64))
            .unwrap_or(fallback),
        Some(serde_json::Value::String(text)) => text.trim().parse::<i64>().unwrap_or(fallback),
        _ => fallback,
    }
}

fn default_agent_permissions() -> serde_json::Value {
    serde_json::json!({
        "canWriteFiles": true,
        "canRunCommands": true,
        "canUseTerminal": true,
        "canCreatePreview": true,
        "canWriteSharedWorkspace": true,
        "canRequestApproval": true,
        "canTriggerAgents": false,
        "canMergeChanges": false
    })
}

fn agent_permissions(
    stored: &serde_json::Value,
    override_value: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut result = default_agent_permissions();
    let merge = |target: &mut serde_json::Value, source: &serde_json::Value| {
        if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
    };
    // stored may be a string or object
    match stored {
        serde_json::Value::String(text) if !text.trim().is_empty() => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
                merge(&mut result, &parsed);
            }
        }
        serde_json::Value::Object(_) => merge(&mut result, stored),
        _ => {}
    }
    if let Some(override_value) = override_value {
        merge(&mut result, override_value);
    }
    result
}

fn resolve_terminal_cwd(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix("~") {
        if let Ok(home) = std::env::var("HOME") {
            if rest.is_empty() {
                return home;
            }
            let rest = rest.trim_start_matches('/');
            return std::path::Path::new(&home).join(rest).display().to_string();
        }
    }
    let path = std::path::Path::new(trimmed);
    if path.is_absolute() {
        return trimmed.to_string();
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(trimmed).display().to_string())
        .unwrap_or_else(|_| trimmed.to_string())
}

fn parse_millis(value: &str) -> Option<i64> {
    // Minimal RFC3339 parser sufficient for duration math (the `time` crate is
    // built without the `parsing` feature in this crate's Cargo.toml).
    let value = value.trim();
    let bytes = value.as_bytes();
    if value.len() < 19 {
        return None;
    }
    let num = |start: usize, len: usize| -> Option<i64> {
        value.get(start..start + len)?.parse::<i64>().ok()
    };
    if bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || (bytes.get(10) != Some(&b'T') && bytes.get(10) != Some(&b' '))
    {
        return None;
    }
    let year = num(0, 4)?;
    let month = num(5, 2)?;
    let day = num(8, 2)?;
    let hour = num(11, 2)?;
    let minute = num(14, 2)?;
    let second = num(17, 2)?;
    // Optional fractional seconds.
    let mut millis_frac = 0i64;
    let rest = &value[19..];
    let rest = if let Some(stripped) = rest.strip_prefix('.') {
        let digits = stripped
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>();
        if !digits.is_empty() {
            let truncated = &digits[..digits.len().min(3)];
            let padded = format!("{:0<3}", truncated);
            millis_frac = padded.parse::<i64>().unwrap_or(0);
        }
        &stripped[digits.len()..]
    } else {
        rest
    };
    // Timezone offset (Z or +HH:MM / -HH:MM) — convert to UTC.
    let mut offset_minutes = 0i64;
    if let Some(sign_idx) = rest.find(|c| c == '+' || c == '-') {
        let sign = if &rest[sign_idx..sign_idx + 1] == "-" {
            -1
        } else {
            1
        };
        let tz = &rest[sign_idx + 1..];
        let oh = tz
            .get(0..2)
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        let om = tz
            .get(3..5)
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        offset_minutes = sign * (oh * 60 + om);
    }
    let days = days_from_civil(year, month, day);
    let total_seconds = days * 86400 + hour * 3600 + minute * 60 + second - offset_minutes * 60;
    Some(total_seconds * 1000 + millis_frac)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    // Howard Hinnant's days_from_civil algorithm (days since 1970-01-01).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn listen_mode(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some("none") => "none",
        Some("active") => "active",
        Some("orchestrator") => "orchestrator",
        Some("passive") => "passive",
        _ => fallback,
    }
    .to_string()
}

fn workspace_mode(value: Option<&str>, fallback: &str) -> String {
    match value {
        Some("shared-readonly") => "shared-readonly",
        Some("shared-write") => "shared-write",
        Some("merge-workspace") => "merge-workspace",
        Some("isolated-worktree") => "isolated-worktree",
        Some("isolated-worktree-with-shared-room") => "isolated-worktree-with-shared-room",
        _ => fallback,
    }
    .to_string()
}

// ---------------------------------------------------------------------------
// Built-in multi-agent defaults (port of agents/defaults.ts seedMultiAgentDefaults)
// ---------------------------------------------------------------------------

/// Seed built-in agent circles and their roles from the role-template directory.
/// Idempotent: re-runnable on every startup (upserts circles/roles, prunes stale builtins).
pub fn seed_multi_agent_defaults(db: &Db) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = crate::api::common::timestamp();
    let template_dir = super::role_templates::role_template_dir(&db.data_dir);

    let story_rules = [
        "This circle turns a user's short idea, prompt, or story seed into a complete movie production package.",
        "The current system does not export a final video file by default, but the room must still design the full movie package: story, screenplay, scene list, shot list, storyboard images, character visuals, voiceover, dialogue, music, sound effects, editing plan, image prompts, video prompts, and an HTML preview page.",
        "The Film Producer is the orchestrator. It owns the canonical version, assigns work, prevents conflicting rewrites, and merges final deliverables.",
        "The Screenwriter develops the story, characters, structure, scenes, dialogue, and voiceover.",
        "The Storyboard Director converts scenes into shots and storyboard panels.",
        "The Visual Development Director and Character Concept Artist define a stable visual language and consistent character appearances before storyboard generation.",
        "The Storyboard Image Prompt Engineer creates reusable prompts for character concept images and storyboard panels, preserving character identity and style.",
        "The Voice Music Sound Director designs narration, performance notes, music direction, ambient sound, and sound effects.",
        "The Editing Director plans pacing, shot duration, transitions, and trailer structure.",
        "The Production Quality Reviewer checks continuity, missing deliverables, prompt consistency, and audio/editing alignment.",
        "Default files should be organized under a movie package folder with numbered Markdown documents, a storyboard image folder, and index.html.",
    ].join("\n");
    let dev_rules = [
        "This circle turns product ideas, bug reports, refactor requests, and technical goals into working software changes.",
        "The Software Architect is the orchestrator. It clarifies scope, chooses the implementation strategy, splits work, protects boundaries, and owns the final integration plan.",
        "The Product Manager sharpens requirements, success criteria, user impact, edge cases, and release scope before implementation expands.",
        "The Frontend Developer owns UI, client state, accessibility, responsive behavior, and frontend performance.",
        "The Backend Architect owns APIs, services, data flow, persistence boundaries, and server-side reliability.",
        "The Database Optimizer owns schema design, migrations, indexing, query performance, and data integrity.",
        "The DevOps Automator owns local/dev/prod scripts, CI, deployment, environment variables, runtime checks, and preview commands.",
        "The API Tester owns endpoint validation, contract tests, integration coverage, and regression evidence.",
        "The Code Reviewer checks correctness, maintainability, regressions, and missing tests before handoff.",
        "The Security Engineer checks auth, permissions, secrets, injection risks, unsafe file access, and deployment-sensitive behavior.",
        "The Technical Writer updates developer-facing docs, runbooks, API notes, and migration notes when behavior changes.",
        "Default handoff should include changed files, verification commands, risks, and next actions. Prefer focused implementation over speculative rewrites.",
    ].join("\n");

    struct Circle {
        id: &'static str,
        name: &'static str,
        description: &'static str,
        collaboration_rules: String,
        event_routing_rules: &'static str,
    }
    let circles = vec![
        Circle {
            id: "circle-story-to-movie-studio",
            name: "故事到电影工作室",
            description: "把一句话或故事设定扩展为完整电影制作包，包括剧本、分镜、角色形象、故事板图片、配音、配乐、音效、剪辑方案和预览页面。",
            collaboration_rules: story_rules,
            event_routing_rules: "User ideas should first route to the Film Producer. Story, screenplay, and dialogue route to the Screenwriter. Shot planning routes to the Storyboard Director. Character and visual consistency route to the Visual Development Director and Character Concept Artist. Image/storyboard prompts route to the Storyboard Image Prompt Engineer. Voice, music, and sound route to the Voice Music Sound Director. Pacing and assembly route to the Editing Director. Final checks route to the Production Quality Reviewer.",
        },
        Circle {
            id: "circle-software-development-studio",
            name: "软件开发工作室",
            description: "面向前后端、API、数据库、测试、部署、安全和文档的通用程序开发协作圈子。",
            collaboration_rules: dev_rules,
            event_routing_rules: "New work should first route to the Software Architect. Ambiguous product scope routes to the Product Manager. UI and interaction work routes to the Frontend Developer. API, service, and persistence work routes to the Backend Architect and Database Optimizer. Build, deployment, preview, and environment work routes to the DevOps Automator. Endpoint validation routes to the API Tester. Final correctness and maintainability review routes to the Code Reviewer. Auth, permission, secret, and unsafe filesystem/network concerns route to the Security Engineer. Documentation or handoff gaps route to the Technical Writer.",
        },
    ];

    // Prune stale builtin circles not in the seeded set.
    let seeded_ids: Vec<&str> = circles.iter().map(|c| c.id).collect();
    let placeholders = seeded_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let params: Vec<&dyn rusqlite::ToSql> = seeded_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();
    connection.execute(
        &format!("delete from agent_circle_roles where circle_id in (select id from agent_circles where builtin = 1 and id not in ({placeholders}))"),
        params.as_slice(),
    )?;
    connection.execute(
        &format!("delete from agent_circles where builtin = 1 and id not in ({placeholders})"),
        params.as_slice(),
    )?;
    // Reset circle-role mappings for the seeded circles (rebuilt below).
    connection.execute(
        &format!("delete from agent_circle_roles where circle_id in ({placeholders})"),
        params.as_slice(),
    )?;

    for circle in &circles {
        connection.execute(
            "insert into agent_circles (id, name, description, group_template_id, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, builtin, created_at, updated_at)
             values (?, ?, ?, null, ?, ?, 4, 'bounded', 'approval-required', 1, ?, ?)
             on conflict(id) do update set
               name = excluded.name,
               description = excluded.description,
               collaboration_rules = excluded.collaboration_rules,
               event_routing_rules = excluded.event_routing_rules,
               max_concurrent_agents = excluded.max_concurrent_agents,
               approval_policy = excluded.approval_policy,
               merge_strategy = excluded.merge_strategy,
               builtin = 1,
               updated_at = excluded.updated_at",
            rusqlite::params![circle.id, circle.name, circle.description, circle.collaboration_rules, circle.event_routing_rules, now, now],
        )?;
    }

    let story_roles: Vec<(&str, &str, &str)> = vec![
        (
            "role-story-to-movie-film-producer",
            "story-to-movie/film-producer.md",
            "orchestrator",
        ),
        (
            "role-story-to-movie-screenwriter",
            "story-to-movie/screenwriter.md",
            "active",
        ),
        (
            "role-story-to-movie-storyboard-director",
            "story-to-movie/storyboard-director.md",
            "passive",
        ),
        (
            "role-story-to-movie-visual-development-director",
            "story-to-movie/visual-development-director.md",
            "passive",
        ),
        (
            "role-story-to-movie-character-concept-artist",
            "story-to-movie/character-concept-artist.md",
            "passive",
        ),
        (
            "role-story-to-movie-image-prompt-engineer",
            "story-to-movie/storyboard-image-prompt-engineer.md",
            "passive",
        ),
        (
            "role-story-to-movie-voice-music-sound-director",
            "story-to-movie/voice-music-sound-director.md",
            "passive",
        ),
        (
            "role-story-to-movie-editing-director",
            "story-to-movie/editing-director.md",
            "passive",
        ),
        (
            "role-story-to-movie-production-quality-reviewer",
            "story-to-movie/production-quality-reviewer.md",
            "passive",
        ),
    ];
    let dev_roles: Vec<(&str, &str, &str)> = vec![
        (
            "role-dev-software-architect",
            "agency-agents/engineering/engineering-software-architect.md",
            "orchestrator",
        ),
        (
            "role-dev-product-manager",
            "agency-agents/product/product-manager.md",
            "active",
        ),
        (
            "role-dev-frontend-developer",
            "agency-agents/engineering/engineering-frontend-developer.md",
            "active",
        ),
        (
            "role-dev-backend-architect",
            "agency-agents/engineering/engineering-backend-architect.md",
            "active",
        ),
        (
            "role-dev-database-optimizer",
            "agency-agents/engineering/engineering-database-optimizer.md",
            "passive",
        ),
        (
            "role-dev-devops-automator",
            "agency-agents/engineering/engineering-devops-automator.md",
            "passive",
        ),
        (
            "role-dev-api-tester",
            "agency-agents/testing/testing-api-tester.md",
            "passive",
        ),
        (
            "role-dev-code-reviewer",
            "agency-agents/engineering/engineering-code-reviewer.md",
            "passive",
        ),
        (
            "role-dev-security-engineer",
            "agency-agents/engineering/engineering-security-engineer.md",
            "passive",
        ),
        (
            "role-dev-technical-writer",
            "agency-agents/engineering/engineering-technical-writer.md",
            "passive",
        ),
    ];

    let story_output = "Return Markdown artifacts suitable for a complete movie production package. When creating files, keep them under the related session or project workspace.";
    let story_safety = "Do not claim that a final video file was generated unless an actual video generation tool is available and used. Avoid copyrighted song requirements; describe musical qualities instead.";
    let dev_output = "Return focused implementation plans, code changes, tests, review notes, and documentation updates suitable for software delivery. When creating files, keep them under the related project or session workspace.";
    let dev_safety = "Respect project boundaries, secrets, permissions, and approval settings. Do not run destructive commands or expose credentials. Prefer small verified changes with clear rollback notes.";

    seed_circle_roles(
        &connection,
        &template_dir,
        "circle-story-to-movie-studio",
        &story_roles,
        story_output,
        story_safety,
        &now,
    )?;
    seed_circle_roles(
        &connection,
        &template_dir,
        "circle-software-development-studio",
        &dev_roles,
        dev_output,
        dev_safety,
        &now,
    )?;
    Ok(())
}

fn seed_circle_roles(
    connection: &rusqlite::Connection,
    template_dir: &std::path::Path,
    circle_id: &str,
    roles: &[(&str, &str, &str)],
    output_contract: &str,
    safety_notes: &str,
    now: &str,
) -> anyhow::Result<()> {
    for (position, (role_id, rel_path, listen_mode)) in roles.iter().enumerate() {
        let template_path = template_dir.join(rel_path);
        let Ok(markdown_content) = std::fs::read_to_string(&template_path) else {
            continue;
        };
        let metadata = super::role_templates::parse_markdown_frontmatter(&markdown_content);
        let name = metadata
            .get("name")
            .cloned()
            .filter(|value| !value.is_empty())
            .or_else(|| {
                let title = super::role_templates::markdown_title(&markdown_content);
                if title.is_empty() {
                    None
                } else {
                    Some(title)
                }
            })
            .unwrap_or_else(|| role_id.to_string());
        let description = metadata
            .get("description")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| super::role_templates::markdown_description(&markdown_content));
        connection.execute(
            "insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
             values (?, ?, ?, 'builtin-template', ?, null, ?, ?, '[]', ?, '[]', 'isolated-worktree-with-shared-room', null, null, ?, ?, ?, ?)
             on conflict(id) do update set
               name = excluded.name,
               description = excluded.description,
               source_type = excluded.source_type,
               source_path = excluded.source_path,
               markdown_content = excluded.markdown_content,
               system_prompt = excluded.system_prompt,
               default_listen_mode = excluded.default_listen_mode,
               default_workspace_mode = excluded.default_workspace_mode,
               output_contract = excluded.output_contract,
               safety_notes = excluded.safety_notes,
               updated_at = excluded.updated_at",
            rusqlite::params![role_id, name, description, rel_path, markdown_content, markdown_content, listen_mode, output_contract, safety_notes, now, now],
        )?;
        connection.execute(
            "insert or replace into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)",
            rusqlite::params![circle_id, role_id, position as i64],
        )?;
    }
    Ok(())
}
