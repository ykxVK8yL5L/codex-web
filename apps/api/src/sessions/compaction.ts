import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateSessionCompactionRequest, ProviderSummary, SessionCompactionListResponse, SessionCompactionResponse, SessionCompactionSettings, SessionCompactionSummary, SessionMessage, SessionSummary } from "@codex-web/protocol";
import type { TaskEvent } from "../tasks/events.js";

type ProviderRecord = ProviderSummary & { apiKey?: string };

type SessionCompactionRuntimeDeps = {
  allSessionMessages: (sessionId: string) => SessionMessage[];
  appendCodexErrorOutput: (session: SessionSummary, value: string) => void;
  appData: { providers: ProviderRecord[] };
  db: Database.Database;
  getSessionCompactionSettings: () => SessionCompactionSettings;
  joinUrl: (baseUrl: string, path: string) => string;
  publishTaskEvent: (sessionId: string, event: TaskEvent) => void;
  recordTaskActivity: (sessionId: string, activity: Extract<TaskEvent, { type: "activity" }>) => void;
  sessionMemoryPath: (sessionId: string) => string;
};

function stringifyReadable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function textFromResponseContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return stringifyReadable(value);
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return typeof record.text === "string"
      ? record.text
      : typeof record.input_text === "string"
        ? record.input_text
        : typeof record.output_text === "string"
          ? record.output_text
          : "";
  }).filter(Boolean).join("\n");
}

function truncateContextText(value: string, limit = 1200) {
  const text = value.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

export function createSessionCompactionRuntime(deps: SessionCompactionRuntimeDeps) {
  const { allSessionMessages, appendCodexErrorOutput, appData, db, getSessionCompactionSettings, joinUrl, publishTaskEvent, recordTaskActivity, sessionMemoryPath } = deps;

function sessionCompactionFromRow(row: Record<string, unknown>): SessionCompactionSummary {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    providerId: row.provider_id ? String(row.provider_id) : null,
    model: row.model ? String(row.model) : null,
    sourceMessageStartId: row.source_message_start_id ? String(row.source_message_start_id) : null,
    sourceMessageEndId: row.source_message_end_id ? String(row.source_message_end_id) : null,
    sourceMessageCount: Number(row.source_message_count ?? 0),
    sourceChars: Number(row.source_chars ?? 0),
    promptHash: String(row.prompt_hash),
    filePath: String(row.file_path),
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
    createdAt: String(row.created_at),
  };
}

function latestSessionCompaction(sessionId: string) {
  const row = db.prepare(`
    select *
    from session_compactions
    where session_id = ?
    order by created_at desc, id desc
    limit 1
  `).get(sessionId) as Record<string, unknown> | undefined;
  return row ? sessionCompactionFromRow(row) : null;
}

function listSessionCompactions(sessionId: string, limit = 20): SessionCompactionListResponse {
  const rows = db.prepare(`
    select *
    from session_compactions
    where session_id = ?
    order by created_at desc, id desc
    limit ?
  `).all(sessionId, Math.max(1, Math.min(limit, 100))) as Array<Record<string, unknown>>;
  return { sessionId, items: rows.map(sessionCompactionFromRow) };
}

function latestSessionMemoryMarkdown(sessionId: string) {
  const latest = latestSessionCompaction(sessionId);
  if (!latest) return "";
  const fileContent = existsSync(latest.filePath) ? readFileSync(latest.filePath, "utf8") : "";
  const summary = fileContent.trim();
  if (!summary) return "";
  return [
    "# Persistent Session Memory",
    `- compaction id: ${latest.id}`,
    `- created: ${latest.createdAt}`,
    `- source messages: ${latest.sourceMessageCount}`,
    latest.providerId ? `- provider: ${latest.providerId}` : "",
    latest.model ? `- model: ${latest.model}` : "",
    "",
    summary,
  ].filter((line) => line !== "").join("\n");
}

function messagesAfterCompaction(messages: SessionMessage[], compaction: SessionCompactionSummary | null) {
  if (!compaction?.sourceMessageEndId) return messages;
  const index = messages.findIndex((message) => message.id === compaction.sourceMessageEndId);
  return index >= 0 ? messages.slice(index + 1) : messages;
}

function sessionCompactionPrompt(session: SessionSummary, messages: SessionMessage[], previousSummary = "") {
  const transcript = messages.map((message) => [
    `## ${message.role} ${message.createdAt}`,
    `- id: ${message.id}`,
    message.replyToMessageId ? `- replyTo: ${message.replyToMessageId}` : "",
    "",
    truncateContextText(message.content, 4000),
  ].filter((line) => line !== "").join("\n")).join("\n\n");
  return [
    "Create a durable session memory summary for Codex Web.",
    "Return Markdown only. Be concise but preserve information needed for future turns.",
    "",
    "Required sections:",
    "## Stable User Preferences",
    "## Decisions",
    "## Current Task State",
    "## Open Questions",
    "## Important Files And References",
    "## Risks Or Constraints",
    "",
    "Rules:",
    "- Preserve concrete decisions, user preferences, task state, blockers, and key file paths.",
    "- Do not include generic greetings or low-value chatter.",
    "- Do not invent facts not present in the transcript.",
    "- Keep the summary bounded; prefer bullets.",
    previousSummary ? "- Update the previous summary with the new transcript. Return a complete replacement summary, not a delta." : "",
    "",
    `Session: ${session.title} (${session.id})`,
    `Type: ${session.conversationType ?? "codex"}`,
    "",
    previousSummary ? "# Previous Persistent Summary" : "",
    previousSummary ? truncateContextText(previousSummary, 20_000) : "",
    previousSummary ? "" : "",
    "# Transcript",
    truncateContextText(transcript, 80_000),
  ].join("\n");
}

function textFromResponseContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return stringifyReadable(value);
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return typeof record.text === "string"
      ? record.text
      : typeof record.input_text === "string"
        ? record.input_text
        : typeof record.output_text === "string"
          ? record.output_text
          : "";
  }).filter(Boolean).join("\n");
}

function responseOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.map((item) => {
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return textFromResponseContent(record.content);
  }).filter(Boolean).join("\n").trim();
}

async function generateSessionCompactionSummary(session: SessionSummary, provider: ProviderRecord, model: string, prompt: string) {
  if (provider.kind === "local") throw new Error("provider_compaction_unsupported");
  if (!provider.apiKey) throw new Error("api_key_missing");
  if (provider.kind === "openai-compatible-chat") {
    if (!provider.baseUrl) throw new Error("base_url_required");
    const response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You summarize software-development conversations into durable session memory." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
      }),
    });
    if (!response.ok) throw new Error(await response.text() || `http_${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined;
    const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!content) throw new Error("empty_compaction_summary");
    return content;
  }
  const response = await fetch(joinUrl(provider.baseUrl || "https://api.openai.com/v1", "/responses"), {
    method: "POST",
    headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 1600,
    }),
  });
  if (!response.ok) throw new Error(await response.text() || `http_${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const content = responseOutputText(payload);
  if (!content) throw new Error("empty_compaction_summary");
  return content;
}

async function createSessionCompaction(session: SessionSummary, body?: CreateSessionCompactionRequest | null, options: { incremental?: boolean } = {}): Promise<SessionCompactionResponse> {
  const allMessages = allSessionMessages(session.id).filter((message) => message.role !== "system");
  const previous = latestSessionCompaction(session.id);
  const previousSummary = options.incremental && previous ? latestSessionMemoryMarkdown(session.id) : "";
  const messages = options.incremental ? messagesAfterCompaction(allMessages, previous) : allMessages;
  if (!messages.length) throw new Error("no_messages_to_compact");
  const provider = appData.providers.find((item) => item.id === body?.providerId)
    ?? (session.providerId ? appData.providers.find((item) => item.id === session.providerId) : undefined)
    ?? appData.providers.find((item) => item.kind !== "local" && item.apiKey);
  if (!provider) throw new Error("provider_required");
  const model = body?.model?.trim() || session.model || provider.defaultModel;
  if (!model) throw new Error("model_required");
  const prompt = sessionCompactionPrompt(session, messages, previousSummary);
  const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
  const summary = await generateSessionCompactionSummary(session, provider, model, prompt);
  const id = `compaction-${randomUUID()}`;
  const now = new Date().toISOString();
  const memoryRoot = sessionMemoryPath(session.id);
  mkdirSync(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, `${id}.md`);
  const latestPath = join(memoryRoot, "latest-summary.md");
  writeFileSync(filePath, summary, "utf8");
  writeFileSync(latestPath, summary, "utf8");
  const sourceChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  db.prepare(`
    insert into session_compactions (
      id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
      source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    session.id,
    provider.id,
    model,
    messages[0]?.id ?? null,
    messages.at(-1)?.id ?? null,
    messages.length,
    sourceChars,
    promptHash,
    filePath,
    previous?.id ?? null,
    now,
  );
  return { compaction: latestSessionCompaction(session.id)!, summary };
}

function updateLatestSessionCompaction(session: SessionSummary, summary: string): SessionCompactionResponse {
  const previous = latestSessionCompaction(session.id);
  if (!previous) throw new Error("session_compaction_not_found");
  const trimmed = summary.trim();
  if (!trimmed) throw new Error("summary_required");
  const id = `compaction-${randomUUID()}`;
  const now = new Date().toISOString();
  const memoryRoot = sessionMemoryPath(session.id);
  mkdirSync(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, `${id}.md`);
  writeFileSync(filePath, trimmed, "utf8");
  writeFileSync(join(memoryRoot, "latest-summary.md"), trimmed, "utf8");
  const promptHash = createHash("sha256").update(`manual-edit:${trimmed}`).digest("hex").slice(0, 16);
  db.prepare(`
    insert into session_compactions (
      id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
      source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    session.id,
    null,
    "manual-edit",
    previous.sourceMessageStartId ?? null,
    previous.sourceMessageEndId ?? null,
    previous.sourceMessageCount,
    previous.sourceChars,
    promptHash,
    filePath,
    previous.id,
    now,
  );
  return { compaction: latestSessionCompaction(session.id)!, summary: trimmed };
}

function restoreSessionCompaction(session: SessionSummary, compactionId: string): SessionCompactionResponse {
  const target = db.prepare("select * from session_compactions where session_id = ? and id = ?").get(session.id, compactionId) as Record<string, unknown> | undefined;
  if (!target) throw new Error("session_compaction_not_found");
  const targetCompaction = sessionCompactionFromRow(target);
  const summary = existsSync(targetCompaction.filePath) ? readFileSync(targetCompaction.filePath, "utf8").trim() : "";
  if (!summary) throw new Error("summary_missing");
  const previous = latestSessionCompaction(session.id);
  const id = `compaction-${randomUUID()}`;
  const now = new Date().toISOString();
  const memoryRoot = sessionMemoryPath(session.id);
  mkdirSync(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, `${id}.md`);
  writeFileSync(filePath, summary, "utf8");
  writeFileSync(join(memoryRoot, "latest-summary.md"), summary, "utf8");
  const promptHash = createHash("sha256").update(`manual-restore:${targetCompaction.id}:${summary}`).digest("hex").slice(0, 16);
  db.prepare(`
    insert into session_compactions (
      id, session_id, provider_id, model, source_message_start_id, source_message_end_id,
      source_message_count, source_chars, prompt_hash, file_path, supersedes_id, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    session.id,
    null,
    "manual-restore",
    targetCompaction.sourceMessageStartId ?? null,
    targetCompaction.sourceMessageEndId ?? null,
    targetCompaction.sourceMessageCount,
    targetCompaction.sourceChars,
    promptHash,
    filePath,
    previous?.id ?? null,
    now,
  );
  return { compaction: latestSessionCompaction(session.id)!, summary };
}

const runningAutoCompactions = new Set<string>();

function shouldAutoCompactSession(session: SessionSummary) {
  if (!getSessionCompactionSettings().enabled) return false;
  if (runningAutoCompactions.has(session.id)) return false;
  const messages = allSessionMessages(session.id).filter((message) => message.role !== "system");
  if (!messages.length) return false;
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (messages.length < getSessionCompactionSettings().autoCompactMessages && totalChars < getSessionCompactionSettings().autoCompactChars) return false;
  const latest = latestSessionCompaction(session.id);
  const newMessages = messagesAfterCompaction(messages, latest);
  if (!newMessages.length) return false;
  const newChars = newMessages.reduce((sum, message) => sum + message.content.length, 0);
  if (!latest) return true;
  return newMessages.length >= getSessionCompactionSettings().minNewMessages || newChars >= getSessionCompactionSettings().minNewChars;
}

function scheduleSessionAutoCompaction(session: SessionSummary, reason: string) {
  if (!shouldAutoCompactSession(session)) return;
  runningAutoCompactions.add(session.id);
  void createSessionCompaction(session, null, { incremental: true })
    .then((result) => {
      const activity: Extract<TaskEvent, { type: "activity" }> = {
        type: "activity",
        kind: "tool",
        label: "会话记忆已自动压缩",
        detail: `${reason}; ${result.compaction.sourceMessageCount} new messages`,
        status: "completed",
        at: result.compaction.createdAt,
      };
      recordTaskActivity(session.id, activity);
      publishTaskEvent(session.id, activity);
    })
    .catch((error) => {
      appendCodexErrorOutput(session, `\n[session compaction failed] ${error instanceof Error ? error.message : String(error)}\n`);
      recordTaskActivity(session.id, {
        type: "activity",
        kind: "tool",
        label: "会话记忆自动压缩失败",
        detail: error instanceof Error ? error.message : String(error),
        status: "failed",
        at: new Date().toISOString(),
      });
    })
    .finally(() => {
      runningAutoCompactions.delete(session.id);
    });
}



  return {
    createSessionCompaction,
    latestSessionCompaction,
    latestSessionMemoryMarkdown,
    listSessionCompactions,
    messagesAfterCompaction,
    restoreSessionCompaction,
    scheduleSessionAutoCompaction,
    sessionCompactionFromRow,
    sessionCompactionPrompt,
    shouldAutoCompactSession,
    updateLatestSessionCompaction,
  };
}
