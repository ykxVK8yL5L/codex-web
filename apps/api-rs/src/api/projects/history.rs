use std::time::Instant;

use anyhow::Context;
use rand::RngCore;
use rusqlite::params;
use tokio::process::Command;

use crate::api::common::{timestamp, PageResponse};
use crate::db::Db;

use super::models::{
    ProjectCheckRunSummary, ProjectGitOperationRequest, ProjectGitOperationSummary, ProjectSummary,
};

const MAX_STDOUT: usize = 120 * 1024;
const MAX_STDERR: usize = 32 * 1024;

pub async fn run_check(
    db: &Db,
    project: &ProjectSummary,
    command: String,
) -> anyhow::Result<ProjectCheckRunSummary> {
    let started_at = timestamp();
    let started = Instant::now();
    let result = run_shell(&command, &project.workspace_path).await?;
    let finished_at = timestamp();
    let run = ProjectCheckRunSummary {
        id: format!("project-check-{}", random_hex(16)),
        project_id: project.id.clone(),
        command,
        cwd: project.workspace_path.clone(),
        status: status_from_exit(result.exit_code),
        exit_code: result.exit_code,
        duration_ms: started.elapsed().as_millis().try_into().unwrap_or(i64::MAX),
        stdout: trim_output(result.stdout, MAX_STDOUT),
        stderr: trim_output(result.stderr, MAX_STDERR),
        started_at,
        finished_at: Some(finished_at),
    };
    save_check_run(db, &run)?;
    Ok(run)
}

pub async fn run_git(
    db: &Db,
    project: &ProjectSummary,
    input: ProjectGitOperationRequest,
) -> anyhow::Result<ProjectGitOperationSummary> {
    let args = git_args(&input)?;
    let result = run_process("git", &args, &project.workspace_path).await?;
    let record = ProjectGitOperationSummary {
        id: format!("project-git-{}", random_hex(16)),
        project_id: project.id.clone(),
        operation: input.operation,
        args,
        status: status_from_exit(result.exit_code),
        exit_code: result.exit_code,
        stdout: trim_output(result.stdout, MAX_STDOUT),
        stderr: trim_output(result.stderr, MAX_STDERR),
        created_at: timestamp(),
    };
    save_git_operation(db, &record)?;
    Ok(record)
}

pub fn list_check_runs(
    db: &Db,
    project_id: &str,
    limit: usize,
) -> anyhow::Result<PageResponse<ProjectCheckRunSummary>> {
    let connection = db.open_read_write()?;
    ensure_history_schema(&connection)?;
    let mut statement = connection.prepare(
        "select id, project_id, command, cwd, status, exit_code, duration_ms, stdout, stderr, started_at, finished_at from project_check_runs where project_id = ? order by started_at desc, id desc limit ?",
    )?;
    let mut items = statement
        .query_map(params![project_id, (limit + 1) as i64], check_run_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    Ok(PageResponse {
        items,
        next_cursor: None,
        has_more,
    })
}

pub fn list_git_operations(
    db: &Db,
    project_id: &str,
    limit: usize,
) -> anyhow::Result<PageResponse<ProjectGitOperationSummary>> {
    let connection = db.open_read_write()?;
    ensure_history_schema(&connection)?;
    let mut statement = connection.prepare(
        "select id, project_id, operation, args, status, exit_code, stdout, stderr, created_at from project_git_operations where project_id = ? order by created_at desc, id desc limit ?",
    )?;
    let mut items = statement
        .query_map(
            params![project_id, (limit + 1) as i64],
            git_operation_from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    Ok(PageResponse {
        items,
        next_cursor: None,
        has_more,
    })
}

fn save_check_run(db: &Db, run: &ProjectCheckRunSummary) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_history_schema(&connection)?;
    connection.execute(
        "insert into project_check_runs (id, project_id, command, cwd, status, exit_code, duration_ms, stdout, stderr, started_at, finished_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            run.id,
            run.project_id,
            run.command,
            run.cwd,
            run.status,
            run.exit_code,
            run.duration_ms,
            run.stdout,
            run.stderr,
            run.started_at,
            run.finished_at,
        ],
    )?;
    Ok(())
}

fn save_git_operation(db: &Db, record: &ProjectGitOperationSummary) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_history_schema(&connection)?;
    connection.execute(
        "insert into project_git_operations (id, project_id, operation, args, status, exit_code, stdout, stderr, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            record.id,
            record.project_id,
            record.operation,
            serde_json::to_string(&record.args)?,
            record.status,
            record.exit_code,
            record.stdout,
            record.stderr,
            record.created_at,
        ],
    )?;
    Ok(())
}

