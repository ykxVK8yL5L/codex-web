use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{CreateProjectRequest, ProjectSummary, UpdateProjectRequest};

pub fn list_projects(db: &Db) -> anyhow::Result<Vec<ProjectSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "projects")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, name, workspace_path, runner, changed_files, check_command from projects order by name asc")?;
    let projects = statement
        .query_map([], |row| {
            let changed_files = row.get::<_, Option<i64>>(4)?.unwrap_or(0);
            let check_command = row.get::<_, Option<String>>(5)?;
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                workspace_path: row.get(2)?,
                runner: row.get(3)?,
                changed_files,
                staged_files: 0,
                modified_files: changed_files,
                untracked_files: 0,
                git_status: if changed_files > 0 { "dirty" } else { "clean" }.to_string(),
                check_commands: split_check_commands(check_command.as_deref()),
                check_command,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(projects)
}

pub fn get_project(db: &Db, id: &str) -> anyhow::Result<Option<ProjectSummary>> {
    Ok(list_projects(db)?
        .into_iter()
        .find(|project| project.id == id))
}

pub fn create_project(db: &Db, input: CreateProjectRequest) -> anyhow::Result<ProjectSummary> {
    let name = input.name.trim();
    if name.is_empty() {
        anyhow::bail!("invalid_project_name");
    }
    let id = unique_project_id(db, &slugify(name))?;
    let workspace_path = match input
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => normalize_workspace_path(path)?,
        None => std::env::current_dir()?
            .join("projects")
            .join(&id)
            .display()
            .to_string(),
    };
    std::fs::create_dir_all(&workspace_path)?;
    let project = ProjectSummary {
        id,
        name: name.to_string(),
        workspace_path,
        runner: "docker".to_string(),
        changed_files: 0,
        staged_files: 0,
        modified_files: 0,
        untracked_files: 0,
        git_status: "clean".to_string(),
        check_command: input.check_command.and_then(clean_optional),
        check_commands: Vec::new(),
    };
    upsert_project(db, &project)?;
    get_project(db, &project.id)?.ok_or_else(|| anyhow::anyhow!("project_create_failed"))
}

pub fn update_project(
    db: &Db,
    id: &str,
    input: UpdateProjectRequest,
) -> anyhow::Result<Option<ProjectSummary>> {
    let Some(mut project) = get_project(db, id)? else {
        return Ok(None);
    };
    if let Some(name) = input.name {
        let name = name.trim();
        if !name.is_empty() {
            project.name = name.to_string();
        }
    }
    if let Some(workspace_path) = input.workspace_path {
        let workspace_path = workspace_path.trim();
        if !workspace_path.is_empty() {
            project.workspace_path = normalize_workspace_path(workspace_path)?;
        }
    }
    if input.check_command.is_some() {
        project.check_command = input.check_command.and_then(clean_optional);
        project.check_commands = split_check_commands(project.check_command.as_deref());
    }
    upsert_project(db, &project)?;
    get_project(db, id)
}

pub fn delete_project(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_project_schema(&connection)?;
    let deleted = connection.execute("delete from projects where id = ?", [id])?;
    if deleted == 0 {
        return Ok(false);
    }
    if table_exists(&connection, "project_check_runs")? {
        let _ = connection.execute("delete from project_check_runs where project_id = ?", [id]);
    }
    if table_exists(&connection, "project_git_operations")? {
        let _ = connection.execute(
            "delete from project_git_operations where project_id = ?",
            [id],
        );
    }
    Ok(true)
}

fn upsert_project(db: &Db, project: &ProjectSummary) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_project_schema(&connection)?;
    connection.execute(
        "
        insert into projects (id, name, workspace_path, runner, check_command, changed_files)
        values (?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          workspace_path = excluded.workspace_path,
          runner = excluded.runner,
          check_command = excluded.check_command,
          changed_files = excluded.changed_files
        ",
        (
            &project.id,
            &project.name,
            &project.workspace_path,
            &project.runner,
            project.check_command.as_deref(),
            project.changed_files,
        ),
    )?;
    Ok(())
}

fn ensure_project_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists projects (
          id text primary key,
          name text not null,
          workspace_path text not null,
          runner text not null,
          check_command text,
          changed_files integer not null default 0
        );
        ",
    )?;
    Ok(())
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

fn split_check_commands(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or("")
        .lines()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn unique_project_id(db: &Db, base: &str) -> anyhow::Result<String> {
    let existing = list_projects(db)?
        .into_iter()
        .map(|project| project.id)
        .collect::<std::collections::HashSet<_>>();
    let base = if base.is_empty() { "project" } else { base };
    let mut id = base.to_string();
    let mut suffix = 2;
    while existing.contains(&id) {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }
    Ok(id)
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').to_string()
}

fn normalize_workspace_path(value: &str) -> anyhow::Result<String> {
    let path = std::path::PathBuf::from(value);
    if path.exists() {
        Ok(path.canonicalize()?.display().to_string())
    } else {
        Ok(path.display().to_string())
    }
}

fn clean_optional(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
