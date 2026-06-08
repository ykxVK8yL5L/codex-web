use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

use crate::{
    api::{
        providers::{models::ProviderRecord, store as provider_store},
        rooms::models::UploadAttachmentInput,
        sessions::{
            messages,
            models::{
                AppendSessionMessageRequest, CreateSessionRequest, SessionRuntimeUpdate,
                SessionSummary,
            },
            store as session_store,
        },
        settings::{load_codex_runtime, CodexRuntimeSettings},
    },
    state::{AppState, TaskHandle},
};

use super::runs;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCodexTaskRequest {
    pub prompt: String,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<UploadAttachmentInput>>,
    #[serde(default)]
    pub ephemeral_notifications: Option<Vec<EphemeralNotificationInput>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueCodexTaskRequest {
    pub prompt: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reply_to_message_id: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<UploadAttachmentInput>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralNotificationInput {
    pub event_types: Vec<String>,
    pub targets: Vec<String>,
    pub expire_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverCodexTaskRequest {
    pub prompt: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
}

pub async fn create_task(
    state: AppState,
    input: CreateCodexTaskRequest,
) -> anyhow::Result<SessionSummary> {
    let prompt = required_prompt(&input.prompt)?;
    let provider = select_provider(&state, input.provider_id.as_deref())?;
    let selected_model = select_model(provider.as_ref(), input.model.as_deref());
    let title = prompt.chars().take(60).collect::<String>();
    let mut session = session_store::create_session(
        &state.db,
        CreateSessionRequest {
            title,
            project_id: input.project_id.filter(|value| !value.trim().is_empty()),
            conversation_type: Some("codex".to_string()),
            room_id: None,
            goal: None,
        },
    )?;
    let workspace_path = input
        .cwd
        .map(resolve_cwd)
        .transpose()?
        .unwrap_or_else(|| PathBuf::from(&session.workspace_path));
    session = session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            workspace_path: Some(workspace_path.display().to_string()),
            provider_id: Some(provider.as_ref().map(|item| item.summary.id.clone())),
            model: Some(selected_model.clone()),
            status: Some("running".to_string()),
            ..Default::default()
        },
    )?
    .unwrap_or(session);
    let attachments = save_session_attachments(&state, &session.id, input.attachments.as_deref())?;
    for notification in input.ephemeral_notifications.unwrap_or_default() {
        create_ephemeral_notification_rule(&state, &session.id, notification)?;
    }
    register_ephemeral_notifications_from_prompt(&state, &session.id, &prompt)?;
    let message_content = message_with_attachments(&prompt, &attachments);
    let runner_prompt = prompt_with_attachments(&prompt, &attachments);
    let message = messages::append(
        &state.db,
        &session.id,
        AppendSessionMessageRequest {
            role: Some("user".to_string()),
            content: Some(message_content),
            reply_to_message_id: None,
        },
    )?;
    super::events::publish_started(&state, &session);
    super::events::publish_message(&state, &session, &message);
    start_runner(
        state,
        session.clone(),
        runner_prompt,
        workspace_path,
        provider,
        selected_model,
        true,
    )
    .await?;
    Ok(session)
}

pub async fn continue_task(
    state: AppState,
    session_id: String,
    input: ContinueCodexTaskRequest,
) -> anyhow::Result<ContinueTaskOutcome> {
    let prompt = required_prompt(&input.prompt)?;
    let Some(mut session) = session_store::get_session(&state.db, &session_id)? else {
        anyhow::bail!("task_not_found");
    };
    if state.tasks.get(&session_id).is_some() || session.status == "running" {
        if input
            .attachments
            .as_ref()
            .is_some_and(|items| !items.is_empty())
        {
            anyhow::bail!("attachments_cannot_queue");
        }
        let item = super::super::sessions::queue::enqueue(
            &state.db,
            &session,
            super::super::sessions::models::QueueMessageRequest {
                prompt,
                provider_id: input.provider_id,
                model: input.model,
                reply_to_message_id: input.reply_to_message_id,
            },
        )?;
        super::events::publish_queue(&state, &session);
        return Ok(ContinueTaskOutcome::Queued(item));
    }
    let previous_provider_id = session.provider_id.clone();
    let provider = select_provider(
        &state,
        input
            .provider_id
            .as_deref()
            .or(session.provider_id.as_deref()),
    )?;
    let selected_model = input
        .model
        .or_else(|| session.model.clone())
        .or_else(|| select_model(provider.as_ref(), None));
    // If the provider changed, the existing codex thread belongs to the OLD provider. Resuming it
    // would keep using that old provider (and surface its errors) regardless of the newly selected
    // model/provider. Start a fresh thread so the new provider actually takes effect.
    let resolved_provider_id = provider.as_ref().map(|item| item.summary.id.clone());
    let provider_switched = resolved_provider_id != previous_provider_id;
    session = session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            provider_id: Some(provider.as_ref().map(|item| item.summary.id.clone())),
            model: Some(selected_model.clone()),
            status: Some("running".to_string()),
            ..Default::default()
        },
    )?
    .unwrap_or(session);
    let attachments = save_session_attachments(&state, &session.id, input.attachments.as_deref())?;
    register_ephemeral_notifications_from_prompt(&state, &session.id, &prompt)?;
    let message_content = message_with_attachments(&prompt, &attachments);
    let mut runner_prompt = prompt_with_attachments(&prompt, &attachments);
    runner_prompt = prompt_with_reply_context(
        &state,
        &session.id,
        runner_prompt,
        input.reply_to_message_id.as_deref(),
    );
    let message = messages::append(
        &state.db,
        &session.id,
        AppendSessionMessageRequest {
            role: Some("user".to_string()),
            content: Some(message_content),
            reply_to_message_id: input.reply_to_message_id,
        },
    )?;
    super::events::publish_started(&state, &session);
    super::events::publish_message(&state, &session, &message);
    start_runner(
        state,
        session.clone(),
        runner_prompt,
        PathBuf::from(&session.workspace_path),
        provider,
        selected_model,
        provider_switched || session.codex_session_id.is_none(),
    )
    .await?;
    Ok(ContinueTaskOutcome::Session(session))
}

pub async fn recover_task(
    state: AppState,
    session_id: String,
    input: RecoverCodexTaskRequest,
) -> anyhow::Result<SessionSummary> {
    let Some(mut session) = session_store::get_session(&state.db, &session_id)? else {
        anyhow::bail!("task_not_found");
    };
    if state.tasks.get(&session_id).is_some() || session.status == "running" {
        anyhow::bail!("task_running");
    }
    let prompt = input.prompt.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or(
        "Recover the interrupted task from the current conversation, task log, workspace files, and Git changes. Summarize completed and pending work first, then continue with the next concrete step.",
    ).to_string();
    let provider = select_provider(
        &state,
        input
            .provider_id
            .as_deref()
            .or(session.provider_id.as_deref()),
    )?;
    let selected_model = input
        .model
        .or_else(|| session.model.clone())
        .or_else(|| select_model(provider.as_ref(), None));
    session = session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            provider_id: Some(provider.as_ref().map(|item| item.summary.id.clone())),
            model: Some(selected_model.clone()),
            status: Some("running".to_string()),
            ..Default::default()
        },
    )?
    .unwrap_or(session);
    let message = messages::append(
        &state.db,
        &session.id,
        AppendSessionMessageRequest {
            role: Some("user".to_string()),
            content: Some(prompt.clone()),
            reply_to_message_id: None,
        },
    )?;
    super::events::publish_started(&state, &session);
    super::events::publish_message(&state, &session, &message);
    start_runner(
        state,
        session.clone(),
        prompt,
        PathBuf::from(&session.workspace_path),
        provider,
        selected_model,
        false,
    )
    .await?;
    Ok(session)
}

pub fn stop_task(state: &AppState, session_id: &str) -> anyhow::Result<usize> {
    let updated = runs::mark_stop_requested(&state.db, session_id)?;
    if let Some(handle) = state.tasks.get(session_id) {
        let _ = handle.kill.send(());
    }
    // The UI stop endpoint immediately persists session.status='paused'. If we keep the in-memory
    // task handle until the child fully exits, a message sent right after Stop is treated as
    // "currently running" and gets queued; because stopped tasks intentionally don't drain the
    // queue, that message then never sends. Remove the active guard immediately after signaling
    // kill so the next user message starts a fresh run. The wait task will remove again harmlessly.
    state.tasks.remove(session_id);
    Ok(updated)
}

pub enum ContinueTaskOutcome {
    Session(SessionSummary),
    Queued(super::super::sessions::models::QueuedMessage),
}

#[derive(Clone, Serialize)]
struct SavedTaskAttachment {
    id: String,
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

fn save_session_attachments(
    state: &AppState,
    session_id: &str,
    inputs: Option<&[UploadAttachmentInput]>,
) -> anyhow::Result<Vec<SavedTaskAttachment>> {
    let Some(inputs) = inputs else {
        return Ok(Vec::new());
    };
    let root = session_data_path(state, session_id).join("attachments");
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
        let content_type = item
            .r#type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("application/octet-stream")
            .to_string();
        use base64::Engine;
        let buffer = base64::engine::general_purpose::STANDARD
            .decode(item.data_base64.as_deref().unwrap_or_default())
            .map_err(|_| anyhow::anyhow!("invalid_attachment_data"))?;
        if buffer.len() > MAX_ATTACHMENT_BYTES {
            anyhow::bail!("attachment_too_large");
        }
        fs::create_dir_all(&root)?;
        let id = format!("attachment-{}", task_random_hex(16));
        let filename = format!("{id}-{name}");
        let target = root.join(&filename);
        if !target.starts_with(&root) {
            anyhow::bail!("invalid_attachment_path");
        }
        fs::write(&target, &buffer)?;
        saved.push(SavedTaskAttachment {
            id,
            name: name.clone(),
            r#type: content_type.clone(),
            size: buffer.len(),
            path: target.display().to_string(),
            relative_path: format!("attachments/{filename}"),
            text_preview: attachment_text_preview(&buffer, &content_type, &name),
        });
    }
    Ok(saved)
}

fn prompt_with_attachments(prompt: &str, attachments: &[SavedTaskAttachment]) -> String {
    let block = attachment_markdown(attachments, true);
    if block.is_empty() {
        prompt.trim().to_string()
    } else {
        format!("{}\n\n{}", prompt.trim(), block)
    }
}

fn message_with_attachments(prompt: &str, attachments: &[SavedTaskAttachment]) -> String {
    let block = attachment_markdown(attachments, false);
    if block.is_empty() {
        prompt.trim().to_string()
    } else {
        format!("{}\n\n{}", prompt.trim(), block)
    }
}

