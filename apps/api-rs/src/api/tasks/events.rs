use std::{convert::Infallible, time::Duration};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;

use crate::{api::sessions::store, state::AppState};

/// `GET /api/codex/tasks/:id/events` — Server-Sent Events stream of task events.
///
/// Known runner/queue/status mutations publish to TaskRuntimeState's broadcast bus. The stream also
/// retains a slower poll fallback for externally-written DB/log changes and cross-process recovery.
pub fn stream(
    state: AppState,
    session_id: String,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let body = async_stream::stream! {
        use std::collections::HashSet;

        let load_messages = |db: &crate::db::Db, sid: &str| -> Vec<crate::api::sessions::models::SessionMessage> {
            let mut items = super::super::sessions::messages::list(db, sid, 500, None)
                .map(|page| page.items)
                .unwrap_or_default();
            items.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
            items
        };

        let mut seen_message_ids: HashSet<String> = HashSet::new();
        let mut last_queue = serde_json::Value::Null;
        let mut last_log_len: usize = 0;
        let mut last_status = String::new();
        let mut emitted_terminal = false;
        let mut receiver = state.tasks.subscribe_events(&session_id);

        if let Ok(Some(session)) = store::get_session(&state.db, &session_id) {
            last_status = session.status.clone();
            let session_value = serde_json::to_value(&session).unwrap_or(serde_json::Value::Null);
            let messages = load_messages(&state.db, &session_id);
            for message in &messages {
                seen_message_ids.insert(message.id.clone());
            }
            let queue = super::super::sessions::queue::list(&state.db, &session_id).unwrap_or_default();
            last_queue = serde_json::to_value(&queue).unwrap_or(serde_json::Value::Null);
            let log = super::details::read_task_log_for_session(&state.db, &session_id);
            last_log_len = log.len();
            let exit_code = read_exit_code(&state, &session_id);
            yield Ok(sse_event("snapshot", serde_json::json!({
                "type": "snapshot",
                "session": session_value,
                "messages": messages,
                "queue": queue,
                "exitCode": exit_code,
            })));
        }

        let mut interval = tokio::time::interval(Duration::from_millis(5000));
        interval.tick().await;

        loop {
            tokio::select! {
                result = receiver.recv() => {
                    match result {
                        Ok(value) => {
                            if let Some(kind) = value.get("type").and_then(|item| item.as_str()) {
                                match kind {
                                    "message" => {
                                        if let Some(id) = value.get("message").and_then(|m| m.get("id")).and_then(|id| id.as_str()) {
                                            seen_message_ids.insert(id.to_string());
                                        }
                                    }
                                    "queue" => {
                                        if let Some(queue) = value.get("queue") { last_queue = queue.clone(); }
                                    }
                                    "output" => {
                                        if let Some(bytes) = value.get("bytes").and_then(|b| b.as_u64()) { last_log_len = bytes as usize; }
                                    }
                                    "done" | "error" => emitted_terminal = true,
                                    "started" => emitted_terminal = false,
                                    _ => {}
                                }
                                if let Some(status) = value.get("session").and_then(|s| s.get("status")).and_then(|s| s.as_str()) {
                                    last_status = status.to_string();
                                }
                                let event_name = kind.to_string();
                                yield Ok(sse_event(&event_name, value));
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            // Do not close the SSE stream just because the in-process broadcast
                            // sender disappeared. TS keeps the event stream alive and falls back
                            // to polling; closing here makes the browser fire its native EventSource
                            // error and shows the reconnect banner after ordinary task failures.
                            receiver = state.tasks.subscribe_events(&session_id);
                        },
                    }
                }
                _ = interval.tick() => {
                    let Ok(Some(session)) = store::get_session(&state.db, &session_id) else {
                        // Keep the SSE connection alive. If the session was deleted, the browser can
                        // navigate away; otherwise a transient DB/read issue should not surface as a
                        // broken realtime stream.
                        continue;
                    };
                    let session_value = serde_json::to_value(&session).unwrap_or(serde_json::Value::Null);

                    for message in load_messages(&state.db, &session_id) {
                        if seen_message_ids.insert(message.id.clone()) {
                            yield Ok(sse_event("message", serde_json::json!({
                                "type": "message",
                                "message": message,
                                "session": session_value,
                            })));
                        }
                    }

                    let queue = super::super::sessions::queue::list(&state.db, &session_id).unwrap_or_default();
                    let queue_value = serde_json::to_value(&queue).unwrap_or(serde_json::Value::Null);
                    if queue_value != last_queue {
                        last_queue = queue_value.clone();
                        yield Ok(sse_event("queue", serde_json::json!({
                            "type": "queue",
                            "queue": queue,
                            "session": session_value,
                        })));
                    }

                    let log = super::details::read_task_log_for_session(&state.db, &session_id);
                    if log.len() > last_log_len {
                        let mut start = last_log_len.min(log.len());
                        while start < log.len() && !log.is_char_boundary(start) {
                            start += 1;
                        }
                        let new_chunk = &log[start..];
                        for line in new_chunk.split('\n') {
                            if let Some(activity) = super::activity::parse_event_value(line) {
                                yield Ok(sse_event("activity", activity));
                            }
                        }
                        last_log_len = log.len();
                        yield Ok(sse_event(
                            "output",
                            serde_json::json!({ "type": "output", "bytes": log.len(), "at": crate::api::common::timestamp() }),
                        ));
                    }

                    if session.status != last_status {
                        last_status = session.status.clone();
                        if !emitted_terminal {
                            match session.status.as_str() {
                                "completed" => {
                                    let exit_code = read_exit_code(&state, &session_id);
                                    yield Ok(sse_event("done", serde_json::json!({ "type": "done", "session": session_value, "exitCode": exit_code })));
                                    emitted_terminal = true;
                                }
                                "paused" | "interrupted" | "failed" => {
                                    yield Ok(sse_event("task-error", serde_json::json!({ "type": "error", "session": session_value, "error": session.status })));
                                    emitted_terminal = true;
                                }
                                _ => {}
                            }
                        }
                        if session.status == "running" {
                            emitted_terminal = false;
                        }
                    }
                }
            }
        }
    };

    Sse::new(body).keep_alive(KeepAlive::default())
}

pub fn publish_event(state: &AppState, session_id: &str, event: serde_json::Value) {
    state.tasks.publish_event(session_id, event);
}

pub fn publish_started(state: &AppState, session: &crate::api::sessions::models::SessionSummary) {
    publish_event(
        state,
        &session.id,
        serde_json::json!({ "type": "started", "session": session }),
    );
}

pub fn publish_message(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    publish_event(
        state,
        &session.id,
        serde_json::json!({ "type": "message", "message": message, "session": session }),
    );
}

pub fn publish_queue(state: &AppState, session: &crate::api::sessions::models::SessionSummary) {
    if let Ok(queue) = super::super::sessions::queue::list(&state.db, &session.id) {
        publish_event(
            state,
            &session.id,
            serde_json::json!({ "type": "queue", "queue": queue, "session": session }),
        );
    }
}

pub fn publish_output(state: &AppState, session_id: &str, bytes: usize) {
    publish_event(
        state,
        session_id,
        serde_json::json!({ "type": "output", "bytes": bytes, "at": crate::api::common::timestamp() }),
    );
}

pub fn publish_done(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    exit_code: Option<i64>,
) {
    publish_event(
        state,
        &session.id,
        serde_json::json!({ "type": "done", "session": session, "exitCode": exit_code }),
    );
}

pub fn publish_error(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    error: impl Into<String>,
) {
    publish_event(
        state,
        &session.id,
        serde_json::json!({ "type": "error", "session": session, "error": error.into() }),
    );
}

fn read_exit_code(state: &AppState, session_id: &str) -> Option<i64> {
    let meta_path = state
        .db
        .data_dir
        .join("sessions")
        .join(session_id)
        .join("logs")
        .join("codex.json");
    let parsed =
        serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(meta_path).ok()?)
            .ok()?;
    parsed.get("exitCode").and_then(|value| value.as_i64())
}

fn sse_event(name: &str, payload: serde_json::Value) -> Event {
    let event_name = if name == "error" { "task-error" } else { name };
    Event::default().event(event_name).data(payload.to_string())
}
