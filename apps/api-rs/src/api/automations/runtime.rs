use std::{path::PathBuf, process::Stdio, time::Instant};

use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
};

use crate::{
    api::{
        sessions::{
            messages,
            models::{
                AppendSessionMessageRequest, CreateSessionRequest, SessionRuntimeUpdate,
                SessionSummary,
            },
            store as session_store,
        },
        settings::store as settings_store,
        tasks::runner,
    },
    state::AppState,
};

use super::{
    models::{AutomationRunSummary, AutomationSummary},
    store,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunStartResponse {
    pub session: SessionSummary,
    pub automation_run_status: String,
    pub run: AutomationRunSummary,
}

pub struct StopRunningResult {
    pub found: bool,
    pub stopped: bool,
    pub session: Option<SessionSummary>,
}

fn automation_log_path(state: &AppState, session_id: &str) -> PathBuf {
    state
        .db
        .data_dir
        .join("sessions")
        .join(session_id)
        .join("logs")
        .join("codex.log")
}

fn automation_meta_path(state: &AppState, session_id: &str) -> PathBuf {
    state
        .db
        .data_dir
        .join("sessions")
        .join(session_id)
        .join("logs")
        .join("codex.json")
}

async fn append_automation_log(
    state: &AppState,
    session_id: &str,
    content: &str,
) -> anyhow::Result<()> {
    let path = automation_log_path(state, session_id);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(content.as_bytes()).await?;
    crate::api::tasks::events::publish_output(state, session_id, content.len());
    Ok(())
}

async fn write_automation_meta(
    state: &AppState,
    session_id: &str,
    exit_code: Option<i64>,
    status: &str,
) -> anyhow::Result<()> {
    let path = automation_meta_path(state, session_id);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(
        path,
        serde_json::to_string_pretty(&serde_json::json!({
            "exitCode": exit_code,
            "status": status,
            "updatedAt": crate::api::common::timestamp(),
        }))?,
    )
    .await?;
    Ok(())
}

pub async fn run_now(
    state: AppState,
    automation: AutomationSummary,
) -> anyhow::Result<AutomationRunStartResponse> {
    run_now_with_queued(state, automation, None).await
}

async fn run_now_with_queued(
    state: AppState,
    automation: AutomationSummary,
    queued_run_id: Option<String>,
) -> anyhow::Result<AutomationRunStartResponse> {
    if automation.status != "active" {
        anyhow::bail!("automation_not_active");
    }
    if queued_run_id.is_none() && !store::running_runs(&state.db, &automation.id)?.is_empty() {
        let session = ensure_session(&state, &automation)?;
        if automation.overlap_policy == "skip" {
            let now = crate::api::common::timestamp();
            let _ = messages::append(
                &state.db,
                &session.id,
                AppendSessionMessageRequest {
                    role: Some("system".to_string()),
                    content: Some(format!(
                        "Automation run skipped because a previous run is still active: {} ({})",
                        automation.name, now
                    )),
                    reply_to_message_id: None,
                },
            );
            let run = store::create_run_at(
                &state.db,
                &automation.id,
                &session.id,
                "skipped",
                &now,
                Some(&now),
            )?;
            return Ok(AutomationRunStartResponse {
                session,
                automation_run_status: "skipped".to_string(),
                run,
            });
        }
        let _ = messages::append(
            &state.db,
            &session.id,
            AppendSessionMessageRequest {
                role: Some("system".to_string()),
                content: Some(format!(
                    "Automation run queued: {} ({})",
                    automation.name,
                    crate::api::common::timestamp()
                )),
                reply_to_message_id: None,
            },
        );
        let run = store::create_run(&state.db, &automation.id, &session.id, "queued")?;
        return Ok(AutomationRunStartResponse {
            session,
            automation_run_status: "queued".to_string(),
            run,
        });
    }
    let session = ensure_session(&state, &automation)?;
    let now = crate::api::common::timestamp();
    let session = session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            status: Some("running".to_string()),
            ..Default::default()
        },
    )?
    .unwrap_or(session);
    let run = if let Some(queued_run_id) = queued_run_id {
        store::start_queued_run(&state.db, &queued_run_id, &session.id)?
            .ok_or_else(|| anyhow::anyhow!("automation_run_not_found"))?
    } else {
        store::create_run(&state.db, &automation.id, &session.id, "running")?
    };
    messages::append(
        &state.db,
        &session.id,
        AppendSessionMessageRequest {
            role: Some("system".to_string()),
            content: Some(format!(
                "Automation run started: {} ({})",
                automation.name, now
            )),
            reply_to_message_id: None,
        },
    )?;
    let content = if automation.action_type == "command" {
        automation
            .command
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string()
    } else {
        automation.prompt.trim().to_string()
    };
    messages::append(
        &state.db,
        &session.id,
        AppendSessionMessageRequest {
            role: Some("user".to_string()),
            content: Some(content.clone()),
            reply_to_message_id: None,
        },
    )?;
    if automation.action_type == "command" {
        start_command_run(
            state.clone(),
            automation.clone(),
            session.clone(),
            run.clone(),
        )
        .await?;
    } else {
        runner::start_room_run(
            state.clone(),
            session.clone(),
            content,
            PathBuf::from(&session.workspace_path),
            automation.provider_id.clone(),
            automation.model.clone(),
            true,
        )
        .await?;
    }
    Ok(AutomationRunStartResponse {
        session,
        automation_run_status: "running".to_string(),
        run,
    })
}

