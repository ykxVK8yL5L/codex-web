use rand::RngCore;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::Db;

#[derive(Clone)]
pub struct ApiKeyRecord {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub key_preview: String,
    pub permissions: Vec<String>,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeySummary {
    pub id: String,
    pub name: String,
    pub permissions: Vec<String>,
    pub key_preview: String,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyDetailResponse {
    #[serde(flatten)]
    pub summary: ApiKeySummary,
    pub key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyInput {
    pub name: String,
    pub permissions: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyPermissionsResponse {
    pub groups: Vec<ApiKeyPermissionGroup>,
    pub presets: Vec<ApiKeyPreset>,
}

#[derive(Serialize)]
pub struct ApiKeyPermissionGroup {
    pub id: &'static str,
    pub label: &'static str,
    pub permissions: Vec<ApiKeyPermissionItem>,
}

#[derive(Serialize)]
pub struct ApiKeyPermissionItem {
    pub id: &'static str,
    pub label: &'static str,
}

#[derive(Serialize)]
pub struct ApiKeyPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub permissions: Vec<&'static str>,
}

pub fn permissions_response() -> ApiKeyPermissionsResponse {
    let groups = permission_groups();
    let all_permissions = groups
        .iter()
        .flat_map(|group| group.permissions.iter().map(|permission| permission.id))
        .collect::<Vec<_>>();
    ApiKeyPermissionsResponse {
        presets: vec![
            ApiKeyPreset {
                id: "read-only",
                label: "Read only",
                permissions: all_permissions
                    .iter()
                    .copied()
                    .filter(|id| id.ends_with(".read"))
                    .collect(),
            },
            ApiKeyPreset {
                id: "automation-runner",
                label: "Automation runner",
                permissions: vec![
                    "automations.read",
                    "automations.run",
                    "sessions.read",
                    "sessions.run",
                    "rooms.read",
                    "rooms.run",
                    "goals.read",
                    "goals.run",
                    "projects.read",
                    "previews.read",
                ],
            },
            ApiKeyPreset {
                id: "environment-restore",
                label: "Environment restore",
                permissions: vec!["environment.read", "environment.restore", "settings.read"],
            },
            ApiKeyPreset {
                id: "project-ops",
                label: "Project ops",
                permissions: vec![
                    "projects.read",
                    "projects.manage",
                    "projects.git",
                    "files.read",
                    "files.write",
                    "previews.read",
                    "previews.manage",
                    "terminal.exec",
                ],
            },
            ApiKeyPreset {
                id: "full-access",
                label: "Full access",
                permissions: all_permissions,
            },
        ],
        groups,
    }
}

pub fn list_api_keys(db: &Db) -> anyhow::Result<Vec<ApiKeySummary>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "api_keys")? {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, name, key_hash, key_preview, permissions, last_used_at, revoked_at, created_at, updated_at from api_keys order by created_at desc")?;
    let items = statement
        .query_map([], row_to_record)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items.into_iter().map(public_key).collect())
}

pub fn create_api_key(db: &Db, input: ApiKeyInput) -> anyhow::Result<ApiKeyDetailResponse> {
    let name = input.name.trim();
    let permissions = sanitize_permissions(input.permissions);
    if name.is_empty() || permissions.is_empty() {
        anyhow::bail!("invalid_api_key");
    }
    let secret = format!("cwk_{}", random_base64_url(24));
    let now = crate::api::common::timestamp();
    let record = ApiKeyRecord {
        id: format!("key-{}", random_hex(16)),
        name: name.to_string(),
        key_hash: hash_token(&secret),
        key_preview: format!("{}...{}", &secret[..10], &secret[secret.len() - 4..]),
        permissions,
        last_used_at: None,
        revoked_at: None,
        created_at: now.clone(),
        updated_at: now,
    };
    let connection = db.open_read_write()?;
    ensure_api_key_schema(&connection)?;
    connection.execute(
        "insert into api_keys (id, name, key_hash, key_preview, permissions, last_used_at, revoked_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            &record.id,
            &record.name,
            &record.key_hash,
            &record.key_preview,
            serde_json::to_string(&record.permissions)?,
            record.last_used_at.as_deref(),
            record.revoked_at.as_deref(),
            &record.created_at,
            &record.updated_at,
        ),
    )?;
    Ok(ApiKeyDetailResponse {
        summary: public_key(record),
        key: secret,
    })
}

