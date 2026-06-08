use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use include_dir::{include_dir, Dir};
use serde::Serialize;

/// Role templates embedded into the binary so built-in roles/circles work without shipping the
/// `role-templates/` directory alongside the executable. Materialized to disk on first run.
static EMBEDDED_ROLE_TEMPLATES: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../api/role-templates");

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoleTemplateSummary {
    pub id: String,
    pub name: String,
    pub group: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub localized_names: Option<serde_json::Value>,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

#[derive(Clone)]
pub struct AgentRoleTemplateRecord {
    pub summary: AgentRoleTemplateSummary,
    pub markdown_content: String,
}

pub fn markdown_title(value: &str) -> String {
    value
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .find(|line| line.trim().starts_with("# "))
        .map(|line| line.trim().trim_start_matches('#').trim().to_string())
        .unwrap_or_default()
}

pub fn markdown_description(value: &str) -> String {
    let first_body = value
        .split('\n')
        .map(|line| line.trim_end_matches('\r').trim())
        .filter(|line| !line.is_empty())
        .find(|line| !line.starts_with('#'));
    match first_body {
        Some(line) => line.chars().take(240).collect(),
        None => String::new(),
    }
}

pub fn system_prompt_with_role_description(
    system_prompt: &str,
    description: Option<&str>,
    enabled: bool,
) -> String {
    let clean_description = description.map(str::trim).filter(|value| !value.is_empty());
    let Some(clean_description) = clean_description else {
        return system_prompt.to_string();
    };
    if !enabled {
        return system_prompt.to_string();
    }
    let heading = "## Role Extension Description";
    if system_prompt.contains(heading) {
        return system_prompt.to_string();
    }
    format!(
        "{}\n\n{}\n{}",
        system_prompt.trim(),
        heading,
        clean_description
    )
}

pub fn parse_markdown_frontmatter(content: &str) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    let normalized = content.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return fields;
    }
    let rest = &normalized[4..];
    let Some(end) = rest.find("\n---") else {
        return fields;
    };
    let block = &rest[..end];
    for line in block.split('\n') {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            if key.is_empty()
                || !key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                continue;
            }
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
            fields.insert(key.to_string(), value.to_string());
        }
    }
    fields
}

fn read_json_zh_names(path: &Path) -> BTreeMap<String, serde_json::Value> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    serde_json::from_str::<BTreeMap<String, serde_json::Value>>(&content).unwrap_or_default()
}

pub fn list_agent_role_templates(dir: &Path) -> Vec<AgentRoleTemplateRecord> {
    if !dir.exists() {
        return Vec::new();
    }
    let zh_names_path = dir
        .join("agency-agents")
        .join("scripts")
        .join("i18n")
        .join("agent-names-zh.json");
    let zh_names = if zh_names_path.exists() {
        read_json_zh_names(&zh_names_path)
    } else {
        BTreeMap::new()
    };
    let use_localized_allowlist = !zh_names.is_empty();

    let mut records = Vec::new();
    walk(
        dir,
        dir,
        &[],
        &zh_names,
        use_localized_allowlist,
        &mut records,
    );
    records.sort_by(|a, b| {
        if a.summary.group == b.summary.group {
            a.summary.name.cmp(&b.summary.name)
        } else {
            a.summary.group.cmp(&b.summary.group)
        }
    });
    records
}

fn walk(
    root: &Path,
    dir: &Path,
    group_parts: &[String],
    zh_names: &BTreeMap<String, serde_json::Value>,
    use_localized_allowlist: bool,
    out: &mut Vec<AgentRoleTemplateRecord>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries = entries.filter_map(|entry| entry.ok()).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            let mut next = group_parts.to_vec();
            next.push(name);
            walk(root, &path, &next, zh_names, use_localized_allowlist, out);
            continue;
        }
        if !file_type.is_file() || !name.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        let Ok(markdown_content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let metadata = parse_markdown_frontmatter(&markdown_content);
        let Some(meta_name) = metadata
            .get("name")
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let is_agency_template = group_parts
            .first()
            .map(|p| p == "agency-agents")
            .unwrap_or(false);
        if use_localized_allowlist && is_agency_template && !zh_names.contains_key(&meta_name) {
            continue;
        }
        let filename = strip_md_extension(&name);
        let group = if group_parts.is_empty() {
            "Root".to_string()
        } else {
            group_parts.join("/")
        };
        let id = {
            let mut parts = group_parts.to_vec();
            parts.push(filename.clone());
            slugify_template_id(&parts.join("-"))
        };
        let localized = zh_names.get(&meta_name).map(|value| {
            let zh_name = value
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&meta_name)
                .to_string();
            let zh_desc = value
                .get("description")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let inner = serde_json::json!({ "name": zh_name, "description": zh_desc });
            serde_json::json!({ "zh-CN": inner, "zh": inner })
        });
        let source_path = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());
        let source_url = if is_agency_template {
            let agency_root = root.join("agency-agents");
            let rel = path
                .strip_prefix(&agency_root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            Some(format!(
                "https://github.com/msitarzewski/agency-agents/blob/main/{rel}"
            ))
        } else {
            None
        };
        let fallback_name = filename
            .split('-')
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        let name = if !meta_name.is_empty() {
            meta_name.clone()
        } else {
            let title = markdown_title(&markdown_content);
            if title.is_empty() {
                fallback_name
            } else {
                title
            }
        };
        let description = metadata
            .get("description")
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| markdown_description(&markdown_content));
        out.push(AgentRoleTemplateRecord {
            summary: AgentRoleTemplateSummary {
                id,
                name,
                group,
                description,
                localized_names: localized,
                source_path,
                source_url,
            },
            markdown_content,
        });
    }
}

fn strip_md_extension(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".markdown") {
        name[..name.len() - ".markdown".len()].to_string()
    } else if lower.ends_with(".md") {
        name[..name.len() - ".md".len()].to_string()
    } else {
        name.to_string()
    }
}

fn slugify_template_id(value: &str) -> String {
    let lower = value.to_lowercase();
    let mut result = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            result.push('-');
            prev_dash = true;
        }
    }
    result
}

pub fn role_template_dir(data_dir: &Path) -> PathBuf {
    if let Ok(value) = std::env::var("CODEX_WEB_ROLE_TEMPLATE_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    // Dev/repo layout: data_dir is typically apps/api/data; templates live at apps/api/role-templates.
    if let Some(parent_dir) = data_dir
        .parent()
        .map(|parent| parent.join("role-templates"))
    {
        if parent_dir.is_dir() {
            return parent_dir;
        }
    }
    // Deployed single-binary layout: materialized embedded templates under data_dir/role-templates.
    data_dir.join("role-templates")
}

/// Ensure the role-template directory exists on disk. When it is missing or empty (typical for a
/// standalone binary deployment), extract the embedded templates so list/seed read them normally.
pub fn ensure_role_templates_on_disk(data_dir: &Path) {
    let dir = role_template_dir(data_dir);
    let has_files = std::fs::read_dir(&dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    if has_files {
        return;
    }
    if let Err(error) = std::fs::create_dir_all(&dir) {
        tracing::warn!(
            "failed to create role-template dir {}: {error}",
            dir.display()
        );
        return;
    }
    if let Err(error) = EMBEDDED_ROLE_TEMPLATES.extract(&dir) {
        tracing::warn!(
            "failed to extract embedded role-templates to {}: {error}",
            dir.display()
        );
    }
}
