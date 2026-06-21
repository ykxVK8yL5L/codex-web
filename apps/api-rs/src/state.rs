use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tokio::sync::broadcast;

use crate::{config::AppConfig, db::Db};

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub db: Db,
    pub auth: AuthRuntimeState,
    pub terminals: TerminalRuntimeState,
    pub tasks: TaskRuntimeState,
    pub rooms: RoomRuntimeState,
    pub previews: PreviewRuntimeState,
    pub app_notifications: AppNotificationRuntimeState,
    pub weixin_qr: WeixinQrRuntimeState,
    pub telegram: TelegramRuntimeState,
    pub weixin_chat: PlatformChatRuntimeState,
    pub weixin_polling: PollingRuntimeState,
    pub wecom_chat: PlatformChatRuntimeState,
    pub feishu_polling: PollingRuntimeState,
    pub feishu_chat: PlatformChatRuntimeState,
    pub qq_polling: PollingRuntimeState,
    pub qq_chat: PlatformChatRuntimeState,
    pub email_polling: PollingRuntimeState,
    pub email_chat: PlatformChatRuntimeState,
    pub wecom: WeComRuntimeState,
}

#[derive(Clone)]
pub struct AuthRuntimeState {
    pending_setup_secret: Arc<Mutex<String>>,
    pending_reset_otp_secret: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let db = Db::from_config(&config);
        Self {
            config,
            db,
            auth: AuthRuntimeState::default(),
            terminals: TerminalRuntimeState::default(),
            tasks: TaskRuntimeState::default(),
            rooms: RoomRuntimeState::default(),
            previews: PreviewRuntimeState::default(),
            app_notifications: AppNotificationRuntimeState::default(),
            weixin_qr: WeixinQrRuntimeState::default(),
            telegram: TelegramRuntimeState::default(),
            weixin_chat: PlatformChatRuntimeState::default(),
            weixin_polling: PollingRuntimeState::default(),
            wecom_chat: PlatformChatRuntimeState::default(),
            feishu_polling: PollingRuntimeState::default(),
            feishu_chat: PlatformChatRuntimeState::default(),
            qq_polling: PollingRuntimeState::default(),
            qq_chat: PlatformChatRuntimeState::default(),
            email_polling: PollingRuntimeState::default(),
            email_chat: PlatformChatRuntimeState::default(),
            wecom: WeComRuntimeState::default(),
        }
    }
}

