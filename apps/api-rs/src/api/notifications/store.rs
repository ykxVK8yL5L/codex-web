use rusqlite::{params, OptionalExtension};

use crate::{api::common::PageResponse, db::Db};

use super::models::*;

const EVENT_TYPES: &[&str] = &[
    "task_completed",
    "task_failed",
    "task_interrupted",
    "needs_approval",
    "task_health_issue",
    "provider_check_failed",
    "backup_failed",
    "restore_failed",
    "auth_login",
];

pub fn settings(db: &Db) -> anyhow::Result<NotificationSettingsResponse> {
    Ok(NotificationSettingsResponse {
        channels: channels(db)?,
        accounts: accounts(db)?,
        recipients: recipients(db)?,
        rules: rules(db, 20)?.items,
        ephemeral_rules: ephemeral_rules(db, 20)?.items,
        recent_deliveries: deliveries(db, 20)?.items,
    })
}

pub fn channels(db: &Db) -> anyhow::Result<Vec<NotificationChannelDefinition>> {
    let mut items = builtin_channels();
    let Some(connection) = db.open_read_only()? else {
        return Ok(items);
    };
    if !table_exists(&connection, "notification_channels")? {
        return Ok(items);
    }
    let mut statement = connection.prepare("select id, name, kind, adapter, auth_type, description, method, url_template, headers_template, body_template, account_fields, builtin, created_at, updated_at from notification_channels order by updated_at desc, id desc")?;
    let custom = statement
        .query_map([], row_to_channel)?
        .collect::<Result<Vec<_>, _>>()?;
    items.extend(custom);
    Ok(items)
}

pub fn accounts(db: &Db) -> anyhow::Result<Vec<NotificationAccountSummary>> {
    accounts_with_secrets(db, false)
}

pub fn accounts_private(db: &Db) -> anyhow::Result<Vec<NotificationAccountSummary>> {
    accounts_with_secrets(db, true)
}

fn accounts_with_secrets(
    db: &Db,
    expose_secrets: bool,
) -> anyhow::Result<Vec<NotificationAccountSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "notification_accounts")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, name, channel_id, channel_kind, enabled, config, permissions, last_test_status, last_error, created_at, updated_at from notification_accounts order by updated_at desc, id desc")?;
    let mapper = if expose_secrets {
        row_to_account_private
    } else {
        row_to_account
    };
    let rows = statement
        .query_map([], mapper)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn account(db: &Db, id: &str) -> anyhow::Result<Option<NotificationAccountSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    get_account(&connection, id)
}

pub fn account_private(db: &Db, id: &str) -> anyhow::Result<Option<NotificationAccountSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    get_account_private(&connection, id)
}

pub fn recipients(db: &Db) -> anyhow::Result<Vec<NotificationRecipientSummary>> {
    sync_default_recipients(db)?;
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "notification_recipients")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at from notification_recipients order by updated_at desc, id desc")?;
    let rows = statement
        .query_map([], row_to_recipient)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn recipient(db: &Db, id: &str) -> anyhow::Result<Option<NotificationRecipientSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    get_recipient(&connection, id)
}

pub fn recipient_private(
    db: &Db,
    id: &str,
) -> anyhow::Result<Option<NotificationRecipientSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    get_recipient_private(&connection, id)
}

pub fn rules(db: &Db, limit: usize) -> anyhow::Result<PageResponse<NotificationRuleSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(empty_page());
    };
    if !table_exists(&connection, "notification_rules")? {
        return Ok(empty_page());
    }
    let mut statement = connection.prepare("select id, name, enabled, event_types, min_severity, targets, dedupe_minutes, created_at, updated_at from notification_rules order by updated_at desc, id desc limit ?")?;
    let limit_plus = (limit + 1) as i64;
    let rows = statement
        .query_map([limit_plus], row_to_rule)?
        .collect::<Result<Vec<_>, _>>()?;
    page(
        rows,
        limit,
        |item| item.updated_at.clone(),
        |item| item.id.clone(),
    )
}

pub fn ephemeral_rules(
    db: &Db,
    limit: usize,
) -> anyhow::Result<PageResponse<NotificationEphemeralRuleSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(empty_page());
    };
    if !table_exists(&connection, "notification_ephemeral_rules")? {
        return Ok(empty_page());
    }
    let mut statement = connection.prepare("select id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at, expires_at, triggered_at from notification_ephemeral_rules order by created_at desc, id desc limit ?")?;
    let limit_plus = (limit + 1) as i64;
    let rows = statement
        .query_map([limit_plus], row_to_ephemeral_rule)?
        .collect::<Result<Vec<_>, _>>()?;
    page(
        rows,
        limit,
        |item| item.created_at.clone(),
        |item| item.id.clone(),
    )
}

pub fn ephemeral_rules_for_scopes(
    db: &Db,
    scopes: &[(String, String)],
) -> anyhow::Result<Vec<NotificationEphemeralRuleSummary>> {
    if scopes.is_empty() {
        return Ok(Vec::new());
    }
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "notification_ephemeral_rules")? {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    let mut statement = connection.prepare("select id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at, expires_at, triggered_at from notification_ephemeral_rules where enabled = 1 and scope_type = ? and scope_id = ? order by created_at asc")?;
    for (scope_type, scope_id) in scopes {
        let rows = statement
            .query_map((scope_type, scope_id), row_to_ephemeral_rule)?
            .collect::<Result<Vec<_>, _>>()?;
        items.extend(rows);
    }
    Ok(items)
}

pub fn mark_ephemeral_rule_triggered(db: &Db, id: &str) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update notification_ephemeral_rules set enabled = 0, triggered_at = ? where id = ?",
        rusqlite::params![crate::api::common::timestamp(), id],
    )?;
    Ok(())
}

pub fn deliveries(
    db: &Db,
    limit: usize,
) -> anyhow::Result<PageResponse<NotificationDeliverySummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(empty_page());
    };
    if !table_exists(&connection, "notification_deliveries")? {
        return Ok(empty_page());
    }
    let mut statement = connection.prepare("select id, rule_id, account_id, event_type, severity, title, message, status, attempts, response_status, last_error, metadata, created_at, sent_at from notification_deliveries order by created_at desc, id desc limit ?")?;
    let limit_plus = (limit + 1) as i64;
    let rows = statement
        .query_map([limit_plus], row_to_delivery)?
        .collect::<Result<Vec<_>, _>>()?;
    page(
        rows,
        limit,
        |item| item.created_at.clone(),
        |item| item.id.clone(),
    )
}

pub fn create_channel(
    db: &Db,
    input: UpsertNotificationChannelRequest,
) -> anyhow::Result<NotificationChannelDefinition> {
    let name = input.name.as_deref().unwrap_or("").trim();
    let url_template = input.url_template.as_deref().unwrap_or("").trim();
    if name.is_empty() || url_template.is_empty() {
        anyhow::bail!("invalid_notification_channel");
    }
    let now = crate::api::common::timestamp();
    let id = format!("notification-channel-{}", random_hex(16));
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "insert into notification_channels (id, name, kind, adapter, auth_type, description, method, url_template, headers_template, body_template, account_fields, builtin, created_at, updated_at) values (?, ?, 'webhook', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        params![
            &id,
            name,
            sanitize_adapter(input.adapter.as_deref()),
            sanitize_auth_type(input.auth_type.as_deref()),
            input.description.unwrap_or_default(),
            input.method.unwrap_or_else(|| "POST".to_string()).trim().to_uppercase(),
            url_template,
            input.headers_template.unwrap_or_default(),
            input.body_template.unwrap_or_default(),
            serde_json::to_string(&input.account_fields.unwrap_or_default())?,
            &now,
            &now,
        ],
    )?;
    get_channel(&connection, &id)?
        .ok_or_else(|| anyhow::anyhow!("notification_channel_create_failed"))
}

pub fn update_channel(
    db: &Db,
    id: &str,
    input: UpsertNotificationChannelRequest,
) -> anyhow::Result<Option<NotificationChannelDefinition>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(mut channel) = get_channel(&connection, id)? else {
        return Ok(None);
    };
    if channel.builtin {
        return Ok(None);
    }
    if let Some(name) = input.name.and_then(clean_optional) {
        channel.name = name;
    }
    if let Some(value) = input.description {
        channel.description = value;
    }
    if input.adapter.is_some() {
        channel.adapter = sanitize_adapter(input.adapter.as_deref()).to_string();
    }
    if input.auth_type.is_some() {
        channel.auth_type = sanitize_auth_type(input.auth_type.as_deref()).to_string();
    }
    if let Some(method) = input.method.and_then(clean_optional) {
        channel.method = method.to_uppercase();
    }
    if let Some(url_template) = input.url_template.and_then(clean_optional) {
        channel.url_template = url_template;
    }
    if let Some(value) = input.headers_template {
        channel.headers_template = value;
    }
    if let Some(value) = input.body_template {
        channel.body_template = value;
    }
    if let Some(value) = input.account_fields {
        channel.account_fields = value.into_iter().filter_map(clean_optional).collect();
    }
    let now = crate::api::common::timestamp();
    connection.execute(
        "update notification_channels set name = ?, adapter = ?, auth_type = ?, description = ?, method = ?, url_template = ?, headers_template = ?, body_template = ?, account_fields = ?, updated_at = ? where id = ? and builtin = 0",
        params![
            &channel.name,
            &channel.adapter,
            &channel.auth_type,
            &channel.description,
            &channel.method,
            &channel.url_template,
            &channel.headers_template,
            &channel.body_template,
            serde_json::to_string(&channel.account_fields)?,
            &now,
            id,
        ],
    )?;
    get_channel(&connection, id)
}

pub fn delete_channel(db: &Db, id: &str) -> anyhow::Result<Option<&'static str>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    if in_use(&connection, id)? {
        return Ok(Some("notification_channel_in_use"));
    }
    let deleted = connection.execute(
        "delete from notification_channels where id = ? and builtin = 0",
        [id],
    )?;
    Ok(if deleted == 0 {
        Some("notification_channel_not_found")
    } else {
        None
    })
}

