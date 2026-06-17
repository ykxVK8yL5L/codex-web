use axum::extract::ws::{Message, WebSocket};
use axum::{
    extract::{Query, State, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

use crate::state::AppState;

use super::{models::CreateTerminalSessionRequest, runtime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWsQuery {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub ephemeral: Option<String>,
}

pub async fn ws(
    State(state): State<AppState>,
    Query(query): Query<TerminalWsQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade.on_upgrade(move |socket| handle_socket(state, query, socket))
}

async fn handle_socket(state: AppState, query: TerminalWsQuery, socket: WebSocket) {
    let mut created_ephemeral_id: Option<String> = None;
    let handle = if let Some(id) = query
        .session_id
        .as_deref()
        .and_then(|id| state.terminals.get(id))
    {
        id
    } else {
        let ephemeral = matches!(query.ephemeral.as_deref(), Some("true" | "1"));
        let Ok(summary) = runtime::create_session(
            &state.terminals,
            CreateTerminalSessionRequest {
                name: None,
                cwd: query.cwd,
            },
            ephemeral,
        )
        .await
        else {
            return;
        };
        if ephemeral {
            created_ephemeral_id = Some(summary.id.clone());
        }
        let Some(handle) = state.terminals.get(&summary.id) else {
            return;
        };
        handle
    };
    let mut receiver = handle.sender.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let ready = serde_json::json!({
        "type": "ready",
        "cwd": handle.summary.cwd,
        "mode": handle.summary.mode,
        "session": handle.summary,
    });
    if ws_sender
        .send(Message::Text(ready.to_string()))
        .await
        .is_err()
    {
        return;
    }
    let input = handle.input.clone();
    let resize = handle.resize.clone();
    let output_task = tokio::spawn(async move {
        while let Ok(data) = receiver.recv().await {
            if ws_sender
                .send(Message::Text(
                    serde_json::json!({ "type": "output", "data": data }).to_string(),
                ))
                .await
                .is_err()
            {
                break;
            }
        }
    });
    while let Some(Ok(message)) = ws_receiver.next().await {
        if let Message::Text(text) = message {
            let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();
            let msg_type = parsed
                .as_ref()
                .and_then(|value| value.get("type"))
                .and_then(|value| value.as_str());
            match msg_type {
                Some("input") => {
                    if let Some(data) = parsed
                        .as_ref()
                        .and_then(|value| value.get("data"))
                        .and_then(|value| value.as_str())
                    {
                        let _ = input.send(data.to_string());
                    }
                }
                Some("resize") => {
                    let cols = parsed
                        .as_ref()
                        .and_then(|value| value.get("cols"))
                        .and_then(|value| value.as_u64());
                    let rows = parsed
                        .as_ref()
                        .and_then(|value| value.get("rows"))
                        .and_then(|value| value.as_u64());
                    if let (Some(cols), Some(rows)) = (cols, rows) {
                        let _ = resize.send((cols as u16, rows as u16));
                    }
                }
                _ => {}
            }
        }
    }
    output_task.abort();
    if let Some(id) = created_ephemeral_id {
        if let Some(handle) = state.terminals.remove(&id) {
            let _ = handle.kill.send(());
        }
    }
}
