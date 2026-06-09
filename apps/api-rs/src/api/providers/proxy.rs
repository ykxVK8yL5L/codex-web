use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, Response, StatusCode},
};
use futures_util::{StreamExt, TryStreamExt};
use reqwest::Client;

use super::models::ProviderRecord;
use super::payload_rules::apply_payload_rewrite_rules;
use crate::api::settings::models::PayloadRewriteRule;

pub async fn proxy_responses(
    provider: &ProviderRecord,
    headers: &HeaderMap,
    body: serde_json::Value,
    rules: &[PayloadRewriteRule],
) -> Result<Response<Body>, (StatusCode, serde_json::Value)> {
    authorize(provider, headers)?;
    match provider.summary.kind.as_str() {
        "openai-compatible-chat" => proxy_chat(provider, body, rules).await,
        "openai-responses" if provider.summary.use_proxy => {
            proxy_responses_api(provider, body, rules).await
        }
        _ => Err((
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "provider_proxy_not_enabled" }),
        )),
    }
}

async fn proxy_chat(
    provider: &ProviderRecord,
    body: serde_json::Value,
    rules: &[PayloadRewriteRule],
) -> Result<Response<Body>, (StatusCode, serde_json::Value)> {
    let base_url = provider.summary.base_url.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "base_url_required" }),
        )
    })?;
    let chat_request = apply_payload_rewrite_rules(provider, responses_to_chat_request(provider, &body), &rules);
    let mut request = Client::new()
        .post(join_url(base_url, "/chat/completions"))
        .json(&chat_request);
    if let Some(api_key) = provider
        .api_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        request = request.bearer_auth(api_key);
    }
    let upstream = request.send().await.map_err(|error| {
        (
            StatusCode::BAD_GATEWAY,
            serde_json::json!({ "error": error.to_string() }),
        )
    })?;
    let status = upstream.status();
    if body
        .get("stream")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        if !status.is_success() {
            let payload = upstream.text().await.unwrap_or_default();
            return response(status, payload, "application/json");
        }
        return stream_chat_as_responses(upstream, provider.summary.default_model.as_str()).await;
    }
    let payload = upstream.text().await.unwrap_or_default();
    if !status.is_success() {
        return response(status, payload, "application/json");
    }
    let parsed = serde_json::from_str::<serde_json::Value>(&payload)
        .unwrap_or_else(|_| serde_json::json!({}));
    let response_payload = chat_to_response(provider, parsed);
    response(
        StatusCode::OK,
        serde_json::to_string(&response_payload).unwrap_or_else(|_| "{}".to_string()),
        "application/json",
    )
}

async fn proxy_responses_api(
    provider: &ProviderRecord,
    body: serde_json::Value,
    rules: &[PayloadRewriteRule],
) -> Result<Response<Body>, (StatusCode, serde_json::Value)> {
    let base_url = provider
        .summary
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1");
    let mut request = Client::new()
        .post(join_url(base_url, "/responses"))
        .json(&apply_payload_rewrite_rules(provider, body.clone(), &rules));
    if let Some(api_key) = provider
        .api_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        request = request.bearer_auth(api_key);
    }
    let upstream = request.send().await.map_err(|error| {
        (
            StatusCode::BAD_GATEWAY,
            serde_json::json!({ "error": error.to_string() }),
        )
    })?;
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    if body
        .get("stream")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        let stream = upstream
            .bytes_stream()
            .map_ok(axum::body::Bytes::from)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error));
        let mut response = Response::new(Body::from_stream(stream));
        *response.status_mut() = status;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&content_type)
                .unwrap_or_else(|_| HeaderValue::from_static("text/event-stream; charset=utf-8")),
        );
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        return Ok(response);
    }
    let payload = upstream.text().await.unwrap_or_default();
    response(status, payload, &content_type)
}