impl Default for AuthRuntimeState {
    fn default() -> Self {
        Self {
            pending_setup_secret: Arc::new(Mutex::new(
                crate::api::auth::generate_pending_setup_secret(),
            )),
            pending_reset_otp_secret: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Clone)]
pub struct AppNotificationRuntimeState {
    sender: Arc<Mutex<Option<broadcast::Sender<serde_json::Value>>>>,
}

impl Default for AppNotificationRuntimeState {
    fn default() -> Self {
        Self {
            sender: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Clone, Default)]
pub struct WeixinQrRuntimeState {
    sessions: Arc<Mutex<HashMap<String, WeixinQrSession>>>,
}

#[derive(Clone)]
pub struct WeixinQrSession {
    pub qr_key: String,
    pub account_id: Option<String>,
    pub bot_type: String,
    pub base_url: String,
    pub current_base_url: String,
    pub qrcode: String,
    pub qrcode_url: String,
    pub refresh_count: u32,
    pub created_at_ms: u128,
}

#[derive(Clone, Default)]
pub struct WeComRuntimeState {
    runtimes: Arc<Mutex<HashMap<String, WeComRuntimeHandle>>>,
}

#[derive(Clone, Default)]
pub struct TelegramRuntimeState {
    runtimes: Arc<Mutex<HashMap<String, TelegramRuntimeHandle>>>,
    chat: PlatformChatRuntimeState,
    typing: Arc<Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<()>>>>,
}

#[derive(Clone, Default)]
pub struct PlatformChatRuntimeState {
    pending: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    queued_reply_targets: Arc<Mutex<HashMap<String, Vec<TelegramReplyTarget>>>>,
    active_reply_targets: Arc<Mutex<HashMap<String, Vec<TelegramReplyTarget>>>>,
}

#[derive(Clone)]
pub struct TelegramReplyTarget {
    pub account_id: String,
    pub chat_id: String,
    pub created_at_ms: u128,
}

#[derive(Clone)]
pub struct TelegramRuntimeHandle {
    pub key: String,
    pub stop: tokio::sync::mpsc::UnboundedSender<()>,
}

#[derive(Clone)]
pub struct WeComRuntimeHandle {
    pub key: String,
    pub outbound: tokio::sync::mpsc::UnboundedSender<serde_json::Value>,
    pub stop: tokio::sync::mpsc::UnboundedSender<()>,
}

#[derive(Clone)]
pub struct PollingRuntimeHandle {
    pub key: String,
    pub stop: tokio::sync::mpsc::UnboundedSender<()>,
}

#[derive(Clone, Default)]
pub struct PollingRuntimeState {
    runtimes: Arc<Mutex<HashMap<String, PollingRuntimeHandle>>>,
}

#[derive(Clone, Default)]
pub struct TerminalRuntimeState {
    sessions: Arc<Mutex<HashMap<String, TerminalHandle>>>,
}

#[derive(Clone)]
pub struct TerminalHandle {
    pub summary: crate::api::terminal::models::TerminalSessionSummary,
    pub ephemeral: bool,
    pub sender: broadcast::Sender<String>,
    pub input: tokio::sync::mpsc::UnboundedSender<String>,
    pub resize: tokio::sync::mpsc::UnboundedSender<(u16, u16)>,
    pub kill: tokio::sync::mpsc::UnboundedSender<()>,
}

#[derive(Clone)]
pub struct TaskRuntimeState {
    tasks: Arc<Mutex<HashMap<String, TaskHandle>>>,
    events: Arc<Mutex<HashMap<String, broadcast::Sender<serde_json::Value>>>>,
}

impl Default for TaskRuntimeState {
    fn default() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
pub struct TaskHandle {
    pub session_id: String,
    pub kill: tokio::sync::mpsc::UnboundedSender<()>,
}

#[derive(Clone)]
pub struct RoomRuntimeState {
    events: Arc<Mutex<HashMap<String, broadcast::Sender<serde_json::Value>>>>,
}

impl Default for RoomRuntimeState {
    fn default() -> Self {
        Self {
            events: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
pub struct PreviewRuntimeState {
    previews: Arc<Mutex<HashMap<String, PreviewHandle>>>,
    shares: Arc<Mutex<HashMap<String, crate::api::previews::shares::PreviewShareHandle>>>,
    events: Arc<Mutex<HashMap<String, broadcast::Sender<serde_json::Value>>>>,
}

impl Default for PreviewRuntimeState {
    fn default() -> Self {
        Self {
            previews: Arc::new(Mutex::new(HashMap::new())),
            shares: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
pub struct PreviewHandle {
    pub preview_id: String,
    pub kill: tokio::sync::mpsc::UnboundedSender<()>,
}

impl TerminalRuntimeState {
    pub fn list(&self) -> Vec<crate::api::terminal::models::TerminalSessionSummary> {
        self.sessions
            .lock()
            .map(|sessions| {
                sessions
                    .values()
                    .filter(|handle| !handle.ephemeral)
                    .map(|handle| handle.summary.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get(&self, id: &str) -> Option<TerminalHandle> {
        self.sessions.lock().ok()?.get(id).cloned()
    }

    pub fn insert(&self, handle: TerminalHandle) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(handle.summary.id.clone(), handle);
        }
    }

    pub fn remove(&self, id: &str) -> Option<TerminalHandle> {
        self.sessions.lock().ok()?.remove(id)
    }
}

impl TaskRuntimeState {
    pub fn get(&self, session_id: &str) -> Option<TaskHandle> {
        self.tasks.lock().ok()?.get(session_id).cloned()
    }

    pub fn insert(&self, handle: TaskHandle) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.insert(handle.session_id.clone(), handle);
        }
    }

    pub fn remove(&self, session_id: &str) -> Option<TaskHandle> {
        self.tasks.lock().ok()?.remove(session_id)
    }

    pub fn publish_event(&self, session_id: &str, event: serde_json::Value) {
        if let Ok(mut senders) = self.events.lock() {
            let sender = senders
                .entry(session_id.to_string())
                .or_insert_with(|| broadcast::channel(256).0);
            let _ = sender.send(event);
        }
    }

    pub fn subscribe_events(&self, session_id: &str) -> broadcast::Receiver<serde_json::Value> {
        if let Ok(mut senders) = self.events.lock() {
            return senders
                .entry(session_id.to_string())
                .or_insert_with(|| broadcast::channel(256).0)
                .subscribe();
        }
        broadcast::channel(1).1
    }
}

impl RoomRuntimeState {
    pub fn publish_event(&self, room_id: &str, event: serde_json::Value) {
        if let Ok(mut senders) = self.events.lock() {
            let sender = senders
                .entry(room_id.to_string())
                .or_insert_with(|| broadcast::channel(256).0);
            let _ = sender.send(event);
        }
    }

    pub fn subscribe_events(&self, room_id: &str) -> broadcast::Receiver<serde_json::Value> {
        if let Ok(mut senders) = self.events.lock() {
            return senders
                .entry(room_id.to_string())
                .or_insert_with(|| broadcast::channel(256).0)
                .subscribe();
        }
        broadcast::channel(1).1
    }
}

impl PreviewRuntimeState {
    pub fn get(&self, preview_id: &str) -> Option<PreviewHandle> {
        self.previews.lock().ok()?.get(preview_id).cloned()
    }

    pub fn insert(&self, handle: PreviewHandle) {
        if let Ok(mut previews) = self.previews.lock() {
            previews.insert(handle.preview_id.clone(), handle);
        }
    }

    pub fn remove(&self, preview_id: &str) -> Option<PreviewHandle> {
        self.previews.lock().ok()?.remove(preview_id)
    }

    pub fn get_share(
        &self,
        preview_id: &str,
    ) -> Option<crate::api::previews::shares::PreviewShareHandle> {
        self.shares.lock().ok()?.get(preview_id).cloned()
    }

    pub fn insert_share(&self, handle: crate::api::previews::shares::PreviewShareHandle) {
        if let Ok(mut shares) = self.shares.lock() {
            shares.insert(handle.preview_id.clone(), handle);
        }
    }

    pub fn remove_share(
        &self,
        preview_id: &str,
    ) -> Option<crate::api::previews::shares::PreviewShareHandle> {
        self.shares.lock().ok()?.remove(preview_id)
    }

    pub fn publish_event(&self, preview_id: &str, event: serde_json::Value) {
        if let Ok(mut senders) = self.events.lock() {
            let sender = senders
                .entry(preview_id.to_string())
                .or_insert_with(|| broadcast::channel(256).0);
            let _ = sender.send(event);
        }
    }

    pub fn subscribe_events(&self, preview_id: &str) -> broadcast::Receiver<serde_json::Value> {
        if let Ok(mut senders) = self.events.lock() {
            return senders
                .entry(preview_id.to_string())
                .or_insert_with(|| broadcast::channel(256).0)
                .subscribe();
        }
        broadcast::channel(1).1
    }
}

impl AuthRuntimeState {
    pub fn pending_setup_secret(&self) -> String {
        self.pending_setup_secret
            .lock()
            .map(|secret| secret.clone())
            .unwrap_or_default()
    }

    pub fn rotate_pending_setup_secret(&self) -> String {
        let next = crate::api::auth::generate_pending_setup_secret();
        if let Ok(mut secret) = self.pending_setup_secret.lock() {
            *secret = next.clone();
        }
        next
    }

    pub fn pending_reset_otp_secret(&self) -> Option<String> {
        self.pending_reset_otp_secret
            .lock()
            .ok()
            .and_then(|secret| secret.clone())
    }

    pub fn set_pending_reset_otp_secret(&self, value: Option<String>) {
        if let Ok(mut secret) = self.pending_reset_otp_secret.lock() {
            *secret = value;
        }
    }
}

impl AppNotificationRuntimeState {
    pub fn publish_event(&self, event: serde_json::Value) {
        if let Ok(mut slot) = self.sender.lock() {
            let sender = slot.get_or_insert_with(|| broadcast::channel(256).0);
            let _ = sender.send(event);
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<serde_json::Value> {
        if let Ok(mut slot) = self.sender.lock() {
            return slot
                .get_or_insert_with(|| broadcast::channel(256).0)
                .subscribe();
        }
        broadcast::channel(1).1
    }
}

impl WeixinQrRuntimeState {
    pub fn insert(&self, session: WeixinQrSession) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(session.qr_key.clone(), session);
        }
    }

    pub fn get(&self, qr_key: &str) -> Option<WeixinQrSession> {
        self.sessions.lock().ok()?.get(qr_key).cloned()
    }

    pub fn remove(&self, qr_key: &str) -> Option<WeixinQrSession> {
        self.sessions.lock().ok()?.remove(qr_key)
    }
}

impl WeComRuntimeState {
    pub fn get(&self, account_id: &str) -> Option<WeComRuntimeHandle> {
        self.runtimes.lock().ok()?.get(account_id).cloned()
    }

    pub fn insert(&self, account_id: String, handle: WeComRuntimeHandle) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(old) = runtimes.insert(account_id, handle) {
                let _ = old.stop.send(());
            }
        }
    }

    pub fn remove(&self, account_id: &str) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(old) = runtimes.remove(account_id) {
                let _ = old.stop.send(());
            }
        }
    }
}

impl TelegramRuntimeState {
    pub fn get(&self, account_id: &str) -> Option<TelegramRuntimeHandle> {
        self.runtimes.lock().ok()?.get(account_id).cloned()
    }

    pub fn insert(&self, account_id: String, handle: TelegramRuntimeHandle) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(previous) = runtimes.insert(account_id, handle) {
                let _ = previous.stop.send(());
            }
        }
    }

