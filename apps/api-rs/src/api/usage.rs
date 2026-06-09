use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{db::Db, state::AppState};

use super::{
    common::{decode_page_cursor, encode_page_cursor, parse_limit, timestamp, PageCursor},
    sessions::models::SessionSummary,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageSummary {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
    billable_input_tokens: i64,
    records: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageRecordSummary {
    id: String,
    session_id: String,
    session_title: Option<String>,
    message_id: Option<String>,
    task_run_id: Option<String>,
    provider_id: Option<String>,
    provider_name: Option<String>,
    model: Option<String>,
    source: String,
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
    billable_input_tokens: i64,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageBucket {
    key: String,
    label: Option<String>,
    deleted: bool,
    provider_id: Option<String>,
    model: Option<String>,
    session_id: Option<String>,
    summary: TokenUsageSummary,
    updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageResponse {
    summary: TokenUsageSummary,
    by_provider: Vec<TokenUsageBucket>,
    by_model: Vec<TokenUsageBucket>,
    by_session: Vec<TokenUsageBucket>,
    recent: Vec<TokenUsageRecordSummary>,
    recent_next_cursor: Option<String>,
    recent_has_more: bool,
    recent_page: usize,
    recent_page_size: usize,
    recent_total_pages: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageQuery {
    session_id: Option<String>,
    provider_id: Option<String>,
    created_from: Option<String>,
    created_to: Option<String>,
    limit: Option<String>,
    cursor: Option<String>,
    page: Option<String>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageFilter {
    session_id: Option<String>,
    provider_id: Option<String>,
    created_from: Option<String>,
    created_to: Option<String>,
}

#[derive(Clone, Copy)]
pub struct CodexUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_usage))
        .route("/cleanup", post(cleanup_usage))
        .route("/clear", post(clear_usage))
        .route("/delete-filtered", post(delete_filtered_usage))
}

async fn list_usage(State(state): State<AppState>, Query(query): Query<UsageQuery>) -> Json<TokenUsageResponse> {
    let filters = UsageFilter {
        session_id: query.session_id,
        provider_id: query.provider_id,
        created_from: iso_date_filter(query.created_from),
        created_to: iso_date_filter(query.created_to),
    };
    Json(response(
        &state.db,
        &filters,
        parse_limit(query.limit.as_deref(), 20, 100),
        query.cursor.as_deref(),
        page_number(query.page.as_deref()),
    ).unwrap_or_else(|_| empty_response()))
}

async fn cleanup_usage(State(state): State<AppState>) -> Json<serde_json::Value> {
    let retention_days = crate::api::settings::store::token_usage_retention(&state.db)
        .map(|settings| settings.retention_days)
        .unwrap_or(0);
    let deleted = cleanup_by_retention(&state.db, retention_days).unwrap_or(0);
    Json(serde_json::json!({ "ok": true, "deleted": deleted }))
}

async fn clear_usage(State(state): State<AppState>) -> Json<serde_json::Value> {
    let deleted = clear_records(&state.db).unwrap_or(0);
    Json(serde_json::json!({ "ok": true, "deleted": deleted }))
}

async fn delete_filtered_usage(State(state): State<AppState>, Json(body): Json<UsageFilter>) -> Json<serde_json::Value> {
    let filters = UsageFilter {
        session_id: string_filter(body.session_id),
        provider_id: string_filter(body.provider_id),
        created_from: iso_date_filter(body.created_from),
        created_to: iso_date_filter(body.created_to),
    };
    let deleted = delete_filtered_records(&state.db, &filters).unwrap_or(0);
    Json(serde_json::json!({ "ok": true, "deleted": deleted }))
}

pub fn record_codex_usage(db: &Db, session: &SessionSummary, line: &str) -> anyhow::Result<()> {
    let Some(usage) = read_codex_usage(line) else {
        return Ok(());
    };
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let task_run_id = latest_running_task_run_id(&connection, &session.id)?;
    let message_id = latest_unbound_assistant_message_id(&connection, &session.id, task_run_id.as_deref())?;
    let provider_name = session
        .provider_id
        .as_deref()
        .and_then(|id| provider_name(&connection, id).ok().flatten());
    insert_usage_record(
        &connection,
        session,
        session.provider_id.as_deref(),
        provider_name.as_deref(),
        session.model.as_deref(),
        message_id.as_deref(),
        "codex_json",
        &format!("codex_json\n{}\n{}", session.id, line),
        line,
        &usage,
        task_run_id.as_deref(),
    )
}

pub fn record_provider_usage(
    db: &Db,
    session: &SessionSummary,
    provider_id: Option<&str>,
    provider_name: Option<&str>,
    model: Option<&str>,
    message_id: Option<&str>,
    source: &str,
    raw_hash_seed: &str,
    raw_usage: &Value,
    usage: CodexUsage,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    insert_usage_record(
        &connection,
        session,
        provider_id,
        provider_name,
        model,
        message_id,
        source,
        &format!("{source}\n{}\n{raw_hash_seed}", session.id),
        &serde_json::to_string(raw_usage).unwrap_or_else(|_| "{}".to_string()),
        &usage,
        None,
    )
}

fn insert_usage_record(
    connection: &rusqlite::Connection,
    session: &SessionSummary,
    provider_id: Option<&str>,
    provider_name: Option<&str>,
    model: Option<&str>,
    message_id: Option<&str>,
    source: &str,
    raw_hash_seed: &str,
    raw_usage: &str,
    usage: &CodexUsage,
    task_run_id: Option<&str>,
) -> anyhow::Result<()> {
    if usage.input_tokens == 0
        && usage.cached_input_tokens == 0
        && usage.output_tokens == 0
        && usage.reasoning_output_tokens == 0
    {
        return Ok(());
    }
    let raw_hash = hex_hash(raw_hash_seed);
    connection.execute(
        "insert or ignore into token_usage_records (
            id, session_id, session_title, message_id, task_run_id, provider_id, provider_name, model, source, raw_hash,
            input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
            raw_usage, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            format!("token-usage-{}", random_hex(16)),
            session.id,
            session.title,
            message_id,
            task_run_id,
            provider_id,
            provider_name,
            model,
            source,
            raw_hash,
            usage.input_tokens,
            usage.cached_input_tokens,
            usage.output_tokens,
            usage.reasoning_output_tokens,
            usage.input_tokens + usage.output_tokens,
            raw_usage,
            timestamp(),
        ],
    )?;
    Ok(())
}

pub fn read_provider_usage(payload: &Value) -> Option<CodexUsage> {
    let usage = payload.get("usage")?;
    let input_details = usage
        .get("input_tokens_details")
        .or_else(|| usage.get("prompt_tokens_details"));
    let output_details = usage
        .get("output_tokens_details")
        .or_else(|| usage.get("completion_tokens_details"));
    let item = CodexUsage {
        input_tokens: non_negative_i64(usage.get("input_tokens").or_else(|| usage.get("prompt_tokens"))),
        cached_input_tokens: non_negative_i64(
            usage.get("cached_input_tokens")
                .or_else(|| input_details.and_then(|value| value.get("cached_tokens"))),
        ),
        output_tokens: non_negative_i64(usage.get("output_tokens").or_else(|| usage.get("completion_tokens"))),
        reasoning_output_tokens: non_negative_i64(
            usage.get("reasoning_output_tokens")
                .or_else(|| output_details.and_then(|value| value.get("reasoning_tokens"))),
        ),
    };
    if item.input_tokens == 0
        && item.cached_input_tokens == 0
        && item.output_tokens == 0
        && item.reasoning_output_tokens == 0
    {
        None
    } else {
        Some(item)
    }
}

pub fn cleanup_by_retention(db: &Db, retention_days: i64) -> anyhow::Result<i64> {
    if retention_days <= 0 {
        return Ok(0);
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let cutoff = time::OffsetDateTime::now_utc()
        - time::Duration::days(retention_days.clamp(0, 3650));
    let cutoff = cutoff
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
    Ok(connection.execute(
        "delete from token_usage_records where created_at < ?",
        [cutoff],
    )? as i64)
}

pub fn clear_records(db: &Db) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute("delete from token_usage_records", [])? as i64)
}

fn delete_filtered_records(db: &Db, filters: &UsageFilter) -> anyhow::Result<i64> {
    if !has_usage_filter(filters) {
        return Ok(0);
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let sql = format!("delete from token_usage_records {}", where_clause(filters, None));
    let params = filter_params(filters);
    Ok(connection.execute(&sql, rusqlite::params_from_iter(params.iter().map(|value| value.as_ref())))? as i64)
}

fn read_codex_usage(line: &str) -> Option<CodexUsage> {
    let parsed: Value = serde_json::from_str(line).ok()?;
    if parsed.get("type")?.as_str()? != "turn.completed" {
        return None;
    }
    let usage = parsed.get("usage")?;
    let item = CodexUsage {
        input_tokens: non_negative_i64(usage.get("input_tokens")),
        cached_input_tokens: non_negative_i64(usage.get("cached_input_tokens")),
        output_tokens: non_negative_i64(usage.get("output_tokens")),
        reasoning_output_tokens: non_negative_i64(usage.get("reasoning_output_tokens")),
    };
    if item.input_tokens == 0
        && item.cached_input_tokens == 0
        && item.output_tokens == 0
        && item.reasoning_output_tokens == 0
    {
        None
    } else {
        Some(item)
    }
}

fn response(db: &Db, filters: &UsageFilter, limit: usize, cursor: Option<&str>, page: Option<usize>) -> anyhow::Result<TokenUsageResponse> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let summary = summary(&connection, filters)?;
    let total_pages = ((summary.records.max(0) as usize) + limit.saturating_sub(1)).checked_div(limit).unwrap_or(0).max(1);
    let (recent_items, recent_next_cursor, recent_has_more, recent_page) = recent(&connection, filters, limit, decode_page_cursor(cursor), page)?;
    Ok(TokenUsageResponse {
        summary,
        by_provider: buckets(&connection, "provider", filters, 10)?,
        by_model: buckets(&connection, "model", filters, 10)?,
        by_session: buckets(&connection, "session", filters, 10)?,
        recent: recent_items,
        recent_next_cursor,
        recent_has_more,
        recent_page,
        recent_page_size: limit,
        recent_total_pages: total_pages,
    })
}

fn summary(connection: &rusqlite::Connection, filters: &UsageFilter) -> anyhow::Result<TokenUsageSummary> {
    let sql = format!(
        "select coalesce(sum(input_tokens), 0), coalesce(sum(cached_input_tokens), 0), coalesce(sum(output_tokens), 0), coalesce(sum(reasoning_output_tokens), 0), coalesce(sum(total_tokens), 0), count(*) from token_usage_records {}",
        where_clause(filters, None)
    );
    let params = filter_params(filters);
    Ok(connection.query_row(&sql, rusqlite::params_from_iter(params.iter().map(|value| value.as_ref())), |row| {
        summary_from_values(row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)
    })?)
}

fn buckets(connection: &rusqlite::Connection, kind: &str, filters: &UsageFilter, limit: usize) -> anyhow::Result<Vec<TokenUsageBucket>> {
    let key_column = match kind {
        "provider" => "provider_id",
        "model" => "model",
        _ => "session_id",
    };
    let snapshot_column = match kind {
        "provider" => "provider_name",
        "session" => "session_title",
        _ => "model",
    };
    let sql = format!(
        "select coalesce({key_column}, ''), max({snapshot_column}), {provider_expr}, {model_expr}, {session_expr},
          coalesce(sum(input_tokens), 0), coalesce(sum(cached_input_tokens), 0), coalesce(sum(output_tokens), 0),
          coalesce(sum(reasoning_output_tokens), 0), coalesce(sum(total_tokens), 0), count(*), max(created_at)
         from token_usage_records {where_sql}
         group by {key_column}
         order by coalesce(sum(total_tokens), 0) desc, max(created_at) desc
         limit ?",
        provider_expr = if kind == "provider" { "provider_id" } else { "null" },
        model_expr = if kind == "model" { "model" } else { "null" },
        session_expr = if kind == "session" { "session_id" } else { "null" },
        where_sql = where_clause(filters, None),
    );
    let mut params = filter_params(filters);
    params.push(Box::new(limit as i64));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(params.iter().map(|value| value.as_ref())), |row| {
        let key: String = row.get(0)?;
        let snapshot_label: Option<String> = row.get(1)?;
        let provider: Option<String> = row.get(2)?;
        let model: Option<String> = row.get(3)?;
        let session: Option<String> = row.get(4)?;
        let active_session_label = session
            .as_deref()
            .and_then(|id| session_title(connection, id).ok().flatten());
        let active_provider_label = provider
            .as_deref()
            .and_then(|id| provider_name(connection, id).ok().flatten());
        let label = match kind {
            "session" => active_session_label.clone().or(snapshot_label.clone()).or_else(|| session.clone()),
            "provider" => active_provider_label.clone().or(snapshot_label.clone()).or_else(|| provider.clone()),
            _ => Some(if key.is_empty() { "unknown".to_string() } else { key.clone() }),
        };
        Ok(TokenUsageBucket {
            label,
            key: if key.is_empty() { "unknown".to_string() } else { key },
            deleted: (kind == "session" && session.is_some() && active_session_label.is_none())
                || (kind == "provider" && provider.is_some() && active_provider_label.is_none()),
            provider_id: provider,
            model,
            session_id: session,
            summary: summary_from_values(row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?)?,
            updated_at: row.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn recent(
    connection: &rusqlite::Connection,
    filters: &UsageFilter,
    limit: usize,
    cursor: Option<PageCursor>,
    page: Option<usize>,
) -> anyhow::Result<(Vec<TokenUsageRecordSummary>, Option<String>, bool, usize)> {
    if let Some(page) = page {
        return recent_by_page(connection, filters, limit, page);
    }
    let sql = format!(
        "select id, session_id, session_title, message_id, task_run_id, provider_id, provider_name, model, source, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens, created_at
         from token_usage_records {}
         order by created_at desc, id desc
         limit ?",
        where_clause(filters, cursor.as_ref())
    );
    let mut params = filter_params(filters);
    if let Some(cursor) = cursor.as_ref() {
        params.push(Box::new(cursor.sort_value.clone()));
        params.push(Box::new(cursor.sort_value.clone()));
        params.push(Box::new(cursor.id.clone()));
    }
    params.push(Box::new(limit as i64 + 1));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(params.iter().map(|value| value.as_ref())), usage_record_from_row)?;
    let mut items = rows.collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    let next_cursor = if has_more {
        items
            .last()
            .and_then(|item| encode_page_cursor(&item.created_at, &item.id))
    } else {
        None
    };
    Ok((items, next_cursor, has_more, 0))
}

fn recent_by_page(
    connection: &rusqlite::Connection,
    filters: &UsageFilter,
    limit: usize,
    page: usize,
) -> anyhow::Result<(Vec<TokenUsageRecordSummary>, Option<String>, bool, usize)> {
    let sql = format!(
        "select id, session_id, session_title, message_id, task_run_id, provider_id, provider_name, model, source, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens, created_at
         from token_usage_records {}
         order by created_at desc, id desc
         limit ? offset ?",
        where_clause(filters, None)
    );
    let mut params = filter_params(filters);
    params.push(Box::new(limit as i64 + 1));
    params.push(Box::new((page * limit) as i64));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(params.iter().map(|value| value.as_ref())), usage_record_from_row)?;
    let mut items = rows.collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    Ok((items, None, has_more, page))
}

fn usage_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TokenUsageRecordSummary> {
    let input_tokens: i64 = row.get(9)?;
    let cached_input_tokens: i64 = row.get(10)?;
    Ok(TokenUsageRecordSummary {
        id: row.get(0)?,
        session_id: row.get(1)?,
        session_title: row.get(2)?,
        message_id: row.get(3)?,
        task_run_id: row.get(4)?,
        provider_id: row.get(5)?,
        provider_name: row.get(6)?,
        model: row.get(7)?,
        source: row.get(8)?,
        input_tokens,
        cached_input_tokens,
        output_tokens: row.get(11)?,
        reasoning_output_tokens: row.get(12)?,
        total_tokens: row.get(13)?,
        billable_input_tokens: (input_tokens - cached_input_tokens).max(0),
        created_at: row.get(14)?,
    })
}

pub fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists token_usage_records (
          id text primary key,
          session_id text not null,
          session_title text,
          message_id text,
          task_run_id text,
          provider_id text,
          provider_name text,
          model text,
          source text not null,
          raw_hash text not null,
          input_tokens integer not null default 0,
          cached_input_tokens integer not null default 0,
          output_tokens integer not null default 0,
          reasoning_output_tokens integer not null default 0,
          total_tokens integer not null default 0,
          raw_usage text,
          created_at text not null
        );
        create unique index if not exists token_usage_records_raw_hash_idx on token_usage_records(raw_hash);
        create index if not exists token_usage_records_session_idx on token_usage_records(session_id, created_at desc);
        create index if not exists token_usage_records_provider_idx on token_usage_records(provider_id, created_at desc);
        ",
    )?;
    ensure_column(connection, "token_usage_records", "session_title", "text")?;
    ensure_column(connection, "token_usage_records", "provider_name", "text")?;
    ensure_column(connection, "token_usage_records", "message_id", "text")?;
    Ok(())
}

fn latest_running_task_run_id(connection: &rusqlite::Connection, session_id: &str) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "task_runs")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select id from task_runs where session_id = ? and status = 'running' order by started_at desc, id desc limit 1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn latest_unbound_assistant_message_id(
    connection: &rusqlite::Connection,
    session_id: &str,
    task_run_id: Option<&str>,
) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "messages")? {
        return Ok(None);
    }
    let run_started_at = task_run_id
        .and_then(|id| latest_task_run_started_at(connection, id).ok().flatten());
    if let Some(started_at) = run_started_at {
        Ok(connection
            .query_row(
                "
                select messages.id
                from messages
                where messages.session_id = ?
                  and messages.role = 'assistant'
                  and messages.created_at >= ?
                  and not exists (
                    select 1
                    from token_usage_records usage
                    where usage.session_id = messages.session_id
                      and usage.message_id = messages.id
                  )
                order by messages.created_at desc, messages.id desc
                limit 1
                ",
                rusqlite::params![session_id, started_at],
                |row| row.get(0),
            )
            .optional()?)
    } else {
        Ok(connection
            .query_row(
                "
                select messages.id
                from messages
                where messages.session_id = ?
                  and messages.role = 'assistant'
                  and not exists (
                    select 1
                    from token_usage_records usage
                    where usage.session_id = messages.session_id
                      and usage.message_id = messages.id
                  )
                order by messages.created_at desc, messages.id desc
                limit 1
                ",
                [session_id],
                |row| row.get(0),
            )
            .optional()?)
    }
}

