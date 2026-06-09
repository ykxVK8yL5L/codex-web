use rusqlite::OptionalExtension;
use serde::{de::DeserializeOwned, Serialize};

use crate::db::Db;

use super::models::{
    CodexRuntimeSettings, NotificationTestSettings, PreviewAccessSettings, RateLimitSettings,
    SessionCompactionSettings, TokenUsageDisplaySettings, TokenUsageRetentionSettings,
    UpdateCodexRuntimeSettings, UpdateNotificationTestSettings, UpdateSessionCompactionSettings,
    UpdateTokenUsageDisplaySettings, UpdateTokenUsageRetentionSettings,
};

pub fn preview_access(db: &Db) -> anyhow::Result<PreviewAccessSettings> {
    Ok(load_json(db, "preview_access")?
        .map(sanitize_preview_access)
        .unwrap_or_else(default_preview_access))
}

pub fn save_preview_access(
    db: &Db,
    input: PartialPreviewAccessSettings,
) -> anyhow::Result<PreviewAccessSettings> {
    let current = preview_access(db)?;
    let next = sanitize_preview_access(PreviewAccessSettings {
        request_ttl_minutes: input
            .request_ttl_minutes
            .unwrap_or(current.request_ttl_minutes),
        updated_at: crate::api::common::timestamp(),
    });
    save_json(db, "preview_access", &next)?;
    Ok(next)
}

pub fn session_compaction(db: &Db) -> anyhow::Result<SessionCompactionSettings> {
    Ok(load_json(db, "session_compaction")?
        .map(sanitize_session_compaction)
        .unwrap_or_else(default_session_compaction))
}

pub fn save_session_compaction(
    db: &Db,
    input: UpdateSessionCompactionSettings,
) -> anyhow::Result<SessionCompactionSettings> {
    let current = session_compaction(db)?;
    let next = sanitize_session_compaction(SessionCompactionSettings {
        enabled: input.enabled.unwrap_or(current.enabled),
        auto_compact_messages: input
            .auto_compact_messages
            .unwrap_or(current.auto_compact_messages),
        auto_compact_chars: input
            .auto_compact_chars
            .unwrap_or(current.auto_compact_chars),
        min_new_messages: input.min_new_messages.unwrap_or(current.min_new_messages),
        min_new_chars: input.min_new_chars.unwrap_or(current.min_new_chars),
        updated_at: crate::api::common::timestamp(),
    });
    save_json(db, "session_compaction", &next)?;
    Ok(next)
}

pub fn rate_limit(db: &Db) -> anyhow::Result<RateLimitSettings> {
    Ok(load_json(db, "rate_limit")?
        .map(sanitize_rate_limit)
        .unwrap_or_else(default_rate_limit))
}

pub fn save_rate_limit(
    db: &Db,
    input: PartialRateLimitSettings,
) -> anyhow::Result<RateLimitSettings> {
    let current = rate_limit(db)?;
    let next = sanitize_rate_limit(RateLimitSettings {
        enabled: input.enabled.unwrap_or(current.enabled),
        global_per_minute: input.global_per_minute.unwrap_or(current.global_per_minute),
        auth_per_minute: input.auth_per_minute.unwrap_or(current.auth_per_minute),
        preview_access_per_minute: input
            .preview_access_per_minute
            .unwrap_or(current.preview_access_per_minute),
        expensive_per_five_minutes: input
            .expensive_per_five_minutes
            .unwrap_or(current.expensive_per_five_minutes),
        provider_proxy_per_minute: input
            .provider_proxy_per_minute
            .unwrap_or(current.provider_proxy_per_minute),
        provider_proxy_per_hour: input
            .provider_proxy_per_hour
            .unwrap_or(current.provider_proxy_per_hour),
        provider_proxy_max_concurrent: input
            .provider_proxy_max_concurrent
            .unwrap_or(current.provider_proxy_max_concurrent),
        updated_at: crate::api::common::timestamp(),
    });
    save_json(db, "rate_limit", &next)?;
    Ok(next)
}