pub fn stop_running(state: &AppState, automation_id: &str) -> anyhow::Result<StopRunningResult> {
    let Some(run) = store::latest_running_run(&state.db, automation_id)? else {
        return Ok(StopRunningResult {
            found: false,
            stopped: false,
            session: None,
        });
    };
    let Some(session) = session_store::get_session(&state.db, &run.session_id)? else {
        return Ok(StopRunningResult {
            found: false,
            stopped: false,
            session: None,
        });
    };
    let had_handle = state.tasks.get(&session.id).is_some();
    let _ = runner::stop_task(state, &session.id);
    let updated = session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            status: Some("paused".to_string()),
            ..Default::default()
        },
    )?
    .unwrap_or(session);
    if !had_handle {
        let _ = store::stop_running_runs(&state.db, automation_id)?;
        start_next_queued_run_threaded(state.clone(), automation_id.to_string());
    }
    let _ = messages::append(
        &state.db,
        &updated.id,
        AppendSessionMessageRequest {
            role: Some("assistant".to_string()),
            content: Some(format!(
                "用户主动停止自动化运行。停止时间：{}。",
                crate::api::common::timestamp()
            )),
            reply_to_message_id: None,
        },
    );
    Ok(StopRunningResult {
        found: true,
        stopped: had_handle,
        session: Some(updated),
    })
}

pub fn finish_run_for_session(
    state: &AppState,
    session_id: &str,
    exit_code: Option<i64>,
    stopped: bool,
) -> anyhow::Result<()> {
    let Some(run) = store::running_run_for_session(&state.db, session_id)? else {
        return Ok(());
    };
    let status = if stopped {
        "stopped"
    } else if exit_code == Some(0) {
        "done"
    } else {
        "failed"
    };
    let _ = store::finish_run(&state.db, &run.id, status, exit_code)?;
    if status == "failed" {
        schedule_retry(state, &run.automation_id, session_id)?;
    }
    start_next_queued_run_threaded(state.clone(), run.automation_id);
    Ok(())
}

pub fn check_scheduled_work_threaded(state: AppState) {
    start_due_queued_runs_threaded(state.clone());
    let now = time::OffsetDateTime::now_utc();
    for automation in store::list(&state.db).unwrap_or_default() {
        if store::should_run_now(&state.db, &automation, now).unwrap_or(false) {
            start_automation_run_threaded(state.clone(), automation, None);
        }
    }
}

pub fn run_startup_automations_threaded(state: AppState) {
    let startup_key = process_startup_key();
    for automation in store::list(&state.db).unwrap_or_default() {
        if automation.status == "active"
            && automation.schedule.trim().eq_ignore_ascii_case("startup")
        {
            if store::has_active_run(&state.db, &automation.id).unwrap_or(false) {
                continue;
            }
            if !store::claim_startup_run(&state.db, &automation.id, &startup_key)
                .unwrap_or(false)
            {
                continue;
            }
            start_automation_run_threaded(state.clone(), automation, None);
        }
    }
}