pub fn update_api_key(
    db: &Db,
    id: &str,
    input: ApiKeyInput,
) -> anyhow::Result<Option<ApiKeySummary>> {
    let name = input.name.trim();
    let permissions = sanitize_permissions(input.permissions);
    if name.is_empty() || permissions.is_empty() {
        anyhow::bail!("invalid_api_key");
    }
    let connection = db.open_read_write()?;
    ensure_api_key_schema(&connection)?;
    let updated_at = crate::api::common::timestamp();
    let changed = connection.execute(
        "update api_keys set name = ?, permissions = ?, updated_at = ? where id = ?",
        (name, serde_json::to_string(&permissions)?, &updated_at, id),
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_record(&connection, id).map(|item| item.map(public_key))
}

pub fn revoke_api_key(db: &Db, id: &str) -> anyhow::Result<Option<ApiKeySummary>> {
    let connection = db.open_read_write()?;
    ensure_api_key_schema(&connection)?;
    let now = crate::api::common::timestamp();
    connection.execute(
        "update api_keys set revoked_at = ?, updated_at = ? where id = ? and revoked_at is null",
        (&now, &now, id),
    )?;
    get_record(&connection, id).map(|item| item.map(public_key))
}

pub fn delete_revoked_api_key(db: &Db, id: &str) -> anyhow::Result<Option<ApiKeySummary>> {
    let connection = db.open_read_write()?;
    ensure_api_key_schema(&connection)?;
    let Some(record) = get_record(&connection, id)? else {
        return Ok(None);
    };
    if record.revoked_at.is_none() {
        anyhow::bail!("api_key_not_revoked");
    }
    connection.execute("delete from api_keys where id = ?", [id])?;
    Ok(Some(public_key(record)))
}

#[allow(dead_code)]
pub fn find_api_key_by_token(db: &Db, token: &str) -> anyhow::Result<Option<ApiKeyRecord>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "api_keys")? {
        return Ok(None);
    }
    connection
        .query_row(
            "select id, name, key_hash, key_preview, permissions, last_used_at, revoked_at, created_at, updated_at from api_keys where key_hash = ? and revoked_at is null",
            [hash_token(token)],
            row_to_record,
        )
        .optional()
        .map_err(Into::into)
}

#[allow(dead_code)]
pub fn touch_last_used(db: &Db, id: &str) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_api_key_schema(&connection)?;
    let now = crate::api::common::timestamp();
    connection.execute(
        "update api_keys set last_used_at = ?, updated_at = ? where id = ?",
        (&now, &now, id),
    )?;
    Ok(())
}

