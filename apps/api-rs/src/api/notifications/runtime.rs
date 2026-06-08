use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use base64::Engine as _;
use hmac::{Hmac, Mac};
use mailparse::MailHeaderMap;
use prost::Message as ProstMessage;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use crate::state::AppState;

use super::{
    models::{
        NotificationAccountSummary, NotificationDeliverySummary, NotificationRecipientSummary,
        TestNotificationRequest,
    },
    store,
};

#[derive(Clone)]
pub struct NotificationEvent {
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub metadata: serde_json::Value,
}

pub async fn test_account(
    state: AppState,
    account_id: &str,
    input: TestNotificationRequest,
) -> anyhow::Result<NotificationDeliverySummary> {
    let account: NotificationAccountSummary = store::account_private(&state.db, account_id)?
        .ok_or_else(|| anyhow::anyhow!("notification_account_not_found"))?;
    let email_to = if input
        .email_to
        .as_ref()
        .is_some_and(|items| !items.is_empty())
    {
        input.email_to.clone().unwrap_or_default()
    } else {
        config_list(&account.config, "testEmailTo")
    };
    let chat_id = input
        .chat_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| default_test_chat_id(&account));
    let target_type = input
        .target_type
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| config_string(&account.config, "testTargetType"));
    let target = serde_json::json!({
        "accountId": account.id,
        "chatId": chat_id,
        "targetType": target_type,
        "emailTo": email_to,
    });
    let event = test_event(input, Some(&account));
    let result = deliver_to_account(&state, account.clone(), event, None, target).await;
    match &result {
        Ok(delivery) => store::set_account_test_status(
            &state.db,
            &account.id,
            delivery.status == "sent",
            delivery.last_error.as_deref(),
        )?,
        Err(error) => {
            store::set_account_test_status(&state.db, &account.id, false, Some(&error.to_string()))?
        }
    }
    result
}

pub async fn test_recipient(
    state: AppState,
    recipient_id: &str,
    input: TestNotificationRequest,
) -> anyhow::Result<NotificationDeliverySummary> {
    let recipient = store::recipient_private(&state.db, recipient_id)?
        .ok_or_else(|| anyhow::anyhow!("notification_recipient_not_found"))?;
    deliver_to_recipient(&state, recipient, test_event(input, None), None).await
}

pub async fn retry_delivery(state: AppState, delivery_id: &str) -> anyhow::Result<bool> {
    let delivery = store::delivery(&state.db, delivery_id)?
        .ok_or_else(|| anyhow::anyhow!("notification_delivery_not_found"))?;
    let metadata = delivery.metadata.clone();
    let metadata_target = metadata
        .get("target")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let metadata_recipient = metadata
        .get("recipient")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    let target_recipient_id = metadata_target
        .get("recipientId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            metadata_recipient
                .get("id")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        });
    let target_account_id = metadata_target
        .get("accountId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| delivery.account_id.clone());

    let event = NotificationEvent {
        event_type: delivery.event_type.clone(),
        severity: delivery.severity.clone(),
        title: delivery.title.clone(),
        message: delivery.message.clone(),
        source_type: None,
        source_id: None,
        metadata: serde_json::json!({
            "eventMetadata": metadata.get("eventMetadata").cloned().unwrap_or_else(|| serde_json::json!({})),
            "retryOfDeliveryId": delivery.id,
        }),
    };
    let rule_id = delivery.rule_id.clone();

    if let Some(recipient_id) = target_recipient_id {
        let recipient = store::recipient_private(&state.db, &recipient_id)?
            .ok_or_else(|| anyhow::anyhow!("notification_recipient_not_found"))?;
        let result = deliver_to_recipient(&state, recipient, event, rule_id.as_deref()).await?;
        return Ok(result.status == "sent");
    }

    let Some(account_id) = target_account_id else {
        anyhow::bail!("notification_delivery_target_missing");
    };
    if let Some(account) = store::account_private(&state.db, &account_id)? {
        let target = serde_json::json!({
            "accountId": account.id,
            "chatId": metadata_target.get("chatId").and_then(|value| value.as_str()).unwrap_or(""),
            "emailTo": metadata_target.get("emailTo").cloned().unwrap_or_else(|| serde_json::json!([])),
        });
        let result = deliver_to_account(&state, account, event, rule_id.as_deref(), target).await?;
        return Ok(result.status == "sent");
    }
    // account_id may actually reference a recipient (recipient-only deliveries)
    if let Some(recipient) = store::recipient_private(&state.db, &account_id)? {
        let result = deliver_to_recipient(&state, recipient, event, rule_id.as_deref()).await?;
        return Ok(result.status == "sent");
    }
    anyhow::bail!("notification_account_not_found")
}

async fn deliver_to_recipient(
    state: &AppState,
    recipient: NotificationRecipientSummary,
    event: NotificationEvent,
    rule_id: Option<&str>,
) -> anyhow::Result<NotificationDeliverySummary> {
    if !recipient.enabled {
        anyhow::bail!("notification_recipient_disabled");
    }
    let account = choose_sender(state, &recipient)?
        .ok_or_else(|| anyhow::anyhow!(format!("{}_sender_required", recipient.kind)))?;
    let target = serde_json::json!({
        "recipientId": recipient.id,
        "accountId": account.id,
        "chatId": recipient.config.get("chatId").and_then(|value| value.as_str()).unwrap_or(""),
        "emailTo": recipient.config.get("email").and_then(|value| value.as_str()).map(|value| vec![value]).unwrap_or_default(),
    });
    deliver_to_account(state, account, event, rule_id, target).await
}

async fn deliver_to_account(
    state: &AppState,
    account: NotificationAccountSummary,
    event: NotificationEvent,
    rule_id: Option<&str>,
    target: serde_json::Value,
) -> anyhow::Result<NotificationDeliverySummary> {
    if !account.enabled {
        anyhow::bail!("notification_account_disabled");
    }
    let metadata = serde_json::json!({
        "eventMetadata": event.metadata,
        "target": target,
        "account": {
            "id": account.id,
            "name": account.name,
            "kind": account.channel_kind,
            "channelId": account.channel_id,
        }
    });
    let delivery = store::create_delivery(
        &state.db,
        rule_id,
        Some(&account.id),
        &event.event_type,
        &event.severity,
        &event.title,
        &event.message,
        metadata,
    )?;
    let result = send_to_account(
        state,
        &account,
        &event,
        delivery
            .metadata
            .get("target")
            .unwrap_or(&serde_json::Value::Null),
    )
    .await;
    let finished = match result {
        Ok(status) => store::finish_delivery(&state.db, &delivery.id, true, Some(status), None)?,
        Err(error) => store::finish_delivery(
            &state.db,
            &delivery.id,
            false,
            None,
            Some(&error.to_string()),
        )?,
    };
    finished.ok_or_else(|| anyhow::anyhow!("notification_delivery_missing"))
}

pub fn emit_external_notification(state: AppState, event: NotificationEvent) {
    if !notifications_enabled_for_event(&state, &event) {
        return;
    }
    create_app_notification_for_event(&state, &event);
    tokio::spawn(async move {
        if let Err(error) = create_external_notification(&state, event).await {
            tracing::warn!("notification dispatch failed: {error}");
        }
    });
}

fn create_app_notification_for_event(state: &AppState, event: &NotificationEvent) {
    if let Ok(notification) = crate::api::app_notifications::store::create(
        &state.db,
        crate::api::app_notifications::models::CreateAppNotificationRequest {
            event_type: event.event_type.clone(),
            severity: Some(event.severity.clone()),
            title: event.title.clone(),
            message: event.message.clone(),
            source_type: event.source_type.clone(),
            source_id: event.source_id.clone(),
            metadata: Some(event.metadata.clone()),
        },
    ) {
        crate::api::app_notifications::events::publish_notification(state, &notification);
    }
}

async fn create_external_notification(
    state: &AppState,
    event: NotificationEvent,
) -> anyhow::Result<()> {
    let accounts = store::accounts_private(&state.db)?
        .into_iter()
        .filter(|account| account.enabled)
        .map(|account| (account.id.clone(), account))
        .collect::<std::collections::HashMap<_, _>>();
    let recipients = store::recipients(&state.db)?
        .into_iter()
        .filter(|recipient| recipient.enabled)
        .map(|recipient| (recipient.id.clone(), recipient))
        .collect::<std::collections::HashMap<_, _>>();

    for rule in store::rules(&state.db, 1000)?
        .items
        .into_iter()
        .filter(|rule| {
            rule.enabled
                && rule
                    .event_types
                    .iter()
                    .any(|item| item == &event.event_type)
                && severity_rank(&event.severity) >= severity_rank(&rule.min_severity)
        })
    {
        let targets = rule.targets.as_array().cloned().unwrap_or_default();
        for target in targets {
            if let Some(recipient_id) = target.get("recipientId").and_then(|value| value.as_str()) {
                let Some(recipient) = recipients.get(recipient_id).cloned() else {
                    continue;
                };
                if store::notification_recently_delivered(
                    &state.db,
                    &rule.id,
                    &recipient.id,
                    &event.event_type,
                    rule.dedupe_minutes,
                )? {
                    continue;
                }
                let state = state.clone();
                let event = event.clone();
                let rule_id = rule.id.clone();
                tokio::spawn(async move {
                    if let Err(error) =
                        deliver_to_recipient(&state, recipient, event, Some(&rule_id)).await
                    {
                        tracing::warn!("recipient notification failed: {error}");
                    }
                });
                continue;
            }
            let Some(account_id) = target.get("accountId").and_then(|value| value.as_str()) else {
                continue;
            };
            let Some(account) = accounts.get(account_id).cloned() else {
                continue;
            };
            if store::notification_recently_delivered(
                &state.db,
                &rule.id,
                &account.id,
                &event.event_type,
                rule.dedupe_minutes,
            )? {
                continue;
            }
            let state = state.clone();
            let event = event.clone();
            let rule_id = rule.id.clone();
            tokio::spawn(async move {
                if let Err(error) =
                    deliver_to_account(&state, account, event, Some(&rule_id), target).await
                {
                    tracing::warn!("account notification failed: {error}");
                }
            });
        }
    }

    for rule in ephemeral_rules_for_event(state, &event)? {
        let targets = rule.targets.as_array().cloned().unwrap_or_default();
        for target in targets {
            let Some(recipient_id) = target.get("recipientId").and_then(|value| value.as_str())
            else {
                continue;
            };
            let Some(recipient) = recipients.get(recipient_id).cloned() else {
                continue;
            };
            let state = state.clone();
            let event = event.clone();
            let rule_id = rule.id.clone();
            tokio::spawn(async move {
                if let Err(error) =
                    deliver_to_recipient(&state, recipient, event, Some(&rule_id)).await
                {
                    tracing::warn!("ephemeral recipient notification failed: {error}");
                }
            });
        }
        if rule.expire_mode == "after_trigger" {
            let _ = store::mark_ephemeral_rule_triggered(&state.db, &rule.id);
        }
    }
    Ok(())
}

fn severity_rank(value: &str) -> i64 {
    match value {
        "success" | "info" => 1,
        "warning" => 2,
        "error" => 3,
        _ => 1,
    }
}

fn ephemeral_rules_for_event(
    state: &AppState,
    event: &NotificationEvent,
) -> anyhow::Result<Vec<super::models::NotificationEphemeralRuleSummary>> {
    let scopes = notification_scopes_for_event(event);
    let rules = store::ephemeral_rules_for_scopes(&state.db, &scopes)?;
    Ok(rules
        .into_iter()
        .filter(|rule| {
            rule.event_types
                .iter()
                .any(|item| item == &event.event_type)
                && rule
                    .targets
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
        })
        .collect())
}

fn notification_scopes_for_event(event: &NotificationEvent) -> Vec<(String, String)> {
    let mut scopes = Vec::new();
    if event.source_type.as_deref() == Some("session") {
        if let Some(source_id) = event.source_id.as_deref().filter(|value| !value.is_empty()) {
            scopes.push(("session".to_string(), source_id.to_string()));
        }
    }
    if event.source_type.as_deref() == Some("automation") {
        if let Some(source_id) = event.source_id.as_deref().filter(|value| !value.is_empty()) {
            scopes.push(("automation".to_string(), source_id.to_string()));
        }
    }
    if let Some(items) = event
        .metadata
        .get("notificationScopes")
        .and_then(|value| value.as_array())
    {
        for item in items {
            let Some(scope_type) = item.get("scopeType").and_then(|value| value.as_str()) else {
                continue;
            };
            if !matches!(scope_type, "session" | "task" | "room_task" | "automation") {
                continue;
            }
            let Some(scope_id) = item
                .get("scopeId")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            scopes.push((scope_type.to_string(), scope_id.to_string()));
        }
    }
    let mut seen = std::collections::HashSet::new();
    scopes
        .into_iter()
        .filter(|scope| seen.insert(format!("{}:{}", scope.0, scope.1)))
        .collect()
}

fn notifications_enabled_for_event(state: &AppState, event: &NotificationEvent) -> bool {
    let source_session = if event.source_type.as_deref() == Some("session") {
        event.source_id.as_deref().and_then(|session_id| {
            crate::api::sessions::store::get_session(&state.db, session_id)
                .ok()
                .flatten()
        })
    } else {
        None
    };
    if source_session
        .as_ref()
        .is_some_and(|session| !session.notifications_enabled)
    {
        return false;
    }
    let metadata_room_id = event
        .metadata
        .get("roomId")
        .and_then(|value| value.as_str());
    let room_id = metadata_room_id.or_else(|| {
        source_session
            .as_ref()
            .and_then(|session| session.room_id.as_deref())
    });
    if let Some(room_id) = room_id {
        if let Ok(Some(room_session)) = room_session_for_room_id(state, room_id) {
            if !room_session.notifications_enabled {
                return false;
            }
        }
    }
    true
}

fn room_session_for_room_id(
    state: &AppState,
    room_id: &str,
) -> anyhow::Result<Option<crate::api::sessions::models::SessionSummary>> {
    let Some(connection) = state.db.open_read_only()? else {
        return Ok(None);
    };
    let session_id = connection
        .query_row(
            "select session_id from rooms where id = ?",
            [room_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    match session_id {
        Some(session_id) => crate::api::sessions::store::get_session(&state.db, &session_id),
        None => Ok(None),
    }
}

async fn send_to_account(
    state: &AppState,
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    // If a raw webhook `url` is configured, prefer the generic webhook delivery
    // (mirrors the TS fallback used for several channels).
    let has_url = account
        .config
        .get("url")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    match account.channel_kind.as_str() {
        "telegram" => send_telegram(account, event, target).await,
        "webhook" | "bark" => send_webhook(account, event).await,
        "email" => send_email(account, event, target).await,
        "dingtalk" => send_dingtalk(account, event).await,
        "qq" => {
            if has_url {
                send_webhook(account, event).await
            } else {
                send_qq(account, event, target).await
            }
        }
        "weixin" => {
            if has_url {
                send_webhook(account, event).await
            } else {
                send_weixin(account, event, target).await
            }
        }
        "wecom" => {
            if has_url {
                send_webhook(account, event).await
            } else {
                send_wecom(state, account, event, target).await
            }
        }
        "feishu" => {
            if has_url {
                send_webhook(account, event).await
            } else {
                send_feishu(account, event, target).await
            }
        }
        _ => send_webhook(account, event).await,
    }
}

async fn send_telegram(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    let bot_token = config_string(&account.config, "botToken")
        .ok_or_else(|| anyhow::anyhow!("telegram_bot_token_required"))?;
    let chat_id = target
        .get("chatId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            account
                .config
                .get("testChatId")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| anyhow::anyhow!("telegram_chat_id_required"))?;
    let base = config_string(&account.config, "proxyUrl")
        .unwrap_or_else(|| "https://api.telegram.org".to_string())
        .trim_end_matches('/')
        .to_string();
    let response = reqwest::Client::new()
        .post(format!("{base}/bot{bot_token}/sendMessage"))
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": format!("{}\n\n{}", event.title, event.message),
            "disable_web_page_preview": true,
        }))
        .send()
        .await?;
    let status = response.status().as_u16() as i64;
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!(
            "{}",
            if text.is_empty() {
                format!("telegram_http_{status}")
            } else {
                text.chars().take(500).collect::<String>()
            }
        );
    }
    Ok(status)
}

async fn send_webhook(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
) -> anyhow::Result<i64> {
    let url = config_string(&account.config, "url")
        .or_else(|| {
            config_string(&account.config, "serverUrl")
                .zip(config_string(&account.config, "deviceKey"))
                .map(|(server, key)| format!("{}/{}", server.trim_end_matches('/'), key))
        })
        .ok_or_else(|| anyhow::anyhow!("webhook_url_required"))?;
    let method = config_string(&account.config, "method")
        .unwrap_or_else(|| "POST".to_string())
        .to_uppercase();
    let mut headers = HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    if let Some(extra) = account
        .config
        .get("headers")
        .and_then(|value| value.as_object())
    {
        for (key, value) in extra {
            if let (Ok(name), Some(value)) =
                (HeaderName::from_bytes(key.as_bytes()), value.as_str())
            {
                if let Ok(value) = HeaderValue::from_str(value) {
                    headers.insert(name, value);
                }
            }
        }
    }
    let client = reqwest::Client::new();
    let mut request = client
        .request(
            method.parse()?,
            render_template(&url, event, &account.config),
        )
        .headers(headers);
    if method != "GET" && method != "HEAD" {
        request = request.body(render_template(
            &body_template(account),
            event,
            &account.config,
        ));
    }
    let response = request.send().await?;
    let status = response.status().as_u16() as i64;
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!(
            "{}",
            if text.is_empty() {
                format!("webhook_http_{status}")
            } else {
                text.chars().take(500).collect::<String>()
            }
        );
    }
    Ok(status)
}

async fn send_email(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

    let config = &account.config;
    let smtp_host = config_string(config, "host")
        .ok_or_else(|| anyhow::anyhow!("email_smtp_config_required"))?;
    let from_email = config_string(config, "fromEmail")
        .ok_or_else(|| anyhow::anyhow!("email_smtp_config_required"))?;
    let port = config
        .get("port")
        .and_then(|value| value.as_u64())
        .filter(|value| *value > 0)
        .unwrap_or(587) as u16;
    let secure = config
        .get("secure")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let username = config_string(config, "username");
    let password = config_string(config, "password");
    let from_name = config_string(config, "fromName").unwrap_or_else(|| "Codex Web".to_string());

    let mut recipients: Vec<String> = target
        .get("emailTo")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if recipients.is_empty() {
        if let Some(csv) = config_string(config, "testEmailTo") {
            recipients = csv
                .split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect();
        }
    }
    if recipients.is_empty() {
        anyhow::bail!("email_recipients_required");
    }

    let from_mailbox = format!("{} <{}>", from_name.replace('"', "'"), from_email);
    let body = format!(
        "{}\n\n{} · {}",
        event.message, event.event_type, event.severity
    );
    let mut builder = Message::builder()
        .from(
            from_mailbox
                .parse()
                .map_err(|_| anyhow::anyhow!("email_from_invalid"))?,
        )
        .subject(event.title.clone());
    if let Some(message_id) = event
        .metadata
        .get("messageId")
        .and_then(|value| value.as_str())
    {
        builder = builder.message_id(Some(message_id.to_string()));
    }
    if let Some(in_reply_to) = event
        .metadata
        .get("inReplyTo")
        .and_then(|value| value.as_str())
    {
        builder = builder.in_reply_to(in_reply_to.to_string());
    }
    if let Some(references) = event
        .metadata
        .get("references")
        .and_then(|value| value.as_str())
    {
        builder = builder.references(references.to_string());
    }
    for recipient in &recipients {
        builder = builder.to(recipient
            .parse()
            .map_err(|_| anyhow::anyhow!("email_recipient_invalid"))?);
    }
    let email = builder
        .body(body)
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    let base = if secure {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_host)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?
    };
    let mut transport = base.port(port);
    if let Some(user) = username {
        transport = transport.credentials(Credentials::new(user, password.unwrap_or_default()));
    }
    let mailer = transport.build();
    mailer
        .send(email)
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(200)
}

async fn send_dingtalk(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
) -> anyhow::Result<i64> {
    let config = &account.config;
    let token = config_string(config, "botToken")
        .or_else(|| config_string(config, "accessToken"))
        .or_else(|| config_string(config, "token"))
        .ok_or_else(|| anyhow::anyhow!("dingtalk_bot_token_required"))?;
    let base = config_string(config, "baseUrl")
        .unwrap_or_else(|| "https://oapi.dingtalk.com/robot/send".to_string());
    let secret = config_string(config, "botSecret").or_else(|| config_string(config, "secret"));

    let mut url = reqwest::Url::parse(&base)?;
    url.query_pairs_mut().append_pair("access_token", &token);
    if let Some(secret) = secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let timestamp = current_millis();
        let string_to_sign = format!("{timestamp}\n{secret}");
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        mac.update(string_to_sign.as_bytes());
        let sign = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        url.query_pairs_mut()
            .append_pair("timestamp", &timestamp.to_string())
            .append_pair("sign", &sign);
    }

    let response = reqwest::Client::new()
        .post(url)
        .json(&serde_json::json!({ "msgtype": "text", "text": { "content": format!("{}\n\n{}", event.title, event.message) } }))
        .send()
        .await?;
    let status = response.status().as_u16() as i64;
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!(
            "{}",
            if text.is_empty() {
                format!("dingtalk_http_{status}")
            } else {
                text.chars().take(500).collect::<String>()
            }
        );
    }
    Ok(status)
}

