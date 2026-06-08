use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::api::files::archive::{write_zip, ZipEntry};
use crate::db::Db;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBackupSettings {
    pub ignore_patterns: Vec<String>,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSystemBackupSettingsRequest {
    pub ignore_patterns: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBackupProjectReference {
    pub id: String,
    pub name: String,
    pub workspace_path: String,
    pub exists: bool,
    pub git_remote: Option<String>,
    pub git_branch: Option<String>,
    pub git_commit: Option<String>,
    pub git_dirty: Option<bool>,
    pub included: bool,
    pub note: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBackupFileEntry {
    pub path: String,
    pub bytes: u64,
    pub modified_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBackupManifest {
    pub schema_version: i64,
    pub created_at: String,
    pub app: String,
    pub data_dir: String,
    pub ignore_patterns: Vec<String>,
    pub included: Vec<String>,
    pub excluded: Vec<String>,
    pub projects: Vec<SystemBackupProjectReference>,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBackupPreviewResponse {
    pub ok: bool,
    pub manifest: SystemBackupManifest,
    pub entries: usize,
    pub files: Vec<SystemBackupFileEntry>,
    pub bytes: u64,
    pub restart_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRestoreResponse {
    pub ok: bool,
    pub manifest: SystemBackupManifest,
    pub restored_at: String,
    pub backup_before_restore_path: String,
    pub restart_required: bool,
    pub warnings: Vec<String>,
}

pub struct SystemBackupArchive {
    pub manifest: SystemBackupManifest,
    pub bytes: Vec<u8>,
    pub entries: usize,
    pub files: Vec<SystemBackupFileEntry>,
}

struct ParsedBackupArchive {
    manifest: SystemBackupManifest,
    entries: Vec<(String, Vec<u8>)>,
    files: Vec<SystemBackupFileEntry>,
    bytes: u64,
}

pub fn settings(db: &Db) -> anyhow::Result<SystemBackupSettings> {
    Ok(load_json_setting(db, "system_backup")?
        .map(sanitize_settings)
        .unwrap_or_else(default_settings))
}

pub fn save_settings(
    db: &Db,
    input: UpdateSystemBackupSettingsRequest,
) -> anyhow::Result<SystemBackupSettings> {
    let next = sanitize_settings(SystemBackupSettings {
        ignore_patterns: parse_ignore_patterns(input.ignore_patterns),
        updated_at: crate::api::common::timestamp(),
    });
    save_json_setting(db, "system_backup", &next)?;
    Ok(next)
}

pub fn preview(db: &Db) -> anyhow::Result<SystemBackupPreviewResponse> {
    let archive = create_archive(db)?;
    Ok(SystemBackupPreviewResponse {
        ok: true,
        entries: archive.entries,
        files: archive.files,
        bytes: archive.bytes.len() as u64,
        manifest: archive.manifest,
        restart_required: false,
    })
}

pub fn create_archive(db: &Db) -> anyhow::Result<SystemBackupArchive> {
    let settings = settings(db)?;
    let manifest = manifest(db, &settings)?;
    let root_name = format!("codex-web-system-backup-{}", backup_timestamp());
    let mut entries = vec![ZipEntry {
        name: format!("{root_name}/manifest.json").into_bytes(),
        data: format!("{}\n", serde_json::to_string_pretty(&manifest)?).into_bytes(),
        modified_at: std::time::SystemTime::now(),
    }];
    collect_data_zip_entries(
        &db.data_dir,
        "",
        &settings.ignore_patterns,
        &root_name,
        &mut entries,
    )?;
    let files = archive_file_entries(&entries, &root_name);
    let bytes = write_zip(entries)?;
    Ok(SystemBackupArchive {
        manifest,
        entries: files.len(),
        files,
        bytes,
    })
}

pub fn preview_archive(bytes: &[u8]) -> anyhow::Result<SystemBackupPreviewResponse> {
    let parsed = read_archive(bytes)?;
    Ok(SystemBackupPreviewResponse {
        ok: true,
        manifest: parsed.manifest,
        entries: parsed.entries.len(),
        files: parsed.files,
        bytes: parsed.bytes,
        restart_required: true,
    })
}

pub fn restore_archive(db: &Db, bytes: &[u8]) -> anyhow::Result<SystemRestoreResponse> {
    let parsed = read_archive(bytes)?;
    if parsed.entries.is_empty() {
        anyhow::bail!("backup_has_no_app_data");
    }
    let before = create_archive(db)?;
    let restore_backup_root = db
        .data_dir
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("restore-backups");
    fs::create_dir_all(&restore_backup_root)?;
    let backup_before_restore_path =
        restore_backup_root.join(format!("pre-restore-{}.zip", backup_timestamp()));
    fs::write(&backup_before_restore_path, before.bytes)?;

    if db.data_dir.exists() {
        fs::remove_dir_all(&db.data_dir)?;
    }
    fs::create_dir_all(&db.data_dir)?;
    for (relative, data) in &parsed.entries {
        let target = safe_restore_target(&db.data_dir, relative)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(target, data)?;
    }
    let mut warnings = parsed.manifest.warnings.clone();
    warnings.push("系统数据已还原到 apps/api/data。请通过终端重启 API 服务后再继续使用；无需重启前端或 Docker 容器。".to_string());
    Ok(SystemRestoreResponse {
        ok: true,
        manifest: parsed.manifest,
        restored_at: crate::api::common::timestamp(),
        backup_before_restore_path: backup_before_restore_path.display().to_string(),
        restart_required: true,
        warnings,
    })
}

fn manifest(db: &Db, settings: &SystemBackupSettings) -> anyhow::Result<SystemBackupManifest> {
    Ok(SystemBackupManifest {
        schema_version: 1,
        created_at: crate::api::common::timestamp(),
        app: "codex-web".to_string(),
        data_dir: db.data_dir.display().to_string(),
        ignore_patterns: settings.ignore_patterns.clone(),
        included: vec![
            "apps/api/data/**".to_string(),
            "备份清单 manifest.json".to_string(),
            "已绑定项目的路径与 Git 参考信息".to_string(),
        ],
        excluded: vec![
            "apps/api/data 之外的真实项目源码目录".to_string(),
            "构建产物和外部挂载目录".to_string(),
            "用户配置的备份忽略规则匹配到的 apps/api/data 内文件".to_string(),
        ],
        projects: project_references(db)?,
        warnings: vec![
            "真实项目目录不会随系统备份打包；还原后如果路径不存在，需要重新绑定项目目录。"
                .to_string(),
            "Provider API Key 等应用状态会随 apps/api/data 一起备份。请妥善保管备份文件。"
                .to_string(),
        ],
    })
}

fn project_references(db: &Db) -> anyhow::Result<Vec<SystemBackupProjectReference>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(Vec::new());
    };
    if !table_exists(&connection, "projects")? {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare("select id, name, workspace_path from projects order by name asc, id asc")?;
    let items = statement
        .query_map([], |row| {
            let workspace_path: String = row.get(2)?;
            Ok(SystemBackupProjectReference {
                id: row.get(0)?,
                name: row.get(1)?,
                exists: Path::new(&workspace_path).exists(),
                workspace_path,
                git_remote: None,
                git_branch: None,
                git_commit: None,
                git_dirty: None,
                included: false,
                note: "真实项目源码目录不会随系统备份打包；这里只记录路径信息。".to_string(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn collect_data_zip_entries(
    root: &Path,
    relative: &str,
    ignore_patterns: &[String],
    root_name: &str,
    entries: &mut Vec<ZipEntry>,
) -> anyhow::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(root)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    let is_dir = metadata.is_dir();
    if !relative.is_empty() && should_ignore(relative, is_dir, ignore_patterns) {
        return Ok(());
    }
    if is_dir {
        for entry in fs::read_dir(root)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            let child_relative = if relative.is_empty() {
                name
            } else {
                format!("{relative}/{name}")
            };
            collect_data_zip_entries(
                &entry.path(),
                &child_relative,
                ignore_patterns,
                root_name,
                entries,
            )?;
        }
    } else if metadata.is_file() {
        entries.push(ZipEntry {
            name: format!("{root_name}/app-data/{relative}").into_bytes(),
            data: fs::read(root)?,
            modified_at: metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        });
    }
    Ok(())
}

fn archive_file_entries(entries: &[ZipEntry], root_name: &str) -> Vec<SystemBackupFileEntry> {
    let prefix = format!("{root_name}/");
    entries
        .iter()
        .map(|entry| {
            let path = String::from_utf8_lossy(&entry.name).to_string();
            SystemBackupFileEntry {
                path: path.strip_prefix(&prefix).unwrap_or(&path).to_string(),
                bytes: entry.data.len() as u64,
                modified_at: Some(system_time_string(entry.modified_at)),
            }
        })
        .collect()
}

fn should_ignore(relative: &str, is_dir: bool, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| {
        let pattern = pattern.trim();
        if pattern.is_empty() || pattern.starts_with('#') {
            return false;
        }
        let pattern = pattern.trim_start_matches('/');
        if let Some(dir) = pattern.strip_suffix('/') {
            return is_dir && (relative == dir || relative.starts_with(&format!("{dir}/")));
        }
        relative == pattern || relative.ends_with(&format!("/{pattern}"))
    })
}

fn default_settings() -> SystemBackupSettings {
    SystemBackupSettings {
        ignore_patterns: vec![
            "# 备份忽略规则，语法类似 .gitignore".to_string(),
            "node_modules/".to_string(),
            ".DS_Store".to_string(),
        ],
        updated_at: crate::api::common::timestamp(),
    }
}

fn sanitize_settings(input: SystemBackupSettings) -> SystemBackupSettings {
    SystemBackupSettings {
        ignore_patterns: input
            .ignore_patterns
            .into_iter()
            .map(|line| line.replace('\r', "").chars().take(500).collect())
            .take(500)
            .collect(),
        updated_at: input.updated_at,
    }
}

fn parse_ignore_patterns(value: serde_json::Value) -> Vec<String> {
    if let Some(items) = value.as_array() {
        return items
            .iter()
            .map(|item| item.as_str().unwrap_or("").to_string())
            .collect();
    }
    value
        .as_str()
        .unwrap_or("")
        .lines()
        .map(str::to_string)
        .collect()
}

fn load_json_setting<T: serde::de::DeserializeOwned>(
    db: &Db,
    key: &str,
) -> anyhow::Result<Option<T>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    if !table_exists(&connection, "app_settings")? {
        return Ok(None);
    }
    let value = connection
        .query_row(
            "select value from app_settings where key = ?",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value.and_then(|value| serde_json::from_str(&value).ok()))
}

fn save_json_setting<T: serde::Serialize>(db: &Db, key: &str, value: &T) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    connection.execute_batch(
        "
        create table if not exists app_settings (
          key text primary key,
          value text not null,
          updated_at text not null
        );
        ",
    )?;
    connection.execute(
        "insert into app_settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
        (key, serde_json::to_string(value)?, crate::api::common::timestamp()),
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

fn system_time_string(value: std::time::SystemTime) -> String {
    time::OffsetDateTime::from(value)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn backup_timestamp() -> String {
    crate::api::common::timestamp().replace([':', '.'], "-")
}

fn read_archive(bytes: &[u8]) -> anyhow::Result<ParsedBackupArchive> {
    let entries = parse_zip(bytes)?;
    let manifest_entry = entries
        .iter()
        .find(|entry| entry.0.ends_with("/manifest.json") || entry.0 == "manifest.json")
        .ok_or_else(|| anyhow::anyhow!("backup_manifest_missing"))?;
    let root_name = manifest_entry
        .0
        .rsplit_once('/')
        .map(|(root, _)| root.to_string())
        .unwrap_or_default();
    let manifest: SystemBackupManifest = serde_json::from_slice(&manifest_entry.1)?;
    if manifest.app != "codex-web" || manifest.schema_version != 1 {
        anyhow::bail!("backup_manifest_unsupported");
    }
    let prefix = if root_name.is_empty() {
        "app-data/".to_string()
    } else {
        format!("{root_name}/app-data/")
    };
    let app_entries = entries
        .into_iter()
        .filter_map(|(name, data)| {
            name.strip_prefix(&prefix)
                .map(|relative| (relative.to_string(), data))
        })
        .map(|(relative, data)| {
            let relative = safe_backup_entry_name(&relative)?;
            Ok((relative, data))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let files = app_entries
        .iter()
        .map(|(relative, data)| SystemBackupFileEntry {
            path: format!("app-data/{relative}"),
            bytes: data.len() as u64,
            modified_at: None,
        })
        .collect();
    Ok(ParsedBackupArchive {
        manifest,
        entries: app_entries,
        files,
        bytes: bytes.len() as u64,
    })
}

fn parse_zip(bytes: &[u8]) -> anyhow::Result<Vec<(String, Vec<u8>)>> {
    let mut offset = 0usize;
    let mut entries = Vec::new();
    while offset + 30 <= bytes.len() {
        if read_u32(bytes, offset) != Some(0x0403_4b50) {
            break;
        }
        let compression = read_u16(bytes, offset + 8).unwrap_or(0);
        if compression != 0 {
            anyhow::bail!("backup_zip_compression_unsupported");
        }
        let compressed_size = read_u32(bytes, offset + 18)
            .ok_or_else(|| anyhow::anyhow!("backup_zip_invalid"))?
            as usize;
        let name_len = read_u16(bytes, offset + 26)
            .ok_or_else(|| anyhow::anyhow!("backup_zip_invalid"))? as usize;
        let extra_len = read_u16(bytes, offset + 28)
            .ok_or_else(|| anyhow::anyhow!("backup_zip_invalid"))? as usize;
        let name_start = offset + 30;
        let data_start = name_start + name_len + extra_len;
        let data_end = data_start + compressed_size;
        if data_end > bytes.len() {
            anyhow::bail!("backup_zip_invalid");
        }
        let name = String::from_utf8(bytes[name_start..name_start + name_len].to_vec())?;
        entries.push((name, bytes[data_start..data_end].to_vec()));
        offset = data_end;
    }
    Ok(entries)
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn safe_backup_entry_name(name: &str) -> anyhow::Result<String> {
    let normalized = name.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains('\0')
        || normalized.split('/').any(|part| part == "..")
    {
        anyhow::bail!("invalid_backup_entry");
    }
    Ok(normalized)
}

fn safe_restore_target(root: &Path, relative: &str) -> anyhow::Result<PathBuf> {
    let relative = safe_backup_entry_name(relative)?;
    let target = root.join(relative);
    if target != root && !target.starts_with(root) {
        anyhow::bail!("invalid_backup_entry");
    }
    Ok(target)
}