pub fn create_account(
    db: &Db,
    input: UpsertNotificationAccountRequest,
) -> anyhow::Result<NotificationAccountSummary> {
    let name = input.name.as_deref().unwrap_or("").trim();
    let selected_channel = resolve_channel(
        db,
        input.channel_id.as_deref(),
        input.channel_kind.as_deref(),
    )?;
    let channel_kind = selected_channel
        .as_ref()
        .map(|channel| channel.kind.clone())
        .unwrap_or_default();
    if name.is_empty() || channel_kind.is_empty() {
        anyhow::bail!("invalid_notification_account");
    }
    let now = crate::api::common::timestamp();
    let id = format!("notification-account-{}", random_hex(16));
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let config = if selected_channel
        .as_ref()
        .is_some_and(|channel| !channel.builtin)
    {
        input.config.unwrap_or_else(|| serde_json::json!({}))
    } else {
        sanitize_notification_config(&channel_kind, input.config, None)
    };
    connection.execute(
        "insert into notification_accounts (id, name, channel_id, channel_kind, enabled, config, permissions, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &id,
            name,
            selected_channel.as_ref().map(|channel| channel.id.clone()),
            &channel_kind,
            if input.enabled.unwrap_or(true) { 1 } else { 0 },
            serde_json::to_string(&config)?,
            serde_json::to_string(&sanitize_permissions(input.permissions))?,
            &now,
            &now,
        ],
    )?;
    get_account(&connection, &id)?
        .ok_or_else(|| anyhow::anyhow!("notification_account_create_failed"))
}

pub fn update_account(
    db: &Db,
    id: &str,
    input: UpsertNotificationAccountRequest,
) -> anyhow::Result<Option<NotificationAccountSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(current) = raw_account(&connection, id)? else {
        return Ok(None);
    };
    let name = input
        .name
        .and_then(clean_optional)
        .unwrap_or_else(|| current.name.clone());
    let requested_channel_id = input.channel_id.or(current.channel_id.clone());
    let selected_channel = resolve_channel(
        db,
        requested_channel_id.as_deref(),
        input
            .channel_kind
            .as_deref()
            .or(Some(&current.channel_kind)),
    )?;
    let channel_id = selected_channel
        .as_ref()
        .map(|channel| channel.id.clone())
        .or(requested_channel_id);
    let channel_kind = selected_channel
        .as_ref()
        .map(|channel| channel.kind.clone())
        .unwrap_or_else(|| current.channel_kind.clone());
    let enabled = input.enabled.unwrap_or(current.enabled);
    let config = if selected_channel
        .as_ref()
        .is_some_and(|channel| !channel.builtin)
    {
        merge_json(current.config, input.config)
    } else {
        sanitize_notification_config(&channel_kind, input.config, Some(&current.config))
    };
    let permissions = input.permissions.unwrap_or(current.permissions);
    let now = crate::api::common::timestamp();
    connection.execute(
        "update notification_accounts set name = ?, channel_id = ?, channel_kind = ?, enabled = ?, config = ?, permissions = ?, updated_at = ? where id = ?",
        params![name, channel_id, channel_kind, if enabled { 1 } else { 0 }, serde_json::to_string(&config)?, serde_json::to_string(&sanitize_permissions(Some(permissions)))?, now, id],
    )?;
    get_account(&connection, id)
}

pub fn delete_account(
    db: &Db,
    id: &str,
    delete_linked_recipients: bool,
) -> anyhow::Result<Option<Vec<String>>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let linked = linked_recipient_ids(&connection, id)?;
    let deleted = connection.execute("delete from notification_accounts where id = ?", [id])?;
    if deleted == 0 {
        return Ok(None);
    }
    if delete_linked_recipients {
        for recipient_id in &linked {
            let _ = connection.execute(
                "delete from notification_recipients where id = ?",
                [recipient_id],
            );
        }
        cleanup_targets_for_deleted_references(&connection, &[id.to_string()], &linked)?;
    }
    if !delete_linked_recipients {
        connection.execute("update notification_recipients set sender_account_id = null, updated_at = ? where sender_account_id = ?", params![crate::api::common::timestamp(), id])?;
        cleanup_targets_for_deleted_references(&connection, &[id.to_string()], &[])?;
    }
    Ok(Some(if delete_linked_recipients {
        linked
    } else {
        Vec::new()
    }))
}

pub fn create_recipient(
    db: &Db,
    input: UpsertNotificationRecipientRequest,
) -> anyhow::Result<NotificationRecipientSummary> {
    let name = input.name.as_deref().unwrap_or("").trim();
    let kind = sanitize_recipient_kind(input.kind.as_deref());
    if name.is_empty() || kind.is_empty() {
        anyhow::bail!("invalid_notification_recipient");
    }
    let now = crate::api::common::timestamp();
    let id = format!("notification-recipient-{}", random_hex(16));
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "insert into notification_recipients (id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![&id, name, kind, if input.enabled.unwrap_or(true) { 1 } else { 0 }, input.sender_account_id.and_then(clean_optional), input.channel_id.and_then(clean_optional), serde_json::to_string(&input.config.unwrap_or_else(|| serde_json::json!({})))?, serde_json::to_string(&sanitize_permissions(input.permissions))?, &now, &now],
    )?;
    get_recipient(&connection, &id)?
        .ok_or_else(|| anyhow::anyhow!("notification_recipient_create_failed"))
}

pub fn update_recipient(
    db: &Db,
    id: &str,
    input: UpsertNotificationRecipientRequest,
) -> anyhow::Result<Option<NotificationRecipientSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(current) = raw_recipient(&connection, id)? else {
        return Ok(None);
    };
    let name = input.name.and_then(clean_optional).unwrap_or(current.name);
    let kind = input
        .kind
        .as_deref()
        .map(|value| sanitize_recipient_kind(Some(value)))
        .filter(|value| !value.is_empty())
        .unwrap_or(current.kind.as_str())
        .to_string();
    let enabled = input.enabled.unwrap_or(current.enabled);
    let sender_account_id = input.sender_account_id.or(current.sender_account_id);
    let channel_id = input.channel_id.or(current.channel_id);
    let config = merge_json(current.config, input.config);
    let permissions = input.permissions.unwrap_or(current.permissions);
    let now = crate::api::common::timestamp();
    connection.execute(
        "update notification_recipients set name = ?, kind = ?, enabled = ?, sender_account_id = ?, channel_id = ?, config = ?, permissions = ?, updated_at = ? where id = ?",
        params![name, kind, if enabled { 1 } else { 0 }, sender_account_id, channel_id, serde_json::to_string(&config)?, serde_json::to_string(&sanitize_permissions(Some(permissions)))?, now, id],
    )?;
    get_recipient(&connection, id)
}

pub fn delete_recipient(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let deleted = connection.execute("delete from notification_recipients where id = ?", [id])?;
    if deleted > 0 {
        cleanup_targets(&connection, id)?;
    }
    Ok(deleted > 0)
}

pub fn create_rule(
    db: &Db,
    input: UpsertNotificationRuleRequest,
) -> anyhow::Result<NotificationRuleSummary> {
    let name = input.name.as_deref().unwrap_or("").trim();
    let event_types = sanitize_event_types(input.event_types);
    let targets = input.targets.unwrap_or_else(|| serde_json::json!([]));
    if name.is_empty()
        || event_types.is_empty()
        || !targets.as_array().is_some_and(|items| !items.is_empty())
    {
        anyhow::bail!("notification_rule_requires_events_and_targets");
    }
    let now = crate::api::common::timestamp();
    let id = format!("notification-rule-{}", random_hex(16));
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "insert into notification_rules (id, name, enabled, event_types, min_severity, targets, dedupe_minutes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![&id, name, if input.enabled.unwrap_or(true) { 1 } else { 0 }, serde_json::to_string(&event_types)?, sanitize_severity(input.min_severity.as_deref()), serde_json::to_string(&targets)?, input.dedupe_minutes.unwrap_or(0).max(0), &now, &now],
    )?;
    get_rule(&connection, &id)?.ok_or_else(|| anyhow::anyhow!("notification_rule_create_failed"))
}

pub fn update_rule(
    db: &Db,
    id: &str,
    input: UpsertNotificationRuleRequest,
) -> anyhow::Result<Option<NotificationRuleSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(current) = get_rule_raw(&connection, id)? else {
        return Ok(None);
    };
    let name = input.name.and_then(clean_optional).unwrap_or(current.name);
    let event_types = input
        .event_types
        .map(|value| sanitize_event_types(Some(value)))
        .unwrap_or(current.event_types);
    let targets = input.targets.unwrap_or(current.targets);
    if event_types.is_empty() || !targets.as_array().is_some_and(|items| !items.is_empty()) {
        anyhow::bail!("notification_rule_requires_events_and_targets");
    }
    let enabled = input.enabled.unwrap_or(current.enabled);
    let min_severity = input
        .min_severity
        .as_deref()
        .map(|value| sanitize_severity(Some(value)))
        .unwrap_or(current.min_severity.as_str())
        .to_string();
    let dedupe_minutes = input
        .dedupe_minutes
        .unwrap_or(current.dedupe_minutes)
        .max(0);
    let now = crate::api::common::timestamp();
    connection.execute(
        "update notification_rules set name = ?, enabled = ?, event_types = ?, min_severity = ?, targets = ?, dedupe_minutes = ?, updated_at = ? where id = ?",
        params![name, if enabled { 1 } else { 0 }, serde_json::to_string(&event_types)?, min_severity, serde_json::to_string(&targets)?, dedupe_minutes, now, id],
    )?;
    get_rule(&connection, id)
}

pub fn delete_rule(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute("delete from notification_rules where id = ?", [id])? > 0)
}

pub fn clear_rules(db: &Db) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let rules = connection.execute("delete from notification_rules", [])?;
    let ephemeral = connection.execute("delete from notification_ephemeral_rules", [])?;
    Ok((rules + ephemeral) as i64)
}