async fn send_feishu(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    let config = &account.config;
    let app_id =
        config_string(config, "appId").ok_or_else(|| anyhow::anyhow!("feishu_app_id_required"))?;
    let app_secret = config_string(config, "appSecret")
        .ok_or_else(|| anyhow::anyhow!("feishu_app_secret_required"))?;
    let chat_id = target
        .get("chatId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| config_string(config, "testChatId"))
        .ok_or_else(|| anyhow::anyhow!("feishu_chat_id_required"))?;
    let domain = match config_string(config, "domain")
        .map(|value| value.to_lowercase())
        .as_deref()
    {
        Some("lark") => "https://open.larksuite.com",
        _ => "https://open.feishu.cn",
    };

    let client = reqwest::Client::new();
    let token_response = client
        .post(format!(
            "{domain}/open-apis/auth/v3/tenant_access_token/internal"
        ))
        .json(&serde_json::json!({ "app_id": app_id, "app_secret": app_secret }))
        .send()
        .await?;
    let token_json: serde_json::Value = token_response.json().await?;
    if token_json
        .get("code")
        .and_then(|value| value.as_i64())
        .unwrap_or(-1)
        != 0
    {
        anyhow::bail!(
            "{}",
            token_json
                .get("msg")
                .and_then(|value| value.as_str())
                .unwrap_or("feishu_token_error")
        );
    }
    let token = token_json
        .get("tenant_access_token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow::anyhow!("feishu_token_missing"))?;

    let content =
        serde_json::json!({ "text": format!("{}\n\n{}", event.title, event.message) }).to_string();
    let response = client
        .post(format!(
            "{domain}/open-apis/im/v1/messages?receive_id_type=chat_id"
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({ "receive_id": chat_id, "msg_type": "text", "content": content }))
        .send()
        .await?;
    let status = response.status().as_u16() as i64;
    let body: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if body
        .get("code")
        .and_then(|value| value.as_i64())
        .unwrap_or(-1)
        != 0
    {
        anyhow::bail!(
            "{}",
            body.get("msg")
                .and_then(|value| value.as_str())
                .unwrap_or("feishu_http_error")
        );
    }
    Ok(status)
}

async fn send_qq(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    let config = &account.config;
    let target_id = target
        .get("chatId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| config_string(config, "targetId"))
        .or_else(|| config_string(config, "testTargetId"))
        .or_else(|| config_string(config, "testChatId"))
        .or_else(|| config_string(config, "openId"))
        .ok_or_else(|| anyhow::anyhow!("qq_target_id_required"))?;
    let configured_target_type = target
        .get("targetType")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| config_string(config, "targetType"));
    let target_type =
        qq_chat_type_for_send(&account.id, &target_id, configured_target_type.as_deref());
    let target_type = match Some(target_type.as_str())
        .map(|value| value.to_lowercase())
        .as_deref()
    {
        Some("group") => "group",
        Some("channel") | Some("guild") => "channel",
        _ => "user",
    };

    let client = reqwest::Client::new();
    let token = qq_access_token(account).await?;

    let path = match target_type {
        "group" => format!("/v2/groups/{target_id}/messages"),
        "channel" => format!("/channels/{target_id}/messages"),
        _ => format!("/v2/users/{target_id}/messages"),
    };
    let content: String = notification_content(&event.title, &event.message)
        .trim()
        .chars()
        .take(4000)
        .collect();
    let reply_to = qq_target_reply_to(target);
    let mut body =
        serde_json::json!({ "msg_type": 0, "content": content, "msg_seq": qq_msg_seq() });
    if let Some(reply_to) = reply_to.as_deref() {
        body["msg_id"] = serde_json::Value::String(reply_to.to_string());
    }
    let (success, status, response_text) = send_qq_request(&client, &token, &path, &body).await?;
    let mut body_for_log = body.clone();
    let mut response_text_for_check = response_text.clone();
    let mut success_for_check = success;
    let mut status_for_check = status;
    if !success_for_check
        && reply_to.is_some()
        && qq_error_code(&response_text_for_check) == Some(11255)
    {
        let retry_body =
            serde_json::json!({ "msg_type": 0, "content": content, "msg_seq": qq_msg_seq() });
        tracing::debug!(
            "qq send rejected with msg_id; retrying without msg_id account={} target={} type={} path={} body={}",
            account.id,
            target_id,
            target_type,
            path,
            response_text_for_check.chars().take(500).collect::<String>()
        );
        let retry = send_qq_request(&client, &token, &path, &retry_body).await?;
        success_for_check = retry.0;
        status_for_check = retry.1;
        response_text_for_check = retry.2;
        body_for_log = retry_body;
    }
    if !success_for_check {
        tracing::warn!(
            "qq send failed account={} target={} type={} path={} status={} request={} body={}",
            account.id,
            target_id,
            target_type,
            path,
            status_for_check,
            body_for_log
                .to_string()
                .chars()
                .take(500)
                .collect::<String>(),
            response_text_for_check
                .chars()
                .take(500)
                .collect::<String>()
        );
        anyhow::bail!(
            "{}",
            if response_text_for_check.is_empty() {
                format!("qq_http_{status_for_check}")
            } else {
                response_text_for_check
                    .chars()
                    .take(500)
                    .collect::<String>()
            }
        );
    }
    if let Ok(body) = serde_json::from_str::<serde_json::Value>(&response_text_for_check) {
        let code = body
            .get("code")
            .or_else(|| body.get("errcode"))
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        if code != 0 {
            let message = body
                .get("message")
                .or_else(|| body.get("msg"))
                .or_else(|| body.get("errmsg"))
                .and_then(|value| value.as_str())
                .unwrap_or("qq_send_failed");
            tracing::warn!(
                "qq send rejected account={} target={} type={} code={} body={}",
                account.id,
                target_id,
                target_type,
                code,
                response_text_for_check
                    .chars()
                    .take(500)
                    .collect::<String>()
            );
            anyhow::bail!("{message}");
        }
    }
    Ok(status_for_check)
}

async fn send_qq_request(
    client: &reqwest::Client,
    token: &str,
    path: &str,
    body: &serde_json::Value,
) -> anyhow::Result<(bool, i64, String)> {
    let response = client
        .post(format!("https://api.sgroup.qq.com{path}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::AUTHORIZATION, format!("QQBot {token}"))
        .json(body)
        .send()
        .await?;
    let success = response.status().is_success();
    let status = response.status().as_u16() as i64;
    let text = response.text().await.unwrap_or_default();
    Ok((success, status, text))
}

fn qq_error_code(text: &str) -> Option<i64> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|body| {
            body.get("code")
                .or_else(|| body.get("err_code"))
                .or_else(|| body.get("errcode"))
                .and_then(|value| value.as_i64())
        })
}

async fn send_weixin(
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    send_weixin_with_state(None, account, event, target).await
}

async fn send_weixin_with_state(
    state: Option<&AppState>,
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    let config = &account.config;
    let bot_token = config_string(config, "botToken")
        .ok_or_else(|| anyhow::anyhow!("weixin_bot_token_required"))?;
    let chat_id = target
        .get("chatId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("weixin_chat_id_required"))?;
    let base = config_string(config, "baseUrl")
        .unwrap_or_else(|| "https://ilinkai.weixin.qq.com".to_string());
    let base = base.trim_end_matches('/');

    let context_token = state
        .and_then(|state| {
            weixin_route_context_token(state, &account.id, chat_id)
                .ok()
                .flatten()
        })
        .or_else(|| config_string(config, "defaultContextToken"));
    let mut msg = serde_json::json!({
        "from_user_id": "",
        "to_user_id": chat_id,
        "client_id": format!("codex-web-{}", random_uuid()),
        "message_type": 2,
        "message_state": 2,
        "item_list": [{ "type": 1, "text_item": { "text": notification_content(&event.title, &event.message) } }],
    });
    if let Some(context_token) = context_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        msg["context_token"] = serde_json::Value::String(context_token.to_string());
    }
    let payload = serde_json::json!({
        "msg": msg,
        "base_info": { "channel_version": "2.2.0" },
    });

    let response = reqwest::Client::new()
        .post(format!("{base}/ilink/bot/sendmessage"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("AuthorizationType", "ilink_bot_token")
        .header("X-WECHAT-UIN", weixin_random_uin())
        .header("iLink-App-Id", "bot")
        .header(
            "iLink-App-ClientVersion",
            ((2 << 16) | (2 << 8) | 0_i64).to_string(),
        )
        .bearer_auth(bot_token)
        .json(&payload)
        .send()
        .await?;
    let status = response.status().as_u16() as i64;
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!(
            "{}",
            if text.is_empty() {
                format!("weixin_http_{status}")
            } else {
                text.chars().take(500).collect::<String>()
            }
        );
    }
    Ok(status)
}

async fn send_weixin_text(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    let event = NotificationEvent {
        event_type: "external_reply".to_string(),
        severity: "info".to_string(),
        title: String::new(),
        message: text.to_string(),
        source_type: None,
        source_id: None,
        metadata: serde_json::json!({}),
    };
    let target = serde_json::json!({ "chatId": chat_id });
    let status = send_weixin_with_state(Some(state), account, &event, &target).await?;
    if status >= 400 {
        anyhow::bail!("weixin_http_{status}");
    }
    Ok(())
}

async fn weixin_api(
    account: &NotificationAccountSummary,
    method: &str,
    payload: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let bot_token = config_string(&account.config, "botToken")
        .ok_or_else(|| anyhow::anyhow!("weixin_bot_token_required"))?;
    let base = config_string(&account.config, "baseUrl")
        .unwrap_or_else(|| "https://ilinkai.weixin.qq.com".to_string());
    let mut request_body = payload
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    request_body.insert(
        "base_info".to_string(),
        serde_json::json!({ "channel_version": "2.2.0" }),
    );
    let response = reqwest::Client::new()
        .post(format!("{}/ilink/bot/{method}", base.trim_end_matches('/')))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("AuthorizationType", "ilink_bot_token")
        .header("X-WECHAT-UIN", weixin_random_uin())
        .header("iLink-App-Id", "bot")
        .header(
            "iLink-App-ClientVersion",
            ((2 << 16) | (2 << 8) | 0_i64).to_string(),
        )
        .bearer_auth(bot_token)
        .json(&serde_json::Value::Object(request_body))
        .send()
        .await?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        anyhow::bail!(
            "{}",
            body.get("errmsg")
                .or_else(|| body.get("message"))
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("weixin_http_{}", status.as_u16()))
        );
    }
    Ok(body)
}

async fn send_wecom(
    _state: &AppState,
    account: &NotificationAccountSummary,
    event: &NotificationEvent,
    target: &serde_json::Value,
) -> anyhow::Result<i64> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    const DEFAULT_WS_URL: &str = "wss://openws.work.weixin.qq.com";
    const APP_CMD_SUBSCRIBE: &str = "aibot_subscribe";
    const APP_CMD_SEND: &str = "aibot_send_msg";

    let bot_id = config_string(&account.config, "botId")
        .ok_or_else(|| anyhow::anyhow!("wecom_bot_id_required"))?;
    let secret = config_string(&account.config, "secret")
        .ok_or_else(|| anyhow::anyhow!("wecom_secret_required"))?;
    let websocket_url = config_string(&account.config, "websocketUrl")
        .unwrap_or_else(|| DEFAULT_WS_URL.to_string());
    let chat_id = target
        .get("chatId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            account
                .config
                .get("testChatId")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| anyhow::anyhow!("wecom_chat_id_required"))?;

    let payload = serde_json::json!({
        "cmd": "aibot_send_msg",
        "headers": { "req_id": random_id() },
        "body": { "chatid": chat_id, "msgtype": "markdown", "markdown": { "content": format!("{}\n\n{}", event.title, event.message).trim().chars().take(4000).collect::<String>() } }
    });
    if let Some(handle) = _state.wecom.get(&account.id) {
        let _ = handle.outbound.send(payload);
        return Ok(202);
    }

    let (mut ws, _) = connect_async(websocket_url).await?;
    let subscribe_req = format!("subscribe-{}", random_id());
    ws.send(Message::Text(
        serde_json::json!({
            "cmd": APP_CMD_SUBSCRIBE,
            "headers": { "req_id": subscribe_req },
            "body": { "bot_id": bot_id, "secret": secret, "device_id": account.id }
        })
        .to_string(),
    ))
    .await?;

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(12);
    let mut subscribed = false;
    while tokio::time::Instant::now() < deadline {
        let Some(next) = tokio::time::timeout(std::time::Duration::from_secs(3), ws.next())
            .await
            .ok()
            .flatten()
        else {
            break;
        };
        let msg = next?;
        let text = match msg {
            Message::Text(text) => text,
            Message::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Message::Ping(payload) => {
                let _ = ws.send(Message::Pong(payload)).await;
                continue;
            }
            _ => continue,
        };
        let payload = serde_json::from_str::<serde_json::Value>(&text)
            .unwrap_or_else(|_| serde_json::json!({}));
        let req_id = payload
            .get("headers")
            .and_then(|h| h.get("req_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if req_id == subscribe_req {
            let body = payload
                .get("body")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let errcode = body
                .get("errcode")
                .or_else(|| body.get("err_code"))
                .or_else(|| payload.get("errcode"))
                .or_else(|| payload.get("err_code"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            if errcode != 0 {
                let errmsg = body
                    .get("errmsg")
                    .or_else(|| body.get("message"))
                    .or_else(|| payload.get("errmsg"))
                    .or_else(|| payload.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("subscription failed");
                anyhow::bail!("WeCom AI Bot subscribe failed: {errmsg} ({errcode})");
            }
            subscribed = true;
            break;
        }
    }
    if !subscribed {
        anyhow::bail!("wecom_websocket_not_subscribed");
    }

    let content = notification_content(&event.title, &event.message)
        .trim()
        .chars()
        .take(4000)
        .collect::<String>();
    let req_id = wecom_chat_req_id(&account.id, chat_id).unwrap_or_else(random_id);
    let (cmd, body) = if wecom_chat_req_id(&account.id, chat_id).is_some() {
        (
            "aibot_respond_msg",
            serde_json::json!({ "msgtype": "markdown", "markdown": { "content": content } }),
        )
    } else {
        (
            APP_CMD_SEND,
            serde_json::json!({ "chatid": chat_id, "msgtype": "markdown", "markdown": { "content": content } }),
        )
    };
    ws.send(Message::Text(
        serde_json::json!({
            "cmd": cmd,
            "headers": { "req_id": req_id },
            "body": body
        })
        .to_string(),
    ))
    .await?;
    let _ = ws.close(None).await;
    Ok(101)
}

async fn send_wecom_text(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    let content = text.trim().chars().take(4000).collect::<String>();
    if content.is_empty() {
        return Ok(());
    }
    let req_id = wecom_chat_req_id(&account.id, chat_id);
    let payload = if let Some(req_id) = req_id {
        serde_json::json!({
            "cmd": "aibot_respond_msg",
            "headers": { "req_id": req_id },
            "body": { "msgtype": "markdown", "markdown": { "content": content } }
        })
    } else {
        serde_json::json!({
            "cmd": "aibot_send_msg",
            "headers": { "req_id": random_id() },
            "body": { "chatid": chat_id, "msgtype": "markdown", "markdown": { "content": content } }
        })
    };
    if let Some(handle) = state.wecom.get(&account.id) {
        let _ = handle.outbound.send(payload);
        return Ok(());
    }
    let event = NotificationEvent {
        event_type: "external_reply".to_string(),
        severity: "info".to_string(),
        title: String::new(),
        message: text.to_string(),
        source_type: None,
        source_id: None,
        metadata: serde_json::json!({}),
    };
    let target = serde_json::json!({ "chatId": chat_id });
    send_wecom(state, account, &event, &target).await?;
    Ok(())
}

async fn send_feishu_text(
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    let event = NotificationEvent {
        event_type: "external_reply".to_string(),
        severity: "info".to_string(),
        title: String::new(),
        message: text.to_string(),
        source_type: None,
        source_id: None,
        metadata: serde_json::json!({}),
    };
    let target = serde_json::json!({ "chatId": chat_id });
    send_feishu(account, &event, &target).await?;
    Ok(())
}

async fn send_qq_text(
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    let event = NotificationEvent {
        event_type: "external_reply".to_string(),
        severity: "info".to_string(),
        title: String::new(),
        message: text.to_string(),
        source_type: None,
        source_id: None,
        metadata: serde_json::json!({}),
    };
    let target = if let Some(reply_to) = qq_reply_msg_id(&account.id, chat_id) {
        serde_json::json!({ "chatId": chat_id, "replyTo": reply_to })
    } else {
        serde_json::json!({ "chatId": chat_id })
    };
    send_qq(account, &event, &target).await?;
    Ok(())
}

async fn send_email_reply_text(
    state: &AppState,
    account: &NotificationAccountSummary,
    to: &str,
    subject: &str,
    body: &str,
) -> anyhow::Result<()> {
    let thread = email_thread_route(state, &account.id, to)?;
    let reference = thread
        .as_ref()
        .and_then(|route| {
            route
                .inbound_message_id
                .as_deref()
                .or(route.last_message_id.as_deref())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let message_id = generated_email_message_id(account);
    let target = serde_json::json!({ "emailTo": [to] });
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "messageId".to_string(),
        serde_json::Value::String(message_id.clone()),
    );
    if let Some(reference) = reference.as_deref() {
        metadata.insert(
            "inReplyTo".to_string(),
            serde_json::Value::String(reference.to_string()),
        );
        metadata.insert(
            "references".to_string(),
            serde_json::Value::String(reference.to_string()),
        );
    }
    let event = NotificationEvent {
        event_type: "external_reply".to_string(),
        severity: "info".to_string(),
        title: email_reply_subject(subject),
        message: body.to_string(),
        source_type: None,
        source_id: None,
        metadata: serde_json::Value::Object(metadata),
    };
    send_email(account, &event, &target).await?;
    if let Some(route) = thread {
        if let Some(session_id) = route.session_id.as_deref() {
            upsert_email_route_with_last_message(
                &state.db,
                &account.id,
                to,
                session_id,
                route.subject.as_deref().unwrap_or(subject),
                route.inbound_message_id.as_deref(),
                Some(&message_id),
            )?;
        }
    }
    Ok(())
}

fn email_reply_subject(subject: &str) -> String {
    let clean = subject.trim().trim_start_matches('[').trim_end_matches(']');
    if clean.is_empty() {
        "Re: Codex Web".to_string()
    } else if clean.to_ascii_lowercase().starts_with("re:") {
        clean.to_string()
    } else {
        format!("Re: {clean}")
    }
}

fn generated_email_message_id(account: &NotificationAccountSummary) -> String {
    let domain = config_string(&account.config, "fromEmail")
        .and_then(|email| email.split('@').nth(1).map(str::to_string))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "codex-web.local".to_string());
    format!("<{}.{}@{}>", current_millis(), random_id(), domain)
}

fn random_id() -> String {
    use rand::RngCore;
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn current_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn random_uuid() -> String {
    let mut bytes = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

fn notification_content(title: &str, message: &str) -> String {
    [title.trim(), message.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn weixin_route_context_token(
    state: &AppState,
    account_id: &str,
    chat_id: &str,
) -> anyhow::Result<Option<String>> {
    let connection = state.db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    connection
        .query_row(
            "select context_token from weixin_chat_routes where account_id = ? and chat_id = ?",
            rusqlite::params![account_id, chat_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|value| value.flatten().filter(|item| !item.trim().is_empty()))
        .map_err(Into::into)
}

fn set_weixin_route_in_table(
    state: &AppState,
    account_id: &str,
    chat_id: &str,
    session_id: &str,
    context_token: Option<&str>,
) -> anyhow::Result<()> {
    let connection = state.db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    connection.execute(
        "insert into weixin_chat_routes (account_id, chat_id, session_id, context_token, updated_at) values (?, ?, ?, ?, ?) on conflict(account_id, chat_id) do update set session_id = excluded.session_id, context_token = coalesce(excluded.context_token, weixin_chat_routes.context_token), updated_at = excluded.updated_at",
        rusqlite::params![account_id, chat_id, session_id, context_token, crate::api::common::timestamp()],
    )?;
    Ok(())
}

fn qq_chat_types() -> &'static Mutex<std::collections::HashMap<String, String>> {
    static CHAT_TYPES: OnceLock<Mutex<std::collections::HashMap<String, String>>> = OnceLock::new();
    CHAT_TYPES.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn qq_chat_type_key(account_id: &str, chat_id: &str) -> String {
    format!("{account_id}:{chat_id}")
}

fn remember_qq_chat_type(account_id: &str, chat_id: &str, event_type: &str) {
    let chat_type = match event_type {
        "GROUP_AT_MESSAGE_CREATE" => "group",
        "DIRECT_MESSAGE_CREATE" => "dm",
        "GUILD_MESSAGE_CREATE"
        | "GUILD_AT_MESSAGE_CREATE"
        | "MESSAGE_CREATE"
        | "AT_MESSAGE_CREATE" => "guild",
        _ => "c2c",
    };
    if let Ok(mut map) = qq_chat_types().lock() {
        map.insert(qq_chat_type_key(account_id, chat_id), chat_type.to_string());
    }
}

fn qq_chat_type_for_send(account_id: &str, chat_id: &str, configured: Option<&str>) -> String {
    qq_chat_types()
        .lock()
        .ok()
        .and_then(|map| map.get(&qq_chat_type_key(account_id, chat_id)).cloned())
        .or_else(|| configured.map(str::to_string))
        .unwrap_or_else(|| "user".to_string())
}

fn qq_reply_msg_ids() -> &'static Mutex<std::collections::HashMap<String, String>> {
    static MSG_IDS: OnceLock<Mutex<std::collections::HashMap<String, String>>> = OnceLock::new();
    MSG_IDS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn remember_qq_reply_msg_id(account_id: &str, chat_id: &str, message: &serde_json::Value) {
    let Some(message_id) = message
        .get("id")
        .or_else(|| message.get("msg_id"))
        .map(json_id_string)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if let Ok(mut map) = qq_reply_msg_ids().lock() {
        map.insert(qq_chat_type_key(account_id, chat_id), message_id);
    }
}

fn qq_reply_msg_id(account_id: &str, chat_id: &str) -> Option<String> {
    qq_reply_msg_ids()
        .lock()
        .ok()
        .and_then(|map| map.get(&qq_chat_type_key(account_id, chat_id)).cloned())
}

fn qq_target_reply_to(target: &serde_json::Value) -> Option<String> {
    target
        .get("replyTo")
        .or_else(|| target.get("reply_to"))
        .or_else(|| target.get("msgId"))
        .or_else(|| target.get("msg_id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[derive(Clone)]
struct QqTokenCacheEntry {
    token: String,
    expires_at_ms: u128,
}

fn qq_token_cache() -> &'static Mutex<std::collections::HashMap<String, QqTokenCacheEntry>> {
    static CACHE: OnceLock<Mutex<std::collections::HashMap<String, QqTokenCacheEntry>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn qq_gateway_intents(config: &serde_json::Value) -> i64 {
    config
        .get("intents")
        .and_then(|value| {
            value.as_i64().or_else(|| {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<i64>().ok())
            })
        })
        .filter(|value| *value > 0)
        .unwrap_or_else(|| {
            (1_i64 << 0)
                | (1_i64 << 9)
                | (1_i64 << 12)
                | (1_i64 << 25)
                | (1_i64 << 26)
                | (1_i64 << 30)
        })
}

fn qq_msg_seq() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let next = SEQ.fetch_add(1, Ordering::Relaxed);
    (((current_millis() as u64 / 1000) + next) % 65535).max(1)
}

fn wecom_chat_req_ids() -> &'static Mutex<std::collections::HashMap<String, String>> {
    static REQ_IDS: OnceLock<Mutex<std::collections::HashMap<String, String>>> = OnceLock::new();
    REQ_IDS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn remember_wecom_chat_req_id(account_id: &str, chat_id: &str, req_id: &str) {
    if req_id.trim().is_empty() {
        return;
    }
    if let Ok(mut map) = wecom_chat_req_ids().lock() {
        map.insert(format!("{account_id}:{chat_id}"), req_id.to_string());
    }
}

fn wecom_chat_req_id(account_id: &str, chat_id: &str) -> Option<String> {
    wecom_chat_req_ids()
        .lock()
        .ok()
        .and_then(|map| map.get(&format!("{account_id}:{chat_id}")).cloned())
}

#[derive(Clone)]
struct WeixinTypingTicket {
    ticket: String,
    created_at_ms: u128,
}

fn weixin_typing_tickets() -> &'static Mutex<std::collections::HashMap<String, WeixinTypingTicket>>
{
    static TICKETS: OnceLock<Mutex<std::collections::HashMap<String, WeixinTypingTicket>>> =
        OnceLock::new();
    TICKETS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn weixin_typing_stops(
) -> &'static Mutex<std::collections::HashMap<String, tokio::sync::mpsc::UnboundedSender<()>>> {
    static STOPS: OnceLock<
        Mutex<std::collections::HashMap<String, tokio::sync::mpsc::UnboundedSender<()>>>,
    > = OnceLock::new();
    STOPS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn weixin_typing_key(account_id: &str, chat_id: &str) -> String {
    format!("{account_id}:{chat_id}")
}

fn stop_weixin_typing(account_id: &str, chat_id: &str) {
    if let Ok(mut stops) = weixin_typing_stops().lock() {
        if let Some(stop) = stops.remove(&weixin_typing_key(account_id, chat_id)) {
            let _ = stop.send(());
        }
    }
}

async fn maybe_fetch_weixin_typing_ticket(
    account: &NotificationAccountSummary,
    chat_id: &str,
    context_token: Option<&str>,
    alias_chat_id: Option<&str>,
) {
    if chat_id.trim().is_empty() {
        return;
    }
    let key = weixin_typing_key(&account.id, chat_id);
    let fresh = weixin_typing_tickets()
        .lock()
        .ok()
        .and_then(|tickets| tickets.get(&key).cloned())
        .is_some_and(|ticket| {
            current_millis().saturating_sub(ticket.created_at_ms) < 10 * 60 * 1000
        });
    if fresh {
        return;
    }
    let mut payload = serde_json::json!({ "ilink_user_id": chat_id });
    if let Some(context_token) = context_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload["context_token"] = serde_json::Value::String(context_token.to_string());
    }
    let Ok(body) = weixin_api(account, "getconfig", payload).await else {
        return;
    };
    let Some(ticket) = body
        .get("typing_ticket")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
    else {
        return;
    };
    let ticket = WeixinTypingTicket {
        ticket,
        created_at_ms: current_millis(),
    };
    if let Ok(mut tickets) = weixin_typing_tickets().lock() {
        tickets.insert(key, ticket.clone());
        if let Some(alias_chat_id) = alias_chat_id
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != chat_id)
        {
            tickets.insert(weixin_typing_key(&account.id, alias_chat_id), ticket);
        }
    }
}

fn start_weixin_typing(account: NotificationAccountSummary, chat_id: String) {
    stop_weixin_typing(&account.id, &chat_id);
    let key = weixin_typing_key(&account.id, &chat_id);
    let ticket = weixin_typing_tickets()
        .lock()
        .ok()
        .and_then(|tickets| tickets.get(&key).cloned())
        .filter(|ticket| current_millis().saturating_sub(ticket.created_at_ms) < 10 * 60 * 1000);
    let Some(ticket) = ticket else {
        return;
    };
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    if let Ok(mut stops) = weixin_typing_stops().lock() {
        if let Some(previous) = stops.insert(key, stop_tx) {
            let _ = previous.send(());
        }
    }
    tokio::spawn(async move {
        let started_at = current_millis();
        loop {
            let _ = weixin_api(
                &account,
                "sendtyping",
                serde_json::json!({
                    "ilink_user_id": chat_id,
                    "typing_ticket": ticket.ticket,
                    "status": 1,
                }),
            )
            .await;
            tokio::select! {
                _ = stop_rx.recv() => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(4)) => {}
            }
            if current_millis().saturating_sub(started_at) >= 90 * 1000 {
                break;
            }
        }
    });
}

fn weixin_random_uin() -> String {
    let value = rand::RngCore::next_u32(&mut rand::thread_rng());
    base64::engine::general_purpose::STANDARD.encode(value.to_string())
}

fn choose_sender(
    state: &AppState,
    recipient: &NotificationRecipientSummary,
) -> anyhow::Result<Option<NotificationAccountSummary>> {
    let accounts = store::accounts_private(&state.db)?
        .into_iter()
        .filter(|account| account.enabled && account.channel_kind == recipient.kind)
        .collect::<Vec<_>>();
    if let Some(sender_id) = recipient
        .sender_account_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        return Ok(accounts.into_iter().find(|account| account.id == sender_id));
    }
    Ok(if accounts.len() == 1 {
        accounts.into_iter().next()
    } else {
        None
    })
}

fn test_event(
    input: TestNotificationRequest,
    account: Option<&NotificationAccountSummary>,
) -> NotificationEvent {
    let en = account
        .map(|account| telegram_language(account) == "en-US")
        .unwrap_or(false);
    NotificationEvent {
        event_type: "task_completed".to_string(),
        severity: "info".to_string(),
        title: input.title.unwrap_or_else(|| {
            if en {
                "Codex Web test notification".to_string()
            } else {
                "Codex Web 测试通知".to_string()
            }
        }),
        message: input.message.unwrap_or_else(|| {
            if en {
                "This is a test notification from Codex Web.".to_string()
            } else {
                "这是一条来自 Codex Web 的测试通知。".to_string()
            }
        }),
        source_type: None,
        source_id: None,
        metadata: serde_json::json!({ "source": "test" }),
    }
}

fn body_template(account: &NotificationAccountSummary) -> String {
    config_string(&account.config, "bodyTemplate").unwrap_or_else(|| {
        if account.channel_kind == "bark" {
            r#"{"title":"{{title}}","body":"{{message}}" }"#.to_string()
        } else {
            r#"{"title":"{{title}}","message":"{{message}}","severity":"{{severity}}","eventType":"{{eventType}}" }"#.to_string()
        }
    })
}

fn config_string(config: &serde_json::Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "********")
        .map(ToOwned::to_owned)
}

fn config_list(config: &serde_json::Value, key: &str) -> Vec<String> {
    match config.get(key) {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToOwned::to_owned)
            })
            .collect(),
        Some(serde_json::Value::String(text)) => text
            .split(',')
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

fn default_test_chat_id(account: &NotificationAccountSummary) -> Option<String> {
    let keys: &[&str] = match account.channel_kind.as_str() {
        "weixin" => &["testChatId", "userId", "accountId"],
        "qq" => &["testChatId", "testTargetId", "targetId", "openId"],
        _ => &["testChatId"],
    };
    keys.iter()
        .find_map(|key| config_string(&account.config, key))
}

fn render_template(
    template: &str,
    event: &NotificationEvent,
    config: &serde_json::Value,
) -> String {
    let mut output = template
        .replace("{{title}}", &event.title)
        .replace("{{message}}", &event.message)
        .replace("{{severity}}", &event.severity)
        .replace("{{eventType}}", &event.event_type);
    if let Some(object) = config.as_object() {
        for (key, value) in object {
            if let Some(text) = value.as_str() {
                output = output.replace(&format!("{{{{{key}}}}}"), text);
            }
        }
    }
    output
}

pub fn sync_telegram_account(state: AppState, account: NotificationAccountSummary) {
    if account.channel_kind != "telegram"
        || !account.enabled
        || !account
            .config
            .get("inboundEnabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        state.telegram.remove(&account.id);
        return;
    }
    let bot_token = match config_string(&account.config, "botToken") {
        Some(value) if !value.is_empty() => value,
        _ => {
            state.telegram.remove(&account.id);
            return;
        }
    };
    let proxy_url = config_string(&account.config, "proxyUrl")
        .unwrap_or_else(|| "https://api.telegram.org".to_string());
    let key = format!("{bot_token}\0{proxy_url}");
    if state
        .telegram
        .get(&account.id)
        .is_some_and(|handle| handle.key == key)
    {
        return;
    }
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.telegram.insert(
        account.id.clone(),
        crate::state::TelegramRuntimeHandle { key, stop: stop_tx },
    );
    tokio::spawn(async move {
        let _ = sync_telegram_commands(&account).await;
        let client = reqwest::Client::new();
        let mut offset: Option<i64> = None;
        loop {
            let poll = telegram_get_updates(&client, &account, offset);
            tokio::select! {
                _ = stop_rx.recv() => break,
                result = poll => {
                    match result {
                        Ok(updates) => {
                            for update in updates {
                                if let Some(update_id) = update.get("update_id").and_then(|value| value.as_i64()) {
                                    offset = Some(update_id + 1);
                                }
                                if let Err(error) = handle_telegram_update(&state, &account, update).await {
                                    tracing::warn!("telegram update failed for {}: {error}", account.id);
                                }
                            }
                        }
                        Err(error) => {
                            tracing::warn!("telegram polling failed for {}: {error}", account.id);
                            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {} }
                        }
                    }
                }
            }
        }
        let _ = telegram_delete_commands(&account).await;
    });
}

pub fn stop_telegram_account(state: &AppState, account_id: &str) {
    state.telegram.remove(account_id);
}

pub fn sync_weixin_account(state: AppState, account: NotificationAccountSummary) {
    if account.channel_kind != "weixin"
        || !account.enabled
        || !account
            .config
            .get("inboundEnabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        state.weixin_polling.remove(&account.id);
        return;
    }
    let token = match config_string(&account.config, "botToken") {
        Some(value) => value,
        None => {
            state.weixin_polling.remove(&account.id);
            return;
        }
    };
    let base_url = config_string(&account.config, "baseUrl")
        .unwrap_or_else(|| "https://ilinkai.weixin.qq.com".to_string());
    let key = format!("{token}\0{base_url}");
    if state
        .weixin_polling
        .get(&account.id)
        .is_some_and(|handle| handle.key == key)
    {
        return;
    }
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.weixin_polling.insert(
        account.id.clone(),
        crate::state::PollingRuntimeHandle { key, stop: stop_tx },
    );
    tokio::spawn(async move {
        let mut offset = String::new();
        loop {
            let poll = poll_weixin_account(&state, &account, &offset);
            tokio::select! {
                _ = stop_rx.recv() => break,
                result = poll => {
                    match result {
                        Ok(next_offset) => {
                            if let Some(next_offset) = next_offset {
                                offset = next_offset;
                            }
                        }
                        Err(error) => {
                            tracing::warn!("weixin polling failed for {}: {error}", account.id);
                            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {} }
                        }
                    }
                }
            }
            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {} }
        }
    });
}

pub fn stop_weixin_account(state: &AppState, account_id: &str) {
    state.weixin_polling.remove(account_id);
}

pub fn sync_qq_account(state: AppState, account: NotificationAccountSummary) {
    if account.channel_kind != "qq"
        || !account.enabled
        || !account
            .config
            .get("inboundEnabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        if account.channel_kind == "qq" {
            tracing::debug!(
                "qq runtime stopped account={} enabled={} inbound={}",
                account.id,
                account.enabled,
                account
                    .config
                    .get("inboundEnabled")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
            );
        }
        state.qq_polling.remove(&account.id);
        return;
    }
    let app_id = match config_string(&account.config, "appId") {
        Some(value) => value,
        None => {
            tracing::debug!(
                "qq runtime not started account={} reason=app_id_missing",
                account.id
            );
            state.qq_polling.remove(&account.id);
            return;
        }
    };
    let secret = match config_string(&account.config, "clientSecret")
        .or_else(|| config_string(&account.config, "appSecret"))
    {
        Some(value) => value,
        None => {
            tracing::debug!(
                "qq runtime not started account={} reason=secret_missing",
                account.id
            );
            state.qq_polling.remove(&account.id);
            return;
        }
    };
    let intents = qq_gateway_intents(&account.config);
    let key = format!("{app_id}\0{secret}\0{intents}");
    if state
        .qq_polling
        .get(&account.id)
        .is_some_and(|handle| handle.key == key)
    {
        tracing::debug!("qq runtime already running account={}", account.id);
        return;
    }
    tracing::debug!(
        "qq runtime starting account={} app_id={} intents={}",
        account.id,
        app_id,
        intents
    );
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.qq_polling.insert(
        account.id.clone(),
        crate::state::PollingRuntimeHandle { key, stop: stop_tx },
    );
    tokio::spawn(async move {
        loop {
            let run = run_qq_gateway(state.clone(), account.clone());
            tokio::select! {
                _ = stop_rx.recv() => break,
                result = run => {
                    if let Err(error) = result {
                        tracing::warn!("qq gateway failed for {}: {error}", account.id);
                    }
                }
            }
            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {} }
        }
    });
}

pub fn stop_qq_account(state: &AppState, account_id: &str) {
    state.qq_polling.remove(account_id);
}

pub fn sync_feishu_account(state: AppState, account: NotificationAccountSummary) {
    if account.channel_kind != "feishu"
        || !account.enabled
        || !account
            .config
            .get("inboundEnabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        state.feishu_polling.remove(&account.id);
        return;
    }
    let app_id = match config_string(&account.config, "appId") {
        Some(value) if !value.is_empty() => value,
        _ => {
            state.feishu_polling.remove(&account.id);
            return;
        }
    };
    let app_secret = match config_string(&account.config, "appSecret") {
        Some(value) if !value.is_empty() => value,
        _ => {
            state.feishu_polling.remove(&account.id);
            return;
        }
    };
    let connection_mode = config_string(&account.config, "connectionMode")
        .unwrap_or_else(|| "websocket".to_string())
        .to_ascii_lowercase();
    if connection_mode != "websocket" {
        state.feishu_polling.remove(&account.id);
        return;
    }
    let domain = config_string(&account.config, "domain").unwrap_or_else(|| "feishu".to_string());
    let encrypt_key = config_string(&account.config, "encryptKey").unwrap_or_default();
    let verification_token =
        config_string(&account.config, "verificationToken").unwrap_or_default();
    let key = format!("{domain}\0{app_id}\0{app_secret}\0{encrypt_key}\0{verification_token}");
    if state
        .feishu_polling
        .get(&account.id)
        .is_some_and(|handle| handle.key == key)
    {
        return;
    }
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.feishu_polling.insert(
        account.id.clone(),
        crate::state::PollingRuntimeHandle { key, stop: stop_tx },
    );
    tokio::spawn(async move {
        loop {
            let run = run_feishu_gateway(state.clone(), account.clone());
            tokio::select! {
                _ = stop_rx.recv() => break,
                result = run => {
                    if let Err(error) = result {
                        tracing::warn!("feishu websocket failed for {}: {error}", account.id);
                    }
                }
            }
            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {} }
        }
    });
}