fn attachment_markdown(attachments: &[SavedTaskAttachment], include_preview: bool) -> String {
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

fn attachment_text_preview(buffer: &[u8], content_type: &str, name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
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

fn readable_attachment_bytes(size: usize) -> String {
    if size < 1024 {
        format!("{size} B")
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", size as f64 / 1024.0 / 1024.0)
    }
}

fn task_random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn safe_attachment_name(name: &str) -> String {
    let base = std::path::Path::new(if name.is_empty() { "attachment" } else { name })
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "attachment".to_string());
    let sanitized = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric()
                || matches!(ch, '.' | '_' | '-' | ' ' | '(' | ')' | '[' | ']')
                || ('\u{4e00}'..='\u{9fff}').contains(&ch)
            {
                ch
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "attachment".to_string()
    } else {
        sanitized
    }
}

fn prompt_with_reply_context(
    state: &AppState,
    session_id: &str,
    prompt: String,
    reply_to_message_id: Option<&str>,
) -> String {
    let Some(reply_id) = reply_to_message_id.filter(|value| !value.trim().is_empty()) else {
        return prompt;
    };
    let Ok(page) = messages::list(&state.db, session_id, 500, None) else {
        return prompt;
    };
    let Some(reply) = page
        .items
        .into_iter()
        .find(|message| message.id == reply_id)
    else {
        return prompt;
    };
    [
        "The user is replying to this earlier message:".to_string(),
        format!("Role: {}", reply.role),
        format!("Message: {}", reply.content),
        String::new(),
        "User reply:".to_string(),
        prompt,
    ]
    .join("\n")
}

fn create_ephemeral_notification_rule(
    state: &AppState,
    session_id: &str,
    input: EphemeralNotificationInput,
) -> anyhow::Result<()> {
    let targets = serde_json::to_value(input.targets)?;
    let _ = crate::api::notifications::store::create_ephemeral_rule(
        &state.db,
        crate::api::notifications::models::UpsertNotificationEphemeralRuleRequest {
            scope_type: Some("session".to_string()),
            scope_id: Some(session_id.to_string()),
            event_types: Some(input.event_types),
            targets: Some(targets),
            expire_mode: input.expire_mode,
            enabled: Some(true),
        },
    )?;
    Ok(())
}

fn register_ephemeral_notifications_from_prompt(
    state: &AppState,
    session_id: &str,
    prompt: &str,
) -> anyhow::Result<()> {
    let text = prompt.trim();
    let lower = text.to_lowercase();
    if !(text.contains("通知") || text.contains("提醒") || lower.contains("notify")) {
        return Ok(());
    }
    let recipients = crate::api::notifications::store::recipients(&state.db)?
        .into_iter()
        .filter(|recipient| recipient.enabled)
        .collect::<Vec<_>>();
    let normalized = lower.split_whitespace().collect::<String>();
    let matched = recipients
        .iter()
        .filter(|recipient| {
            let name = recipient
                .name
                .to_lowercase()
                .split_whitespace()
                .collect::<String>();
            !name.is_empty() && normalized.contains(&name)
        })
        .collect::<Vec<_>>();
    let targets = if !matched.is_empty() {
        matched
            .into_iter()
            .map(|recipient| serde_json::json!({ "recipientId": recipient.id }))
            .collect::<Vec<_>>()
    } else if recipients.len() == 1 {
        vec![serde_json::json!({ "recipientId": recipients[0].id })]
    } else {
        Vec::new()
    };
    if targets.is_empty() {
        return Ok(());
    }
    let _ = crate::api::notifications::store::create_ephemeral_rule(
        &state.db,
        crate::api::notifications::models::UpsertNotificationEphemeralRuleRequest {
            scope_type: Some("session".to_string()),
            scope_id: Some(session_id.to_string()),
            event_types: Some(notification_event_types_from_prompt(text)),
            targets: Some(serde_json::Value::Array(targets)),
            expire_mode: Some("after_trigger".to_string()),
            enabled: Some(true),
        },
    )?;
    Ok(())
}

fn notification_event_types_from_prompt(prompt: &str) -> Vec<String> {
    let text = prompt.to_lowercase();
    if text.contains("审批")
        || text.contains("批准")
        || text.contains("确认")
        || text.contains("approval")
    {
        return vec!["needs_approval".to_string()];
    }
    if text.contains("失败")
        || text.contains("报错")
        || text.contains("错误")
        || text.contains("fail")
        || text.contains("error")
    {
        return vec!["task_failed".to_string()];
    }
    vec!["task_completed".to_string()]
}

async fn run_next_queued_message_if_idle(
    state: AppState,
    session_id: String,
) -> anyhow::Result<bool> {
    if state.tasks.get(&session_id).is_some() {
        return Ok(false);
    }
    let Some(mut session) = session_store::get_session(&state.db, &session_id)? else {
        return Ok(false);
    };
    if session.status == "running" {
        return Ok(false);
    }
    let Some(item) = super::super::sessions::queue::pop_next(&state.db, &session_id)? else {
        return Ok(false);
    };
    state
        .telegram
        .activate_reply_target_from_queue(&session_id, &item.id);
    state
        .weixin_chat
        .activate_reply_target_from_queue(&session_id, &item.id);
    state
        .wecom_chat
        .activate_reply_target_from_queue(&session_id, &item.id);
    state
        .feishu_chat
        .activate_reply_target_from_queue(&session_id, &item.id);
    state
        .qq_chat
        .activate_reply_target_from_queue(&session_id, &item.id);
    state
        .email_chat
        .activate_reply_target_from_queue(&session_id, &item.id);
    super::events::publish_queue(&state, &session);
    let previous_provider_id = session.provider_id.clone();
    let provider = select_provider(
        &state,
        item.provider_id
            .as_deref()
            .or(session.provider_id.as_deref()),
    )?;
    let selected_model = item
        .model
        .clone()
        .or_else(|| session.model.clone())
        .or_else(|| select_model(provider.as_ref(), None));
    let resolved_provider_id = provider
        .as_ref()
        .map(|provider| provider.summary.id.clone());
    let provider_switched = resolved_provider_id != previous_provider_id;
    session = session_store::update_runtime(
        &state.db,
        &session.id,
        SessionRuntimeUpdate {
            provider_id: Some(resolved_provider_id),
            model: Some(selected_model.clone()),
            status: Some("running".to_string()),
            ..Default::default()
        },
    )?
    .unwrap_or(session);
    let message = messages::append(
        &state.db,
        &session.id,
        AppendSessionMessageRequest {
            role: Some("user".to_string()),
            content: Some(item.prompt.clone()),
            reply_to_message_id: item.reply_to_message_id.clone(),
        },
    )?;
    super::events::publish_started(&state, &session);
    super::events::publish_message(&state, &session, &message);
    let prompt = item.prompt;
    let reset_output = provider_switched || session.codex_session_id.is_none();
    start_runner(
        state,
        session.clone(),
        prompt,
        PathBuf::from(&session.workspace_path),
        provider,
        selected_model,
        reset_output,
    )
    .await?;
    Ok(true)
}

fn spawn_next_queued_message_if_idle(state: AppState, session_id: String) {
    std::thread::spawn(move || {
        if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            runtime.block_on(async move {
                let _ = run_next_queued_message_if_idle(state.clone(), session_id.clone()).await;
                // Keep this current-thread runtime alive while the queued run's internally-spawned
                // stdout/stderr/wait tasks execute. If we drop the runtime immediately after
                // start_runner returns, those tasks are aborted and the session stays "running".
                while state.tasks.get(&session_id).is_some() {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            });
        }
    });
}

/// Public launcher used by the rooms agent-run engine: spawn a codex run for an already
/// prepared room/agent session, reusing the same codex-spawning logic as direct tasks.
/// `provider_id`/`model` follow the same select_provider/select_model patterns.
pub async fn start_room_run(
    state: AppState,
    session: SessionSummary,
    prompt: String,
    cwd: PathBuf,
    provider_id: Option<String>,
    model: Option<String>,
    reset_output: bool,
) -> anyhow::Result<()> {
    let provider = select_provider(&state, provider_id.as_deref())?;
    let selected_model = select_model(provider.as_ref(), model.as_deref());
    start_runner(
        state,
        session,
        prompt,
        cwd,
        provider,
        selected_model,
        reset_output,
    )
    .await
}

fn absolute_path(path: &PathBuf) -> PathBuf {
    if path.is_absolute() {
        path.clone()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn ensure_runner_cwd(
    state: &AppState,
    session: &SessionSummary,
    cwd: &PathBuf,
) -> anyhow::Result<PathBuf> {
    let cwd = absolute_path(cwd);
    let data_sessions_root = absolute_path(&state.db.data_dir.join("sessions"));
    if cwd.exists() {
        if session.kind == "scratch" || cwd.starts_with(&data_sessions_root) {
            ensure_git_repository_sync(&cwd)?;
        }
        return Ok(cwd);
    }

    // Scratch/automation/agent session workspaces managed under data/sessions should be created on
    // demand. Project workspaces outside the managed data dir should surface a clear error instead
    // of silently creating a wrong project directory.
    if session.kind == "scratch" || cwd.starts_with(&data_sessions_root) {
        fs::create_dir_all(&cwd)?;
        ensure_git_repository_sync(&cwd)?;
        return Ok(cwd);
    }
    anyhow::bail!("workspace_not_found: {}", cwd.display())
}

fn ensure_git_repository_sync(path: &PathBuf) -> anyhow::Result<()> {
    if path.join(".git").exists() {
        return Ok(());
    }
    let output = std::process::Command::new("git")
        .arg("init")
        .current_dir(path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn managed_child_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        parts.push(format!("{home}/.local/share/mise/shims"));
        parts.push(format!("{home}/.mise/shims"));
        parts.push(format!("{home}/.local/bin"));
        parts.push(format!("{home}/.mise/bin"));
    }
    if let Ok(value) = std::env::var("MISE_SHIMS_DIR") {
        parts.push(value);
    }
    parts.push("/usr/local/bin".to_string());
    parts.push("/opt/homebrew/bin".to_string());
    parts.extend(
        current
            .split(':')
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned),
    );
    let mut seen = std::collections::HashSet::new();
    parts
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect::<Vec<_>>()
        .join(":")
}

async fn start_runner(
    state: AppState,
    session: SessionSummary,
    prompt: String,
    cwd: PathBuf,
    provider: Option<ProviderRecord>,
    model: Option<String>,
    reset_output: bool,
) -> anyhow::Result<()> {
    if state.tasks.get(&session.id).is_some() {
        anyhow::bail!("task_running");
    }
    fs::create_dir_all(session_logs_path(&state, &session.id))?;
    fs::create_dir_all(session_context_path(&state, &session.id))?;
    let cwd = ensure_runner_cwd(&state, &session, &cwd)?;
    let log_path = task_log_path(&state, &session.id);
    let meta_path = task_meta_path(&state, &session.id);
    if reset_output {
        fs::write(&log_path, "")?;
        let _ = fs::remove_file(&meta_path);
    } else {
        append_log(&log_path, "\n\n--- follow-up ---\n").await?;
    }
    let context_path = session_context_path(&state, &session.id).join("context-pack.md");
    let prompt = prompt_with_managed_context(&state, &session, &prompt, &cwd, &context_path)?;
    let prompt_hash = prompt_hash(&prompt);
    let run = runs::create(
        &state.db,
        runs::CreateTaskRunRequest {
            session_id: session.id.clone(),
            pid: None,
            prompt_chars: Some(prompt.chars().count() as i64),
            prompt_hash: Some(prompt_hash.clone()),
            context_path: Some(context_path.display().to_string()),
        },
    )?;
    let local_api_base = format!("http://127.0.0.1:{}", state.config.bind_addr().port());
    let runtime = load_codex_runtime(&state.db).unwrap_or_else(|_| CodexRuntimeSettings {
        sandbox_mode: "workspace-write".to_string(),
        approval_policy: "never".to_string(),
        bypass_sandbox: false,
        updated_at: crate::api::common::timestamp(),
    });
    let mut args = codex_args(
        &session,
        &prompt,
        provider.as_ref(),
        model.as_deref(),
        !reset_output && session.codex_session_id.is_some(),
        &local_api_base,
        &cwd,
        &runtime,
    );
    let mut command = Command::new("codex");
    command.args(&args);
    command.env("PATH", managed_child_path());
    command.current_dir(&cwd);
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(provider) = provider.as_ref() {
        if let Some(api_key) = provider
            .api_key
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            command.env("OPENAI_API_KEY", api_key);
        }
        // Only export OPENAI_BASE_URL for non-chat providers. Chat providers are reached via the
        // local proxy (configured as the codexweb model provider base_url), so pointing the env at
        // the real chat endpoint would send Responses payloads to a chat API.
        if provider.summary.kind != "openai-compatible-chat" {
            if let Some(base_url) = provider
                .summary
                .base_url
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                command.env("OPENAI_BASE_URL", base_url);
            }
        }
    }
    append_log(
        &log_path,
        &format!(
            "[codex-web-rs] mode={} session={} codexThread={} promptChars={} promptHash={} cwd={}\n\n--- user ---\n{}\n\n--- agent ---\n$ codex {}\n",
            if !reset_output && session.codex_session_id.is_some() { "resume" } else { "exec" },
            session.id,
            session.codex_session_id.as_deref().unwrap_or("new"),
            prompt.chars().count(),
            prompt_hash,
            cwd.display(),
            prompt,
            redact_args(&mut args, &prompt).join(" "),
        ),
    )
    .await?;
    let mut child = command.spawn()?;
    runs::update_pid(&state.db, &run.id, child.id().map(|id| id as i64))?;
    let (kill_tx, mut kill_rx) = tokio::sync::mpsc::unbounded_channel();
    state.tasks.insert(TaskHandle {
        session_id: session.id.clone(),
        kill: kill_tx,
    });
    super::events::publish_started(&state, &session);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let output_state = state.clone();
    let output_session = session.clone();
    let output_log = log_path.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            stream_lines(stdout, output_log, Some((output_state, output_session))).await;
        }
    });
    let error_log = log_path.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            stream_lines(stderr, error_log, None).await;
        }
    });
    tokio::spawn(async move {
        let (killed, waited_status) = tokio::select! {
            _ = kill_rx.recv() => {
                let _ = child.start_kill();
                (true, child.wait().await.ok())
            }
            result = child.wait() => {
                (false, result.ok())
            },
        };
        let exit_code = waited_status
            .and_then(|status| status.code().map(|code| code as i64))
            .or_else(|| {
                child
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|status| status.code().map(|code| code as i64))
            });
        let _ = stdout_task.await;
        let _ = stderr_task.await;
        let status = if killed {
            "stopped"
        } else if exit_code == Some(0) {
            "done"
        } else {
            "failed"
        };
        let reason = if killed { Some("user_stopped") } else { None };
        let _ = write_meta(&meta_path, exit_code, status).await;
        let _ = runs::finish_running_for_session(&state.db, &session.id, status, exit_code, reason);
        let updated_session = session_store::update_runtime(
            &state.db,
            &session.id,
            SessionRuntimeUpdate {
                status: Some(if status == "done" {
                    "completed".to_string()
                } else {
                    "paused".to_string()
                }),
                ..Default::default()
            },
        )
        .ok()
        .flatten()
        .unwrap_or_else(|| session.clone());
        if status == "failed" && !killed {
            let summary = tokio::fs::read_to_string(&log_path)
                .await
                .map(|output| task_error_summary(&output))
                .unwrap_or_default();
            let exit_text = exit_code
                .map(|value| value.to_string())
                .unwrap_or_else(|| "null".to_string());
            let content = if summary.trim().is_empty() {
                format!("任务运行失败，Codex 退出码为 {exit_text}。")
            } else {
                format!("任务运行失败，Codex 退出码为 {exit_text}。\n\n{summary}")
            };
            if let Ok(message) = messages::append(
                &state.db,
                &session.id,
                AppendSessionMessageRequest {
                    role: Some("assistant".to_string()),
                    content: Some(content),
                    reply_to_message_id: None,
                },
            ) {
                super::events::publish_message(&state, &updated_session, &message);
                crate::api::notifications::runtime::forward_assistant_message_to_platforms(
                    &state,
                    &updated_session,
                    &message,
                );
            }
        }
        let _ = crate::api::automations::runtime::finish_run_for_session(
            &state,
            &session.id,
            exit_code,
            killed,
        );
        // Mirror TS finishAgentRun: when this session backs a room agent_run, close it out and
        // propagate the resulting task status. This intentionally runs after a failure assistant
        // message is appended so failed room agents still surface a visible reply in the room.
        let finished_room_id = crate::api::rooms::store::finish_agent_run_for_session(
            &state.db,
            &session.id,
            exit_code,
            killed,
        )
        .ok()
        .flatten();
        if status == "done" {
            super::events::publish_done(&state, &updated_session, exit_code);
        } else {
            super::events::publish_error(&state, &updated_session, status);
        }
        publish_task_app_notification(&state, &updated_session, exit_code, killed, status);
        crate::api::sessions::compaction::schedule_auto_compaction(
            state.clone(),
            updated_session.clone(),
            "task-finished",
        );
        state.tasks.remove(&session.id);
        // Session message queue: after a successful, non-stopped task, automatically pop and run
        // the next queued message (mirror TS runQueuedMessageIfIdle). Use a dedicated current-thread
        // runtime because start_runner's future is not Send.
        if status == "done" && !killed {
            spawn_next_queued_message_if_idle(state.clone(), session.id.clone());
        }
        // Chained orchestration: once a room agent run finishes, re-run the room orchestrator so
        // dependent tasks, auto-review and auto-listen follow-ups start automatically (mirror TS
        // orchestrateRoom invoked after finishAgentRun). Fire-and-forget; guarded by the
        // orchestrator's pending/dependency/concurrency checks so it cannot loop indefinitely.
        if let Some(room_id) = finished_room_id {
            let chain_state = state.clone();
            // start_runner's future is not Send, so it cannot be tokio::spawn'd. Run the chained
            // orchestration on a dedicated thread with its own current-thread runtime (block_on does
            // not require the future to be Send). Fire-and-forget.
            std::thread::spawn(move || {
                if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    runtime.block_on(async move {
                        let _ = crate::api::rooms::orchestrate_room_runtime(
                            chain_state,
                            room_id.clone(),
                            if status == "done" {
                                "agent.completed"
                            } else if status == "stopped" {
                                "agent.stopped"
                            } else {
                                "agent.failed"
                            },
                        )
                        .await;
                    });
                }
            });
        }
    });
    Ok(())
}

