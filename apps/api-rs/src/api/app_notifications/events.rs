use std::{convert::Infallible, time::Duration};

use axum::response::sse::{Event, Sse};
use futures_util::Stream;

use crate::state::AppState;

use super::store;

// Uses a lightweight broadcast channel for in-process updates and keeps polling as a
// cross-process / missed-event fallback.

/// `GET /api/app-notifications/events` — Server-Sent Events stream of app notifications.
///
/// Mirrors the TS handler: sends `retry: 5000`, emits an initial `snapshot` event (the latest 30
/// notifications), and keeps the stream alive with a 15s `ping` event.
pub fn stream(state: AppState) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let body = async_stream::stream! {
        yield Ok(Event::default().retry(Duration::from_millis(5000)));

        // Initial snapshot event ({ type: "snapshot", items, unreadCount }).
        let mut last = serde_json::Value::Null;
        if let Ok(snapshot) = store::list(&state.db, 30) {
            if let Ok(mut value) = serde_json::to_value(&snapshot) {
                if let Some(object) = value.as_object_mut() {
                    object.insert("type".to_string(), serde_json::json!("snapshot"));
                }
                last = value.clone();
                yield Ok(sse_event("snapshot", value));
            }
        }

        let mut receiver = state.app_notifications.subscribe_events();
        let mut interval = tokio::time::interval(Duration::from_millis(5000));
        let mut heartbeat = tokio::time::interval(Duration::from_millis(15000));
        interval.tick().await; // consume the immediate first tick.
        heartbeat.tick().await; // consume the immediate first tick.
        loop {
            tokio::select! {
                event = receiver.recv() => {
                    if let Ok(value) = event {
                        let name = value
                            .get("type")
                            .and_then(|item| item.as_str())
                            .unwrap_or("snapshot")
                            .to_string();
                        last = value.clone();
                        yield Ok(sse_event(&name, value));
                    }
                }
                _ = interval.tick() => {
                    let Ok(snapshot) = store::list(&state.db, 30) else {
                        continue;
                    };
                    let Ok(mut value) = serde_json::to_value(&snapshot) else {
                        continue;
                    };
                    if let Some(object) = value.as_object_mut() {
                        object.insert("type".to_string(), serde_json::json!("snapshot"));
                    }
                    if value != last {
                        last = value.clone();
                        yield Ok(sse_event("snapshot", value));
                    }
                }
                _ = heartbeat.tick() => {
                    yield Ok(sse_event("ping", serde_json::json!({})));
                }
            }
        }
    };

    Sse::new(body)
}

fn sse_event(name: &str, payload: serde_json::Value) -> Event {
    Event::default().event(name).data(payload.to_string())
}

pub fn publish_snapshot(state: &AppState) {
    if let Ok(snapshot) = store::list(&state.db, 30) {
        if let Ok(mut value) = serde_json::to_value(snapshot) {
            if let Some(object) = value.as_object_mut() {
                object.insert("type".to_string(), serde_json::json!("snapshot"));
            }
            state.app_notifications.publish_event(value);
        }
    }
}

pub fn publish_notification(
    state: &AppState,
    notification: &super::models::AppNotificationSummary,
) {
    if let Ok(snapshot) = store::list(&state.db, 30) {
        let value = serde_json::json!({
            "type": "notification",
            "notification": notification,
            "unreadCount": snapshot.unread_count,
        });
        state.app_notifications.publish_event(value);
    }
}
