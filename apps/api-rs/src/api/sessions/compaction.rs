use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    api::providers::{models::ProviderRecord, store as provider_store},
    api::sessions::{messages as session_messages, models::SessionSummary, store as session_store},
    api::settings::load_session_compaction,
    api::usage::{self, CodexUsage},
    db::Db,
    state::AppState,
};

// Port of apps/api/src/sessions/compaction.ts.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompactionSummary {
    pub id: String,
    pub session_id: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub source_message_start_id: Option<String>,
    pub source_message_end_id: Option<String>,
    pub source_message_count: i64,
    pub source_chars: i64,
    pub prompt_hash: String,
    pub file_path: String,
    pub supersedes_id: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompactionResponse {
    pub compaction: SessionCompactionSummary,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompactionGetResponse {
    pub compaction: Option<SessionCompactionSummary>,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompactionListResponse {
    pub session_id: String,
    pub items: Vec<SessionCompactionSummary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionCompactionRequest {
    pub provider_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionCompactionRequest {
    pub summary: Option<String>,
}

struct MessageRow {
    id: String,
    role: String,
    content: String,
    reply_to_message_id: Option<String>,
    created_at: String,
}

struct GeneratedSummary {
    summary: String,
    usage: Option<CodexUsage>,
    raw: serde_json::Value,
}

pub fn get_latest_response(
    db: &Db,
    session_id: &str,
) -> anyhow::Result<SessionCompactionGetResponse> {
    let Some(latest) = latest(db, session_id)? else {
        return Ok(SessionCompactionGetResponse {
            compaction: None,
            summary: String::new(),
        });
    };
    let summary = fs::read_to_string(&latest.file_path).unwrap_or_default();
    Ok(SessionCompactionGetResponse {
        compaction: Some(latest),
        summary,
    })
}

pub fn list_response(
    db: &Db,
    session_id: &str,
    limit: usize,
) -> anyhow::Result<SessionCompactionListResponse> {
    Ok(SessionCompactionListResponse {
        session_id: session_id.to_string(),
        items: list(db, session_id, limit)?,
    })
}

pub fn update_latest(
    db: &Db,
    session: &SessionSummary,
    summary: &str,
) -> anyhow::Result<SessionCompactionResponse> {
    let Some(previous) = latest(db, &session.id)? else {
        anyhow::bail!("session_compaction_not_found");
    };
    let trimmed = summary.trim();
    if trimmed.is_empty() {
        anyhow::bail!("summary_required");
    }
    let id = format!("compaction-{}", random_hex(16));
    let memory_root = session_memory_path(db, &session.id);
    fs::create_dir_all(&memory_root)?;
    let file_path = memory_root.join(format!("{id}.md"));
    fs::write(&file_path, trimmed)?;
    fs::write(memory_root.join("latest-summary.md"), trimmed)?;
    let prompt_hash = hash_prefix(&format!("manual-edit:{trimmed}"));
    insert_compaction(
        db,
        &id,
        &session.id,
        None,
        "manual-edit",
        previous.source_message_start_id.as_deref(),
        previous.source_message_end_id.as_deref(),
        previous.source_message_count,
        previous.source_chars,
        &prompt_hash,
        &file_path.display().to_string(),
        Some(previous.id.as_str()),
    )?;
    let compaction =
        latest(db, &session.id)?.ok_or_else(|| anyhow::anyhow!("session_compaction_not_found"))?;
    Ok(SessionCompactionResponse {
        compaction,
        summary: trimmed.to_string(),
    })
}

pub fn restore(
    db: &Db,
    session: &SessionSummary,
    compaction_id: &str,
) -> anyhow::Result<SessionCompactionResponse> {
    let target = read_by_id(db, &session.id, compaction_id)?
        .ok_or_else(|| anyhow::anyhow!("session_compaction_not_found"))?;
    let summary = fs::read_to_string(&target.file_path)
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if summary.is_empty() {
        anyhow::bail!("summary_missing");
    }
    let previous = latest(db, &session.id)?;
    let id = format!("compaction-{}", random_hex(16));
    let memory_root = session_memory_path(db, &session.id);
    fs::create_dir_all(&memory_root)?;
    let file_path = memory_root.join(format!("{id}.md"));
    fs::write(&file_path, &summary)?;
    fs::write(memory_root.join("latest-summary.md"), &summary)?;
    let prompt_hash = hash_prefix(&format!("manual-restore:{}:{}", target.id, summary));
    insert_compaction(
        db,
        &id,
        &session.id,
        None,
        "manual-restore",
        target.source_message_start_id.as_deref(),
        target.source_message_end_id.as_deref(),
        target.source_message_count,
        target.source_chars,
        &prompt_hash,
        &file_path.display().to_string(),
        previous.as_ref().map(|item| item.id.as_str()),
    )?;
    let compaction =
        latest(db, &session.id)?.ok_or_else(|| anyhow::anyhow!("session_compaction_not_found"))?;
    Ok(SessionCompactionResponse {
        compaction,
        summary,
    })
}

pub async fn create(
    db: &Db,
    session: &SessionSummary,
    body: Option<CreateSessionCompactionRequest>,
) -> anyhow::Result<SessionCompactionResponse> {
    create_with_options(db, session, body, false).await
}

pub fn should_auto_compact_session(db: &Db, session: &SessionSummary) -> anyhow::Result<bool> {
    let settings = load_session_compaction(db)?;
    if !settings.enabled || is_auto_compaction_running(&session.id) {
        return Ok(false);
    }
    let messages = non_system_messages(db, &session.id)?;
    if messages.is_empty() {
        return Ok(false);
    }
    let total_chars = message_chars(&messages);
    if messages.len() < settings.auto_compact_messages as usize
        && total_chars < settings.auto_compact_chars
    {
        return Ok(false);
    }
    let previous = latest(db, &session.id)?;
    let new_messages = messages_after_compaction(messages, previous.as_ref());
    if new_messages.is_empty() {
        return Ok(false);
    }
    if previous.is_none() {
        return Ok(true);
    }
    let new_chars = message_chars(&new_messages);
    Ok(new_messages.len() >= settings.min_new_messages as usize
        || new_chars >= settings.min_new_chars)
}

pub fn schedule_auto_compaction(
    state: AppState,
    session: SessionSummary,
    reason: impl Into<String>,
) {
    if !should_auto_compact_session(&state.db, &session).unwrap_or(false) {
        return;
    }
    if !mark_auto_compaction_running(&session.id) {
        return;
    }
    let session_id = session.id.clone();
    let reason = reason.into();
    std::thread::spawn(move || {
        if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            runtime.block_on(async move {
                let result = create_with_options(&state.db, &session, None, true).await;
                match result {
                    Ok(result) => {
                        let detail = format!(
                            "{reason}; {} new messages",
                            result.compaction.source_message_count
                        );
                        let activity = serde_json::json!({
                            "type": "activity",
                            "kind": "tool",
                            "label": "会话记忆已自动压缩",
                            "detail": detail,
                            "status": "completed",
                            "at": result.compaction.created_at,
                        });
                        let _ = crate::api::tasks::activity::record_activity(
                            &state.db,
                            &session.id,
                            "tool",
                            "会话记忆已自动压缩",
                            activity
                                .get("detail")
                                .and_then(|value| value.as_str())
                                .map(ToOwned::to_owned),
                            Some("completed".to_string()),
                        );
                        crate::api::tasks::events::publish_event(&state, &session.id, activity);
                    }
                    Err(error) => {
                        let detail = error.to_string();
                        let _ = append_compaction_error_output(&state, &session, &detail).await;
                        let _ = crate::api::tasks::activity::record_activity(
                            &state.db,
                            &session.id,
                            "tool",
                            "会话记忆自动压缩失败",
                            Some(detail.clone()),
                            Some("failed".to_string()),
                        );
                    }
                }
            });
        }
        clear_auto_compaction_running(&session_id);
    });
}

async fn create_with_options(
    db: &Db,
    session: &SessionSummary,
    body: Option<CreateSessionCompactionRequest>,
    incremental: bool,
) -> anyhow::Result<SessionCompactionResponse> {
    let all_messages = non_system_messages(db, &session.id)?;
    let previous = latest(db, &session.id)?;
    let previous_summary = if incremental && previous.is_some() {
        latest_memory_markdown(db, &session.id)?
    } else {
        String::new()
    };
    let messages = if incremental {
        messages_after_compaction(all_messages, previous.as_ref())
    } else {
        all_messages
    };
    if messages.is_empty() {
        anyhow::bail!("no_messages_to_compact");
    }
    let requested_provider_id = body.as_ref().and_then(|value| value.provider_id.clone());
    let provider = select_provider(
        db,
        requested_provider_id.as_deref(),
        session.provider_id.as_deref(),
    )?
    .ok_or_else(|| anyhow::anyhow!("provider_required"))?;
    let model = body
        .as_ref()
        .and_then(|value| value.model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| session.model.clone())
        .or_else(|| Some(provider.summary.default_model.clone()).filter(|value| !value.is_empty()))
        .ok_or_else(|| anyhow::anyhow!("model_required"))?;

    let prompt = compaction_prompt(session, &messages, &previous_summary);
    let prompt_hash = hash_prefix(&prompt);
    let generated = generate_summary(&provider, &model, &prompt).await?;
    let summary = generated.summary;

    let id = format!("compaction-{}", random_hex(16));
    let memory_root = session_memory_path(db, &session.id);
    fs::create_dir_all(&memory_root)?;
    let file_path = memory_root.join(format!("{id}.md"));
    fs::write(&file_path, &summary)?;
    fs::write(memory_root.join("latest-summary.md"), &summary)?;
    let source_chars: i64 = messages
        .iter()
        .map(|message| message.content.chars().count() as i64)
        .sum();
    insert_compaction(
        db,
        &id,
        &session.id,
        Some(provider.summary.id.as_str()),
        &model,
        messages.first().map(|message| message.id.as_str()),
        messages.last().map(|message| message.id.as_str()),
        messages.len() as i64,
        source_chars,
        &prompt_hash,
        &file_path.display().to_string(),
        previous.as_ref().map(|item| item.id.as_str()),
    )?;
    let notice = compaction_notice(incremental, messages.len(), source_chars, generated.usage);
    let notice_message = session_messages::append(
        db,
        &session.id,
        crate::api::sessions::models::AppendSessionMessageRequest {
            role: Some("system".to_string()),
            content: Some(notice),
            reply_to_message_id: None,
        },
    )
    .ok();
    if let Some(usage) = generated.usage {
        let _ = usage::record_provider_usage(
            db,
            session,
            Some(provider.summary.id.as_str()),
            Some(provider.summary.name.as_str()),
            Some(&model),
            notice_message.as_ref().map(|message| message.id.as_str()),
            "session_compaction",
            &format!("{id}\n{prompt_hash}"),
            &generated.raw,
            usage,
        );
    }
    let compaction =
        latest(db, &session.id)?.ok_or_else(|| anyhow::anyhow!("session_compaction_not_found"))?;
    Ok(SessionCompactionResponse {
        compaction,
        summary,
    })
}

fn non_system_messages(db: &Db, session_id: &str) -> anyhow::Result<Vec<MessageRow>> {
    Ok(all_messages(db, session_id)?
        .into_iter()
        .filter(|message| message.role != "system")
        .collect())
}

fn messages_after_compaction(
    messages: Vec<MessageRow>,
    compaction: Option<&SessionCompactionSummary>,
) -> Vec<MessageRow> {
    let Some(end_id) = compaction.and_then(|item| item.source_message_end_id.as_deref()) else {
        return messages;
    };
    let Some(index) = messages.iter().position(|message| message.id == end_id) else {
        return messages;
    };
    messages.into_iter().skip(index + 1).collect()
}

fn message_chars(messages: &[MessageRow]) -> i64 {
    messages
        .iter()
        .map(|message| message.content.chars().count() as i64)
        .sum()
}

fn compaction_notice(
    incremental: bool,
    message_count: usize,
    source_chars: i64,
    usage: Option<CodexUsage>,
) -> String {
    let mut lines = vec![
        if incremental {
            "会话记忆已自动压缩。".to_string()
        } else {
            "会话记忆已压缩。".to_string()
        },
        format!("压缩消息：{message_count} 条，字符：{source_chars}。"),
    ];
    if let Some(usage) = usage {
        let mut usage_line = format!(
            "Token：总 {}，输入 {}，输出 {}",
            usage.input_tokens + usage.output_tokens,
            usage.input_tokens,
            usage.output_tokens
        );
        if usage.cached_input_tokens > 0 {
            usage_line.push_str(&format!("，缓存输入 {}", usage.cached_input_tokens));
        }
        if usage.reasoning_output_tokens > 0 {
            usage_line.push_str(&format!("，推理 {}", usage.reasoning_output_tokens));
        }
        usage_line.push('。');
        lines.push(usage_line);
    } else {
        lines.push("Provider 未返回 usage。".to_string());
    }
    lines.join("\n")
}

pub fn latest_memory_markdown(db: &Db, session_id: &str) -> anyhow::Result<String> {
    let Some(latest) = latest(db, session_id)? else {
        return Ok(String::new());
    };
    let summary = fs::read_to_string(&latest.file_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    if summary.is_empty() {
        return Ok(String::new());
    }
    let mut lines = vec![
        "# Persistent Session Memory".to_string(),
        format!("- compaction id: {}", latest.id),
        format!("- created: {}", latest.created_at),
        format!("- source messages: {}", latest.source_message_count),
    ];
    if let Some(provider_id) = latest
        .provider_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- provider: {provider_id}"));
    }
    if let Some(model) = latest.model.as_deref().filter(|value| !value.is_empty()) {
        lines.push(format!("- model: {model}"));
    }
    lines.push(String::new());
    lines.push(summary);
    Ok(lines.join("\n"))
}

fn running_auto_compactions() -> &'static Mutex<HashSet<String>> {
    static RUNNING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_auto_compaction_running(session_id: &str) -> bool {
    running_auto_compactions()
        .lock()
        .map(|items| items.contains(session_id))
        .unwrap_or(false)
}

fn mark_auto_compaction_running(session_id: &str) -> bool {
    running_auto_compactions()
        .lock()
        .map(|mut items| items.insert(session_id.to_string()))
        .unwrap_or(false)
}

fn clear_auto_compaction_running(session_id: &str) {
    if let Ok(mut items) = running_auto_compactions().lock() {
        items.remove(session_id);
    }
}

async fn append_compaction_error_output(
    state: &AppState,
    session: &SessionSummary,
    error: &str,
) -> anyhow::Result<()> {
    let path = state
        .db
        .data_dir
        .join("sessions")
        .join(&session.id)
        .join("logs")
        .join("codex.log");
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(format!("\n[session compaction failed] {error}\n").as_bytes())
        .await?;
    Ok(())
}

// ---- database helpers ----

fn latest(db: &Db, session_id: &str) -> anyhow::Result<Option<SessionCompactionSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "session_compactions")? {
        return Ok(None);
    }
    connection
        .query_row(
            &format!("{SELECT} where session_id = ? order by created_at desc, id desc limit 1"),
            [session_id],
            row_to_summary,
        )
        .optional()
        .map_err(Into::into)
}

fn list(db: &Db, session_id: &str, limit: usize) -> anyhow::Result<Vec<SessionCompactionSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "session_compactions")? {
        return Ok(Vec::new());
    }
    let bounded = limit.clamp(1, 100) as i64;
    let mut statement = connection.prepare(&format!(
        "{SELECT} where session_id = ? order by created_at desc, id desc limit ?"
    ))?;
    let items = statement
        .query_map((session_id, bounded), row_to_summary)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn read_by_id(
    db: &Db,
    session_id: &str,
    compaction_id: &str,
) -> anyhow::Result<Option<SessionCompactionSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "session_compactions")? {
        return Ok(None);
    }
    connection
        .query_row(
            &format!("{SELECT} where session_id = ? and id = ?"),
            (session_id, compaction_id),
            row_to_summary,
        )
        .optional()
        .map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