pub fn create_ephemeral_rule(
    db: &Db,
    input: UpsertNotificationEphemeralRuleRequest,
) -> anyhow::Result<NotificationEphemeralRuleSummary> {
    let scope_type = sanitize_scope_type_default_session(input.scope_type.as_deref()).to_string();
    let scope_id = input.scope_id.as_deref().unwrap_or("").trim().to_string();
    let event_types = sanitize_event_types(input.event_types);
    let targets = sanitize_targets(input.targets.unwrap_or_else(|| serde_json::json!([])));
    let expire_mode = sanitize_ephemeral_expire_mode(input.expire_mode.as_deref()).to_string();
    if scope_id.is_empty()
        || event_types.is_empty()
        || !targets.as_array().is_some_and(|items| !items.is_empty())
    {
        anyhow::bail!("invalid_notification_ephemeral_rule");
    }
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = crate::api::common::timestamp();
    if scope_type == "automation" {
        let existing: Option<String> = connection
            .query_row(
                "select id from notification_ephemeral_rules where scope_type = ? and scope_id = ? order by created_at desc, id desc limit 1",
                params![&scope_type, &scope_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing_id) = existing {
            connection.execute(
                "update notification_ephemeral_rules set event_types = ?, targets = ?, enabled = 1, expire_mode = ? where id = ?",
                params![serde_json::to_string(&event_types)?, serde_json::to_string(&targets)?, &expire_mode, &existing_id],
            )?;
            return get_ephemeral_rule(&connection, &existing_id)?
                .ok_or_else(|| anyhow::anyhow!("notification_ephemeral_rule_create_failed"));
        }
    }
    let id = format!("notification-ephemeral-{}", random_hex(16));
    connection.execute(
        "insert into notification_ephemeral_rules (id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at) values (?, ?, ?, ?, ?, 1, ?, ?)",
        params![&id, &scope_type, &scope_id, serde_json::to_string(&event_types)?, serde_json::to_string(&targets)?, &expire_mode, &now],
    )?;
    get_ephemeral_rule(&connection, &id)?
        .ok_or_else(|| anyhow::anyhow!("notification_ephemeral_rule_create_failed"))
}

pub fn update_ephemeral_rule(
    db: &Db,
    id: &str,
    input: UpsertNotificationEphemeralRuleRequest,
) -> anyhow::Result<Option<NotificationEphemeralRuleSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let Some(current) = get_ephemeral_rule(&connection, id)? else {
        return Ok(None);
    };
    let next_scope_type = match input.scope_type.as_deref() {
        Some("task") => "task".to_string(),
        Some("room_task") => "room_task".to_string(),
        Some("automation") => "automation".to_string(),
        _ => current.scope_type.clone(),
    };
    let next_scope_id = input
        .scope_id
        .unwrap_or(current.scope_id)
        .trim()
        .to_string();
    let next_event_types = input
        .event_types
        .map(|value| sanitize_event_types(Some(value)))
        .unwrap_or(current.event_types);
    let next_targets = sanitize_targets(input.targets.unwrap_or(current.targets));
    let next_expire_mode = match input.expire_mode.as_deref() {
        Some("session_end") => "session_end".to_string(),
        Some("manual") => "manual".to_string(),
        Some("after_trigger") => "after_trigger".to_string(),
        _ => current.expire_mode.clone(),
    };
    if next_scope_id.is_empty()
        || next_event_types.is_empty()
        || !next_targets
            .as_array()
            .is_some_and(|items| !items.is_empty())
    {
        anyhow::bail!("invalid_notification_ephemeral_rule");
    }
    let enabled = input.enabled.unwrap_or(current.enabled);
    connection.execute(
        "update notification_ephemeral_rules set scope_type = ?, scope_id = ?, event_types = ?, targets = ?, enabled = ?, expire_mode = ? where id = ?",
        params![next_scope_type, next_scope_id, serde_json::to_string(&next_event_types)?, serde_json::to_string(&next_targets)?, if enabled { 1 } else { 0 }, next_expire_mode, id],
    )?;
    get_ephemeral_rule(&connection, id)
}

pub fn delete_ephemeral_rule(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute(
        "delete from notification_ephemeral_rules where id = ?",
        [id],
    )? > 0)
}

pub fn delivery(db: &Db, id: &str) -> anyhow::Result<Option<NotificationDeliverySummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    get_delivery(&connection, id)
}

pub fn notification_recently_delivered(
    db: &Db,
    rule_id: &str,
    account_id: &str,
    event_type: &str,
    dedupe_minutes: i64,
) -> anyhow::Result<bool> {
    if dedupe_minutes <= 0 {
        return Ok(false);
    }
    let Some(connection) = db.open_read_only()? else {
        return Ok(false);
    };
    if !table_exists(&connection, "notification_deliveries")? {
        return Ok(false);
    }
    let since = (time::OffsetDateTime::now_utc() - time::Duration::minutes(dedupe_minutes))
        .format(&time::format_description::well_known::Rfc3339)?;
    Ok(connection
        .query_row(
            "select 1 from notification_deliveries where rule_id = ? and account_id = ? and event_type = ? and created_at >= ? and status in ('sent', 'pending') limit 1",
            rusqlite::params![rule_id, account_id, event_type, since],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Returns the weixin account row (kind == "weixin") or None.
pub fn weixin_account(db: &Db, id: &str) -> anyhow::Result<Option<NotificationAccountSummary>> {
    Ok(account(db, id)?.filter(|account| account.channel_kind == "weixin"))
}

pub fn platform_overview(db: &Db, host: &str) -> anyhow::Result<PlatformSettingsResponse> {
    let accounts = accounts(db)?;
    let routes = platform_route_summaries(db)?;
    let webhook_routes = webhook_routes(db, host)?;
    let platform_kinds = [
        "telegram", "email", "webhook", "bark", "weixin", "wecom", "dingtalk", "feishu", "qq",
    ];
    let platforms = platform_kinds
        .iter()
        .map(|&kind| {
            let matched: Vec<&NotificationAccountSummary> = accounts
                .iter()
                .filter(|account| platform_account_matches_kind(account, kind))
                .collect();
            let route_enabled = if kind == "webhook" {
                webhook_routes.iter().any(|route| route.enabled)
            } else {
                matched.iter().any(|account| account.enabled)
            };
            let connected_route_count = if kind == "webhook" {
                webhook_routes.len() as i64
            } else if ["telegram", "weixin", "wecom", "dingtalk", "feishu", "qq"].contains(&kind) {
                routes.iter().filter(|route| route.kind == kind).count() as i64
            } else {
                0
            };
            PlatformSummary {
                id: kind.to_string(),
                kind: kind.to_string(),
                label: platform_label(kind).to_string(),
                description: platform_description(kind).to_string(),
                enabled: route_enabled,
                builtin: true,
                channel_id: Some(kind.to_string()),
                account_count: matched.len() as i64,
                connected_route_count,
                baseline_capabilities: platform_baseline_capabilities(),
                supported_capabilities: platform_support_map(kind),
                notes: Some(platform_notes(kind).to_string()),
            }
        })
        .collect();
    Ok(PlatformSettingsResponse {
        baseline_capabilities: platform_baseline_capabilities(),
        capability_labels: platform_capability_labels(),
        platforms,
        routes,
        webhook_routes,
    })
}

fn platform_account_matches_kind(account: &NotificationAccountSummary, kind: &str) -> bool {
    match kind {
        "telegram" | "email" | "bark" | "weixin" | "wecom" | "dingtalk" | "feishu" | "qq"
        | "webhook" => account.channel_kind == kind,
        _ => account.channel_id.as_deref() == Some(kind),
    }
}

fn platform_route_summaries(db: &Db) -> anyhow::Result<Vec<PlatformRouteSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    let sessions: std::collections::HashMap<String, (Option<String>, Option<String>)> =
        if table_exists(&connection, "sessions")? {
            let mut statement =
                connection.prepare("select id, title, conversation_type from sessions")?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        (
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ),
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter().collect()
        } else {
            std::collections::HashMap::new()
        };
    let route_tables: &[(&str, &str)] = &[
        ("telegram", "telegram_chat_routes"),
        ("weixin", "weixin_chat_routes"),
        ("wecom", "wecom_chat_routes"),
        ("email", "email_chat_routes"),
        ("feishu", "feishu_chat_routes"),
        ("qq", "qq_chat_routes"),
    ];
    let mut summaries = Vec::new();
    for (kind, table) in route_tables {
        if !table_exists(&connection, table)? {
            continue;
        }
        let mut statement = connection.prepare(&format!("select account_id, chat_id, session_id, updated_at from {table} order by updated_at desc, chat_id asc"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (account_id, chat_id, session_id, updated_at) in rows {
            if account_id.is_empty() || chat_id.is_empty() || session_id.is_empty() {
                continue;
            }
            let session = sessions.get(&session_id);
            summaries.push(PlatformRouteSummary {
                id: format!("{kind}:{account_id}:{chat_id}"),
                kind: kind.to_string(),
                account_id,
                chat_id,
                session_title: session
                    .and_then(|(title, _)| title.clone())
                    .unwrap_or_else(|| session_id.clone()),
                session_conversation_type: session
                    .and_then(|(_, conversation)| conversation.clone()),
                session_id,
                updated_at,
            });
        }
    }
    Ok(summaries)
}

fn webhook_routes(db: &Db, host: &str) -> anyhow::Result<Vec<WebhookRouteSummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "webhook_routes")? {
        return Ok(Vec::new());
    }
    let sessions: std::collections::HashMap<String, Option<String>> =
        if table_exists(&connection, "sessions")? {
            let mut statement = connection.prepare("select id, title from sessions")?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter().collect()
        } else {
            std::collections::HashMap::new()
        };
    let public_base_url = if host.starts_with("0.0.0.0") || host == "127.0.0.1" || host == "::1" {
        "http://localhost:5173".to_string()
    } else {
        format!("http://{host}:5173")
    };
    let mut statement = connection.prepare("select id, route_key, name, enabled, secret, session_id, prompt_template, created_at, updated_at from webhook_routes order by updated_at desc, id desc")?;
    let rows = statement
        .query_map([], |row| {
            let route_key: String = row.get(1)?;
            let secret: Option<String> = row.get(4)?;
            let secret = secret.unwrap_or_default();
            let session_id: Option<String> = row.get(5)?;
            let prompt_template: Option<String> = row.get(6)?;
            let prompt_template = prompt_template.unwrap_or_default();
            Ok((
                row.get::<_, String>(0)?,
                route_key,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3).unwrap_or(0) != 0,
                secret,
                session_id,
                prompt_template,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(id, route_key, name, enabled, secret, session_id, prompt_template, created_at, updated_at)| {
            let session_title = session_id.as_ref().and_then(|sid| sessions.get(sid).cloned().flatten());
            WebhookRouteSummary {
                curl_example: format!("curl \"{public_base_url}/api/webhook/{route_key}?command=sessions\" -H \"X-Webhook-Token: {secret}\""),
                id,
                route_key,
                name,
                enabled,
                secret,
                session_id,
                session_title,
                command_template: prompt_template.clone(),
                prompt_template,
                created_at,
                updated_at,
            }
        })
        .collect())
}

fn platform_baseline_capabilities() -> Vec<String> {
    [
        "inbound_messages",
        "outbound_messages",
        "session_binding",
        "session_selection",
        "reply_routing",
        "working_status",
        "command_menu",
        "file_browse",
        "terminal",
    ]
    .iter()
    .map(|item| item.to_string())
    .collect()
}

fn platform_capability_labels() -> serde_json::Value {
    serde_json::json!({
        "inbound_messages": "Inbound messages",
        "outbound_messages": "Outbound messages",
        "session_binding": "Session binding",
        "session_selection": "Session selection",
        "reply_routing": "Reply routing",
        "working_status": "Working status",
        "command_menu": "Command menu",
        "file_browse": "File browsing",
        "terminal": "Terminal"
    })
}

fn platform_support_map(kind: &str) -> Vec<String> {
    let caps: &[&str] = match kind {
        "telegram" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "session_selection",
            "reply_routing",
            "working_status",
            "command_menu",
            "file_browse",
            "terminal",
        ],
        "email" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "reply_routing",
        ],
        "webhook" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "reply_routing",
        ],
        "bark" => &["outbound_messages"],
        "weixin" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "session_selection",
            "reply_routing",
            "working_status",
        ],
        "wecom" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "session_selection",
            "reply_routing",
            "working_status",
        ],
        "dingtalk" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "reply_routing",
        ],
        "feishu" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "session_selection",
            "reply_routing",
            "command_menu",
        ],
        "qq" => &[
            "inbound_messages",
            "outbound_messages",
            "session_binding",
            "session_selection",
            "reply_routing",
            "working_status",
        ],
        _ => &[],
    };
    caps.iter().map(|item| item.to_string()).collect()
}