pub fn stop_feishu_account(state: &AppState, account_id: &str) {
    state.feishu_polling.remove(account_id);
}

pub async fn handle_feishu_event_callback(
    state: &AppState,
    account_id: &str,
    payload: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let account = store::account_private(&state.db, account_id)?
        .ok_or_else(|| anyhow::anyhow!("notification_account_not_found"))?;
    if account.channel_kind != "feishu" || !account.enabled {
        anyhow::bail!("feishu_account_disabled");
    }
    if !account
        .config
        .get("inboundEnabled")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        anyhow::bail!("feishu_inbound_disabled");
    }
    if let Some(token) = config_string(&account.config, "verificationToken") {
        let incoming = payload
            .get("token")
            .and_then(|value| value.as_str())
            .or_else(|| {
                payload
                    .get("header")
                    .and_then(|value| value.get("token"))
                    .and_then(|value| value.as_str())
            })
            .unwrap_or("");
        if incoming != token {
            anyhow::bail!("feishu_verification_failed");
        }
    }
    if let Some(challenge) = payload.get("challenge").and_then(|value| value.as_str()) {
        return Ok(serde_json::json!({ "challenge": challenge }));
    }
    if let Some(event) = feishu_message_event(&payload) {
        handle_feishu_message(state, &account, event).await?;
    }
    Ok(serde_json::json!({ "ok": true }))
}

pub fn sync_email_account(state: AppState, account: NotificationAccountSummary) {
    if account.channel_kind != "email"
        || !account.enabled
        || !account
            .config
            .get("inboundEnabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        state.email_polling.remove(&account.id);
        return;
    }
    let imap_host = config_string(&account.config, "imapHost")
        .or_else(|| config_string(&account.config, "host"));
    let username = config_string(&account.config, "imapUsername")
        .or_else(|| config_string(&account.config, "username"));
    let password = config_string(&account.config, "imapPassword")
        .or_else(|| config_string(&account.config, "password"));
    let (Some(imap_host), Some(username), Some(password)) = (imap_host, username, password) else {
        state.email_polling.remove(&account.id);
        return;
    };
    let key = format!("{imap_host}\0{username}\0{password}");
    if state
        .email_polling
        .get(&account.id)
        .is_some_and(|handle| handle.key == key)
    {
        return;
    }
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.email_polling.insert(
        account.id.clone(),
        crate::state::PollingRuntimeHandle { key, stop: stop_tx },
    );
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stop_rx.recv() => break,
                result = poll_email_account(state.clone(), account.clone()) => {
                    if let Err(error) = result {
                        tracing::warn!("email inbound poll failed for {}: {error}", account.id);
                    }
                }
            }
            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {} }
        }
    });
}

pub fn stop_email_account(state: &AppState, account_id: &str) {
    state.email_polling.remove(account_id);
}

async fn poll_email_account(
    state: AppState,
    account: NotificationAccountSummary,
) -> anyhow::Result<()> {
    let raws = tokio::task::spawn_blocking({
        let account = account.clone();
        move || fetch_unseen_email_sources(&account)
    })
    .await??;
    for raw in raws {
        if let Err(error) = handle_inbound_email(&state, &account, &raw).await {
            tracing::warn!("email inbound message failed for {}: {error}", account.id);
        }
    }
    Ok(())
}

fn fetch_unseen_email_sources(
    account: &NotificationAccountSummary,
) -> anyhow::Result<Vec<Vec<u8>>> {
    let host = config_string(&account.config, "imapHost")
        .or_else(|| config_string(&account.config, "host"))
        .ok_or_else(|| anyhow::anyhow!("email_imap_host_required"))?;
    let username = config_string(&account.config, "imapUsername")
        .or_else(|| config_string(&account.config, "username"))
        .ok_or_else(|| anyhow::anyhow!("email_imap_username_required"))?;
    let password = config_string(&account.config, "imapPassword")
        .or_else(|| config_string(&account.config, "password"))
        .ok_or_else(|| anyhow::anyhow!("email_imap_password_required"))?;
    let port = account
        .config
        .get("imapPort")
        .and_then(|value| value.as_u64())
        .unwrap_or(993) as u16;
    let mailbox =
        config_string(&account.config, "inboundMailbox").unwrap_or_else(|| "INBOX".to_string());
    let tls = native_tls::TlsConnector::builder().build()?;
    let client = imap::connect((host.as_str(), port), host.as_str(), &tls)?;
    let mut session = client.login(username, password).map_err(|error| error.0)?;
    session.select(mailbox)?;
    let unseen = session.search("UNSEEN")?;
    let mut raws = Vec::new();
    for uid in unseen.iter().take(20) {
        let messages = session.fetch(uid.to_string(), "RFC822")?;
        for message in messages.iter() {
            if let Some(body) = message.body() {
                raws.push(body.to_vec());
            }
        }
        let _ = session.store(uid.to_string(), "+FLAGS (\\Seen)");
    }
    let _ = session.logout();
    Ok(raws)
}

async fn handle_inbound_email(
    state: &AppState,
    account: &NotificationAccountSummary,
    raw: &[u8],
) -> anyhow::Result<()> {
    let parsed = mailparse::parse_mail(raw)?;
    let headers = parsed.get_headers();
    let from = headers.get_first_value("From").unwrap_or_default();
    let subject = headers
        .get_first_value("Subject")
        .unwrap_or_else(|| "(no subject)".to_string());
    let message_id = headers.get_first_value("Message-ID");
    let sender_email = extract_email_address(&from).to_lowercase();
    if sender_email.is_empty() || email_is_automated(&headers, &sender_email) {
        return Ok(());
    }
    let sender_address = config_string(&account.config, "fromEmail")
        .or_else(|| config_string(&account.config, "username"))
        .unwrap_or_default()
        .to_lowercase();
    if !sender_address.is_empty() && sender_email == sender_address {
        return Ok(());
    }
    let allowed = config_list(&account.config, "allowedSenderEmails")
        .into_iter()
        .map(|item| item.to_lowercase())
        .collect::<Vec<_>>();
    if !allowed.is_empty() && !allowed.iter().any(|item| item == &sender_email) {
        return Ok(());
    }
    let body = extract_email_body(&parsed).unwrap_or_default();
    let session = email_route_or_create_session(
        state,
        account,
        &sender_email,
        &from,
        &subject,
        message_id.as_deref(),
    )?;
    let content = build_email_inbound_body(account, &from, &sender_email, &subject, &body);
    let mode = dispatch_platform_chat_message(
        state,
        &state.email_chat,
        "Email",
        &account.id,
        &sender_email,
        &session,
        &content,
    )
    .await?;
    tracing::debug!("email inbound dispatched to {} as {mode}", session.id);
    Ok(())
}

fn extract_email_address(from: &str) -> String {
    if let Some(start) = from.find('<') {
        if let Some(end) = from[start + 1..].find('>') {
            return from[start + 1..start + 1 + end].trim().to_string();
        }
    }
    from.split_whitespace()
        .find(|part| part.contains('@'))
        .unwrap_or(from)
        .trim_matches(|ch: char| matches!(ch, '<' | '>' | ',' | ';' | '"'))
        .to_string()
}

fn email_is_automated(headers: &mailparse::headers::Headers, sender_email: &str) -> bool {
    let lower = sender_email.to_lowercase();
    lower.contains("noreply")
        || lower.contains("no-reply")
        || lower.contains("donotreply")
        || lower.contains("mailer-daemon")
        || headers
            .get_first_value("Auto-Submitted")
            .is_some_and(|value| value.to_lowercase() != "no")
        || headers
            .get_first_value("X-Auto-Response-Suppress")
            .is_some()
        || headers.get_first_value("List-Unsubscribe").is_some()
        || headers.get_first_value("Precedence").is_some_and(|value| {
            value.to_lowercase().contains("bulk")
                || value.to_lowercase().contains("list")
                || value.to_lowercase().contains("junk")
        })
}

fn extract_email_body(parsed: &mailparse::ParsedMail<'_>) -> Option<String> {
    if parsed.subparts.is_empty() {
        return parsed.get_body().ok().map(|body| strip_html(&body));
    }
    for part in &parsed.subparts {
        let mimetype = part.ctype.mimetype.to_lowercase();
        if mimetype == "text/plain" {
            if let Ok(body) = part.get_body() {
                return Some(body.trim().to_string());
            }
        }
    }
    for part in &parsed.subparts {
        if let Some(body) = extract_email_body(part) {
            if !body.trim().is_empty() {
                return Some(body);
            }
        }
    }
    None
}

fn strip_html(value: &str) -> String {
    let re = regex::Regex::new(r"(?is)<br\s*/?>|</p>").unwrap();
    let text = re.replace_all(value, "\n");
    let re = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
    re.replace_all(&text, "")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

fn build_email_inbound_body(
    account: &NotificationAccountSummary,
    sender_name: &str,
    sender_email: &str,
    subject: &str,
    body: &str,
) -> String {
    let subject_line = if telegram_language(account) == "en-US" {
        format!("[Subject: {subject}]")
    } else {
        format!("【主题：{subject}】")
    };
    let sender_line = if sender_name.contains(sender_email) || sender_email.trim().is_empty() {
        sender_name.to_string()
    } else {
        format!("{sender_name} <{sender_email}>")
    };
    [sender_line, subject_line, body.trim().to_string()]
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
        .trim()
        .to_string()
        .if_empty(|| subject.to_string())
}

fn email_route_or_create_session(
    state: &AppState,
    account: &NotificationAccountSummary,
    sender_email: &str,
    sender_name: &str,
    subject: &str,
    inbound_message_id: Option<&str>,
) -> anyhow::Result<crate::api::sessions::models::SessionSummary> {
    if let Some(session) =
        route_session_from_table(state, "email_chat_routes", account, sender_email)?
    {
        upsert_email_route(
            &state.db,
            &account.id,
            sender_email,
            &session.id,
            subject,
            inbound_message_id,
        )?;
        return Ok(session);
    }
    if let Some(default_id) = config_string(&account.config, "defaultSessionId") {
        if let Some(session) = crate::api::sessions::store::get_session(&state.db, &default_id)? {
            upsert_email_route(
                &state.db,
                &account.id,
                sender_email,
                &session.id,
                subject,
                inbound_message_id,
            )?;
            return Ok(session);
        }
    }
    let title = if subject.trim().is_empty() {
        format!("Email from {sender_name}")
    } else {
        subject.trim().chars().take(80).collect::<String>()
    };
    let session = crate::api::sessions::store::create_session(
        &state.db,
        crate::api::sessions::models::CreateSessionRequest {
            title,
            project_id: None,
            conversation_type: Some("codex".to_string()),
            room_id: None,
            goal: None,
        },
    )?;
    upsert_email_route(
        &state.db,
        &account.id,
        sender_email,
        &session.id,
        subject,
        inbound_message_id,
    )?;
    Ok(session)
}

fn upsert_email_route(
    db: &crate::db::Db,
    account_id: &str,
    chat_id: &str,
    session_id: &str,
    subject: &str,
    inbound_message_id: Option<&str>,
) -> anyhow::Result<()> {
    upsert_email_route_with_last_message(
        db,
        account_id,
        chat_id,
        session_id,
        subject,
        inbound_message_id,
        None,
    )
}

fn upsert_email_route_with_last_message(
    db: &crate::db::Db,
    account_id: &str,
    chat_id: &str,
    session_id: &str,
    subject: &str,
    inbound_message_id: Option<&str>,
    last_message_id: Option<&str>,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    connection.execute(
        "insert into email_chat_routes (account_id, chat_id, session_id, subject, inbound_message_id, last_message_id, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(account_id, chat_id) do update set session_id = excluded.session_id, subject = coalesce(excluded.subject, email_chat_routes.subject), inbound_message_id = coalesce(excluded.inbound_message_id, email_chat_routes.inbound_message_id), last_message_id = coalesce(excluded.last_message_id, email_chat_routes.last_message_id), updated_at = excluded.updated_at",
        rusqlite::params![account_id, chat_id.to_lowercase(), session_id, subject, inbound_message_id, last_message_id, crate::api::common::timestamp()],
    )?;
    Ok(())
}

#[derive(Default)]
struct EmailThreadRoute {
    session_id: Option<String>,
    subject: Option<String>,
    inbound_message_id: Option<String>,
    last_message_id: Option<String>,
}

fn email_thread_route(
    state: &AppState,
    account_id: &str,
    chat_id: &str,
) -> anyhow::Result<Option<EmailThreadRoute>> {
    let connection = state.db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    connection
        .query_row(
            "select session_id, subject, inbound_message_id, last_message_id from email_chat_routes where account_id = ? and chat_id = ?",
            rusqlite::params![account_id, chat_id.to_lowercase()],
            |row| {
                Ok(EmailThreadRoute {
                    session_id: row.get(0)?,
                    subject: row.get(1)?,
                    inbound_message_id: row.get(2)?,
                    last_message_id: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

trait EmptyFallback {
    fn if_empty<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl EmptyFallback for String {
    fn if_empty<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

#[derive(Clone, PartialEq, ProstMessage)]
struct FeishuWsHeader {
    #[prost(string, required, tag = "1")]
    key: String,
    #[prost(string, required, tag = "2")]
    value: String,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct FeishuWsFrame {
    #[prost(uint64, required, tag = "1")]
    seq_id: u64,
    #[prost(uint64, required, tag = "2")]
    log_id: u64,
    #[prost(int32, required, tag = "3")]
    service: i32,
    #[prost(int32, required, tag = "4")]
    method: i32,
    #[prost(message, repeated, tag = "5")]
    headers: Vec<FeishuWsHeader>,
    #[prost(string, optional, tag = "6")]
    payload_encoding: Option<String>,
    #[prost(string, optional, tag = "7")]
    payload_type: Option<String>,
    #[prost(bytes, optional, tag = "8")]
    payload: Option<Vec<u8>>,
    #[prost(string, optional, tag = "9")]
    log_id_new: Option<String>,
}

struct FeishuWsConfig {
    url: String,
    service_id: i32,
    ping_interval_ms: u64,
}

async fn run_feishu_gateway(
    state: AppState,
    account: NotificationAccountSummary,
) -> anyhow::Result<()> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    let config = feishu_ws_config(&account).await?;
    let (mut ws, _) = connect_async(&config.url).await?;
    let mut ping = tokio::time::interval(std::time::Duration::from_millis(
        config.ping_interval_ms.max(1_000),
    ));
    let mut cache = std::collections::HashMap::<String, FeishuWsFrameParts>::new();
    loop {
        tokio::select! {
            _ = ping.tick() => {
                let frame = FeishuWsFrame {
                    seq_id: 0,
                    log_id: 0,
                    service: config.service_id,
                    method: 0,
                    headers: vec![FeishuWsHeader { key: "type".to_string(), value: "ping".to_string() }],
                    payload_encoding: None,
                    payload_type: None,
                    payload: None,
                    log_id_new: None,
                };
                let mut bytes = Vec::new();
                frame.encode(&mut bytes)?;
                ws.send(Message::Binary(bytes)).await?;
            }
            msg = ws.next() => {
                let Some(msg) = msg else { break; };
                let msg = msg?;
                let bytes = match msg {
                    Message::Binary(bytes) => bytes,
                    Message::Ping(payload) => { let _ = ws.send(Message::Pong(payload)).await; continue; }
                    Message::Text(text) => text.into_bytes(),
                    _ => continue,
                };
                let frame = FeishuWsFrame::decode(bytes.as_slice())?;
                match feishu_ws_frame_type(&frame).as_deref() {
                    Some("pong") => feishu_update_ping_interval(&mut ping, &frame),
                    Some("ping") => {}
                    Some("event") => {
                        if let Some(payload) = feishu_merge_ws_event(&mut cache, &frame)? {
                            if let Err(error) = handle_feishu_ws_payload(&state, &account, payload).await {
                                tracing::warn!("feishu websocket event failed for {}: {error}", account.id);
                            }
                            let ack = feishu_ws_ack_frame(&frame, 200)?;
                            let mut bytes = Vec::new();
                            ack.encode(&mut bytes)?;
                            ws.send(Message::Binary(bytes)).await?;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}

struct FeishuWsFrameParts {
    created_at: std::time::Instant,
    trace_id: String,
    parts: Vec<Option<Vec<u8>>>,
}

async fn feishu_ws_config(account: &NotificationAccountSummary) -> anyhow::Result<FeishuWsConfig> {
    let app_id = config_string(&account.config, "appId")
        .ok_or_else(|| anyhow::anyhow!("feishu_app_id_required"))?;
    let app_secret = config_string(&account.config, "appSecret")
        .ok_or_else(|| anyhow::anyhow!("feishu_app_secret_required"))?;
    let domain = match config_string(&account.config, "domain")
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("lark") => "https://open.larksuite.com",
        _ => "https://open.feishu.cn",
    };
    let body = reqwest::Client::new()
        .post(format!("{domain}/callback/ws/endpoint"))
        .header("locale", "zh")
        .header("User-Agent", "codex-web-rs/feishu-ws")
        .json(&serde_json::json!({ "AppID": app_id, "AppSecret": app_secret }))
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    if body
        .get("code")
        .and_then(|value| value.as_i64())
        .unwrap_or(-1)
        != 0
    {
        anyhow::bail!(
            "{}",
            body.get("msg")
                .and_then(|value| value.as_str())
                .unwrap_or("feishu_ws_endpoint_error")
        );
    }
    let data = body
        .get("data")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let url = data
        .get("URL")
        .or_else(|| data.get("url"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("feishu_ws_url_missing"))?
        .to_string();
    let service_id = url::Url::parse(&url)
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(key, _)| key == "service_id")
                .and_then(|(_, value)| value.parse::<i32>().ok())
        })
        .unwrap_or(0);
    let client_config = data
        .get("ClientConfig")
        .or_else(|| data.get("client_config"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let ping_interval_ms = client_config
        .get("PingInterval")
        .or_else(|| client_config.get("ping_interval"))
        .and_then(|value| value.as_u64())
        .unwrap_or(120)
        * 1000;
    Ok(FeishuWsConfig {
        url,
        service_id,
        ping_interval_ms,
    })
}

fn feishu_ws_frame_type(frame: &FeishuWsFrame) -> Option<String> {
    feishu_ws_header(frame, "type")
}

fn feishu_ws_header(frame: &FeishuWsFrame, key: &str) -> Option<String> {
    frame
        .headers
        .iter()
        .find(|header| header.key == key)
        .map(|header| header.value.clone())
}

fn feishu_update_ping_interval(ping: &mut tokio::time::Interval, frame: &FeishuWsFrame) {
    let Some(payload) = frame.payload.as_deref() else {
        return;
    };
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(payload) else {
        return;
    };
    let seconds = body
        .get("PingInterval")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if seconds > 0 {
        *ping = tokio::time::interval(std::time::Duration::from_secs(seconds));
    }
}

fn feishu_merge_ws_event(
    cache: &mut std::collections::HashMap<String, FeishuWsFrameParts>,
    frame: &FeishuWsFrame,
) -> anyhow::Result<Option<serde_json::Value>> {
    cache.retain(|_, item| item.created_at.elapsed() < std::time::Duration::from_secs(10));
    let message_id = feishu_ws_header(frame, "message_id").unwrap_or_else(random_id);
    let sum = feishu_ws_header(frame, "sum")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let seq = feishu_ws_header(frame, "seq")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
        .min(sum - 1);
    let trace_id = feishu_ws_header(frame, "trace_id").unwrap_or_default();
    let payload = frame.payload.clone().unwrap_or_default();
    let entry = cache
        .entry(message_id.clone())
        .or_insert_with(|| FeishuWsFrameParts {
            created_at: std::time::Instant::now(),
            trace_id,
            parts: vec![None; sum],
        });
    if entry.parts.len() != sum {
        entry.parts.resize(sum, None);
    }
    entry.parts[seq] = Some(payload);
    if entry.parts.iter().all(|part| part.is_some()) {
        let bytes = entry
            .parts
            .iter()
            .flat_map(|part| part.as_ref().cloned().unwrap_or_default())
            .collect::<Vec<_>>();
        let value = serde_json::from_slice::<serde_json::Value>(&bytes)?;
        tracing::debug!("feishu websocket event {} {}", message_id, entry.trace_id);
        cache.remove(&message_id);
        return Ok(Some(value));
    }
    Ok(None)
}

fn feishu_ws_ack_frame(frame: &FeishuWsFrame, status_code: i64) -> anyhow::Result<FeishuWsFrame> {
    let mut headers = frame.headers.clone();
    headers.push(FeishuWsHeader {
        key: "biz_rt".to_string(),
        value: "0".to_string(),
    });
    Ok(FeishuWsFrame {
        seq_id: frame.seq_id,
        log_id: frame.log_id,
        service: frame.service,
        method: frame.method,
        headers,
        payload_encoding: frame.payload_encoding.clone(),
        payload_type: frame.payload_type.clone(),
        payload: Some(serde_json::to_vec(
            &serde_json::json!({ "code": status_code }),
        )?),
        log_id_new: frame.log_id_new.clone(),
    })
}

async fn handle_feishu_ws_payload(
    state: &AppState,
    account: &NotificationAccountSummary,
    mut payload: serde_json::Value,
) -> anyhow::Result<()> {
    payload = feishu_decrypt_payload(account, payload)?;
    if let Some(event) = feishu_message_event(&payload) {
        handle_feishu_message(state, account, event).await?;
    }
    Ok(())
}

fn feishu_decrypt_payload(
    account: &NotificationAccountSummary,
    payload: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let Some(encrypt) = payload.get("encrypt").and_then(|value| value.as_str()) else {
        return Ok(payload);
    };
    let encrypt_key = config_string(&account.config, "encryptKey")
        .ok_or_else(|| anyhow::anyhow!("feishu_encrypt_key_required"))?;
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
    let key = Sha256::digest(encrypt_key.as_bytes());
    let bytes = base64::engine::general_purpose::STANDARD.decode(encrypt)?;
    if bytes.len() < 16 {
        anyhow::bail!("feishu_encrypt_payload_invalid");
    }
    let iv = &bytes[..16];
    let ciphertext = &bytes[16..];
    let decrypted = Aes256CbcDec::new_from_slices(&key, iv)
        .map_err(|error| anyhow::anyhow!(error.to_string()))?
        .decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(serde_json::from_slice::<serde_json::Value>(&decrypted)?)
}

async fn run_qq_gateway(
    state: AppState,
    account: NotificationAccountSummary,
) -> anyhow::Result<()> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    let token = qq_access_token(&account).await?;
    let intents = qq_gateway_intents(&account.config);
    let gateway = qq_gateway_url(&token).await?;
    tracing::debug!(
        "qq gateway connecting account={} url={}",
        account.id,
        gateway
    );
    let (mut ws, _) = connect_async(gateway).await?;
    tracing::debug!("qq gateway connected account={}", account.id);
    let mut last_seq: Option<i64> = None;
    let mut session_id = String::new();
    let mut heartbeat: Option<tokio::time::Interval> = None;
    loop {
        tokio::select! {
            _ = async {
                if let Some(interval) = heartbeat.as_mut() {
                    interval.tick().await;
                } else {
                    std::future::pending::<()>().await;
                }
            } => {
                let _ = ws.send(Message::Text(serde_json::json!({"op":1,"d":last_seq}).to_string())).await;
            }
            msg = ws.next() => {
                let Some(msg) = msg else { break; };
                let msg = msg?;
                let text = match msg {
                    Message::Text(text) => text,
                    Message::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                    Message::Ping(payload) => { let _ = ws.send(Message::Pong(payload)).await; continue; }
                    Message::Close(frame) => {
                        tracing::warn!("qq gateway close account={} frame={:?}", account.id, frame);
                        break;
                    }
                    _ => continue,
                };
                let payload = serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| serde_json::json!({}));
                if let Some(seq) = payload.get("s").and_then(|value| value.as_i64()) {
                    last_seq = Some(seq);
                }
                if payload.get("op").and_then(|value| value.as_i64()) == Some(10) {
                    let interval_ms = payload.get("d").and_then(|d| d.get("heartbeat_interval")).and_then(|value| value.as_u64()).unwrap_or(30_000);
                    heartbeat = Some(tokio::time::interval(std::time::Duration::from_millis((interval_ms as f64 * 0.8) as u64)));
                    tracing::debug!("qq gateway hello account={} heartbeat_ms={}", account.id, interval_ms);
                    if !session_id.is_empty() && last_seq.is_some() {
                        ws.send(Message::Text(serde_json::json!({
                            "op": 6,
                            "d": { "token": format!("QQBot {token}"), "session_id": session_id, "seq": last_seq }
                        }).to_string())).await?;
                        tracing::debug!("qq gateway resume account={} seq={:?}", account.id, last_seq);
                    } else {
                        ws.send(Message::Text(qq_identify_payload(&token, intents).to_string())).await?;
                        tracing::debug!("qq gateway identify account={} phase=hello intents={}", account.id, intents);
                    }
                    continue;
                }
                if payload.get("op").and_then(|value| value.as_i64()) == Some(7) {
                    tracing::warn!("qq gateway reconnect requested account={} payload={}", account.id, text.chars().take(500).collect::<String>());
                    break;
                }
                if payload.get("op").and_then(|value| value.as_i64()) == Some(9) {
                    tracing::warn!("qq gateway invalid session account={} payload={}", account.id, text.chars().take(500).collect::<String>());
                    session_id.clear();
                    break;
                }
                if payload.get("op").and_then(|value| value.as_i64()) == Some(0) {
                    let event_type = payload.get("t").and_then(|value| value.as_str()).unwrap_or("");
                    if event_type == "READY" {
                        session_id = payload.get("d").and_then(|d| d.get("session_id")).and_then(|value| value.as_str()).unwrap_or("").to_string();
                        tracing::debug!("qq gateway ready account={} session_id={}", account.id, session_id);
                        continue;
                    }
                    tracing::debug!("qq gateway dispatch account={} type={}", account.id, event_type);
                    if qq_message_event_supported(event_type) {
                        if let Some(message) = payload.get("d") {
                            tracing::debug!("qq inbound event account={} type={}", account.id, event_type);
                            if let Err(error) = handle_qq_message(&state, &account, event_type, message).await {
                                tracing::warn!("qq inbound update failed for {} {event_type}: {error}", account.id);
                            }
                        }
                    } else if !event_type.is_empty() {
                        tracing::debug!("qq ignored gateway event account={} type={}", account.id, event_type);
                    }
                }
            }
        }
    }
    tracing::debug!("qq gateway disconnected account={}", account.id);
    Ok(())
}

fn qq_identify_payload(token: &str, intents: i64) -> serde_json::Value {
    serde_json::json!({
        "op": 2,
        "d": {
            "token": format!("QQBot {token}"),
            "intents": intents,
            "shard": [0, 1],
            "properties": { "$os": "linux", "$browser": "codex-web", "$device": "codex-web" }
        }
    })
}

async fn qq_access_token(account: &NotificationAccountSummary) -> anyhow::Result<String> {
    let app_id = config_string(&account.config, "appId")
        .ok_or_else(|| anyhow::anyhow!("qq_app_id_required"))?;
    let client_secret = config_string(&account.config, "clientSecret")
        .or_else(|| config_string(&account.config, "appSecret"))
        .ok_or_else(|| anyhow::anyhow!("qq_client_secret_required"))?;
    let cache_key = format!("{app_id}\0{client_secret}");
    if let Some(cached) = qq_token_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&cache_key).cloned())
        .filter(|entry| current_millis() + 60_000 < entry.expires_at_ms)
    {
        return Ok(cached.token);
    }
    let response = reqwest::Client::new()
        .post("https://bots.qq.com/app/getAppAccessToken")
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&serde_json::json!({ "appId": app_id, "clientSecret": client_secret }))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!(if text.is_empty() {
            format!("qq_token_http_{}", status.as_u16())
        } else {
            text.chars().take(500).collect::<String>()
        });
    }
    let body =
        serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| serde_json::json!({}));
    let token = body
        .get("access_token")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("qq_access_token_missing"))?;
    let expires_in = body
        .get("expires_in")
        .and_then(|value| value.as_u64())
        .unwrap_or(7200);
    if let Ok(mut cache) = qq_token_cache().lock() {
        cache.insert(
            cache_key,
            QqTokenCacheEntry {
                token: token.clone(),
                expires_at_ms: current_millis() + expires_in as u128 * 1000,
            },
        );
    }
    Ok(token)
}

async fn qq_gateway_url(token: &str) -> anyhow::Result<String> {
    let response = reqwest::Client::new()
        .get("https://api.sgroup.qq.com/gateway")
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::AUTHORIZATION, format!("QQBot {token}"))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!(if text.is_empty() {
            format!("qq_gateway_http_{}", status.as_u16())
        } else {
            text.chars().take(500).collect::<String>()
        });
    }
    let body =
        serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| serde_json::json!({}));
    body.get("url")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("qq_gateway_url_missing"))
}

async fn handle_qq_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    event_type: &str,
    message: &serde_json::Value,
) -> anyhow::Result<()> {
    let chat_id = qq_message_chat_id(event_type, message);
    let user_id = qq_message_user_id(event_type, message);
    let text = message
        .get("content")
        .and_then(|value| value.as_str())
        .map(clean_qq_message_text)
        .unwrap_or("");
    let allowed_chat_ids = config_list(&account.config, "allowedChatIds");
    let allowed_user_ids = config_list(&account.config, "allowedUserIds");
    if chat_id.is_empty() {
        tracing::debug!(
            "qq inbound ignored account={} type={} reason=chat_id_empty payload={}",
            account.id,
            event_type,
            message.to_string().chars().take(500).collect::<String>()
        );
        return Ok(());
    }
    if allowed_chat_ids.len() > 0 && !allowed_chat_ids.iter().any(|item| item == &chat_id) {
        tracing::debug!(
            "qq inbound ignored account={} type={} chat={} reason=chat_not_allowed",
            account.id,
            event_type,
            chat_id
        );
        return Ok(());
    }
    if allowed_user_ids.len() > 0
        && !user_id.is_empty()
        && !allowed_user_ids.iter().any(|item| item == &user_id)
    {
        tracing::debug!(
            "qq inbound ignored account={} type={} chat={} user={} reason=user_not_allowed",
            account.id,
            event_type,
            chat_id,
            user_id
        );
        return Ok(());
    }
    if text.is_empty() {
        tracing::debug!(
            "qq inbound ignored account={} type={} chat={} user={} reason=text_empty payload={}",
            account.id,
            event_type,
            chat_id,
            user_id,
            message.to_string().chars().take(500).collect::<String>()
        );
        return Ok(());
    }
    tracing::debug!(
        "qq inbound message account={} type={} chat={} user={} text={}",
        account.id,
        event_type,
        chat_id,
        user_id,
        text.chars().take(80).collect::<String>()
    );
    remember_qq_chat_type(&account.id, &chat_id, event_type);
    remember_qq_reply_msg_id(&account.id, &chat_id, message);
    handle_qq_text_update(state, account, &chat_id, text).await
}

