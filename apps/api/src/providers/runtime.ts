import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { ProviderCapabilities, ProviderDetectionResponse, ProviderHealthCheck, ProviderModelsResponse, ProviderSummary, ProviderTestResponse } from "@codex-web/protocol";

type ProviderRecord = ProviderSummary & { apiKey?: string };

type ProviderRuntimeDeps = {
  db: Database.Database;
  providerTimeoutMs: number;
  providerModelsCacheTtlMs: number;
  defaultProviderCapabilities: (kind: ProviderSummary["kind"]) => ProviderCapabilities;
  mergeProviderCapabilities: (kind: ProviderSummary["kind"], value?: Partial<ProviderCapabilities>) => ProviderCapabilities;
  stableJson: (value: unknown) => string;
  stringifyReadable: (value: unknown) => string;
};

export function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function createProviderRuntime(deps: ProviderRuntimeDeps) {
  const { db, providerTimeoutMs, providerModelsCacheTtlMs, defaultProviderCapabilities, mergeProviderCapabilities, stableJson, stringifyReadable } = deps;

function publicProvider(provider: ProviderRecord): ProviderSummary {
  const cachedModels = readProviderModelCache(provider);
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    defaultModel: provider.defaultModel,
    baseUrl: provider.baseUrl,
    apiKeyConfigured: Boolean(provider.apiKey),
    capabilities: provider.capabilities ?? defaultProviderCapabilities(provider.kind),
    models: cachedModels?.models,
    modelsCachedAt: cachedModels?.cachedAt ?? null,
    rpmLimit: provider.rpmLimit ?? null,
    rpmLimitEnabled: provider.rpmLimitEnabled ?? false,
    useProxy: provider.useProxy ?? false,
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

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

function responseInputToChatMessages(input: unknown, instructions?: unknown): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (typeof instructions === "string" && instructions.trim()) messages.push({ role: "system", content: instructions });
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }
  if (!Array.isArray(input)) {
    messages.push({ role: "user", content: stringifyReadable(input) });
    return messages;
  }
  for (const item of input) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
      continue;
    }
    if (!item || typeof item !== "object") {
      messages.push({ role: "user", content: stringifyReadable(item) });
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.type === "message") {
      const role = record.role === "assistant" || record.role === "system" || record.role === "tool" ? record.role : "user";
      messages.push({ role, content: textFromResponseContent(record.content) });
      continue;
    }
    if (typeof record.role === "string" && (record.role === "assistant" || record.role === "system" || record.role === "tool" || record.role === "user")) {
      messages.push({ role: record.role, content: textFromResponseContent(record.content) });
      continue;
    }
    if (record.type === "function_call") {
      const callId = typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : `call-${randomUUID()}`;
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: typeof record.name === "string" ? record.name : "",
            arguments: typeof record.arguments === "string" ? record.arguments : "{}",
          },
        }],
      });
      continue;
    }
    if (record.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : undefined, content: textFromResponseContent(record.output) });
      continue;
    }
    messages.push({ role: "user", content: textFromResponseContent(record.content ?? record.text ?? record) });
  }
  return messages.length ? messages : [{ role: "user", content: "" }];
}

function responseToolsToChatTools(tools: unknown) {
  if (!Array.isArray(tools)) return undefined;
  const converted = tools.map((tool) => {
    if (!tool || typeof tool !== "object") return null;
    const record = tool as Record<string, unknown>;
    if (record.type === "function" && record.name) {
      return {
        type: "function",
        function: {
          name: record.name,
          description: record.description,
          parameters: record.parameters ?? {},
        },
      };
    }
    if (record.type === "function" && record.function) return record;
    return null;
  }).filter(Boolean);
  return converted.length ? converted : undefined;
}