fn latest_task_run_started_at(connection: &rusqlite::Connection, task_run_id: &str) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "task_runs")? {
        return Ok(None);
    }
    Ok(connection
        .query_row(
            "select started_at from task_runs where id = ?",
            [task_run_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn session_title(connection: &rusqlite::Connection, session_id: &str) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "sessions")? {
        return Ok(None);
    }
    Ok(connection
        .query_row("select title from sessions where id = ?", [session_id], |row| row.get(0))
        .optional()?)
}

fn provider_name(connection: &rusqlite::Connection, provider_id: &str) -> anyhow::Result<Option<String>> {
    if !table_exists(connection, "providers")? {
        return Ok(None);
    }
    Ok(connection
        .query_row("select name from providers where id = ?", [provider_id], |row| row.get(0))
        .optional()?)
}

fn where_clause(filters: &UsageFilter, cursor: Option<&PageCursor>) -> String {
    let mut clauses = Vec::new();
    if filters.session_id.is_some() {
        clauses.push("session_id = ?");
    }
    if filters.provider_id.is_some() {
        clauses.push("provider_id = ?");
    }
    if filters.created_from.is_some() {
        clauses.push("datetime(created_at) >= datetime(?)");
    }
    if filters.created_to.is_some() {
        clauses.push("datetime(created_at) <= datetime(?)");
    }
    if cursor.is_some() {
        clauses.push("(created_at < ? or (created_at = ? and id < ?))");
    }
    if clauses.is_empty() {
        String::new()
    } else {
        format!("where {}", clauses.join(" and "))
    }
}

fn filter_params(filters: &UsageFilter) -> Vec<Box<dyn rusqlite::ToSql>> {
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(value) = filters.session_id.as_deref() {
        params.push(Box::new(value.to_string()));
    }
    if let Some(value) = filters.provider_id.as_deref() {
        params.push(Box::new(value.to_string()));
    }
    if let Some(value) = filters.created_from.as_deref() {
        params.push(Box::new(value.to_string()));
    }
    if let Some(value) = filters.created_to.as_deref() {
        params.push(Box::new(value.to_string()));
    }
    params
}

fn string_filter(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn iso_date_filter(value: Option<String>) -> Option<String> {
    let value = string_filter(value)?;
    if value.len() >= 16 && value.contains('T') {
        Some(value)
    } else {
        None
    }
}

fn has_usage_filter(filters: &UsageFilter) -> bool {
    filters.session_id.is_some()
        || filters.provider_id.is_some()
        || filters.created_from.is_some()
        || filters.created_to.is_some()
}

fn summary_from_values(input_tokens: i64, cached_input_tokens: i64, output_tokens: i64, reasoning_output_tokens: i64, total_tokens: i64, records: i64) -> rusqlite::Result<TokenUsageSummary> {
    Ok(TokenUsageSummary {
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
        billable_input_tokens: (input_tokens - cached_input_tokens).max(0),
        records,
    })
}

fn empty_response() -> TokenUsageResponse {
    TokenUsageResponse {
        summary: summary_from_values(0, 0, 0, 0, 0, 0).unwrap(),
        by_provider: Vec::new(),
        by_model: Vec::new(),
        by_session: Vec::new(),
        recent: Vec::new(),
        recent_next_cursor: None,
        recent_has_more: false,
        recent_page: 0,
        recent_page_size: 20,
        recent_total_pages: 1,
    }
}

fn page_number(value: Option<&str>) -> Option<usize> {
    value
        .filter(|item| !item.trim().is_empty())
        .and_then(|item| item.parse::<usize>().ok())
}

fn non_negative_i64(value: Option<&Value>) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(0).max(0)
}

fn hex_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn random_hex(bytes: usize) -> String {
    let mut output = String::with_capacity(bytes * 2);
    for _ in 0..bytes {
        output.push_str(&format!("{:02x}", rand::random::<u8>()));
    }
    output
}

fn table_exists(connection: &rusqlite::Connection, name: &str) -> anyhow::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [name],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn ensure_column(
    connection: &rusqlite::Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> anyhow::Result<()> {
    let mut statement = connection.prepare(&format!("pragma table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|item| item == column) {
        connection.execute(&format!("alter table {table} add column {column} {definition}"), [])?;
    }
    Ok(())
}