fn start_due_queued_runs_threaded(state: AppState) {
    let now = crate::api::common::timestamp();
    for automation_id in
        store::automation_ids_with_due_queued_runs(&state.db, &now).unwrap_or_default()
    {
        start_next_queued_run_threaded(state.clone(), automation_id);
    }
}

fn start_next_queued_run_threaded(state: AppState, automation_id: String) {
    if !store::running_runs(&state.db, &automation_id)
        .unwrap_or_default()
        .is_empty()
    {
        return;
    }
    let now = crate::api::common::timestamp();
    let Some(queued) = store::next_due_queued_run(&state.db, &automation_id, &now)
        .ok()
        .flatten()
    else {
        return;
    };
    let Some(automation) = store::get(&state.db, &automation_id).ok().flatten() else {
        return;
    };
    if automation.status != "active" {
        return;
    }
    start_automation_run_threaded(state, automation, Some(queued.id));
}

fn start_automation_run_threaded(
    state: AppState,
    automation: AutomationSummary,
    queued_run_id: Option<String>,
) {
    std::thread::spawn(move || {
        if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            runtime.block_on(async move {
                let response = match queued_run_id {
                    Some(queued_run_id) => {
                        run_now_with_queued(state.clone(), automation, Some(queued_run_id)).await
                    }
                    None => run_now(state.clone(), automation).await,
                };
                let Ok(response) = response else {
                    return;
                };
                if response.automation_run_status != "running" {
                    return;
                }
                while state.tasks.get(&response.session.id).is_some() {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            });
        }
    });
}

fn schedule_retry(state: &AppState, automation_id: &str, session_id: &str) -> anyhow::Result<()> {
    let Some(automation) = store::get(&state.db, automation_id)? else {
        return Ok(());
    };
    if automation.status != "active" || automation.retry_max <= 0 {
        return Ok(());
    }
    let failures = consecutive_failures(state, automation_id)?;
    if failures > automation.retry_max {
        return Ok(());
    }
    let retry_at = (time::OffsetDateTime::now_utc()
        + time::Duration::minutes(automation.retry_delay_minutes))
    .format(&time::format_description::well_known::Rfc3339)?;
    let _ = store::create_run_at(
        &state.db,
        automation_id,
        session_id,
        "queued",
        &retry_at,
        None,
    )?;
    let _ = messages::append(
        &state.db,
        session_id,
        AppendSessionMessageRequest {
            role: Some("system".to_string()),
            content: Some(format!(
                "Automation retry queued: {} ({})",
                automation.name, retry_at
            )),
            reply_to_message_id: None,
        },
    );
    Ok(())
}

fn consecutive_failures(state: &AppState, automation_id: &str) -> anyhow::Result<i64> {
    let runs = store::runs(&state.db, automation_id, 20, None, None)?.items;
    let mut count = 0;
    for run in runs {
        if run.status != "failed" {
            break;
        }
        count += 1;
    }
    Ok(count)
}