pub fn token_usage_retention(db: &Db) -> anyhow::Result<TokenUsageRetentionSettings> {
    Ok(load_json(db, "token_usage_retention")?
        .map(sanitize_token_usage_retention)
        .unwrap_or_else(default_token_usage_retention))
}

pub fn save_token_usage_retention(
    db: &Db,
    input: UpdateTokenUsageRetentionSettings,
) -> anyhow::Result<TokenUsageRetentionSettings> {
    let current = token_usage_retention(db)?;
    let next = sanitize_token_usage_retention(TokenUsageRetentionSettings {
        retention_days: input.retention_days.unwrap_or(current.retention_days),
        updated_at: crate::api::common::timestamp(),
    });
    save_json(db, "token_usage_retention", &next)?;
    Ok(next)
}

pub fn token_usage_display(db: &Db) -> anyhow::Result<TokenUsageDisplaySettings> {
    Ok(load_json(db, "token_usage_display")?
        .map(sanitize_token_usage_display)
        .unwrap_or_else(default_token_usage_display))
}

pub fn save_token_usage_display(
    db: &Db,
    input: UpdateTokenUsageDisplaySettings,
) -> anyhow::Result<TokenUsageDisplaySettings> {
    let current = token_usage_display(db)?;
    let next = sanitize_token_usage_display(TokenUsageDisplaySettings {
        show_message_usage: input.show_message_usage.unwrap_or(current.show_message_usage),
        updated_at: crate::api::common::timestamp(),
    });
    save_json(db, "token_usage_display", &next)?;
    Ok(next)
}

pub fn notification_test(db: &Db) -> anyhow::Result<NotificationTestSettings> {
    Ok(load_json(db, "notification_test")?
        .map(sanitize_notification_test)
        .unwrap_or_else(default_notification_test))
}