async fn stream_lines<R>(
    reader: R,
    log_path: PathBuf,
    session_state: Option<(AppState, SessionSummary)>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = append_log(&log_path, &(line.clone() + "\n")).await;
        if let Some((state, session)) = session_state.as_ref() {
            if let Ok(meta) = tokio::fs::metadata(&log_path).await {
                super::events::publish_output(state, &session.id, meta.len() as usize);
            }
        }
        if let Some((state, session)) = session_state.as_ref() {
            if let Some(thread_id) = extract_codex_thread_id(&line) {
                let _ = session_store::update_runtime(
                    &state.db,
                    &session.id,
                    SessionRuntimeUpdate {
                        codex_session_id: Some(Some(thread_id)),
                        ..Default::default()
                    },
                );
            }
            if let Some(text) = extract_assistant_message(&line) {
                if let Ok(message) = messages::append(
                    &state.db,
                    &session.id,
                    AppendSessionMessageRequest {
                        role: Some("assistant".to_string()),
                        content: Some(text),
                        reply_to_message_id: None,
                    },
                ) {
                    ingest_assistant_artifacts(state, session, &message);
                    super::events::publish_message(state, session, &message);
                    crate::api::notifications::runtime::forward_assistant_message_to_platforms(
                        state, session, &message,
                    );
                }
            }
        }
    }
}

fn codex_exec_permission_args(
    command: &str,
    cwd: &Path,
    runtime: &CodexRuntimeSettings,
) -> Vec<String> {
    let mut args = vec!["--skip-git-repo-check".to_string()];
    if runtime.bypass_sandbox {
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        if command == "exec" {
            args.push("-C".to_string());
            args.push(cwd.display().to_string());
        }
        return args;
    }
    if command == "exec" {
        args.push("--sandbox".to_string());
        args.push(runtime.sandbox_mode.clone());
        args.push("-C".to_string());
        args.push(cwd.display().to_string());
        if runtime.sandbox_mode != "read-only" {
            args.push("--add-dir".to_string());
            args.push(cwd.display().to_string());
        }
    }
    args
}

