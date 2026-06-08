use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context};
use rusqlite::OptionalExtension;

use crate::{api::common::PageResponse, db::Db};

use super::models::*;

const MARKETPLACE_CATALOG_SETTINGS_KEY: &str = "marketplace_catalog";

pub fn list_skills(codex_home: &Path) -> anyhow::Result<Vec<ExtensionSummary>> {
    let roots = [
        codex_home.join("skills"),
        codex_home.join("plugins").join("cache"),
    ];
    let scanned_at = crate::api::common::timestamp();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for root in roots {
        for skill_path in find_named_files(&root, "SKILL.md", 3)? {
            let Some(folder) = skill_path.parent() else {
                continue;
            };
            let folder = folder.to_path_buf();
            if !seen.insert(folder.clone()) {
                continue;
            }
            let metadata = read_skill_metadata(&skill_path).unwrap_or_default();
            let is_plugin_cache = contains_path_segment_pair(&folder, "plugins", "cache");
            let is_web_managed = contains_path_segment_pair(&folder, "skills", "web");
            let name = metadata.name.unwrap_or_else(|| {
                folder
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Skill".to_string())
            });
            items.push(ExtensionSummary {
                id: format!("skill:{}", folder.display()),
                extension_type: "skill".to_string(),
                name,
                description: metadata.description,
                path: Some(folder.display().to_string()),
                source: Some(
                    if is_plugin_cache {
                        "plugin cache"
                    } else if is_web_managed {
                        "web local"
                    } else {
                        "codex home"
                    }
                    .to_string(),
                ),
                source_type: Some(
                    if is_plugin_cache {
                        "plugin_cache"
                    } else {
                        "codex_skill"
                    }
                    .to_string(),
                ),
                managed_by: Some(if is_web_managed { "web" } else { "codex_cli" }.to_string()),
                sync_status: Some("synced".to_string()),
                scanned_at: Some(scanned_at.clone()),
                capability_kinds: Some(vec!["knowledge".to_string()]),
                permissions: Some(vec!["read_context".to_string()]),
                assignable_to: None,
                enabled: Some(true),
            });
        }
    }
    items.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    Ok(items)
}

pub fn create_local_skill(
    codex_home: &Path,
    body: CreateSkillRequest,
) -> anyhow::Result<ExtensionSummary> {
    let name = clean_spaces(&body.name);
    let description = clean_spaces(&body.description);
    let instructions = body.instructions.trim().to_string();
    if name.is_empty() || description.is_empty() || instructions.is_empty() {
        bail!("invalid_skill");
    }
    let folder = codex_home.join("skills").join("web").join(slugify(&name));
    let skill_path = folder.join("SKILL.md");
    if skill_path.exists() {
        bail!("skill_exists");
    }
    fs::create_dir_all(&folder)?;
    fs::write(
        &skill_path,
        render_skill_markdown(&name, &description, &instructions),
    )?;
    Ok(skill_summary(folder, name, Some(description), true))
}

pub async fn import_skill(
    codex_home: &Path,
    body: ImportSkillRequest,
) -> anyhow::Result<ImportSkillResponse> {
    let mut content = body.content.unwrap_or_default().trim().to_string();
    let url = body.url.unwrap_or_default().trim().to_string();
    if content.is_empty() && !url.is_empty() {
        content = reqwest::get(normalize_import_url(&url))
            .await?
            .error_for_status()?
            .text()
            .await?;
    }
    if content.trim().is_empty() {
        bail!("skill_import_empty");
    }
    let metadata = read_skill_metadata_from_content(&content);
    let name = metadata
        .name
        .or_else(|| {
            Path::new(&url).file_name().map(|value| {
                value
                    .to_string_lossy()
                    .replace(".md", "")
                    .replace(".markdown", "")
            })
        })
        .unwrap_or_default();
    let description = metadata
        .description
        .unwrap_or_else(|| "Imported Skill".to_string());
    let instructions = skill_instructions_from_content(&content);
    if name.trim().is_empty() || instructions.trim().is_empty() {
        bail!("skill_import_invalid");
    }
    Ok(ImportSkillResponse {
        imported: create_local_skill(
            codex_home,
            CreateSkillRequest {
                name,
                description,
                instructions,
            },
        )?,
    })
}