async fn stream_chat_as_responses(
    upstream: reqwest::Response,
    model: &str,
) -> Result<Response<Body>, (StatusCode, serde_json::Value)> {
    #[derive(Clone)]
    struct FunctionCallState {
        id: String,
        call_id: String,
        name: String,
        arguments: String,
        output_index: usize,
    }

    let response_id = format!("resp_{}", random_hex(16));
    let item_id = format!("msg-{response_id}");
    let model = model.to_string();
    let stream = async_stream::stream! {
        use std::collections::BTreeMap;

        yield Ok::<bytes::Bytes, std::io::Error>(sse_bytes("response.created", serde_json::json!({
            "id": response_id,
            "type": "response.created",
            "response": { "id": response_id, "status": "in_progress", "model": model }
        })));

        let mut buffer = String::new();
        let mut text_output = String::new();
        let mut item_started = false;
        let mut text_output_index: usize = 0;
        let mut next_output_index: usize = 0;
        let mut function_calls: BTreeMap<usize, FunctionCallState> = BTreeMap::new();
        let mut usage = serde_json::Value::Null;
        let mut upstream_stream = upstream.bytes_stream();

        while let Some(chunk) = upstream_stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    yield Err(std::io::Error::new(std::io::ErrorKind::Other, error));
                    return;
                }
            };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            let (events, rest) = split_sse_events(&buffer);
            buffer = rest;
            for event in events {
                for data in sse_data_payloads(&event) {
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }
                    if let Some(next_usage) = chat_stream_usage(&data) {
                        usage = next_usage;
                    }
                    let Some((text, tool_calls)) = chat_stream_delta(&data) else {
                        continue;
                    };
                    if !text.is_empty() {
                        if !item_started {
                            item_started = true;
                            text_output_index = next_output_index;
                            next_output_index += 1;
                            yield Ok(sse_bytes("response.output_item.added", serde_json::json!({
                                "type": "response.output_item.added",
                                "output_index": text_output_index,
                                "item": { "id": item_id, "type": "message", "status": "in_progress", "role": "assistant", "content": [] }
                            })));
                            yield Ok(sse_bytes("response.content_part.added", serde_json::json!({
                                "type": "response.content_part.added",
                                "item_id": item_id,
                                "output_index": text_output_index,
                                "content_index": 0,
                                "part": { "type": "output_text", "text": "", "annotations": [] }
                            })));
                        }
                        text_output.push_str(&text);
                        yield Ok(sse_bytes("response.output_text.delta", serde_json::json!({
                            "type": "response.output_text.delta",
                            "item_id": item_id,
                            "output_index": text_output_index,
                            "content_index": 0,
                            "delta": text
                        })));
                    }
                    for call_delta in tool_calls {
                        let index = call_delta.index.unwrap_or(function_calls.len());
                        if !function_calls.contains_key(&index) {
                            let call_id = call_delta.call_id.unwrap_or_else(|| format!("call-{}", random_hex(16)));
                            let safe_call_id = call_id.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' { ch } else { '_' }).collect::<String>();
                            let call = FunctionCallState {
                                id: format!("fc_{safe_call_id}"),
                                call_id,
                                name: call_delta.name.unwrap_or_default(),
                                arguments: String::new(),
                                output_index: next_output_index,
                            };
                            next_output_index += 1;
                            yield Ok(sse_bytes("response.output_item.added", serde_json::json!({
                                "type": "response.output_item.added",
                                "output_index": call.output_index,
                                "item": { "id": call.id, "type": "function_call", "status": "in_progress", "call_id": call.call_id, "name": call.name, "arguments": "" }
                            })));
                            function_calls.insert(index, call);
                        } else if let Some(name) = call_delta.name.filter(|value| !value.is_empty()) {
                            if let Some(call) = function_calls.get_mut(&index) {
                                if call.name.is_empty() {
                                    call.name = name;
                                }
                            }
                        }
                        if let Some(arguments_delta) = call_delta.arguments.filter(|value| !value.is_empty()) {
                            if let Some(call) = function_calls.get_mut(&index) {
                                call.arguments.push_str(&arguments_delta);
                                let call_id = call.id.clone();
                                let output_index = call.output_index;
                                yield Ok(sse_bytes("response.function_call_arguments.delta", serde_json::json!({
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": call_id,
                                    "output_index": output_index,
                                    "delta": arguments_delta
                                })));
                            }
                        }
                    }
                }
            }
        }
        if !buffer.trim().is_empty() {
            let (events, rest) = split_sse_events(&buffer);
            for event in events.into_iter().chain(if rest.trim().is_empty() { Vec::new() } else { vec![rest] }) {
                for data in sse_data_payloads(&event) {
                    if data.is_empty() || data == "[DONE]" { continue; }
                    if let Some(next_usage) = chat_stream_usage(&data) {
                        usage = next_usage;
                    }
                    let Some((text, tool_calls)) = chat_stream_delta(&data) else { continue; };
                    if !text.is_empty() {
                        if !item_started {
                            item_started = true;
                            text_output_index = next_output_index;
                            next_output_index += 1;
                            yield Ok(sse_bytes("response.output_item.added", serde_json::json!({
                                "type": "response.output_item.added",
                                "output_index": text_output_index,
                                "item": { "id": item_id, "type": "message", "status": "in_progress", "role": "assistant", "content": [] }
                            })));
                            yield Ok(sse_bytes("response.content_part.added", serde_json::json!({
                                "type": "response.content_part.added",
                                "item_id": item_id,
                                "output_index": text_output_index,
                                "content_index": 0,
                                "part": { "type": "output_text", "text": "", "annotations": [] }
                            })));
                        }
                        text_output.push_str(&text);
                        yield Ok(sse_bytes("response.output_text.delta", serde_json::json!({
                            "type": "response.output_text.delta",
                            "item_id": item_id,
                            "output_index": text_output_index,
                            "content_index": 0,
                            "delta": text
                        })));
                    }
                    for call_delta in tool_calls {
                        let index = call_delta.index.unwrap_or(function_calls.len());
                        if !function_calls.contains_key(&index) {
                            let call_id = call_delta.call_id.unwrap_or_else(|| format!("call-{}", random_hex(16)));
                            let safe_call_id = call_id.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' { ch } else { '_' }).collect::<String>();
                            let call = FunctionCallState { id: format!("fc_{safe_call_id}"), call_id, name: call_delta.name.unwrap_or_default(), arguments: String::new(), output_index: next_output_index };
                            next_output_index += 1;
                            yield Ok(sse_bytes("response.output_item.added", serde_json::json!({
                                "type": "response.output_item.added",
                                "output_index": call.output_index,
                                "item": { "id": call.id, "type": "function_call", "status": "in_progress", "call_id": call.call_id, "name": call.name, "arguments": "" }
                            })));
                            function_calls.insert(index, call);
                        }
                        if let Some(arguments_delta) = call_delta.arguments.filter(|value| !value.is_empty()) {
                            if let Some(call) = function_calls.get_mut(&index) {
                                call.arguments.push_str(&arguments_delta);
                                yield Ok(sse_bytes("response.function_call_arguments.delta", serde_json::json!({
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": call.id,
                                    "output_index": call.output_index,
                                    "delta": arguments_delta
                                })));
                            }
                        }
                    }
                }
            }
        }

        let mut output = Vec::new();
        if item_started {
            let part = serde_json::json!({ "type": "output_text", "text": text_output, "annotations": [] });
            let item = serde_json::json!({
                "id": item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [part.clone()]
            });
            yield Ok(sse_bytes("response.output_text.done", serde_json::json!({
                "type": "response.output_text.done",
                "item_id": item_id,
                "output_index": text_output_index,
                "content_index": 0,
                "text": text_output
            })));
            yield Ok(sse_bytes("response.content_part.done", serde_json::json!({
                "type": "response.content_part.done",
                "item_id": item_id,
                "output_index": text_output_index,
                "content_index": 0,
                "part": part
            })));
            yield Ok(sse_bytes("response.output_item.done", serde_json::json!({
                "type": "response.output_item.done",
                "output_index": text_output_index,
                "item": item
            })));
            output.push(item);
        }
        for call in function_calls.values() {
            let item = serde_json::json!({
                "id": call.id,
                "type": "function_call",
                "status": "completed",
                "call_id": call.call_id,
                "name": call.name,
                "arguments": call.arguments
            });
            yield Ok(sse_bytes("response.function_call_arguments.done", serde_json::json!({
                "type": "response.function_call_arguments.done",
                "item_id": call.id,
                "output_index": call.output_index,
                "arguments": call.arguments
            })));
            yield Ok(sse_bytes("response.output_item.done", serde_json::json!({
                "type": "response.output_item.done",
                "output_index": call.output_index,
                "item": item
            })));
            output.push(item);
        }
        if output.is_empty() {
            output.push(serde_json::json!({
                "id": item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": "", "annotations": [] }]
            }));
        }
        yield Ok(sse_bytes("response.completed", serde_json::json!({
            "type": "response.completed",
            "response": { "id": response_id, "status": "completed", "model": model, "output": output, "usage": usage }
        })));
        yield Ok(bytes::Bytes::from("data: [DONE]\n\n"));
    };
    let mut response = Response::new(Body::from_stream(stream));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    Ok(response)
}