fn clean_qq_message_text(value: &str) -> &str {
    let mut text = value.trim();
    loop {
        let trimmed = text.trim_start();
        if let Some(rest) = trimmed
            .strip_prefix("<@!")
            .and_then(|rest| rest.find('>').map(|index| &rest[index + 1..]))
        {
            text = rest.trim_start();
            continue;
        }
        if let Some(rest) = trimmed
            .strip_prefix("<@")
            .and_then(|rest| rest.find('>').map(|index| &rest[index + 1..]))
        {
            text = rest.trim_start();
            continue;
        }
        return trimmed;
    }
}

fn qq_message_event_supported(event_type: &str) -> bool {
    matches!(
        event_type,
        "C2C_MESSAGE_CREATE"
            | "GROUP_AT_MESSAGE_CREATE"
            | "DIRECT_MESSAGE_CREATE"
            | "GUILD_MESSAGE_CREATE"
            | "GUILD_AT_MESSAGE_CREATE"
            | "MESSAGE_CREATE"
            | "AT_MESSAGE_CREATE"
    )
}

fn qq_message_chat_id(event_type: &str, message: &serde_json::Value) -> String {
    match event_type {
        "C2C_MESSAGE_CREATE" => message
            .get("from_user_id")
            .or_else(|| message.get("author").and_then(|v| v.get("id")))
            .map(json_id_string)
            .unwrap_or_default(),
        "GROUP_AT_MESSAGE_CREATE" => message
            .get("group_openid")
            .map(json_id_string)
            .unwrap_or_default(),
        "DIRECT_MESSAGE_CREATE" => message
            .get("guild_id")
            .or_else(|| message.get("channel_id"))
            .map(json_id_string)
            .unwrap_or_default(),
        "GUILD_MESSAGE_CREATE"
        | "GUILD_AT_MESSAGE_CREATE"
        | "MESSAGE_CREATE"
        | "AT_MESSAGE_CREATE" => message
            .get("channel_id")
            .map(json_id_string)
            .unwrap_or_default(),
        _ => message
            .get("group_openid")
            .or_else(|| message.get("channel_id"))
            .or_else(|| message.get("guild_id"))
            .or_else(|| message.get("from_user_id"))
            .map(json_id_string)
            .unwrap_or_default(),
    }
}

fn qq_message_user_id(event_type: &str, message: &serde_json::Value) -> String {
    match event_type {
        "C2C_MESSAGE_CREATE" => message
            .get("from_user_id")
            .or_else(|| message.get("author").and_then(|v| v.get("id")))
            .map(json_id_string)
            .unwrap_or_default(),
        "GROUP_AT_MESSAGE_CREATE" => message
            .get("author")
            .and_then(|v| v.get("member_openid"))
            .or_else(|| message.get("from_user_id"))
            .map(json_id_string)
            .unwrap_or_default(),
        "DIRECT_MESSAGE_CREATE"
        | "GUILD_MESSAGE_CREATE"
        | "GUILD_AT_MESSAGE_CREATE"
        | "MESSAGE_CREATE"
        | "AT_MESSAGE_CREATE" => message
            .get("author")
            .and_then(|v| v.get("id"))
            .map(json_id_string)
            .unwrap_or_default(),
        _ => message
            .get("from_user_id")
            .map(json_id_string)
            .unwrap_or_default(),
    }
}

async fn handle_qq_text_update(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    if chat_id.trim().is_empty() || text.trim().is_empty() {
        return Ok(());
    }
    let kind = ExternalPlatformKind::Qq;
    let pending_key = platform_pending_prefix("qq_chat_routes", &account.id, chat_id);
    if text.trim() == "/cancel" {
        state.qq_chat.clear_pending_prefix(&pending_key);
        send_qq_text(
            account,
            chat_id,
            platform_text(account, "已取消。", "Canceled."),
        )
        .await?;
        return Ok(());
    }
    if let Some(pending) = state
        .qq_chat
        .remove_pending(&format!("{pending_key}:input"))
    {
        if platform_pending_expired(&pending) {
            send_qq_text(
                account,
                chat_id,
                platform_text(account, "待处理输入已过期。", "Pending input expired."),
            )
            .await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("send") {
            route_qq_send_message(state, account, chat_id, text).await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("terminal") {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    text,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, text).await?;
            }
            return Ok(());
        }
    }
    if handle_platform_tool_selection(state, kind, account, chat_id, text).await? {
        return Ok(());
    }
    if let Some(selection) = resolve_platform_selection(
        state,
        &state.qq_chat,
        "qq_chat_routes",
        account,
        chat_id,
        text,
    )? {
        match selection {
            PlatformSelection::Expired => {
                send_qq_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "这次选择已过期，请重新开始。",
                        "This selection expired. Please start again.",
                    ),
                )
                .await?
            }
            PlatformSelection::NotFound => {
                send_qq_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?
            }
            PlatformSelection::Bind(session) => {
                set_route_in_table(
                    &state.db,
                    "qq_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                send_qq_text(
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            }
            PlatformSelection::Send { session, message } => {
                set_route_in_table(
                    &state.db,
                    "qq_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                dispatch_platform_chat_message(
                    state,
                    &state.qq_chat,
                    "QQ",
                    &account.id,
                    chat_id,
                    &session,
                    &message,
                )
                .await?;
            }
        }
        return Ok(());
    }
    let (command, rest) = telegram_command(text);
    match command {
        "/start" | "/help" => {
            send_qq_text(
                account,
                chat_id,
                &platform_help_text(account, "QQ Bot", Some(chat_id)),
            )
            .await?
        }
        "/sessions" => {
            let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
            send_qq_text(
                account,
                chat_id,
                &telegram_sessions_text(account, &sessions),
            )
            .await?;
        }
        "/whoami" => {
            send_qq_text(account, chat_id, &platform_identity_text(account, chat_id)).await?;
        }
        "/agents" => send_platform_agents(state, kind, account, chat_id).await?,
        "/rooms" => send_platform_rooms(state, kind, account, chat_id).await?,
        "/files" => {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                send_platform_files(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_file_roots(state, kind, account, chat_id).await?;
            }
        }
        "/terminal" => {
            if rest.is_empty() {
                state.qq_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "terminal", "createdAt": current_millis() }),
                );
                send_qq_text(account, chat_id, platform_text(account, "等待输入：请在下一条消息里发送终端命令，或发送 /cancel 取消。", "Waiting for input: send the terminal command in your next reply, or send /cancel to cancel.")).await?;
            } else if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, rest).await?;
            }
        }
        "/bind" => {
            if rest.is_empty() {
                send_qq_bind_picker(state, account, chat_id).await?;
            } else if let Some(session) = find_platform_session(state, rest)? {
                set_route_in_table(
                    &state.db,
                    "qq_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                send_qq_text(
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            } else {
                send_qq_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?;
            }
        }
        "/unbind" => {
            clear_route_in_table(&state.db, "qq_chat_routes", &account.id, chat_id)?;
            send_qq_text(
                account,
                chat_id,
                platform_text(account, "已清除绑定会话。", "Bound session cleared."),
            )
            .await?;
        }
        "/send" => {
            if rest.is_empty() {
                state.qq_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "send", "createdAt": current_millis() }),
                );
                send_qq_text(
                    account,
                    chat_id,
                    platform_text(account, "请发送消息内容。", "Send me the message text."),
                )
                .await?;
            } else {
                handle_qq_send_command(state, account, chat_id, rest).await?;
            }
        }
        _ => route_qq_send_message(state, account, chat_id, text).await?,
    }
    Ok(())
}

fn feishu_message_event(payload: &serde_json::Value) -> Option<&serde_json::Value> {
    let schema = payload
        .get("schema")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if schema == "2.0" {
        let header = payload.get("header")?;
        let event_type = header
            .get("event_type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        return (event_type == "im.message.receive_v1")
            .then(|| payload.get("event"))
            .flatten();
    }
    let event_type = payload
        .get("type")
        .or_else(|| payload.get("event_type"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if event_type == "im.message.receive_v1" {
        return payload.get("event").or_else(|| payload.get("data"));
    }
    payload.get("event").filter(|event| {
        event
            .get("message")
            .and_then(|message| message.get("chat_id"))
            .is_some()
    })
}

async fn handle_feishu_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    event: &serde_json::Value,
) -> anyhow::Result<()> {
    let sender_type = event
        .get("sender")
        .and_then(|sender| sender.get("sender_type"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if sender_type == "bot" || sender_type == "app" {
        return Ok(());
    }
    let message = event.get("message").unwrap_or(event);
    let chat_id = message
        .get("chat_id")
        .or_else(|| message.get("chatId"))
        .map(json_id_string)
        .unwrap_or_default();
    let user_id = event
        .get("sender")
        .and_then(|sender| sender.get("sender_id"))
        .and_then(|sender_id| {
            sender_id
                .get("open_id")
                .or_else(|| sender_id.get("user_id"))
                .or_else(|| sender_id.get("union_id"))
        })
        .map(json_id_string)
        .unwrap_or_default();
    let allowed_chat_ids = config_list(&account.config, "allowedChatIds");
    let allowed_user_ids = config_list(&account.config, "allowedUserIds");
    if chat_id.is_empty()
        || (!allowed_chat_ids.is_empty() && !allowed_chat_ids.iter().any(|item| item == &chat_id))
        || (!allowed_user_ids.is_empty()
            && !user_id.is_empty()
            && !allowed_user_ids.iter().any(|item| item == &user_id))
    {
        return Ok(());
    }
    let text = feishu_message_text(message);
    if text.trim().is_empty() {
        return Ok(());
    }
    handle_feishu_text_update(state, account, &chat_id, &text).await
}

fn feishu_message_text(message: &serde_json::Value) -> String {
    let raw = message
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if raw.is_empty() {
        return String::new();
    }
    let message_type = message
        .get("message_type")
        .or_else(|| message.get("msg_type"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(raw) {
        if message_type == "text" {
            if let Some(text) = payload.get("text").and_then(|value| value.as_str()) {
                return text.trim().to_string();
            }
        }
        if let Some(text) = payload.get("text").and_then(|value| value.as_str()) {
            return text.trim().to_string();
        }
        if let Some(text) = payload.get("content").and_then(|value| value.as_str()) {
            return text.trim().to_string();
        }
    }
    raw.to_string()
}

async fn handle_feishu_text_update(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    if chat_id.trim().is_empty() || text.trim().is_empty() {
        return Ok(());
    }
    let kind = ExternalPlatformKind::Feishu;
    let pending_key = platform_pending_prefix("feishu_chat_routes", &account.id, chat_id);
    if text.trim() == "/cancel" {
        state.feishu_chat.clear_pending_prefix(&pending_key);
        send_feishu_text(
            account,
            chat_id,
            platform_text(account, "已取消。", "Canceled."),
        )
        .await?;
        return Ok(());
    }
    if let Some(pending) = state
        .feishu_chat
        .remove_pending(&format!("{pending_key}:input"))
    {
        if platform_pending_expired(&pending) {
            send_feishu_text(
                account,
                chat_id,
                platform_text(account, "待处理输入已过期。", "Pending input expired."),
            )
            .await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("send") {
            route_feishu_send_message(state, account, chat_id, text).await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("terminal") {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    text,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, text).await?;
            }
            return Ok(());
        }
    }
    if handle_platform_tool_selection(state, kind, account, chat_id, text).await? {
        return Ok(());
    }
    if let Some(selection) = resolve_platform_selection(
        state,
        &state.feishu_chat,
        "feishu_chat_routes",
        account,
        chat_id,
        text,
    )? {
        match selection {
            PlatformSelection::Expired => {
                send_feishu_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "这次选择已过期，请重新开始。",
                        "This selection expired. Please start again.",
                    ),
                )
                .await?
            }
            PlatformSelection::NotFound => {
                send_feishu_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?
            }
            PlatformSelection::Bind(session) => {
                set_route_in_table(
                    &state.db,
                    "feishu_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                send_feishu_text(
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            }
            PlatformSelection::Send { session, message } => {
                set_route_in_table(
                    &state.db,
                    "feishu_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                dispatch_platform_chat_message(
                    state,
                    &state.feishu_chat,
                    "Feishu",
                    &account.id,
                    chat_id,
                    &session,
                    &message,
                )
                .await?;
            }
        }
        return Ok(());
    }
    let (command, rest) = telegram_command(text);
    match command {
        "/start" | "/help" => {
            send_feishu_text(
                account,
                chat_id,
                &platform_help_text(account, "Feishu Bot", None),
            )
            .await?
        }
        "/sessions" => {
            let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
            send_feishu_text(
                account,
                chat_id,
                &telegram_sessions_text(account, &sessions),
            )
            .await?;
        }
        "/whoami" => {
            send_feishu_text(account, chat_id, &platform_identity_text(account, chat_id)).await?;
        }
        "/agents" => send_platform_agents(state, kind, account, chat_id).await?,
        "/rooms" => send_platform_rooms(state, kind, account, chat_id).await?,
        "/files" => {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                send_platform_files(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_file_roots(state, kind, account, chat_id).await?;
            }
        }
        "/terminal" => {
            if rest.is_empty() {
                state.feishu_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "terminal", "createdAt": current_millis() }),
                );
                send_feishu_text(account, chat_id, platform_text(account, "等待输入：请在下一条消息里发送终端命令，或发送 /cancel 取消。", "Waiting for input: send the terminal command in your next reply, or send /cancel to cancel.")).await?;
            } else if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, rest).await?;
            }
        }
        "/bind" => {
            if rest.is_empty() {
                send_feishu_bind_picker(state, account, chat_id).await?;
            } else if let Some(session) = find_platform_session(state, rest)? {
                set_route_in_table(
                    &state.db,
                    "feishu_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                send_feishu_text(
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            } else {
                send_feishu_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?;
            }
        }
        "/unbind" => {
            clear_route_in_table(&state.db, "feishu_chat_routes", &account.id, chat_id)?;
            send_feishu_text(
                account,
                chat_id,
                platform_text(account, "已清除绑定会话。", "Bound session cleared."),
            )
            .await?;
        }
        "/send" => {
            if rest.is_empty() {
                state.feishu_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "send", "createdAt": current_millis() }),
                );
                send_feishu_text(
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "请在下一条消息里发送内容。",
                        "Send the message content in your next reply.",
                    ),
                )
                .await?;
            } else {
                handle_feishu_send_command(state, account, chat_id, rest).await?;
            }
        }
        _ => route_feishu_send_message(state, account, chat_id, text).await?,
    }
    Ok(())
}

async fn poll_weixin_account(
    state: &AppState,
    account: &NotificationAccountSummary,
    offset: &str,
) -> anyhow::Result<Option<String>> {
    let response = weixin_api(
        account,
        "getupdates",
        serde_json::json!({ "get_updates_buf": if offset.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(offset.to_string()) } }),
    )
    .await?;
    let next_offset = response
        .get("get_updates_buf")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let ret = response
        .get("ret")
        .or_else(|| response.get("errcode"))
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    if ret != 0 {
        return Ok(next_offset);
    }
    for message in response
        .get("msgs")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
    {
        if weixin_inbound_allowed(account, &message) {
            let chat_id = weixin_message_chat_id(&message);
            let user_id = weixin_message_user_id(&message);
            let context_token = message
                .get("context_token")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let ticket_chat_id = if user_id.is_empty() {
                &chat_id
            } else {
                &user_id
            };
            maybe_fetch_weixin_typing_ticket(
                account,
                ticket_chat_id,
                context_token.as_deref(),
                Some(&chat_id),
            )
            .await;
            let text = weixin_message_text(&message);
            if !chat_id.is_empty() && !text.is_empty() {
                if let Some(context_token) = context_token.as_deref() {
                    if let Some(session) =
                        route_session_from_table(state, "weixin_chat_routes", account, &chat_id)?
                    {
                        let _ = set_weixin_route_in_table(
                            state,
                            &account.id,
                            &chat_id,
                            &session.id,
                            Some(context_token),
                        );
                    }
                }
                let _ = handle_weixin_text_update(state, account, &chat_id, &text).await;
            }
        }
    }
    Ok(next_offset)
}

pub fn sync_notification_platform_runtimes(state: AppState) {
    let Ok(accounts) = store::accounts_private(&state.db) else {
        return;
    };
    for account in accounts {
        sync_telegram_account(state.clone(), account.clone());
        sync_weixin_account(state.clone(), account.clone());
        sync_qq_account(state.clone(), account.clone());
        sync_feishu_account(state.clone(), account.clone());
        sync_email_account(state.clone(), account.clone());
        sync_wecom_account(state.clone(), account);
    }
}

async fn telegram_get_updates(
    client: &reqwest::Client,
    account: &NotificationAccountSummary,
    offset: Option<i64>,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let mut payload =
        serde_json::json!({ "timeout": 25, "allowed_updates": ["message", "callback_query"] });
    if let Some(offset) = offset {
        payload["offset"] = serde_json::Value::Number(offset.into());
    }
    let response = client
        .post(telegram_api_url(account, "getUpdates")?)
        .json(&payload)
        .send()
        .await?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() || body.get("ok").and_then(|value| value.as_bool()) == Some(false) {
        let message = body
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("telegram_get_updates_failed")
            .to_string();
        anyhow::bail!(message);
    }
    Ok(body
        .get("result")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default())
}

async fn handle_telegram_update(
    state: &AppState,
    account: &NotificationAccountSummary,
    update: serde_json::Value,
) -> anyhow::Result<()> {
    if update.get("callback_query").is_some() {
        return handle_telegram_callback(state, account, &update).await;
    }
    let Some(message) = update.get("message") else {
        return Ok(());
    };
    let chat_id = message
        .get("chat")
        .and_then(|chat| chat.get("id"))
        .map(json_id_string)
        .unwrap_or_default();
    if chat_id.is_empty() || !telegram_inbound_allowed(account, message, &chat_id) {
        return Ok(());
    }
    let text = message
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    if text.is_empty() {
        return Ok(());
    }
    let user_id = message
        .get("from")
        .and_then(|from| from.get("id"))
        .map(json_id_string)
        .unwrap_or_default();
    let is_private = message
        .get("chat")
        .and_then(|chat| chat.get("type"))
        .and_then(|value| value.as_str())
        == Some("private");

    let input_key = format!("{}:input", telegram_pending_prefix(&account.id, &chat_id));
    if let Some(pending) = state.telegram.remove_pending(&input_key) {
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            telegram_send_text(
                account,
                &chat_id,
                telegram_text(
                    account,
                    "这条待输入状态已过期，请重新发送命令。",
                    "This input state expired. Send the command again.",
                ),
            )
            .await?;
            return Ok(());
        }
        if text == "/cancel" {
            telegram_send_text(
                account,
                &chat_id,
                telegram_text(account, "已取消。", "Canceled."),
            )
            .await?;
            return Ok(());
        }
        match pending
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("")
        {
            "send" => {
                route_telegram_send_message(state, account, &chat_id, text).await?;
                return Ok(());
            }
            "terminal" => {
                if let Some(session) = telegram_route_session(state, account, &chat_id)? {
                    send_telegram_working(state, account, &chat_id).await?;
                    run_telegram_terminal(
                        state,
                        account,
                        &chat_id,
                        PathBuf::from(session.workspace_path),
                        text,
                    )
                    .await?;
                } else {
                    send_telegram_terminal_roots(state, account, &chat_id, text).await?;
                }
                return Ok(());
            }
            _ => {}
        }
    }

    let (command, rest) = telegram_command(text);
    if command == "/start" || command == "/help" {
        telegram_send_text(
            account,
            &chat_id,
            &telegram_help_text(account, &user_id, &chat_id, is_private),
        )
        .await?;
        return Ok(());
    }
    if command == "/whoami" {
        telegram_send_text(
            account,
            &chat_id,
            &telegram_identity_text(account, &user_id, &chat_id, is_private),
        )
        .await?;
        return Ok(());
    }
    if command == "/sessions" {
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        telegram_send_text(
            account,
            &chat_id,
            &telegram_sessions_text(account, &sessions),
        )
        .await?;
        return Ok(());
    }
    if command == "/agents" {
        send_telegram_agents(state, account, &chat_id).await?;
        return Ok(());
    }
    if command == "/rooms" {
        send_telegram_rooms(state, account, &chat_id).await?;
        return Ok(());
    }
    if command == "/files" {
        if let Some(session) = telegram_route_session(state, account, &chat_id)? {
            send_telegram_files(
                state,
                account,
                &chat_id,
                PathBuf::from(session.workspace_path),
                rest,
            )
            .await?;
        } else {
            send_telegram_file_roots(state, account, &chat_id).await?;
        }
        return Ok(());
    }
    if command == "/terminal" {
        let terminal_command = rest;
        if terminal_command.is_empty() {
            send_telegram_input_prompt(state, account, &chat_id, "terminal").await?;
        } else if let Some(session) = telegram_route_session(state, account, &chat_id)? {
            run_telegram_terminal(
                state,
                account,
                &chat_id,
                PathBuf::from(session.workspace_path),
                terminal_command,
            )
            .await?;
        } else {
            send_telegram_terminal_roots(state, account, &chat_id, terminal_command).await?;
        }
        return Ok(());
    }
    if command == "/unbind" {
        clear_telegram_route(&state.db, &account.id, &chat_id)?;
        telegram_send_text(
            account,
            &chat_id,
            telegram_text(account, "已清除绑定会话。", "Bound session cleared."),
        )
        .await?;
        return Ok(());
    }
    if command == "/bind" {
        let query = rest;
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        if query.is_empty() {
            send_telegram_bind_picker(state, account, &chat_id, &sessions).await?;
            return Ok(());
        }
        let session = find_telegram_session(&sessions, query);
        if let Some(session) = session {
            set_telegram_route(&state.db, &account.id, &chat_id, &session.id)?;
            telegram_send_text(
                account,
                &chat_id,
                &format!(
                    "{} {}",
                    telegram_text(account, "已绑定：", "Bound to:"),
                    telegram_session_label(account, session)
                ),
            )
            .await?;
        } else {
            telegram_send_text(
                account,
                &chat_id,
                telegram_text(
                    account,
                    "未找到会话，请先用 /sessions 查看最近会话。",
                    "Session not found. Use /sessions to view recent sessions.",
                ),
            )
            .await?;
        }
        return Ok(());
    }
    if command == "/send" {
        handle_telegram_send(state, account, &chat_id, rest).await?;
        return Ok(());
    }

    let session = telegram_route_session(state, account, &chat_id)?;
    if let Some(session) = session {
        dispatch_telegram_message(state, account, &chat_id, &session, text).await?;
    } else {
        telegram_send_text(account, &chat_id, telegram_text(account, "请先用 /bind <会话ID或标题> 绑定会话，或使用 /send <会话> | <消息>。", "Bind a session with /bind <sessionId or title>, or use /send <session> | <message>."))
            .await?;
    }
    Ok(())
}