pub fn update_local_skill(
    codex_home: &Path,
    body: UpdateSkillRequest,
) -> anyhow::Result<ExtensionSummary> {
    let (folder, skill_path) = assert_web_managed_skill_path(codex_home, &body.path)?;
    let name = clean_spaces(&body.name);
    let description = clean_spaces(&body.description);
    let instructions = body.instructions.trim().to_string();
    if name.is_empty() || description.is_empty() || instructions.is_empty() {
        bail!("invalid_skill");
    }
    fs::write(
        skill_path,
        render_skill_markdown(&name, &description, &instructions),
    )?;
    Ok(skill_summary(folder, name, Some(description), true))
}

pub fn delete_local_skill(
    codex_home: &Path,
    body: DeleteSkillRequest,
) -> anyhow::Result<serde_json::Value> {
    let (folder, _) = assert_web_managed_skill_path(codex_home, &body.path)?;
    fs::remove_dir_all(&folder)
        .with_context(|| format!("failed to delete skill {}", folder.display()))?;
    Ok(serde_json::json!({ "ok": true, "path": folder.display().to_string() }))
}

pub fn list_plugins(codex_home: &Path) -> anyhow::Result<Vec<ExtensionSummary>> {
    let roots = [
        codex_home.join("plugins"),
        codex_home.join("plugins").join("cache"),
    ];
    let scanned_at = crate::api::common::timestamp();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for root in roots {
        for manifest_path in find_plugin_manifests(&root, 4)? {
            let Some(plugin_root) = manifest_path.parent().and_then(|path| path.parent()) else {
                continue;
            };
            let plugin_root = plugin_root.to_path_buf();
            if !seen.insert(plugin_root.clone()) {
                continue;
            }
            let manifest = read_json_file(&manifest_path).unwrap_or_default();
            let is_plugin_cache = contains_path_segment_pair(&plugin_root, "plugins", "cache");
            let is_web_managed = contains_path_segment_pair(&plugin_root, "plugins", "web");
            items.push(ExtensionSummary {
                id: format!("plugin:{}", plugin_root.display()),
                extension_type: "plugin".to_string(),
                name: manifest
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or_else(|| {
                        plugin_root
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or("Plugin")
                    })
                    .to_string(),
                description: manifest
                    .get("description")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                path: Some(plugin_root.display().to_string()),
                source: Some(
                    if is_plugin_cache {
                        "plugin cache"
                    } else if is_web_managed {
                        "web local"
                    } else {
                        "codex home"
                    }
                    .to_string(),
                ),
                source_type: Some(
                    if is_plugin_cache {
                        "plugin_cache"
                    } else {
                        "codex_plugin"
                    }
                    .to_string(),
                ),
                managed_by: Some(if is_web_managed { "web" } else { "codex_cli" }.to_string()),
                sync_status: Some("synced".to_string()),
                scanned_at: Some(scanned_at.clone()),
                capability_kinds: Some(vec!["tool".to_string()]),
                permissions: None,
                assignable_to: None,
                enabled: Some(true),
            });
        }
    }
    items.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    Ok(items)
}

pub fn create_local_plugin(
    codex_home: &Path,
    body: CreatePluginRequest,
) -> anyhow::Result<ExtensionSummary> {
    let name = clean_spaces(&body.name);
    if name.is_empty() {
        bail!("invalid_plugin");
    }
    let description = body.description.unwrap_or_default().trim().to_string();
    let plugin_root = codex_home.join("plugins").join("web").join(slugify(&name));
    let manifest_dir = plugin_root.join(".codex-plugin");
    let manifest_path = manifest_dir.join("plugin.json");
    if manifest_path.exists() {
        bail!("plugin_exists");
    }
    fs::create_dir_all(&manifest_dir)?;
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "name": name,
            "version": body.version.unwrap_or_else(|| "0.1.0".to_string()),
            "description": description,
        }))?,
    )?;
    Ok(plugin_summary(plugin_root, name, Some(description), true))
}

