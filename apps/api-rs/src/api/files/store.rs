use std::{fs, path::PathBuf, time::SystemTime};

use rusqlite::OptionalExtension;

use crate::db::Db;

use super::{models::FileMount, paths};

pub fn list_mounts(db: &Db) -> anyhow::Result<Vec<FileMount>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    let exists = connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = 'file_mounts' limit 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("select id, name, root_path, created_at, updated_at from file_mounts order by created_at asc")?;
    let mounts = statement
        .query_map([], |row| {
            Ok(FileMount {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // Mirror TS: return the real (possibly empty) mount list. Do NOT synthesize a "default"
    // mount here — a synthetic row is not in the table and cannot be deleted, which breaks the
    // "remove mount" action. File browsing falls back to a transient workspace in resolve_mount.
    Ok(mounts)
}

pub fn create_mount(db: &Db, name: &str, root_path: &str) -> anyhow::Result<FileMount> {
    let name = name.trim();
    let root_path = root_path.trim();
    if name.is_empty() || root_path.is_empty() {
        anyhow::bail!("invalid_mount");
    }
    let root = paths::normalize_path(&PathBuf::from(root_path))?;
    if !root.is_dir() {
        anyhow::bail!("mount_root_invalid");
    }
    let id = unique_mount_id(db, &slugify(name))?;
    let mount = FileMount {
        id,
        name: name.to_string(),
        root_path: root.display().to_string(),
        created_at: now_string(),
        updated_at: now_string(),
    };
    upsert_mount(db, &mount)?;
    Ok(mount)
}

pub fn update_mount(
    db: &Db,
    id: &str,
    name: Option<&str>,
    root_path: Option<&str>,
) -> anyhow::Result<Option<FileMount>> {
    let Some(mut mount) = list_mounts(db)?.into_iter().find(|mount| mount.id == id) else {
        return Ok(None);
    };
    if let Some(name) = name {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("invalid_mount_update");
        }
        mount.name = name.to_string();
    }
    if let Some(root_path) = root_path {
        let root_path = root_path.trim();
        if root_path.is_empty() {
            anyhow::bail!("invalid_mount_update");
        }
        let root = paths::normalize_path(&PathBuf::from(root_path))?;
        if !root.is_dir() {
            anyhow::bail!("mount_root_invalid");
        }
        mount.root_path = root.display().to_string();
    }
    mount.updated_at = now_string();
    upsert_mount(db, &mount)?;
    Ok(Some(mount))
}

pub fn delete_mount(db: &Db, id: &str) -> anyhow::Result<bool> {
    let connection = db.open_read_write()?;
    ensure_mount_schema(&connection)?;
    Ok(connection.execute("delete from file_mounts where id = ?", [id])? > 0)
}

pub fn resolve_mount(
    db: &Db,
    mount_id: Option<&str>,
    root_path: Option<&str>,
) -> anyhow::Result<FileMount> {
    if let Some(root_path) = root_path.filter(|item| !item.trim().is_empty()) {
        let root = paths::normalize_path(&PathBuf::from(root_path.trim()))?;
        return Ok(FileMount {
            id: "__workspace".to_string(),
            name: "Workspace".to_string(),
            root_path: root.display().to_string(),
            created_at: now_string(),
            updated_at: now_string(),
        });
    }
    let mounts = list_mounts(db)?;
    let selected = mount_id
        .and_then(|id| mounts.iter().find(|mount| mount.id == id))
        .or_else(|| mounts.iter().find(|mount| mount.id == "default"))
        .or_else(|| mounts.first())
        .cloned();
    // Fall back to a transient workspace mount (cwd) when no mounts are configured, so file
    // browsing keeps working with an empty mount list (mirrors TS transient workspace handling).
    Ok(selected.unwrap_or_else(|| default_mounts(db).into_iter().next().unwrap()))
}

fn upsert_mount(db: &Db, mount: &FileMount) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    ensure_mount_schema(&connection)?;
    connection.execute(
        "
        insert into file_mounts (id, name, root_path, created_at, updated_at)
        values (?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          root_path = excluded.root_path,
          updated_at = excluded.updated_at
        ",
        (
            &mount.id,
            &mount.name,
            &mount.root_path,
            &mount.created_at,
            &mount.updated_at,
        ),
    )?;
    Ok(())
}

fn ensure_mount_schema(connection: &rusqlite::Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "
        create table if not exists file_mounts (
          id text primary key,
          name text not null,
          root_path text not null,
          created_at text not null,
          updated_at text not null
        );
        ",
    )?;
    Ok(())
}

pub fn file_time(value: SystemTime) -> String {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|duration| {
            time::OffsetDateTime::from_unix_timestamp(duration.as_secs() as i64).ok()
        })
        .and_then(|datetime| {
            datetime
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
}

fn default_mounts(db: &Db) -> Vec<FileMount> {
    let root = std::env::current_dir().unwrap_or_else(|_| db.data_dir.clone());
    vec![FileMount {
        id: "default".to_string(),
        name: "Workspace".to_string(),
        root_path: root.display().to_string(),
        created_at: now_string(),
        updated_at: now_string(),
    }]
}

fn now_string() -> String {
    file_time(SystemTime::now())
}

pub fn stat(path: &std::path::Path) -> anyhow::Result<fs::Metadata> {
    fs::metadata(path).map_err(Into::into)
}

fn unique_mount_id(db: &Db, base: &str) -> anyhow::Result<String> {
    let existing = list_mounts(db)?
        .into_iter()
        .map(|mount| mount.id)
        .collect::<std::collections::HashSet<_>>();
    let base = if base.is_empty() { "mount" } else { base };
    let mut id = base.to_string();
    let mut suffix = 2;
    while existing.contains(&id) {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }
    Ok(id)
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').to_string()
}
