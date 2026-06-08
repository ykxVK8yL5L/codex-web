use std::{fs, path::Path};

use super::models::{ArchiveIgnoreTemplate, FileArchivePreviewResponse};

pub struct ZipEntry {
    pub name: Vec<u8>,
    pub data: Vec<u8>,
    pub modified_at: std::time::SystemTime,
}

pub fn preview(root: &Path, excludes: &[String]) -> anyhow::Result<FileArchivePreviewResponse> {
    let rules = excludes
        .iter()
        .filter_map(|item| IgnoreRule::parse(item))
        .collect::<Vec<_>>();
    let mut result = FileArchivePreviewResponse {
        files: 0,
        bytes: 0,
        excluded: 0,
        excluded_examples: Vec::new(),
    };
    walk(root, "", &rules, &mut result)?;
    Ok(result)
}

pub fn create_zip(root: &Path, base_name: &str, excludes: &[String]) -> anyhow::Result<Vec<u8>> {
    let rules = excludes
        .iter()
        .filter_map(|item| IgnoreRule::parse(item))
        .collect::<Vec<_>>();
    let mut entries = Vec::new();
    collect_zip_entries(root, "", base_name, &rules, &mut entries)?;
    write_zip(entries)
}

pub fn templates() -> anyhow::Result<Vec<ArchiveIgnoreTemplate>> {
    let root = archive_template_root();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    walk_templates(&root, &root, &mut items)?;
    items.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(items)
}

fn walk(
    root: &Path,
    relative: &str,
    rules: &[IgnoreRule],
    result: &mut FileArchivePreviewResponse,
) -> anyhow::Result<()> {
    let metadata = fs::symlink_metadata(root)?;
    if metadata.file_type().is_symlink() {
        if !relative.is_empty() {
            mark_excluded(result, relative);
        }
        return Ok(());
    }
    let is_dir = metadata.is_dir();
    if !relative.is_empty() && rules.iter().any(|rule| rule.matches(relative, is_dir)) {
        mark_excluded(result, relative);
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
            walk(&entry.path(), &child_relative, rules, result)?;
        }
        return Ok(());
    }
    if metadata.is_file() {
        result.files += 1;
        result.bytes += metadata.len();
    }
    Ok(())
}

fn collect_zip_entries(
    root: &Path,
    relative: &str,
    base_name: &str,
    rules: &[IgnoreRule],
    entries: &mut Vec<ZipEntry>,
) -> anyhow::Result<()> {
    let metadata = fs::symlink_metadata(root)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    let is_dir = metadata.is_dir();
    if !relative.is_empty() && rules.iter().any(|rule| rule.matches(relative, is_dir)) {
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
            collect_zip_entries(&entry.path(), &child_relative, base_name, rules, entries)?;
        }
        return Ok(());
    }
    if metadata.is_file() {
        let archive_name = if relative.is_empty() {
            base_name.to_string()
        } else {
            format!("{base_name}/{relative}")
        };
        entries.push(ZipEntry {
            name: archive_name.trim_start_matches('/').as_bytes().to_vec(),
            data: fs::read(root)?,
            modified_at: metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        });
    }
    Ok(())
}