fn platform_label(kind: &str) -> &'static str {
    match kind {
        "weixin" => "Weixin Bot",
        "dingtalk" => "DingTalk Bot",
        "wecom" => "WeCom AI Bot",
        "feishu" => "Feishu / Lark Bot",
        "qq" => "QQ Bot",
        "bark" => "Bark",
        "email" => "Email SMTP",
        "webhook" => "Webhook",
        _ => "Telegram Bot",
    }
}

fn platform_description(kind: &str) -> &'static str {
    match kind {
        "telegram" => "Full interactive baseline with bind/send/session browsing and live replies.",
        "email" => "IMAP inbound plus SMTP outbound bridge with sender-to-session routing.",
        "webhook" => "Inbound webhook routes that can create or reuse Codex sessions.",
        "bark" => "iOS push delivery through Bark-compatible endpoints.",
        "weixin" => "Personal Weixin bridge with session binding and reply routing.",
        "wecom" => "WeCom AI bot bridge with session binding and reply routing.",
        "dingtalk" => "DingTalk robot bridge with signed webhook delivery.",
        "feishu" => "Feishu/Lark long-connection bot with session binding and reply routing.",
        "qq" => "QQ Bot bridge with session binding and reply routing.",
        _ => "",
    }
}

fn platform_notes(kind: &str) -> &'static str {
    match kind {
        "telegram" => "This is the reference platform. All other platforms are compared against this contract.",
        "weixin" => "Personal Weixin bridge with session binding and reply routing.",
        "wecom" => "WeCom AI Bot bridge with session binding and reply routing.",
        "qq" => "QQ Bot bridge with session binding and reply routing.",
        "dingtalk" => "DingTalk robot sender with signed delivery.",
        "feishu" => "Feishu long-connection bot with inbound reply routing.",
        "email" => "IMAP inbound polling plus SMTP outbound replies with per-sender routing.",
        "webhook" => "Each route accepts HTTP POSTs, validates a shared secret, and forwards the payload into a Codex session.",
        _ => "Outbound-only notification bridge.",
    }
}

fn sanitize_targets(value: serde_json::Value) -> serde_json::Value {
    let Some(items) = value.as_array() else {
        return serde_json::json!([]);
    };
    let cleaned = items
        .iter()
        .filter_map(|target| {
            let account_id = target
                .get("accountId")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let recipient_id = target
                .get("recipientId")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if account_id.is_none() && recipient_id.is_none() {
                return None;
            }
            let mut object = serde_json::Map::new();
            if let Some(account_id) = account_id {
                object.insert(
                    "accountId".to_string(),
                    serde_json::Value::String(account_id.to_string()),
                );
            }
            if let Some(recipient_id) = recipient_id {
                object.insert(
                    "recipientId".to_string(),
                    serde_json::Value::String(recipient_id.to_string()),
                );
            }
            if let Some(sender) = target
                .get("senderAccountId")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                object.insert(
                    "senderAccountId".to_string(),
                    serde_json::Value::String(sender.to_string()),
                );
            }
            if let Some(chat_id) = target
                .get("chatId")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                object.insert(
                    "chatId".to_string(),
                    serde_json::Value::String(chat_id.to_string()),
                );
            }
            if let Some(email_to) = target.get("emailTo").and_then(|value| value.as_array()) {
                let emails = email_to
                    .iter()
                    .filter_map(|item| {
                        item.as_str()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(|value| serde_json::Value::String(value.to_string()))
                    })
                    .collect::<Vec<_>>();
                object.insert("emailTo".to_string(), serde_json::Value::Array(emails));
            }
            Some(serde_json::Value::Object(object))
        })
        .collect::<Vec<_>>();
    serde_json::Value::Array(cleaned)
}

fn get_ephemeral_rule(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationEphemeralRuleSummary>> {
    Ok(connection
        .query_row(
            "select id, scope_type, scope_id, event_types, targets, enabled, expire_mode, created_at, expires_at, triggered_at from notification_ephemeral_rules where id = ?",
            [id],
            row_to_ephemeral_rule,
        )
        .optional()?)
}

fn sanitize_scope_type_default_session(value: Option<&str>) -> &'static str {
    match value {
        Some("task") => "task",
        Some("room_task") => "room_task",
        Some("automation") => "automation",
        _ => "session",
    }
}

fn sanitize_ephemeral_expire_mode(value: Option<&str>) -> &'static str {
    match value {
        Some("session_end") => "session_end",
        Some("manual") => "manual",
        _ => "after_trigger",
    }
}

pub fn clear_deliveries(db: &Db) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute("delete from notification_deliveries", [])? as i64)
}

pub fn delete_delivery(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute("delete from notification_deliveries where id = ?", [id])? > 0)
}

pub fn create_delivery(
    db: &Db,
    rule_id: Option<&str>,
    account_id: Option<&str>,
    event_type: &str,
    severity: &str,
    title: &str,
    message: &str,
    metadata: serde_json::Value,
) -> anyhow::Result<NotificationDeliverySummary> {
    let now = crate::api::common::timestamp();
    let id = format!("notification-delivery-{}", random_hex(16));
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "insert into notification_deliveries (id, rule_id, account_id, event_type, severity, title, message, status, attempts, metadata, created_at) values (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
        params![&id, rule_id, account_id, event_type, sanitize_severity(Some(severity)), title, message, serde_json::to_string(&metadata)?, &now],
    )?;
    get_delivery(&connection, &id)?
        .ok_or_else(|| anyhow::anyhow!("notification_delivery_create_failed"))
}

pub fn finish_delivery(
    db: &Db,
    id: &str,
    ok: bool,
    response_status: Option<i64>,
    error: Option<&str>,
) -> anyhow::Result<Option<NotificationDeliverySummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update notification_deliveries set status = ?, attempts = attempts + 1, response_status = ?, last_error = ?, sent_at = ? where id = ?",
        params![if ok { "sent" } else { "failed" }, response_status, error, if ok { Some(crate::api::common::timestamp()) } else { None }, id],
    )?;
    get_delivery(&connection, id)
}