    pub fn remove(&self, account_id: &str) -> Option<TelegramRuntimeHandle> {
        let handle = self.runtimes.lock().ok()?.remove(account_id);
        if let Some(handle) = handle.as_ref() {
            let _ = handle.stop.send(());
        }
        handle
    }

    pub fn set_pending(&self, key: String, value: serde_json::Value) {
        self.chat.set_pending(key, value);
    }

    pub fn get_pending(&self, key: &str) -> Option<serde_json::Value> {
        self.chat.get_pending(key)
    }

    pub fn remove_pending(&self, key: &str) -> Option<serde_json::Value> {
        self.chat.remove_pending(key)
    }

    pub fn clear_pending_prefix(&self, prefix: &str) {
        self.chat.clear_pending_prefix(prefix);
    }

    pub fn add_queued_reply_target(&self, queue_id: &str, account_id: &str, chat_id: &str) {
        self.chat
            .add_queued_reply_target(queue_id, account_id, chat_id);
    }

    pub fn add_active_reply_target(&self, session_id: &str, account_id: &str, chat_id: &str) {
        self.chat
            .add_active_reply_target(session_id, account_id, chat_id);
    }

    pub fn clear_active_reply_targets(&self, session_id: &str) {
        self.chat.clear_active_reply_targets(session_id);
    }