fn insert_compaction(
    db: &Db,
    id: &str,
    session_id: &str,
    provider_id: Option<&str>,
    model: &str,
    start_id: Option<&str>,
    end_id: Option<&str>,
    source_message_count: i64,
    source_chars: i64,
    prompt_hash: &str,
    file_path: &str,
    supersedes_id: Option<&str>,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = crate::api::common::timestamp();
    connection.execute(
        "insert into session_compactions (
            id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
            source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            id,
            session_id,
            provider_id,
            model,
            start_id,
            end_id,
            source_message_count,
            source_chars,
            prompt_hash,
            file_path,
            supersedes_id,
            now,
        ],
    )?;
    Ok(())
}

const SELECT: &str = "select id, session_id, provider_id, model, source_message_start_id, source_message_end_id, source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at from session_compactions";

fn row_to_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionCompactionSummary> {
    Ok(SessionCompactionSummary {
        id: row.get(0)?,
        session_id: row.get(1)?,
        provider_id: row.get(2)?,
        model: row.get(3)?,
        source_message_start_id: row.get(4)?,
        source_message_end_id: row.get(5)?,
        source_message_count: row.get(6)?,
        source_chars: row.get(7)?,
        prompt_hash: row.get(8)?,
        file_path: row.get(9)?,
        supersedes_id: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn all_messages(db: &Db, session_id: &str) -> anyhow::Result<Vec<MessageRow>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "messages")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select id, role, content, reply_to_message_id, created_at from messages where session_id = ? order by created_at asc, id asc",
    )?;
    let items = statement
        .query_map([session_id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                reply_to_message_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

// ---- summary generation ----

fn select_provider(
    db: &Db,
    requested: Option<&str>,
    session_provider: Option<&str>,
) -> anyhow::Result<Option<ProviderRecord>> {
    if let Some(id) = requested.filter(|value| !value.trim().is_empty()) {
        if let Some(record) = provider_store::get_provider_record(db, id)? {
            return Ok(Some(record));
        }
    }
    if let Some(id) = session_provider.filter(|value| !value.trim().is_empty()) {
        if let Some(record) = provider_store::get_provider_record(db, id)? {
            return Ok(Some(record));
        }
    }
    // First non-local provider with an API key.
    Ok(provider_store::list_provider_records(db)?
        .into_iter()
        .find(|record| {
            record.summary.kind != "local"
                && record
                    .api_key
                    .as_deref()
                    .map(|value| !value.is_empty())
                    .unwrap_or(false)
        }))
}

async fn generate_summary(
    provider: &ProviderRecord,
    model: &str,
    prompt: &str,
) -> anyhow::Result<GeneratedSummary> {
    if provider.summary.kind == "local" {
        anyhow::bail!("provider_compaction_unsupported");
    }
    let api_key = provider
        .api_key
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("api_key_missing"))?;
    let client = reqwest::Client::new();
    if provider.summary.kind == "openai-compatible-chat" {
        let base_url = provider
            .summary
            .base_url
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow::anyhow!("base_url_required"))?;
        let response = client
            .post(join_url(base_url, "/chat/completions"))
            .bearer_auth(api_key)
            .json(&serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": "You summarize software-development conversations into durable session memory." },
                    { "role": "user", "content": prompt },
                ],
                "max_tokens": 1200,
            }))
            .send()
            .await?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!(if text.is_empty() {
                format!("http_{}", status.as_u16())
            } else {
                text
            });
        }
        let payload: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let content = payload
            .get("choices")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("");
        if content.is_empty() {
            anyhow::bail!("empty_compaction_summary");
        }
        return Ok(GeneratedSummary {
            summary: content.to_string(),
            usage: usage::read_provider_usage(&payload),
            raw: payload,
        });
    }
    let base_url = provider
        .summary
        .base_url
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.openai.com/v1");
    let response = client
        .post(join_url(base_url, "/responses"))
        .bearer_auth(api_key)
        .json(&serde_json::json!({ "model": model, "input": prompt, "max_output_tokens": 1600 }))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!(if text.is_empty() {
            format!("http_{}", status.as_u16())
        } else {
            text
        });
    }
    let payload: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let content = response_output_text(&payload);
    if content.is_empty() {
        anyhow::bail!("empty_compaction_summary");
    }
    Ok(GeneratedSummary {
        summary: content,
        usage: usage::read_provider_usage(&payload),
        raw: payload,
    })
}