fn codex_args(
    session: &SessionSummary,
    prompt: &str,
    provider: Option<&ProviderRecord>,
    model: Option<&str>,
    use_resume: bool,
    local_api_base: &str,
    cwd: &Path,
    runtime: &CodexRuntimeSettings,
) -> Vec<String> {
    fn toml_string(value: &str) -> String {
        serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
    }
    let mut args = if use_resume {
        vec![
            "exec".to_string(),
            "resume".to_string(),
            "--json".to_string(),
        ]
    } else {
        vec!["exec".to_string(), "--json".to_string()]
    };
    args.extend(codex_exec_permission_args(
        if use_resume { "resume" } else { "exec" },
        cwd,
        runtime,
    ));
    // Provider config mirrors TS codexProviderConfigArgs: a single synthetic "codexweb" provider
    // whose base_url points at the LOCAL proxy for chat-completions (and proxied responses)
    // providers — codex only speaks the Responses API, so chat providers must be converted by the
    // /api/providers/:id/proxy/responses endpoint. Without this, codex hits the real chat endpoint
    // with Responses payloads and the surfaced error references the wrong/default provider.
    if let Some(provider) = provider {
        if let Some(real_base_url) = provider
            .summary
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let kind = provider.summary.kind.as_str();
            let uses_local_proxy = kind == "openai-compatible-chat"
                || (kind == "openai-responses" && provider.summary.use_proxy);
            let key = "codexweb";
            let base_url = if uses_local_proxy {
                format!(
                    "{}/api/providers/{}/proxy",
                    local_api_base.trim_end_matches('/'),
                    provider.summary.id
                )
            } else {
                real_base_url.to_string()
            };
            args.push("-c".to_string());
            args.push(format!("model_provider={}", toml_string(key)));
            args.push("-c".to_string());
            args.push(format!(
                "model_providers.{key}.name={}",
                toml_string(if provider.summary.name.is_empty() {
                    "Codex Web Provider"
                } else {
                    &provider.summary.name
                })
            ));
            args.push("-c".to_string());
            args.push(format!(
                "model_providers.{key}.base_url={}",
                toml_string(&base_url)
            ));
            args.push("-c".to_string());
            args.push(format!("model_providers.{key}.requires_openai_auth=true"));
            args.push("-c".to_string());
            args.push(format!(
                "model_providers.{key}.wire_api={}",
                toml_string("responses")
            ));
            if uses_local_proxy {
                args.push("-c".to_string());
                args.push(format!(
                    "model_providers.{key}.experimental_bearer_token={}",
                    toml_string("codex-web-proxy")
                ));
            } else if let Some(api_key) = provider
                .api_key
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                args.push("-c".to_string());
                args.push(format!(
                    "model_providers.{key}.experimental_bearer_token={}",
                    toml_string(api_key)
                ));
            }
        }
    }
    if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(model.to_string());
    }
    if use_resume {
        if let Some(thread_id) = session.codex_session_id.as_ref() {
            args.push(thread_id.clone());
        }
    } else {
        args.push("--".to_string());
    }
    args.push(prompt.to_string());
    args
}

fn select_provider(
    state: &AppState,
    provider_id: Option<&str>,
) -> anyhow::Result<Option<ProviderRecord>> {
    if let Some(provider_id) = provider_id.filter(|value| !value.trim().is_empty()) {
        return provider_store::get_provider_record(&state.db, provider_id);
    }
    Ok(provider_store::list_provider_records(&state.db)?
        .into_iter()
        .next())
}

fn select_model(provider: Option<&ProviderRecord>, model: Option<&str>) -> Option<String> {
    model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            provider
                .map(|item| item.summary.default_model.clone())
                .filter(|value| !value.is_empty())
        })
}

fn required_prompt(prompt: &str) -> anyhow::Result<String> {
    prompt
        .trim()
        .is_empty()
        .then(|| anyhow::anyhow!("prompt_required"))
        .map_or_else(|| Ok(prompt.trim().to_string()), Err)
}

fn resolve_cwd(value: String) -> anyhow::Result<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("cwd_required");
    }
    if value == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return Ok(PathBuf::from(home));
        }
    }
    Ok(PathBuf::from(value))
}

fn publish_task_app_notification(
    state: &AppState,
    session: &SessionSummary,
    exit_code: Option<i64>,
    stopped: bool,
    status: &str,
) {
    let event_type = if stopped {
        "task_interrupted"
    } else if exit_code == Some(0) {
        "task_completed"
    } else {
        "task_failed"
    };
    let severity = if stopped {
        "warning"
    } else if exit_code == Some(0) {
        "success"
    } else {
        "error"
    };
    let title = if exit_code == Some(0) && !stopped {
        format!("任务完成：{}", session.title)
    } else {
        format!("任务异常：{}", session.title)
    };
    let message = if stopped {
        "任务已被停止。".to_string()
    } else {
        format!(
            "Codex 退出码：{}",
            exit_code
                .map(|v| v.to_string())
                .unwrap_or_else(|| "null".to_string())
        )
    };
    crate::api::notifications::runtime::emit_external_notification(
        state.clone(),
        crate::api::notifications::runtime::NotificationEvent {
            event_type: event_type.to_string(),
            severity: severity.to_string(),
            title,
            message,
            source_type: Some("session".to_string()),
            source_id: Some(session.id.clone()),
            metadata: serde_json::json!({
                "exitCode": exit_code,
                "status": status,
                "workspacePath": session.workspace_path,
                "roomId": session.room_id,
                "notificationScopes": [
                    { "scopeType": "session", "scopeId": session.id }
                ]
            }),
        },
    );
}

fn session_data_path(state: &AppState, session_id: &str) -> PathBuf {
    state.db.data_dir.join("sessions").join(session_id)
}

fn session_logs_path(state: &AppState, session_id: &str) -> PathBuf {
    session_data_path(state, session_id).join("logs")
}

fn session_context_path(state: &AppState, session_id: &str) -> PathBuf {
    session_data_path(state, session_id).join("context")
}

fn task_log_path(state: &AppState, session_id: &str) -> PathBuf {
    session_logs_path(state, session_id).join("codex.log")
}

fn task_meta_path(state: &AppState, session_id: &str) -> PathBuf {
    session_logs_path(state, session_id).join("codex.json")
}

fn prompt_with_managed_context(
    state: &AppState,
    session: &SessionSummary,
    prompt: &str,
    cwd: &Path,
    context_path: &Path,
) -> anyhow::Result<String> {
    let context_root = session_context_path(state, &session.id);
    reset_context_files(&context_root)?;
    let recent = recent_session_context_markdown(state, &session.id)?;
    let transcript = session_transcript_markdown(state, &session.id)?;
    let memory = crate::api::sessions::compaction::latest_memory_markdown(&state.db, &session.id)
        .unwrap_or_default();
    let workspace = workspace_state_markdown(cwd);
    let notification = notification_skill_context(state, session);
    let room_context = session
        .room_id
        .as_deref()
        .map(|room_id| room_blackboard_context(state, room_id, session.direct_agent_id.as_deref()))
        .unwrap_or_default();
    let room_decisions = session
        .room_id
        .as_deref()
        .map(|room_id| room_decisions_markdown(state, room_id))
        .unwrap_or_default();
    let current_request = format!("# Current Request\n\n{}", prompt.trim());
    let summary = [
        "# Context Summary".to_string(),
        format!("- session: {}", session.id),
        format!("- title: {}", session.title),
        format!("- type: {}", session.conversation_type),
        format!("- workspace: {}", cwd.display()),
        session
            .codex_session_id
            .as_ref()
            .map(|id| format!("- codex thread: {id}"))
            .unwrap_or_else(|| "- codex thread: not available yet".to_string()),
        String::new(),
        "## Current Prompt".to_string(),
        truncate_context(prompt, 2400),
        String::new(),
        "## Context Files".to_string(),
        "- context-pack.md: prompt-facing managed context".to_string(),
        "- conversation-transcript.md: longer prior conversation transcript".to_string(),
        "- current-request.md: exact request sent to Codex for this run".to_string(),
    ]
    .join("\n");
    let pack = [
        "# Codex Web Context Pack".to_string(),
        format!("- generated at: {}", crate::api::common::timestamp()),
        format!("- session id: {}", session.id),
        format!("- session type: {}", session.conversation_type),
        format!("- title: {}", session.title),
        format!("- workspace: {}", cwd.display()),
        session
            .project_id
            .as_ref()
            .map(|id| format!("- project id: {id}"))
            .unwrap_or_default(),
        session
            .codex_session_id
            .as_ref()
            .map(|id| format!("- codex thread: {id}"))
            .unwrap_or_else(|| "- codex thread: not available yet".to_string()),
        session
            .room_id
            .as_ref()
            .map(|id| format!("- room id: {id}"))
            .unwrap_or_default(),
        String::new(),
        "## Available Context Files".to_string(),
        "- context-pack.md".to_string(),
        "- summary.md".to_string(),
        "- recent-messages.md".to_string(),
        "- conversation-transcript.md".to_string(),
        if memory.trim().is_empty() {
            String::new()
        } else {
            "- persistent-memory.md".to_string()
        },
        "- workspace-state.md".to_string(),
        "- current-request.md".to_string(),
        if notification.trim().is_empty() {
            String::new()
        } else {
            "- notification-skill.md".to_string()
        },
        if room_context.trim().is_empty() {
            String::new()
        } else {
            "- room-blackboard.md".to_string()
        },
        if session.room_id.is_some() {
            "- decisions.md".to_string()
        } else {
            String::new()
        },
        String::new(),
        memory.clone(),
        String::new(),
        "## Recent Session Messages".to_string(),
        recent.clone(),
        String::new(),
        workspace.clone(),
        String::new(),
        notification.clone(),
        String::new(),
        room_context.clone(),
        String::new(),
        if session.room_id.is_some() {
            room_agent_output_contract()
        } else {
            String::new()
        },
        String::new(),
        "## Current Prompt".to_string(),
        prompt.trim().to_string(),
    ]
    .into_iter()
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    write_context_file(&context_root, "context-pack.md", &pack)?;
    write_context_file(&context_root, "summary.md", &summary)?;
    write_context_file(&context_root, "recent-messages.md", &recent)?;
    write_context_file(&context_root, "conversation-transcript.md", &transcript)?;
    if !memory.trim().is_empty() {
        write_context_file(&context_root, "persistent-memory.md", &memory)?;
    }
    write_context_file(&context_root, "current-request.md", &current_request)?;
    write_context_file(&context_root, "workspace-state.md", &workspace)?;
    if !notification.trim().is_empty() {
        write_context_file(&context_root, "notification-skill.md", &notification)?;
    }
    if !room_context.trim().is_empty() {
        write_context_file(&context_root, "room-blackboard.md", &room_context)?;
    }
    if session.room_id.is_some() {
        write_context_file(&context_root, "decisions.md", &room_decisions)?;
    }
    Ok([
        "Use this Codex Web managed context as authoritative project/session context.".to_string(),
        format!("A copy has been written to: {}", context_path.display()),
        "Do not assume unavailable chat history beyond this pack and any Codex resume state."
            .to_string(),
        String::new(),
        truncate_context(&pack, 60_000),
        String::new(),
        "Now complete the current prompt.".to_string(),
    ]
    .join("\n"))
}

