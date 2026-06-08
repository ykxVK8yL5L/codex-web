use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use tokio::process::Command;

use super::models::{
    WorkspaceChangeFile, WorkspaceChangeRaw, WorkspaceChangeSummary, WorkspaceChanges,
};

pub async fn collect(cwd: &str) -> anyhow::Result<WorkspaceChanges> {
    let cwd = normalize_cwd(cwd)?;
    let repo = run_git(&cwd, &["rev-parse", "--show-toplevel"]).await?;
    if repo.exit_code != Some(0) {
        return Ok(WorkspaceChanges {
            ok: false,
            cwd: cwd.display().to_string(),
            is_git_repo: false,
            summary: WorkspaceChangeSummary::default(),
            files: Vec::new(),
            raw: WorkspaceChangeRaw {
                status: String::new(),
                stat: String::new(),
                diff: String::new(),
            },
            error: Some(if repo.stderr.trim().is_empty() {
                "not_a_git_repository".to_string()
            } else {
                repo.stderr
            }),
        });
    }

    let status = run_git(&cwd, &["status", "--short", "--", "."]).await?;
    let numstat = run_git(&cwd, &["diff", "--relative", "--numstat", "--", "."]).await?;
    let cached_numstat = run_git(
        &cwd,
        &["diff", "--relative", "--cached", "--numstat", "--", "."],
    )
    .await?;
    let diff = run_git(&cwd, &["diff", "--", "."]).await?;
    let cached_diff = run_git(&cwd, &["diff", "--cached", "--", "."]).await?;
    let untracked = run_git(
        &cwd,
        &["ls-files", "--others", "--exclude-standard", "--", "."],
    )
    .await?;
    let stats = parse_numstat(&format!("{}\n{}", numstat.stdout, cached_numstat.stdout));
    let mut status_items = status
        .stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_short_status_line)
        .collect::<Vec<_>>();
    for path in untracked
        .stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
    {
        if !status_items.iter().any(|item| item.path == path) {
            status_items.push(StatusItem {
                status: "??".to_string(),
                path: path.to_string(),
            });
        }
    }

    let mut files = Vec::new();
    for item in status_items {
        let mut stat = stats.get(&item.path).cloned().unwrap_or_default();
        let mut patch = String::new();
        let mut new_content = None;
        let mut binary = stat.binary;
        if item.status == "??" {
            let file = read_text_file_if_small(&cwd, &item.path)?;
            binary = file.binary;
            if !file.content.is_empty() {
                let lines = file.content.lines().collect::<Vec<_>>();
                stat.additions = lines.len() as i64;
                stat.deletions = 0;
                patch = std::iter::once("--- /dev/null".to_string())
                    .chain(std::iter::once(format!("+++ b/{}", item.path)))
                    .chain(std::iter::once(format!("@@ -0,0 +1,{} @@", lines.len())))
                    .chain(lines.iter().map(|line| format!("+{line}")))
                    .collect::<Vec<_>>()
                    .join("\n");
                new_content = Some(file.content);
            }
        } else {
            let file_diff = run_git(&cwd, &["diff", "--", &item.path]).await?;
            let cached_file_diff = run_git(&cwd, &["diff", "--cached", "--", &item.path]).await?;
            patch = [cached_file_diff.stdout, file_diff.stdout]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
        }
        files.push(WorkspaceChangeFile {
            path: item.path,
            status: item.status,
            additions: stat.additions,
            deletions: stat.deletions,
            patch,
            new_content,
            binary: Some(binary),
        });
    }

    let summary = files
        .iter()
        .fold(WorkspaceChangeSummary::default(), |mut total, file| {
            total.files_changed += 1;
            total.additions += file.additions;
            total.deletions += file.deletions;
            total
        });
    Ok(WorkspaceChanges {
        ok: status.exit_code == Some(0),
        cwd: cwd.display().to_string(),
        is_git_repo: true,
        summary,
        files,
        raw: WorkspaceChangeRaw {
            status: status.stdout,
            stat: format!("{}\n{}", numstat.stdout, cached_numstat.stdout)
                .trim()
                .to_string(),
            diff: [cached_diff.stdout, diff.stdout]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
        },
        error: if status.exit_code == Some(0) {
            None
        } else {
            Some(if status.stderr.trim().is_empty() {
                "git_status_failed".to_string()
            } else {
                status.stderr
            })
        },
    })
}

pub async fn stage_file(cwd: &str, path: &str) -> anyhow::Result<WorkspaceChanges> {
    apply_git_file_action(cwd, path, "stage").await
}

pub async fn unstage_file(cwd: &str, path: &str) -> anyhow::Result<WorkspaceChanges> {
    apply_git_file_action(cwd, path, "unstage").await
}