pub fn set_account_test_status(
    db: &Db,
    id: &str,
    ok: bool,
    error: Option<&str>,
) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "update notification_accounts set last_test_status = ?, last_error = ?, updated_at = ? where id = ?",
        params![if ok { "sent" } else { "failed" }, error, crate::api::common::timestamp(), id],
    )?;
    Ok(())
}

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists notification_channels (
          id text primary key,
          name text not null,
          kind text not null,
          adapter text not null,
          auth_type text not null default 'none',
          description text not null default '',
          method text not null default 'POST',
          url_template text not null default '',
          headers_template text not null default '',
          body_template text not null default '',
          account_fields text not null default '[]',
          builtin integer not null default 0,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists notification_accounts (
          id text primary key,
          name text not null,
          channel_id text,
          channel_kind text not null,
          enabled integer not null default 1,
          config text not null default '{}',
          permissions text not null default '{}',
          last_test_status text,
          last_error text,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists notification_recipients (
          id text primary key,
          name text not null,
          kind text not null,
          enabled integer not null default 1,
          sender_account_id text,
          channel_id text,
          config text not null default '{}',
          permissions text not null default '{}',
          created_at text not null,
          updated_at text not null
        );
        create table if not exists notification_rules (
          id text primary key,
          name text not null,
          enabled integer not null default 1,
          event_types text not null,
          min_severity text not null default 'info',
          targets text not null,
          dedupe_minutes integer not null default 0,
          created_at text not null,
          updated_at text not null
        );
        create table if not exists notification_ephemeral_rules (
          id text primary key,
          scope_type text not null,
          scope_id text not null,
          event_types text not null,
          targets text not null,
          enabled integer not null default 1,
          expire_mode text not null default 'manual',
          created_at text not null,
          expires_at text,
          triggered_at text
        );
        create table if not exists notification_deliveries (
          id text primary key,
          rule_id text,
          account_id text,
          event_type text not null,
          severity text not null,
          title text not null,
          message text not null,
          status text not null,
          attempts integer not null default 0,
          response_status integer,
          last_error text,
          metadata text not null default '{}',
          created_at text not null,
          sent_at text
        );
        create table if not exists telegram_chat_routes (
          account_id text not null,
          chat_id text not null,
          session_id text not null,
          updated_at text not null,
          primary key (account_id, chat_id)
        );
        create table if not exists weixin_chat_routes (
          account_id text not null,
          chat_id text not null,
          session_id text not null,
          context_token text,
          updated_at text not null,
          primary key (account_id, chat_id)
        );
        create table if not exists wecom_chat_routes (
          account_id text not null,
          chat_id text not null,
          session_id text not null,
          updated_at text not null,
          primary key (account_id, chat_id)
        );
        create table if not exists email_chat_routes (
          account_id text not null,
          chat_id text not null,
          session_id text not null,
          subject text,
          inbound_message_id text,
          last_message_id text,
          updated_at text not null,
          primary key (account_id, chat_id)
        );
        create table if not exists feishu_chat_routes (
          account_id text not null,
          chat_id text not null,
          session_id text not null,
          updated_at text not null,
          primary key (account_id, chat_id)
        );
        create table if not exists qq_chat_routes (
          account_id text not null,
          chat_id text not null,
          session_id text not null,
          updated_at text not null,
          primary key (account_id, chat_id)
        );
        ",
    )?;
    let _ = connection.execute(
        "alter table weixin_chat_routes add column context_token text",
        [],
    );
    let _ = connection.execute("alter table email_chat_routes add column subject text", []);
    let _ = connection.execute(
        "alter table email_chat_routes add column inbound_message_id text",
        [],
    );
    let _ = connection.execute(
        "alter table email_chat_routes add column last_message_id text",
        [],
    );
    Ok(())
}

pub fn ensure_runtime_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    ensure_schema(connection)
}

fn builtin_channels() -> Vec<NotificationChannelDefinition> {
    vec![
        builtin_webhook(
            "webhook",
            "Webhook",
            "Send a JSON or templated HTTP request.",
            r#"{"title":"{{title}}","message":"{{message}}","severity":"{{severity}}","eventType":"{{eventType}}","sourceType":"{{sourceType}}","sourceId":"{{sourceId}}"}"#,
            &["url"],
        ),
        builtin_webhook(
            "bark",
            "Bark",
            "Send iOS push notifications through a Bark-compatible webhook endpoint.",
            r#"{"device_key":"{{deviceKey}}","title":"{{title}}","body":"{{message}}","group":"{{group}}","sound":"{{sound}}","icon":"{{icon}}","url":"{{url}}"}"#,
            &["serverUrl", "deviceKey", "group", "sound", "icon", "url"],
        ),
        builtin_webhook(
            "weixin-webhook",
            "Weixin Bot",
            "Send notifications to a Weixin-compatible webhook bridge.",
            r#"{"msgtype":"text","text":{"content":"{{title}}\n\n{{message}}"}}"#,
            &["url"],
        ),
        builtin_webhook(
            "wecom",
            "WeCom AI Bot",
            "Send notifications to a WeCom AI Bot webhook.",
            r#"{"msgtype":"text","text":{"content":"{{title}}\n\n{{message}}"}}"#,
            &["url"],
        ),
        builtin_webhook(
            "feishu",
            "Feishu / Lark Bot",
            "Send notifications to a Feishu or Lark bot webhook.",
            r#"{"msg_type":"text","content":{"text":"{{title}}\n\n{{message}}"}}"#,
            &["url"],
        ),
        builtin_channel(
            "wecom-bot",
            "wecom",
            "wecom",
            "WeCom AI Bot",
            "Send WeCom AI Bot messages through an AI Bot gateway.",
            &[
                "botId",
                "secret",
                "websocketUrl",
                "dmPolicy",
                "allowFrom",
                "groupPolicy",
                "groupAllowFrom",
                "defaultSessionId",
                "testChatId",
                "language",
            ],
        ),
        builtin_channel(
            "qq-bot",
            "qq",
            "qq",
            "QQ Bot",
            "Send QQ Bot notifications through an app ID, client secret, and target ID.",
            &["appId", "clientSecret", "targetType", "targetId"],
        ),
        builtin_channel(
            "email",
            "email",
            "email",
            "Email SMTP",
            "Send email through an SMTP sender account.",
            &["host", "port", "username", "password", "fromEmail"],
        ),
        builtin_channel(
            "telegram",
            "telegram",
            "telegram",
            "Telegram Bot",
            "Send Telegram messages through a bot token.",
            &["botToken", "proxyUrl"],
        ),
        builtin_channel(
            "weixin",
            "weixin",
            "weixin",
            "Weixin Bot",
            "Send personal Weixin messages through iLink Bot.",
            &["botToken", "baseUrl"],
        ),
        builtin_channel(
            "dingtalk",
            "dingtalk",
            "dingtalk",
            "DingTalk Bot",
            "Send DingTalk robot messages through a bot token and secret.",
            &["botToken", "botSecret", "baseUrl"],
        ),
        builtin_channel(
            "feishu-bot",
            "feishu",
            "feishu",
            "Feishu Bot",
            "Send Feishu messages through an app ID and app secret.",
            &["appId", "appSecret", "domain", "testChatId"],
        ),
    ]
}

fn builtin_webhook(
    id: &str,
    name: &str,
    description: &str,
    body_template: &str,
    fields: &[&str],
) -> NotificationChannelDefinition {
    NotificationChannelDefinition {
        id: id.to_string(),
        kind: "webhook".to_string(),
        adapter: "webhook".to_string(),
        auth_type: "none".to_string(),
        name: name.to_string(),
        description: description.to_string(),
        builtin: true,
        method: "POST".to_string(),
        url_template: "{{url}}".to_string(),
        headers_template: String::new(),
        body_template: body_template.to_string(),
        account_fields: fields.iter().map(|item| item.to_string()).collect(),
        created_at: None,
        updated_at: None,
    }
}

fn builtin_channel(
    id: &str,
    kind: &str,
    adapter: &str,
    name: &str,
    description: &str,
    fields: &[&str],
) -> NotificationChannelDefinition {
    NotificationChannelDefinition {
        id: id.to_string(),
        kind: kind.to_string(),
        adapter: adapter.to_string(),
        auth_type: "none".to_string(),
        name: name.to_string(),
        description: description.to_string(),
        builtin: true,
        method: "POST".to_string(),
        url_template: String::new(),
        headers_template: String::new(),
        body_template: String::new(),
        account_fields: fields.iter().map(|item| item.to_string()).collect(),
        created_at: None,
        updated_at: None,
    }
}