pub fn list_mcp_servers(codex_home: &Path) -> anyhow::Result<Vec<ExtensionSummary>> {
    let config_path = codex_home.join("config.toml");
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&config_path)?;
    let mut items = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if !line.starts_with("[mcp_servers.") || !line.ends_with(']') {
            continue;
        }
        let raw = &line["[mcp_servers.".len()..line.len() - 1];
        let name = parse_toml_section_name(raw);
        if name.is_empty() {
            continue;
        }
        items.push(ExtensionSummary {
            id: format!("mcp:{name}"),
            extension_type: "mcp".to_string(),
            name,
            description: None,
            path: Some(config_path.display().to_string()),
            source: Some("config.toml".to_string()),
            source_type: Some("mcp_config".to_string()),
            managed_by: Some("web".to_string()),
            sync_status: Some("synced".to_string()),
            scanned_at: Some(crate::api::common::timestamp()),
            capability_kinds: Some(vec!["connector".to_string()]),
            permissions: None,
            assignable_to: None,
            enabled: Some(true),
        });
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

pub fn create_mcp_server(
    codex_home: &Path,
    body: CreateMcpServerRequest,
) -> anyhow::Result<ExtensionSummary> {
    let name = body.name.trim();
    let command = body.command.trim();
    if name.is_empty()
        || command.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    {
        bail!("invalid_mcp_server");
    }
    let config_path = codex_home.join("config.toml");
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let current = fs::read_to_string(&config_path).unwrap_or_default();
    let section = render_mcp_server_toml(&CreateMcpServerRequest {
        name: name.to_string(),
        command: command.to_string(),
        args: body.args,
        env: body.env,
    });
    let next = replace_or_append_mcp_section(&current, name, &section);
    fs::write(&config_path, format!("{}\n", next.trim_end()))?;
    Ok(ExtensionSummary {
        id: format!("mcp:{name}"),
        extension_type: "mcp".to_string(),
        name: name.to_string(),
        description: None,
        path: Some(config_path.display().to_string()),
        source: Some("config.toml".to_string()),
        source_type: Some("mcp_config".to_string()),
        managed_by: Some("web".to_string()),
        sync_status: Some("synced".to_string()),
        scanned_at: Some(crate::api::common::timestamp()),
        capability_kinds: Some(vec!["connector".to_string()]),
        permissions: None,
        assignable_to: None,
        enabled: Some(true),
    })
}

pub async fn import_mcp_servers(
    codex_home: &Path,
    body: ImportMcpServerRequest,
) -> anyhow::Result<ImportMcpServerResponse> {
    let mut content = body.content.unwrap_or_default().trim().to_string();
    let url = body.url.unwrap_or_default().trim().to_string();
    if content.is_empty() && !url.is_empty() {
        content = reqwest::get(url).await?.error_for_status()?.text().await?;
    }
    if content.trim().is_empty() {
        bail!("mcp_import_empty");
    }
    let candidates = extract_mcp_candidates(&content);
    if candidates.is_empty() {
        bail!("mcp_import_no_candidates");
    }
    let mut imported = Vec::new();
    for candidate in candidates.clone() {
        imported.push(create_mcp_server(codex_home, candidate)?);
    }
    Ok(ImportMcpServerResponse {
        imported,
        candidates,
    })
}

pub fn load_marketplace_catalog(db: &Db) -> anyhow::Result<MarketplaceCatalogResponse> {
    let catalog = load_json_setting::<MarketplaceCatalog>(db, MARKETPLACE_CATALOG_SETTINGS_KEY)?;
    let catalog = catalog.unwrap_or_else(builtin_marketplace_catalog);
    if catalog.schema_version != 1 || catalog.source.id.is_empty() || catalog.source.name.is_empty()
    {
        let fallback = builtin_marketplace_catalog();
        return Ok(MarketplaceCatalogResponse {
            source: fallback.source,
            items: fallback.items,
            error: None,
            fetched_at: Some(crate::api::common::timestamp()),
        });
    }
    Ok(MarketplaceCatalogResponse {
        source: catalog.source,
        items: catalog
            .items
            .into_iter()
            .filter_map(sanitize_marketplace_item)
            .collect(),
        error: None,
        fetched_at: Some(crate::api::common::timestamp()),
    })
}