async fn handle_telegram_send(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    rest: &str,
) -> anyhow::Result<()> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    let (target_text, message) = if let Some((target, message)) = rest.split_once('|') {
        (target.trim(), message.trim())
    } else {
        ("", rest.trim())
    };
    if message.is_empty() {
        send_telegram_input_prompt(state, account, chat_id, "send").await?;
        return Ok(());
    }
    let session = if target_text.is_empty() {
        telegram_route_session(state, account, chat_id)?
    } else {
        find_telegram_session(&sessions, target_text).cloned()
    };
    if let Some(session) = session {
        dispatch_telegram_message(state, account, chat_id, &session, message).await?;
    } else {
        if target_text.is_empty() {
            send_telegram_session_picker(state, account, chat_id, message, &sessions).await?;
        } else {
            telegram_send_text(
                account,
                chat_id,
                telegram_text(
                    account,
                    "未找到会话，请先用 /sessions 查看最近会话。",
                    "Session not found. Use /sessions to view recent sessions.",
                ),
            )
            .await?;
        }
    }
    Ok(())
}

async fn handle_telegram_callback(
    state: &AppState,
    account: &NotificationAccountSummary,
    update: &serde_json::Value,
) -> anyhow::Result<()> {
    let Some(callback) = update.get("callback_query") else {
        return Ok(());
    };
    let callback_id = callback
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let data = callback
        .get("data")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let chat_id = callback
        .get("message")
        .and_then(|message| message.get("chat"))
        .and_then(|chat| chat.get("id"))
        .map(json_id_string)
        .unwrap_or_default();
    if chat_id.is_empty() {
        return Ok(());
    }
    let prefix = telegram_pending_prefix(&account.id, &chat_id);
    if data == "cancel" {
        state.telegram.clear_pending_prefix(&prefix);
        answer_telegram_callback(
            account,
            callback_id,
            telegram_text(account, "已取消。", "Canceled."),
        )
        .await?;
        telegram_send_text(
            account,
            &chat_id,
            telegram_text(account, "已取消。", "Canceled."),
        )
        .await?;
        return Ok(());
    }
    if let Some(page) = data
        .strip_prefix("agentpage:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        answer_telegram_callback(
            account,
            callback_id,
            telegram_text(account, "处理中...", "Working..."),
        )
        .await?;
        let message_id = callback
            .get("message")
            .and_then(|message| message.get("message_id"))
            .and_then(|value| value.as_i64());
        send_telegram_agents_page(state, account, &chat_id, page, message_id).await?;
        return Ok(());
    }
    if let Some(page) = data
        .strip_prefix("roompage:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        answer_telegram_callback(
            account,
            callback_id,
            telegram_text(account, "处理中...", "Working..."),
        )
        .await?;
        let message_id = callback
            .get("message")
            .and_then(|message| message.get("message_id"))
            .and_then(|value| value.as_i64());
        send_telegram_rooms_page(state, account, &chat_id, page, message_id).await?;
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("bind:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:bind");
        let pending = state
            .telegram
            .remove_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "这条文件列表已过期。", "This file list expired."),
            )
            .await?;
            return Ok(());
        }
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "这条绑定列表已过期。", "This bind list expired."),
            )
            .await?;
            return Ok(());
        }
        let session_id = pending
            .get("sessionIds")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(session) = crate::api::sessions::store::get_session(&state.db, session_id)? {
            set_telegram_route(&state.db, &account.id, &chat_id, &session.id)?;
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "处理中...", "Working..."),
            )
            .await?;
            telegram_send_text(
                account,
                &chat_id,
                &format!(
                    "{} {}\n{}",
                    telegram_text(account, "已绑定：", "Bound to:"),
                    session.title,
                    session.id
                ),
            )
            .await?;
        } else {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "会话已不可用。", "Session is no longer available."),
            )
            .await?;
        }
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("send:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:send");
        let pending = state
            .telegram
            .remove_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(
                    account,
                    "这条待处理消息已过期。",
                    "This pending message expired.",
                ),
            )
            .await?;
            return Ok(());
        }
        let message = pending
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let session_id = pending
            .get("sessionIds")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(session) = crate::api::sessions::store::get_session(&state.db, session_id)? {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "处理中...", "Working..."),
            )
            .await?;
            dispatch_telegram_message(state, account, &chat_id, &session, &message).await?;
        } else {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "会话已不可用。", "Session is no longer available."),
            )
            .await?;
        }
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("agent:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:agents");
        let pending = state
            .telegram
            .remove_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(
                    account,
                    "这条 Agent 列表已过期。",
                    "This agent list expired.",
                ),
            )
            .await?;
            return Ok(());
        }
        let agent_id = pending
            .get("ids")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        match crate::api::agents::store::create_agent_session(
            &state.db,
            agent_id,
            crate::api::agents::models::CreateAgentSessionRequest { project_id: None },
        )? {
            Ok(session) => {
                set_telegram_route(&state.db, &account.id, &chat_id, &session.id)?;
                answer_telegram_callback(
                    account,
                    callback_id,
                    telegram_text(account, "处理中...", "Working..."),
                )
                .await?;
                telegram_send_text(
                    account,
                    &chat_id,
                    &format!(
                        "{}\n{}\n{}",
                        telegram_text(account, "已创建并绑定会话：", "Created and bound session:"),
                        telegram_session_label(account, &session),
                        session.id
                    ),
                )
                .await?;
            }
            Err(_) => {
                answer_telegram_callback(
                    account,
                    callback_id,
                    telegram_text(account, "Agent 已不可用。", "Agent is no longer available."),
                )
                .await?
            }
        }
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("room:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:rooms");
        let pending = state
            .telegram
            .remove_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "这条 Room 列表已过期。", "This room list expired."),
            )
            .await?;
            return Ok(());
        }
        let room_id = pending
            .get("ids")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(room) = crate::api::rooms::store::get_room(&state.db, room_id)? {
            let Some(session_id) = room.session_id.as_deref() else {
                answer_telegram_callback(
                    account,
                    callback_id,
                    telegram_text(
                        account,
                        "Room 会话已不可用。",
                        "Room session is no longer available.",
                    ),
                )
                .await?;
                return Ok(());
            };
            set_telegram_route(&state.db, &account.id, &chat_id, session_id)?;
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "处理中...", "Working..."),
            )
            .await?;
            telegram_send_text(
                account,
                &chat_id,
                &format!(
                    "{}\n{}\n{}",
                    telegram_text(account, "已绑定 Room 会话：", "Bound room session:"),
                    room.name,
                    session_id
                ),
            )
            .await?;
        } else {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(
                    account,
                    "Room 会话已不可用。",
                    "Room session is no longer available.",
                ),
            )
            .await?;
        }
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("filectx:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:file_roots");
        let pending = state
            .telegram
            .remove_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        let root = pending
            .get("roots")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.get("root"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if root.is_empty() {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(
                    account,
                    "文件根目录已不可用。",
                    "File root is no longer available.",
                ),
            )
            .await?;
        } else {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "处理中...", "Working..."),
            )
            .await?;
            send_telegram_working(state, account, &chat_id).await?;
            send_telegram_files(state, account, &chat_id, PathBuf::from(root), "").await?;
        }
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("file:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:files");
        let pending = state
            .telegram
            .get_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "这条文件列表已过期。", "This file list expired."),
            )
            .await?;
            return Ok(());
        }
        let root = pending.get("root").and_then(|v| v.as_str()).unwrap_or("");
        let rel = pending
            .get("relPath")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let name = pending
            .get("dirNames")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        answer_telegram_callback(
            account,
            callback_id,
            telegram_text(account, "处理中...", "Working..."),
        )
        .await?;
        send_telegram_working(state, account, &chat_id).await?;
        send_telegram_files(
            state,
            account,
            &chat_id,
            PathBuf::from(root),
            &Path::new(rel).join(name).to_string_lossy(),
        )
        .await?;
        return Ok(());
    }
    if data == "fileup" {
        let key = format!("{prefix}:files");
        let pending = state
            .telegram
            .get_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(account, "这条文件列表已过期。", "This file list expired."),
            )
            .await?;
            return Ok(());
        }
        let root = pending.get("root").and_then(|v| v.as_str()).unwrap_or("");
        let rel = pending
            .get("relPath")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let parent = Path::new(rel)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        answer_telegram_callback(
            account,
            callback_id,
            telegram_text(account, "处理中...", "Working..."),
        )
        .await?;
        send_telegram_working(state, account, &chat_id).await?;
        send_telegram_files(state, account, &chat_id, PathBuf::from(root), &parent).await?;
        return Ok(());
    }
    if let Some(index) = data
        .strip_prefix("term:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        let key = format!("{prefix}:terminal");
        let pending = state
            .telegram
            .remove_pending(&key)
            .unwrap_or_else(|| serde_json::json!({}));
        if telegram_pending_expired(&pending, 10 * 60 * 1000) {
            answer_telegram_callback(
                account,
                callback_id,
                telegram_text(
                    account,
                    "这条终端命令已过期。",
                    "This terminal command expired.",
                ),
            )
            .await?;
            return Ok(());
        }
        let command = pending
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let root = pending
            .get("roots")
            .and_then(|v| v.as_array())
            .and_then(|items| items.get(index))
            .and_then(|v| v.get("root"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        answer_telegram_callback(
            account,
            callback_id,
            telegram_text(account, "处理中...", "Working..."),
        )
        .await?;
        send_telegram_working(state, account, &chat_id).await?;
        run_telegram_terminal(state, account, &chat_id, PathBuf::from(root), &command).await?;
    }
    Ok(())
}

async fn answer_telegram_callback(
    account: &NotificationAccountSummary,
    callback_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    if callback_id.is_empty() {
        return Ok(());
    }
    let _ = telegram_api(account, "answerCallbackQuery", serde_json::json!({ "callback_query_id": callback_id, "text": text.chars().take(180).collect::<String>() })).await?;
    Ok(())
}

fn start_telegram_typing(state: &AppState, account: NotificationAccountSummary, chat_id: String) {
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state
        .telegram
        .set_typing_stop(&account.id, &chat_id, stop_tx);
    tokio::spawn(async move {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(90);
        loop {
            let _ = telegram_api(
                &account,
                "sendChatAction",
                serde_json::json!({ "chat_id": chat_id, "action": "typing" }),
            )
            .await;
            tokio::select! {
                _ = stop_rx.recv() => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(4)) => {
                    if tokio::time::Instant::now() >= deadline {
                        break;
                    }
                }
            }
        }
    });
}

async fn send_telegram_working(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    start_telegram_typing(state, account.clone(), chat_id.to_string());
    telegram_send_text(
        account,
        chat_id,
        telegram_text(account, "处理中...", "Working..."),
    )
    .await
}

async fn send_telegram_input_prompt(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    kind: &str,
) -> anyhow::Result<()> {
    state.telegram.set_pending(
        format!("{}:input", telegram_pending_prefix(&account.id, chat_id)),
        serde_json::json!({ "kind": kind, "createdAt": current_millis() }),
    );
    let text = match kind {
        "terminal" => telegram_text(
            account,
            "等待输入：请在下一条消息里发送终端命令，或发送 /cancel 取消。",
            "Waiting for input: send the terminal command in your next reply, or send /cancel to cancel.",
        ),
        _ => telegram_text(
            account,
            "等待输入：请在下一条消息里发送内容，或发送 /cancel 取消。",
            "Waiting for input: send the message content in your next reply, or send /cancel to cancel.",
        ),
    };
    telegram_send_markup(
        account,
        chat_id,
        text,
        vec![serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }])],
    )
    .await
}

fn telegram_command(text: &str) -> (&str, &str) {
    let trimmed = text.trim();
    let split_at = trimmed
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(index, _)| index)
        .unwrap_or(trimmed.len());
    let raw_command = &trimmed[..split_at];
    let command = raw_command.split('@').next().unwrap_or(raw_command);
    let rest = trimmed[split_at..].trim();
    (command, rest)
}

fn format_telegram_session_reply(
    session: &crate::api::sessions::models::SessionSummary,
    content: &str,
) -> String {
    let title = if session.title.trim().is_empty() {
        session.id.as_str()
    } else {
        session.title.as_str()
    };
    let body = content.trim();
    if body.is_empty() {
        format!("[{title}]")
    } else {
        format!("[{title}]\n\n{body}")
    }
}

fn clear_all_platform_active_reply_targets(state: &AppState, session_id: &str) {
    state.telegram.clear_active_reply_targets(session_id);
    state.weixin_chat.clear_active_reply_targets(session_id);
    state.wecom_chat.clear_active_reply_targets(session_id);
    state.feishu_chat.clear_active_reply_targets(session_id);
    state.qq_chat.clear_active_reply_targets(session_id);
    state.email_chat.clear_active_reply_targets(session_id);
}

async fn dispatch_telegram_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    session: &crate::api::sessions::models::SessionSummary,
    text: &str,
) -> anyhow::Result<()> {
    send_telegram_working(state, account, chat_id).await?;
    clear_all_platform_active_reply_targets(state, &session.id);
    let prompt = format!("Telegram message from chat {chat_id}:\n\n{text}");
    if state.tasks.get(&session.id).is_some() || session.status == "running" {
        let queued = crate::api::sessions::queue::enqueue(
            &state.db,
            session,
            crate::api::sessions::models::QueueMessageRequest {
                prompt: prompt.clone(),
                provider_id: session.provider_id.clone(),
                model: session.model.clone(),
                reply_to_message_id: None,
            },
        )?;
        state
            .telegram
            .add_queued_reply_target(&queued.id, &account.id, chat_id);
    } else {
        let outcome = crate::api::tasks::runner::continue_task(
            state.clone(),
            session.id.clone(),
            crate::api::tasks::runner::ContinueCodexTaskRequest {
                prompt,
                provider_id: session.provider_id.clone(),
                model: session.model.clone(),
                reply_to_message_id: None,
                attachments: None,
            },
        )
        .await?;
        match outcome {
            crate::api::tasks::runner::ContinueTaskOutcome::Queued(item) => {
                state
                    .telegram
                    .add_queued_reply_target(&item.id, &account.id, chat_id);
            }
            crate::api::tasks::runner::ContinueTaskOutcome::Session(_) => {
                state
                    .telegram
                    .add_active_reply_target(&session.id, &account.id, chat_id);
            }
        }
    };
    Ok(())
}

async fn route_telegram_send_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    message: &str,
) -> anyhow::Result<()> {
    if let Some(session) = telegram_route_session(state, account, chat_id)? {
        dispatch_telegram_message(state, account, chat_id, &session, message).await?;
    } else {
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        send_telegram_session_picker(state, account, chat_id, message, &sessions).await?;
    }
    Ok(())
}

async fn dispatch_platform_chat_message(
    state: &AppState,
    runtime: &crate::state::PlatformChatRuntimeState,
    platform_label: &str,
    account_id: &str,
    chat_id: &str,
    session: &crate::api::sessions::models::SessionSummary,
    text: &str,
) -> anyhow::Result<String> {
    let prompt = format!("{platform_label} message from chat {chat_id}:\n\n{text}");
    clear_all_platform_active_reply_targets(state, &session.id);
    if state.tasks.get(&session.id).is_some() || session.status == "running" {
        let queued = crate::api::sessions::queue::enqueue(
            &state.db,
            session,
            crate::api::sessions::models::QueueMessageRequest {
                prompt,
                provider_id: session.provider_id.clone(),
                model: session.model.clone(),
                reply_to_message_id: None,
            },
        )?;
        runtime.add_queued_reply_target(&queued.id, account_id, chat_id);
        return Ok("queued".to_string());
    }
    let outcome = crate::api::tasks::runner::continue_task(
        state.clone(),
        session.id.clone(),
        crate::api::tasks::runner::ContinueCodexTaskRequest {
            prompt,
            provider_id: session.provider_id.clone(),
            model: session.model.clone(),
            reply_to_message_id: None,
            attachments: None,
        },
    )
    .await?;
    match outcome {
        crate::api::tasks::runner::ContinueTaskOutcome::Queued(item) => {
            runtime.add_queued_reply_target(&item.id, account_id, chat_id);
            Ok("queued".to_string())
        }
        crate::api::tasks::runner::ContinueTaskOutcome::Session(_) => {
            runtime.add_active_reply_target(&session.id, account_id, chat_id);
            Ok("started".to_string())
        }
    }
}

fn route_session_from_table(
    state: &AppState,
    table: &str,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<Option<crate::api::sessions::models::SessionSummary>> {
    let connection = state.db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    let sql = format!("select session_id from {table} where account_id = ? and chat_id = ?");
    let routed: Option<String> = connection
        .query_row(&sql, rusqlite::params![&account.id, chat_id], |row| {
            row.get(0)
        })
        .optional()?;
    let session_id = routed.or_else(|| config_string(&account.config, "defaultSessionId"));
    Ok(session_id.and_then(|id| {
        crate::api::sessions::store::get_session(&state.db, &id)
            .ok()
            .flatten()
    }))
}

fn set_route_in_table(
    db: &crate::db::Db,
    table: &str,
    account_id: &str,
    chat_id: &str,
    session_id: &str,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    let sql = format!(
        "insert into {table} (account_id, chat_id, session_id, updated_at) values (?, ?, ?, ?) on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at"
    );
    connection.execute(
        &sql,
        rusqlite::params![
            account_id,
            chat_id,
            session_id,
            crate::api::common::timestamp()
        ],
    )?;
    Ok(())
}

fn clear_route_in_table(
    db: &crate::db::Db,
    table: &str,
    account_id: &str,
    chat_id: &str,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    let sql = format!("delete from {table} where account_id = ? and chat_id = ?");
    connection.execute(&sql, rusqlite::params![account_id, chat_id])?;
    Ok(())
}

pub fn forward_assistant_message_to_telegram(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
    active_only: bool,
) {
    if message.role != "assistant" {
        return;
    }
    let mut destinations = std::collections::HashMap::<String, (String, String)>::new();
    let active_targets = state.telegram.active_reply_targets(&session.id);
    if active_targets.is_empty() && active_only {
        return;
    }
    if active_targets.is_empty() {
        if let Ok(connection) = state.db.open_read_write() {
            let _ = super::store::ensure_runtime_schema(&connection);
            if let Ok(mut statement) = connection.prepare(
                "select account_id, chat_id from telegram_chat_routes where session_id = ?",
            ) {
                if let Ok(rows) = statement.query_map([&session.id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for row in rows.flatten() {
                        destinations.insert(format!("{}:{}", row.0, row.1), row);
                    }
                }
            }
        }
    } else {
        for target in active_targets {
            destinations.insert(
                format!("{}:{}", target.account_id, target.chat_id),
                (target.account_id, target.chat_id),
            );
        }
    }
    if destinations.is_empty() {
        return;
    }
    let accounts = store::accounts_private(&state.db)
        .unwrap_or_default()
        .into_iter()
        .filter(|account| account.enabled && account.channel_kind == "telegram")
        .map(|account| (account.id.clone(), account))
        .collect::<std::collections::HashMap<_, _>>();
    let text = format_telegram_session_reply(session, &message.content);
    for (_, (account_id, chat_id)) in destinations {
        let Some(account) = accounts.get(&account_id).cloned() else {
            continue;
        };
        state.telegram.stop_typing(&account_id, &chat_id);
        let text = text.clone();
        tokio::spawn(async move {
            if let Err(error) = telegram_send_text(&account, &chat_id, &text).await {
                tracing::warn!(
                    "telegram reply forward failed for {}:{}: {error}",
                    account_id,
                    chat_id
                );
            }
        });
    }
}

pub fn forward_assistant_message_to_platforms(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) {
    let source = assistant_reply_source(state, session, message);
    let active_only = source.is_some()
        || !state.telegram.active_reply_targets(&session.id).is_empty()
        || !state
            .weixin_chat
            .active_reply_targets(&session.id)
            .is_empty()
        || !state
            .wecom_chat
            .active_reply_targets(&session.id)
            .is_empty()
        || !state
            .feishu_chat
            .active_reply_targets(&session.id)
            .is_empty()
        || !state.qq_chat.active_reply_targets(&session.id).is_empty()
        || !state
            .email_chat
            .active_reply_targets(&session.id)
            .is_empty();
    forward_assistant_message_to_telegram(
        state,
        session,
        message,
        active_only && source.as_deref() != Some("telegram"),
    );
    forward_assistant_message_to_route_platform(
        state,
        &state.weixin_chat,
        "weixin_chat_routes",
        "weixin",
        session,
        message,
        active_only && source.as_deref() != Some("weixin"),
    );
    forward_assistant_message_to_route_platform(
        state,
        &state.wecom_chat,
        "wecom_chat_routes",
        "wecom",
        session,
        message,
        active_only && source.as_deref() != Some("wecom"),
    );
    forward_assistant_message_to_route_platform(
        state,
        &state.feishu_chat,
        "feishu_chat_routes",
        "feishu",
        session,
        message,
        active_only && source.as_deref() != Some("feishu"),
    );
    forward_assistant_message_to_route_platform(
        state,
        &state.qq_chat,
        "qq_chat_routes",
        "qq",
        session,
        message,
        active_only && source.as_deref() != Some("qq"),
    );
    forward_assistant_message_to_route_platform(
        state,
        &state.email_chat,
        "email_chat_routes",
        "email",
        session,
        message,
        active_only && source.as_deref() != Some("email"),
    );
}

fn assistant_reply_source(
    state: &AppState,
    session: &crate::api::sessions::models::SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
) -> Option<String> {
    message
        .reply_to
        .as_ref()
        .and_then(|reply| external_source_from_prompt(&reply.content))
        .or_else(|| previous_user_message_source(state, &session.id, message))
}

fn previous_user_message_source(
    state: &AppState,
    session_id: &str,
    message: &crate::api::sessions::models::SessionMessage,
) -> Option<String> {
    let connection = state.db.open_read_write().ok()?;
    super::store::ensure_runtime_schema(&connection).ok()?;
    let content: String = connection
        .query_row(
            "select content from messages where session_id = ? and role = 'user' and (created_at < ? or (created_at = ? and id < ?)) order by created_at desc, id desc limit 1",
            rusqlite::params![session_id, &message.created_at, &message.created_at, &message.id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()?;
    external_source_from_prompt(&content)
}

fn external_source_from_prompt(content: &str) -> Option<String> {
    let first_line = content.lines().next().unwrap_or("").trim();
    if first_line.starts_with("Telegram message from chat ") {
        Some("telegram".to_string())
    } else if first_line.starts_with("Weixin message from chat ") {
        Some("weixin".to_string())
    } else if first_line.starts_with("WeCom message from chat ") {
        Some("wecom".to_string())
    } else if first_line.starts_with("Feishu message from chat ") {
        Some("feishu".to_string())
    } else if first_line.starts_with("QQ message from chat ") {
        Some("qq".to_string())
    } else if first_line.starts_with("Email message from chat ") {
        Some("email".to_string())
    } else {
        None
    }
}

fn forward_assistant_message_to_route_platform(
    state: &AppState,
    runtime: &crate::state::PlatformChatRuntimeState,
    table: &str,
    kind: &str,
    session: &crate::api::sessions::models::SessionSummary,
    message: &crate::api::sessions::models::SessionMessage,
    active_only: bool,
) {
    if message.role != "assistant" {
        return;
    }
    let mut destinations = std::collections::HashMap::<String, (String, String)>::new();
    let active_targets = runtime.active_reply_targets(&session.id);
    if active_targets.is_empty() && active_only {
        return;
    }
    if active_targets.is_empty() {
        if let Ok(connection) = state.db.open_read_write() {
            let _ = super::store::ensure_runtime_schema(&connection);
            let sql = format!("select account_id, chat_id from {table} where session_id = ?");
            if let Ok(mut statement) = connection.prepare(&sql) {
                if let Ok(rows) = statement.query_map([&session.id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for row in rows.flatten() {
                        destinations.insert(format!("{}:{}", row.0, row.1), row);
                    }
                }
            }
        }
    } else {
        for target in active_targets {
            destinations.insert(
                format!("{}:{}", target.account_id, target.chat_id),
                (target.account_id, target.chat_id),
            );
        }
    }
    if destinations.is_empty() {
        return;
    }
    let accounts = store::accounts_private(&state.db)
        .unwrap_or_default()
        .into_iter()
        .filter(|account| account.enabled && account.channel_kind == kind)
        .map(|account| (account.id.clone(), account))
        .collect::<std::collections::HashMap<_, _>>();
    let text = format_telegram_session_reply(session, &message.content);
    for (_, (account_id, chat_id)) in destinations {
        let Some(account) = accounts.get(&account_id).cloned() else {
            continue;
        };
        let state = state.clone();
        let text = text.clone();
        let kind = kind.to_string();
        tokio::spawn(async move {
            if kind == "weixin" {
                stop_weixin_typing(&account_id, &chat_id);
            }
            let result = match kind.as_str() {
                "weixin" => send_weixin_text(&state, &account, &chat_id, &text).await,
                "wecom" => send_wecom_text(&state, &account, &chat_id, &text).await,
                "feishu" => send_feishu_text(&account, &chat_id, &text).await,
                "qq" => send_qq_text(&account, &chat_id, &text).await,
                "email" => {
                    send_email_reply_text(
                        &state,
                        &account,
                        &chat_id,
                        session_title_from_text(&text),
                        &text,
                    )
                    .await
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                tracing::warn!(
                    "{kind} reply forward failed for {}:{}: {error}",
                    account_id,
                    chat_id
                );
            }
        });
    }
}

fn session_title_from_text(text: &str) -> &str {
    text.lines().next().unwrap_or("Codex Web")
}

async fn send_telegram_session_picker(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    message: &str,
    sessions: &[crate::api::sessions::models::SessionSummary],
) -> anyhow::Result<()> {
    let choices = telegram_session_choices(sessions);
    if choices.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "当前没有可用会话，请先创建一个会话。",
                "No sessions are available. Create a session first.",
            ),
        )
        .await?;
        return Ok(());
    }
    state.telegram.set_pending(
        format!("{}:send", telegram_pending_prefix(&account.id, chat_id)),
        serde_json::json!({
            "message": message,
            "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(),
            "createdAt": current_millis(),
        }),
    );
    let keyboard = choices.iter().enumerate().map(|(index, session)| serde_json::json!([{ "text": truncate_button(&telegram_session_label(account, session)), "callback_data": format!("send:{index}") }])).chain(std::iter::once(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]))).collect::<Vec<_>>();
    telegram_send_markup(
        account,
        chat_id,
        telegram_text(
            account,
            "请选择一个会话发送这条消息：",
            "Select a session to send this message:",
        ),
        keyboard,
    )
    .await
}

async fn send_telegram_bind_picker(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    sessions: &[crate::api::sessions::models::SessionSummary],
) -> anyhow::Result<()> {
    let choices = telegram_session_choices(sessions);
    if choices.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "当前没有可用会话，请先创建一个会话。",
                "No sessions are available. Create a session first.",
            ),
        )
        .await?;
        return Ok(());
    }
    state.telegram.set_pending(
        format!("{}:bind", telegram_pending_prefix(&account.id, chat_id)),
        serde_json::json!({
            "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(),
            "createdAt": current_millis(),
        }),
    );
    let keyboard = choices.iter().enumerate().map(|(index, session)| serde_json::json!([{ "text": truncate_button(&telegram_session_label(account, session)), "callback_data": format!("bind:{index}") }])).chain(std::iter::once(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]))).collect::<Vec<_>>();
    telegram_send_markup(
        account,
        chat_id,
        telegram_text(
            account,
            "请选择一个会话绑定当前聊天：",
            "Select a session to bind this chat to:",
        ),
        keyboard,
    )
    .await
}