fn authorize(
    provider: &ProviderRecord,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, serde_json::Value)> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    if bearer == "codex-web-proxy"
        || provider
            .api_key
            .as_deref()
            .is_some_and(|api_key| !api_key.is_empty() && api_key == bearer)
    {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "unauthorized" }),
        ))
    }
}

fn responses_to_chat_request(
    provider: &ProviderRecord,
    body: &serde_json::Value,
) -> serde_json::Value {
    let mut request = serde_json::Map::new();
    request.insert(
        "model".to_string(),
        body.get("model")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::String(provider.summary.default_model.clone())),
    );
    request.insert(
        "messages".to_string(),
        response_input_to_messages(body.get("input"), body.get("instructions")),
    );
    if let Some(value) = body.get("max_output_tokens") {
        request.insert("max_tokens".to_string(), value.clone());
    }
    for key in ["temperature", "top_p", "tool_choice"] {
        if let Some(value) = body.get(key) {
            request.insert(key.to_string(), value.clone());
        }
    }
    // Critical: propagate `stream` to the upstream chat request. codex always requests
    // stream=true; without this the upstream returns a single JSON object instead of an SSE
    // stream, and stream_chat_as_responses then parses nothing → empty response ("no response").
    if let Some(value) = body.get("stream") {
        request.insert("stream".to_string(), value.clone());
        if value.as_bool().unwrap_or(false) {
            request.insert(
                "stream_options".to_string(),
                serde_json::json!({ "include_usage": true }),
            );
        }
    }
    // Convert Responses-format tools → Chat tools so codex's tool calls (shell, apply_patch, …)
    // survive the proxy. Drop anything that doesn't map cleanly.
    if let Some(tools) = response_tools_to_chat_tools(body.get("tools")) {
        request.insert("tools".to_string(), tools);
    }
    serde_json::Value::Object(request)
}