async fn start_command_run(
    state: AppState,
    automation: AutomationSummary,
    session: SessionSummary,
    run: AutomationRunSummary,
) -> anyhow::Result<()> {
    let command = automation
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("invalid_automation_command"))?
        .to_string();
    let cwd = automation
        .cwd
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&session.workspace_path));
    let timeout = automation
        .command_timeout_seconds
        .map(|seconds| std::time::Duration::from_secs(seconds.max(1) as u64));
    let secret_env = settings_store::credential_env(&state.db).unwrap_or_default();
    append_automation_log(&state, &session.id, &settings_store::redact_secrets(&format!("[codex-web-rs] automation={} run={} cwd={}\n\n--- user ---\n{}\n\n--- agent ---\n$ {}\n", automation.id, run.id, cwd.display(), command, command), &secret_env)).await?;
    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg(&command)
        .current_dir(&cwd)
        .envs(secret_env.iter().map(|(key, value)| (key, value)))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let output = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
    if let Some(stdout) = stdout {
        let output = output.clone();
        let redactions = secret_env.clone();
        tokio::spawn(async move {
            collect_lines(stdout, output, redactions).await;
        });
    }
    if let Some(stderr) = stderr {
        let output = output.clone();
        let redactions = secret_env.clone();
        tokio::spawn(async move {
            collect_lines(stderr, output, redactions).await;
        });
    }
    let (kill_tx, mut kill_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.tasks.insert(crate::state::TaskHandle {
        session_id: session.id.clone(),
        kill: kill_tx,
    });
    tokio::spawn(async move {
        let started = Instant::now();
        let mut stopped = false;
        let mut timed_out = false;
        let status = wait_command_child(&mut child, timeout, &mut kill_rx)
            .await
            .map(|outcome| {
                stopped = outcome.stopped;
                timed_out = outcome.timed_out;
                outcome.status
            })
            .ok()
            .flatten();
        let duration_ms = started.elapsed().as_millis() as i64;
        let exit_code = status
            .and_then(|status| status.code())
            .map(|code| code as i64);
        let output = output.lock().await.clone();
        let output_note = if timed_out {
            "\n[timed out]"
        } else if stopped {
            "\n[stopped]"
        } else {
            ""
        };
        let content = format!(
            "$ {}\n\n{}{}{}",
            command,
            output,
            output_note,
            exit_code
                .map(|code| format!("\n[exit {code}]"))
                .unwrap_or_else(|| "\n[exit unknown]".to_string()),
        );
        let _ = append_automation_log(&state, &session.id, &format!("{}\n", content)).await;
        let _ = messages::append(
            &state.db,
            &session.id,
            AppendSessionMessageRequest {
                role: Some("assistant".to_string()),
                content: Some(content.clone()),
                reply_to_message_id: None,
            },
        );
        let status = if stopped {
            "stopped"
        } else if exit_code == Some(0) {
            "done"
        } else {
            "failed"
        };
        let session_status = if status == "done" {
            "done".to_string()
        } else {
            "interrupted".to_string()
        };
        let _ = finish_run_for_session(&state, &session.id, exit_code, stopped);
        let _ = write_automation_meta(&state, &session.id, exit_code, status).await;
        state.tasks.remove(&session.id);
        let updated_session = session_store::update_runtime(
            &state.db,
            &session.id,
            SessionRuntimeUpdate {
                status: Some(session_status),
                ..Default::default()
            },
        )
        .ok()
        .flatten();
        if let Some(updated_session) = updated_session {
            emit_automation_command_notification(
                &state,
                &automation,
                &updated_session,
                CommandNotificationResult {
                    exit_code,
                    timed_out,
                    stopped,
                    command: command.clone(),
                    cwd: cwd.display().to_string(),
                    output: output.clone(),
                    duration_ms,
                },
            );
            crate::api::tasks::events::publish_event(
                &state,
                &session.id,
                serde_json::json!({ "type": "done", "session": updated_session, "exitCode": exit_code }),
            );
        }
    });
    Ok(())
}

fn process_startup_key() -> String {
    let started_at = crate::api::common::timestamp();
    format!("process:{}:{started_at}", std::process::id())
}

struct CommandWaitOutcome {
    status: Option<std::process::ExitStatus>,
    stopped: bool,
    timed_out: bool,
}

async fn wait_command_child(
    child: &mut Child,
    timeout: Option<std::time::Duration>,
    kill_rx: &mut tokio::sync::mpsc::UnboundedReceiver<()>,
) -> anyhow::Result<CommandWaitOutcome> {
    let sleep = async {
        if let Some(timeout) = timeout {
            tokio::time::sleep(timeout).await;
            true
        } else {
            std::future::pending::<bool>().await
        }
    };
    tokio::pin!(sleep);
    tokio::select! {
        status = child.wait() => Ok(CommandWaitOutcome { status: status.ok(), stopped: false, timed_out: false }),
        _ = kill_rx.recv() => {
            let _ = child.kill().await;
            let status = child.wait().await.ok();
            Ok(CommandWaitOutcome { status, stopped: true, timed_out: false })
        }
        timed_out = &mut sleep => {
            if timed_out {
                let _ = child.kill().await;
                let status = child.wait().await.ok();
                Ok(CommandWaitOutcome { status, stopped: false, timed_out: true })
            } else {
                Ok(CommandWaitOutcome { status: None, stopped: false, timed_out: false })
            }
        }
    }
}