pub fn save_notification_test(
    db: &Db,
    input: UpdateNotificationTestSettings,
) -> anyhow::Result<NotificationTestSettings> {
    let current = notification_test(db)?;
    let next = sanitize_notification_test(NotificationTestSettings {
        title_zh: input.title_zh.unwrap_or(current.title_zh),
        title_en: input.title_en.unwrap_or(current.title_en),
        message_zh: input.message_zh.unwrap_or(current.message_zh),
        message_en: input.message_en.unwrap_or(current.message_en),
        include_help: input.include_help.unwrap_or(current.include_help),
        updated_at: crate::api::common::timestamp(),
    });
    save_json(db, "notification_test", &next)?;
    Ok(next)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialPreviewAccessSettings {
    pub request_ttl_minutes: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialRateLimitSettings {
    pub enabled: Option<bool>,
    pub global_per_minute: Option<i64>,
    pub auth_per_minute: Option<i64>,
    pub preview_access_per_minute: Option<i64>,
    pub expensive_per_five_minutes: Option<i64>,
    pub provider_proxy_per_minute: Option<i64>,
    pub provider_proxy_per_hour: Option<i64>,
    pub provider_proxy_max_concurrent: Option<i64>,
}

pub fn codex_runtime(db: &Db) -> anyhow::Result<CodexRuntimeSettings> {
    Ok(load_json(db, "codex_runtime")?
        .map(sanitize_codex_runtime)
        .unwrap_or_else(default_codex_runtime))
}

/// Save sanitized codex runtime settings. Mirrors `applyCodexRuntimeSettings` in TS.
pub fn save_codex_runtime(
    db: &Db,
    next: CodexRuntimeSettings,
) -> anyhow::Result<CodexRuntimeSettings> {
    let next = sanitize_codex_runtime(next);
    save_json(db, "codex_runtime", &next)?;
    Ok(next)
}

pub fn merge_codex_runtime(
    current: &CodexRuntimeSettings,
    input: UpdateCodexRuntimeSettings,
) -> CodexRuntimeSettings {
    sanitize_codex_runtime(CodexRuntimeSettings {
        sandbox_mode: input
            .sandbox_mode
            .unwrap_or_else(|| current.sandbox_mode.clone()),
        approval_policy: input
            .approval_policy
            .unwrap_or_else(|| current.approval_policy.clone()),
        bypass_sandbox: input.bypass_sandbox.unwrap_or(current.bypass_sandbox),
        updated_at: crate::api::common::timestamp(),
    })
}

/// Mirrors codexRuntimeRisk in auth/approvals.ts.
pub fn codex_runtime_risk(
    current: &CodexRuntimeSettings,
    next: &CodexRuntimeSettings,
) -> Option<&'static str> {
    if next.bypass_sandbox && !current.bypass_sandbox {
        return Some("critical");
    }
    if next.sandbox_mode == "danger-full-access" && current.sandbox_mode != "danger-full-access" {
        return Some("high");
    }
    None
}

fn default_codex_runtime() -> CodexRuntimeSettings {
    CodexRuntimeSettings {
        sandbox_mode: std::env::var("CODEX_WEB_CODEX_SANDBOX")
            .unwrap_or_else(|_| "workspace-write".to_string()),
        approval_policy: std::env::var("CODEX_WEB_CODEX_APPROVAL")
            .unwrap_or_else(|_| "never".to_string()),
        bypass_sandbox: env_bool("CODEX_WEB_CODEX_BYPASS_SANDBOX", false),
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_codex_runtime(input: CodexRuntimeSettings) -> CodexRuntimeSettings {
    let defaults = default_codex_runtime();
    let sandbox_modes = ["read-only", "workspace-write", "danger-full-access"];
    let approval_policies = ["untrusted", "on-failure", "on-request", "never"];
    CodexRuntimeSettings {
        sandbox_mode: if sandbox_modes.contains(&input.sandbox_mode.as_str()) {
            input.sandbox_mode
        } else {
            defaults.sandbox_mode
        },
        approval_policy: if approval_policies.contains(&input.approval_policy.as_str()) {
            input.approval_policy
        } else {
            defaults.approval_policy
        },
        bypass_sandbox: input.bypass_sandbox,
        updated_at: input.updated_at,
    }
}

pub(crate) fn load_json<T: DeserializeOwned>(db: &Db, key: &str) -> anyhow::Result<Option<T>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "app_settings")? {
        return Ok(None);
    }
    let value = connection
        .query_row(
            "select value from app_settings where key = ?",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value.and_then(|value| serde_json::from_str(&value).ok()))
}

pub(crate) fn save_json<T: Serialize>(db: &Db, key: &str, value: &T) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_settings_schema(&connection)?;
    let updated_at = crate::api::common::timestamp();
    connection.execute(
        "insert into app_settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
        (key, serde_json::to_string(value)?, updated_at),
    )?;
    Ok(())
}