pub fn save_marketplace_catalog(
    db: &Db,
    response: MarketplaceCatalogResponse,
) -> anyhow::Result<MarketplaceCatalogResponse> {
    let catalog = MarketplaceCatalog {
        schema_version: 1,
        source: response.source.clone(),
        items: response
            .items
            .iter()
            .cloned()
            .filter_map(sanitize_marketplace_item)
            .collect(),
    };
    save_json_setting(db, MARKETPLACE_CATALOG_SETTINGS_KEY, &catalog)?;
    Ok(MarketplaceCatalogResponse {
        source: catalog.source,
        items: catalog.items,
        error: None,
        fetched_at: Some(crate::api::common::timestamp()),
    })
}

pub async fn import_marketplace_catalog(
    db: &Db,
    body: ImportMarketplaceCatalogRequest,
) -> anyhow::Result<MarketplaceCatalogResponse> {
    let mut content = body.content.unwrap_or_default().trim().to_string();
    let url = body.url.unwrap_or_default().trim().to_string();
    if content.is_empty() && !url.is_empty() {
        content = reqwest::get(url).await?.error_for_status()?.text().await?;
    }
    if content.trim().is_empty() {
        bail!("marketplace_catalog_empty");
    }
    let parsed: MarketplaceCatalog = serde_json::from_str(&content)?;
    if parsed.schema_version != 1 || parsed.source.id.is_empty() || parsed.source.name.is_empty() {
        bail!("invalid_marketplace_catalog");
    }
    save_marketplace_catalog(
        db,
        MarketplaceCatalogResponse {
            source: parsed.source,
            items: parsed
                .items
                .into_iter()
                .filter_map(sanitize_marketplace_item)
                .collect(),
            error: None,
            fetched_at: Some(crate::api::common::timestamp()),
        },
    )
}

pub fn delete_marketplace_catalog_items(
    db: &Db,
    ids: Vec<String>,
) -> anyhow::Result<MarketplaceCatalogResponse> {
    let id_set = ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let mut catalog = load_marketplace_catalog(db)?;
    catalog.items.retain(|item| !id_set.contains(&item.id));
    save_marketplace_catalog(db, catalog)
}

pub fn clear_marketplace_catalog_items(db: &Db) -> anyhow::Result<MarketplaceCatalogResponse> {
    let mut catalog = load_marketplace_catalog(db)?;
    catalog.items = Vec::new();
    save_marketplace_catalog(db, catalog)
}

pub async fn install_marketplace_item(
    codex_home: &Path,
    body: InstallMarketplaceItemRequest,
) -> anyhow::Result<InstallMarketplaceItemResponse> {
    let item = sanitize_marketplace_item(body.item)
        .ok_or_else(|| anyhow::anyhow!("invalid_marketplace_item"))?;
    let kind = item
        .install
        .get("kind")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let mut installed = Vec::new();
    match (item.item_type.as_str(), kind) {
        ("skill", "skill") => {
            let skill = item
                .install
                .get("skill")
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("invalid_marketplace_item"))?;
            installed.push(create_local_skill(
                codex_home,
                serde_json::from_value(skill)?,
            )?);
        }
        ("skill", "skillUrl") => {
            let url = item
                .install
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            installed.push(
                import_skill(
                    codex_home,
                    ImportSkillRequest {
                        url: Some(url),
                        content: None,
                    },
                )
                .await?
                .imported,
            );
        }
        ("mcp", "mcpServers") => {
            let config = item
                .install
                .get("config")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let candidates = normalize_marketplace_mcp_config(config);
            if candidates.is_empty() {
                bail!("marketplace_mcp_empty");
            }
            for candidate in candidates {
                installed.push(create_mcp_server(codex_home, candidate)?);
            }
        }
        ("plugin", "plugin") => {
            let manifest = item
                .install
                .get("manifest")
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("invalid_marketplace_item"))?;
            installed.push(create_local_plugin(
                codex_home,
                serde_json::from_value(manifest)?,
            )?);
        }
        _ => bail!("marketplace_install_mismatch"),
    }
    Ok(InstallMarketplaceItemResponse { installed })
}

