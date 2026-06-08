use std::path::PathBuf;

use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTaskDiff {
    pub ok: bool,
    pub cwd: String,
    pub status: String,
    pub stat: String,
    pub diff: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Mirror of `GET /api/codex/tasks/:id/diff` in `apps/api/src/tasks/routes.ts`.
pub async fn diff(cwd: &str) -> CodexTaskDiff {
    let status = run_git(cwd, &["status", "--short", "--", "."]).await;
    if status.exit_code != Some(0) {
        return CodexTaskDiff {
            ok: false,
            cwd: cwd.to_string(),
            status: String::new(),
            stat: String::new(),
            diff: String::new(),
            error: Some(if status.stderr.trim().is_empty() {
                "git_status_failed".to_string()
            } else {
                status.stderr
            }),
        };
    }
    let stat = run_git(cwd, &["diff", "--relative", "--stat", "--", "."]).await;
    let diff = run_git(cwd, &["diff", "--", "."]).await;
    let error = if stat.exit_code == Some(0) && diff.exit_code == Some(0) {
        None
    } else {
        let candidate = if stat.stderr.trim().is_empty() {
            diff.stderr.clone()
        } else {
            stat.stderr.clone()
        };
        Some(if candidate.trim().is_empty() {
            "git_diff_failed".to_string()
        } else {
            candidate
        })
    };
    CodexTaskDiff {
        ok: true,
        cwd: cwd.to_string(),
        status: status.stdout,
        stat: stat.stdout,
        diff: diff.stdout,
        error,
    }
}

struct CommandOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

async fn run_git(cwd: &str, args: &[&str]) -> CommandOutput {
    let path = PathBuf::from(cwd);
    match Command::new("git")
        .args(args)
        .current_dir(&path)
        .output()
        .await
    {
        Ok(output) => CommandOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
        },
        Err(error) => CommandOutput {
            stdout: String::new(),
            stderr: error.to_string(),
            exit_code: None,
        },
    }
}