    pub fn activate_reply_target_from_queue(&self, session_id: &str, queue_id: &str) {
        self.chat
            .activate_reply_target_from_queue(session_id, queue_id);
    }

    pub fn active_reply_targets(&self, session_id: &str) -> Vec<TelegramReplyTarget> {
        self.chat.active_reply_targets(session_id)
    }

    pub fn set_typing_stop(
        &self,
        account_id: &str,
        chat_id: &str,
        stop: tokio::sync::mpsc::UnboundedSender<()>,
    ) {
        let key = format!("{account_id}:{chat_id}");
        if let Ok(mut typing) = self.typing.lock() {
            if let Some(previous) = typing.insert(key, stop) {
                let _ = previous.send(());
            }
        }
    }

    pub fn stop_typing(&self, account_id: &str, chat_id: &str) {
        let key = format!("{account_id}:{chat_id}");
        if let Ok(mut typing) = self.typing.lock() {
            if let Some(stop) = typing.remove(&key) {
                let _ = stop.send(());
            }
        }
    }
}

impl PlatformChatRuntimeState {
    pub fn set_pending(&self, key: String, value: serde_json::Value) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(key, value);
        }
    }

    pub fn get_pending(&self, key: &str) -> Option<serde_json::Value> {
        self.pending.lock().ok()?.get(key).cloned()
    }