pub fn read_extension_detail(
    codex_home: &Path,
    extension_type: &str,
    name: &str,
    path: Option<&str>,
) -> anyhow::Result<ExtensionDetail> {
    if extension_type == "mcp" {
        let config_path = codex_home.join("config.toml");
        let item = ExtensionSummary {
            id: format!("mcp:{name}"),
            extension_type: "mcp".to_string(),
            name: name.to_string(),
            description: None,
            path: Some(config_path.display().to_string()),
            source: Some("config.toml".to_string()),
            enabled: Some(true),
            source_type: Some("mcp_config".to_string()),
            managed_by: Some("web".to_string()),
            sync_status: Some("synced".to_string()),
            scanned_at: Some(crate::api::common::timestamp()),
            capability_kinds: Some(vec!["connector".to_string()]),
            permissions: None,
            assignable_to: None,
        };
        return Ok(ExtensionDetail {
            item,
            format: "toml".to_string(),
            content: read_mcp_config_section(&config_path, name)?,
        });
    }
    let path = path.ok_or_else(|| anyhow::anyhow!("path_required"))?;
    let root_path = assert_inside_codex_home(codex_home, path)?;
    if extension_type == "skill" {
        let skill_path = root_path.join("SKILL.md");
        let metadata = read_skill_metadata(&skill_path).unwrap_or_default();
        let is_plugin_cache = contains_path_segment_pair(&root_path, "plugins", "cache");
        let is_web_managed = contains_path_segment_pair(&root_path, "skills", "web");
        let item = skill_summary(
            root_path.clone(),
            name.to_string()
                .if_empty(metadata.name.unwrap_or_else(|| basename_string(&root_path))),
            metadata.description,
            is_web_managed,
        );
        return Ok(ExtensionDetail {
            item: ExtensionSummary {
                source: Some(
                    if is_plugin_cache {
                        "plugin cache"
                    } else if is_web_managed {
                        "web local"
                    } else {
                        "codex home"
                    }
                    .to_string(),
                ),
                ..item
            },
            format: "markdown".to_string(),
            content: fs::read_to_string(skill_path)?,
        });
    }
    if extension_type == "plugin" {
        let manifest_path = root_path.join(".codex-plugin").join("plugin.json");
        let manifest = read_json_file(&manifest_path).unwrap_or_default();
        let item = plugin_summary(
            root_path.clone(),
            manifest
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or(name)
                .to_string(),
            manifest
                .get("description")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            contains_path_segment_pair(&root_path, "plugins", "web"),
        );
        return Ok(ExtensionDetail {
            item,
            format: "json".to_string(),
            content: fs::read_to_string(manifest_path)?,
        });
    }
    bail!("invalid_extension_type");
}

pub fn page_extensions(
    items: Vec<ExtensionSummary>,
    limit: usize,
    cursor: Option<&str>,
    query: Option<&str>,
) -> PageResponse<ExtensionSummary> {
    let (cursor_sort, cursor_id) = decode_cursor(cursor);
    let query = query.unwrap_or("").trim().to_lowercase();
    let mut filtered = items
        .into_iter()
        .filter(|item| {
            query.is_empty()
                || [
                    Some(item.name.as_str()),
                    item.description.as_deref(),
                    item.path.as_deref(),
                    item.source.as_deref(),
                    Some(item.extension_type.as_str()),
                ]
                .into_iter()
                .flatten()
                .any(|value| value.to_lowercase().contains(&query))
        })
        .filter(|item| {
            cursor_sort.as_ref().map_or(true, |sort| {
                item.name > *sort
                    || (item.name == *sort && cursor_id.as_ref().map_or(true, |id| item.id > *id))
            })
        })
        .collect::<Vec<_>>();
    filtered.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    let has_more = filtered.len() > limit;
    let items = filtered.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = if has_more {
        items.last().map(|item| encode_cursor(&item.name, &item.id))
    } else {
        None
    };
    PageResponse {
        items,
        next_cursor,
        has_more,
    }
}

#[derive(Default)]
struct SkillMetadata {
    name: Option<String>,
    description: Option<String>,
}

trait EmptyStringExt {
    fn if_empty(self, fallback: String) -> String;
}