function chatMessageToResponseOutput(message: Record<string, unknown>, responseId: string) {
  const content = typeof message.content === "string" ? message.content : textFromResponseContent(message.content);
  const output: Array<Record<string, unknown>> = [];
  if (content) {
    output.push({
      id: `msg-${responseId}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const record = call as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
    const callId = typeof record.id === "string" ? record.id : `call-${randomUUID()}`;
    output.push({
      id: callId,
      type: "function_call",
      call_id: callId,
      name: typeof fn.name === "string" ? fn.name : "",
      arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
      status: "completed",
    });
  }
  return output.length ? output : [{
    id: `msg-${responseId}`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text: "", annotations: [] }],
  }];
}

function chatCompletionToResponse(payload: Record<string, unknown>, fallbackModel: string) {
  const responseId = typeof payload.id === "string" ? payload.id.replace(/^chatcmpl-/, "resp_") : `resp_${randomUUID()}`;
  const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
  const output = chatMessageToResponseOutput(message, responseId);
  const text = output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? String((item as Record<string, unknown>).text) : "")
    .join("");
  return {
    id: responseId,
    object: "response",
    created_at: typeof payload.created === "number" ? payload.created : Math.floor(Date.now() / 1000),
    status: "completed",
    model: typeof payload.model === "string" ? payload.model : fallbackModel,
    output,
    output_text: text,
    usage: payload.usage ?? null,
  };
}

function responsesRequestToChatCompletion(body: Record<string, unknown>, provider: ProviderRecord) {
  const request: Record<string, unknown> = {
    model: typeof body.model === "string" ? body.model : provider.defaultModel,
    messages: responseInputToChatMessages(body.input, body.instructions),
  };
  if (body.max_output_tokens !== undefined) request.max_tokens = body.max_output_tokens;
  if (body.temperature !== undefined) request.temperature = body.temperature;
  if (body.top_p !== undefined) request.top_p = body.top_p;
  if (body.stream !== undefined) request.stream = body.stream;
  const tools = responseToolsToChatTools(body.tools);
  if (tools) request.tools = tools;
  if (body.tool_choice !== undefined) request.tool_choice = body.tool_choice;
  return request;
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function streamChatCompletionAsResponses(upstream: Response, model: string) {
  const responseId = `resp_${randomUUID()}`;
  const itemId = `msg-${responseId}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let textOutput = "";
  let itemStarted = false;
  let textOutputIndex = 0;
  let nextOutputIndex = 0;
  const functionCalls = new Map<number, { id: string; callId: string; name: string; arguments: string; outputIndex: number }>();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEvent("response.created", { id: responseId, type: "response.created", response: { id: responseId, status: "in_progress", model } })));
      const startTextItem = () => {
        if (itemStarted) return;
        itemStarted = true;
        const outputIndex = nextOutputIndex++;
        textOutputIndex = outputIndex;
        controller.enqueue(encoder.encode(sseEvent("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
        })));
        controller.enqueue(encoder.encode(sseEvent("response.content_part.added", {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        })));
      };
      const finishTextItem = () => {
        if (!itemStarted) return null;
        const part = { type: "output_text", text: textOutput, annotations: [] };
        const outputIndex = textOutputIndex;
        const item = { id: itemId, type: "message", status: "completed", role: "assistant", content: [part] };
        controller.enqueue(encoder.encode(sseEvent("response.output_text.done", {
          type: "response.output_text.done",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          text: textOutput,
        })));
        controller.enqueue(encoder.encode(sseEvent("response.content_part.done", {
          type: "response.content_part.done",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part,
        })));
        controller.enqueue(encoder.encode(sseEvent("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outputIndex,
          item,
        })));
        return item;
      };
      const startFunctionCall = (index: number, deltaCall: Record<string, unknown>) => {
        const existing = functionCalls.get(index);
        const fn = deltaCall.function && typeof deltaCall.function === "object" ? deltaCall.function as Record<string, unknown> : {};
        if (existing) {
          if (!existing.name && typeof fn.name === "string") existing.name = fn.name;
          return existing;
        }
        const callId = typeof deltaCall.id === "string" ? deltaCall.id : `call-${randomUUID()}`;
        const call = {
          id: `fc_${callId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          callId,
          name: typeof fn.name === "string" ? fn.name : "",
          arguments: "",
          outputIndex: nextOutputIndex++,
        };
        functionCalls.set(index, call);
        controller.enqueue(encoder.encode(sseEvent("response.output_item.added", {
          type: "response.output_item.added",
          output_index: call.outputIndex,
          item: { id: call.id, type: "function_call", status: "in_progress", call_id: call.callId, name: call.name, arguments: "" },
        })));
        return call;
      };
      const finishFunctionCalls = () => {
        const items: Array<Record<string, unknown>> = [];
        for (const call of [...functionCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
          const item = { id: call.id, type: "function_call", status: "completed", call_id: call.callId, name: call.name, arguments: call.arguments };
          controller.enqueue(encoder.encode(sseEvent("response.function_call_arguments.done", {
            type: "response.function_call_arguments.done",
            item_id: call.id,
            output_index: call.outputIndex,
            arguments: call.arguments,
          })));
          controller.enqueue(encoder.encode(sseEvent("response.output_item.done", {
            type: "response.output_item.done",
            output_index: call.outputIndex,
            item,
          })));
          items.push(item);
        }
        return items;
      };
      const splitSseEvents = (input: string) => {
        const events: string[] = [];
        let rest = input;
        while (true) {
          const match = rest.match(/\r?\n\r?\n/);
          if (!match || match.index === undefined) break;
          events.push(rest.slice(0, match.index));
          rest = rest.slice(match.index + match[0].length);
        }
        return { events, rest };
      };
      const sseDataPayloads = (eventBlock: string) => {
        const dataLines = eventBlock
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""));
        if (!dataLines.length) return [];
        const joined = dataLines.join("\n").trim();
        if (dataLines.length === 1) return joined ? [joined] : [];
        try {
          JSON.parse(joined);
          return [joined];
        } catch {
          return dataLines.map((line) => line.trim()).filter(Boolean);
        }
      };
      const processChatCompletionData = (data: string) => {
        if (!data || data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data) as Record<string, unknown>;
          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] as Record<string, unknown> | undefined : undefined;
          const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
          const content = delta.content;
          const text = typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((part) => {
                if (typeof part === "string") return part;
                if (!part || typeof part !== "object") return "";
                const record = part as Record<string, unknown>;
                return typeof record.text === "string" ? record.text : "";
              }).join("")
              : "";
          if (text) {
            startTextItem();
            textOutput += text;
            controller.enqueue(encoder.encode(sseEvent("response.output_text.delta", { type: "response.output_text.delta", item_id: itemId, output_index: textOutputIndex, content_index: 0, delta: text })));
          }
          const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
          for (const toolCall of toolCalls) {
            if (!toolCall || typeof toolCall !== "object") continue;
            const record = toolCall as Record<string, unknown>;
            const index = typeof record.index === "number" ? record.index : functionCalls.size;
            const call = startFunctionCall(index, record);
            const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
            const argumentsDelta = typeof fn.arguments === "string" ? fn.arguments : "";
            if (argumentsDelta) {
              call.arguments += argumentsDelta;
              controller.enqueue(encoder.encode(sseEvent("response.function_call_arguments.delta", {
                type: "response.function_call_arguments.delta",
                item_id: call.id,
                output_index: call.outputIndex,
                delta: argumentsDelta,
              })));
            }
          }
        } catch {
          // Ignore malformed upstream SSE chunks and continue streaming.
        }
      };
      const processSseEventBlock = (eventBlock: string) => {
        for (const data of sseDataPayloads(eventBlock)) processChatCompletionData(data);
      };
      const reader = upstream.body?.getReader();
      if (!reader) {
        const item = finishTextItem() ?? { id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] };
        controller.enqueue(encoder.encode(sseEvent("response.completed", { type: "response.completed", response: { id: responseId, status: "completed", model, output: [item] } })));
        controller.close();
        return;
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const split = splitSseEvents(buffer);
        buffer = split.rest;
        for (const eventBlock of split.events) processSseEventBlock(eventBlock);
      }
      buffer += decoder.decode();
      const split = splitSseEvents(buffer);
      for (const eventBlock of split.events) processSseEventBlock(eventBlock);
      if (split.rest.trim()) processSseEventBlock(split.rest);
      buffer = "";
      const output = [finishTextItem(), ...finishFunctionCalls()].filter(Boolean);
      if (!output.length) output.push({ id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] });
      controller.enqueue(encoder.encode(sseEvent("response.completed", { type: "response.completed", response: { id: responseId, status: "completed", model, output } })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function proxyResponsesToChatCompletions(provider: ProviderRecord, body: Record<string, unknown>) {
  if (!provider.baseUrl) return new Response(JSON.stringify({ error: "base_url_required" }), { status: 400, headers: { "content-type": "application/json" } });
  const chatRequest = responsesRequestToChatCompletion(body, provider);
  const upstream = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(chatRequest),
  });
  if (!upstream.ok) {
    return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" } });
  }
  if (body.stream === true) return streamChatCompletionAsResponses(upstream, String(chatRequest.model ?? provider.defaultModel));
  const payload = await upstream.json() as Record<string, unknown>;
  return new Response(JSON.stringify(chatCompletionToResponse(payload, String(chatRequest.model ?? provider.defaultModel))), { headers: { "content-type": "application/json" } });
}

async function proxyResponsesToResponses(provider: ProviderRecord, body: Record<string, unknown>) {
  if (!provider.baseUrl) return new Response(JSON.stringify({ error: "base_url_required" }), { status: 400, headers: { "content-type": "application/json" } });
  const upstream = await fetch(joinUrl(provider.baseUrl, "/responses"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? (body.stream === true ? "text/event-stream; charset=utf-8" : "application/json"));
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function probeProviderInterface(provider: ProviderRecord, kind: "responses" | "chatCompletions") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  const startedAt = Date.now();
  try {
    if (provider.kind !== "local" && !provider.apiKey) return { ok: false, status: null, durationMs: 0, error: "api_key_missing" };
    if (kind === "responses") {
      const baseUrl = provider.baseUrl || "https://api.openai.com/v1";
      const response = await fetch(joinUrl(baseUrl, "/responses"), {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: provider.defaultModel, input: "ping", max_output_tokens: 1 }),
      });
      return { ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, error: response.ok ? undefined : (await response.text()).slice(0, 240) };
    }
    if (!provider.baseUrl) return { ok: false, status: null, durationMs: 0, error: "base_url_required" };
    const response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: provider.defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    });
    return { ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, error: response.ok ? undefined : (await response.text()).slice(0, 240) };
  } catch (error) {
    return { ok: false, status: null, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "provider_probe_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function detectProviderInterface(provider: ProviderRecord): Promise<ProviderDetectionResponse> {
  const startedAt = Date.now();
  if (!provider.defaultModel?.trim()) {
    return {
      ok: false,
      providerId: provider.id,
      kind: provider.kind,
      capabilities: provider.capabilities ?? defaultProviderCapabilities(provider.kind),
      durationMs: 0,
      checks: {
        responses: { ok: false, status: null, error: "default_model_required" },
        chatCompletions: { ok: false, status: null, error: "default_model_required" },
      },
      error: "default_model_required",
    };
  }
  const [responses, chatCompletions] = await Promise.all([
    probeProviderInterface(provider, "responses"),
    probeProviderInterface(provider, "chatCompletions"),
  ]);
  const detectedKind: ProviderSummary["kind"] = responses.ok ? "openai-responses" : chatCompletions.ok ? "openai-compatible-chat" : provider.kind;
  const capabilities = mergeProviderCapabilities(detectedKind, {
    responsesApi: responses.ok,
    chatCompletions: chatCompletions.ok,
    tools: detectedKind !== "local",
    jsonMode: detectedKind !== "local",
    streaming: true,
  });
  return {
    ok: responses.ok || chatCompletions.ok,
    providerId: provider.id,
    kind: detectedKind,
    capabilities,
    durationMs: Date.now() - startedAt,
    checks: {
      responses: { ok: responses.ok, status: responses.status, error: responses.error },
      chatCompletions: { ok: chatCompletions.ok, status: chatCompletions.status, error: chatCompletions.error },
    },
    error: responses.ok || chatCompletions.ok ? undefined : responses.error ?? chatCompletions.error ?? "provider_detection_failed",
  };
}

async function testProvider(provider: ProviderRecord): Promise<ProviderTestResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    if (provider.kind !== "local" && !provider.apiKey) {
      return { ok: false, providerId: provider.id, status: null, durationMs: Date.now() - startedAt, error: "api_key_missing" };
    }
    let response: Response;
    if (provider.kind === "openai-responses") {
      response = await fetch(joinUrl(provider.baseUrl || "https://api.openai.com/v1", "/responses"), {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: provider.defaultModel, input: "ping", max_output_tokens: 16 }),
        signal: controller.signal,
      });
    } else if (provider.kind === "openai-compatible-chat") {
      if (!provider.baseUrl) throw new Error("base_url_required");
      response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: provider.defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 16 }),
        signal: controller.signal,
      });
    } else {
      if (!provider.baseUrl) throw new Error("base_url_required");
      response = await fetch(joinUrl(provider.baseUrl, "/health"), { signal: controller.signal });
    }
    return {
      ok: response.ok,
      providerId: provider.id,
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: response.ok ? undefined : await response.text() || `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      providerId: provider.id,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "provider_test_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverProviderModels(provider: ProviderRecord): Promise<ProviderModelsResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    if (provider.kind !== "local" && !provider.apiKey) {
      return { ok: false, providerId: provider.id, models: [], status: null, durationMs: Date.now() - startedAt, error: "api_key_missing" };
    }
    const baseUrl = provider.baseUrl || (provider.kind === "openai-responses" ? "https://api.openai.com/v1" : "");
    if (!baseUrl) throw new Error("base_url_required");
    const response = await fetch(joinUrl(baseUrl, "/models"), {
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }>; models?: string[] };
    const models = Array.isArray(payload.data)
      ? payload.data.map((item) => item.id).filter((id): id is string => Boolean(id))
      : Array.isArray(payload.models) ? payload.models : [];
    return {
      ok: response.ok,
      providerId: provider.id,
      models: models.sort(),
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      providerId: provider.id,
      models: [],
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "provider_models_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function providerModelCacheKey(provider: ProviderRecord) {
  return stableJson({
    kind: provider.kind,
    baseUrl: provider.baseUrl ?? "",
    defaultModel: provider.defaultModel ?? "",
    apiKeyHash: provider.apiKey ? createHash("sha256").update(provider.apiKey).digest("hex") : "",
  });
}

function readProviderModelCache(provider: ProviderRecord): (ProviderModelsResponse & { cachedAt: string }) | null {
  const row = db.prepare("select cache_key, models, cached_at from provider_model_cache where provider_id = ?").get(provider.id) as
    | { cache_key: string; models: string; cached_at: string }
    | undefined;
  if (!row || row.cache_key !== providerModelCacheKey(provider)) return null;
  const age = Date.now() - new Date(row.cached_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > providerModelsCacheTtlMs) return null;
  try {
    const models = JSON.parse(row.models) as unknown;
    if (!Array.isArray(models) || !models.every((item) => typeof item === "string")) return null;
    return { ok: true, providerId: provider.id, models, status: null, durationMs: 0, cachedAt: row.cached_at };
  } catch {
    return null;
  }
}

function saveProviderModelCache(provider: ProviderRecord, result: ProviderModelsResponse) {
  if (!result.ok || !result.models.length) return;
  db.prepare(`
    insert into provider_model_cache (provider_id, cache_key, models, cached_at)
    values (?, ?, ?, ?)
    on conflict(provider_id) do update set
      cache_key = excluded.cache_key,
      models = excluded.models,
      cached_at = excluded.cached_at
  `).run(provider.id, providerModelCacheKey(provider), JSON.stringify(result.models), new Date().toISOString());
}

function clearProviderModelCache(providerId: string) {
  db.prepare("delete from provider_model_cache where provider_id = ?").run(providerId);
}

function recordProviderHealthCheck(providerId: string, kind: ProviderHealthCheck["kind"], result: ProviderTestResponse | ProviderModelsResponse) {
  db.prepare(`
    insert into provider_health_checks (id, provider_id, kind, ok, status, duration_ms, error, checked_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `provider-check-${randomUUID()}`,
    providerId,
    kind,
    result.ok ? 1 : 0,
    result.status,
    result.durationMs,
    result.error ?? null,
    new Date().toISOString(),
  );
}


  return {
    clearProviderModelCache,
    detectProviderInterface,
    discoverProviderModels,
    joinUrl,
    proxyResponsesToChatCompletions,
    proxyResponsesToResponses,
    publicProvider,
    readProviderModelCache,
    recordProviderHealthCheck,
    saveProviderModelCache,
    testProvider,
  };
}