fn response_tools_to_chat_tools(tools: Option<&serde_json::Value>) -> Option<serde_json::Value> {
    let array = tools?.as_array()?;
    let converted: Vec<serde_json::Value> = array
        .iter()
        .filter_map(|tool| {
            let object = tool.as_object()?;
            let is_function = object.get("type").and_then(|value| value.as_str()) == Some("function");
            if is_function {
                if let Some(name) = object.get("name").filter(|value| !value.is_null()) {
                    return Some(serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": name,
                            "description": object.get("description").cloned().unwrap_or(serde_json::Value::Null),
                            "parameters": object.get("parameters").cloned().unwrap_or_else(|| serde_json::json!({})),
                        }
                    }));
                }
                if object.get("function").is_some() {
                    return Some(tool.clone());
                }
            }
            None
        })
        .collect();
    if converted.is_empty() {
        None
    } else {
        Some(serde_json::Value::Array(converted))
    }
}

fn response_input_to_messages(
    input: Option<&serde_json::Value>,
    instructions: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut messages = Vec::new();
    if let Some(instructions) = instructions
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        messages.push(serde_json::json!({ "role": "system", "content": instructions }));
    }
    match input {
        Some(serde_json::Value::String(text)) => {
            messages.push(serde_json::json!({ "role": "user", "content": text }))
        }
        Some(serde_json::Value::Array(items)) => {
            for item in items {
                if let Some(text) = item.as_str() {
                    messages.push(serde_json::json!({ "role": "user", "content": text }));
                } else if let Some(object) = item.as_object() {
                    let role = object
                        .get("role")
                        .and_then(|value| value.as_str())
                        .unwrap_or("user");
                    let role = if matches!(role, "assistant" | "system" | "tool" | "user") {
                        role
                    } else {
                        "user"
                    };
                    let content = text_from_content(
                        object
                            .get("content")
                            .or_else(|| object.get("text"))
                            .unwrap_or(item),
                    );
                    messages.push(serde_json::json!({ "role": role, "content": content }));
                } else {
                    messages
                        .push(serde_json::json!({ "role": "user", "content": item.to_string() }));
                }
            }
        }
        Some(value) => messages
            .push(serde_json::json!({ "role": "user", "content": text_from_content(value) })),
        None => messages.push(serde_json::json!({ "role": "user", "content": "" })),
    }
    serde_json::Value::Array(messages)
}