struct CommandNotificationResult {
    exit_code: Option<i64>,
    timed_out: bool,
    stopped: bool,
    command: String,
    cwd: String,
    output: String,
    duration_ms: i64,
}

fn emit_automation_command_notification(
    state: &AppState,
    automation: &AutomationSummary,
    session: &SessionSummary,
    result: CommandNotificationResult,
) {
    let success = result.exit_code == Some(0) && !result.timed_out && !result.stopped;
    let event_type = if result.stopped {
        "task_interrupted"
    } else if success {
        "task_completed"
    } else {
        "task_failed"
    };
    let title = if success {
        format!("自动化完成：{}", automation.name)
    } else {
        format!("自动化异常：{}", automation.name)
    };
    let mut message = format!(
        "自动化：{}\n命令：{}\n目录：{}\n退出码：{}",
        automation.name,
        result.command,
        result.cwd,
        result
            .exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "null".to_string())
    );
    if result.timed_out {
        message.push_str("\n状态：超时");
    } else if result.stopped {
        message.push_str("\n状态：已停止");
    }
    let trimmed_output = result.output.trim();
    if !trimmed_output.is_empty() {
        message.push_str("\n\n输出：\n");
        message.push_str(&trimmed_output.chars().take(1200).collect::<String>());
    }
    crate::api::notifications::runtime::emit_external_notification(
        state.clone(),
        crate::api::notifications::runtime::NotificationEvent {
            event_type: event_type.to_string(),
            severity: if result.stopped {
                "warning"
            } else if success {
                "success"
            } else {
                "error"
            }
            .to_string(),
            title,
            message,
            source_type: Some("session".to_string()),
            source_id: Some(session.id.clone()),
            metadata: serde_json::json!({
                "automationId": automation.id,
                "automationName": automation.name,
                "actionType": automation.action_type,
                "command": result.command,
                "cwd": result.cwd,
                "exitCode": result.exit_code,
                "timedOut": result.timed_out,
                "stopped": result.stopped,
                "durationMs": result.duration_ms,
                "workspacePath": session.workspace_path,
                "notificationScopes": [
                    { "scopeType": "session", "scopeId": session.id },
                    { "scopeType": "automation", "scopeId": automation.id }
                ]
            }),
        },
    );
}

async fn collect_lines<R>(
    reader: R,
    output: std::sync::Arc<tokio::sync::Mutex<String>>,
    redactions: Vec<(String, String)>,
)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = settings_store::redact_secrets(&line, &redactions);
        let mut output = output.lock().await;
        output.push_str(&line);
        output.push('\n');
        if output.len() > 200_000 {
            let keep_from = output.len().saturating_sub(200_000);
            *output = output[keep_from..].to_string();
        }
    }
}

fn ensure_session(
    state: &AppState,
    automation: &AutomationSummary,
) -> anyhow::Result<SessionSummary> {
    if let Some(session_id) = automation
        .session_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        if let Some(session) = session_store::get_session(&state.db, session_id)? {
            let session = session_store::update_runtime(
                &state.db,
                &session.id,
                SessionRuntimeUpdate {
                    provider_id: Some(automation.provider_id.clone()),
                    model: Some(automation.model.clone()),
                    workspace_path: automation.cwd.clone(),
                    ..Default::default()
                },
            )?
            .unwrap_or(session);
            return Ok(session);
        }
    }
    let session = session_store::create_session(
        &state.db,
        CreateSessionRequest {
            title: automation.name.clone(),
            project_id: automation.project_id.clone(),
            conversation_type: Some("automation".to_string()),
            room_id: None,
            goal: None,
        },
    )?;
    store::bind_session(&state.db, &automation.id, &session.id)?;
    session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            provider_id: Some(automation.provider_id.clone()),
            model: Some(automation.model.clone()),
            workspace_path: automation.cwd.clone(),
            status: Some("paused".to_string()),
            ..Default::default()
        },
    )?
    .ok_or_else(|| anyhow::anyhow!("automation_session_missing"))
}