pub async fn revert_file(cwd: &str, path: &str) -> anyhow::Result<WorkspaceChanges> {
    let cwd = normalize_cwd(cwd)?;
    let changes = collect(cwd.to_string_lossy().as_ref()).await?;
    let change = assert_change_path(&cwd, &changes, path)?;
    if change.status == "??" {
        let absolute = cwd.join(path);
        let metadata = fs::metadata(&absolute)?;
        if !metadata.is_file() {
            anyhow::bail!("untracked_directories_not_supported");
        }
        fs::remove_file(absolute)?;
    } else {
        let result = run_git(&cwd, &["checkout", "--", path]).await?;
        if result.exit_code != Some(0) {
            anyhow::bail!(if result.stderr.trim().is_empty() {
                "git_checkout_failed".to_string()
            } else {
                result.stderr
            });
        }
    }
    collect(cwd.to_string_lossy().as_ref()).await
}

async fn apply_git_file_action(
    cwd: &str,
    path: &str,
    action: &str,
) -> anyhow::Result<WorkspaceChanges> {
    let cwd = normalize_cwd(cwd)?;
    let changes = collect(cwd.to_string_lossy().as_ref()).await?;
    assert_change_path(&cwd, &changes, path)?;
    let args = if action == "stage" {
        vec!["add", "--", path]
    } else {
        vec!["restore", "--staged", "--", path]
    };
    let result = run_git(&cwd, &args).await?;
    if result.exit_code != Some(0) {
        anyhow::bail!(if result.stderr.trim().is_empty() {
            format!("git_{action}_failed")
        } else {
            result.stderr
        });
    }
    collect(cwd.to_string_lossy().as_ref()).await
}

fn assert_change_path<'a>(
    cwd: &Path,
    changes: &'a WorkspaceChanges,
    file_path: &str,
) -> anyhow::Result<&'a WorkspaceChangeFile> {
    let Some(change) = changes.files.iter().find(|item| item.path == file_path) else {
        anyhow::bail!("change_not_found");
    };
    let absolute = cwd.join(file_path);
    let relative = absolute
        .strip_prefix(cwd)
        .map_err(|_| anyhow::anyhow!("path_outside_workspace"))?;
    if relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        anyhow::bail!("path_outside_workspace");
    }
    Ok(change)
}

fn normalize_cwd(cwd: &str) -> anyhow::Result<PathBuf> {
    let path = PathBuf::from(cwd);
    if path.exists() {
        Ok(path.canonicalize()?)
    } else {
        Ok(path)
    }
}

async fn run_git(cwd: &Path, args: &[&str]) -> anyhow::Result<CommandOutput> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await?;
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}

fn parse_short_status_line(line: &str) -> StatusItem {
    let status = {
        let raw = line.get(0..2).unwrap_or("").trim();
        if raw.is_empty() {
            line.get(0..2).unwrap_or("").to_string()
        } else {
            raw.to_string()
        }
    };
    let raw_path = line.get(3..).unwrap_or("").trim();
    let path = raw_path
        .split(" -> ")
        .last()
        .unwrap_or(raw_path)
        .trim_matches('"')
        .to_string();
    StatusItem { status, path }
}

fn parse_numstat(value: &str) -> HashMap<String, FileStat> {
    let mut items = HashMap::new();
    for line in value.lines().filter(|line| !line.trim().is_empty()) {
        let parts = line.split('\t').collect::<Vec<_>>();
        let [added, deleted, path, ..] = parts.as_slice() else {
            continue;
        };
        let binary = *added == "-" || *deleted == "-";
        let entry = items
            .entry((*path).to_string())
            .or_insert_with(FileStat::default);
        entry.additions += if binary {
            0
        } else {
            added.parse::<i64>().unwrap_or(0)
        };
        entry.deletions += if binary {
            0
        } else {
            deleted.parse::<i64>().unwrap_or(0)
        };
        entry.binary = entry.binary || binary;
    }
    items
}

fn read_text_file_if_small(cwd: &Path, file_path: &str) -> anyhow::Result<TextFilePreview> {
    let absolute = cwd.join(file_path);
    let relative = absolute
        .strip_prefix(cwd)
        .map_err(|_| anyhow::anyhow!("path_outside_workspace"))?;
    if relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Ok(TextFilePreview {
            binary: false,
            content: String::new(),
        });
    }
    let metadata = fs::metadata(&absolute)?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 {
        return Ok(TextFilePreview {
            binary: metadata.is_file(),
            content: String::new(),
        });
    }
    let content = fs::read_to_string(&absolute).unwrap_or_default();
    if content.contains('\0') {
        Ok(TextFilePreview {
            binary: true,
            content: String::new(),
        })
    } else {
        Ok(TextFilePreview {
            binary: false,
            content,
        })
    }
}

struct CommandOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

struct StatusItem {
    status: String,
    path: String,
}

#[derive(Clone, Default)]
struct FileStat {
    additions: i64,
    deletions: i64,
    binary: bool,
}

struct TextFilePreview {
    binary: bool,
    content: String,
}