fn chat_to_response(provider: &ProviderRecord, payload: serde_json::Value) -> serde_json::Value {
    let response_id = payload
        .get("id")
        .and_then(|value| value.as_str())
        .map(|id| id.replacen("chatcmpl-", "resp_", 1))
        .unwrap_or_else(|| format!("resp_{}", random_hex(8)));
    let message = payload
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|choice| choice.get("message"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let text = text_from_content(message.get("content").unwrap_or(&serde_json::Value::Null));
    serde_json::json!({
        "id": response_id,
        "object": "response",
        "created_at": payload.get("created").and_then(|value| value.as_i64()).unwrap_or_else(|| unix_now()),
        "status": "completed",
        "model": payload.get("model").and_then(|value| value.as_str()).unwrap_or(&provider.summary.default_model),
        "output": [{
            "id": format!("msg-{response_id}"),
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": text, "annotations": [] }]
        }],
        "output_text": text,
        "usage": chat_usage_to_response_usage(payload.get("usage"))
    })
}

fn text_from_content(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                item.as_str().map(ToString::to_string).or_else(|| {
                    item.as_object()
                        .and_then(|object| {
                            object
                                .get("text")
                                .or_else(|| object.get("input_text"))
                                .or_else(|| object.get("output_text"))
                        })
                        .and_then(|value| value.as_str())
                        .map(ToString::to_string)
                })
            })
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn sse_event(event: &str, data: serde_json::Value) -> String {
    format!(
        "event: {event}\ndata: {}\n\n",
        serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string())
    )
}

fn sse_bytes(event: &str, data: serde_json::Value) -> bytes::Bytes {
    bytes::Bytes::from(sse_event(event, data))
}

fn split_sse_events(input: &str) -> (Vec<String>, String) {
    let mut events = Vec::new();
    let mut rest = input.to_string();
    loop {
        let Some(index) = rest.find("\n\n").or_else(|| rest.find("\r\n\r\n")) else {
            break;
        };
        let separator_len = if rest[index..].starts_with("\r\n\r\n") {
            4
        } else {
            2
        };
        events.push(rest[..index].to_string());
        rest = rest[index + separator_len..].to_string();
    }
    (events, rest)
}