impl EmptyStringExt for String {
    fn if_empty(self, fallback: String) -> String {
        if self.trim().is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn skill_summary(
    folder: PathBuf,
    name: String,
    description: Option<String>,
    web_managed: bool,
) -> ExtensionSummary {
    ExtensionSummary {
        id: format!("skill:{}", folder.display()),
        extension_type: "skill".to_string(),
        name,
        description,
        path: Some(folder.display().to_string()),
        source: Some(
            if web_managed {
                "web local"
            } else {
                "codex home"
            }
            .to_string(),
        ),
        source_type: Some("codex_skill".to_string()),
        managed_by: Some(if web_managed { "web" } else { "codex_cli" }.to_string()),
        sync_status: Some("synced".to_string()),
        scanned_at: Some(crate::api::common::timestamp()),
        capability_kinds: Some(vec!["knowledge".to_string()]),
        permissions: Some(vec!["read_context".to_string()]),
        assignable_to: None,
        enabled: Some(true),
    }
}

fn plugin_summary(
    plugin_root: PathBuf,
    name: String,
    description: Option<String>,
    web_managed: bool,
) -> ExtensionSummary {
    ExtensionSummary {
        id: format!("plugin:{}", plugin_root.display()),
        extension_type: "plugin".to_string(),
        name,
        description,
        path: Some(plugin_root.display().to_string()),
        source: Some(
            if web_managed {
                "web local"
            } else {
                "codex home"
            }
            .to_string(),
        ),
        source_type: Some("codex_plugin".to_string()),
        managed_by: Some(if web_managed { "web" } else { "codex_cli" }.to_string()),
        sync_status: Some("synced".to_string()),
        scanned_at: Some(crate::api::common::timestamp()),
        capability_kinds: Some(vec!["tool".to_string()]),
        permissions: None,
        assignable_to: None,
        enabled: Some(true),
    }
}

fn find_named_files(root: &Path, file_name: &str, depth: i32) -> anyhow::Result<Vec<PathBuf>> {
    if depth < 0 || !root.exists() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name == ".git" {
            continue;
        }
        let path = entry.path();
        if path.is_file() && name == file_name {
            results.push(path);
        } else if path.is_dir() {
            results.extend(find_named_files(&path, file_name, depth - 1)?);
        }
    }
    Ok(results)
}

fn find_plugin_manifests(root: &Path, depth: i32) -> anyhow::Result<Vec<PathBuf>> {
    let files = find_named_files(root, "plugin.json", depth)?;
    Ok(files
        .into_iter()
        .filter(|path| {
            path.parent()
                .and_then(|parent| parent.file_name())
                .and_then(|name| name.to_str())
                == Some(".codex-plugin")
        })
        .collect())
}

fn read_json_file(path: &Path) -> anyhow::Result<serde_json::Map<String, serde_json::Value>> {
    let value = serde_json::from_str::<serde_json::Value>(&fs::read_to_string(path)?)?;
    Ok(value.as_object().cloned().unwrap_or_default())
}

fn read_skill_metadata(path: &Path) -> anyhow::Result<SkillMetadata> {
    Ok(read_skill_metadata_from_content(&fs::read_to_string(path)?))
}

fn read_skill_metadata_from_content(content: &str) -> SkillMetadata {
    let front_matter = content
        .strip_prefix("---")
        .and_then(|value| value.split_once("\n---"))
        .map(|(value, _)| value)
        .unwrap_or("");
    let front_name = find_yaml_line(front_matter, "name");
    let front_description = find_yaml_line(front_matter, "description");
    let title = content.lines().find_map(|line| {
        line.trim()
            .strip_prefix("# ")
            .map(|value| value.trim().to_string())
    });
    let description = front_description.or_else(|| {
        content
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with("---") && !line.starts_with('#'))
            .map(str::to_string)
    });
    SkillMetadata {
        name: front_name.or(title),
        description,
    }
}

fn find_yaml_line(content: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    content.lines().find_map(|line| {
        let line = line.trim();
        line.strip_prefix(&prefix)
            .map(|value| {
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string()
            })
            .filter(|value| !value.is_empty())
    })
}

fn render_skill_markdown(name: &str, description: &str, instructions: &str) -> String {
    format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\n---\n\n# {}\n\n{}\n\n## Instructions\n\n{}\n",
        escape_skill_front_matter(name),
        escape_skill_front_matter(description),
        name,
        description,
        instructions
    )
}