fn ensure_settings_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists app_settings (
          key text primary key,
          value text not null,
          updated_at text not null
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

fn default_preview_access() -> PreviewAccessSettings {
    PreviewAccessSettings {
        request_ttl_minutes: 30,
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_preview_access(input: PreviewAccessSettings) -> PreviewAccessSettings {
    PreviewAccessSettings {
        request_ttl_minutes: clamp(input.request_ttl_minutes, 1, 24 * 60),
        updated_at: input.updated_at,
    }
}

fn default_session_compaction() -> SessionCompactionSettings {
    SessionCompactionSettings {
        enabled: true,
        auto_compact_messages: 80,
        auto_compact_chars: 80_000,
        min_new_messages: 20,
        min_new_chars: 12_000,
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_session_compaction(input: SessionCompactionSettings) -> SessionCompactionSettings {
    SessionCompactionSettings {
        enabled: input.enabled,
        auto_compact_messages: clamp(input.auto_compact_messages, 1, 100_000),
        auto_compact_chars: clamp(input.auto_compact_chars, 1_000, 10_000_000),
        min_new_messages: clamp(input.min_new_messages, 1, 10_000),
        min_new_chars: clamp(input.min_new_chars, 1_000, 2_000_000),
        updated_at: input.updated_at,
    }
}

fn default_token_usage_display() -> TokenUsageDisplaySettings {
    TokenUsageDisplaySettings {
        show_message_usage: false,
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_token_usage_display(input: TokenUsageDisplaySettings) -> TokenUsageDisplaySettings {
    TokenUsageDisplaySettings {
        show_message_usage: input.show_message_usage,
        updated_at: input.updated_at,
    }
}

fn default_rate_limit() -> RateLimitSettings {
    RateLimitSettings {
        enabled: env_bool("CODEX_WEB_RATE_LIMIT_ENABLED", true),
        global_per_minute: env_number("CODEX_WEB_RATE_LIMIT_GLOBAL_PER_MINUTE", 300),
        auth_per_minute: env_number("CODEX_WEB_RATE_LIMIT_AUTH_PER_MINUTE", 20),
        preview_access_per_minute: env_number("CODEX_WEB_RATE_LIMIT_PREVIEW_ACCESS_PER_MINUTE", 10),
        expensive_per_five_minutes: env_number("CODEX_WEB_RATE_LIMIT_EXPENSIVE_PER_5_MINUTES", 30),
        provider_proxy_per_minute: env_number("CODEX_WEB_RATE_LIMIT_PROVIDER_PROXY_PER_MINUTE", 60),
        provider_proxy_per_hour: env_number("CODEX_WEB_RATE_LIMIT_PROVIDER_PROXY_PER_HOUR", 600),
        provider_proxy_max_concurrent: env_number("CODEX_WEB_PROVIDER_PROXY_MAX_CONCURRENT", 5),
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_rate_limit(input: RateLimitSettings) -> RateLimitSettings {
    RateLimitSettings {
        enabled: input.enabled,
        global_per_minute: clamp(input.global_per_minute, 1, 100_000),
        auth_per_minute: clamp(input.auth_per_minute, 1, 100_000),
        preview_access_per_minute: clamp(input.preview_access_per_minute, 1, 100_000),
        expensive_per_five_minutes: clamp(input.expensive_per_five_minutes, 1, 100_000),
        provider_proxy_per_minute: clamp(input.provider_proxy_per_minute, 1, 100_000),
        provider_proxy_per_hour: clamp(input.provider_proxy_per_hour, 1, 100_000),
        provider_proxy_max_concurrent: clamp(input.provider_proxy_max_concurrent, 1, 1000),
        updated_at: input.updated_at,
    }
}

fn default_token_usage_retention() -> TokenUsageRetentionSettings {
    TokenUsageRetentionSettings {
        retention_days: 0,
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_token_usage_retention(input: TokenUsageRetentionSettings) -> TokenUsageRetentionSettings {
    TokenUsageRetentionSettings {
        retention_days: clamp(input.retention_days, 0, 3650),
        updated_at: input.updated_at,
    }
}

fn default_notification_test() -> NotificationTestSettings {
    NotificationTestSettings {
        title_zh: "Codex Web 测试通知".to_string(),
        title_en: "Codex Web test notification".to_string(),
        message_zh: "这是一条来自 Codex Web 的测试通知。".to_string(),
        message_en: "This is a test notification from Codex Web.".to_string(),
        include_help: true,
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_notification_test(input: NotificationTestSettings) -> NotificationTestSettings {
    let defaults = default_notification_test();
    NotificationTestSettings {
        title_zh: text_or_default(input.title_zh, defaults.title_zh, 200),
        title_en: text_or_default(input.title_en, defaults.title_en, 200),
        message_zh: text_or_default(input.message_zh, defaults.message_zh, 2000),
        message_en: text_or_default(input.message_en, defaults.message_en, 2000),
        include_help: input.include_help,
        updated_at: input.updated_at,
    }
}

fn clamp(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

fn env_number(name: &str, fallback: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn env_bool(name: &str, fallback: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(fallback)
}

fn text_or_default(value: String, fallback: String, max: usize) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback
    } else {
        value.chars().take(max).collect()
    }
}