async fn send_telegram_agents(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let agents = crate::api::agents::store::list_agents(&state.db, 100)?
        .items
        .into_iter()
        .filter(|agent| agent.enabled)
        .collect::<Vec<_>>();
    if agents.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "当前没有可用的已启用 Agent。",
                "No enabled agents are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    state.telegram.set_pending(format!("{}:agents", telegram_pending_prefix(&account.id, chat_id)), serde_json::json!({ "ids": agents.iter().map(|agent| agent.id.clone()).collect::<Vec<_>>(), "page": 0, "pageSize": 8, "createdAt": current_millis() }));
    send_telegram_agents_page(state, account, chat_id, 0, None).await
}

async fn send_telegram_agents_page(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    page: usize,
    message_id: Option<i64>,
) -> anyhow::Result<()> {
    let key = format!("{}:agents", telegram_pending_prefix(&account.id, chat_id));
    let pending = state
        .telegram
        .get_pending(&key)
        .unwrap_or_else(|| serde_json::json!({}));
    let ids = pending
        .get("ids")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "这条 Agent 列表已过期。",
                "This agent list expired.",
            ),
        )
        .await?;
        return Ok(());
    }
    let all_agents = crate::api::agents::store::list_agents(&state.db, 1000)?.items;
    let agents = ids
        .iter()
        .filter_map(|id| {
            all_agents
                .iter()
                .find(|agent| &agent.id == id && agent.enabled)
        })
        .collect::<Vec<_>>();
    if agents.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "当前没有可用的已启用 Agent。",
                "No enabled agents are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    let (page, total_pages, start, end) = telegram_page_bounds(agents.len(), page, 8);
    state.telegram.set_pending(key, serde_json::json!({ "ids": ids, "page": page, "pageSize": 8, "createdAt": current_millis() }));
    let page_items = &agents[start..end];
    let mut keyboard = page_items
        .iter()
        .enumerate()
        .map(|(offset, agent)| serde_json::json!([{ "text": truncate_button(&format!("{}. {}", start + offset + 1, agent.name)), "callback_data": format!("agent:{}", start + offset) }]))
        .collect::<Vec<_>>();
    if total_pages > 1 {
        let mut row = Vec::new();
        if page > 0 {
            row.push(serde_json::json!({ "text": telegram_text(account, "上一页", "Prev"), "callback_data": format!("agentpage:{}", page - 1) }));
        }
        if page + 1 < total_pages {
            row.push(serde_json::json!({ "text": telegram_text(account, "下一页", "Next"), "callback_data": format!("agentpage:{}", page + 1) }));
        }
        if !row.is_empty() {
            keyboard.push(serde_json::Value::Array(row));
        }
    }
    keyboard.push(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]));
    let text = format!(
        "{}\n{}",
        telegram_text(
            account,
            "请选择一个 Agent 来创建并绑定新会话。",
            "Select an agent to create and bind a new session."
        ),
        telegram_showing_text(account, start + 1, end, agents.len(), page + 1, total_pages)
    );
    if let Some(message_id) = message_id {
        telegram_edit_markup(account, chat_id, message_id, &text, keyboard).await
    } else {
        telegram_send_markup(account, chat_id, &text, keyboard).await
    }
}

async fn send_telegram_rooms(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let rooms = crate::api::rooms::store::list_rooms(&state.db, None, 100)?.items;
    if rooms.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(account, "当前没有可用的 Room。", "No rooms are available."),
        )
        .await?;
        return Ok(());
    }
    state.telegram.set_pending(
        format!("{}:rooms", telegram_pending_prefix(&account.id, chat_id)),
        serde_json::json!({ "ids": rooms.iter().map(|room| room.id.clone()).collect::<Vec<_>>(), "page": 0, "pageSize": 8, "createdAt": current_millis() }),
    );
    send_telegram_rooms_page(state, account, chat_id, 0, None).await
}

async fn send_telegram_rooms_page(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    page: usize,
    message_id: Option<i64>,
) -> anyhow::Result<()> {
    let key = format!("{}:rooms", telegram_pending_prefix(&account.id, chat_id));
    let pending = state
        .telegram
        .get_pending(&key)
        .unwrap_or_else(|| serde_json::json!({}));
    let ids = pending
        .get("ids")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(account, "这条 Room 列表已过期。", "This room list expired."),
        )
        .await?;
        return Ok(());
    }
    let all_rooms = crate::api::rooms::store::list_rooms(&state.db, None, 1000)?.items;
    let rooms = ids
        .iter()
        .filter_map(|id| all_rooms.iter().find(|room| &room.id == id))
        .collect::<Vec<_>>();
    if rooms.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(account, "当前没有可用的 Room。", "No rooms are available."),
        )
        .await?;
        return Ok(());
    }
    let (page, total_pages, start, end) = telegram_page_bounds(rooms.len(), page, 8);
    state.telegram.set_pending(key, serde_json::json!({ "ids": ids, "page": page, "pageSize": 8, "createdAt": current_millis() }));
    let page_items = &rooms[start..end];
    let mut keyboard = page_items
        .iter()
        .enumerate()
        .map(|(offset, room)| serde_json::json!([{ "text": truncate_button(&format!("{}. {}", start + offset + 1, room.name)), "callback_data": format!("room:{}", start + offset) }]))
        .collect::<Vec<_>>();
    if total_pages > 1 {
        let mut row = Vec::new();
        if page > 0 {
            row.push(serde_json::json!({ "text": telegram_text(account, "上一页", "Prev"), "callback_data": format!("roompage:{}", page - 1) }));
        }
        if page + 1 < total_pages {
            row.push(serde_json::json!({ "text": telegram_text(account, "下一页", "Next"), "callback_data": format!("roompage:{}", page + 1) }));
        }
        if !row.is_empty() {
            keyboard.push(serde_json::Value::Array(row));
        }
    }
    keyboard.push(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]));
    let text = format!(
        "{}\n{}",
        telegram_text(
            account,
            "请选择一个 Room 来绑定当前聊天对应的会话。",
            "Select a room to bind this chat to its session."
        ),
        telegram_showing_text(account, start + 1, end, rooms.len(), page + 1, total_pages)
    );
    if let Some(message_id) = message_id {
        telegram_edit_markup(account, chat_id, message_id, &text, keyboard).await
    } else {
        telegram_send_markup(account, chat_id, &text, keyboard).await
    }
}

async fn send_telegram_file_roots(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let roots = telegram_roots(state, account, None);
    if roots.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "当前没有可用的文件根目录。",
                "No file roots are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    state.telegram.set_pending(
        format!(
            "{}:file_roots",
            telegram_pending_prefix(&account.id, chat_id)
        ),
        serde_json::json!({ "roots": roots, "createdAt": current_millis() }),
    );
    let roots_value = state
        .telegram
        .get_pending(&format!(
            "{}:file_roots",
            telegram_pending_prefix(&account.id, chat_id)
        ))
        .unwrap_or_else(|| serde_json::json!({}));
    let keyboard = roots_value.get("roots").and_then(|v| v.as_array()).unwrap_or(&Vec::new()).iter().enumerate().map(|(index, root)| serde_json::json!([{ "text": truncate_button(root.get("label").and_then(|v| v.as_str()).unwrap_or("root")), "callback_data": format!("filectx:{index}") }])).chain(std::iter::once(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]))).collect::<Vec<_>>();
    telegram_send_markup(
        account,
        chat_id,
        telegram_text(account, "请选择文件根目录：", "Select a file root:"),
        keyboard,
    )
    .await
}

async fn send_telegram_terminal_roots(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    command: &str,
) -> anyhow::Result<()> {
    let roots = telegram_roots(state, account, None);
    if roots.is_empty() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "当前没有可用的终端根目录。",
                "No terminal roots are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    state.telegram.set_pending(
        format!("{}:terminal", telegram_pending_prefix(&account.id, chat_id)),
        serde_json::json!({ "command": command, "roots": roots, "createdAt": current_millis() }),
    );
    let pending = state
        .telegram
        .get_pending(&format!(
            "{}:terminal",
            telegram_pending_prefix(&account.id, chat_id)
        ))
        .unwrap_or_else(|| serde_json::json!({}));
    let keyboard = pending.get("roots").and_then(|v| v.as_array()).unwrap_or(&Vec::new()).iter().enumerate().map(|(index, root)| serde_json::json!([{ "text": truncate_button(root.get("label").and_then(|v| v.as_str()).unwrap_or("root")), "callback_data": format!("term:{index}") }])).chain(std::iter::once(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]))).collect::<Vec<_>>();
    telegram_send_markup(
        account,
        chat_id,
        &format!(
            "{}\n{}",
            telegram_text(account, "请选择运行位置：", "Select where to run:"),
            command
        ),
        keyboard,
    )
    .await
}

async fn send_telegram_files(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    root: PathBuf,
    rel_path: &str,
) -> anyhow::Result<()> {
    state.telegram.stop_typing(&account.id, chat_id);
    let root = root.canonicalize().unwrap_or(root);
    let safe_rel = safe_relative_path(rel_path);
    let target = root
        .join(&safe_rel)
        .canonicalize()
        .unwrap_or_else(|_| root.join(&safe_rel));
    if !target.starts_with(&root) || !target.is_dir() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(account, "目录不可用。", "Directory is not available."),
        )
        .await?;
        return Ok(());
    }
    let mut entries = std::fs::read_dir(&target)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| {
            let metadata = entry.metadata().ok();
            (
                entry.file_name().to_string_lossy().to_string(),
                metadata.as_ref().is_some_and(|m| m.is_dir()),
                metadata.map(|m| m.len()).unwrap_or(0),
            )
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(40);
    let dirs = entries
        .iter()
        .filter(|(_, is_dir, _)| *is_dir)
        .take(20)
        .map(|(name, _, _)| name.clone())
        .collect::<Vec<_>>();
    state.telegram.set_pending(
        format!("{}:files", telegram_pending_prefix(&account.id, chat_id)),
        serde_json::json!({ "root": root, "relPath": safe_rel, "dirNames": dirs, "createdAt": current_millis() }),
    );
    let mut lines = vec![
        format!("Files: /{}", safe_rel.to_string_lossy()),
        String::new(),
    ];
    lines.extend(entries.iter().map(|(name, is_dir, size)| {
        if *is_dir {
            format!("[dir] {name}")
        } else {
            format!("[file] {name} · {size} bytes")
        }
    }));
    let mut keyboard = dirs.iter().enumerate().map(|(index, name)| serde_json::json!([{ "text": truncate_button(&format!("[dir] {name}")), "callback_data": format!("file:{index}") }])).collect::<Vec<_>>();
    if !safe_rel.as_os_str().is_empty() {
        keyboard.push(serde_json::json!([{ "text": "..", "callback_data": "fileup" }]));
    }
    keyboard.push(serde_json::json!([{ "text": telegram_text(account, "取消", "Cancel"), "callback_data": "cancel" }]));
    telegram_send_markup(account, chat_id, &lines.join("\n"), keyboard).await
}

async fn run_telegram_terminal(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    cwd: PathBuf,
    command: &str,
) -> anyhow::Result<()> {
    if dangerous_command(command) {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "命令已被安全规则拦截。",
                "Command blocked by safety guard.",
            ),
        )
        .await?;
        return Ok(());
    }
    let cwd = cwd.canonicalize().unwrap_or(cwd);
    if !cwd.is_dir() {
        telegram_send_text(
            account,
            chat_id,
            telegram_text(
                account,
                "终端目录不可用。",
                "Terminal directory is not available.",
            ),
        )
        .await?;
        return Ok(());
    }
    telegram_send_text(
        account,
        chat_id,
        &format!(
            "{} {}:\n{}",
            telegram_text(account, "运行于", "Running in"),
            cwd.display(),
            command
        ),
    )
    .await?;
    let mut child = tokio::process::Command::new("/bin/zsh")
        .arg("-lc")
        .arg(command)
        .current_dir(cwd)
        .env(
            "CODEX_HOME",
            state.config.codex_home.to_string_lossy().to_string(),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout).await;
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr).await;
    }
    let status = tokio::time::timeout(std::time::Duration::from_secs(20), child.wait()).await;
    let text = match status {
        Ok(Ok(status)) => format!(
            "{}: {}\n\nstdout:\n{}\n\nstderr:\n{}",
            telegram_text(account, "退出码", "Exit code"),
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| telegram_text(account, "未知", "unknown").to_string()),
            if stdout.trim().is_empty() {
                "(empty)"
            } else {
                stdout.trim()
            },
            stderr.trim()
        ),
        _ => telegram_text(account, "执行超时。", "Timed out.").to_string(),
    };
    let result = telegram_send_text(account, chat_id, &text).await;
    state.telegram.stop_typing(&account.id, chat_id);
    result
}

async fn sync_telegram_commands(account: &NotificationAccountSummary) -> anyhow::Result<()> {
    let commands = if telegram_language(account) == "en-US" {
        serde_json::json!([
            {"command":"start","description":"Show bot help"},
            {"command":"sessions","description":"List recent sessions"},
            {"command":"agents","description":"List agents"},
            {"command":"rooms","description":"List rooms"},
            {"command":"files","description":"Browse files"},
            {"command":"terminal","description":"Run a terminal command"},
            {"command":"bind","description":"Bind this chat to a session"},
            {"command":"unbind","description":"Clear the bound session"},
            {"command":"send","description":"Send a message to a session"},
            {"command":"whoami","description":"Show IDs"},
            {"command":"help","description":"Show help"}
        ])
    } else {
        serde_json::json!([
            {"command":"start","description":"显示机器人帮助"},
            {"command":"sessions","description":"列出最近会话"},
            {"command":"agents","description":"列出 Agent"},
            {"command":"rooms","description":"列出 Room"},
            {"command":"files","description":"浏览文件"},
            {"command":"terminal","description":"运行终端命令"},
            {"command":"bind","description":"把当前聊天绑定到会话"},
            {"command":"unbind","description":"清除绑定的会话"},
            {"command":"send","description":"向会话发送消息"},
            {"command":"whoami","description":"查看 ID"},
            {"command":"help","description":"显示帮助"}
        ])
    };
    let _ = telegram_api(
        account,
        "setMyCommands",
        serde_json::json!({ "commands": commands }),
    )
    .await?;
    let _ = telegram_api(
        account,
        "setChatMenuButton",
        serde_json::json!({ "menu_button": { "type": "commands" } }),
    )
    .await?;
    Ok(())
}

async fn telegram_delete_commands(account: &NotificationAccountSummary) -> anyhow::Result<()> {
    let _ = telegram_api(account, "deleteMyCommands", serde_json::json!({})).await;
    let _ = telegram_api(
        account,
        "setChatMenuButton",
        serde_json::json!({ "menu_button": { "type": "default" } }),
    )
    .await;
    Ok(())
}

async fn telegram_send_text(
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    let response = telegram_api(
        account,
        "sendMessage",
        serde_json::json!({ "chat_id": chat_id, "text": text.chars().take(3900).collect::<String>(), "disable_web_page_preview": true }),
    )
    .await?;
    if response.get("ok").and_then(|value| value.as_bool()) == Some(false) {
        let message = response
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("telegram_send_failed")
            .to_string();
        anyhow::bail!(message);
    }
    Ok(())
}

async fn telegram_send_markup(
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
    keyboard: Vec<serde_json::Value>,
) -> anyhow::Result<()> {
    let response = telegram_api(
        account,
        "sendMessage",
        serde_json::json!({
            "chat_id": chat_id,
            "text": text.chars().take(3900).collect::<String>(),
            "disable_web_page_preview": true,
            "reply_markup": { "inline_keyboard": keyboard },
        }),
    )
    .await?;
    if response.get("ok").and_then(|value| value.as_bool()) == Some(false) {
        let message = response
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("telegram_send_failed")
            .to_string();
        anyhow::bail!(message);
    }
    Ok(())
}

async fn telegram_edit_markup(
    account: &NotificationAccountSummary,
    chat_id: &str,
    message_id: i64,
    text: &str,
    keyboard: Vec<serde_json::Value>,
) -> anyhow::Result<()> {
    let response = telegram_api(
        account,
        "editMessageText",
        serde_json::json!({
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text.chars().take(3900).collect::<String>(),
            "disable_web_page_preview": true,
            "reply_markup": { "inline_keyboard": keyboard },
        }),
    )
    .await?;
    if response.get("ok").and_then(|value| value.as_bool()) == Some(false) {
        let message = response
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("telegram_edit_failed")
            .to_string();
        anyhow::bail!(message);
    }
    Ok(())
}

async fn telegram_api(
    account: &NotificationAccountSummary,
    method: &str,
    payload: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let response = reqwest::Client::new()
        .post(telegram_api_url(account, method)?)
        .json(&payload)
        .send()
        .await?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        let message = body
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("telegram_http_error")
            .to_string();
        anyhow::bail!(message);
    }
    Ok(body)
}

fn telegram_api_url(account: &NotificationAccountSummary, method: &str) -> anyhow::Result<String> {
    let token = config_string(&account.config, "botToken")
        .ok_or_else(|| anyhow::anyhow!("telegram_bot_token_required"))?;
    let base = config_string(&account.config, "proxyUrl")
        .unwrap_or_else(|| "https://api.telegram.org".to_string());
    Ok(format!(
        "{}/bot{}/{}",
        base.trim_end_matches('/'),
        token,
        method
    ))
}

fn telegram_inbound_allowed(
    account: &NotificationAccountSummary,
    message: &serde_json::Value,
    chat_id: &str,
) -> bool {
    let user_id = message
        .get("from")
        .and_then(|from| from.get("id"))
        .map(json_id_string)
        .unwrap_or_default();
    let allowed_chat_ids = config_list(&account.config, "allowedChatIds");
    let allowed_user_ids = config_list(&account.config, "allowedUserIds");
    (allowed_chat_ids.is_empty() || allowed_chat_ids.iter().any(|item| item == chat_id))
        && (allowed_user_ids.is_empty() || allowed_user_ids.iter().any(|item| item == &user_id))
}

fn telegram_pending_prefix(account_id: &str, chat_id: &str) -> String {
    format!("telegram:{account_id}:{chat_id}")
}

fn telegram_pending_expired(pending: &serde_json::Value, ttl_ms: u128) -> bool {
    let created_at = pending
        .get("createdAt")
        .and_then(|value| value.as_u64())
        .map(|value| value as u128)
        .unwrap_or_else(current_millis);
    current_millis().saturating_sub(created_at) > ttl_ms
}

fn telegram_page_bounds(
    total: usize,
    page: usize,
    page_size: usize,
) -> (usize, usize, usize, usize) {
    let page_size = page_size.max(1);
    let total_pages = total.div_ceil(page_size).max(1);
    let page = page.min(total_pages - 1);
    let start = (page * page_size).min(total);
    let end = (start + page_size).min(total);
    (page, total_pages, start, end)
}

fn telegram_showing_text(
    account: &NotificationAccountSummary,
    start: usize,
    end: usize,
    total: usize,
    page: usize,
    total_pages: usize,
) -> String {
    if telegram_language(account) == "en-US" {
        format!("Showing {start}-{end} of {total} ({page}/{total_pages})")
    } else {
        format!("显示 {start}-{end} / 共 {total}（第 {page}/{total_pages} 页）")
    }
}

fn truncate_button(value: &str) -> String {
    value.chars().take(64).collect()
}

fn safe_relative_path(value: &str) -> PathBuf {
    value
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect::<PathBuf>()
}

fn dangerous_command(command: &str) -> bool {
    let lower = command.to_lowercase();
    lower.contains("rm -rf")
        || lower.contains("shutdown")
        || lower.contains("reboot")
        || lower.contains("mkfs")
        || lower.contains("dd if=")
}

fn telegram_roots(
    state: &AppState,
    account: &NotificationAccountSummary,
    session: Option<&crate::api::sessions::models::SessionSummary>,
) -> Vec<serde_json::Value> {
    let mut roots = Vec::new();
    if let Some(session) = session.filter(|session| !session.workspace_path.trim().is_empty()) {
        roots.push(serde_json::json!({ "label": telegram_session_label(account, session), "root": session.workspace_path }));
    }
    roots.push(serde_json::json!({
        "label": telegram_text(account, "系统工作区", "System workspace"),
        "root": std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).to_string_lossy().to_string(),
    }));
    if let Ok(sessions) = crate::api::sessions::store::list_sessions(&state.db, true, true) {
        for session in telegram_session_choices(&sessions).into_iter().take(8) {
            if !session.workspace_path.trim().is_empty() {
                roots.push(serde_json::json!({ "label": telegram_session_label(account, session), "root": session.workspace_path }));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    roots
        .into_iter()
        .filter(|root| {
            let Some(path) = root.get("root").and_then(|value| value.as_str()) else {
                return false;
            };
            let Ok(canonical) = PathBuf::from(path).canonicalize() else {
                return false;
            };
            canonical.is_dir() && seen.insert(canonical)
        })
        .take(9)
        .collect()
}

fn telegram_route_session(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<Option<crate::api::sessions::models::SessionSummary>> {
    let connection = state.db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    let routed: Option<String> = connection
        .query_row(
            "select session_id from telegram_chat_routes where account_id = ? and chat_id = ?",
            rusqlite::params![&account.id, chat_id],
            |row| row.get(0),
        )
        .optional()?;
    let session_id = routed.or_else(|| config_string(&account.config, "defaultSessionId"));
    Ok(session_id.and_then(|id| {
        crate::api::sessions::store::get_session(&state.db, &id)
            .ok()
            .flatten()
    }))
}

fn set_telegram_route(
    db: &crate::db::Db,
    account_id: &str,
    chat_id: &str,
    session_id: &str,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    connection.execute(
        "insert into telegram_chat_routes (account_id, chat_id, session_id, updated_at) values (?, ?, ?, ?) on conflict(account_id, chat_id) do update set session_id = excluded.session_id, updated_at = excluded.updated_at",
        rusqlite::params![account_id, chat_id, session_id, crate::api::common::timestamp()],
    )?;
    Ok(())
}

fn clear_telegram_route(db: &crate::db::Db, account_id: &str, chat_id: &str) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    super::store::ensure_runtime_schema(&connection)?;
    connection.execute(
        "delete from telegram_chat_routes where account_id = ? and chat_id = ?",
        rusqlite::params![account_id, chat_id],
    )?;
    Ok(())
}

fn find_telegram_session<'a>(
    sessions: &'a [crate::api::sessions::models::SessionSummary],
    query: &str,
) -> Option<&'a crate::api::sessions::models::SessionSummary> {
    let query = query.trim();
    if let Ok(index) = query.parse::<usize>() {
        if index > 0 {
            return telegram_session_choices(sessions).get(index - 1).copied();
        }
    }
    let lower = query.to_lowercase();
    sessions
        .iter()
        .find(|session| session.id == query || session.title.to_lowercase().contains(&lower))
}

fn telegram_session_choices<'a>(
    sessions: &'a [crate::api::sessions::models::SessionSummary],
) -> Vec<&'a crate::api::sessions::models::SessionSummary> {
    let mut items = sessions.iter().collect::<Vec<_>>();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    items.into_iter().take(12).collect()
}