fn reset_context_files(root: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(root)?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

fn write_context_file(root: &Path, name: &str, content: &str) -> anyhow::Result<()> {
    fs::create_dir_all(root)?;
    fs::write(root.join(name), content)?;
    Ok(())
}

fn recent_session_context_markdown(state: &AppState, session_id: &str) -> anyhow::Result<String> {
    let page = messages::list(&state.db, session_id, 24, None)?;
    Ok(page
        .items
        .iter()
        .map(message_context_markdown)
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn session_transcript_markdown(state: &AppState, session_id: &str) -> anyhow::Result<String> {
    let page = messages::list(&state.db, session_id, 100, None)?;
    Ok(page
        .items
        .iter()
        .map(message_context_markdown)
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn message_context_markdown(message: &crate::api::sessions::models::SessionMessage) -> String {
    let mut lines = vec![
        format!("## {} {}", message.role, message.created_at),
        format!("- id: {}", message.id),
    ];
    if let Some(reply_id) = message.reply_to_message_id.as_deref() {
        lines.push(format!("- replyTo: {reply_id}"));
    }
    lines.push(String::new());
    lines.push(truncate_context(&message.content, 4000));
    lines.join("\n")
}

fn workspace_state_markdown(cwd: &Path) -> String {
    let mut lines = vec![
        "# Workspace State".to_string(),
        format!("- cwd: {}", cwd.display()),
    ];
    if let Ok(entries) = fs::read_dir(cwd) {
        let mut names = entries
            .filter_map(Result::ok)
            .take(60)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect::<Vec<_>>();
        names.sort();
        if !names.is_empty() {
            lines.push(String::new());
            lines.push("## Top-level Entries".to_string());
            lines.extend(names.into_iter().map(|name| format!("- {name}")));
        }
    }
    lines.join("\n")
}

fn notification_skill_context(state: &AppState, session: &SessionSummary) -> String {
    let permission_context = notification_permission_context(state, session);
    let recipients = crate::api::notifications::store::recipients(&state.db)
        .unwrap_or_default()
        .into_iter()
        .filter(|recipient| recipient.enabled)
        .filter(|recipient| {
            notification_permission_allows(&recipient.permissions, &permission_context)
        })
        .collect::<Vec<_>>();
    if recipients.is_empty() {
        return String::new();
    }
    let senders = crate::api::notifications::store::accounts(&state.db)
        .unwrap_or_default()
        .into_iter()
        .filter(|account| account.enabled)
        .filter(|account| notification_permission_allows(&account.permissions, &permission_context))
        .collect::<Vec<_>>();
    let mut scopes = vec![
        format!("- session: current session ({})", session.id),
        "- current_task: the currently running Codex task for this session".to_string(),
    ];
    if let Some(room_task_id) = permission_context.room_task_id.as_deref() {
        scopes.push(format!(
            "- current_room_task: current Room task ({room_task_id})"
        ));
    }
    let mut lines = vec![
        "## Notification Skill".to_string(),
        "You may request a scoped one-time notification.".to_string(),
        "Use this only when the user explicitly asks to be notified or when an existing notification instruction is part of the task.".to_string(),
        "Do not create persistent/global notification rules.".to_string(),
        "Allowed scopes:".to_string(),
    ];
    lines.extend(scopes);
    lines.push("Allowed recipients:".to_string());
    lines.extend(recipients.iter().map(|recipient| {
        format!(
            "- {} ({}) kind={}",
            recipient.name, recipient.id, recipient.kind
        )
    }));
    if !senders.is_empty() {
        lines.push("Available senders:".to_string());
        lines.extend(senders.iter().map(|sender| {
            format!(
                "- {} ({}) kind={}",
                sender.name, sender.id, sender.channel_kind
            )
        }));
    }
    lines.extend([
        String::new(),
        "To create a one-time notification rule, include a fenced JSON block named `codex-web-notification` in your answer.".to_string(),
        "Supported eventTypes: task_completed, task_failed, task_interrupted, needs_approval.".to_string(),
        "Use recipientIds from the allowed list. You may also include senderAccountId for an override.".to_string(),
        "Use scopeType=session, current_task, or current_room_task. Prefer current_room_task inside Room Agent task runs, otherwise use current_task for this run or session for the whole session.".to_string(),
        "Example:".to_string(),
        "```codex-web-notification".to_string(),
        serde_json::to_string_pretty(&serde_json::json!({
            "action": "createOneTimeRule",
            "scopeType": if permission_context.room_task_id.is_some() { "current_room_task" } else { "current_task" },
            "eventTypes": ["task_completed"],
            "recipientIds": recipients.iter().take(1).map(|recipient| recipient.id.clone()).collect::<Vec<_>>(),
            "senderAccountId": serde_json::Value::Null,
            "expireMode": "after_trigger",
            "reason": "Notify the user when this task completes."
        })).unwrap_or_else(|_| "{}".to_string()),
        "```".to_string(),
    ]);
    lines.join("\n")
}

fn room_blackboard_context(state: &AppState, room_id: &str, agent_id: Option<&str>) -> String {
    let Some(room) = crate::api::rooms::store::get_room(&state.db, room_id)
        .ok()
        .flatten()
    else {
        return String::new();
    };
    let tasks = crate::api::rooms::store::room_tasks(&state.db, room_id, 12).unwrap_or_default();
    let decisions =
        crate::api::rooms::store::list_decisions(&state.db, room_id).unwrap_or_default();
    let artifacts =
        crate::api::rooms::store::list_artifacts(&state.db, room_id).unwrap_or_default();
    let handoffs = crate::api::rooms::store::list_handoffs(&state.db, room_id).unwrap_or_default();
    let events = crate::api::rooms::store::room_events(&state.db, room_id, 12).unwrap_or_default();
    let mut lines = vec![
        "# Room Blackboard".to_string(),
        format!("- room: {}", room.name),
        format!("- room id: {room_id}"),
    ];
    if let Some(project_id) = room.project_id.as_deref() {
        lines.push(format!("- project id: {project_id}"));
    }
    if let Some(agent_id) = agent_id.filter(|value| !value.is_empty()) {
        lines.push(format!("- current agent id: {agent_id}"));
    }
    if let Some(shared) = room
        .shared_context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!(
            "- shared context: {}",
            truncate_context(shared, 1600)
        ));
    }
    lines.push(String::new());
    lines.push("## Active And Recent Tasks".to_string());
    let visible_tasks = tasks
        .iter()
        .filter(|task| task.status != "done")
        .take(12)
        .collect::<Vec<_>>();
    if visible_tasks.is_empty() {
        lines.push("- none".to_string());
    } else {
        lines.extend(visible_tasks.into_iter().map(|task| {
            format!(
                "- [{}] {} ({}){}: {}",
                task.status,
                task.title,
                task.id,
                task.assigned_agent_id
                    .as_ref()
                    .map(|id| format!(" -> {id}"))
                    .unwrap_or_default(),
                truncate_context(&task.prompt, 420)
            )
        }));
    }
    lines.push(String::new());
    lines.push("## Decisions".to_string());
    let active_decisions = decisions
        .iter()
        .filter(|decision| matches!(decision.status.as_str(), "open" | "approved"))
        .take(8)
        .collect::<Vec<_>>();
    if active_decisions.is_empty() {
        lines.push("- none".to_string());
    } else {
        lines.extend(active_decisions.into_iter().map(|decision| {
            format!(
                "- [{}] {}: {}",
                decision.status,
                decision.title,
                compact_json(&decision.payload, 600)
            )
        }));
    }
    lines.push(String::new());
    lines.push("## Recent Artifacts".to_string());
    if artifacts.is_empty() {
        lines.push("- none".to_string());
    } else {
        lines.extend(artifacts.iter().take(8).map(|artifact| {
            format!(
                "- {}: {}{}: {}",
                artifact.kind,
                artifact.title,
                artifact
                    .agent_id
                    .as_ref()
                    .map(|id| format!(" by {id}"))
                    .unwrap_or_default(),
                compact_json(&artifact.payload, 600)
            )
        }));
    }
    lines.push(String::new());
    lines.push("## Recent Handoffs".to_string());
    let active_handoffs = handoffs
        .iter()
        .filter(|handoff| matches!(handoff.status.as_str(), "open" | "accepted" | "returned"))
        .take(8)
        .collect::<Vec<_>>();
    if active_handoffs.is_empty() {
        lines.push("- none".to_string());
    } else {
        lines.extend(active_handoffs.into_iter().map(|handoff| {
            format!(
                "- [{}] {} -> {}: {}",
                handoff.status,
                handoff.from_agent_id.as_deref().unwrap_or("system"),
                handoff.to_agent_id.as_deref().unwrap_or("room"),
                truncate_context(&handoff.summary, 420)
            )
        }));
    }
    lines.push(String::new());
    lines.push("## Recent Room Events".to_string());
    if events.is_empty() {
        lines.push("- none".to_string());
    } else {
        lines.extend(events.iter().take(12).map(|event| {
            format!(
                "- {} {}{}: {}",
                event.created_at,
                event.r#type,
                event
                    .source_agent_id
                    .as_ref()
                    .map(|id| format!(" by {id}"))
                    .unwrap_or_default(),
                compact_json(&event.payload, 500)
            )
        }));
    }
    lines.join("\n")
}

fn room_decisions_markdown(state: &AppState, room_id: &str) -> String {
    let decisions =
        crate::api::rooms::store::list_decisions(&state.db, room_id).unwrap_or_default();
    let active = decisions
        .iter()
        .filter(|decision| matches!(decision.status.as_str(), "open" | "approved"))
        .take(24)
        .collect::<Vec<_>>();
    if active.is_empty() {
        return "# Room Decisions\n\nNo active decisions recorded.".to_string();
    }
    let mut lines = vec!["# Room Decisions".to_string()];
    for decision in active {
        lines.push(String::new());
        lines.push(format!("## {}", decision.title));
        lines.push(format!("- status: {}", decision.status));
        lines.push(format!("- created: {}", decision.created_at));
        if let Some(resolved) = decision.resolved_at.as_deref() {
            lines.push(format!("- resolved: {resolved}"));
        }
        lines.push(String::new());
        lines.push(compact_json(&decision.payload, 1200));
    }
    lines.join("\n")
}

fn room_agent_output_contract() -> String {
    [
        "Room collaboration output contract:",
        "- Write the normal assistant answer first.",
        "- When useful, also include a fenced JSON block named `codex-web-room-update`.",
        "- Use only valid JSON in that block.",
        "- Supported keys: summary, completed, risks, questions, handoff, artifacts, decisions, suggestedTasks.",
        "- Keep suggestedTasks concrete and assignable.",
        "- Suggested development tasks are queued automatically; do not ask the user to confirm normal Git-trackable coding work.",
        "- Treat user approval as reserved for non-Git-tracked, external, privileged, or irreversible actions.",
    ]
    .join("\n")
}

fn compact_json(value: &serde_json::Value, limit: usize) -> String {
    truncate_context(
        &serde_json::to_string(value).unwrap_or_else(|_| String::new()),
        limit,
    )
}

fn truncate_context(value: &str, limit: usize) -> String {
    let text = value.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let prefix = text.chars().take(limit).collect::<String>();
    format!("{prefix}\n[truncated]")
}

async fn append_log(path: &Path, content: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(content.as_bytes()).await?;
    Ok(())
}

async fn write_meta(path: &Path, exit_code: Option<i64>, status: &str) -> anyhow::Result<()> {
    let value = serde_json::json!({
        "exitCode": exit_code,
        "status": status,
        "updatedAt": crate::api::common::timestamp(),
    });
    tokio::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&value)?)).await?;
    Ok(())
}