fn get_record(connection: &rusqlite::Connection, id: &str) -> anyhow::Result<Option<ApiKeyRecord>> {
    connection
        .query_row(
            "select id, name, key_hash, key_preview, permissions, last_used_at, revoked_at, created_at, updated_at from api_keys where id = ?",
            [id],
            row_to_record,
        )
        .optional()
        .map_err(Into::into)
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApiKeyRecord> {
    let permissions: String = row.get(4)?;
    Ok(ApiKeyRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        key_hash: row.get(2)?,
        key_preview: row.get(3)?,
        permissions: parse_permissions(&permissions),
        last_used_at: row.get(5)?,
        revoked_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn public_key(record: ApiKeyRecord) -> ApiKeySummary {
    ApiKeySummary {
        id: record.id,
        name: record.name,
        permissions: record.permissions,
        key_preview: record.key_preview,
        last_used_at: record.last_used_at,
        revoked_at: record.revoked_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn ensure_api_key_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists api_keys (
          id text primary key,
          name text not null,
          key_hash text not null,
          key_preview text not null,
          permissions text not null,
          last_used_at text,
          revoked_at text,
          created_at text not null,
          updated_at text not null
        );
        create unique index if not exists api_keys_key_hash_idx on api_keys(key_hash);
        ",
    )?;
    Ok(())
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

fn parse_permissions(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value)
        .map(sanitize_permissions)
        .unwrap_or_default()
}

fn sanitize_permissions(values: Vec<String>) -> Vec<String> {
    let allowed = permission_set();
    let mut items = values
        .into_iter()
        .filter(|item| allowed.contains(item.as_str()))
        .collect::<Vec<_>>();
    items.sort();
    items.dedup();
    items
}

fn permission_set() -> std::collections::HashSet<&'static str> {
    permission_groups()
        .into_iter()
        .flat_map(|group| {
            group
                .permissions
                .into_iter()
                .map(|permission| permission.id)
        })
        .collect()
}

fn permission_groups() -> Vec<ApiKeyPermissionGroup> {
    vec![
        group(
            "sessions",
            "Sessions",
            &[
                ("sessions.read", "Read"),
                ("sessions.manage", "Manage"),
                ("sessions.run", "Run"),
            ],
        ),
        group(
            "rooms",
            "Rooms",
            &[
                ("rooms.read", "Read"),
                ("rooms.manage", "Manage"),
                ("rooms.run", "Run"),
            ],
        ),
        group(
            "agents",
            "Agents",
            &[("agents.read", "Read"), ("agents.manage", "Manage")],
        ),
        group(
            "automations",
            "Automations",
            &[
                ("automations.read", "Read"),
                ("automations.manage", "Manage"),
                ("automations.run", "Run"),
            ],
        ),
        group(
            "goals",
            "Goals",
            &[
                ("goals.read", "Read"),
                ("goals.manage", "Manage"),
                ("goals.run", "Run"),
            ],
        ),
        group(
            "projects",
            "Projects",
            &[
                ("projects.read", "Read"),
                ("projects.manage", "Manage"),
                ("projects.git", "Git actions"),
            ],
        ),
        group(
            "previews",
            "Previews",
            &[("previews.read", "Read"), ("previews.manage", "Manage")],
        ),
        group(
            "files",
            "Files",
            &[("files.read", "Read"), ("files.write", "Write")],
        ),
        group("terminal", "Terminal", &[("terminal.exec", "Execute")]),
        group(
            "providers",
            "Providers",
            &[("providers.read", "Read"), ("providers.manage", "Manage")],
        ),
        group(
            "extensions",
            "Extensions",
            &[
                ("extensions.read", "Read"),
                ("extensions.manage", "Manage"),
                ("extensions.install", "Install"),
            ],
        ),
        group(
            "environment",
            "Environment",
            &[
                ("environment.read", "Read"),
                ("environment.manage", "Manage"),
                ("environment.restore", "Restore"),
            ],
        ),
        group(
            "notifications",
            "Notifications",
            &[
                ("notifications.read", "Read"),
                ("notifications.manage", "Manage"),
            ],
        ),
        group(
            "approvals",
            "Approvals",
            &[("approvals.read", "Read"), ("approvals.decide", "Decide")],
        ),
        group(
            "settings",
            "Settings",
            &[("settings.read", "Read"), ("settings.manage", "Manage")],
        ),
        group(
            "storage",
            "Storage",
            &[("storage.read", "Read"), ("storage.manage", "Manage")],
        ),
        group(
            "backup",
            "Backup",
            &[("backup.read", "Read"), ("backup.restore", "Restore")],
        ),
    ]
}

fn group(
    id: &'static str,
    label: &'static str,
    permissions: &[(&'static str, &'static str)],
) -> ApiKeyPermissionGroup {
    ApiKeyPermissionGroup {
        id,
        label,
        permissions: permissions
            .iter()
            .map(|(id, label)| ApiKeyPermissionItem { id, label })
            .collect(),
    }
}

fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn random_hex(size: usize) -> String {
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn random_base64_url(size: usize) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
