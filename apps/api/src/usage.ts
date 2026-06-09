import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { ProviderSummary, SessionSummary, TokenUsageBucket, TokenUsageRecordSummary, TokenUsageResponse, TokenUsageSummary } from "@codex-web/protocol";
import { decodePageCursor, pageFromRows } from "./pagination.js";

type UsageDeps = {
  db: Database.Database;
  sessions: SessionSummary[];
  providers: ProviderSummary[];
  parsePageLimit: (value: string) => number;
  latestRunningTaskRun: (sessionId: string) => Record<string, unknown> | undefined;
  getRetentionDays?: () => number;
};

type UsagePayload = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

type RecordTokenUsageInput = {
  session: SessionSummary;
  providerId?: string | null;
  providerName?: string | null;
  model?: string | null;
  messageId?: string | null;
  source: string;
  rawUsage: unknown;
  rawHashSeed: string;
  usage: UsagePayload;
  taskRunId?: string | null;
};

type UsageFilters = {
  sessionId?: string | null;
  providerId?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  limit?: number;
  cursor?: string | null;
  page?: number | null;
};

export function ensureTokenUsageSchema(db: Database.Database) {
  db.exec(`
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
  `);
  const columns = db.prepare("pragma table_info(token_usage_records)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "session_title")) db.prepare("alter table token_usage_records add column session_title text").run();
  if (!columns.some((column) => column.name === "provider_name")) db.prepare("alter table token_usage_records add column provider_name text").run();
  if (!columns.some((column) => column.name === "message_id")) db.prepare("alter table token_usage_records add column message_id text").run();
}

export function readCodexUsage(line: string): UsagePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as { type?: unknown; usage?: unknown };
  if (value.type !== "turn.completed" || !value.usage || typeof value.usage !== "object") return null;
  const usage = value.usage as Record<string, unknown>;
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const cachedInputTokens = nonNegativeInteger(usage.cached_input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const reasoningOutputTokens = nonNegativeInteger(usage.reasoning_output_tokens);
  if (inputTokens === 0 && cachedInputTokens === 0 && outputTokens === 0 && reasoningOutputTokens === 0) return null;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}

export function recordCodexUsage(deps: UsageDeps, session: SessionSummary, line: string) {
  const usage = readCodexUsage(line);
  if (!usage) return;
  const run = deps.latestRunningTaskRun(session.id);
  const provider = session.providerId ? deps.providers.find((item) => item.id === session.providerId) : null;
  const messageId = latestUnboundAssistantMessageId(
    deps.db,
    session.id,
    run?.started_at ? String(run.started_at) : null,
  );
  recordTokenUsage(deps.db, {
    session,
    providerId: session.providerId ?? null,
    providerName: provider?.name ?? null,
    model: session.model ?? null,
    messageId,
    source: "codex_json",
    rawUsage: line,
    rawHashSeed: line,
    usage,
    taskRunId: run?.id ? String(run.id) : null,
  });
}

function latestUnboundAssistantMessageId(db: Database.Database, sessionId: string, runStartedAt?: string | null) {
  ensureTokenUsageSchema(db);
  if (!tableExists(db, "messages")) return null;
  if (runStartedAt) {
    const row = db.prepare(`
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
    `).get(sessionId, runStartedAt) as { id?: string } | undefined;
    return row?.id ?? null;
  }
  const row = db.prepare(`
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
  `).get(sessionId) as { id?: string } | undefined;
  return row?.id ?? null;
}

function tableExists(db: Database.Database, tableName: string) {
  const row = db.prepare("select 1 from sqlite_master where type = 'table' and name = ? limit 1").get(tableName);
  return Boolean(row);
}

export function recordTokenUsage(db: Database.Database, input: RecordTokenUsageInput) {
  if (input.usage.inputTokens === 0 && input.usage.cachedInputTokens === 0 && input.usage.outputTokens === 0 && input.usage.reasoningOutputTokens === 0) return;
  ensureTokenUsageSchema(db);
  const now = new Date().toISOString();
  const rawHash = createHash("sha256").update(`${input.source}\n${input.session.id}\n${input.rawHashSeed}`).digest("hex");
  const rawUsage = typeof input.rawUsage === "string" ? input.rawUsage : JSON.stringify(input.rawUsage ?? {});
  db.prepare(`
    insert or ignore into token_usage_records (
      id, session_id, session_title, message_id, task_run_id, provider_id, provider_name, model, source, raw_hash,
      input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
      raw_usage, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `token-usage-${randomUUID()}`,
    input.session.id,
    input.session.title,
    input.messageId ?? null,
    input.taskRunId ?? null,
    input.providerId ?? null,
    input.providerName ?? null,
    input.model ?? null,
    input.source,
    rawHash,
    input.usage.inputTokens,
    input.usage.cachedInputTokens,
    input.usage.outputTokens,
    input.usage.reasoningOutputTokens,
    input.usage.inputTokens + input.usage.outputTokens,
    rawUsage,
    now,
  );
}

export function readProviderUsage(payload: Record<string, unknown>): UsagePayload | null {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const inputDetails = (record.input_tokens_details ?? record.prompt_tokens_details) as Record<string, unknown> | undefined;
  const outputDetails = (record.output_tokens_details ?? record.completion_tokens_details) as Record<string, unknown> | undefined;
  const inputTokens = nonNegativeInteger(record.input_tokens ?? record.prompt_tokens);
  const cachedInputTokens = nonNegativeInteger(record.cached_input_tokens ?? inputDetails?.cached_tokens);
  const outputTokens = nonNegativeInteger(record.output_tokens ?? record.completion_tokens);
  const reasoningOutputTokens = nonNegativeInteger(record.reasoning_output_tokens ?? outputDetails?.reasoning_tokens);
  if (inputTokens === 0 && cachedInputTokens === 0 && outputTokens === 0 && reasoningOutputTokens === 0) return null;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}

export function registerUsageRoutes(app: Hono, deps: UsageDeps) {
  app.get("/api/usage", (c) => {
    const response = buildUsageResponse(deps, {
      sessionId: c.req.query("sessionId"),
      providerId: c.req.query("providerId"),
      createdFrom: isoDateFilter(c.req.query("createdFrom")),
      createdTo: isoDateFilter(c.req.query("createdTo")),
      limit: deps.parsePageLimit(c.req.query("limit") ?? "20"),
      cursor: c.req.query("cursor"),
      page: pageNumber(c.req.query("page")),
    });
    return c.json(response);
  });
  app.post("/api/usage/cleanup", (c) => {
    const deleted = cleanupTokenUsageRecords(deps.db, deps.getRetentionDays?.() ?? 0);
    return c.json({ ok: true, deleted });
  });
  app.post("/api/usage/clear", (c) => {
    const deleted = clearTokenUsageRecords(deps.db);
    return c.json({ ok: true, deleted });
  });
  app.post("/api/usage/delete-filtered", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const deleted = deleteFilteredTokenUsageRecords(deps.db, {
      sessionId: stringFilter(body.sessionId),
      providerId: stringFilter(body.providerId),
      createdFrom: isoDateFilter(body.createdFrom),
      createdTo: isoDateFilter(body.createdTo),
    });
    return c.json({ ok: true, deleted });
  });
}

export function cleanupTokenUsageRecords(db: Database.Database, retentionDays: number) {
  ensureTokenUsageSchema(db);
  const days = Math.floor(Number(retentionDays));
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare("delete from token_usage_records where created_at < ?").run(cutoff).changes;
}

export function clearTokenUsageRecords(db: Database.Database) {
  ensureTokenUsageSchema(db);
  return db.prepare("delete from token_usage_records").run().changes;
}

export function deleteFilteredTokenUsageRecords(db: Database.Database, filters: UsageFilters) {
  ensureTokenUsageSchema(db);
  if (!hasUsageFilter(filters)) return 0;
  const where = usageWhere(filters);
  return db.prepare(`delete from token_usage_records ${where.sql}`).run(usageParams(filters)).changes;
}

function buildUsageResponse(deps: UsageDeps, filters: UsageFilters): TokenUsageResponse {
  ensureTokenUsageSchema(deps.db);
  const where = usageWhere(filters);
  const baseParams = usageParams(filters);
  const summary = summaryFromRow(deps.db.prepare(`
    select
      coalesce(sum(input_tokens), 0) as input_tokens,
      coalesce(sum(cached_input_tokens), 0) as cached_input_tokens,
      coalesce(sum(output_tokens), 0) as output_tokens,
      coalesce(sum(reasoning_output_tokens), 0) as reasoning_output_tokens,
      coalesce(sum(total_tokens), 0) as total_tokens,
      count(*) as records
    from token_usage_records ${where.sql}
  `).get(baseParams) as Record<string, unknown>);
  const limit = (filters.limit ?? 20) + 1;
  const recentPage = recentRows(deps, filters, limit - 1);
  const recentTotalPages = Math.max(1, Math.ceil(summary.records / (limit - 1)));
  return {
    summary,
    byProvider: bucketRows(deps, "provider", where.sql, { ...baseParams, limit: 10 }),
    byModel: bucketRows(deps, "model", where.sql, { ...baseParams, limit: 10 }),
    bySession: bucketRows(deps, "session", where.sql, { ...baseParams, limit: 10 }),
    recent: recentPage.items,
    recentNextCursor: recentPage.nextCursor,
    recentHasMore: recentPage.hasMore,
    recentPage: recentPage.page,
    recentPageSize: limit - 1,
    recentTotalPages,
  };
}

function recentRows(deps: UsageDeps, filters: UsageFilters, limit: number) {
  if (filters.page !== null && filters.page !== undefined) {
    const page = Math.max(0, Math.floor(filters.page));
    const rows = deps.db.prepare(`
      select * from token_usage_records ${usageWhere(filters).sql}
      order by created_at desc, id desc
      limit @limit offset @offset
    `).all({ ...usageParams(filters), limit: limit + 1, offset: page * limit }) as Array<Record<string, unknown>>;
    const items = rows.slice(0, limit).map(recordFromRow);
    return {
      items,
      hasMore: rows.length > limit,
      nextCursor: null,
      page,
    };
  }
  const cursor = decodePageCursor(filters.cursor);
  const where = usageWhere(filters, cursor);
  const rows = deps.db.prepare(`
    select * from token_usage_records ${where.sql}
    order by created_at desc, id desc
    limit @limit
  `).all({ ...usageParams(filters), cursorSort: cursor?.sortValue, cursorId: cursor?.id, limit: limit + 1 }) as Array<Record<string, unknown>>;
  return { ...pageFromRows(rows.map(recordFromRow), limit, (item) => item.createdAt), page: 0 };
}

function bucketRows(deps: UsageDeps, kind: "provider" | "model" | "session", whereSql: string, params: Record<string, unknown>): TokenUsageBucket[] {
  const keyColumn = kind === "provider" ? "provider_id" : kind === "model" ? "model" : "session_id";
  const snapshotColumn = kind === "provider" ? "provider_name" : kind === "session" ? "session_title" : "model";
  const rows = deps.db.prepare(`
    select
      coalesce(${keyColumn}, '') as bucket_key,
      max(${snapshotColumn}) as snapshot_label,
      ${kind === "provider" ? "provider_id" : "null"} as provider_id,
      ${kind === "model" ? "model" : "null"} as model,
      ${kind === "session" ? "session_id" : "null"} as session_id,
      coalesce(sum(input_tokens), 0) as input_tokens,
      coalesce(sum(cached_input_tokens), 0) as cached_input_tokens,
      coalesce(sum(output_tokens), 0) as output_tokens,
      coalesce(sum(reasoning_output_tokens), 0) as reasoning_output_tokens,
      coalesce(sum(total_tokens), 0) as total_tokens,
      count(*) as records,
      max(created_at) as updated_at
    from token_usage_records ${whereSql}
    group by ${keyColumn}
    order by total_tokens desc, updated_at desc
    limit @limit
  `).all(params) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const sessionId = row.session_id ? String(row.session_id) : null;
    const providerId = row.provider_id ? String(row.provider_id) : null;
    const key = String(row.bucket_key || "unknown");
    const activeSession = sessionId ? deps.sessions.find((session) => session.id === sessionId) : null;
    const activeProvider = providerId ? deps.providers.find((provider) => provider.id === providerId) : null;
    const snapshotLabel = row.snapshot_label ? String(row.snapshot_label) : null;
    return {
      key,
      label: kind === "session" ? activeSession?.title ?? snapshotLabel ?? sessionId ?? key : kind === "provider" ? activeProvider?.name ?? snapshotLabel ?? providerId ?? key : key,
      deleted: kind === "session" ? Boolean(sessionId && !activeSession) : kind === "provider" ? Boolean(providerId && !activeProvider) : false,
      providerId,
      model: row.model ? String(row.model) : null,
      sessionId,
      summary: summaryFromRow(row),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    };
  });
}

function usageWhere(filters: UsageFilters, cursor?: { sortValue: string; id: string } | null) {
  const clauses: string[] = [];
  if (filters.sessionId) clauses.push("session_id = @sessionId");
  if (filters.providerId) clauses.push("provider_id = @providerId");
  if (filters.createdFrom) clauses.push("datetime(created_at) >= datetime(@createdFrom)");
  if (filters.createdTo) clauses.push("datetime(created_at) <= datetime(@createdTo)");
  if (cursor) clauses.push("(created_at < @cursorSort or (created_at = @cursorSort and id < @cursorId))");
  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "" };
}

function usageParams(filters: UsageFilters) {
  return {
    sessionId: filters.sessionId,
    providerId: filters.providerId,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo,
  };
}

function hasUsageFilter(filters: UsageFilters) {
  return Boolean(filters.sessionId || filters.providerId || filters.createdFrom || filters.createdTo);
}

function isoDateFilter(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stringFilter(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordFromRow(row: Record<string, unknown>): TokenUsageRecordSummary {
  const inputTokens = numberValue(row.input_tokens);
  const cachedInputTokens = numberValue(row.cached_input_tokens);
  const outputTokens = numberValue(row.output_tokens);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    sessionTitle: row.session_title ? String(row.session_title) : null,
    messageId: row.message_id ? String(row.message_id) : null,
    taskRunId: row.task_run_id ? String(row.task_run_id) : null,
    providerId: row.provider_id ? String(row.provider_id) : null,
    providerName: row.provider_name ? String(row.provider_name) : null,
    model: row.model ? String(row.model) : null,
    source: String(row.source),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: numberValue(row.reasoning_output_tokens),
    totalTokens: numberValue(row.total_tokens),
    billableInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    createdAt: String(row.created_at),
  };
}

function summaryFromRow(row: Record<string, unknown>): TokenUsageSummary {
  const inputTokens = numberValue(row.input_tokens);
  const cachedInputTokens = numberValue(row.cached_input_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens: numberValue(row.output_tokens),
    reasoningOutputTokens: numberValue(row.reasoning_output_tokens),
    totalTokens: numberValue(row.total_tokens),
    billableInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    records: numberValue(row.records),
  };
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function pageNumber(value?: string | null) {
  if (value === undefined || value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}
