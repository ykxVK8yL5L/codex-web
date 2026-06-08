use std::{convert::Infallible, time::Duration};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;

use crate::state::AppState;

use super::{models::PreviewRecord, store};

/// `GET /api/previews/:id/logs/events` — Server-Sent Events stream of preview log lines.
///
/// Uses the in-process broadcast bus for live log/status events and keeps a low-frequency DB poll
/// fallback so updates made by older/non-runtime mutation paths are still observed.
pub fn stream(
    state: AppState,
    preview: PreviewRecord,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let body = async_stream::stream! {
        let preview_id = preview.id.clone();
        let initial_logs = store::logs(&state.db, &preview_id).ok().flatten().unwrap_or_default();
        let mut last_len = initial_logs.len();
        let mut last_status = preview.status.clone();
        let mut receiver = state.previews.subscribe_events(&preview_id);

        if let Ok(preview_value) = serde_json::to_value(preview.public()) {
            yield Ok(sse_event(
                "snapshot",
                serde_json::json!({ "type": "snapshot", "preview": preview_value, "logs": initial_logs }),
            ));
        }

        let mut interval = tokio::time::interval(Duration::from_millis(5000));
        interval.tick().await;
        loop {
            tokio::select! {
                result = receiver.recv() => {
                    match result {
                        Ok(value) => {
                            // Keep poll baselines roughly current for broadcast-originated events.
                            if value.get("type").and_then(|v| v.as_str()) == Some("log") {
                                if let Some(chunk) = value.get("chunk").and_then(|v| v.as_str()) {
                                    last_len = last_len.saturating_add(chunk.len());
                                }
                            } else if value.get("type").and_then(|v| v.as_str()) == Some("status") {
                                if let Some(status) = value.get("preview").and_then(|v| v.get("status")).and_then(|v| v.as_str()) {
                                    last_status = status.to_string();
                                }
                            }
                            let event_name = value.get("type").and_then(|item| item.as_str()).unwrap_or("message").to_string();
                            yield Ok(sse_event(&event_name, value));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            // Fall through to the poll branch on the next tick.
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                _ = interval.tick() => {
                    let Ok(Some(current)) = store::get(&state.db, &preview_id) else {
                        break;
                    };
                    let logs = store::logs(&state.db, &preview_id).ok().flatten().unwrap_or_default();
                    if logs.len() > last_len {
                        let mut start = last_len.min(logs.len());
                        while start < logs.len() && !logs.is_char_boundary(start) { start += 1; }
                        let chunk = logs[start..].to_string();
                        last_len = logs.len();
                        yield Ok(sse_event(
                            "log",
                            serde_json::json!({
                                "type": "log",
                                "previewId": preview_id,
                                "chunk": chunk,
                                "at": crate::api::common::timestamp(),
                            }),
                        ));
                    } else if logs.len() < last_len {
                        last_len = logs.len();
                    }
                    if current.status != last_status {
                        last_status = current.status.clone();
                        if let Ok(preview_value) = serde_json::to_value(current.public()) {
                            yield Ok(sse_event("status", serde_json::json!({ "type": "status", "preview": preview_value })));
                        }
                    }
                }
            }
        }
    };

    Sse::new(body).keep_alive(KeepAlive::default())
}

fn sse_event(name: &str, payload: serde_json::Value) -> Event {
    Event::default().event(name).data(payload.to_string())
}