fn sse_data_payloads(event_block: &str) -> Vec<String> {
    let data_lines = event_block
        .lines()
        .filter_map(|line| {
            line.strip_prefix("data:")
                .map(|value| value.strip_prefix(' ').unwrap_or(value).to_string())
        })
        .collect::<Vec<_>>();
    if data_lines.is_empty() {
        return Vec::new();
    }
    let joined = data_lines.join("\n").trim().to_string();
    if data_lines.len() == 1 {
        return if joined.is_empty() {
            Vec::new()
        } else {
            vec![joined]
        };
    }
    if serde_json::from_str::<serde_json::Value>(&joined).is_ok() {
        vec![joined]
    } else {
        data_lines
            .into_iter()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect()
    }
}

#[derive(Debug, Clone)]
struct ChatToolCallDelta {
    index: Option<usize>,
    call_id: Option<String>,
    name: Option<String>,
    arguments: Option<String>,
}

fn chat_stream_usage(data: &str) -> Option<serde_json::Value> {
    let chunk = serde_json::from_str::<serde_json::Value>(data).ok()?;
    let usage = chat_usage_to_response_usage(chunk.get("usage"));
    if usage.is_object() {
        Some(usage)
    } else {
        None
    }
}

fn chat_usage_to_response_usage(value: Option<&serde_json::Value>) -> serde_json::Value {
    let Some(usage) = value.and_then(|value| value.as_object()) else {
        return serde_json::Value::Null;
    };
    let input_tokens = usage
        .get("input_tokens")
        .and_then(|value| value.as_i64())
        .or_else(|| usage.get("prompt_tokens").and_then(|value| value.as_i64()))
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(|value| value.as_i64())
        .or_else(|| usage.get("completion_tokens").and_then(|value| value.as_i64()))
        .unwrap_or(0);
    let mut output = serde_json::Map::new();
    for (key, value) in usage {
        output.insert(key.clone(), value.clone());
    }
    output.insert("input_tokens".to_string(), serde_json::json!(input_tokens));
    output.insert("output_tokens".to_string(), serde_json::json!(output_tokens));
    output.entry("total_tokens".to_string()).or_insert_with(|| serde_json::json!(input_tokens + output_tokens));
    output.entry("input_tokens_details".to_string()).or_insert_with(|| {
        usage.get("prompt_tokens_details")
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    });
    output.entry("output_tokens_details".to_string()).or_insert_with(|| {
        usage.get("completion_tokens_details")
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    });
    serde_json::Value::Object(output)
}

fn chat_stream_delta(data: &str) -> Option<(String, Vec<ChatToolCallDelta>)> {
    let chunk = serde_json::from_str::<serde_json::Value>(data).ok()?;
    let delta = chunk
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|choice| choice.get("delta"))?;
    let mut text = String::new();
    if let Some(content) = delta.get("content") {
        text = match content {
            serde_json::Value::String(text) => text.clone(),
            serde_json::Value::Array(items) => items
                .iter()
                .filter_map(|item| {
                    item.as_str().map(ToString::to_string).or_else(|| {
                        item.as_object()
                            .and_then(|object| object.get("text"))
                            .and_then(|value| value.as_str())
                            .map(ToString::to_string)
                    })
                })
                .collect::<Vec<_>>()
                .join(""),
            _ => String::new(),
        };
    }
    let tool_calls = delta
        .get("tool_calls")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let object = item.as_object()?;
                    let function = object.get("function").and_then(|value| value.as_object());
                    Some(ChatToolCallDelta {
                        index: object
                            .get("index")
                            .and_then(|value| value.as_u64())
                            .map(|value| value as usize),
                        call_id: object
                            .get("id")
                            .and_then(|value| value.as_str())
                            .map(ToOwned::to_owned),
                        name: function
                            .and_then(|object| object.get("name"))
                            .and_then(|value| value.as_str())
                            .map(ToOwned::to_owned),
                        arguments: function
                            .and_then(|object| object.get("arguments"))
                            .and_then(|value| value.as_str())
                            .map(ToOwned::to_owned),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Some((text, tool_calls))
}

fn response(
    status: StatusCode,
    body: String,
    content_type: &str,
) -> Result<Response<Body>, (StatusCode, serde_json::Value)> {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/json")),
    );
    Ok(response)
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