fn response_output_text(payload: &serde_json::Value) -> String {
    if let Some(text) = payload.get("output_text").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    let Some(output) = payload.get("output").and_then(|value| value.as_array()) else {
        return String::new();
    };
    output
        .iter()
        .map(|item| text_from_response_content(item.get("content")))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn text_from_response_content(value: Option<&serde_json::Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    let Some(items) = value.as_array() else {
        return String::new();
    };
    items
        .iter()
        .map(|item| {
            if let Some(text) = item.as_str() {
                return text.to_string();
            }
            for key in ["text", "input_text", "output_text"] {
                if let Some(text) = item.get(key).and_then(|value| value.as_str()) {
                    return text.to_string();
                }
            }
            String::new()
        })
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn compaction_prompt(
    session: &SessionSummary,
    messages: &[MessageRow],
    previous_summary: &str,
) -> String {
    let transcript = messages
        .iter()
        .map(|message| {
            let mut lines = vec![
                format!("## {} {}", message.role, message.created_at),
                format!("- id: {}", message.id),
            ];
            if let Some(reply) = message.reply_to_message_id.as_deref() {
                lines.push(format!("- replyTo: {reply}"));
            }
            lines.push(String::new());
            lines.push(truncate_context(&message.content, 4000));
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut parts = vec![
        "Create a durable session memory summary for Codex Web.".to_string(),
        "Return Markdown only. Be concise but preserve information needed for future turns.".to_string(),
        String::new(),
        "Required sections:".to_string(),
        "## Stable User Preferences".to_string(),
        "## Decisions".to_string(),
        "## Current Task State".to_string(),
        "## Open Questions".to_string(),
        "## Important Files And References".to_string(),
        "## Risks Or Constraints".to_string(),
        String::new(),
        "Rules:".to_string(),
        "- Preserve concrete decisions, user preferences, task state, blockers, and key file paths.".to_string(),
        "- Do not include generic greetings or low-value chatter.".to_string(),
        "- Do not invent facts not present in the transcript.".to_string(),
        "- Keep the summary bounded; prefer bullets.".to_string(),
    ];
    if !previous_summary.is_empty() {
        parts.push("- Update the previous summary with the new transcript. Return a complete replacement summary, not a delta.".to_string());
    }
    parts.push(String::new());
    parts.push(format!("Session: {} ({})", session.title, session.id));
    parts.push(format!("Type: {}", session.conversation_type));
    parts.push(String::new());
    if !previous_summary.is_empty() {
        parts.push("# Previous Persistent Summary".to_string());
        parts.push(truncate_context(previous_summary, 20_000));
    }
    parts.push("# Transcript".to_string());
    parts.push(truncate_context(&transcript, 80_000));
    parts.join("\n")
}

fn truncate_context(value: &str, limit: usize) -> String {
    let text = value.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let prefix: String = text.chars().take(limit).collect();
    format!("{prefix}\n[truncated]")
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn hash_prefix(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
        .chars()
        .take(16)
        .collect()
}

fn session_memory_path(db: &Db, session_id: &str) -> PathBuf {
    db.data_dir.join("sessions").join(session_id).join("memory")
}

pub fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists session_compactions (
          id text primary key,
          session_id text not null,
          provider_id text,
          model text,
          source_message_start_id text,
          source_message_end_id text,
          source_message_count integer not null default 0,
          source_chars integer not null default 0,
          prompt_hash text not null,
          file_path text not null,
          supersedes_id text,
          created_at text not null
        );
        create index if not exists session_compactions_session_created_idx on session_compactions(session_id, created_at desc, id desc);
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

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// Provided for symmetry / potential reuse by the session store.
#[allow(dead_code)]
pub fn session_exists(db: &Db, session_id: &str) -> bool {
    session_store::get_session(db, session_id)
        .ok()
        .flatten()
        .is_some()
}