fn telegram_sessions_text(
    account: &NotificationAccountSummary,
    sessions: &[crate::api::sessions::models::SessionSummary],
) -> String {
    let choices = telegram_session_choices(sessions);
    if choices.is_empty() {
        return telegram_text(account, "暂无会话。", "No sessions yet.").to_string();
    }
    choices
        .into_iter()
        .enumerate()
        .map(|(index, session)| {
            format!(
                "{}. {}\n{} · {}\n{}",
                index + 1,
                telegram_session_label(account, session),
                session.status,
                session.updated_at,
                session.id
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn telegram_session_label(
    account: &NotificationAccountSummary,
    session: &crate::api::sessions::models::SessionSummary,
) -> String {
    let category = match session.conversation_type.as_str() {
        "automation" => telegram_text(account, "自动化", "Automation"),
        "room" => "Room",
        "agent" => "Agent",
        _ => "Codex",
    };
    let short_id = if session.id.len() > 12 {
        format!("{}...", &session.id[..12])
    } else {
        session.id.clone()
    };
    format!("[{category}] {} ({short_id})", session.title)
}

fn telegram_help_text(
    account: &NotificationAccountSummary,
    user_id: &str,
    chat_id: &str,
    is_private: bool,
) -> String {
    let identity = telegram_identity_text(account, user_id, chat_id, is_private);
    if telegram_language(account) == "en-US" {
        [
            "Codex Web Telegram Bot".to_string(),
            String::new(),
            "/sessions - list recent sessions".to_string(),
            "/agents - list agents and create a bound agent session".to_string(),
            "/rooms - list rooms and bind a room session".to_string(),
            "/files - browse bound or system files".to_string(),
            "/terminal <command> - run in bound or selected workspace".to_string(),
            "/whoami - show your Telegram user ID and this chat ID".to_string(),
            "/bind - pick a session to bind this chat to, or /bind <index, title, or sessionId>".to_string(),
            "/unbind - clear the bound session".to_string(),
            "/send <index, title, or sessionId> | <message> - send to a session".to_string(),
            "/send <message> - choose a session when no session is bound".to_string(),
            String::new(),
            "Reply behavior:".to_string(),
            "- Bound/default session: plain text goes into that session and assistant replies are sent back here.".to_string(),
            "- /send: sends one message to the chosen session and the assistant reply for that round is sent back here.".to_string(),
            "Plain text is sent to the bound/default session, or asks you to choose one.".to_string(),
            String::new(),
            identity,
        ]
        .join("\n")
    } else {
        [
            "Codex Web Telegram 机器人".to_string(),
            String::new(),
            "/sessions - 列出最近会话".to_string(),
            "/agents - 列出代理并创建绑定代理会话".to_string(),
            "/rooms - 列出 Room 并绑定 Room 会话".to_string(),
            "/files - 浏览绑定或系统文件".to_string(),
            "/terminal <命令> - 在绑定或选定的工作区运行终端命令".to_string(),
            "/whoami - 查看你的 Telegram 用户 ID 和当前聊天 ID".to_string(),
            "/bind - 选择会话绑定当前聊天，或 /bind <序号、标题、sessionId>".to_string(),
            "/unbind - 清除绑定的会话".to_string(),
            "/send <序号、标题或 sessionId> | <消息> - 向会话发送消息".to_string(),
            "/send <消息> - 未绑定时选择会话".to_string(),
            String::new(),
            "回复规则：".to_string(),
            "- 已绑定/默认会话：普通文本会进入该会话，助手回复会发回这里。".to_string(),
            "- /send：向选定会话发送一条消息，本轮助手回复会发回这里。".to_string(),
            "普通文本会发送到已绑定/默认会话，或者让你先选择一个会话。".to_string(),
            String::new(),
            identity,
        ]
        .join("\n")
    }
}

fn telegram_identity_text(
    account: &NotificationAccountSummary,
    user_id: &str,
    chat_id: &str,
    is_private: bool,
) -> String {
    if telegram_language(account) == "en-US" {
        let mut lines = Vec::new();
        if is_private && !user_id.is_empty() {
            lines.push(format!("Current user ID: {user_id}"));
        }
        lines.push(format!("Current chat ID: {chat_id}"));
        if !is_private {
            lines.push(
                "Send /whoami in a private chat with this bot to get your user ID.".to_string(),
            );
        }
        lines.join("\n")
    } else {
        let mut lines = Vec::new();
        if is_private && !user_id.is_empty() {
            lines.push(format!("当前用户 ID：{user_id}"));
        }
        lines.push(format!("当前聊天 ID：{chat_id}"));
        if !is_private {
            lines.push("请私聊机器人发送 /whoami 获取你的用户 ID。".to_string());
        }
        lines.join("\n")
    }
}

fn telegram_language(account: &NotificationAccountSummary) -> &'static str {
    if config_string(&account.config, "language").as_deref() == Some("en-US") {
        "en-US"
    } else {
        "zh-CN"
    }
}

fn telegram_text<'a>(account: &NotificationAccountSummary, zh: &'a str, en: &'a str) -> &'a str {
    if telegram_language(account) == "en-US" {
        en
    } else {
        zh
    }
}

fn json_id_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

pub fn sync_wecom_account(state: AppState, account: NotificationAccountSummary) {
    if account.channel_kind != "wecom"
        || !account.enabled
        || !account
            .config
            .get("inboundEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    {
        state.wecom.remove(&account.id);
        return;
    }
    let bot_id = match config_string(&account.config, "botId") {
        Some(v) if !v.is_empty() => v,
        _ => {
            state.wecom.remove(&account.id);
            return;
        }
    };
    let secret = match config_string(&account.config, "secret") {
        Some(v) if !v.is_empty() => v,
        _ => {
            state.wecom.remove(&account.id);
            return;
        }
    };
    let websocket_url = config_string(&account.config, "websocketUrl")
        .unwrap_or_else(|| "wss://openws.work.weixin.qq.com".to_string());
    let key = format!("{bot_id}\0{secret}\0{websocket_url}");
    if state
        .wecom
        .get(&account.id)
        .is_some_and(|handle| handle.key == key)
    {
        return;
    }
    let (outbound_tx, mut outbound_rx) =
        tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    state.wecom.insert(
        account.id.clone(),
        crate::state::WeComRuntimeHandle {
            key,
            outbound: outbound_tx,
            stop: stop_tx,
        },
    );
    let account_id = account.id.clone();
    tokio::spawn(async move {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::{connect_async, tungstenite::Message};
        loop {
            let connection = connect_async(&websocket_url).await;
            let Ok((mut ws, _)) = connection else {
                tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => continue }
            };
            let subscribe_req = format!("subscribe-{}", random_id());
            let _ = ws
                .send(Message::Text(
                    serde_json::json!({
                        "cmd": "aibot_subscribe",
                        "headers": { "req_id": subscribe_req },
                        "body": { "bot_id": bot_id, "secret": secret, "device_id": account_id }
                    })
                    .to_string(),
                ))
                .await;
            let mut subscribed = false;
            let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                tokio::select! {
                    _ = stop_rx.recv() => { let _ = ws.close(None).await; return; }
                    Some(outbound) = outbound_rx.recv(), if subscribed => {
                        let _ = ws.send(Message::Text(outbound.to_string())).await;
                    }
                    _ = heartbeat.tick(), if subscribed => {
                        let _ = ws.send(Message::Text(serde_json::json!({"cmd":"ping","headers":{"req_id":random_id()},"body":{}}).to_string())).await;
                    }
                    msg = ws.next() => {
                        let Some(msg) = msg else { break; };
                        let Ok(msg) = msg else { break; };
                        let text = match msg {
                            Message::Text(text) => text,
                            Message::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                            Message::Ping(payload) => { let _ = ws.send(Message::Pong(payload)).await; continue; }
                            _ => continue,
                        };
                        let payload = serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| serde_json::json!({}));
                        let req_id = payload.get("headers").and_then(|h| h.get("req_id")).and_then(|v| v.as_str()).unwrap_or("");
                        if req_id == subscribe_req {
                            let body = payload.get("body").cloned().unwrap_or_else(|| serde_json::json!({}));
                            let errcode = body.get("errcode").or_else(|| body.get("err_code")).or_else(|| payload.get("errcode")).or_else(|| payload.get("err_code")).and_then(|v| v.as_i64()).unwrap_or(0);
                            if errcode != 0 { break; }
                            subscribed = true;
                            continue;
                        }
                        if payload.get("cmd").and_then(|v| v.as_str()) == Some("aibot_msg_callback") {
                            let body = payload.get("body").cloned().unwrap_or_else(|| serde_json::json!({}));
                            if !wecom_inbound_allowed(&account, &body) {
                                continue;
                            }
                            let text = wecom_message_text(&body);
                            if !text.trim().is_empty() {
                                let chat_id = wecom_message_chat_id(&body);
                                remember_wecom_chat_req_id(&account.id, &chat_id, req_id);
                                let _ = handle_wecom_text_update(&state, &account, &chat_id, &text).await;
                            }
                        }
                    }
                }
            }
            tokio::select! { _ = stop_rx.recv() => break, _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {} }
        }
    });
}

pub fn stop_wecom_account(state: &AppState, account_id: &str) {
    state.wecom.remove(account_id);
}

async fn handle_wecom_text_update(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    if chat_id.trim().is_empty() || text.trim().is_empty() {
        return Ok(());
    }
    let kind = ExternalPlatformKind::WeCom;
    let pending_key = platform_pending_prefix("wecom_chat_routes", &account.id, chat_id);
    if text.trim() == "/cancel" {
        state.wecom_chat.clear_pending_prefix(&pending_key);
        send_wecom_text(
            state,
            account,
            chat_id,
            platform_text(account, "已取消。", "Canceled."),
        )
        .await?;
        return Ok(());
    }
    if let Some(pending) = state
        .wecom_chat
        .remove_pending(&format!("{pending_key}:input"))
    {
        if platform_pending_expired(&pending) {
            send_wecom_text(
                state,
                account,
                chat_id,
                platform_text(account, "待处理输入已过期。", "Pending input expired."),
            )
            .await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("send") {
            route_wecom_send_message(state, account, chat_id, text).await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("terminal") {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    text,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, text).await?;
            }
            return Ok(());
        }
    }
    if handle_platform_tool_selection(state, kind, account, chat_id, text).await? {
        return Ok(());
    }
    if let Some(selection) = resolve_platform_selection(
        state,
        &state.wecom_chat,
        "wecom_chat_routes",
        account,
        chat_id,
        text,
    )? {
        match selection {
            PlatformSelection::Expired => {
                send_wecom_text(
                    state,
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "这次选择已过期，请重新开始。",
                        "This selection expired. Please start again.",
                    ),
                )
                .await?
            }
            PlatformSelection::NotFound => {
                send_wecom_text(
                    state,
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?
            }
            PlatformSelection::Bind(session) => {
                set_route_in_table(
                    &state.db,
                    "wecom_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                send_wecom_text(
                    state,
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            }
            PlatformSelection::Send { session, message } => {
                set_route_in_table(
                    &state.db,
                    "wecom_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                dispatch_platform_chat_message(
                    state,
                    &state.wecom_chat,
                    "WeCom",
                    &account.id,
                    chat_id,
                    &session,
                    &message,
                )
                .await?;
            }
        }
        return Ok(());
    }

    let (command, rest) = telegram_command(text);
    match command {
        "/start" | "/help" => {
            send_wecom_text(
                state,
                account,
                chat_id,
                &platform_help_text(account, "WeCom AI Bot", Some(chat_id)),
            )
            .await?;
        }
        "/sessions" => {
            let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
            send_wecom_text(
                state,
                account,
                chat_id,
                &telegram_sessions_text(account, &sessions),
            )
            .await?;
        }
        "/whoami" => {
            send_wecom_text(
                state,
                account,
                chat_id,
                &platform_identity_text(account, chat_id),
            )
            .await?;
        }
        "/agents" => send_platform_agents(state, kind, account, chat_id).await?,
        "/rooms" => send_platform_rooms(state, kind, account, chat_id).await?,
        "/files" => {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                send_platform_files(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_file_roots(state, kind, account, chat_id).await?;
            }
        }
        "/terminal" => {
            if rest.is_empty() {
                state.wecom_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "terminal", "createdAt": current_millis() }),
                );
                send_wecom_text(state, account, chat_id, platform_text(account, "等待输入：请在下一条消息里发送终端命令，或发送 /cancel 取消。", "Waiting for input: send the terminal command in your next reply, or send /cancel to cancel.")).await?;
            } else if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, rest).await?;
            }
        }
        "/bind" => {
            if rest.is_empty() {
                send_wecom_bind_picker(state, account, chat_id).await?;
            } else if let Some(session) = find_platform_session(state, rest)? {
                set_route_in_table(
                    &state.db,
                    "wecom_chat_routes",
                    &account.id,
                    chat_id,
                    &session.id,
                )?;
                send_wecom_text(
                    state,
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            } else {
                send_wecom_text(
                    state,
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?;
            }
        }
        "/unbind" => {
            clear_route_in_table(&state.db, "wecom_chat_routes", &account.id, chat_id)?;
            send_wecom_text(
                state,
                account,
                chat_id,
                platform_text(account, "已清除绑定会话。", "Bound session cleared."),
            )
            .await?;
        }
        "/send" => {
            if rest.is_empty() {
                state.wecom_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "send", "createdAt": current_millis() }),
                );
                send_wecom_text(
                    state,
                    account,
                    chat_id,
                    platform_text(account, "请发送消息内容。", "Send me the message text."),
                )
                .await?;
            } else {
                handle_wecom_send_command(state, account, chat_id, rest).await?;
            }
        }
        _ => {
            route_wecom_send_message(state, account, chat_id, text).await?;
        }
    }
    Ok(())
}

async fn handle_weixin_text_update(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    if chat_id.trim().is_empty() || text.trim().is_empty() {
        return Ok(());
    }
    let kind = ExternalPlatformKind::Weixin;
    let pending_key = platform_pending_prefix("weixin_chat_routes", &account.id, chat_id);
    if text.trim() == "/cancel" {
        state.weixin_chat.clear_pending_prefix(&pending_key);
        stop_weixin_typing(&account.id, chat_id);
        send_weixin_text(
            state,
            account,
            chat_id,
            platform_text(account, "已取消。", "Canceled."),
        )
        .await?;
        return Ok(());
    }
    if let Some(pending) = state
        .weixin_chat
        .remove_pending(&format!("{pending_key}:input"))
    {
        if platform_pending_expired(&pending) {
            send_weixin_text(
                state,
                account,
                chat_id,
                platform_text(account, "待处理输入已过期。", "Pending input expired."),
            )
            .await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("send") {
            route_weixin_send_message(state, account, chat_id, text).await?;
            return Ok(());
        }
        if pending.get("kind").and_then(|value| value.as_str()) == Some("terminal") {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    text,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, text).await?;
            }
            return Ok(());
        }
    }
    if handle_platform_tool_selection(state, kind, account, chat_id, text).await? {
        return Ok(());
    }
    if let Some(selection) = resolve_platform_selection(
        state,
        &state.weixin_chat,
        "weixin_chat_routes",
        account,
        chat_id,
        text,
    )? {
        match selection {
            PlatformSelection::Expired => {
                send_weixin_text(
                    state,
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "这次选择已过期，请重新开始。",
                        "This selection expired. Please start again.",
                    ),
                )
                .await?
            }
            PlatformSelection::NotFound => {
                send_weixin_text(
                    state,
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?
            }
            PlatformSelection::Bind(session) => {
                set_weixin_route_in_table(state, &account.id, chat_id, &session.id, None)?;
                send_weixin_text(
                    state,
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            }
            PlatformSelection::Send { session, message } => {
                set_weixin_route_in_table(state, &account.id, chat_id, &session.id, None)?;
                start_weixin_typing(account.clone(), chat_id.to_string());
                dispatch_platform_chat_message(
                    state,
                    &state.weixin_chat,
                    "Weixin",
                    &account.id,
                    chat_id,
                    &session,
                    &message,
                )
                .await?;
            }
        }
        return Ok(());
    }
    let (command, rest) = telegram_command(text);
    match command {
        "/start" | "/help" => {
            send_weixin_text(
                state,
                account,
                chat_id,
                &platform_help_text(account, "Weixin Bot", Some(chat_id)),
            )
            .await?
        }
        "/sessions" => {
            let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
            send_weixin_text(
                state,
                account,
                chat_id,
                &telegram_sessions_text(account, &sessions),
            )
            .await?;
        }
        "/whoami" => {
            send_weixin_text(
                state,
                account,
                chat_id,
                &platform_identity_text(account, chat_id),
            )
            .await?;
        }
        "/agents" => send_platform_agents(state, kind, account, chat_id).await?,
        "/rooms" => send_platform_rooms(state, kind, account, chat_id).await?,
        "/files" => {
            if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                send_platform_files(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_file_roots(state, kind, account, chat_id).await?;
            }
        }
        "/terminal" => {
            if rest.is_empty() {
                state.weixin_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "terminal", "createdAt": current_millis() }),
                );
                send_weixin_text(state, account, chat_id, platform_text(account, "等待输入：请在下一条消息里发送终端命令，或发送 /cancel 取消。", "Waiting for input: send the terminal command in your next reply, or send /cancel to cancel.")).await?;
            } else if let Some(session) =
                route_session_from_table(state, kind.route_table(), account, chat_id)?
            {
                run_platform_terminal(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(session.workspace_path),
                    rest,
                )
                .await?;
            } else {
                send_platform_terminal_roots(state, kind, account, chat_id, rest).await?;
            }
        }
        "/bind" => {
            if rest.is_empty() {
                send_weixin_bind_picker(state, account, chat_id).await?;
            } else if let Some(session) = find_platform_session(state, rest)? {
                set_weixin_route_in_table(state, &account.id, chat_id, &session.id, None)?;
                send_weixin_text(
                    state,
                    account,
                    chat_id,
                    &format!(
                        "{} {}\n{}",
                        platform_text(account, "已绑定：", "Bound to:"),
                        session.title,
                        session.id
                    ),
                )
                .await?;
            } else {
                send_weixin_text(
                    state,
                    account,
                    chat_id,
                    platform_text(
                        account,
                        "未找到会话，请先用 /sessions 查看最近会话。",
                        "Session not found. Use /sessions to view recent sessions.",
                    ),
                )
                .await?;
            }
        }
        "/unbind" => {
            clear_route_in_table(&state.db, "weixin_chat_routes", &account.id, chat_id)?;
            send_weixin_text(
                state,
                account,
                chat_id,
                platform_text(account, "已清除绑定会话。", "Bound session cleared."),
            )
            .await?;
        }
        "/send" => {
            if rest.is_empty() {
                state.weixin_chat.set_pending(
                    format!("{pending_key}:input"),
                    serde_json::json!({ "kind": "send", "createdAt": current_millis() }),
                );
                send_weixin_text(
                    state,
                    account,
                    chat_id,
                    platform_text(account, "请发送消息内容。", "Send me the message text."),
                )
                .await?;
            } else {
                handle_weixin_send_command(state, account, chat_id, rest).await?;
            }
        }
        _ => route_weixin_send_message(state, account, chat_id, text).await?,
    }
    Ok(())
}

enum PlatformSelection {
    Expired,
    NotFound,
    Bind(crate::api::sessions::models::SessionSummary),
    Send {
        session: crate::api::sessions::models::SessionSummary,
        message: String,
    },
}

#[derive(Clone, Copy)]
enum ExternalPlatformKind {
    WeCom,
    Weixin,
    Feishu,
    Qq,
}

impl ExternalPlatformKind {
    fn pending_prefix(self) -> &'static str {
        match self {
            Self::WeCom => "wecom_chat_routes",
            Self::Weixin => "weixin_chat_routes",
            Self::Feishu => "feishu_chat_routes",
            Self::Qq => "qq_chat_routes",
        }
    }

    fn route_table(self) -> &'static str {
        self.pending_prefix()
    }

    fn runtime(self, state: &AppState) -> &crate::state::PlatformChatRuntimeState {
        match self {
            Self::WeCom => &state.wecom_chat,
            Self::Weixin => &state.weixin_chat,
            Self::Feishu => &state.feishu_chat,
            Self::Qq => &state.qq_chat,
        }
    }
}

fn platform_text<'a>(account: &NotificationAccountSummary, zh: &'a str, en: &'a str) -> &'a str {
    telegram_text(account, zh, en)
}

fn platform_pending_prefix(platform: &str, account_id: &str, chat_id: &str) -> String {
    format!("{platform}:{account_id}:{chat_id}")
}

fn platform_pending_expired(pending: &serde_json::Value) -> bool {
    telegram_pending_expired(pending, 10 * 60 * 1000)
}

async fn platform_send_text(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<()> {
    match kind {
        ExternalPlatformKind::WeCom => send_wecom_text(state, account, chat_id, text).await,
        ExternalPlatformKind::Weixin => send_weixin_text(state, account, chat_id, text).await,
        ExternalPlatformKind::Feishu => send_feishu_text(account, chat_id, text).await,
        ExternalPlatformKind::Qq => send_qq_text(account, chat_id, text).await,
    }
}

fn platform_identity_text(account: &NotificationAccountSummary, chat_id: &str) -> String {
    if telegram_language(account) == "en-US" {
        format!("Current chat ID: {chat_id}")
    } else {
        format!("当前聊天 ID：{chat_id}")
    }
}

fn platform_pending_key(
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    suffix: &str,
) -> String {
    format!(
        "{}:{suffix}",
        platform_pending_prefix(kind.pending_prefix(), &account.id, chat_id)
    )
}

async fn handle_platform_tool_selection(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    text: &str,
) -> anyhow::Result<bool> {
    let runtime = kind.runtime(state);
    let trimmed = text.trim();
    if let Some(pending) =
        runtime.get_pending(&platform_pending_key(kind, account, chat_id, "agents"))
    {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "agents"));
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                platform_text(
                    account,
                    "这条 Agent 列表已过期。",
                    "This agent list expired.",
                ),
            )
            .await?;
            return Ok(true);
        }
        if let Some(index) = platform_number_choice(trimmed) {
            let agent_id = pending_id_at(&pending, index).unwrap_or_default();
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "agents"));
            bind_platform_agent_session(state, kind, account, chat_id, &agent_id).await?;
            return Ok(true);
        }
    }
    if let Some(pending) =
        runtime.get_pending(&platform_pending_key(kind, account, chat_id, "rooms"))
    {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "rooms"));
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                platform_text(account, "这条 Room 列表已过期。", "This room list expired."),
            )
            .await?;
            return Ok(true);
        }
        if let Some(index) = platform_number_choice(trimmed) {
            let room_id = pending_id_at(&pending, index).unwrap_or_default();
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "rooms"));
            bind_platform_room_session(state, kind, account, chat_id, &room_id).await?;
            return Ok(true);
        }
    }
    if let Some(pending) =
        runtime.get_pending(&platform_pending_key(kind, account, chat_id, "file_roots"))
    {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "file_roots"));
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                platform_text(account, "文件根目录列表已过期。", "File root list expired."),
            )
            .await?;
            return Ok(true);
        }
        if let Some(index) = platform_number_choice(trimmed) {
            let root = pending_root_at(&pending, index).unwrap_or_default();
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "file_roots"));
            send_platform_files(state, kind, account, chat_id, PathBuf::from(root), "").await?;
            return Ok(true);
        }
    }
    if let Some(pending) =
        runtime.get_pending(&platform_pending_key(kind, account, chat_id, "files"))
    {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "files"));
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                platform_text(account, "这条文件列表已过期。", "This file list expired."),
            )
            .await?;
            return Ok(true);
        }
        if trimmed == ".." {
            let root = pending.get("root").and_then(|v| v.as_str()).unwrap_or("");
            let rel = pending
                .get("relPath")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let parent = Path::new(rel)
                .parent()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default();
            send_platform_files(state, kind, account, chat_id, PathBuf::from(root), &parent)
                .await?;
            return Ok(true);
        }
        if let Some(index) = platform_number_choice(trimmed) {
            let root = pending.get("root").and_then(|v| v.as_str()).unwrap_or("");
            let rel = pending
                .get("relPath")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let name = pending_id_at_key(&pending, "dirNames", index).unwrap_or_default();
            if !name.is_empty() {
                send_platform_files(
                    state,
                    kind,
                    account,
                    chat_id,
                    PathBuf::from(root),
                    &Path::new(rel).join(name).to_string_lossy(),
                )
                .await?;
                return Ok(true);
            }
        }
    }
    if let Some(pending) =
        runtime.get_pending(&platform_pending_key(kind, account, chat_id, "terminal"))
    {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "terminal"));
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                platform_text(
                    account,
                    "这条终端命令已过期。",
                    "This terminal command expired.",
                ),
            )
            .await?;
            return Ok(true);
        }
        if let Some(index) = platform_number_choice(trimmed) {
            let command = pending
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let root = pending_root_at(&pending, index).unwrap_or_default();
            runtime.remove_pending(&platform_pending_key(kind, account, chat_id, "terminal"));
            run_platform_terminal(state, kind, account, chat_id, PathBuf::from(root), &command)
                .await?;
            return Ok(true);
        }
    }
    Ok(false)
}

fn platform_number_choice(text: &str) -> Option<usize> {
    text.trim()
        .parse::<usize>()
        .ok()
        .filter(|index| *index > 0)
        .map(|index| index - 1)
}

fn pending_id_at(pending: &serde_json::Value, index: usize) -> Option<String> {
    pending_id_at_key(pending, "ids", index)
}

fn pending_id_at_key(pending: &serde_json::Value, key: &str, index: usize) -> Option<String> {
    pending
        .get(key)
        .and_then(|value| value.as_array())
        .and_then(|items| items.get(index))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn pending_root_at(pending: &serde_json::Value, index: usize) -> Option<String> {
    pending
        .get("roots")
        .and_then(|value| value.as_array())
        .and_then(|items| items.get(index))
        .and_then(|value| value.get("root"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

async fn send_platform_agents(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let agents = crate::api::agents::store::list_agents(&state.db, 100)?
        .items
        .into_iter()
        .filter(|agent| agent.enabled)
        .collect::<Vec<_>>();
    if agents.is_empty() {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用的已启用 Agent。",
                "No enabled agents are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    let choices = agents.iter().take(12).collect::<Vec<_>>();
    kind.runtime(state).set_pending(
        platform_pending_key(kind, account, chat_id, "agents"),
        serde_json::json!({ "ids": choices.iter().map(|agent| agent.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }),
    );
    let mut lines = vec![platform_text(
        account,
        "请选择一个 Agent 来创建并绑定新会话：",
        "Select an agent to create and bind a new session:",
    )
    .to_string()];
    lines.extend(
        choices
            .iter()
            .enumerate()
            .map(|(index, agent)| format!("{}. {}\n{}", index + 1, agent.name, agent.id)),
    );
    lines.push(String::new());
    lines.push(platform_text(account, "回复序号即可。", "Reply with the number.").to_string());
    platform_send_text(state, kind, account, chat_id, &lines.join("\n\n")).await
}

async fn bind_platform_agent_session(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    agent_id: &str,
) -> anyhow::Result<()> {
    match crate::api::agents::store::create_agent_session(
        &state.db,
        agent_id,
        crate::api::agents::models::CreateAgentSessionRequest { project_id: None },
    )? {
        Ok(session) => {
            set_route_in_table(
                &state.db,
                kind.route_table(),
                &account.id,
                chat_id,
                &session.id,
            )?;
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                &format!(
                    "{}\n{}\n{}",
                    platform_text(account, "已创建并绑定会话：", "Created and bound session:"),
                    telegram_session_label(account, &session),
                    session.id
                ),
            )
            .await?;
        }
        Err(_) => {
            platform_send_text(
                state,
                kind,
                account,
                chat_id,
                platform_text(account, "Agent 已不可用。", "Agent is no longer available."),
            )
            .await?;
        }
    }
    Ok(())
}

async fn send_platform_rooms(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let rooms = crate::api::rooms::store::list_rooms(&state.db, None, 100)?.items;
    if rooms.is_empty() {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(account, "当前没有可用的 Room。", "No rooms are available."),
        )
        .await?;
        return Ok(());
    }
    let choices = rooms.iter().take(12).collect::<Vec<_>>();
    kind.runtime(state).set_pending(
        platform_pending_key(kind, account, chat_id, "rooms"),
        serde_json::json!({ "ids": choices.iter().map(|room| room.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }),
    );
    let mut lines = vec![platform_text(
        account,
        "请选择一个 Room 来绑定当前聊天对应的会话：",
        "Select a room to bind this chat to its session:",
    )
    .to_string()];
    lines.extend(
        choices
            .iter()
            .enumerate()
            .map(|(index, room)| format!("{}. {}\n{}", index + 1, room.name, room.id)),
    );
    lines.push(String::new());
    lines.push(platform_text(account, "回复序号即可。", "Reply with the number.").to_string());
    platform_send_text(state, kind, account, chat_id, &lines.join("\n\n")).await
}

async fn bind_platform_room_session(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    room_id: &str,
) -> anyhow::Result<()> {
    let Some(room) = crate::api::rooms::store::get_room(&state.db, room_id)? else {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "Room 会话已不可用。",
                "Room session is no longer available.",
            ),
        )
        .await?;
        return Ok(());
    };
    let Some(session_id) = room.session_id.as_deref() else {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "Room 会话已不可用。",
                "Room session is no longer available.",
            ),
        )
        .await?;
        return Ok(());
    };
    set_route_in_table(
        &state.db,
        kind.route_table(),
        &account.id,
        chat_id,
        session_id,
    )?;
    platform_send_text(
        state,
        kind,
        account,
        chat_id,
        &format!(
            "{}\n{}\n{}",
            platform_text(account, "已绑定 Room 会话：", "Bound room session:"),
            room.name,
            session_id
        ),
    )
    .await
}

async fn send_platform_file_roots(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let roots = telegram_roots(state, account, None);
    if roots.is_empty() {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用的文件根目录。",
                "No file roots are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    kind.runtime(state).set_pending(
        platform_pending_key(kind, account, chat_id, "file_roots"),
        serde_json::json!({ "roots": roots, "createdAt": current_millis() }),
    );
    send_platform_root_choices(
        state,
        kind,
        account,
        chat_id,
        "file_roots",
        platform_text(account, "请选择文件根目录：", "Select a file root:"),
    )
    .await
}

async fn send_platform_terminal_roots(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    command: &str,
) -> anyhow::Result<()> {
    let roots = telegram_roots(state, account, None);
    if roots.is_empty() {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用的终端根目录。",
                "No terminal roots are available.",
            ),
        )
        .await?;
        return Ok(());
    }
    kind.runtime(state).set_pending(
        platform_pending_key(kind, account, chat_id, "terminal"),
        serde_json::json!({ "command": command, "roots": roots, "createdAt": current_millis() }),
    );
    send_platform_root_choices(
        state,
        kind,
        account,
        chat_id,
        "terminal",
        &format!(
            "{}\n{}",
            platform_text(account, "请选择运行位置：", "Select where to run:"),
            command
        ),
    )
    .await
}

async fn send_platform_root_choices(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    suffix: &str,
    title: &str,
) -> anyhow::Result<()> {
    let pending = kind
        .runtime(state)
        .get_pending(&platform_pending_key(kind, account, chat_id, suffix))
        .unwrap_or_else(|| serde_json::json!({}));
    let roots = pending
        .get("roots")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut lines = vec![title.to_string()];
    lines.extend(roots.iter().enumerate().map(|(index, root)| {
        format!(
            "{}. {}",
            index + 1,
            root.get("label")
                .and_then(|value| value.as_str())
                .unwrap_or("root")
        )
    }));
    lines.push(String::new());
    lines.push(platform_text(account, "回复序号即可。", "Reply with the number.").to_string());
    platform_send_text(state, kind, account, chat_id, &lines.join("\n")).await
}