fn task_error_summary(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            !line.starts_with("{\"type\":\"item.completed\",\"item\":{\"id\":")
                && !line.starts_with("{\"type\":\"turn.completed\"")
        })
        .rev()
        .take(16)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(2000)
        .collect()
}

fn extract_codex_thread_id(line: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    if value.get("type").and_then(|item| item.as_str()) == Some("thread.started") {
        return value
            .get("thread_id")
            .and_then(|item| item.as_str())
            .map(ToOwned::to_owned);
    }
    None
}

fn extract_assistant_message(line: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let item = value.get("item")?;
    if item.get("type").and_then(|item| item.as_str()) != Some("agent_message") {
        return None;
    }
    item.get("text")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn ingest_assistant_artifacts(
    state: &AppState,
    session: &SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    ingest_cross_session_skill_blocks(state, session, message);
    ingest_notification_skill_blocks(state, session, message);
    ingest_room_artifact_blocks(state, session, message);
    ingest_room_update_blocks(state, session, message);
}

fn ingest_cross_session_skill_blocks(
    state: &AppState,
    session: &SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    for request in parse_fenced_json_blocks(&message.content, "codex-web-cross-session") {
        let action = request
            .get("action")
            .or_else(|| request.get("type"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("readSession");
        if action == "listSessions" {
            let sessions = list_cross_session_targets(state, &session.id);
            let result = cross_session_list_markdown(&sessions);
            let _ = append_session_message_card(
                &state.db,
                &session.id,
                Some(&message.id),
                "service",
                "Cross-session sessions listed",
                &serde_json::json!({
                    "action": action,
                    "sessions": sessions,
                    "messageId": message.id
                }),
            );
            enqueue_cross_session_followup(state, session, result);
            continue;
        }
        let Some(target) = resolve_cross_session_target(state, session, &request) else {
            let _ = append_session_message_card(
                &state.db,
                &session.id,
                Some(&message.id),
                "service",
                "Cross-session target not found",
                &serde_json::json!({
                    "action": action,
                    "request": request,
                    "messageId": message.id
                }),
            );
            continue;
        };
        if matches!(action, "readSession" | "readProgress" | "getProgress") {
            let result = cross_session_progress_markdown(state, &target);
            let _ = append_session_message_card(
                &state.db,
                &session.id,
                Some(&message.id),
                "service",
                &format!("Cross-session read: {}", target.title),
                &serde_json::json!({
                    "action": action,
                    "targetSessionId": target.id,
                    "result": result,
                    "messageId": message.id
                }),
            );
            if let Ok(system_message) = messages::append(
                &state.db,
                &session.id,
                AppendSessionMessageRequest {
                    role: Some("system".to_string()),
                    content: Some(format!(
                        "Cross-session read result for {} ({}):\n\n{}",
                        target.title, target.id, result
                    )),
                    reply_to_message_id: None,
                },
            ) {
                super::events::publish_message(state, session, &system_message);
            }
            enqueue_cross_session_followup(state, session, result);
            continue;
        }
        if matches!(action, "sendMessage" | "messageSession") {
            let outgoing = request
                .get("message")
                .or_else(|| request.get("content"))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            match send_cross_session_message(state, session, &target, outgoing) {
                Ok(result) => {
                    let _ = append_session_message_card(
                        &state.db,
                        &session.id,
                        Some(&message.id),
                        "service",
                        &format!("Cross-session message sent: {}", target.title),
                        &serde_json::json!({
                            "action": action,
                            "targetSessionId": target.id,
                            "result": result,
                            "message": truncate_context(request.get("message").or_else(|| request.get("content")).and_then(|value| value.as_str()).unwrap_or(""), 2000),
                            "messageId": message.id
                        }),
                    );
                }
                Err(error) => {
                    let _ = append_session_message_card(
                        &state.db,
                        &session.id,
                        Some(&message.id),
                        "service",
                        "Cross-session message failed",
                        &serde_json::json!({
                            "action": action,
                            "targetSessionId": target.id,
                            "error": error.to_string(),
                            "messageId": message.id
                        }),
                    );
                }
            }
        }
    }
}

fn ingest_room_artifact_blocks(
    state: &AppState,
    session: &SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    let Some(room_id) = session.room_id.as_deref() else {
        return;
    };
    let source_agent_id = session.direct_agent_id.as_deref();
    let mut changed = false;
    for artifact in
        parse_fenced_json_blocks_multi(&message.content, &["codex-web-artifact", "artifact"])
    {
        let raw_kind = artifact
            .get("kind")
            .or_else(|| artifact.get("type"))
            .and_then(|value| value.as_str())
            .unwrap_or("report");
        let kind = if matches!(
            raw_kind,
            "report"
                | "file-change"
                | "preview"
                | "link"
                | "approval"
                | "task"
                | "decision"
                | "handoff"
        ) {
            raw_kind
        } else {
            "report"
        };
        let title = artifact
            .get("title")
            .or_else(|| artifact.get("name"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_context(value, 160))
            .unwrap_or_else(|| "Agent artifact".to_string());
        let payload = artifact
            .get("payload")
            .or_else(|| artifact.get("data"))
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Object(artifact.clone()));
        let Ok(record) = crate::api::rooms::store::create_artifact(
            &state.db,
            room_id,
            crate::api::rooms::models::CreateRoomArtifactRequest {
                agent_id: source_agent_id.map(ToOwned::to_owned),
                kind: Some(kind.to_string()),
                title: Some(title.clone()),
                payload: Some(payload.clone()),
            },
        ) else {
            continue;
        };
        changed = true;
        let _ = append_session_message_card(
            &state.db,
            &session.id,
            Some(&message.id),
            "artifact",
            &title,
            &serde_json::json!({
                "artifactId": record.id,
                "roomId": room_id,
                "kind": kind,
                "payload": payload
            }),
        );
    }
    if changed {
        crate::api::rooms::events::publish_activity(state, room_id);
    }
}

fn ingest_notification_skill_blocks(
    state: &AppState,
    session: &SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    let context = notification_permission_context(state, session);
    let recipients = crate::api::notifications::store::recipients(&state.db)
        .unwrap_or_default()
        .into_iter()
        .filter(|recipient| recipient.enabled)
        .filter(|recipient| notification_permission_allows(&recipient.permissions, &context))
        .collect::<Vec<_>>();
    if recipients.is_empty() {
        return;
    }
    let accounts = crate::api::notifications::store::accounts(&state.db)
        .unwrap_or_default()
        .into_iter()
        .filter(|account| account.enabled)
        .filter(|account| notification_permission_allows(&account.permissions, &context))
        .collect::<Vec<_>>();
    for request in parse_fenced_json_blocks(&message.content, "codex-web-notification") {
        let action = request
            .get("action")
            .or_else(|| request.get("type"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("");
        if !action.is_empty() && action != "createOneTimeRule" {
            continue;
        }
        let recipient_ids = resolve_notification_recipient_ids(&request, &recipients);
        if recipient_ids.is_empty() {
            continue;
        }
        let sender_account_id = request
            .get("senderAccountId")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(sender_account_id) = sender_account_id {
            if !accounts
                .iter()
                .any(|account| account.id == sender_account_id)
            {
                continue;
            }
        }
        let Some((scope_type, scope_id)) = notification_scope_from_skill(state, session, &request)
        else {
            continue;
        };
        let event_types = notification_event_types_from_skill(request.get("eventTypes"));
        let targets = recipient_ids
            .iter()
            .map(|recipient_id| {
                serde_json::json!({
                    "recipientId": recipient_id,
                    "senderAccountId": sender_account_id
                })
            })
            .collect::<Vec<_>>();
        let targets_value = serde_json::Value::Array(targets);
        if notification_ephemeral_rule_exists(
            state,
            &scope_type,
            &scope_id,
            &event_types,
            &targets_value,
        ) {
            continue;
        }
        let Ok(rule) = crate::api::notifications::store::create_ephemeral_rule(
            &state.db,
            crate::api::notifications::models::UpsertNotificationEphemeralRuleRequest {
                scope_type: Some(scope_type.clone()),
                scope_id: Some(scope_id.clone()),
                event_types: Some(event_types.clone()),
                targets: Some(targets_value),
                expire_mode: Some(notification_expire_mode_from_skill(
                    request.get("expireMode"),
                )),
                enabled: Some(true),
            },
        ) else {
            continue;
        };
        let _ = append_session_message_card(
            &state.db,
            &session.id,
            Some(&message.id),
            "service",
            "Notification rule created",
            &serde_json::json!({
                "notificationEphemeralRuleId": rule.id,
                "messageId": message.id,
                "scope": { "scopeType": scope_type, "scopeId": scope_id },
                "eventTypes": event_types,
                "recipientIds": recipient_ids,
                "reason": request.get("reason").and_then(|value| value.as_str()).map(|value| truncate_context(value, 500)).unwrap_or_default()
            }),
        );
    }
}

fn ingest_room_update_blocks(
    state: &AppState,
    session: &SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    let Some(room_id) = session.room_id.as_deref() else {
        return;
    };
    let source_agent_id = session.direct_agent_id.as_deref();
    let mut changed = false;
    for update in parse_fenced_json_blocks(&message.content, "codex-web-room-update") {
        let summary = update
            .get("summary")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("");
        let completed = string_array(update.get("completed"));
        let risks = string_array(update.get("risks"));
        let questions = string_array(update.get("questions"));
        if !summary.is_empty()
            || !completed.is_empty()
            || !risks.is_empty()
            || !questions.is_empty()
        {
            let title = if summary.is_empty() {
                "Agent structured update".to_string()
            } else {
                format!(
                    "Agent update: {}",
                    truncate_context(summary, 80).replace('\n', " ")
                )
            };
            if let Ok(record) = crate::api::rooms::store::create_artifact(
                &state.db,
                room_id,
                crate::api::rooms::models::CreateRoomArtifactRequest {
                    agent_id: source_agent_id.map(ToOwned::to_owned),
                    kind: Some("report".to_string()),
                    title: Some(title),
                    payload: Some(serde_json::json!({
                        "summary": summary,
                        "completed": completed,
                        "risks": risks,
                        "questions": questions,
                        "messageId": message.id,
                    })),
                },
            ) {
                changed = true;
                let _ = append_session_message_card(
                    &state.db,
                    &session.id,
                    Some(&message.id),
                    "artifact",
                    &record.title,
                    &serde_json::json!({
                        "artifactId": record.id,
                        "roomId": room_id,
                        "kind": record.kind,
                        "payload": record.payload
                    }),
                );
            }
        }
        if let Some(items) = update.get("artifacts").and_then(|value| value.as_array()) {
            for item in items.iter().filter_map(|item| item.as_object()) {
                let title = item
                    .get("title")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| truncate_context(value, 160))
                    .unwrap_or_else(|| "Agent artifact".to_string());
                let raw_kind = item
                    .get("kind")
                    .or_else(|| item.get("type"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("report");
                let kind = if matches!(
                    raw_kind,
                    "report"
                        | "file-change"
                        | "preview"
                        | "link"
                        | "approval"
                        | "task"
                        | "decision"
                        | "handoff"
                ) {
                    raw_kind
                } else {
                    "report"
                };
                let payload = item
                    .get("payload")
                    .or_else(|| item.get("data"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::Value::Object(item.clone()));
                if let Ok(record) = crate::api::rooms::store::create_artifact(
                    &state.db,
                    room_id,
                    crate::api::rooms::models::CreateRoomArtifactRequest {
                        agent_id: source_agent_id.map(ToOwned::to_owned),
                        kind: Some(kind.to_string()),
                        title: Some(title),
                        payload: Some(payload),
                    },
                ) {
                    changed = true;
                    let _ = append_session_message_card(
                        &state.db,
                        &session.id,
                        Some(&message.id),
                        "artifact",
                        &record.title,
                        &serde_json::json!({
                            "artifactId": record.id,
                            "roomId": room_id,
                            "kind": record.kind,
                            "payload": record.payload
                        }),
                    );
                }
            }
        }
        if let Some(items) = update.get("decisions").and_then(|value| value.as_array()) {
            for item in items.iter().filter_map(|item| item.as_object()) {
                let title = item
                    .get("title")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| truncate_context(value, 180));
                let Some(title) = title else { continue };
                let status = match item.get("status").and_then(|value| value.as_str()) {
                    Some("approved" | "rejected" | "resolved") => item
                        .get("status")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                    _ => Some("open".to_string()),
                };
                let payload = item
                    .get("payload")
                    .cloned()
                    .unwrap_or_else(|| serde_json::Value::Object(item.clone()));
                if crate::api::rooms::store::create_decision(
                    &state.db,
                    room_id,
                    crate::api::rooms::models::CreateRoomDecisionRequest {
                        title: Some(title),
                        status,
                        payload: Some(payload),
                    },
                )
                .is_ok()
                {
                    changed = true;
                }
            }
        }
        if let Some(handoff) = update
            .get("handoff")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if crate::api::rooms::store::create_handoff(
                &state.db,
                room_id,
                crate::api::rooms::models::CreateRoomHandoffRequest {
                    from_agent_id: source_agent_id.map(ToOwned::to_owned),
                    to_agent_id: update
                        .get("toAgentId")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                    summary: Some(truncate_context(handoff, 2000)),
                    status: None,
                    payload: Some(serde_json::json!({ "messageId": message.id })),
                },
            )
            .is_ok()
            {
                changed = true;
            }
        }
        if let Some(items) = update
            .get("suggestedTasks")
            .and_then(|value| value.as_array())
        {
            for item in items.iter().filter_map(|item| item.as_object()) {
                let title = item
                    .get("title")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("");
                let prompt = item
                    .get("prompt")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(title);
                if title.is_empty() || prompt.is_empty() {
                    continue;
                }
                if crate::api::rooms::store::create_task(
                    &state.db,
                    room_id,
                    crate::api::rooms::models::CreateRoomTaskRequest {
                        title: Some(title.to_string()),
                        prompt: Some(prompt.to_string()),
                        assigned_agent_id: item
                            .get("assignedAgentId")
                            .and_then(|value| value.as_str())
                            .map(ToOwned::to_owned),
                        priority: item.get("priority").and_then(|value| value.as_i64()),
                        depends_on_task_id: None,
                        scheduled_at: None,
                    },
                )
                .is_ok()
                {
                    changed = true;
                }
            }
        }
    }
    if changed {
        crate::api::rooms::events::publish_activity(state, room_id);
    }
}

struct NotificationPermissionContext {
    agent_id: Option<String>,
    room_id: Option<String>,
    project_id: Option<String>,
    room_task_id: Option<String>,
    task_run_id: Option<String>,
}

fn notification_permission_context(
    state: &AppState,
    session: &SessionSummary,
) -> NotificationPermissionContext {
    let run = latest_agent_run_for_session(state, &session.id);
    NotificationPermissionContext {
        agent_id: run
            .as_ref()
            .and_then(|value| value.get("agent_id"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
            .or_else(|| session.direct_agent_id.clone()),
        room_id: run
            .as_ref()
            .and_then(|value| value.get("room_id"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
            .or_else(|| session.room_id.clone()),
        project_id: session.project_id.clone(),
        room_task_id: run
            .as_ref()
            .and_then(|value| value.get("task_id"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        task_run_id: latest_task_run_id_for_session(state, &session.id),
    }
}

fn list_cross_session_targets(state: &AppState, source_session_id: &str) -> Vec<serde_json::Value> {
    session_store::list_sessions(&state.db, true, true)
        .unwrap_or_default()
        .into_iter()
        .filter(|item| item.id != source_session_id)
        .take(30)
        .map(|item| {
            serde_json::json!({
                "id": item.id,
                "title": item.title,
                "status": item.status,
                "type": item.conversation_type,
                "projectId": item.project_id,
                "updatedAt": item.updated_at
            })
        })
        .collect()
}

fn cross_session_list_markdown(sessions: &[serde_json::Value]) -> String {
    let mut lines = vec!["# Cross-Session Sessions".to_string()];
    lines.extend(sessions.iter().map(|item| {
        format!(
            "- {} ({}) status={} type={} updated={}",
            item.get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("Untitled"),
            item.get("id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            item.get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown"),
            item.get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("codex"),
            item.get("updatedAt")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        )
    }));
    lines.join("\n")
}

fn resolve_cross_session_target(
    state: &AppState,
    source_session: &SessionSummary,
    input: &serde_json::Map<String, serde_json::Value>,
) -> Option<SessionSummary> {
    let sessions = session_store::list_sessions(&state.db, true, true).ok()?;
    let target_session_id = input
        .get("targetSessionId")
        .or_else(|| input.get("sessionId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(target_session_id) = target_session_id {
        if let Some(exact) = sessions
            .iter()
            .find(|item| item.id == target_session_id && item.id != source_session.id)
        {
            return Some(exact.clone());
        }
    }
    let target_title = input
        .get("targetTitle")
        .or_else(|| input.get("title"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_lowercase();
    sessions
        .into_iter()
        .filter(|item| item.id != source_session.id)
        .filter(|item| {
            let title = item.title.to_lowercase();
            title == target_title || title.contains(&target_title)
        })
        .max_by(|a, b| a.updated_at.cmp(&b.updated_at))
}

fn cross_session_progress_markdown(state: &AppState, target: &SessionSummary) -> String {
    let latest_run = latest_task_run_summary_for_session(state, &target.id);
    let memory = crate::api::sessions::compaction::latest_memory_markdown(&state.db, &target.id)
        .unwrap_or_default();
    let messages = messages::list(&state.db, &target.id, 8, None)
        .map(|page| page.items)
        .unwrap_or_default()
        .into_iter()
        .filter(|message| message.role != "system")
        .collect::<Vec<_>>();
    let mut lines = vec![
        "# Cross-Session Progress".to_string(),
        format!("- session: {}", target.id),
        format!("- title: {}", target.title),
        format!("- type: {}", target.conversation_type),
        format!("- status: {}", target.status),
        format!(
            "- project: {}",
            target.project_id.as_deref().unwrap_or("scratch")
        ),
        format!("- updated: {}", target.updated_at),
        latest_run.unwrap_or_else(|| "- latest run: none".to_string()),
    ];
    if !memory.trim().is_empty() {
        lines.push(String::new());
        lines.push("## Persistent Summary".to_string());
        lines.push(truncate_context(&memory, 6000));
    }
    lines.push(String::new());
    lines.push("## Recent Messages".to_string());
    if messages.is_empty() {
        lines.push("No recent messages.".to_string());
    } else {
        lines.extend(messages.into_iter().map(|message| {
            format!(
                "### {} {}\n{}",
                message.role,
                message.created_at,
                truncate_context(&message.content, 1600)
            )
        }));
    }
    lines.join("\n")
}

fn latest_task_run_summary_for_session(state: &AppState, session_id: &str) -> Option<String> {
    let connection = state.db.open_read_only().ok()??;
    if !table_exists_for_runner(&connection, "task_runs").ok()? {
        return None;
    }
    connection
        .query_row(
            "select status, started_at, ended_at, exit_code from task_runs where session_id = ? order by started_at desc, id desc limit 1",
            [session_id],
            |row| {
                let status: String = row.get(0)?;
                let started: String = row.get(1)?;
                let ended: Option<String> = row.get(2)?;
                let exit_code: Option<i64> = row.get(3)?;
                Ok(format!(
                    "- latest run: {} started={} ended={} exit={}",
                    status,
                    started,
                    ended.unwrap_or_else(|| "running".to_string()),
                    exit_code
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "null".to_string())
                ))
            },
        )
        .optional()
        .ok()
        .flatten()
}

fn send_cross_session_message(
    state: &AppState,
    source_session: &SessionSummary,
    target: &SessionSummary,
    message: String,
) -> anyhow::Result<serde_json::Value> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        anyhow::bail!("cross_session_message_required");
    }
    let content = format!(
        "Cross-session message from \"{}\" ({}):\n\n{}",
        source_session.title, source_session.id, trimmed
    );
    if state.tasks.get(&target.id).is_some() || target.status == "running" {
        let queued = super::super::sessions::queue::enqueue(
            &state.db,
            target,
            super::super::sessions::models::QueueMessageRequest {
                prompt: content,
                provider_id: target.provider_id.clone(),
                model: target.model.clone(),
                reply_to_message_id: None,
            },
        )?;
        super::events::publish_queue(state, target);
        return Ok(serde_json::json!({ "mode": "queued", "queuedId": queued.id }));
    }
    let state_for_run = state.clone();
    let target_id = target.id.clone();
    let provider_id = target.provider_id.clone();
    let model = target.model.clone();
    std::thread::spawn(move || {
        if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            let _ = runtime.block_on(continue_task(
                state_for_run,
                target_id,
                ContinueCodexTaskRequest {
                    prompt: content,
                    provider_id,
                    model,
                    reply_to_message_id: None,
                    attachments: None,
                },
            ));
        }
    });
    Ok(serde_json::json!({ "mode": "started" }))
}

fn enqueue_cross_session_followup(state: &AppState, session: &SessionSummary, result: String) {
    if state.tasks.get(&session.id).is_none() && session.status != "running" {
        return;
    }
    let prompt = [
        "A controlled cross-session capability returned the following result.",
        "Use it to answer the user's original request directly.",
        "Do not emit another codex-web-cross-session block unless the user asks for another target or the result is insufficient.",
        "",
        result.as_str(),
    ]
    .join("\n");
    let Ok(item) = super::super::sessions::queue::enqueue(
        &state.db,
        session,
        super::super::sessions::models::QueueMessageRequest {
            prompt,
            provider_id: session.provider_id.clone(),
            model: session.model.clone(),
            reply_to_message_id: None,
        },
    ) else {
        return;
    };
    let _ = item;
    super::events::publish_queue(state, session);
}

fn notification_permission_allows(
    policy: &serde_json::Value,
    context: &NotificationPermissionContext,
) -> bool {
    permission_list_allows(policy.get("allowedAgentIds"), context.agent_id.as_deref())
        && permission_list_allows(policy.get("allowedRoomIds"), context.room_id.as_deref())
        && permission_list_allows(
            policy.get("allowedProjectIds"),
            context.project_id.as_deref(),
        )
}

fn permission_list_allows(value: Option<&serde_json::Value>, current: Option<&str>) -> bool {
    let Some(items) = value.and_then(|value| value.as_array()) else {
        return true;
    };
    if items.is_empty() {
        return true;
    }
    let Some(current) = current else { return false };
    items.iter().any(|item| item.as_str() == Some(current))
}

fn resolve_notification_recipient_ids(
    input: &serde_json::Map<String, serde_json::Value>,
    recipients: &[crate::api::notifications::models::NotificationRecipientSummary],
) -> Vec<String> {
    let mut raw = Vec::new();
    for key in ["recipientIds", "recipients", "recipientNames"] {
        raw.extend(string_array(input.get(key)));
    }
    let mut ids = Vec::new();
    for value in raw {
        let matched = recipients.iter().find(|recipient| {
            recipient.id == value || recipient.name.eq_ignore_ascii_case(value.as_str())
        });
        if let Some(recipient) = matched {
            if !ids.contains(&recipient.id) {
                ids.push(recipient.id.clone());
            }
        }
    }
    ids
}

fn notification_event_types_from_skill(value: Option<&serde_json::Value>) -> Vec<String> {
    let allowed = [
        "task_completed",
        "task_failed",
        "task_interrupted",
        "needs_approval",
    ];
    let selected = string_array(value)
        .into_iter()
        .filter(|item| allowed.contains(&item.as_str()))
        .collect::<Vec<_>>();
    if selected.is_empty() {
        vec!["task_completed".to_string()]
    } else {
        selected
    }
}

fn notification_expire_mode_from_skill(value: Option<&serde_json::Value>) -> String {
    match value.and_then(|value| value.as_str()) {
        Some(mode @ ("session_end" | "manual")) => mode.to_string(),
        _ => "after_trigger".to_string(),
    }
}

fn notification_scope_from_skill(
    state: &AppState,
    session: &SessionSummary,
    input: &serde_json::Map<String, serde_json::Value>,
) -> Option<(String, String)> {
    let context = notification_permission_context(state, session);
    let scope_type = input
        .get("scopeType")
        .or_else(|| input.get("scope"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("session");
    let explicit_scope_id = input
        .get("scopeId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match scope_type {
        "session" | "current_session" => {
            if explicit_scope_id.is_some_and(|value| value != session.id) {
                return None;
            }
            Some(("session".to_string(), session.id.clone()))
        }
        "task" | "current_task" => {
            let scope_id = context
                .task_run_id
                .clone()
                .unwrap_or_else(|| session.id.clone());
            if explicit_scope_id.is_some_and(|value| value != scope_id) {
                return None;
            }
            Some((
                if context.task_run_id.is_some() {
                    "task"
                } else {
                    "session"
                }
                .to_string(),
                scope_id,
            ))
        }
        "room_task" | "current_room_task" => {
            let scope_id = context
                .room_task_id
                .clone()
                .unwrap_or_else(|| session.id.clone());
            if explicit_scope_id.is_some_and(|value| value != scope_id) {
                return None;
            }
            Some((
                if context.room_task_id.is_some() {
                    "room_task"
                } else {
                    "session"
                }
                .to_string(),
                scope_id,
            ))
        }
        _ => None,
    }
}

fn latest_agent_run_for_session(
    state: &AppState,
    session_id: &str,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let connection = state.db.open_read_only().ok()??;
    if !table_exists_for_runner(&connection, "agent_runs").ok()? {
        return None;
    }
    connection
        .query_row(
            "select id, room_id, task_id, agent_id from agent_runs where session_id = ? order by started_at desc, id desc limit 1",
            [session_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "room_id": row.get::<_, String>(1)?,
                    "task_id": row.get::<_, Option<String>>(2)?,
                    "agent_id": row.get::<_, String>(3)?
                })
                .as_object()
                .cloned()
                .unwrap_or_default())
            },
        )
        .ok()
}

fn latest_task_run_id_for_session(state: &AppState, session_id: &str) -> Option<String> {
    let connection = state.db.open_read_only().ok()??;
    if !table_exists_for_runner(&connection, "task_runs").ok()? {
        return None;
    }
    connection
        .query_row(
            "select id from task_runs where session_id = ? and status = 'running' order by started_at desc, id desc limit 1",
            [session_id],
            |row| row.get(0),
        )
        .ok()
}

fn notification_ephemeral_rule_exists(
    state: &AppState,
    scope_type: &str,
    scope_id: &str,
    event_types: &[String],
    targets: &serde_json::Value,
) -> bool {
    let Ok(Some(connection)) = state.db.open_read_only() else {
        return false;
    };
    if !table_exists_for_runner(&connection, "notification_ephemeral_rules").unwrap_or(false) {
        return false;
    }
    let event_types_text = serde_json::to_string(event_types).unwrap_or_else(|_| "[]".to_string());
    let targets_text = serde_json::to_string(targets).unwrap_or_else(|_| "[]".to_string());
    connection
        .query_row(
            "select 1 from notification_ephemeral_rules where scope_type = ? and scope_id = ? and event_types = ? and targets = ? and enabled = 1 limit 1",
            rusqlite::params![scope_type, scope_id, event_types_text, targets_text],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn append_session_message_card(
    db: &crate::db::Db,
    session_id: &str,
    message_id: Option<&str>,
    card_type: &str,
    title: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
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
    connection.execute(
        "insert into message_cards (id, session_id, message_id, type, title, payload, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            format!("card-{}", runner_random_hex(16)),
            session_id,
            message_id,
            card_type,
            title,
            serde_json::to_string(payload)?,
            crate::api::common::timestamp()
        ],
    )?;
    Ok(())
}

fn runner_random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn table_exists_for_runner(
    connection: &rusqlite::Connection,
    table: &str,
) -> rusqlite::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn parse_fenced_json_blocks(
    text: &str,
    fence: &str,
) -> Vec<serde_json::Map<String, serde_json::Value>> {
    let marker = format!("```{fence}");
    let mut remaining = text;
    let mut results = Vec::new();
    while let Some(start) = remaining.to_lowercase().find(&marker.to_lowercase()) {
        let after_marker = &remaining[start + marker.len()..];
        let Some(end) = after_marker.find("```") else {
            break;
        };
        let block = after_marker[..end].trim();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(block) {
            match value {
                serde_json::Value::Array(items) => {
                    results.extend(
                        items
                            .into_iter()
                            .filter_map(|item| item.as_object().cloned()),
                    );
                }
                serde_json::Value::Object(object) => results.push(object),
                _ => {}
            }
        }
        remaining = &after_marker[end + 3..];
    }
    results
}

fn parse_fenced_json_blocks_multi(
    text: &str,
    fences: &[&str],
) -> Vec<serde_json::Map<String, serde_json::Value>> {
    fences
        .iter()
        .flat_map(|fence| parse_fenced_json_blocks(text, fence))
        .collect()
}

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::trim))
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn prompt_hash(prompt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prompt.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn redact_args(args: &mut [String], prompt: &str) -> Vec<String> {
    args.iter()
        .map(|arg| {
            if arg == prompt {
                "[prompt omitted]".to_string()
            } else if let Some(prefix) = arg
                .split_once("experimental_bearer_token=")
                .map(|(head, _)| head)
            {
                shell_quote(&format!("{prefix}experimental_bearer_token=***"))
            } else {
                shell_quote(arg)
            }
        })
        .collect()
}

fn shell_quote(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"<arg>\"".to_string())
}