fn row_to_channel(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationChannelDefinition> {
    Ok(NotificationChannelDefinition {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        adapter: row.get(3)?,
        auth_type: row.get(4)?,
        description: row.get(5)?,
        method: row.get(6)?,
        url_template: row.get(7)?,
        headers_template: row.get(8)?,
        body_template: row.get(9)?,
        account_fields: json_string_array(row.get::<_, Option<String>>(10)?.as_deref()),
        builtin: row.get::<_, i64>(11).unwrap_or(0) != 0,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationAccountSummary> {
    row_to_account_with_secrets(row, false)
}

fn row_to_account_private(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationAccountSummary> {
    row_to_account_with_secrets(row, true)
}

fn row_to_account_with_secrets(
    row: &rusqlite::Row<'_>,
    expose_secrets: bool,
) -> rusqlite::Result<NotificationAccountSummary> {
    let kind: String = row.get(3)?;
    let config = json_value(
        row.get::<_, Option<String>>(5)?.as_deref(),
        serde_json::json!({}),
    );
    Ok(NotificationAccountSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        channel_id: row.get(2)?,
        channel_kind: kind.clone(),
        enabled: row.get::<_, i64>(4).unwrap_or(1) != 0,
        config: if expose_secrets {
            config
        } else {
            public_config(&kind, config)
        },
        permissions: sanitize_permissions(
            row.get::<_, Option<String>>(6)?
                .and_then(|value| serde_json::from_str(&value).ok()),
        ),
        last_test_status: row.get(7)?,
        last_error: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn row_to_recipient(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationRecipientSummary> {
    row_to_recipient_with_secrets(row, false)
}

fn row_to_recipient_private(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<NotificationRecipientSummary> {
    row_to_recipient_with_secrets(row, true)
}

fn row_to_recipient_with_secrets(
    row: &rusqlite::Row<'_>,
    expose_secrets: bool,
) -> rusqlite::Result<NotificationRecipientSummary> {
    let kind = sanitize_recipient_kind(Some(row.get::<_, String>(2)?.as_str())).to_string();
    let config = json_value(
        row.get::<_, Option<String>>(6)?.as_deref(),
        serde_json::json!({}),
    );
    Ok(NotificationRecipientSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: kind.clone(),
        enabled: row.get::<_, i64>(3).unwrap_or(1) != 0,
        sender_account_id: row.get(4)?,
        channel_id: row.get(5)?,
        config: if expose_secrets {
            config
        } else {
            public_config(&kind, config)
        },
        permissions: sanitize_permissions(
            row.get::<_, Option<String>>(7)?
                .and_then(|value| serde_json::from_str(&value).ok()),
        ),
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn row_to_rule(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationRuleSummary> {
    Ok(NotificationRuleSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        enabled: row.get::<_, i64>(2).unwrap_or(1) != 0,
        event_types: sanitize_event_types(Some(json_string_array(
            row.get::<_, Option<String>>(3)?.as_deref(),
        ))),
        min_severity: sanitize_severity(row.get::<_, Option<String>>(4)?.as_deref()).to_string(),
        targets: json_value(
            row.get::<_, Option<String>>(5)?.as_deref(),
            serde_json::json!([]),
        ),
        dedupe_minutes: row.get::<_, Option<i64>>(6)?.unwrap_or(0).max(0),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_delivery(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationDeliverySummary> {
    Ok(NotificationDeliverySummary {
        id: row.get(0)?,
        rule_id: row.get(1)?,
        account_id: row.get(2)?,
        event_type: row.get(3)?,
        severity: sanitize_severity(row.get::<_, Option<String>>(4)?.as_deref()).to_string(),
        title: row.get(5)?,
        message: row.get(6)?,
        status: sanitize_delivery_status(row.get::<_, Option<String>>(7)?.as_deref()).to_string(),
        attempts: row.get::<_, Option<i64>>(8)?.unwrap_or(0),
        response_status: row.get(9)?,
        last_error: row.get(10)?,
        metadata: json_value(
            row.get::<_, Option<String>>(11)?.as_deref(),
            serde_json::json!({}),
        ),
        created_at: row.get(12)?,
        sent_at: row.get(13)?,
    })
}

fn row_to_ephemeral_rule(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<NotificationEphemeralRuleSummary> {
    Ok(NotificationEphemeralRuleSummary {
        id: row.get(0)?,
        scope_type: sanitize_scope_type(row.get::<_, Option<String>>(1)?.as_deref()).to_string(),
        scope_id: row.get(2)?,
        event_types: sanitize_event_types(Some(json_string_array(
            row.get::<_, Option<String>>(3)?.as_deref(),
        ))),
        targets: json_value(
            row.get::<_, Option<String>>(4)?.as_deref(),
            serde_json::json!([]),
        ),
        enabled: row.get::<_, i64>(5).unwrap_or(1) != 0,
        expire_mode: sanitize_expire_mode(row.get::<_, Option<String>>(6)?.as_deref()).to_string(),
        created_at: row.get(7)?,
        expires_at: row.get(8)?,
        triggered_at: row.get(9)?,
    })
}

struct RawAccount {
    name: String,
    channel_id: Option<String>,
    channel_kind: String,
    enabled: bool,
    config: serde_json::Value,
    permissions: serde_json::Value,
}

struct RawRecipient {
    name: String,
    kind: String,
    enabled: bool,
    sender_account_id: Option<String>,
    channel_id: Option<String>,
    config: serde_json::Value,
    permissions: serde_json::Value,
}

struct RawRule {
    name: String,
    enabled: bool,
    event_types: Vec<String>,
    min_severity: String,
    targets: serde_json::Value,
    dedupe_minutes: i64,
}

fn get_channel(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationChannelDefinition>> {
    if let Some(channel) = builtin_channels().into_iter().find(|item| item.id == id) {
        return Ok(Some(channel));
    }
    Ok(connection.query_row("select id, name, kind, adapter, auth_type, description, method, url_template, headers_template, body_template, account_fields, builtin, created_at, updated_at from notification_channels where id = ?", [id], row_to_channel).optional()?)
}

fn get_account(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationAccountSummary>> {
    Ok(connection.query_row("select id, name, channel_id, channel_kind, enabled, config, permissions, last_test_status, last_error, created_at, updated_at from notification_accounts where id = ?", [id], row_to_account).optional()?)
}

fn get_account_private(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationAccountSummary>> {
    Ok(connection.query_row("select id, name, channel_id, channel_kind, enabled, config, permissions, last_test_status, last_error, created_at, updated_at from notification_accounts where id = ?", [id], row_to_account_private).optional()?)
}

fn get_recipient(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationRecipientSummary>> {
    Ok(connection.query_row("select id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at from notification_recipients where id = ?", [id], row_to_recipient).optional()?)
}

fn get_recipient_private(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationRecipientSummary>> {
    Ok(connection.query_row("select id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at from notification_recipients where id = ?", [id], row_to_recipient_private).optional()?)
}

fn get_delivery(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationDeliverySummary>> {
    Ok(connection.query_row("select id, rule_id, account_id, event_type, severity, title, message, status, attempts, response_status, last_error, metadata, created_at, sent_at from notification_deliveries where id = ?", [id], row_to_delivery).optional()?)
}

fn get_rule(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<NotificationRuleSummary>> {
    Ok(connection.query_row("select id, name, enabled, event_types, min_severity, targets, dedupe_minutes, created_at, updated_at from notification_rules where id = ?", [id], row_to_rule).optional()?)
}

fn raw_account(connection: &rusqlite::Connection, id: &str) -> anyhow::Result<Option<RawAccount>> {
    connection
        .query_row("select name, channel_id, channel_kind, enabled, config, permissions from notification_accounts where id = ?", [id], |row| {
            Ok(RawAccount {
                name: row.get(0)?,
                channel_id: row.get(1)?,
                channel_kind: row.get(2)?,
                enabled: row.get::<_, i64>(3).unwrap_or(1) != 0,
                config: json_value(row.get::<_, Option<String>>(4)?.as_deref(), serde_json::json!({})),
                permissions: json_value(row.get::<_, Option<String>>(5)?.as_deref(), serde_json::json!({})),
            })
        })
        .optional()
        .map_err(Into::into)
}

fn raw_recipient(
    connection: &rusqlite::Connection,
    id: &str,
) -> anyhow::Result<Option<RawRecipient>> {
    connection
        .query_row("select name, kind, enabled, sender_account_id, channel_id, config, permissions from notification_recipients where id = ?", [id], |row| {
            Ok(RawRecipient {
                name: row.get(0)?,
                kind: row.get(1)?,
                enabled: row.get::<_, i64>(2).unwrap_or(1) != 0,
                sender_account_id: row.get(3)?,
                channel_id: row.get(4)?,
                config: json_value(row.get::<_, Option<String>>(5)?.as_deref(), serde_json::json!({})),
                permissions: json_value(row.get::<_, Option<String>>(6)?.as_deref(), serde_json::json!({})),
            })
        })
        .optional()
        .map_err(Into::into)
}

fn get_rule_raw(connection: &rusqlite::Connection, id: &str) -> anyhow::Result<Option<RawRule>> {
    connection
        .query_row("select name, enabled, event_types, min_severity, targets, dedupe_minutes from notification_rules where id = ?", [id], |row| {
            Ok(RawRule {
                name: row.get(0)?,
                enabled: row.get::<_, i64>(1).unwrap_or(1) != 0,
                event_types: sanitize_event_types(Some(json_string_array(row.get::<_, Option<String>>(2)?.as_deref()))),
                min_severity: sanitize_severity(row.get::<_, Option<String>>(3)?.as_deref()).to_string(),
                targets: json_value(row.get::<_, Option<String>>(4)?.as_deref(), serde_json::json!([])),
                dedupe_minutes: row.get::<_, Option<i64>>(5)?.unwrap_or(0).max(0),
            })
        })
        .optional()
        .map_err(Into::into)
}

fn resolve_channel(
    db: &Db,
    channel_id: Option<&str>,
    channel_kind: Option<&str>,
) -> anyhow::Result<Option<NotificationChannelDefinition>> {
    let items = channels(db)?;
    if let Some(channel_id) = channel_id.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(channel) = items.iter().find(|item| item.id == channel_id) {
            return Ok(Some(channel.clone()));
        }
    }
    let kind = sanitize_channel_kind(channel_kind);
    if kind.is_empty() {
        return Ok(None);
    }
    Ok(items.into_iter().find(|item| item.kind == kind))
}

fn sanitize_notification_config(
    kind: &str,
    input: Option<serde_json::Value>,
    previous: Option<&serde_json::Value>,
) -> serde_json::Value {
    let config = input.unwrap_or_else(|| serde_json::json!({}));
    let previous = previous.unwrap_or(&serde_json::Value::Null);
    let string = |key: &str, default: &str| {
        json_text(&config, &[key])
            .or_else(|| json_text(previous, &[key]))
            .unwrap_or_else(|| default.to_string())
    };
    let secret = |keys: &[&str]| {
        let next = json_text(&config, keys).unwrap_or_default();
        if !next.is_empty() && next != "********" {
            next
        } else {
            json_text(previous, keys).unwrap_or_default()
        }
    };
    let number = |key: &str, default: i64| {
        config
            .get(key)
            .and_then(|value| value.as_i64())
            .or_else(|| previous.get(key).and_then(|value| value.as_i64()))
            .filter(|value| *value > 0)
            .unwrap_or(default)
    };
    let bool_value = |key: &str| {
        config
            .get(key)
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    };
    let language = || {
        if string("language", "zh-CN") == "en-US" {
            "en-US"
        } else {
            "zh-CN"
        }
    };

    match kind {
        "email" => {
            let host = string("host", "");
            let username = string("username", "");
            let imap_host = json_text(&config, &["imapHost"])
                .or_else(|| json_text(previous, &["imapHost"]))
                .unwrap_or_else(|| host.clone());
            let imap_username = json_text(&config, &["imapUsername"])
                .or_else(|| json_text(previous, &["imapUsername"]))
                .unwrap_or_else(|| username.clone());
            let imap_password = {
                let next = json_text(&config, &["imapPassword"]).unwrap_or_default();
                if !next.is_empty() && next != "********" {
                    next
                } else {
                    json_text(previous, &["imapPassword", "password"]).unwrap_or_default()
                }
            };
            let inbound_mailbox = {
                let value = string("inboundMailbox", "INBOX");
                if value.is_empty() {
                    "INBOX".to_string()
                } else {
                    value
                }
            };
            serde_json::json!({
            "host": host,
            "port": number("port", 587),
            "secure": bool_value("secure"),
            "username": username,
            "password": secret(&["password"]),
            "fromName": string("fromName", "Codex Web"),
            "fromEmail": string("fromEmail", ""),
            "testEmailTo": json_list(config.get("testEmailTo").or_else(|| previous.get("testEmailTo"))),
            "inboundEnabled": bool_value("inboundEnabled"),
            "imapHost": imap_host,
            "imapPort": number("imapPort", 993),
            "imapSecure": config.get("imapSecure").and_then(|value| value.as_bool()).unwrap_or_else(|| number("imapPort", 993) == 993),
            "imapUsername": imap_username,
            "imapPassword": imap_password,
            "inboundMailbox": inbound_mailbox,
            "allowedSenderEmails": json_list(config.get("allowedSenderEmails").or_else(|| previous.get("allowedSenderEmails"))),
            "defaultSessionId": string("defaultSessionId", ""),
            })
        }
        "telegram" => serde_json::json!({
            "botToken": secret(&["botToken"]),
            "proxyUrl": string("proxyUrl", ""),
            "language": language(),
            "inboundEnabled": bool_value("inboundEnabled"),
            "intents": config.get("intents").cloned().or_else(|| previous.get("intents").cloned()).unwrap_or(serde_json::Value::Null),
            "allowedChatIds": json_list(config.get("allowedChatIds").or_else(|| previous.get("allowedChatIds"))),
            "allowedUserIds": json_list(config.get("allowedUserIds").or_else(|| previous.get("allowedUserIds"))),
            "defaultSessionId": string("defaultSessionId", ""),
            "testChatId": string("testChatId", ""),
        }),
        "weixin" => serde_json::json!({
            "botToken": secret(&["botToken"]),
            "baseUrl": string("baseUrl", "https://ilinkai.weixin.qq.com"),
            "accountId": string("accountId", ""),
            "userId": string("userId", ""),
            "language": language(),
            "inboundEnabled": bool_value("inboundEnabled"),
            "allowedChatIds": json_list(config.get("allowedChatIds").or_else(|| previous.get("allowedChatIds"))),
            "allowedUserIds": json_list(config.get("allowedUserIds").or_else(|| previous.get("allowedUserIds"))),
            "defaultSessionId": string("defaultSessionId", ""),
            "testChatId": string("testChatId", ""),
        }),
        "wecom" => serde_json::json!({
            "botId": string("botId", ""),
            "secret": secret(&["secret", "botSecret"]),
            "websocketUrl": json_text(&config, &["websocketUrl", "websocket_url"]).or_else(|| json_text(previous, &["websocketUrl", "websocket_url"])).unwrap_or_else(|| "wss://openws.work.weixin.qq.com".to_string()),
            "dmPolicy": string("dmPolicy", "open").to_lowercase(),
            "allowFrom": json_list(config.get("allowFrom").or_else(|| config.get("allow_from")).or_else(|| previous.get("allowFrom")).or_else(|| previous.get("allow_from"))),
            "groupPolicy": string("groupPolicy", "open").to_lowercase(),
            "groupAllowFrom": json_list(config.get("groupAllowFrom").or_else(|| config.get("group_allow_from")).or_else(|| previous.get("groupAllowFrom")).or_else(|| previous.get("group_allow_from"))),
            "inboundEnabled": bool_value("inboundEnabled"),
            "defaultSessionId": string("defaultSessionId", ""),
            "testChatId": string("testChatId", ""),
            "language": language(),
        }),
        "qq" => serde_json::json!({
            "appId": string("appId", ""),
            "clientSecret": secret(&["clientSecret", "appSecret"]),
            "targetType": string("targetType", "user").to_lowercase(),
            "targetId": json_text(&config, &["targetId", "openId"]).or_else(|| json_text(previous, &["targetId", "openId"])).unwrap_or_default(),
            "testTargetType": json_text_preserve_empty(&config, &["testTargetType"]).or_else(|| json_text(previous, &["testTargetType"])).unwrap_or_default().to_lowercase(),
            "testTargetId": json_text_preserve_empty(&config, &["testTargetId", "testChatId"]).or_else(|| json_text(previous, &["testTargetId", "testChatId", "targetId", "openId"])).unwrap_or_default(),
            "language": language(),
            "inboundEnabled": bool_value("inboundEnabled"),
            "allowedChatIds": json_list(config.get("allowedChatIds").or_else(|| previous.get("allowedChatIds"))),
            "allowedUserIds": json_list(config.get("allowedUserIds").or_else(|| previous.get("allowedUserIds"))),
            "defaultSessionId": string("defaultSessionId", ""),
            "testChatId": json_text_preserve_empty(&config, &["testChatId", "testTargetId"]).or_else(|| json_text(previous, &["testChatId", "testTargetId", "targetId", "openId"])).unwrap_or_default(),
        }),
        "dingtalk" => serde_json::json!({
            "botToken": secret(&["botToken", "accessToken", "token"]),
            "botSecret": secret(&["botSecret", "secret"]),
            "baseUrl": string("baseUrl", "https://oapi.dingtalk.com/robot/send"),
            "language": language(),
        }),
        "feishu" => serde_json::json!({
            "appId": string("appId", ""),
            "appSecret": secret(&["appSecret"]),
            "domain": string("domain", "feishu"),
            "connectionMode": string("connectionMode", "websocket"),
            "language": language(),
            "testChatId": string("testChatId", ""),
            "encryptKey": string("encryptKey", ""),
            "verificationToken": string("verificationToken", ""),
            "defaultSessionId": string("defaultSessionId", ""),
            "allowedChatIds": json_list(config.get("allowedChatIds").or_else(|| previous.get("allowedChatIds"))),
            "allowedUserIds": json_list(config.get("allowedUserIds").or_else(|| previous.get("allowedUserIds"))),
            "inboundEnabled": bool_value("inboundEnabled"),
        }),
        "bark" => serde_json::json!({
            "serverUrl": string("serverUrl", "https://api.day.app"),
            "deviceKey": secret(&["deviceKey"]),
            "sound": string("sound", ""),
            "group": string("group", "Codex Web"),
            "icon": string("icon", ""),
            "url": string("url", ""),
        }),
        _ => serde_json::json!({
            "url": string("url", ""),
            "method": string("method", "POST").to_uppercase(),
            "headers": config.get("headers").filter(|value| value.is_object()).cloned().or_else(|| previous.get("headers").filter(|value| value.is_object()).cloned()).unwrap_or_else(|| serde_json::json!({})),
            "bodyTemplate": string("bodyTemplate", ""),
        }),
    }
}

fn json_text(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn json_text_preserve_empty(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|item| item.as_str())
            .map(str::trim)
            .map(ToOwned::to_owned)
    })
}

fn json_list(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
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
        Some(value) if !value.is_null() => value
            .to_string()
            .split(',')
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

fn linked_recipient_ids(
    connection: &rusqlite::Connection,
    account_id: &str,
) -> anyhow::Result<Vec<String>> {
    if !table_exists(connection, "notification_recipients")? {
        return Ok(Vec::new());
    }
    let mut statement =
        connection.prepare("select id from notification_recipients where sender_account_id = ?")?;
    let rows = statement
        .query_map([account_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn in_use(connection: &rusqlite::Connection, channel_id: &str) -> anyhow::Result<bool> {
    Ok(table_exists(connection, "notification_accounts")?
        && connection
            .query_row(
                "select id from notification_accounts where channel_id = ? limit 1",
                [channel_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        || table_exists(connection, "notification_recipients")?
            && connection
                .query_row(
                    "select id from notification_recipients where channel_id = ? limit 1",
                    [channel_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some())
}

fn cleanup_targets(connection: &rusqlite::Connection, recipient_id: &str) -> anyhow::Result<()> {
    for table in ["notification_rules", "notification_ephemeral_rules"] {
        if !table_exists(connection, table)? {
            continue;
        }
        let mut rows = connection.prepare(&format!("select id, targets from {table}"))?;
        let values = rows
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, targets) in values {
            let mut parsed = json_value(Some(&targets), serde_json::json!([]));
            if let Some(items) = parsed.as_array_mut() {
                items.retain(|item| {
                    item.get("recipientId").and_then(|value| value.as_str()) != Some(recipient_id)
                });
                let _ = connection.execute(
                    &format!("update {table} set targets = ? where id = ?"),
                    params![serde_json::to_string(items)?, id],
                );
            }
        }
    }
    Ok(())
}

fn cleanup_targets_for_deleted_references(
    connection: &rusqlite::Connection,
    account_ids: &[String],
    recipient_ids: &[String],
) -> anyhow::Result<()> {
    let account_ids = account_ids
        .iter()
        .map(|item| item.as_str())
        .collect::<std::collections::HashSet<_>>();
    let recipient_ids = recipient_ids
        .iter()
        .map(|item| item.as_str())
        .collect::<std::collections::HashSet<_>>();
    for table in ["notification_rules", "notification_ephemeral_rules"] {
        if !table_exists(connection, table)? {
            continue;
        }
        let mut rows = connection.prepare(&format!("select id, targets from {table}"))?;
        let values = rows
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, targets) in values {
            let cleaned = sanitize_targets(json_value(Some(&targets), serde_json::json!([])));
            let next_items = cleaned
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|mut target| {
                    let account_deleted = target
                        .get("accountId")
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| account_ids.contains(value));
                    let recipient_deleted = target
                        .get("recipientId")
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| recipient_ids.contains(value));
                    if account_deleted || recipient_deleted {
                        return None;
                    }
                    if let Some(sender) = target
                        .get("senderAccountId")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned)
                    {
                        if account_ids.contains(sender.as_str()) {
                            if let Some(object) = target.as_object_mut() {
                                object.remove("senderAccountId");
                            }
                        }
                    }
                    Some(target)
                })
                .collect::<Vec<_>>();
            if next_items.is_empty() {
                let _ = connection.execute(&format!("delete from {table} where id = ?"), [id]);
            } else {
                let sql = if table == "notification_rules" {
                    format!("update {table} set targets = ?, updated_at = ? where id = ?")
                } else {
                    format!("update {table} set targets = ? where id = ?")
                };
                if table == "notification_rules" {
                    let _ = connection.execute(
                        &sql,
                        params![
                            serde_json::to_string(&next_items)?,
                            crate::api::common::timestamp(),
                            id
                        ],
                    );
                } else {
                    let _ =
                        connection.execute(&sql, params![serde_json::to_string(&next_items)?, id]);
                }
            }
        }
    }
    Ok(())
}

fn sync_default_recipients(db: &Db) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let accounts = accounts_private(db)?
        .into_iter()
        .filter(|account| {
            account.enabled
                && matches!(
                    account.channel_kind.as_str(),
                    "email" | "telegram" | "weixin" | "wecom" | "qq"
                )
        })
        .collect::<Vec<_>>();
    if accounts.is_empty() {
        return Ok(());
    }
    let existing = if table_exists(&connection, "notification_recipients")? {
        let mut statement =
            connection.prepare("select kind, sender_account_id from notification_recipients")?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        Vec::new()
    };
    let existing = existing
        .into_iter()
        .map(|(kind, account_id)| format!("{kind}:{account_id}"))
        .collect::<std::collections::HashSet<_>>();
    let now = crate::api::common::timestamp();
    for account in accounts {
        let key = format!("{}:{}", account.channel_kind, account.id);
        if existing.contains(&key) {
            continue;
        }
        let Some(config) = default_recipient_config(&account) else {
            continue;
        };
        let suffix = if notification_language(&account.config) == "en-US" {
            "recipient"
        } else {
            "接收者"
        };
        let id = format!("notification-recipient-{}", random_hex(16));
        connection.execute(
            "insert into notification_recipients (id, name, kind, enabled, sender_account_id, channel_id, config, permissions, created_at, updated_at) values (?, ?, ?, 1, ?, null, ?, '{}', ?, ?)",
            params![id, format!("{} {}", account.name, suffix), account.channel_kind, account.id, serde_json::to_string(&config)?, now, now],
        )?;
    }
    Ok(())
}

fn default_recipient_config(account: &NotificationAccountSummary) -> Option<serde_json::Value> {
    match account.channel_kind.as_str() {
        "email" => json_text(&account.config, &["fromEmail"])
            .map(|email| serde_json::json!({ "email": email })),
        "telegram" => json_text(&account.config, &["testChatId"])
            .map(|chat_id| serde_json::json!({ "chatId": chat_id })),
        "weixin" => json_text(&account.config, &["testChatId", "userId", "accountId"])
            .map(|chat_id| serde_json::json!({ "chatId": chat_id })),
        "wecom" => json_text(&account.config, &["testChatId"])
            .map(|chat_id| serde_json::json!({ "chatId": chat_id })),
        "qq" => json_text(
            &account.config,
            &["testChatId", "testTargetId", "targetId", "openId"],
        )
        .map(|chat_id| serde_json::json!({ "chatId": chat_id })),
        _ => None,
    }
}

fn notification_language(config: &serde_json::Value) -> &'static str {
    if json_text(config, &["language"]).as_deref() == Some("en-US") {
        "en-US"
    } else {
        "zh-CN"
    }
}

fn page<T>(
    rows: Vec<T>,
    limit: usize,
    sort_value: impl Fn(&T) -> String,
    id_value: impl Fn(&T) -> String,
) -> anyhow::Result<PageResponse<T>> {
    let has_more = rows.len() > limit;
    let items = rows.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = if has_more {
        items
            .last()
            .map(|item| format!("{}:{}", sort_value(item), id_value(item)))
    } else {
        None
    };
    Ok(PageResponse {
        items,
        next_cursor,
        has_more,
    })
}

fn empty_page<T>() -> PageResponse<T> {
    PageResponse {
        items: Vec::new(),
        next_cursor: None,
        has_more: false,
    }
}

fn table_exists(connection: &rusqlite::Connection, table: &str) -> anyhow::Result<bool> {
    Ok(connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn json_value(value: Option<&str>, fallback: serde_json::Value) -> serde_json::Value {
    value
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or(fallback)
}

fn json_string_array(value: Option<&str>) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value.unwrap_or("[]")).unwrap_or_default()
}

fn merge_json(current: serde_json::Value, next: Option<serde_json::Value>) -> serde_json::Value {
    let Some(next) = next else {
        return current;
    };
    merge_secret_aware_json(current, next)
}

fn merge_secret_aware_json(
    current: serde_json::Value,
    next: serde_json::Value,
) -> serde_json::Value {
    match (current, next) {
        (serde_json::Value::Object(mut current), serde_json::Value::Object(next)) => {
            for (key, value) in next {
                let keep_existing_secret = value.as_str().is_some_and(|text| text == "********")
                    && is_secret_config_key(&key);
                if keep_existing_secret {
                    continue;
                }
                let merged = match (current.remove(&key), value) {
                    (Some(current_value), next_value) if key == "headers" => {
                        merge_secret_aware_json(current_value, next_value)
                    }
                    (_, next_value) => next_value,
                };
                current.insert(key, merged);
            }
            serde_json::Value::Object(current)
        }
        (_, next) => next,
    }
}

fn is_secret_config_key(key: &str) -> bool {
    matches!(
        key,
        "password"
            | "imapPassword"
            | "deviceKey"
            | "token"
            | "secret"
            | "botToken"
            | "botSecret"
            | "corpSecret"
            | "accessToken"
            | "bearerToken"
            | "appSecret"
            | "clientSecret"
            | "encryptKey"
            | "verificationToken"
    ) || key.to_lowercase().contains("authorization")
        || key.to_lowercase().contains("token")
        || key.to_lowercase().contains("secret")
        || key.to_lowercase().contains("key")
}

fn public_config(kind: &str, config: serde_json::Value) -> serde_json::Value {
    let mut config = config;
    if let Some(object) = config.as_object_mut() {
        for key in [
            "password",
            "imapPassword",
            "deviceKey",
            "token",
            "secret",
            "botToken",
            "botSecret",
            "corpSecret",
            "accessToken",
            "bearerToken",
            "appSecret",
            "clientSecret",
            "encryptKey",
            "verificationToken",
        ] {
            if object.get(key).is_some_and(|value| {
                !value.is_null() && !value.as_str().is_some_and(|text| text.is_empty())
            }) {
                object.insert(
                    key.to_string(),
                    serde_json::Value::String("********".to_string()),
                );
            }
        }
        if kind == "webhook" {
            if let Some(headers) = object
                .get_mut("headers")
                .and_then(|value| value.as_object_mut())
            {
                for (key, value) in headers.iter_mut() {
                    if key.to_lowercase().contains("authorization")
                        || key.to_lowercase().contains("token")
                        || key.to_lowercase().contains("secret")
                        || key.to_lowercase().contains("key")
                    {
                        if !value.is_null() {
                            *value = serde_json::Value::String("********".to_string());
                        }
                    }
                }
            }
        }
    }
    config
}

fn sanitize_permissions(input: Option<serde_json::Value>) -> serde_json::Value {
    let input = input.unwrap_or_else(|| serde_json::json!({}));
    let list = |key: &str| {
        input
            .get(key)
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    serde_json::json!({
        "allowedAgentIds": list("allowedAgentIds"),
        "allowedRoomIds": list("allowedRoomIds"),
        "allowedProjectIds": list("allowedProjectIds")
    })
}

fn sanitize_event_types(input: Option<Vec<String>>) -> Vec<String> {
    let mut items = input
        .unwrap_or_default()
        .into_iter()
        .filter(|item| EVENT_TYPES.contains(&item.as_str()))
        .collect::<Vec<_>>();
    items.sort();
    items.dedup();
    items
}

fn sanitize_severity(value: Option<&str>) -> &'static str {
    match value {
        Some("success") => "success",
        Some("warning") => "warning",
        Some("error") => "error",
        _ => "info",
    }
}

fn sanitize_delivery_status(value: Option<&str>) -> &'static str {
    match value {
        Some("sent") => "sent",
        Some("failed") => "failed",
        Some("skipped") => "skipped",
        _ => "pending",
    }
}

fn sanitize_scope_type(value: Option<&str>) -> &'static str {
    match value {
        Some("task") => "task",
        Some("room_task") => "room_task",
        Some("automation") => "automation",
        _ => "session",
    }
}

fn sanitize_expire_mode(value: Option<&str>) -> &'static str {
    match value {
        Some("session_end") => "session_end",
        Some("after_trigger") => "after_trigger",
        _ => "manual",
    }
}

fn sanitize_adapter(value: Option<&str>) -> &'static str {
    if value == Some("authenticated_webhook") {
        "authenticated_webhook"
    } else {
        "webhook"
    }
}

fn sanitize_auth_type(value: Option<&str>) -> &'static str {
    match value {
        Some("bearer") => "bearer",
        Some("query_token") => "query_token",
        Some("token_request") => "token_request",
        _ => "none",
    }
}

fn sanitize_channel_kind(value: Option<&str>) -> &'static str {
    match value {
        Some("bark") => "bark",
        Some("email") => "email",
        Some("telegram") => "telegram",
        Some("weixin") => "weixin",
        Some("wecom") => "wecom",
        Some("dingtalk") => "dingtalk",
        Some("feishu") => "feishu",
        Some("qq") => "qq",
        Some("webhook") => "webhook",
        _ => "",
    }
}

fn sanitize_recipient_kind(value: Option<&str>) -> &'static str {
    sanitize_channel_kind(value)
}

fn clean_optional(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn update_account_config(
    db: &Db,
    id: &str,
    config: serde_json::Value,
) -> anyhow::Result<Option<NotificationAccountSummary>> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let updated_at = crate::api::common::timestamp();
    let changed = connection.execute(
        "update notification_accounts set config = ?, updated_at = ? where id = ?",
        (serde_json::to_string(&config)?, &updated_at, id),
    )?;
    if changed == 0 {
        return Ok(None);
    }
    drop(connection);
    account(db, id)
}
