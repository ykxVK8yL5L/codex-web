use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{
    ProviderCapabilities, ProviderCapabilitiesInput, ProviderHealthCheck, ProviderInput,
    ProviderRecord, ProviderSummary,
};

pub fn list_providers(db: &Db) -> anyhow::Result<Vec<ProviderSummary>> {
    Ok(list_provider_records(db)?
        .into_iter()
        .map(|record| record.summary)
        .collect())
}

pub fn list_provider_records(db: &Db) -> anyhow::Result<Vec<ProviderRecord>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "providers")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "select id, name, kind, default_model, base_url, capabilities, rpm_limit, rpm_limit_enabled, use_proxy, api_key from providers order by name asc",
    )?;
    let providers = statement
        .query_map([], |row| {
            let kind: String = row.get(2)?;
            let capabilities_json: Option<String> = row.get(5)?;
            let id: String = row.get(0)?;
            let api_key: Option<String> = row.get(9).ok();
            let cached = read_model_cache_from_connection(&connection, &id)
                .ok()
                .flatten();
            Ok(ProviderRecord {
                summary: ProviderSummary {
                    id,
                    name: row.get(1)?,
                    kind: kind.clone(),
                    default_model: row.get(3)?,
                    base_url: row.get(4)?,
                    api_key_configured: api_key.as_ref().is_some_and(|value| !value.is_empty()),
                    capabilities: parse_capabilities(capabilities_json.as_deref(), &kind),
                    models: cached.as_ref().map(|item| item.0.clone()),
                    models_cached_at: cached.map(|item| item.1),
                    rpm_limit: row.get(6)?,
                    rpm_limit_enabled: row.get::<_, i64>(7).unwrap_or(0) != 0,
                    use_proxy: row.get::<_, i64>(8).unwrap_or(0) != 0,
                },
                api_key,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(providers)
}

pub fn get_provider_record(db: &Db, id: &str) -> anyhow::Result<Option<ProviderRecord>> {
    Ok(list_provider_records(db)?
        .into_iter()
        .find(|provider| provider.summary.id == id))
}

pub fn create_provider(db: &Db, input: ProviderInput) -> anyhow::Result<ProviderSummary> {
    let name = required(input.name, "invalid_provider")?;
    let kind = required(input.kind, "invalid_provider")?;
    let default_model = required(input.default_model, "invalid_provider")?;
    let id = unique_provider_id(db, &slugify(&name))?;
    let capabilities = merge_capabilities(default_capabilities(&kind), input.capabilities);
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    connection.execute(
        "insert into providers (id, name, kind, default_model, base_url, api_key, capabilities, rpm_limit, rpm_limit_enabled, use_proxy) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            &id,
            &name,
            &kind,
            &default_model,
            empty_to_none(input.base_url).as_deref(),
            empty_to_none(input.api_key).as_deref(),
            serde_json::to_string(&capabilities)?,
            sanitize_rpm_limit(input.rpm_limit),
            bool_i64(input.rpm_limit_enabled.unwrap_or(false)),
            bool_i64(kind == "openai-responses" && input.use_proxy.unwrap_or(false)),
        ),
    )?;
    Ok(get_provider_record(db, &id)?
        .expect("created provider exists")
        .summary)
}

pub fn update_provider(
    db: &Db,
    id: &str,
    input: ProviderInput,
) -> anyhow::Result<Option<ProviderSummary>> {
    let Some(mut record) = get_provider_record(db, id)? else {
        return Ok(None);
    };
    if let Some(name) = input.name.filter(|value| !value.trim().is_empty()) {
        record.summary.name = name;
    }
    if let Some(kind) = input.kind.filter(|value| !value.trim().is_empty()) {
        record.summary.kind = kind;
    }
    if let Some(default_model) = input.default_model.filter(|value| !value.trim().is_empty()) {
        record.summary.default_model = default_model;
    }
    if input.base_url.is_some() {
        record.summary.base_url = empty_to_none(input.base_url);
    }
    if input.api_key.is_some() {
        record.api_key = empty_to_none(input.api_key);
        record.summary.api_key_configured = record
            .api_key
            .as_ref()
            .is_some_and(|value| !value.is_empty());
    }
    if input.capabilities.is_some() {
        record.summary.capabilities = merge_capabilities(
            default_capabilities(&record.summary.kind),
            input.capabilities,
        );
    }
    if input.rpm_limit.is_some() {
        record.summary.rpm_limit = sanitize_rpm_limit(input.rpm_limit);
    }
    if let Some(enabled) = input.rpm_limit_enabled {
        record.summary.rpm_limit_enabled = enabled;
    }
    if let Some(use_proxy) = input.use_proxy {
        record.summary.use_proxy = record.summary.kind == "openai-responses" && use_proxy;
    }
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    connection.execute(
        "update providers set name = ?, kind = ?, default_model = ?, base_url = ?, api_key = ?, capabilities = ?, rpm_limit = ?, rpm_limit_enabled = ?, use_proxy = ? where id = ?",
        (
            &record.summary.name,
            &record.summary.kind,
            &record.summary.default_model,
            record.summary.base_url.as_deref(),
            record.api_key.as_deref(),
            serde_json::to_string(&record.summary.capabilities)?,
            record.summary.rpm_limit,
            bool_i64(record.summary.rpm_limit_enabled),
            bool_i64(record.summary.use_proxy),
            id,
        ),
    )?;
    Ok(Some(
        get_provider_record(db, id)?
            .expect("updated provider exists")
            .summary,
    ))
}

pub fn apply_detection(
    db: &Db,
    id: &str,
    detection: &super::models::ProviderDetectionResponse,
) -> anyhow::Result<Option<ProviderSummary>> {
    let Some(mut record) = get_provider_record(db, id)? else {
        return Ok(None);
    };
    record.summary.kind = detection.kind.clone();
    record.summary.capabilities = detection.capabilities.clone();
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    connection.execute(
        "update providers set kind = ?, capabilities = ? where id = ?",
        (
            &record.summary.kind,
            serde_json::to_string(&record.summary.capabilities)?,
            id,
        ),
    )?;
    connection.execute(
        "delete from provider_model_cache where provider_id = ?",
        [id],
    )?;
    Ok(Some(
        get_provider_record(db, id)?
            .expect("updated provider exists")
            .summary,
    ))
}

pub fn delete_provider(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    let deleted = connection.execute("delete from providers where id = ?", [id])?;
    connection.execute(
        "delete from provider_health_checks where provider_id = ?",
        [id],
    )?;
    connection.execute(
        "delete from provider_model_cache where provider_id = ?",
        [id],
    )?;
    Ok(deleted > 0)
}

pub fn list_health(
    db: &Db,
    provider_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<ProviderHealthCheck>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "provider_health_checks")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, provider_id, kind, ok, status, duration_ms, error, checked_at from provider_health_checks where provider_id = ? order by checked_at desc, id desc limit ?")?;
    let items = statement
        .query_map((provider_id, limit as i64), |row| {
            Ok(ProviderHealthCheck {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                kind: row.get(2)?,
                ok: row.get::<_, i64>(3)? != 0,
                status: row.get(4)?,
                duration_ms: row.get(5)?,
                error: row.get(6)?,
                checked_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn clear_health(db: &Db, provider_id: &str) -> anyhow::Result<usize> {
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    Ok(connection.execute(
        "delete from provider_health_checks where provider_id = ?",
        [provider_id],
    )?)
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

fn ensure_provider_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists providers (
          id text primary key,
          name text not null,
          kind text not null,
          default_model text not null,
          base_url text,
          api_key text,
          capabilities text,
          rpm_limit integer,
          rpm_limit_enabled integer not null default 0,
          use_proxy integer not null default 0
        );
        create table if not exists provider_health_checks (
          id text primary key,
          provider_id text not null,
          kind text not null,
          ok integer not null,
          status integer,
          duration_ms integer not null,
          error text,
          checked_at text not null
        );
        create table if not exists provider_model_cache (
          provider_id text primary key,
          cache_key text not null,
          models text not null,
          cached_at text not null
        );
        ",
    )?;
    Ok(())
}

fn read_model_cache_from_connection(
    connection: &rusqlite::Connection,
    provider_id: &str,
) -> anyhow::Result<Option<(Vec<String>, String)>> {
    if !table_exists(connection, "provider_model_cache")? {
        return Ok(None);
    }
    let row = connection
        .query_row(
            "select models, cached_at from provider_model_cache where provider_id = ?",
            [provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    Ok(row.and_then(|(models, cached_at)| {
        serde_json::from_str::<Vec<String>>(&models)
            .ok()
            .map(|models| (models, cached_at))
    }))
}

fn parse_capabilities(value: Option<&str>, kind: &str) -> ProviderCapabilities {
    let defaults = default_capabilities(kind);
    let Some(value) = value.filter(|item| !item.trim().is_empty()) else {
        return defaults;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) else {
        return defaults;
    };
    ProviderCapabilities {
        responses_api: parsed
            .get("responsesApi")
            .and_then(|item| item.as_bool())
            .unwrap_or(defaults.responses_api),
        chat_completions: parsed
            .get("chatCompletions")
            .and_then(|item| item.as_bool())
            .unwrap_or(defaults.chat_completions),
        tools: parsed
            .get("tools")
            .and_then(|item| item.as_bool())
            .unwrap_or(defaults.tools),
        json_mode: parsed
            .get("jsonMode")
            .and_then(|item| item.as_bool())
            .unwrap_or(defaults.json_mode),
        vision: parsed
            .get("vision")
            .and_then(|item| item.as_bool())
            .unwrap_or(defaults.vision),
        streaming: parsed
            .get("streaming")
            .and_then(|item| item.as_bool())
            .unwrap_or(defaults.streaming),
    }
}

pub fn save_model_cache(db: &Db, provider_id: &str, models: &[String]) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    connection.execute(
        "insert into provider_model_cache (provider_id, cache_key, models, cached_at) values (?, 'default', ?, ?) on conflict(provider_id) do update set cache_key = excluded.cache_key, models = excluded.models, cached_at = excluded.cached_at",
        (provider_id, serde_json::to_string(models)?, crate::api::common::timestamp()),
    )?;
    Ok(())
}

pub fn record_health(
    db: &Db,
    provider_id: &str,
    kind: &str,
    ok: bool,
    status: Option<i64>,
    duration_ms: i64,
    error: Option<&str>,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_provider_schema(&connection)?;
    connection.execute(
        "insert into provider_health_checks (id, provider_id, kind, ok, status, duration_ms, error, checked_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            format!("provider-health-{}", random_id()),
            provider_id,
            kind,
            bool_i64(ok),
            status,
            duration_ms,
            error,
            crate::api::common::timestamp(),
        ),
    )?;
    Ok(())
}

pub fn default_capabilities(kind: &str) -> ProviderCapabilities {
    ProviderCapabilities {
        responses_api: kind == "openai-responses",
        chat_completions: kind == "openai-compatible-chat" || kind == "local",
        tools: kind != "local",
        json_mode: kind != "local",
        vision: false,
        streaming: true,
    }
}

fn merge_capabilities(
    defaults: ProviderCapabilities,
    input: Option<ProviderCapabilitiesInput>,
) -> ProviderCapabilities {
    let Some(input) = input else {
        return defaults;
    };
    ProviderCapabilities {
        responses_api: input.responses_api.unwrap_or(defaults.responses_api),
        chat_completions: input.chat_completions.unwrap_or(defaults.chat_completions),
        tools: input.tools.unwrap_or(defaults.tools),
        json_mode: input.json_mode.unwrap_or(defaults.json_mode),
        vision: input.vision.unwrap_or(defaults.vision),
        streaming: input.streaming.unwrap_or(defaults.streaming),
    }
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn required(value: Option<String>, error: &'static str) -> anyhow::Result<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!(error))
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bool_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn sanitize_rpm_limit(value: Option<i64>) -> Option<i64> {
    value
        .filter(|value| *value > 0)
        .map(|value| value.min(100_000))
}

fn slugify(value: &str) -> String {
    let slug = value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "provider".to_string()
    } else {
        slug
    }
}

fn unique_provider_id(db: &Db, base: &str) -> anyhow::Result<String> {
    let existing = list_provider_records(db)?
        .into_iter()
        .map(|item| item.summary.id)
        .collect::<std::collections::HashSet<_>>();
    if !existing.contains(base) {
        return Ok(base.to_string());
    }
    for index in 2.. {
        let candidate = format!("{base}-{index}");
        if !existing.contains(&candidate) {
            return Ok(candidate);
        }
    }
    unreachable!()
}
