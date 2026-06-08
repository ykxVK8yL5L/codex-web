use std::{convert::Infallible, time::Duration};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;

use crate::state::AppState;

use super::store;

/// `GET /api/rooms/:id/events/stream` — Server-Sent Events stream of room activity.
///
/// Emits an initial `snapshot` event ({ type, room, tasks, runs, events, messages }). Known Rust
/// mutation routes publish to a broadcast bus for low-latency `activity` events; a slower polling
/// fallback keeps parity for store-level writes that do not yet have access to AppState.
pub fn stream(
    state: AppState,
    room_id: String,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let body = async_stream::stream! {
        let mut last = build_snapshot(&state, &room_id);
        let mut receiver = state.rooms.subscribe_events(&room_id);
        if let Some(snapshot) = last.clone() {
            let mut value = snapshot;
            if let Some(object) = value.as_object_mut() {
                object.insert("type".to_string(), serde_json::json!("snapshot"));
            }
            yield Ok(sse_event("snapshot", value));
        }

        let mut interval = tokio::time::interval(Duration::from_millis(5000));
        interval.tick().await;
        loop {
            tokio::select! {
                result = receiver.recv() => {
                    match result {
                        Ok(value) => {
                            last = build_snapshot(&state, &room_id);
                            let event_name = value.get("type").and_then(|item| item.as_str()).unwrap_or("activity").to_string();
                            yield Ok(sse_event(&event_name, value));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                _ = interval.tick() => {
                    let current = build_snapshot(&state, &room_id);
                    if current != last {
                        last = current.clone();
                        if let Some(snapshot) = current {
                            let mut value = snapshot;
                            if let Some(object) = value.as_object_mut() {
                                object.insert("type".to_string(), serde_json::json!("activity"));
                                object.insert("roomId".to_string(), serde_json::json!(room_id));
                            }
                            yield Ok(sse_event("activity", value));
                        }
                    }
                }
            }
        }
    };

    Sse::new(body).keep_alive(KeepAlive::default())
}

pub fn activity_payload(state: &AppState, room_id: &str) -> Option<serde_json::Value> {
    let mut value = build_snapshot(state, room_id)?;
    if let Some(object) = value.as_object_mut() {
        object.insert("type".to_string(), serde_json::json!("activity"));
        object.insert("roomId".to_string(), serde_json::json!(room_id));
    }
    Some(value)
}

/// Publish a current activity snapshot for known room mutations.
pub fn publish_activity(state: &AppState, room_id: &str) {
    if let Some(value) = activity_payload(state, room_id) {
        state.rooms.publish_event(room_id, value);
    }
}

/// Build the room activity snapshot ({ room, tasks, runs, events, messages }) or None if the
/// room does not exist. Mirrors roomActivitySnapshot() in apps/api/src/rooms/index.ts.
fn build_snapshot(state: &AppState, room_id: &str) -> Option<serde_json::Value> {
    let room = store::get_room(&state.db, room_id).ok().flatten()?;
    let tasks = store::room_tasks(&state.db, room_id, 30).unwrap_or_default();
    let runs = store::room_runs(&state.db, room_id, 30).unwrap_or_default();
    let events = store::room_events(&state.db, room_id, 10).unwrap_or_default();
    let messages = room
        .session_id
        .as_deref()
        .and_then(|session_id| {
            crate::api::sessions::messages::list(&state.db, session_id, 50, None).ok()
        })
        .map(|page| page.items)
        .unwrap_or_default();
    Some(serde_json::json!({
        "room": room,
        "tasks": tasks,
        "runs": runs,
        "events": events,
        "messages": messages,
    }))
}

fn sse_event(name: &str, payload: serde_json::Value) -> Event {
    Event::default().event(name).data(payload.to_string())
}