pub fn write_zip(entries: Vec<ZipEntry>) -> anyhow::Result<Vec<u8>> {
    if entries.len() > u16::MAX as usize {
        anyhow::bail!("archive_too_many_files");
    }
    let count =
        u16::try_from(entries.len()).map_err(|_| anyhow::anyhow!("archive_too_many_files"))?;
    let mut local = Vec::new();
    let mut central = Vec::new();
    let mut offset = 0u32;
    for entry in entries {
        let size = u32::try_from(entry.data.len())
            .map_err(|_| anyhow::anyhow!("archive_file_too_large"))?;
        let name_len = u16::try_from(entry.name.len())
            .map_err(|_| anyhow::anyhow!("archive_file_name_too_long"))?;
        let crc = crc32(&entry.data);
        let (dos_time, dos_date) = dos_date_time(entry.modified_at);

        let local_offset = offset;
        write_u32(&mut local, 0x0403_4b50);
        write_u16(&mut local, 20);
        write_u16(&mut local, 0x0800);
        write_u16(&mut local, 0);
        write_u16(&mut local, dos_time);
        write_u16(&mut local, dos_date);
        write_u32(&mut local, crc);
        write_u32(&mut local, size);
        write_u32(&mut local, size);
        write_u16(&mut local, name_len);
        write_u16(&mut local, 0);
        local.extend_from_slice(&entry.name);
        local.extend_from_slice(&entry.data);
        offset = u32::try_from(local.len()).map_err(|_| anyhow::anyhow!("archive_too_large"))?;

        write_u32(&mut central, 0x0201_4b50);
        write_u16(&mut central, 20);
        write_u16(&mut central, 20);
        write_u16(&mut central, 0x0800);
        write_u16(&mut central, 0);
        write_u16(&mut central, dos_time);
        write_u16(&mut central, dos_date);
        write_u32(&mut central, crc);
        write_u32(&mut central, size);
        write_u32(&mut central, size);
        write_u16(&mut central, name_len);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u32(&mut central, 0);
        write_u32(&mut central, local_offset);
        central.extend_from_slice(&entry.name);
    }
    let central_offset = offset;
    let central_size =
        u32::try_from(central.len()).map_err(|_| anyhow::anyhow!("archive_too_large"))?;
    local.extend_from_slice(&central);
    write_u32(&mut local, 0x0605_4b50);
    write_u16(&mut local, 0);
    write_u16(&mut local, 0);
    write_u16(&mut local, count);
    write_u16(&mut local, count);
    write_u32(&mut local, central_size);
    write_u32(&mut local, central_offset);
    write_u16(&mut local, 0);
    Ok(local)
}

fn dos_date_time(value: std::time::SystemTime) -> (u16, u16) {
    let value = time::OffsetDateTime::from(value);
    let year = value.year().max(1980);
    let time = ((value.hour() as u16) << 11)
        | ((value.minute() as u16) << 5)
        | ((value.second() as u16) / 2);
    let date = (((year - 1980) as u16) << 9)
        | ((u8::from(value.month()) as u16) << 5)
        | value.day() as u16;
    (time, date)
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    crc ^ 0xffff_ffff
}

fn mark_excluded(result: &mut FileArchivePreviewResponse, relative: &str) {
    result.excluded += 1;
    if result.excluded_examples.len() < 8 {
        result.excluded_examples.push(relative.to_string());
    }
}

fn walk_templates(
    root: &Path,
    dir: &Path,
    items: &mut Vec<ArchiveIgnoreTemplate>,
) -> anyhow::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            walk_templates(root, &path, items)?;
            continue;
        }
        if !path.is_file() || !is_template_file(&path) {
            continue;
        }
        let name = path
            .file_stem()
            .map(|item| item.to_string_lossy().to_string())
            .unwrap_or_else(|| "Template".to_string());
        let parent = path.parent().unwrap_or(root);
        let group = parent
            .strip_prefix(root)
            .ok()
            .map(|relative| {
                let value = relative.to_string_lossy().replace('\\', "/");
                if value.is_empty() {
                    "Root".to_string()
                } else {
                    value
                }
            })
            .unwrap_or_else(|| "Root".to_string());
        let id = slug(&format!("{group}-{name}"));
        let rules = fs::read_to_string(&path)?.trim().to_string();
        items.push(ArchiveIgnoreTemplate {
            id,
            name,
            group,
            rules,
        });
    }
    Ok(())
}

fn archive_template_root() -> std::path::PathBuf {
    std::env::var("CODEX_WEB_IGNORE_TEMPLATE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("apps/api/templates/gitignore"))
}

fn is_template_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| matches!(ext.to_lowercase().as_str(), "gitignore" | "ignore" | "txt"))
        .unwrap_or(false)
}

fn slug(value: &str) -> String {
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

struct IgnoreRule {
    pattern: String,
    directory_only: bool,
}

impl IgnoreRule {
    fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.is_empty() || value.starts_with('#') {
            return None;
        }
        let directory_only = value.ends_with('/');
        let pattern = value.trim_matches('/').trim_end_matches('/').to_string();
        if pattern.is_empty() {
            None
        } else {
            Some(Self {
                pattern,
                directory_only,
            })
        }
    }

    fn matches(&self, relative: &str, is_dir: bool) -> bool {
        if self.directory_only && !is_dir {
            return false;
        }
        let relative = relative.trim_matches('/');
        if wildcard_match(&self.pattern, relative) {
            return true;
        }
        relative
            .split('/')
            .any(|part| wildcard_match(&self.pattern, part))
    }
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let Some((prefix, suffix)) = pattern.split_once('*') else {
        return pattern == value;
    };
    value.starts_with(prefix) && value.ends_with(suffix)
}