    pub fn remove_pending(&self, key: &str) -> Option<serde_json::Value> {
        self.pending.lock().ok()?.remove(key)
    }

    pub fn clear_pending_prefix(&self, prefix: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|key, _| !key.starts_with(prefix));
        }
    }

    pub fn add_queued_reply_target(&self, queue_id: &str, account_id: &str, chat_id: &str) {
        add_telegram_reply_target(&self.queued_reply_targets, queue_id, account_id, chat_id);
    }

    pub fn add_active_reply_target(&self, session_id: &str, account_id: &str, chat_id: &str) {
        add_telegram_reply_target(&self.active_reply_targets, session_id, account_id, chat_id);
    }

    pub fn clear_active_reply_targets(&self, session_id: &str) {
        if let Ok(mut active) = self.active_reply_targets.lock() {
            active.remove(session_id);
        }
    }

    pub fn activate_reply_target_from_queue(&self, session_id: &str, queue_id: &str) {
        let pending = self
            .queued_reply_targets
            .lock()
            .ok()
            .and_then(|mut targets| targets.remove(queue_id))
            .unwrap_or_default();
        if pending.is_empty() {
            return;
        }
        if let Ok(mut active) = self.active_reply_targets.lock() {
            let now = crate::api::common::current_millis();
            let entries = active.entry(session_id.to_string()).or_default();
            entries.retain(|item| now.saturating_sub(item.created_at_ms) < 30 * 60 * 1000);
            for item in pending {
                if !entries.iter().any(|entry| {
                    entry.account_id == item.account_id && entry.chat_id == item.chat_id
                }) {
                    entries.push(item);
                }
            }
        }
    }

    pub fn active_reply_targets(&self, session_id: &str) -> Vec<TelegramReplyTarget> {
        let now = crate::api::common::current_millis();
        self.active_reply_targets
            .lock()
            .ok()
            .and_then(|targets| targets.get(session_id).cloned())
            .unwrap_or_default()
            .into_iter()
            .filter(|item| now.saturating_sub(item.created_at_ms) < 30 * 60 * 1000)
            .collect()
    }
}

impl PollingRuntimeState {
    pub fn get(&self, account_id: &str) -> Option<PollingRuntimeHandle> {
        self.runtimes.lock().ok()?.get(account_id).cloned()
    }

    pub fn insert(&self, account_id: String, handle: PollingRuntimeHandle) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(previous) = runtimes.insert(account_id, handle) {
                let _ = previous.stop.send(());
            }
        }
    }

    pub fn remove(&self, account_id: &str) -> Option<PollingRuntimeHandle> {
        let handle = self.runtimes.lock().ok()?.remove(account_id);
        if let Some(handle) = handle.as_ref() {
            let _ = handle.stop.send(());
        }
        handle
    }
}

fn add_telegram_reply_target(
    map: &Arc<Mutex<HashMap<String, Vec<TelegramReplyTarget>>>>,
    key: &str,
    account_id: &str,
    chat_id: &str,
) {
    if let Ok(mut targets) = map.lock() {
        let now = crate::api::common::current_millis();
        let entries = targets.entry(key.to_string()).or_default();
        entries.retain(|item| now.saturating_sub(item.created_at_ms) < 30 * 60 * 1000);
        if !entries
            .iter()
            .any(|item| item.account_id == account_id && item.chat_id == chat_id)
        {
            entries.push(TelegramReplyTarget {
                account_id: account_id.to_string(),
                chat_id: chat_id.to_string(),
                created_at_ms: now,
            });
        }
    }
}
