use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::{
    AppNotificationSummary, AppNotificationsResponse, CreateAppNotificationRequest,
};

pub fn list(db: &Db, limit: usize) -> anyhow::Result<AppNotificationsResponse> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(AppNotificationsResponse {
            items: Vec::new(),
            unread_count: 0,
        });
    };
    if !table_exists(&connection, "app_notifications")? {
        return Ok(AppNotificationsResponse {
            items: Vec::new(),
            unread_count: 0,
        });
    }
    let unread_count = connection.query_row(
        "select count(*) from app_notifications where read_at is null",
        [],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare("select id, event_type, severity, title, message, source_type, source_id, metadata, read_at, created_at from app_notifications order by created_at desc, id desc limit ?")?;
    let items = statement
        .query_map([limit as i64], |row| {
            let metadata: Option<String> = row.get(7)?;
            Ok(AppNotificationSummary {
                id: row.get(0)?,
                event_type: row.get(1)?,
                severity: row.get(2)?,
                title: row.get(3)?,
                message: row.get(4)?,
                source_type: row.get(5)?,
                source_id: row.get(6)?,
                metadata: metadata
                    .and_then(|value| serde_json::from_str(&value).ok())
                    .unwrap_or_else(|| serde_json::json!({})),
                read_at: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AppNotificationsResponse {
        items,
        unread_count,
    })
}

pub fn mark_read(db: &Db, all: bool, ids: &[String]) -> anyhow::Result<AppNotificationsResponse> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    let now = crate::api::common::timestamp();
    if all {
        connection.execute(
            "update app_notifications set read_at = coalesce(read_at, ?) where read_at is null",
            [&now],
        )?;
    } else {
        for id in ids.iter().take(100) {
            connection.execute(
                "update app_notifications set read_at = coalesce(read_at, ?) where id = ?",
                (&now, id),
            )?;
        }
    }
    drop(connection);
    list(db, 30)
}

pub fn clear(db: &Db) -> anyhow::Result<i64> {
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    Ok(connection.execute("delete from app_notifications", [])? as i64)
}

pub fn create(
    db: &Db,
    input: CreateAppNotificationRequest,
) -> anyhow::Result<AppNotificationSummary> {
    let event_type = input.event_type.trim();
    let title = input.title.trim();
    let message = input.message.trim();
    if event_type.is_empty() || title.is_empty() || message.is_empty() {
        anyhow::bail!("invalid_app_notification");
    }
    let severity = match input.severity.as_deref().unwrap_or("info") {
        "warning" => "warning",
        "error" => "error",
        "success" => "success",
        _ => "info",
    };
    let id = format!("app-notification-{}", random_hex(16));
    let created_at = crate::api::common::timestamp();
    let connection = db.open_read_write()?;
    ensure_schema(&connection)?;
    connection.execute(
        "insert into app_notifications (id, event_type, severity, title, message, source_type, source_id, metadata, read_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, null, ?)",
        (
            &id,
            event_type,
            severity,
            title,
            message,
            input.source_type.as_deref(),
            input.source_id.as_deref(),
            input
                .metadata
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?
                .unwrap_or_else(|| "{}".to_string()),
            &created_at,
        ),
    )?;
    Ok(list(db, 1)?
        .items
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| anyhow::anyhow!("app_notification_create_failed"))?)
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

fn ensure_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists app_notifications (
          id text primary key,
          event_type text not null,
          severity text not null,
          title text not null,
          message text not null,
          source_type text,
          source_id text,
          metadata text,
          read_at text,
          created_at text not null
        );
        create index if not exists app_notifications_created_idx on app_notifications(created_at desc, id desc);
        create index if not exists app_notifications_read_idx on app_notifications(read_at, created_at desc);
        ",
    )?;
    Ok(())
}

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