async fn send_platform_files(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    root: PathBuf,
    rel_path: &str,
) -> anyhow::Result<()> {
    let root = root.canonicalize().unwrap_or(root);
    let safe_rel = safe_relative_path(rel_path);
    let target = root
        .join(&safe_rel)
        .canonicalize()
        .unwrap_or_else(|_| root.join(&safe_rel));
    if !target.starts_with(&root) || !target.is_dir() {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(account, "目录不可用。", "Directory is not available."),
        )
        .await?;
        return Ok(());
    }
    let mut entries = std::fs::read_dir(&target)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| {
            let metadata = entry.metadata().ok();
            (
                entry.file_name().to_string_lossy().to_string(),
                metadata.as_ref().is_some_and(|m| m.is_dir()),
                metadata.map(|m| m.len()).unwrap_or(0),
            )
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(40);
    let dirs = entries
        .iter()
        .filter(|(_, is_dir, _)| *is_dir)
        .take(20)
        .map(|(name, _, _)| name.clone())
        .collect::<Vec<_>>();
    kind.runtime(state).set_pending(
        platform_pending_key(kind, account, chat_id, "files"),
        serde_json::json!({ "root": root, "relPath": safe_rel, "dirNames": dirs, "createdAt": current_millis() }),
    );
    let mut lines = vec![
        format!("Files: /{}", safe_rel.to_string_lossy()),
        String::new(),
    ];
    lines.extend(entries.iter().map(|(name, is_dir, size)| {
        if *is_dir {
            format!("[dir] {name}")
        } else {
            format!("[file] {name} · {size} bytes")
        }
    }));
    if !safe_rel.as_os_str().is_empty() {
        lines.push(String::new());
        lines.push(
            platform_text(account, "回复 .. 返回上级目录。", "Reply .. to go up.").to_string(),
        );
    }
    if !kind
        .runtime(state)
        .get_pending(&platform_pending_key(kind, account, chat_id, "files"))
        .and_then(|pending| pending.get("dirNames").cloned())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .is_empty()
    {
        lines.push(
            platform_text(
                account,
                "回复目录序号进入目录。",
                "Reply with a directory number to open it.",
            )
            .to_string(),
        );
    }
    platform_send_text(state, kind, account, chat_id, &lines.join("\n")).await
}

async fn run_platform_terminal(
    state: &AppState,
    kind: ExternalPlatformKind,
    account: &NotificationAccountSummary,
    chat_id: &str,
    cwd: PathBuf,
    command: &str,
) -> anyhow::Result<()> {
    if dangerous_command(command) {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "命令已被安全规则拦截。",
                "Command blocked by safety guard.",
            ),
        )
        .await?;
        return Ok(());
    }
    let cwd = cwd.canonicalize().unwrap_or(cwd);
    if !cwd.is_dir() {
        platform_send_text(
            state,
            kind,
            account,
            chat_id,
            platform_text(
                account,
                "终端目录不可用。",
                "Terminal directory is not available.",
            ),
        )
        .await?;
        return Ok(());
    }
    platform_send_text(
        state,
        kind,
        account,
        chat_id,
        &format!(
            "{} {}:\n{}",
            platform_text(account, "运行于", "Running in"),
            cwd.display(),
            command
        ),
    )
    .await?;
    let mut child = tokio::process::Command::new("/bin/zsh")
        .arg("-lc")
        .arg(command)
        .current_dir(cwd)
        .env(
            "CODEX_HOME",
            state.config.codex_home.to_string_lossy().to_string(),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout).await;
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr).await;
    }
    let status = tokio::time::timeout(std::time::Duration::from_secs(20), child.wait()).await;
    let text = match status {
        Ok(Ok(status)) => format!(
            "{}: {}\n\nstdout:\n{}\n\nstderr:\n{}",
            platform_text(account, "退出码", "Exit code"),
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| platform_text(account, "未知", "unknown").to_string()),
            if stdout.trim().is_empty() {
                "(empty)"
            } else {
                stdout.trim()
            },
            stderr.trim()
        ),
        _ => platform_text(account, "执行超时。", "Timed out.").to_string(),
    };
    platform_send_text(state, kind, account, chat_id, &text).await
}

fn platform_help_text(
    account: &NotificationAccountSummary,
    title_en: &str,
    chat_id: Option<&str>,
) -> String {
    let title = if telegram_language(account) == "en-US" {
        format!("Codex Web {title_en}")
    } else {
        match title_en {
            "WeCom AI Bot" => "Codex Web 企业微信 AI Bot".to_string(),
            "Weixin Bot" => "Codex Web 微信机器人".to_string(),
            "QQ Bot" => "Codex Web QQ 机器人".to_string(),
            "Feishu Bot" => "Codex Web 飞书机器人".to_string(),
            _ => format!("Codex Web {title_en}"),
        }
    };
    let mut lines = if telegram_language(account) == "en-US" {
        vec![
            title,
            String::new(),
            "/sessions - list recent sessions".to_string(),
            "/agents - list agents and create a bound agent session".to_string(),
            "/rooms - list rooms and bind a room session".to_string(),
            "/files - browse bound or system files".to_string(),
            "/terminal <command> - run in bound or selected workspace".to_string(),
            "/whoami - show this chat ID".to_string(),
            "/bind - bind this chat to a session".to_string(),
            "/unbind - clear the bound session".to_string(),
            "/send <index, title, or sessionId> | <message> - send to a session".to_string(),
            "/send <message> - choose a session when no session is bound".to_string(),
            String::new(),
            "Reply behavior:".to_string(),
            "- Bound/default session: plain text goes into that session and assistant replies are sent back here.".to_string(),
            "- /send: sends one message to the chosen session and the assistant reply for that round is sent back here.".to_string(),
            "Plain text is sent to the bound/default session, or asks you to choose one.".to_string(),
        ]
    } else {
        vec![
            title,
            String::new(),
            "/sessions - 列出最近会话".to_string(),
            "/agents - 列出 Agent 并创建绑定 Agent 会话".to_string(),
            "/rooms - 列出 Room 并绑定 Room 会话".to_string(),
            "/files - 浏览绑定或系统文件".to_string(),
            "/terminal <命令> - 在绑定或选定的工作区运行终端命令".to_string(),
            "/whoami - 查看当前聊天 ID".to_string(),
            "/bind - 将当前聊天绑定到某个会话".to_string(),
            "/unbind - 清除绑定的会话".to_string(),
            "/send <序号、标题或 sessionId> | <消息> - 向会话发送消息".to_string(),
            "/send <消息> - 未绑定时选择一个会话".to_string(),
            String::new(),
            "回复规则：".to_string(),
            "- 已绑定/默认会话：普通文本会进入该会话，助手回复会发回这里。".to_string(),
            "- /send：向选定会话发送一条消息，本轮助手回复会发回这里。".to_string(),
            "普通文本会发送到已绑定/默认会话，或者让你先选择一个会话。".to_string(),
        ]
    };
    if let Some(chat_id) = chat_id.filter(|value| !value.is_empty()) {
        lines.push(String::new());
        lines.push(format!(
            "{} {chat_id}",
            platform_text(account, "当前聊天 ID：", "Current chat ID:")
        ));
    }
    lines.join("\n")
}

fn find_platform_session(
    state: &AppState,
    query: &str,
) -> anyhow::Result<Option<crate::api::sessions::models::SessionSummary>> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    Ok(find_telegram_session(&sessions, query).cloned())
}

fn resolve_platform_selection(
    state: &AppState,
    runtime: &crate::state::PlatformChatRuntimeState,
    _table: &str,
    account: &NotificationAccountSummary,
    chat_id: &str,
    raw: &str,
) -> anyhow::Result<Option<PlatformSelection>> {
    let prefix = platform_pending_prefix(_table, &account.id, chat_id);
    let send_key = format!("{prefix}:send");
    let bind_key = format!("{prefix}:bind");
    if let Some(pending) = runtime.get_pending(&send_key) {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&send_key);
            return Ok(Some(PlatformSelection::Expired));
        }
        let session = platform_pending_session(state, &pending, raw)?;
        let Some(session) = session else {
            return Ok(Some(PlatformSelection::NotFound));
        };
        let message = pending
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        runtime.remove_pending(&send_key);
        return Ok(Some(PlatformSelection::Send { session, message }));
    }
    if let Some(pending) = runtime.get_pending(&bind_key) {
        if platform_pending_expired(&pending) {
            runtime.remove_pending(&bind_key);
            return Ok(Some(PlatformSelection::Expired));
        }
        let session = platform_pending_session(state, &pending, raw)?;
        let Some(session) = session else {
            return Ok(Some(PlatformSelection::NotFound));
        };
        runtime.remove_pending(&bind_key);
        return Ok(Some(PlatformSelection::Bind(session)));
    }
    Ok(None)
}

fn platform_pending_session(
    state: &AppState,
    pending: &serde_json::Value,
    raw: &str,
) -> anyhow::Result<Option<crate::api::sessions::models::SessionSummary>> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    let text = raw.trim();
    if let Ok(index) = text.parse::<usize>() {
        if index > 0 {
            if let Some(id) = pending
                .get("sessionIds")
                .and_then(|value| value.as_array())
                .and_then(|items| items.get(index - 1))
                .and_then(|value| value.as_str())
            {
                return Ok(sessions.into_iter().find(|session| session.id == id));
            }
        }
    }
    Ok(find_telegram_session(&sessions, text).cloned())
}

async fn send_wecom_bind_picker(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    let choices = telegram_session_choices(&sessions);
    if choices.is_empty() {
        send_wecom_text(
            state,
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用会话，请先创建一个会话。",
                "No sessions are available. Create a session first.",
            ),
        )
        .await?;
        return Ok(());
    }
    let key = format!(
        "{}:bind",
        platform_pending_prefix("wecom_chat_routes", &account.id, chat_id)
    );
    state.wecom_chat.set_pending(key, serde_json::json!({ "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
    let text = [
        platform_text(
            account,
            "请选择一个会话绑定当前聊天：",
            "Select a session to bind this chat to:",
        )
        .to_string(),
        choices
            .iter()
            .enumerate()
            .map(|(index, session)| {
                format!(
                    "{}. {}",
                    index + 1,
                    telegram_session_label(account, session)
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        String::new(),
        platform_text(
            account,
            "回复序号、标题或会话 ID 即可。",
            "Reply with the number, title, or session ID.",
        )
        .to_string(),
    ]
    .join("\n");
    send_wecom_text(state, account, chat_id, &text).await
}

async fn route_wecom_send_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    message: &str,
) -> anyhow::Result<()> {
    if let Some(session) = route_session_from_table(state, "wecom_chat_routes", account, chat_id)? {
        dispatch_platform_chat_message(
            state,
            &state.wecom_chat,
            "WeCom",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        let choices = telegram_session_choices(&sessions);
        if choices.is_empty() {
            send_wecom_text(
                state,
                account,
                chat_id,
                platform_text(
                    account,
                    "当前没有可用会话，请先创建一个会话。",
                    "No sessions are available. Create a session first.",
                ),
            )
            .await?;
            return Ok(());
        }
        let key = format!(
            "{}:send",
            platform_pending_prefix("wecom_chat_routes", &account.id, chat_id)
        );
        state.wecom_chat.set_pending(key, serde_json::json!({ "message": message, "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
        let text = [
            platform_text(
                account,
                "请选择一个会话发送这条消息：",
                "Select a session to send this message:",
            )
            .to_string(),
            choices
                .iter()
                .enumerate()
                .map(|(index, session)| {
                    format!(
                        "{}. {}",
                        index + 1,
                        telegram_session_label(account, session)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n"),
            String::new(),
            platform_text(
                account,
                "回复序号、标题或会话 ID 即可。",
                "Reply with the number, title, or session ID.",
            )
            .to_string(),
        ]
        .join("\n");
        send_wecom_text(state, account, chat_id, &text).await?;
    }
    Ok(())
}

async fn handle_wecom_send_command(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    rest: &str,
) -> anyhow::Result<()> {
    let (target_text, message) = if let Some((target, message)) = rest.split_once('|') {
        (target.trim(), message.trim())
    } else {
        ("", rest.trim())
    };
    if message.is_empty() {
        send_wecom_text(
            state,
            account,
            chat_id,
            platform_text(
                account,
                "消息为空，请使用 /send <会话ID或标题> | <消息>。",
                "Message is empty. Use /send <sessionId or title> | <message>.",
            ),
        )
        .await?;
        return Ok(());
    }
    if target_text.is_empty() {
        route_wecom_send_message(state, account, chat_id, message).await?;
        return Ok(());
    }
    if let Some(session) = find_platform_session(state, target_text)? {
        set_route_in_table(
            &state.db,
            "wecom_chat_routes",
            &account.id,
            chat_id,
            &session.id,
        )?;
        dispatch_platform_chat_message(
            state,
            &state.wecom_chat,
            "WeCom",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        send_wecom_text(
            state,
            account,
            chat_id,
            platform_text(
                account,
                "未找到会话，请先用 /sessions 查看最近会话。",
                "Session not found. Use /sessions to view recent sessions.",
            ),
        )
        .await?;
    }
    Ok(())
}

async fn send_weixin_bind_picker(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    let choices = telegram_session_choices(&sessions);
    if choices.is_empty() {
        send_weixin_text(
            state,
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用会话，请先创建一个会话。",
                "No sessions are available. Create a session first.",
            ),
        )
        .await?;
        return Ok(());
    }
    let key = format!(
        "{}:bind",
        platform_pending_prefix("weixin_chat_routes", &account.id, chat_id)
    );
    state.weixin_chat.set_pending(key, serde_json::json!({ "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
    let text = [
        platform_text(
            account,
            "请选择一个会话绑定当前聊天：",
            "Select a session to bind this chat to:",
        )
        .to_string(),
        choices
            .iter()
            .enumerate()
            .map(|(index, session)| {
                format!(
                    "{}. {}",
                    index + 1,
                    telegram_session_label(account, session)
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        String::new(),
        platform_text(
            account,
            "回复序号、标题或会话 ID 即可。",
            "Reply with the number, title, or session ID.",
        )
        .to_string(),
    ]
    .join("\n");
    send_weixin_text(state, account, chat_id, &text).await
}

async fn route_weixin_send_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    message: &str,
) -> anyhow::Result<()> {
    if let Some(session) = route_session_from_table(state, "weixin_chat_routes", account, chat_id)?
    {
        start_weixin_typing(account.clone(), chat_id.to_string());
        dispatch_platform_chat_message(
            state,
            &state.weixin_chat,
            "Weixin",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        let choices = telegram_session_choices(&sessions);
        if choices.is_empty() {
            send_weixin_text(
                state,
                account,
                chat_id,
                platform_text(
                    account,
                    "当前没有可用会话，请先创建一个会话。",
                    "No sessions are available. Create a session first.",
                ),
            )
            .await?;
            return Ok(());
        }
        let key = format!(
            "{}:send",
            platform_pending_prefix("weixin_chat_routes", &account.id, chat_id)
        );
        state.weixin_chat.set_pending(key, serde_json::json!({ "message": message, "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
        let text = [
            platform_text(
                account,
                "请选择一个会话发送这条消息：",
                "Select a session to send this message:",
            )
            .to_string(),
            choices
                .iter()
                .enumerate()
                .map(|(index, session)| {
                    format!(
                        "{}. {}",
                        index + 1,
                        telegram_session_label(account, session)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n"),
            String::new(),
            platform_text(
                account,
                "回复序号、标题或会话 ID 即可。",
                "Reply with the number, title, or session ID.",
            )
            .to_string(),
        ]
        .join("\n");
        send_weixin_text(state, account, chat_id, &text).await?;
    }
    Ok(())
}

async fn handle_weixin_send_command(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    rest: &str,
) -> anyhow::Result<()> {
    let (target_text, message) = if let Some((target, message)) = rest.split_once('|') {
        (target.trim(), message.trim())
    } else {
        ("", rest.trim())
    };
    if message.is_empty() {
        send_weixin_text(
            state,
            account,
            chat_id,
            platform_text(
                account,
                "消息为空，请使用 /send <会话ID或标题> | <消息>。",
                "Message is empty. Use /send <sessionId or title> | <message>.",
            ),
        )
        .await?;
        return Ok(());
    }
    if target_text.is_empty() {
        route_weixin_send_message(state, account, chat_id, message).await?;
        return Ok(());
    }
    if let Some(session) = find_platform_session(state, target_text)? {
        set_weixin_route_in_table(state, &account.id, chat_id, &session.id, None)?;
        start_weixin_typing(account.clone(), chat_id.to_string());
        dispatch_platform_chat_message(
            state,
            &state.weixin_chat,
            "Weixin",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        send_weixin_text(
            state,
            account,
            chat_id,
            platform_text(
                account,
                "未找到会话，请先用 /sessions 查看最近会话。",
                "Session not found. Use /sessions to view recent sessions.",
            ),
        )
        .await?;
    }
    Ok(())
}

async fn send_feishu_bind_picker(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    let choices = telegram_session_choices(&sessions);
    if choices.is_empty() {
        send_feishu_text(
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用会话，请先创建一个会话。",
                "No sessions are available. Create a session first.",
            ),
        )
        .await?;
        return Ok(());
    }
    let key = format!(
        "{}:bind",
        platform_pending_prefix("feishu_chat_routes", &account.id, chat_id)
    );
    state.feishu_chat.set_pending(key, serde_json::json!({ "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
    let text = [
        platform_text(
            account,
            "请选择一个会话绑定当前聊天：",
            "Select a session to bind this chat to:",
        )
        .to_string(),
        choices
            .iter()
            .enumerate()
            .map(|(index, session)| {
                format!(
                    "{}. {}",
                    index + 1,
                    telegram_session_label(account, session)
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        String::new(),
        platform_text(
            account,
            "回复序号、标题或会话 ID 即可。",
            "Reply with the number, title, or session ID.",
        )
        .to_string(),
    ]
    .join("\n");
    send_feishu_text(account, chat_id, &text).await
}

async fn route_feishu_send_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    message: &str,
) -> anyhow::Result<()> {
    if let Some(session) = route_session_from_table(state, "feishu_chat_routes", account, chat_id)?
    {
        dispatch_platform_chat_message(
            state,
            &state.feishu_chat,
            "Feishu",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        let choices = telegram_session_choices(&sessions);
        if choices.is_empty() {
            send_feishu_text(
                account,
                chat_id,
                platform_text(
                    account,
                    "当前没有可用会话，请先创建一个会话。",
                    "No sessions are available. Create a session first.",
                ),
            )
            .await?;
            return Ok(());
        }
        let key = format!(
            "{}:send",
            platform_pending_prefix("feishu_chat_routes", &account.id, chat_id)
        );
        state.feishu_chat.set_pending(key, serde_json::json!({ "message": message, "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
        let text = [
            platform_text(
                account,
                "请选择一个会话发送这条消息：",
                "Select a session to send this message:",
            )
            .to_string(),
            telegram_sessions_text(account, &sessions),
            String::new(),
            platform_text(
                account,
                "回复序号、标题或会话 ID 即可。",
                "Reply with the number, title, or session ID.",
            )
            .to_string(),
        ]
        .join("\n");
        send_feishu_text(account, chat_id, &text).await?;
    }
    Ok(())
}

async fn handle_feishu_send_command(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    rest: &str,
) -> anyhow::Result<()> {
    let (target_text, message) = if let Some((target, message)) = rest.split_once('|') {
        (target.trim(), message.trim())
    } else {
        ("", rest.trim())
    };
    if message.is_empty() {
        send_feishu_text(
            account,
            chat_id,
            platform_text(
                account,
                "消息为空，请使用 /send <会话ID或标题> | <消息>。",
                "Message is empty. Use /send <sessionId or title> | <message>.",
            ),
        )
        .await?;
        return Ok(());
    }
    if target_text.is_empty() {
        route_feishu_send_message(state, account, chat_id, message).await?;
        return Ok(());
    }
    if let Some(session) = find_platform_session(state, target_text)? {
        set_route_in_table(
            &state.db,
            "feishu_chat_routes",
            &account.id,
            chat_id,
            &session.id,
        )?;
        dispatch_platform_chat_message(
            state,
            &state.feishu_chat,
            "Feishu",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        send_feishu_text(
            account,
            chat_id,
            platform_text(
                account,
                "未找到会话，请先用 /sessions 查看最近会话。",
                "Session not found. Use /sessions to view recent sessions.",
            ),
        )
        .await?;
    }
    Ok(())
}

async fn send_qq_bind_picker(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
) -> anyhow::Result<()> {
    let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
    let choices = telegram_session_choices(&sessions);
    if choices.is_empty() {
        send_qq_text(
            account,
            chat_id,
            platform_text(
                account,
                "当前没有可用会话，请先创建一个会话。",
                "No sessions are available. Create a session first.",
            ),
        )
        .await?;
        return Ok(());
    }
    let key = format!(
        "{}:bind",
        platform_pending_prefix("qq_chat_routes", &account.id, chat_id)
    );
    state.qq_chat.set_pending(key, serde_json::json!({ "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
    let text = [
        platform_text(
            account,
            "请选择一个会话绑定当前聊天：",
            "Select a session to bind this chat to:",
        )
        .to_string(),
        choices
            .iter()
            .enumerate()
            .map(|(index, session)| {
                format!(
                    "{}. {}",
                    index + 1,
                    telegram_session_label(account, session)
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        String::new(),
        platform_text(
            account,
            "回复序号、标题或会话 ID 即可。",
            "Reply with the number, title, or session ID.",
        )
        .to_string(),
    ]
    .join("\n");
    send_qq_text(account, chat_id, &text).await
}

async fn route_qq_send_message(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    message: &str,
) -> anyhow::Result<()> {
    if let Some(session) = route_session_from_table(state, "qq_chat_routes", account, chat_id)? {
        dispatch_platform_chat_message(
            state,
            &state.qq_chat,
            "QQ",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        let sessions = crate::api::sessions::store::list_sessions(&state.db, true, true)?;
        let choices = telegram_session_choices(&sessions);
        if choices.is_empty() {
            send_qq_text(
                account,
                chat_id,
                platform_text(
                    account,
                    "当前没有可用会话，请先创建一个会话。",
                    "No sessions are available. Create a session first.",
                ),
            )
            .await?;
            return Ok(());
        }
        let key = format!(
            "{}:send",
            platform_pending_prefix("qq_chat_routes", &account.id, chat_id)
        );
        state.qq_chat.set_pending(key, serde_json::json!({ "message": message, "sessionIds": choices.iter().map(|session| session.id.clone()).collect::<Vec<_>>(), "createdAt": current_millis() }));
        let text = [
            platform_text(
                account,
                "请选择一个会话发送这条消息：",
                "Select a session to send this message:",
            )
            .to_string(),
            choices
                .iter()
                .enumerate()
                .map(|(index, session)| {
                    format!(
                        "{}. {}",
                        index + 1,
                        telegram_session_label(account, session)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n"),
            String::new(),
            platform_text(
                account,
                "回复序号、标题或会话 ID 即可。",
                "Reply with the number, title, or session ID.",
            )
            .to_string(),
        ]
        .join("\n");
        send_qq_text(account, chat_id, &text).await?;
    }
    Ok(())
}

async fn handle_qq_send_command(
    state: &AppState,
    account: &NotificationAccountSummary,
    chat_id: &str,
    rest: &str,
) -> anyhow::Result<()> {
    let (target_text, message) = if let Some((target, message)) = rest.split_once('|') {
        (target.trim(), message.trim())
    } else {
        ("", rest.trim())
    };
    if message.is_empty() {
        send_qq_text(
            account,
            chat_id,
            platform_text(
                account,
                "消息为空，请使用 /send <会话ID或标题> | <消息>。",
                "Message is empty. Use /send <sessionId or title> | <message>.",
            ),
        )
        .await?;
        return Ok(());
    }
    if target_text.is_empty() {
        route_qq_send_message(state, account, chat_id, message).await?;
        return Ok(());
    }
    if let Some(session) = find_platform_session(state, target_text)? {
        set_route_in_table(
            &state.db,
            "qq_chat_routes",
            &account.id,
            chat_id,
            &session.id,
        )?;
        dispatch_platform_chat_message(
            state,
            &state.qq_chat,
            "QQ",
            &account.id,
            chat_id,
            &session,
            message,
        )
        .await?;
    } else {
        send_qq_text(
            account,
            chat_id,
            platform_text(
                account,
                "未找到会话，请先用 /sessions 查看最近会话。",
                "Session not found. Use /sessions to view recent sessions.",
            ),
        )
        .await?;
    }
    Ok(())
}

fn wecom_message_text(body: &serde_json::Value) -> String {
    body.get("text")
        .and_then(|v| {
            v.as_str()
                .or_else(|| v.get("content").and_then(|value| value.as_str()))
        })
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            body.get("quote")
                .and_then(|v| v.get("text"))
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            body.get("content")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            body.get("text_msg")
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default()
}

fn wecom_message_chat_id(body: &serde_json::Value) -> String {
    body.get("chatid")
        .or_else(|| body.get("chat_id"))
        .or_else(|| body.get("roomid"))
        .or_else(|| body.get("from").and_then(|from| from.get("userid")))
        .map(json_id_string)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn wecom_message_user_id(body: &serde_json::Value) -> String {
    body.get("from")
        .and_then(|from| from.get("userid"))
        .map(json_id_string)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn platform_policy(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "open".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "allowlist" => "allowlist".to_string(),
        "disabled" => "disabled".to_string(),
        _ => "open".to_string(),
    }
}

fn wecom_inbound_allowed(account: &NotificationAccountSummary, body: &serde_json::Value) -> bool {
    let chat_id = wecom_message_chat_id(body);
    if chat_id.is_empty() {
        return false;
    }
    let user_id = wecom_message_user_id(body);
    let allowed_from = config_list(&account.config, "allowFrom")
        .into_iter()
        .chain(config_list(&account.config, "allow_from"))
        .collect::<Vec<_>>();
    let group_allowed_from = config_list(&account.config, "groupAllowFrom")
        .into_iter()
        .chain(config_list(&account.config, "group_allow_from"))
        .collect::<Vec<_>>();
    let dm_policy = platform_policy(config_string(&account.config, "dmPolicy"));
    let group_policy = platform_policy(config_string(&account.config, "groupPolicy"));
    let is_group = body
        .get("chattype")
        .and_then(|value| value.as_str())
        .map(|value| value.eq_ignore_ascii_case("group"))
        .unwrap_or(false);
    if is_group {
        if group_policy == "disabled" {
            return false;
        }
        if group_policy == "allowlist" && !group_allowed_from.iter().any(|item| item == &chat_id) {
            return false;
        }
        if !allowed_from.is_empty()
            && !user_id.is_empty()
            && !allowed_from.iter().any(|item| item == &user_id)
        {
            return false;
        }
    } else {
        if dm_policy == "disabled" {
            return false;
        }
        if dm_policy == "allowlist"
            && !user_id.is_empty()
            && !allowed_from.iter().any(|item| item == &user_id)
        {
            return false;
        }
    }
    true
}

fn weixin_inbound_allowed(
    account: &NotificationAccountSummary,
    message: &serde_json::Value,
) -> bool {
    let chat_id = weixin_message_chat_id(message);
    let user_id = message
        .get("from_user_id")
        .map(json_id_string)
        .unwrap_or_default();
    let allowed_chat_ids = config_list(&account.config, "allowedChatIds");
    let allowed_user_ids = config_list(&account.config, "allowedUserIds");
    !chat_id.is_empty()
        && (allowed_chat_ids.is_empty() || allowed_chat_ids.iter().any(|item| item == &chat_id))
        && (allowed_user_ids.is_empty() || allowed_user_ids.iter().any(|item| item == &user_id))
}

fn weixin_message_chat_id(message: &serde_json::Value) -> String {
    message
        .get("room_id")
        .or_else(|| message.get("chat_room_id"))
        .or_else(|| message.get("from_user_id"))
        .map(json_id_string)
        .unwrap_or_default()
}

fn weixin_message_user_id(message: &serde_json::Value) -> String {
    message
        .get("from_user_id")
        .map(json_id_string)
        .unwrap_or_default()
}

fn weixin_message_text(message: &serde_json::Value) -> String {
    for item in message
        .get("item_list")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
    {
        let item_type = item
            .get("type")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        if item_type == 1 {
            if let Some(text) = item
                .get("text_item")
                .and_then(|value| value.get("text"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return text.to_string();
            }
        }
        if item_type == 3 {
            if let Some(text) = item
                .get("voice_item")
                .and_then(|value| value.get("text"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return text.to_string();
            }
        }
    }
    String::new()
}