fn escape_skill_front_matter(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn skill_instructions_from_content(content: &str) -> String {
    let without_front_matter = if content.starts_with("---") {
        content
            .split_once("\n---")
            .map(|(_, rest)| rest)
            .unwrap_or(content)
    } else {
        content
    }
    .trim();
    if let Some(index) = without_front_matter.to_lowercase().find("## instructions") {
        return without_front_matter[index + "## instructions".len()..]
            .trim()
            .to_string();
    }
    without_front_matter
        .lines()
        .skip_while(|line| line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn normalize_import_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://github.com/") {
        let parts = rest.split('/').collect::<Vec<_>>();
        if parts.len() >= 5 && parts[2] == "blob" {
            return format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}",
                parts[0],
                parts[1],
                parts[3],
                parts[4..].join("/")
            );
        }
    }
    url.to_string()
}

fn assert_web_managed_skill_path(
    codex_home: &Path,
    path: &str,
) -> anyhow::Result<(PathBuf, PathBuf)> {
    let root = codex_home
        .join("skills")
        .join("web")
        .canonicalize()
        .unwrap_or_else(|_| codex_home.join("skills").join("web"));
    let folder = PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path));
    if folder != root && !folder.starts_with(&root) {
        bail!("skill_not_web_managed");
    }
    let skill_path = folder.join("SKILL.md");
    if !skill_path.exists() {
        bail!("skill_not_found");
    }
    Ok((folder, skill_path))
}

fn assert_inside_codex_home(codex_home: &Path, path: &str) -> anyhow::Result<PathBuf> {
    let root = codex_home
        .canonicalize()
        .unwrap_or_else(|_| codex_home.to_path_buf());
    let absolute = PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path));
    if absolute != root && !absolute.starts_with(&root) {
        bail!("path_outside_codex_home");
    }
    Ok(absolute)
}