pub fn ensure_history_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists project_check_runs (
          id text primary key,
          project_id text not null,
          command text not null,
          cwd text not null,
          status text not null,
          exit_code integer,
          duration_ms integer not null,
          stdout text not null,
          stderr text not null,
          started_at text not null,
          finished_at text
        );
        create index if not exists project_check_runs_project_started_idx on project_check_runs(project_id, started_at desc, id desc);
        create table if not exists project_git_operations (
          id text primary key,
          project_id text not null,
          operation text not null,
          args text not null,
          status text not null,
          exit_code integer,
          stdout text not null,
          stderr text not null,
          created_at text not null
        );
        create index if not exists project_git_operations_project_created_idx on project_git_operations(project_id, created_at desc, id desc);
        ",
    )?;
    Ok(())
}

async fn run_shell(command: &str, cwd: &str) -> anyhow::Result<CommandOutput> {
    #[cfg(target_os = "windows")]
    let mut command_process = {
        let mut item = Command::new("cmd");
        item.arg("/C").arg(command);
        item
    };
    #[cfg(not(target_os = "windows"))]
    let mut command_process = {
        let mut item = Command::new("sh");
        item.arg("-lc").arg(command);
        item
    };
    run_configured_process(&mut command_process, cwd).await
}

async fn run_process(program: &str, args: &[String], cwd: &str) -> anyhow::Result<CommandOutput> {
    let mut command = Command::new(program);
    command.args(args);
    run_configured_process(&mut command, cwd).await
}

async fn run_configured_process(command: &mut Command, cwd: &str) -> anyhow::Result<CommandOutput> {
    let output = command
        .current_dir(cwd)
        .output()
        .await
        .with_context(|| format!("failed to run command in {cwd}"))?;
    Ok(CommandOutput {
        exit_code: output.status.code().map(i64::from),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn git_args(input: &ProjectGitOperationRequest) -> anyhow::Result<Vec<String>> {
    let branch = input
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let message = input
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match input.operation.as_str() {
        "status" => Ok(vec!["status".to_string(), "--short".to_string()]),
        "fetch" => Ok(vec!["fetch".to_string()]),
        "pull" => Ok(vec!["pull".to_string(), "--ff-only".to_string()]),
        "push" => Ok(vec!["push".to_string()]),
        "commit" => Ok(vec![
            "commit".to_string(),
            "-m".to_string(),
            message
                .ok_or_else(|| anyhow::anyhow!("commit_message_required"))?
                .to_string(),
        ]),
        "branch-create" => Ok(vec![
            "checkout".to_string(),
            "-b".to_string(),
            branch
                .ok_or_else(|| anyhow::anyhow!("branch_required"))?
                .to_string(),
        ]),
        "branch-checkout" => Ok(vec![
            "checkout".to_string(),
            branch
                .ok_or_else(|| anyhow::anyhow!("branch_required"))?
                .to_string(),
        ]),
        _ => anyhow::bail!("unsupported_git_operation"),
    }
}

struct CommandOutput {
    exit_code: Option<i64>,
    stdout: String,
    stderr: String,
}

fn check_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectCheckRunSummary> {
    Ok(ProjectCheckRunSummary {
        id: row.get(0)?,
        project_id: row.get(1)?,
        command: row.get(2)?,
        cwd: row.get(3)?,
        status: row.get(4)?,
        exit_code: row.get(5)?,
        duration_ms: row.get(6)?,
        stdout: row.get(7)?,
        stderr: row.get(8)?,
        started_at: row.get(9)?,
        finished_at: row.get(10)?,
    })
}

fn git_operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectGitOperationSummary> {
    let args_json: String = row.get(3)?;
    Ok(ProjectGitOperationSummary {
        id: row.get(0)?,
        project_id: row.get(1)?,
        operation: row.get(2)?,
        args: serde_json::from_str(&args_json).unwrap_or_default(),
        status: row.get(4)?,
        exit_code: row.get(5)?,
        stdout: row.get(6)?,
        stderr: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn status_from_exit(exit_code: Option<i64>) -> String {
    match exit_code {
        Some(0) => "done".to_string(),
        _ => "failed".to_string(),
    }
}

fn trim_output(value: String, max: usize) -> String {
    if value.len() <= max {
        value
    } else {
        value[value.len() - max..].to_string()
    }
}

fn random_hex(size: usize) -> String {
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