fn extension_toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn render_mcp_server_toml(body: &CreateMcpServerRequest) -> String {
    let mut lines = vec![
        format!("[mcp_servers.{}]", extension_toml_string(body.name.trim())),
        format!("command = {}", extension_toml_string(body.command.trim())),
    ];
    if !body.args.is_empty() {
        lines.push(format!(
            "args = [{}]",
            body.args
                .iter()
                .map(|value| extension_toml_string(value))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !body.env.is_empty() {
        let env = body
            .env
            .iter()
            .map(|(key, value)| {
                format!("{key} = {}", extension_toml_string(&value_to_string(value)))
            })
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("env = {{ {env} }}"));
    }
    lines.join("\n")
}

fn replace_or_append_mcp_section(current: &str, name: &str, section: &str) -> String {
    let mut output = Vec::new();
    let quoted = format!("[mcp_servers.{}]", extension_toml_string(name));
    let bare = format!("[mcp_servers.{name}]");
    let mut replaced = false;
    let mut skipping = false;
    for line in current.lines() {
        let trimmed = line.trim();
        if trimmed == quoted || trimmed == bare {
            if !replaced {
                output.push(section.to_string());
                replaced = true;
            }
            skipping = true;
            continue;
        }
        if skipping && trimmed.starts_with('[') {
            skipping = false;
        }
        if !skipping {
            output.push(line.to_string());
        }
    }
    if !replaced {
        if !current.trim().is_empty() {
            output.push(String::new());
        }
        output.push(section.to_string());
    }
    output.join("\n")
}

fn parse_toml_section_name(raw: &str) -> String {
    if raw.starts_with('"') {
        serde_json::from_str::<String>(raw).unwrap_or_default()
    } else {
        raw.trim().to_string()
    }
}

fn extract_mcp_candidates(content: &str) -> Vec<CreateMcpServerRequest> {
    let decoded = decode_html_entities(content);
    let mut candidates = Vec::new();
    push_mcp_candidates(&mut candidates, try_parse_mcp_json(&decoded));
    for fence in decoded.split("```").skip(1).step_by(2) {
        let body = fence
            .strip_prefix("json")
            .or_else(|| fence.strip_prefix("jsonc"))
            .unwrap_or(fence)
            .trim();
        push_mcp_candidates(&mut candidates, try_parse_mcp_json(body));
    }
    candidates
}

fn try_parse_mcp_json(value: &str) -> Vec<CreateMcpServerRequest> {
    serde_json::from_str::<serde_json::Value>(value)
        .ok()
        .map(mcp_candidates_from_config)
        .unwrap_or_default()
}

fn normalize_marketplace_mcp_config(value: serde_json::Value) -> Vec<CreateMcpServerRequest> {
    mcp_candidates_from_config(value)
}

fn mcp_candidates_from_config(value: serde_json::Value) -> Vec<CreateMcpServerRequest> {
    let Some(root) = value.as_object() else {
        return Vec::new();
    };
    let servers = root
        .get("mcpServers")
        .and_then(|value| value.as_object())
        .unwrap_or(root);
    servers
        .iter()
        .filter_map(|(name, raw)| {
            let server = raw.as_object()?;
            let command = server.get("command")?.as_str()?.trim().to_string();
            if command.is_empty() {
                return None;
            }
            let args = server
                .get("args")
                .and_then(|value| value.as_array())
                .map(|items| items.iter().map(value_to_string).collect())
                .unwrap_or_default();
            let env = server
                .get("env")
                .and_then(|value| value.as_object())
                .map(|object| {
                    object
                        .iter()
                        .map(|(key, value)| {
                            (
                                key.clone(),
                                serde_json::Value::String(value_to_string(value)),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(CreateMcpServerRequest {
                name: name.to_string(),
                command,
                args,
                env,
            })
        })
        .collect()
}

fn push_mcp_candidates(
    target: &mut Vec<CreateMcpServerRequest>,
    items: Vec<CreateMcpServerRequest>,
) {
    let mut seen = target
        .iter()
        .map(|item| format!("{}\n{}\n{}", item.name, item.command, item.args.join("\n")))
        .collect::<HashSet<_>>();
    for item in items {
        let key = format!("{}\n{}\n{}", item.name, item.command, item.args.join("\n"));
        if seen.insert(key) {
            target.push(item);
        }
    }
}

fn read_mcp_config_section(config_path: &Path, name: &str) -> anyhow::Result<String> {
    let content = fs::read_to_string(config_path).unwrap_or_default();
    let quoted = format!("[mcp_servers.{}]", extension_toml_string(name));
    let bare = format!("[mcp_servers.{name}]");
    let mut collecting = false;
    let mut lines = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == quoted || trimmed == bare {
            collecting = true;
        } else if collecting && trimmed.starts_with('[') {
            break;
        }
        if collecting {
            lines.push(line);
        }
    }
    Ok(lines.join("\n").trim().to_string())
}

fn sanitize_marketplace_item(item: MarketplaceCatalogItem) -> Option<MarketplaceCatalogItem> {
    if item.id.trim().is_empty()
        || item.name.trim().is_empty()
        || item.description.trim().is_empty()
        || !matches!(item.item_type.as_str(), "skill" | "mcp" | "plugin")
        || !item.install.is_object()
    {
        return None;
    }
    Some(item)
}

fn builtin_marketplace_catalog() -> MarketplaceCatalog {
    MarketplaceCatalog {
        schema_version: 1,
        source: MarketplaceCatalogSource {
            id: "agentim-built-in".to_string(),
            name: "AgentIM Built-in Catalog".to_string(),
            homepage: None,
        },
        items: Vec::new(),
    }
}

fn contains_path_segment_pair(path: &Path, first: &str, second: &str) -> bool {
    let segments = path
        .components()
        .map(|item| item.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    segments
        .windows(2)
        .any(|pair| pair[0] == first && pair[1] == second)
}

fn basename_string(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn clean_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "item".to_string()
    } else {
        out
    }
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
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

fn encode_cursor(sort: &str, id: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!("{sort}\n{id}"))
}

fn decode_cursor(value: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    use base64::Engine;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default();
    let mut parts = decoded.splitn(2, '\n');
    (
        parts
            .next()
            .map(str::to_string)
            .filter(|value| !value.is_empty()),
        parts
            .next()
            .map(str::to_string)
            .filter(|value| !value.is_empty()),
    )
}
